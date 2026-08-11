-- 0004_logging.sql
-- What the athlete actually did: per-set logs, session-level logs, weekly check-ins.

-- ---------------------------------------------------------------------------
-- Per-set logs. Result is stored per individual set (not one number per
-- exercise). e1rm, pr flags, exercise_ref and the soft-validation warning are
-- all derived server-side by triggers (see 0009) — clients never write them.
--
-- Offline support: client_uuid is a client-generated idempotency key so a set
-- logged offline and later synced upserts to the same row instead of
-- duplicating. version + updated_at back the conflict handling built in the
-- offline-sync slice.
-- ---------------------------------------------------------------------------
create table set_logs (
  id              uuid primary key default gen_random_uuid(),
  exercise_row_id uuid not null references exercise_rows (id) on delete cascade,
  athlete_id      uuid not null references athletes (id) on delete cascade,

  set_number      int not null check (set_number >= 1),
  weight_kg       numeric(7,2) check (weight_kg is null or weight_kg >= 0),
  reps            int check (reps is null or reps >= 0),
  rpe             numeric(3,1) check (rpe is null or (rpe >= 0 and rpe <= 10)),
  velocity        numeric(5,3),                 -- m/s, optional (VBT)
  notes           text,

  -- Derived (trigger-maintained; see ssc_set_log_derive in 0009).
  e1rm            numeric(8,2),
  is_weight_pr    boolean not null default false,
  is_e1rm_pr      boolean not null default false,
  -- Stable exercise identity for PR history: library id when present, else the
  -- normalized free-text name. Denormalized from the row at write time.
  exercise_ref    text,
  -- Non-blocking soft-validation message ("implausible weight"), or NULL.
  warning         text,

  -- Offline / sync bookkeeping.
  client_uuid     uuid,                          -- idempotency key from the device
  device_id       text,
  version         int not null default 1,

  logged_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (exercise_row_id, set_number),
  -- Idempotent offline upsert target (only when the client supplied a key).
  unique (athlete_id, client_uuid)
);

create index set_logs_athlete_idx on set_logs (athlete_id);
create index set_logs_row_idx on set_logs (exercise_row_id);
create index set_logs_prhist_idx on set_logs (athlete_id, exercise_ref);

-- ---------------------------------------------------------------------------
-- Session-level logs: pain rating + session RPE for a performed session.
-- ---------------------------------------------------------------------------
create table session_logs (
  id                 uuid primary key default gen_random_uuid(),
  program_session_id uuid not null references program_sessions (id) on delete cascade,
  athlete_id         uuid not null references athletes (id) on delete cascade,
  pain_rating        smallint check (pain_rating is null or (pain_rating between 0 and 10)),
  session_rpe        numeric(3,1) check (session_rpe is null or (session_rpe between 0 and 10)),
  notes              text,
  client_uuid        uuid,
  version            int not null default 1,
  logged_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (program_session_id, athlete_id),
  unique (athlete_id, client_uuid)
);

create index session_logs_athlete_idx on session_logs (athlete_id);

create trigger session_logs_touch
  before update on session_logs
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Weekly check-in: seven 1–10 subjective scores + free text.
-- program_week_id is optional (a check-in can exist outside a program week).
-- ---------------------------------------------------------------------------
create table weekly_checkins (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references athletes (id) on delete cascade,
  program_week_id uuid references program_weeks (id) on delete set null,
  week_start      date not null,
  training        smallint check (training between 1 and 10),
  sleep           smallint check (sleep between 1 and 10),
  nutrition       smallint check (nutrition between 1 and 10),
  stress          smallint check (stress between 1 and 10),
  overall_feeling smallint check (overall_feeling between 1 and 10),
  motivation      smallint check (motivation between 1 and 10),
  pain_aches      smallint check (pain_aches between 1 and 10),
  notes           text,
  client_uuid     uuid,                          -- offline idempotency key
  version         int not null default 1,        -- optimistic-concurrency counter
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (athlete_id, week_start),
  unique (athlete_id, client_uuid)
);

create index weekly_checkins_athlete_idx on weekly_checkins (athlete_id, week_start desc);

create trigger weekly_checkins_touch
  before update on weekly_checkins
  for each row execute function ssc_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Per-athlete, per-exercise best records. Maintained by the PR trigger; read
-- by clients for the "current best" display and used for PR comparison.
-- ---------------------------------------------------------------------------
create table exercise_bests (
  athlete_id          uuid not null references athletes (id) on delete cascade,
  exercise_ref        text not null,
  exercise_name       text not null,
  best_weight_kg      numeric(7,2),
  best_weight_set_id  uuid references set_logs (id) on delete set null,
  best_weight_at      timestamptz,
  best_e1rm           numeric(8,2),
  best_e1rm_set_id    uuid references set_logs (id) on delete set null,
  best_e1rm_at        timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (athlete_id, exercise_ref)
);
