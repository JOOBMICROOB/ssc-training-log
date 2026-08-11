-- 0013_sync_session_checkin.sql
-- Offline-safe upsert RPCs for session logs and weekly check-ins. Same
-- compare-and-swap + three-way-merge contract as ssc_upsert_set_log (0012).

-- ---------------------------------------------------------------------------
-- ssc_upsert_session_log(payload jsonb) -> jsonb
-- payload = { client_uuid, program_session_id, base_version, logged_at,
--             base:{pain_rating,session_rpe,notes}|null,
--             patch:{pain_rating,session_rpe,notes} }
-- ---------------------------------------------------------------------------
create or replace function ssc_upsert_session_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a_id      uuid := (select auth.uid());
  cuid      uuid := (payload->>'client_uuid')::uuid;
  sess_id   uuid := (payload->>'program_session_id')::uuid;
  base_ver  int  := nullif(payload->>'base_version', '')::int;
  base      jsonb := coalesce(payload->'base', 'null'::jsonb);
  patch     jsonb := coalesce(payload->'patch', '{}'::jsonb);
  existing  session_logs%rowtype;
  fields    text[] := array['pain_rating','session_rpe','notes'];
  f         text; m jsonb; merged jsonb := '{}'::jsonb;
  conflicts jsonb := '[]'::jsonb; had_conflict boolean := false;
  result_row session_logs%rowtype;
begin
  if ssc_current_athlete() is null then raise exception 'only an athlete may log sessions'; end if;
  if cuid is null then raise exception 'client_uuid is required'; end if;

  if not ssc_athlete_has_program(
       (select pw.program_id from program_sessions ps
          join program_weeks pw on pw.id = ps.week_id where ps.id = sess_id)) then
    raise exception 'session % is not in a program assigned to this athlete', sess_id;
  end if;

  select * into existing from session_logs where athlete_id = a_id and client_uuid = cuid;

  if not found then
    insert into session_logs (program_session_id, athlete_id, pain_rating, session_rpe,
                              notes, client_uuid, logged_at, version)
    values (sess_id, a_id, (patch->>'pain_rating')::smallint, (patch->>'session_rpe')::numeric,
            patch->>'notes', cuid, coalesce((payload->>'logged_at')::timestamptz, now()), 1)
    on conflict (program_session_id, athlete_id) do nothing
    returning * into result_row;
    -- If the (session, athlete) row already existed under a different client_uuid,
    -- fall through to a merge against it rather than dropping this data.
    if result_row.id is null then
      select * into existing from session_logs
        where program_session_id = sess_id and athlete_id = a_id;
      base_ver := -1;  -- force the merge branch (unknown base)
    else
      return jsonb_build_object('status','inserted','row',to_jsonb(result_row),'conflicts','[]'::jsonb);
    end if;
  end if;

  if base_ver is null then
    return jsonb_build_object('status','inserted','row',to_jsonb(existing),'conflicts','[]'::jsonb);
  end if;

  if base_ver = existing.version then
    update session_logs set
      pain_rating = case when patch ? 'pain_rating' then (patch->>'pain_rating')::smallint else pain_rating end,
      session_rpe = case when patch ? 'session_rpe' then (patch->>'session_rpe')::numeric else session_rpe end,
      notes       = case when patch ? 'notes' then patch->>'notes' else notes end,
      version     = existing.version + 1
    where id = existing.id returning * into result_row;
    return jsonb_build_object('status','updated','row',to_jsonb(result_row),'conflicts','[]'::jsonb);
  end if;

  foreach f in array fields loop
    m := ssc_merge3(base->f, patch->f, to_jsonb(existing)->f);
    merged := merged || jsonb_build_object(f, m->'value');
    if (m->>'conflict')::boolean then
      had_conflict := true;
      insert into sync_conflicts (athlete_id, table_name, row_id, client_uuid, field,
                                  base_value, local_value, remote_value, applied)
      values (a_id, 'session_logs', existing.id, cuid, f, base->f, patch->f, to_jsonb(existing)->f, 'local');
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'field', f, 'base', base->f, 'local', patch->f, 'remote', to_jsonb(existing)->f));
    end if;
  end loop;

  update session_logs set
    pain_rating = (merged->>'pain_rating')::smallint,
    session_rpe = (merged->>'session_rpe')::numeric,
    notes       = merged->>'notes',
    version     = existing.version + 1
  where id = existing.id returning * into result_row;

  return jsonb_build_object('status', case when had_conflict then 'merged' else 'updated' end,
                            'row', to_jsonb(result_row), 'conflicts', conflicts);
end;
$$;

revoke all on function ssc_upsert_session_log(jsonb) from public;
grant execute on function ssc_upsert_session_log(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- ssc_upsert_weekly_checkin(payload jsonb) -> jsonb
-- payload = { client_uuid, week_start, program_week_id, base_version,
--             base:{...seven scores, notes}|null, patch:{...} }
-- ---------------------------------------------------------------------------
create or replace function ssc_upsert_weekly_checkin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a_id      uuid := (select auth.uid());
  cuid      uuid := (payload->>'client_uuid')::uuid;
  wk_start  date := (payload->>'week_start')::date;
  pw_id     uuid := nullif(payload->>'program_week_id','')::uuid;
  base_ver  int  := nullif(payload->>'base_version', '')::int;
  base      jsonb := coalesce(payload->'base', 'null'::jsonb);
  patch     jsonb := coalesce(payload->'patch', '{}'::jsonb);
  existing  weekly_checkins%rowtype;
  fields    text[] := array['training','sleep','nutrition','stress','overall_feeling','motivation','pain_aches','notes'];
  f         text; m jsonb; merged jsonb := '{}'::jsonb;
  conflicts jsonb := '[]'::jsonb; had_conflict boolean := false;
  result_row weekly_checkins%rowtype;
begin
  if ssc_current_athlete() is null then raise exception 'only an athlete may check in'; end if;
  if cuid is null then raise exception 'client_uuid is required'; end if;

  select * into existing from weekly_checkins where athlete_id = a_id and client_uuid = cuid;

  if not found then
    insert into weekly_checkins (athlete_id, program_week_id, week_start, training, sleep,
              nutrition, stress, overall_feeling, motivation, pain_aches, notes, client_uuid, version)
    values (a_id, pw_id, wk_start,
            (patch->>'training')::smallint, (patch->>'sleep')::smallint, (patch->>'nutrition')::smallint,
            (patch->>'stress')::smallint, (patch->>'overall_feeling')::smallint, (patch->>'motivation')::smallint,
            (patch->>'pain_aches')::smallint, patch->>'notes', cuid, 1)
    on conflict (athlete_id, week_start) do nothing
    returning * into result_row;
    -- If the (athlete, week) row already existed under a different client_uuid,
    -- merge against it rather than dropping this check-in.
    if result_row.id is null then
      select * into existing from weekly_checkins where athlete_id = a_id and week_start = wk_start;
      base_ver := -1;  -- force the merge branch (unknown base)
    else
      return jsonb_build_object('status','inserted','row',to_jsonb(result_row),'conflicts','[]'::jsonb);
    end if;
  end if;

  if base_ver is null then
    return jsonb_build_object('status','inserted','row',to_jsonb(existing),'conflicts','[]'::jsonb);
  end if;

  if base_ver = existing.version then
    update weekly_checkins set
      training        = case when patch ? 'training' then (patch->>'training')::smallint else training end,
      sleep           = case when patch ? 'sleep' then (patch->>'sleep')::smallint else sleep end,
      nutrition       = case when patch ? 'nutrition' then (patch->>'nutrition')::smallint else nutrition end,
      stress          = case when patch ? 'stress' then (patch->>'stress')::smallint else stress end,
      overall_feeling = case when patch ? 'overall_feeling' then (patch->>'overall_feeling')::smallint else overall_feeling end,
      motivation      = case when patch ? 'motivation' then (patch->>'motivation')::smallint else motivation end,
      pain_aches      = case when patch ? 'pain_aches' then (patch->>'pain_aches')::smallint else pain_aches end,
      notes           = case when patch ? 'notes' then patch->>'notes' else notes end,
      version         = existing.version + 1
    where id = existing.id returning * into result_row;
    return jsonb_build_object('status','updated','row',to_jsonb(result_row),'conflicts','[]'::jsonb);
  end if;

  foreach f in array fields loop
    m := ssc_merge3(base->f, patch->f, to_jsonb(existing)->f);
    merged := merged || jsonb_build_object(f, m->'value');
    if (m->>'conflict')::boolean then
      had_conflict := true;
      insert into sync_conflicts (athlete_id, table_name, row_id, client_uuid, field,
                                  base_value, local_value, remote_value, applied)
      values (a_id, 'weekly_checkins', existing.id, cuid, f, base->f, patch->f, to_jsonb(existing)->f, 'local');
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'field', f, 'base', base->f, 'local', patch->f, 'remote', to_jsonb(existing)->f));
    end if;
  end loop;

  update weekly_checkins set
    training        = (merged->>'training')::smallint,
    sleep           = (merged->>'sleep')::smallint,
    nutrition       = (merged->>'nutrition')::smallint,
    stress          = (merged->>'stress')::smallint,
    overall_feeling = (merged->>'overall_feeling')::smallint,
    motivation      = (merged->>'motivation')::smallint,
    pain_aches      = (merged->>'pain_aches')::smallint,
    notes           = merged->>'notes',
    version         = existing.version + 1
  where id = existing.id returning * into result_row;

  return jsonb_build_object('status', case when had_conflict then 'merged' else 'updated' end,
                            'row', to_jsonb(result_row), 'conflicts', conflicts);
end;
$$;

revoke all on function ssc_upsert_weekly_checkin(jsonb) from public;
grant execute on function ssc_upsert_weekly_checkin(jsonb) to authenticated;
