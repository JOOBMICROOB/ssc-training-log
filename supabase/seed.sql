-- seed.sql — safe, auth-independent seed data (runs on `supabase db reset`).
-- Coach/athlete rows are NOT seeded here: they map 1:1 to auth.users and are
-- created through the invite flow (see docs/PROVISIONING.md). Below is only
-- reference data that has no auth dependency.

-- Global exercise library (owner_coach_id NULL => visible to every coach).
insert into exercises (owner_coach_id, name, category) values
  (null, 'Back Squat',        'Squat'),
  (null, 'Front Squat',       'Squat'),
  (null, 'Competition Bench', 'Bench'),
  (null, 'Close-Grip Bench',  'Bench'),
  (null, 'Conventional Deadlift', 'Deadlift'),
  (null, 'Sumo Deadlift',     'Deadlift'),
  (null, 'Romanian Deadlift', 'Accessory'),
  (null, 'Overhead Press',    'Accessory'),
  (null, 'Barbell Row',       'Accessory'),
  (null, 'Pull-up',           'Accessory')
on conflict do nothing;
