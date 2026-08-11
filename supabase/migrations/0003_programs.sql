-- 0003_programs.sql
-- Exercise library + the Program -> Week -> Session -> Exercise-row hierarchy.

-- ---------------------------------------------------------------------------
-- Exercise library (the "exercise database" panel).
-- owner_coach_id NULL  => global/shared exercise available to everyone.
-- owner_coach_id set   => private to that coach.
-- ---------------------------------------------------------------------------
create table exercises (
  id             uuid primary key default gen_random_uuid(),
  owner_coach_id uuid references coaches (id) on delete cascade,
  name           citext not null,
  category       text,                     -- e.g. "Squat", "Bench", "Accessory"
  is_global      boolean generated always as (owner_coach_id is null) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Unique per owner (global exercises share a namespace via the null-owner index).
create unique index exercises_owner_name_idx
  on exercises (coalesce(owner_coach_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index exercises_category_idx on exercises (category);

create trigger exercises_touch
  before update on exercises
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Programs
-- ---------------------------------------------------------------------------
create table programs (
  id             uuid primary key default gen_random_uuid(),
  owner_coach_id uuid not null references coaches (id) on delete restrict,
  -- Assigned athlete. NULL while the program is a draft template.
  athlete_id     uuid references athletes (id) on delete set null,
  name           text not null,
  status         ssc_program_status not null default 'draft',
  notes          text,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index programs_owner_idx on programs (owner_coach_id);
create index programs_athlete_idx on programs (athlete_id);

create trigger programs_touch
  before update on programs
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Weeks
-- ---------------------------------------------------------------------------
create table program_weeks (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references programs (id) on delete cascade,
  week_number int not null check (week_number >= 1),
  label       text,
  created_at  timestamptz not null default now(),
  unique (program_id, week_number)
);

create index program_weeks_program_idx on program_weeks (program_id);

-- ---------------------------------------------------------------------------
-- Sessions
-- assigned_day + rest_days_after support the "reflow the week" fluency asks;
-- session_order gives a stable, renumber-free ordering the UI drags against.
-- ---------------------------------------------------------------------------
create table program_sessions (
  id              uuid primary key default gen_random_uuid(),
  week_id         uuid not null references program_weeks (id) on delete cascade,
  session_order   int not null,               -- ordinal within the week
  name            text,                        -- e.g. "Session A"
  assigned_day    ssc_weekday,                 -- optional explicit weekday
  rest_days_after int not null default 0 check (rest_days_after >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (week_id, session_order) deferrable initially deferred
);

create index program_sessions_week_idx on program_sessions (week_id);

create trigger program_sessions_touch
  before update on program_sessions
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Exercise rows (the prescription lines within a session)
-- exercise_id references the library when picked from it; exercise_name is
-- always stored (denormalized) so imports/free-text and renamed library
-- entries stay intact. intensity is (type, value): rpe 8 / percent 80 /
-- relative +5 (kg offset from a reference).
-- ---------------------------------------------------------------------------
create table exercise_rows (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references program_sessions (id) on delete cascade,
  row_order      int not null,
  exercise_id    uuid references exercises (id) on delete set null,
  exercise_name  citext not null,
  coach_note     text,                         -- cue / note
  target_sets    int check (target_sets is null or target_sets >= 0),
  target_reps    int check (target_reps is null or target_reps >= 0),
  intensity_type ssc_intensity_type,
  intensity_value numeric(6,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, row_order) deferrable initially deferred
);

create index exercise_rows_session_idx on exercise_rows (session_id);

create trigger exercise_rows_touch
  before update on exercise_rows
  for each row execute function ssc_touch_updated_at();
