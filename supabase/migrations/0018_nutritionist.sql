-- 0018_nutritionist.sql
-- ---------------------------------------------------------------------------
-- Nutritionist role: a read-only follower (Jess Clarysse) of the athletes a
-- coach flags as "nutrition". Jess sees those athletes' full info (program,
-- logs, PRs, bodyweight, check-ins) but can change NOTHING — enforced here by
-- RLS (select-only policies + no write path), not just by the UI.
--
-- Model (builds on 0014 app_profiles/app_state + 0016 multi-coach):
--   * app_profiles.nutrition (boolean) marks an athlete as a nutrition client.
--     A coach ticks it from the console; the write goes through app_set_nutrition()
--     (security definer) so coaches never need direct UPDATE on athlete profiles.
--   * A nutritionist is an app_profiles row with role='nutritionist'.
--   * RLS grants a nutritionist SELECT (only) on the profiles + app_state of
--     athletes where nutrition = true. No insert/update/delete anywhere.
--
-- SAFE + ADDITIVE: no table/column is dropped, no athlete data is touched. Only
-- a new column, a function, and new policies are added. Keep PITR on. Run the
-- whole file in the Supabase SQL editor, then create Jess's login (bottom).
-- ---------------------------------------------------------------------------

-- 1) Per-athlete nutrition flag ----------------------------------------------
alter table app_profiles add column if not exists nutrition boolean not null default false;

-- 2) Let the new-user trigger also profile a NUTRITIONIST --------------------
create or replace function app_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.raw_user_meta_data ->> 'role') in ('athlete', 'coach', 'nutritionist') then
    insert into app_profiles (user_id, role, code, name, coach_user_id)
    values (
      new.id,
      new.raw_user_meta_data ->> 'role',
      new.raw_user_meta_data ->> 'code',
      new.raw_user_meta_data ->> 'name',
      case when (new.raw_user_meta_data ->> 'role') = 'athlete'
           then nullif(new.raw_user_meta_data ->> 'coach_user_id', '')::uuid
           else null end
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- 3) Helper: is the current user a nutritionist? (security definer → no RLS loop)
create or replace function app_is_nutritionist() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_profiles p
                 where p.user_id = auth.uid() and p.role = 'nutritionist');
$$;

-- 4) Coach sets/clears the flag on an athlete they own or are shared ----------
-- Routed through a function so coaches never get a blanket UPDATE on profiles.
create or replace function app_set_nutrition(athlete uuid, val boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_can_edit(athlete) then
    raise exception 'not allowed to change this athlete';
  end if;
  update app_profiles set nutrition = val where user_id = athlete;
end;
$$;
grant execute on function app_set_nutrition(uuid, boolean) to authenticated;

-- 5) RLS — nutritionist is READ-ONLY on nutrition athletes -------------------
-- Profiles of nutrition athletes (so Jess's roster can list them).
drop policy if exists profiles_read_nutritionist on app_profiles;
create policy profiles_read_nutritionist on app_profiles for select
  using (app_is_nutritionist() and nutrition = true);

-- Athlete state — SELECT only. There is deliberately NO nutritionist write
-- policy on app_state, so Jess can read everything and change nothing.
drop policy if exists state_read_nutritionist on app_state;
create policy state_read_nutritionist on app_state for select
  using (app_is_nutritionist()
         and exists (select 1 from app_profiles p
                     where p.user_id = app_state.user_id and p.nutrition = true));

-- ---------------------------------------------------------------------------
-- 6) CREATE JESS'S LOGIN
-- ---------------------------------------------------------------------------
-- Supabase dashboard → Authentication → Users → "Add user". Set an email + a
-- password, tick "Auto Confirm User", and paste into "User Metadata" (raw JSON):
--
--   { "role": "nutritionist", "code": "JESS", "name": "Jess Clarysse" }
--
-- The trigger above then creates Jess's app_profiles row automatically. Jess
-- signs in on the /coach screen with that email + password and lands on the
-- read-only nutrition board.
--
-- If the user already exists WITHOUT a profile, run:
--   insert into app_profiles (user_id, role, code, name)
--   select id, 'nutritionist', 'JESS', 'Jess Clarysse' from auth.users where email = 'jess@ssc.app'
--   on conflict (user_id) do update set role='nutritionist', code=excluded.code, name=excluded.name;
-- ---------------------------------------------------------------------------
