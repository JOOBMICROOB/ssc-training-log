-- 0016_multi_coach.sql
-- ---------------------------------------------------------------------------
-- Multi-coach: two more coaches (Mika, Maxim), each with their own athletes,
-- plus athlete SHARING so a coach can help on another coach's athlete.
--
-- Model (builds on 0014/0015 — app_profiles + app_state + app_shared):
--   * Each coach is a Supabase Auth user with an app_profiles row (role='coach').
--   * An athlete belongs to one coach via app_profiles.coach_user_id (owner).
--   * app_shared_athletes adds extra coaches who can ALSO fully edit an athlete
--     ("shared"), on top of the owner. Either the owner or the sharee can remove.
--   * Exercises / competitions / shop stay global (app_shared) — all coaches share.
--   * Weeks / program / planner live in each athlete's app_state — a coach only
--     reaches their OWN + SHARED athletes' state (RLS below); everyone else sees
--     just the athlete's name/summary from app_profiles.
--
-- SAFE + ADDITIVE: no table is dropped, no athlete data is touched. Policies are
-- recreated (create-or-replace style) which never affects stored rows. Keep PITR on.
-- Run this whole file in the Supabase SQL editor. Then create the two coach logins
-- (bottom of file), and disable Auth → Providers → Email → "Confirm email".
-- ---------------------------------------------------------------------------

-- 1) Link any orphan athletes to Noa -----------------------------------------
-- Some early athletes (e.g. RS1203) were never linked to a coach; the console
-- carried a hardcoded fallback for that. Give every unlinked athlete to Noa so
-- the fallback can be removed and rosters are driven purely by coach_user_id.
update app_profiles
   set coach_user_id = (select user_id from app_profiles
                        where role = 'coach' and lower(name) like 'noa%'
                        order by created_at limit 1)
 where role = 'athlete' and coach_user_id is null;

-- 2) Let the new-user trigger also profile COACHES ---------------------------
-- (createAthlete already signs athletes up; the same path can make a coach when
-- role='coach' is in the signup metadata.)
create or replace function app_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.raw_user_meta_data ->> 'role') in ('athlete', 'coach') then
    insert into app_profiles (user_id, role, code, name, coach_user_id)
    values (
      new.id,
      new.raw_user_meta_data ->> 'role',
      new.raw_user_meta_data ->> 'code',
      new.raw_user_meta_data ->> 'name',
      -- only athletes carry a coach; a coach's coach_user_id stays null
      case when (new.raw_user_meta_data ->> 'role') = 'athlete'
           then nullif(new.raw_user_meta_data ->> 'coach_user_id', '')::uuid
           else null end
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- 3) Athlete sharing table ----------------------------------------------------
create table if not exists app_shared_athletes (
  athlete_user_id uuid not null references auth.users on delete cascade,
  coach_user_id   uuid not null references auth.users on delete cascade, -- the helping coach
  created_at      timestamptz not null default now(),
  primary key (athlete_user_id, coach_user_id)
);
alter table app_shared_athletes enable row level security;

-- 4) Helper predicates (security definer → no RLS recursion) ------------------
-- Is the current user a coach at all? (used to let coaches read all profiles)
create or replace function app_is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_profiles p
                 where p.user_id = auth.uid() and p.role = 'coach');
$$;

-- Can the current user edit this athlete's state? Owner OR a shared coach.
create or replace function app_can_edit(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app_is_coach_of(target)
      or exists (select 1 from app_shared_athletes s
                 where s.athlete_user_id = target and s.coach_user_id = auth.uid());
$$;

-- 5) RLS ----------------------------------------------------------------------
-- Profiles: coaches can read every profile (for the Team/Clients summary + coach
-- switcher). Athletes still read only their own (existing policy untouched).
drop policy if exists profiles_read_coaches on app_profiles;
create policy profiles_read_coaches on app_profiles for select using (app_is_coach());

-- app_state: an athlete's own row, or any coach who OWNS or is SHARED the athlete.
drop policy if exists state_coach on app_state;
create policy state_coach on app_state for all
  using (app_can_edit(user_id)) with check (app_can_edit(user_id));

-- Shares: a coach sees shares that involve them (as owner or as sharee). The
-- owning coach can add/remove a share for their athlete; the sharee can remove
-- their own share (either side can un-toggle).
drop policy if exists shares_read on app_shared_athletes;
create policy shares_read on app_shared_athletes for select using (
  coach_user_id = auth.uid() or app_is_coach_of(athlete_user_id)
);
drop policy if exists shares_write_owner on app_shared_athletes;
create policy shares_write_owner on app_shared_athletes for all
  using (app_is_coach_of(athlete_user_id)) with check (app_is_coach_of(athlete_user_id));
drop policy if exists shares_delete_sharee on app_shared_athletes;
create policy shares_delete_sharee on app_shared_athletes for delete using (
  coach_user_id = auth.uid()
);

-- Realtime so a share / un-share reflects live on the other coach's console.
do $$ begin
  alter publication supabase_realtime add table app_shared_athletes;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6) CREATE THE TWO COACH LOGINS
-- ---------------------------------------------------------------------------
-- Easiest + most reliable: Supabase dashboard → Authentication → Users → "Add
-- user". For EACH coach set the email + a password, tick "Auto Confirm User",
-- and paste this into "User Metadata" (raw JSON) — the trigger above then makes
-- the coach profile automatically:
--
--   Mika :  { "role": "coach", "code": "MIKA",  "name": "Mika Vankerckhove" }
--   Maxim:  { "role": "coach", "code": "MAXIM", "name": "Maxim Stepman" }
--
-- Pick any emails you like (e.g. mika@ssc.app / maxim@ssc.app) — the coach signs
-- in with that email + password.
--
-- If a user already exists WITHOUT a profile, run (per coach):
--   insert into app_profiles (user_id, role, code, name)
--   select id, 'coach', 'MIKA', 'Mika Vankerckhove' from auth.users where email = 'mika@ssc.app'
--   on conflict (user_id) do update set role='coach', code=excluded.code, name=excluded.name;
--
-- Advanced (pure SQL, no dashboard) — creates the auth user too. Needs pgcrypto.
-- Repeat for maxim, changing email/password/code/name:
--   do $$
--   declare uid uuid := gen_random_uuid();
--   begin
--     insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
--       email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
--     values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
--       'mika@ssc.app', crypt('CHOOSE_A_PASSWORD', gen_salt('bf')), now(), now(), now(),
--       '{"provider":"email","providers":["email"]}',
--       '{"role":"coach","code":"MIKA","name":"Mika Vankerckhove"}');
--     insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
--     values ('mika@ssc.app', uid,
--       jsonb_build_object('sub', uid::text, 'email','mika@ssc.app'), 'email', now(), now());
--   end $$;
-- (The trigger fills app_profiles from the metadata; if your Supabase version's
--  auth.identities lacks provider_id, drop that column from the insert.)
