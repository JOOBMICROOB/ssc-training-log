-- 0012_sync.sql
-- Offline-sync backbone: conflict ledger + atomic upsert RPCs that the client
-- offline outbox calls to push cached logs. Every RPC is a single-transaction
-- compare-and-swap so a set logged offline and later synced can never silently
-- overwrite a change made elsewhere (another device, or a dropped connection
-- mid-sync). Divergent values are MERGED where fields don't overlap and FLAGGED
-- (both values preserved in sync_conflicts) where they do — nothing is dropped.

-- ---------------------------------------------------------------------------
-- Conflict ledger. One row per field that could not be auto-merged. The losing
-- value is preserved here so a human (athlete or coach) can resolve it later.
-- ---------------------------------------------------------------------------
create table sync_conflicts (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references athletes (id) on delete cascade,
  table_name   text not null,               -- 'set_logs' | 'session_logs' | 'weekly_checkins'
  row_id       uuid not null,               -- the surviving row
  client_uuid  uuid,
  field        text not null,
  base_value   jsonb,                       -- value the offline edit was based on
  local_value  jsonb,                       -- value the incoming (offline) edit wanted
  remote_value jsonb,                        -- value already on the server (preserved)
  applied      text not null,               -- which value the row now holds: 'local'|'remote'
  resolved_at  timestamptz,
  resolution   jsonb,
  created_at   timestamptz not null default now()
);

create index sync_conflicts_athlete_idx on sync_conflicts (athlete_id, created_at desc);
create index sync_conflicts_open_idx
  on sync_conflicts (athlete_id) where resolved_at is null;
create index sync_conflicts_row_idx on sync_conflicts (table_name, row_id);

alter table sync_conflicts enable row level security;

create policy sync_conflicts_select on sync_conflicts for select to authenticated using (
  athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id)
);
create policy sync_conflicts_resolve on sync_conflicts for update to authenticated
  using (athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id))
  with check (athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id));

-- ---------------------------------------------------------------------------
-- Three-way merge of a single field, in jsonb space.
--   b = base (value the offline edit started from)
--   l = local (the incoming offline edit's value)
--   r = remote (value currently on the server)
-- Returns { "value": <winning jsonb>, "conflict": <bool> }.
-- Rule: if local didn't change the field -> take remote (someone else's edit
-- wins for a field this device didn't touch). If remote didn't change -> take
-- local. If both changed to the same value -> no conflict. If both changed
-- differently -> conflict; the incoming (local) write wins the row, remote is
-- preserved in the ledger.
-- ---------------------------------------------------------------------------
create or replace function ssc_merge3(b jsonb, l jsonb, r jsonb)
returns jsonb language sql immutable as $$
  select case
    when coalesce(l, 'null'::jsonb) = coalesce(b, 'null'::jsonb)
      then jsonb_build_object('value', coalesce(r, 'null'::jsonb), 'conflict', false)
    when coalesce(r, 'null'::jsonb) = coalesce(b, 'null'::jsonb)
      then jsonb_build_object('value', coalesce(l, 'null'::jsonb), 'conflict', false)
    when coalesce(r, 'null'::jsonb) = coalesce(l, 'null'::jsonb)
      then jsonb_build_object('value', coalesce(l, 'null'::jsonb), 'conflict', false)
    else jsonb_build_object('value', coalesce(l, 'null'::jsonb), 'conflict', true)
  end;
$$;

-- ---------------------------------------------------------------------------
-- ssc_upsert_set_log(payload jsonb) -> jsonb
--
-- payload = {
--   client_uuid, exercise_row_id, set_number, device_id, logged_at,
--   base_version,                    -- null on first insert
--   base:  { weight_kg, reps, rpe, velocity, notes, set_number } | null,
--   patch: { weight_kg, reps, rpe, velocity, notes, set_number }
-- }
-- returns { status, row, conflicts:[{field,base,local,remote}] }
--   status: 'inserted' | 'updated' | 'merged' | 'renumbered'
--
-- Idempotent on (athlete_id, client_uuid): replaying the same insert returns
-- the existing row instead of duplicating.
-- ---------------------------------------------------------------------------
create or replace function ssc_upsert_set_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a_id        uuid := (select auth.uid());
  cuid        uuid := (payload->>'client_uuid')::uuid;
  row_id      uuid := (payload->>'exercise_row_id')::uuid;
  req_setno   int  := (payload->>'set_number')::int;
  base_ver    int  := nullif(payload->>'base_version', '')::int;
  base        jsonb := coalesce(payload->'base', 'null'::jsonb);
  patch       jsonb := coalesce(payload->'patch', '{}'::jsonb);
  existing    set_logs%rowtype;
  status      text;
  conflicts   jsonb := '[]'::jsonb;
  new_setno   int;
  fields      text[] := array['weight_kg','reps','rpe','velocity','notes','set_number'];
  f           text;
  m           jsonb;
  merged      jsonb := '{}'::jsonb;
  had_field_conflict boolean := false;
  result_row  set_logs%rowtype;
begin
  if ssc_current_athlete() is null then
    raise exception 'only an athlete may log sets';
  end if;
  if cuid is null then
    raise exception 'client_uuid is required for offline-safe upsert';
  end if;

  -- Integrity: the exercise row must belong to a program published to this athlete.
  if not ssc_athlete_has_program(
       (select pw.program_id
          from exercise_rows er
          join program_sessions ps on ps.id = er.session_id
          join program_weeks pw on pw.id = ps.week_id
         where er.id = row_id)) then
    raise exception 'exercise row % is not in a program assigned to this athlete', row_id;
  end if;

  select * into existing from set_logs where athlete_id = a_id and client_uuid = cuid;

  -- ---- INSERT path -------------------------------------------------------
  if not found then
    begin
      insert into set_logs (exercise_row_id, athlete_id, set_number, weight_kg, reps,
                            rpe, velocity, notes, client_uuid, device_id, logged_at, version)
      values (
        row_id, a_id, req_setno,
        (patch->>'weight_kg')::numeric, (patch->>'reps')::int,
        (patch->>'rpe')::numeric, (patch->>'velocity')::numeric, patch->>'notes',
        cuid, payload->>'device_id',
        coalesce((payload->>'logged_at')::timestamptz, now()), 1)
      returning * into result_row;
      status := 'inserted';
    exception when unique_violation then
      -- Another device already claimed this (exercise_row, set_number). Preserve
      -- this data by appending it as the next set number, and flag the clash.
      select coalesce(max(set_number), 0) + 1 into new_setno
        from set_logs where exercise_row_id = row_id;
      insert into set_logs (exercise_row_id, athlete_id, set_number, weight_kg, reps,
                            rpe, velocity, notes, client_uuid, device_id, logged_at, version)
      values (
        row_id, a_id, new_setno,
        (patch->>'weight_kg')::numeric, (patch->>'reps')::int,
        (patch->>'rpe')::numeric, (patch->>'velocity')::numeric, patch->>'notes',
        cuid, payload->>'device_id',
        coalesce((payload->>'logged_at')::timestamptz, now()), 1)
      returning * into result_row;
      insert into sync_conflicts (athlete_id, table_name, row_id, client_uuid, field,
                                  base_value, local_value, remote_value, applied)
      values (a_id, 'set_logs', result_row.id, cuid, 'set_number',
              'null'::jsonb, to_jsonb(req_setno), to_jsonb(req_setno), 'local');
      conflicts := jsonb_build_array(jsonb_build_object(
        'field','set_number','base',null,'local',req_setno,'remote',req_setno,
        'note','set number was taken; appended as ' || new_setno));
      status := 'renumbered';
    end;
    return jsonb_build_object('status', status, 'row', to_jsonb(result_row), 'conflicts', conflicts);
  end if;

  -- ---- Idempotent replay: same insert arrived twice --------------------
  if base_ver is null then
    -- The client thinks this is a fresh insert but the row exists => it's a
    -- retry of an already-applied insert. Return the existing row unchanged.
    return jsonb_build_object('status', 'inserted', 'row', to_jsonb(existing),
                              'conflicts', '[]'::jsonb);
  end if;

  -- ---- Clean UPDATE (no concurrent change) ------------------------------
  if base_ver = existing.version then
    update set_logs set
      weight_kg = case when patch ? 'weight_kg' then (patch->>'weight_kg')::numeric else weight_kg end,
      reps      = case when patch ? 'reps'      then (patch->>'reps')::int          else reps end,
      rpe       = case when patch ? 'rpe'       then (patch->>'rpe')::numeric        else rpe end,
      velocity  = case when patch ? 'velocity'  then (patch->>'velocity')::numeric   else velocity end,
      notes     = case when patch ? 'notes'     then patch->>'notes'                 else notes end,
      set_number= case when patch ? 'set_number'then (patch->>'set_number')::int     else set_number end,
      version   = existing.version + 1
    where id = existing.id
    returning * into result_row;
    return jsonb_build_object('status', 'updated', 'row', to_jsonb(result_row),
                              'conflicts', '[]'::jsonb);
  end if;

  -- ---- CONCURRENT change: three-way merge, field by field ---------------
  foreach f in array fields loop
    m := ssc_merge3(base->f, patch->f, to_jsonb(existing)->f);
    merged := merged || jsonb_build_object(f, m->'value');
    if (m->>'conflict')::boolean then
      had_field_conflict := true;
      insert into sync_conflicts (athlete_id, table_name, row_id, client_uuid, field,
                                  base_value, local_value, remote_value, applied)
      values (a_id, 'set_logs', existing.id, cuid, f,
              base->f, patch->f, to_jsonb(existing)->f, 'local');
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'field', f, 'base', base->f, 'local', patch->f, 'remote', to_jsonb(existing)->f));
    end if;
  end loop;

  update set_logs set
    weight_kg  = (merged->>'weight_kg')::numeric,
    reps       = (merged->>'reps')::int,
    rpe        = (merged->>'rpe')::numeric,
    velocity   = (merged->>'velocity')::numeric,
    notes      = merged->>'notes',
    set_number = coalesce((merged->>'set_number')::int, existing.set_number),
    version    = existing.version + 1
  where id = existing.id
  returning * into result_row;

  status := case when had_field_conflict then 'merged' else 'updated' end;
  return jsonb_build_object('status', status, 'row', to_jsonb(result_row), 'conflicts', conflicts);
end;
$$;

revoke all on function ssc_upsert_set_log(jsonb) from public;
grant execute on function ssc_upsert_set_log(jsonb) to authenticated;
