-- 0011_guards.sql
-- Column-level integrity that RLS alone can't express (it can't compare OLD/NEW).

-- An athlete may edit their own profile, but must not move themselves to a
-- different coach — only a coach may (re)assign primary_coach_id.
create or replace function ssc_guard_athlete_reassign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.primary_coach_id is distinct from old.primary_coach_id
     and ssc_current_coach() is null then
    raise exception 'only a coach may change an athlete''s primary coach';
  end if;
  return new;
end;
$$;

create trigger athletes_guard_reassign
  before update on athletes
  for each row execute function ssc_guard_athlete_reassign();

-- Only a head coach may grant/revoke head-coach status (no self-promotion).
create or replace function ssc_guard_head_coach_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_head_coach is distinct from old.is_head_coach
     and not ssc_is_head_coach() then
    raise exception 'only a head coach may change head-coach status';
  end if;
  return new;
end;
$$;

create trigger coaches_guard_head_flag
  before update on coaches
  for each row execute function ssc_guard_head_coach_flag();
