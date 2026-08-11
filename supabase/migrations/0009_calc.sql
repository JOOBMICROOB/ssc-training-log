-- 0009_calc.sql
-- Server-side strength calculations + derivation triggers.
-- Coefficients mirror src/lib/calc/scores.ts 1:1 (verified against reference
-- values in src/lib/calc/calc.test.ts). Keep the two in sync.

-- ---- e1RM (Epley) ---------------------------------------------------------
create or replace function ssc_epley_e1rm(weight_kg numeric, reps int)
returns numeric
language sql
immutable
as $$
  select case
    when weight_kg is null or reps is null or weight_kg <= 0 or reps <= 0 then 0
    when reps = 1 then round(weight_kg, 2)          -- a true single reads as its weight
    else round(weight_kg * (1 + reps::numeric / 30), 2)
  end;
$$;

-- ---- Wilks (classic) ------------------------------------------------------
create or replace function ssc_wilks(sex ssc_sex, bodyweight_kg numeric, total_kg numeric)
returns numeric
language sql
immutable
as $$
  select case
    when bodyweight_kg <= 0 or total_kg <= 0 then 0
    else round(
      (500 / (
        case sex
          when 'male' then
            -216.0475144 + 16.2606339*bodyweight_kg - 0.002388645*power(bodyweight_kg,2)
            - 0.00113732*power(bodyweight_kg,3) + 7.01863e-6*power(bodyweight_kg,4)
            - 1.291e-8*power(bodyweight_kg,5)
          else
            594.31747775582 - 27.23842536447*bodyweight_kg + 0.82112226871*power(bodyweight_kg,2)
            - 0.00930733913*power(bodyweight_kg,3) + 4.731582e-5*power(bodyweight_kg,4)
            - 9.054e-8*power(bodyweight_kg,5)
        end
      )) * total_kg, 2)
  end;
$$;

-- ---- DOTS -----------------------------------------------------------------
create or replace function ssc_dots(sex ssc_sex, bodyweight_kg numeric, total_kg numeric)
returns numeric
language sql
immutable
as $$
  with clamped as (
    select least(greatest(bodyweight_kg,
             40),
             case sex when 'male' then 210 else 150 end) as bw
  )
  select case
    when bodyweight_kg <= 0 or total_kg <= 0 then 0
    else round(
      (500 * total_kg) / (
        case sex
          when 'male' then
            -307.75076 + 24.0900756*bw - 0.1918759221*power(bw,2)
            + 0.0007391293*power(bw,3) - 0.000001093705*power(bw,4)
          else
            -57.96288 + 13.6175032*bw - 0.1126655495*power(bw,2)
            + 0.0005158568*power(bw,3) - 0.0000010706*power(bw,4)
        end
      ), 2)
  end
  from clamped;
$$;

-- ---- IPF GL points --------------------------------------------------------
-- event: 'raw_full' (default), 'raw_bench', 'equipped_full', 'equipped_bench'.
create or replace function ssc_ipf_gl(
  sex ssc_sex, bodyweight_kg numeric, total_kg numeric, event text default 'raw_full')
returns numeric
language plpgsql
immutable
as $$
declare
  a numeric; b numeric; c numeric; denom numeric;
begin
  if bodyweight_kg <= 0 or total_kg <= 0 then return 0; end if;
  if sex = 'male' then
    case event
      when 'raw_full'      then a:=1199.72839; b:=1025.18162; c:=0.00921;
      when 'raw_bench'     then a:=320.98041;  b:=281.40258;  c:=0.01008;
      when 'equipped_full' then a:=1236.25115; b:=1449.21864; c:=0.01644;
      when 'equipped_bench'then a:=381.22073;  b:=733.79378;  c:=0.02398;
      else raise exception 'unknown ipf event %', event;
    end case;
  else
    case event
      when 'raw_full'      then a:=610.32796;  b:=1045.59282; c:=0.03048;
      when 'raw_bench'     then a:=142.40398;  b:=442.52671;  c:=0.04724;
      when 'equipped_full' then a:=758.63878;  b:=949.31382;  c:=0.02435;
      when 'equipped_bench'then a:=221.82209;  b:=357.00377;  c:=0.02937;
      else raise exception 'unknown ipf event %', event;
    end case;
  end if;
  denom := a - b * exp(-c * bodyweight_kg);
  if denom <= 0 then return 0; end if;
  return round((100 * total_kg) / denom, 2);
end;
$$;

-- ---------------------------------------------------------------------------
-- BEFORE trigger on set_logs: derive exercise_ref, e1rm, PR flags, warning.
-- PR flags compare against the athlete's *other* sets for the same exercise,
-- so offline-synced sets are judged server-side regardless of client state.
-- ---------------------------------------------------------------------------
create or replace function ssc_set_log_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ex_id   uuid;
  ex_name citext;
  prior_best_weight numeric;
  prior_best_e1rm   numeric;
begin
  select exercise_id, exercise_name into ex_id, ex_name
  from exercise_rows where id = new.exercise_row_id;

  new.exercise_ref := case
    when ex_id is not null then 'e:' || ex_id::text
    else 'n:' || lower(trim(ex_name::text))
  end;

  new.e1rm := ssc_epley_e1rm(new.weight_kg, new.reps);

  -- Prior bests among the athlete's other sets for this exercise.
  select max(weight_kg), max(e1rm)
    into prior_best_weight, prior_best_e1rm
  from set_logs
  where athlete_id = new.athlete_id
    and exercise_ref = new.exercise_ref
    and id <> new.id;

  new.is_weight_pr := new.weight_kg is not null and new.weight_kg > 0
    and (prior_best_weight is null or new.weight_kg > prior_best_weight);
  new.is_e1rm_pr := new.e1rm is not null and new.e1rm > 0
    and (prior_best_e1rm is null or new.e1rm > prior_best_e1rm);

  -- Soft validation: warn, never block.
  new.warning := null;
  if new.weight_kg is not null and new.weight_kg > 500 then
    new.warning := 'Implausible weight (>500 kg) — please double-check.';
  elsif new.weight_kg is not null and prior_best_weight is not null
        and prior_best_weight > 0 and new.weight_kg > prior_best_weight * 2 then
    new.warning := 'More than double previous best — please double-check.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger set_logs_derive
  before insert or update on set_logs
  for each row execute function ssc_set_log_derive();

-- ---------------------------------------------------------------------------
-- AFTER trigger: keep exercise_bests current for the affected (athlete, ref).
-- Recomputes from the live rows so inserts, edits and deletes all stay correct.
-- ---------------------------------------------------------------------------
create or replace function ssc_maintain_exercise_bests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a_id uuid;
  ref  text;
  bw   record;   -- best by weight
  be   record;   -- best by e1rm
  ename text;
begin
  a_id := coalesce(new.athlete_id, old.athlete_id);
  ref  := coalesce(new.exercise_ref, old.exercise_ref);
  if ref is null then return coalesce(new, old); end if;

  select id, weight_kg, logged_at into bw
  from set_logs
  where athlete_id = a_id and exercise_ref = ref and weight_kg is not null and weight_kg > 0
  order by weight_kg desc, logged_at desc
  limit 1;

  select id, e1rm, logged_at into be
  from set_logs
  where athlete_id = a_id and exercise_ref = ref and e1rm is not null and e1rm > 0
  order by e1rm desc, logged_at desc
  limit 1;

  if bw.id is null and be.id is null then
    delete from exercise_bests where athlete_id = a_id and exercise_ref = ref;
    return coalesce(new, old);
  end if;

  -- Human-readable name for the bests row.
  select case when ref like 'e:%'
      then (select name::text from exercises where 'e:' || id::text = ref)
      else substring(ref from 3)
    end into ename;

  insert into exercise_bests as eb (
    athlete_id, exercise_ref, exercise_name,
    best_weight_kg, best_weight_set_id, best_weight_at,
    best_e1rm, best_e1rm_set_id, best_e1rm_at, updated_at)
  values (
    a_id, ref, coalesce(ename, substring(ref from 3)),
    bw.weight_kg, bw.id, bw.logged_at,
    be.e1rm, be.id, be.logged_at, now())
  on conflict (athlete_id, exercise_ref) do update set
    best_weight_kg = excluded.best_weight_kg,
    best_weight_set_id = excluded.best_weight_set_id,
    best_weight_at = excluded.best_weight_at,
    best_e1rm = excluded.best_e1rm,
    best_e1rm_set_id = excluded.best_e1rm_set_id,
    best_e1rm_at = excluded.best_e1rm_at,
    exercise_name = excluded.exercise_name,
    updated_at = now();

  return coalesce(new, old);
end;
$$;

create trigger set_logs_maintain_bests
  after insert or update or delete on set_logs
  for each row execute function ssc_maintain_exercise_bests();

-- ---------------------------------------------------------------------------
-- Volume / tonnage aggregation views (set -> session -> week -> block).
-- ---------------------------------------------------------------------------
create or replace view ssc_session_tonnage as
select
  ps.id                              as program_session_id,
  sl.athlete_id,
  count(*)                           as logged_sets,
  sum(coalesce(sl.reps, 0))          as total_reps,
  sum(coalesce(sl.reps, 0) * coalesce(sl.weight_kg, 0)) as tonnage_kg
from set_logs sl
join exercise_rows er on er.id = sl.exercise_row_id
join program_sessions ps on ps.id = er.session_id
group by ps.id, sl.athlete_id;

create or replace view ssc_week_tonnage as
select
  pw.id                              as program_week_id,
  pw.program_id,
  sl.athlete_id,
  sum(coalesce(sl.reps, 0) * coalesce(sl.weight_kg, 0)) as tonnage_kg,
  sum(coalesce(sl.reps, 0))          as total_reps
from set_logs sl
join exercise_rows er on er.id = sl.exercise_row_id
join program_sessions ps on ps.id = er.session_id
join program_weeks pw on pw.id = ps.week_id
group by pw.id, pw.program_id, sl.athlete_id;
