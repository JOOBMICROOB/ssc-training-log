-- 0002_identity.sql
-- Coaches, athletes, athlete bodyweight history.
-- Every coach and athlete row's id IS their auth.users id (1:1 with Supabase Auth).

-- ---------------------------------------------------------------------------
-- Coaches
-- ---------------------------------------------------------------------------
create table coaches (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null,
  email         citext,
  is_head_coach boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- At most one head coach is expected today, but the model does not forbid more.
create index coaches_head_idx on coaches (is_head_coach) where is_head_coach;

create trigger coaches_touch
  before update on coaches
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Athletes
-- ---------------------------------------------------------------------------
create table athletes (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null,
  email            citext,
  -- The coach an athlete "belongs" to. Ownership + default visibility flow
  -- from this; additional coaches gain access only through coach_shares.
  primary_coach_id uuid not null references coaches (id) on delete restrict,
  sex              ssc_sex,               -- needed for Wilks/DOTS/IPF GL
  weight_class     text,                  -- free text, e.g. "-83kg"
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index athletes_primary_coach_idx on athletes (primary_coach_id);

create trigger athletes_touch
  before update on athletes
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Bodyweight log (time series per athlete)
-- ---------------------------------------------------------------------------
create table bodyweight_entries (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references athletes (id) on delete cascade,
  measured_on   date not null default current_date,
  bodyweight_kg numeric(6,2) not null check (bodyweight_kg > 0 and bodyweight_kg < 500),
  note          text,
  created_at    timestamptz not null default now(),
  unique (athlete_id, measured_on)
);

create index bodyweight_athlete_date_idx
  on bodyweight_entries (athlete_id, measured_on desc);
