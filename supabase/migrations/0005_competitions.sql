-- 0005_competitions.sql
-- Competitions + per-athlete opt-in status.

create table competitions (
  id             uuid primary key default gen_random_uuid(),
  -- NULL owner => visible to all coaches/athletes (a shared meet calendar);
  -- set owner => created and owned by that coach.
  owner_coach_id uuid references coaches (id) on delete set null,
  name           text not null,
  comp_date      date not null,
  location       text,
  level          ssc_competition_level not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index competitions_date_idx on competitions (comp_date);

create trigger competitions_touch
  before update on competitions
  for each row execute function ssc_touch_updated_at();

create table competition_entries (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  athlete_id     uuid not null references athletes (id) on delete cascade,
  status         ssc_competition_status not null default 'invited',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (competition_id, athlete_id)
);

create index competition_entries_athlete_idx on competition_entries (athlete_id);

create trigger competition_entries_touch
  before update on competition_entries
  for each row execute function ssc_touch_updated_at();
