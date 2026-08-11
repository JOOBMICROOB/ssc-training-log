-- 0014_app_state.sql
-- ---------------------------------------------------------------------------
-- Lightweight, schema-free backing store for the live app.
--
-- The app's data services (athleteData / coachProgram / coachData) keep their
-- current JSON shape; this stores each user's blob as `jsonb` so new features
-- never need a migration. localStorage stays the instant/offline cache — these
-- tables are the cross-device source of truth, synced on load + write-through.
--
-- Security model (fits ~50 users with huge headroom):
--   * Every athlete and coach is a Supabase Auth user (auth.users).
--   * app_profiles says who is who and which coach owns which athlete.
--   * RLS: an athlete sees only their own row; a coach also sees their athletes'
--     rows (so publishing a program / reading logs works). Nobody else.
-- Run this one file in the Supabase SQL editor for the lightweight setup.
-- ---------------------------------------------------------------------------

-- Who is who ----------------------------------------------------------------
create table if not exists app_profiles (
  user_id       uuid primary key references auth.users on delete cascade,
  role          text not null check (role in ('athlete', 'coach')),
  code          text unique,                 -- athlete login code (e.g. RS1203) / coach handle
  name          text,
  coach_user_id uuid references auth.users on delete set null, -- an athlete's coach
  created_at    timestamptz not null default now()
);

-- Per-user state blob (athlete DashboardData, or a coach's console state) -----
create table if not exists app_state (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Catalogues both sides share (exercise DB, competition list, shop products) --
create table if not exists app_shared (
  key        text primary key,               -- 'exercises' | 'competitions' | 'shop'
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- touch updated_at -----------------------------------------------------------
create or replace function app_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_state_touch on app_state;
create trigger app_state_touch before update on app_state
  for each row execute function app_touch_updated_at();
drop trigger if exists app_shared_touch on app_shared;
create trigger app_shared_touch before update on app_shared
  for each row execute function app_touch_updated_at();

-- "is the current user the coach of <target athlete>?" ------------------------
create or replace function app_is_coach_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_profiles p
    where p.user_id = target and p.coach_user_id = auth.uid()
  );
$$;

-- Row-level security ---------------------------------------------------------
alter table app_profiles enable row level security;
alter table app_state    enable row level security;
alter table app_shared   enable row level security;

-- profiles: read your own + (coach) your athletes'; write only your own.
create policy profiles_read_self  on app_profiles for select using (user_id = auth.uid());
create policy profiles_read_coach on app_profiles for select using (coach_user_id = auth.uid());
create policy profiles_write_self on app_profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- state: your own, and (coach) your athletes'.
create policy state_self  on app_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy state_coach on app_state for all
  using (app_is_coach_of(user_id)) with check (app_is_coach_of(user_id));

-- shared catalogues: any signed-in user reads; only coaches write.
create policy shared_read  on app_shared for select using (auth.uid() is not null);
create policy shared_write on app_shared for all
  using (exists (select 1 from app_profiles p where p.user_id = auth.uid() and p.role = 'coach'))
  with check (exists (select 1 from app_profiles p where p.user_id = auth.uid() and p.role = 'coach'));

-- Realtime so a coach's publish shows on the athlete's device live -----------
alter publication supabase_realtime add table app_state;
