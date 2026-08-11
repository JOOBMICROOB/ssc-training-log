"""
End-to-end backend integration test on a REAL, throwaway PostgreSQL.

Applies every migration and exercises the plpgsql RPCs, triggers and RLS that
SQL-grammar linting and the vitest suite can't reach: offline-sync merge +
conflict preservation, e1RM/PR triggers, per-coach RLS isolation, soft
validation, the scoring functions, and the reassign guard.

Run:  pip install pgserver && python supabase/tests/integration_test.py

Notes: the embedded PG has no contrib, so this shims `citext` as a text domain
and skips `create extension` (production Supabase has real citext + pgcrypto;
gen_random_uuid is native in PG16). This is a test-env accommodation only.
"""
import pgserver, tempfile, pathlib, sys, re

REPO = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "supabase" / "migrations"
SEED = REPO / "supabase" / "seed.sql"

dd = tempfile.mkdtemp(prefix="sscpg-")
db = pgserver.get_server(dd)

def run(sql):
    return db.psql(sql)

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (("  -> " + str(extra)[:160]) if extra else ""))
    if not cond: fails.append(name)

# 1. Bootstrap a Supabase-like environment. NOTE: the embedded PG lacks contrib,
#    so this shims citext as a text domain and gen_random_uuid is native (PG16).
#    Production Supabase has real citext + pgcrypto. Test-only accommodation.
run("""
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_type where typname='citext') then
    create domain citext as text;
  end if;
end $$;
""")

# 2. Apply migrations (neutralizing create-extension lines for the test env).
ext_re = re.compile(r'(?im)^\s*create\s+extension\b.*;')
migdir = MIGRATIONS
for f in sorted(migdir.glob("*.sql")):
    run(ext_re.sub("select 1;", f.read_text()))

tbls = run("select count(*) from information_schema.tables where table_schema='public';")
n = int(re.search(r'\d+', tbls.split('\n')[2]).group())
check(f"migrations created the schema ({n} public tables)", n >= 18, tbls.replace("\n"," "))
if n < 18:
    print("Aborting — schema incomplete."); sys.exit(1)

run(ext_re.sub("select 1;", SEED.read_text()))
run("""
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
""")

# 3. Seed identities + a published program (superuser => RLS bypassed).
run("""
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','noa@x'),
 ('22222222-2222-2222-2222-222222222222','maxim@x'),
 ('33333333-3333-3333-3333-333333333333','ath@x');
insert into coaches(id,full_name,is_head_coach) values
 ('11111111-1111-1111-1111-111111111111','Noa',true),
 ('22222222-2222-2222-2222-222222222222','Maxim',false);
insert into athletes(id,full_name,primary_coach_id,sex,weight_class) values
 ('33333333-3333-3333-3333-333333333333','Ath','11111111-1111-1111-1111-111111111111','male','-83kg');
insert into exercises(id,owner_coach_id,name,category) values
 ('aaaaaaaa-0000-0000-0000-000000000009',null,'Test Squat','Squat');
insert into programs(id,owner_coach_id,athlete_id,name,status,published_at) values
 ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333','Block 1','published',now());
insert into program_weeks(id,program_id,week_number) values
 ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1);
insert into program_sessions(id,week_id,session_order,name) values
 ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',1,'Session A');
insert into exercise_rows(id,session_id,row_order,exercise_id,exercise_name,target_sets,target_reps) values
 ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',1,
  'aaaaaaaa-0000-0000-0000-000000000009','Test Squat',3,5);
""")

ATH = "33333333-3333-3333-3333-333333333333"
ROW = "eeeeeeee-0000-0000-0000-000000000001"

def as_athlete(sql):
    return run(f"set role authenticated; select set_config('request.jwt.claim.sub','{ATH}',false);\n{sql}")

# 4a. Publish notification trigger.
out = run("select count(*) from notifications where type='program_published';")
check("publish notification created", "1" in out.split("\n")[2], out.replace("\n"," "))

# 4b. Insert a set via the RPC -> derived e1RM + PR + bests.
out = as_athlete(f"""select ssc_upsert_set_log('{{
  "client_uuid":"f0000000-0000-0000-0000-000000000001",
  "exercise_row_id":"{ROW}","set_number":1,"device_id":"phoneA",
  "base_version":null,"base":null,
  "patch":{{"weight_kg":100,"reps":5,"rpe":8,"set_number":1}} }}'::jsonb)->>'status';""")
check("RPC insert returns 'inserted'", "inserted" in out)
out = run("select e1rm, is_e1rm_pr, is_weight_pr, warning from set_logs where set_number=1;")
check("e1RM computed by trigger (116.67)", "116.67" in out, out.replace("\n"," "))
check("first set flagged PR (e1rm + weight)", out.count(" t ") >= 2 or out.count("| t") >= 2, out.replace("\n"," "))
out = run("select best_e1rm, best_weight_kg from exercise_bests;")
check("exercise_bests maintained", "116.67" in out and "100.00" in out, out.replace("\n"," "))

# 4c. Concurrent same-field edit -> merge + conflict, both values preserved.
run("update set_logs set weight_kg=110, version=version+1 where set_number=1;")
out = as_athlete(f"""select ssc_upsert_set_log('{{
  "client_uuid":"f0000000-0000-0000-0000-000000000001",
  "exercise_row_id":"{ROW}","set_number":1,"device_id":"phoneA",
  "base_version":1,"base":{{"weight_kg":100,"reps":5,"rpe":8,"set_number":1}},
  "patch":{{"weight_kg":105,"reps":5,"rpe":8,"set_number":1}} }}'::jsonb)->>'status';""")
check("concurrent same-field edit returns 'merged'", "merged" in out)
out = run("select weight_kg, version from set_logs where set_number=1;")
check("incoming write wins row (105), version=3", "105.00" in out and "3" in out.split("\n")[2], out.replace("\n"," "))
out = run("select field, local_value, remote_value from sync_conflicts;")
check("conflict preserved both values (local 105 / remote 110)",
      "weight_kg" in out and "105" in out and "110" in out, out.replace("\n"," "))

# 4d. Set-number collision -> renumbered, nothing dropped.
out = as_athlete(f"""select ssc_upsert_set_log('{{
  "client_uuid":"f0000000-0000-0000-0000-000000000002",
  "exercise_row_id":"{ROW}","set_number":1,"device_id":"phoneB",
  "base_version":null,"base":null,
  "patch":{{"weight_kg":102,"reps":5,"set_number":1}} }}'::jsonb)->>'status';""")
check("set-number collision returns 'renumbered'", "renumbered" in out)
out = run("select count(*) from set_logs;")
check("both sets survived", "2" in out.split("\n")[2], out.replace("\n"," "))

# 4e. Disjoint-field concurrent edit -> auto-merge, NO conflict.
run("""insert into set_logs(id,exercise_row_id,athlete_id,set_number,weight_kg,reps,client_uuid,version)
       values('99999999-0000-0000-0000-000000000001','"""+ROW+"""','"""+ATH+"""',9,100,5,
              'f0000000-0000-0000-0000-000000000010',1);""")
run("update set_logs set reps=3, version=version+1 where set_number=9;")  # other device changed reps
before = run("select count(*) from sync_conflicts;")
out = as_athlete(f"""select ssc_upsert_set_log('{{
  "client_uuid":"f0000000-0000-0000-0000-000000000010",
  "exercise_row_id":"{ROW}","set_number":9,"device_id":"phoneA",
  "base_version":1,"base":{{"weight_kg":100,"reps":5,"set_number":9}},
  "patch":{{"weight_kg":105,"reps":5,"set_number":9}} }}'::jsonb)->>'status';""")
after = run("select weight_kg, reps from set_logs where set_number=9;")
cc = run("select count(*) from sync_conflicts;")
check("disjoint edits auto-merge (weight 105 + reps 3), no new conflict",
      "105.00" in after and "3" in after.split("\n")[2] and before.split("\n")[2]==cc.split("\n")[2],
      "row="+after.replace("\n"," "))

# 5. RLS: Maxim (other coach) cannot see this athlete or logs.
out = run("""set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select (select count(*) from athletes) as a, (select count(*) from set_logs) as s;""")
row = [l for l in out.split("\n") if "|" in l and "a" not in l]
check("RLS hides other coach's athletes + logs (0 | 0)", "0 |" in out and out.count("0")>=2, out.replace("\n"," "))

# 6. Soft validation warns, does not reject.
out = as_athlete(f"""select ssc_upsert_set_log('{{
  "client_uuid":"f0000000-0000-0000-0000-000000000003",
  "exercise_row_id":"{ROW}","set_number":5,"device_id":"phoneA",
  "base_version":null,"base":null,
  "patch":{{"weight_kg":600,"reps":1,"set_number":5}} }}'::jsonb)->>'status';""")
out = run("select warning from set_logs where weight_kg=600;")
check("soft-validation warns on implausible weight (accepted)", "Implausible" in out, out.replace("\n"," "))

# 7. Score functions.
out = run("select ssc_wilks('male',100,600) w, ssc_dots('male',100,600) d, ssc_ipf_gl('male',100,600) g;")
check("score functions match reference (365 / 369 / 75)",
      "365" in out and "369" in out and "75" in out, out.replace("\n"," "))

# 8. Athlete-reassign guard — detect by effect (NOTICEs aren't captured here).
run("""set role authenticated; select set_config('request.jwt.claim.sub','"""+ATH+"""',false);
update athletes set primary_coach_id='22222222-2222-2222-2222-222222222222' where id='"""+ATH+"""';""")
out = run("reset role; select primary_coach_id from athletes where id='"+ATH+"';")
check("athlete cannot reassign self to another coach (row unchanged)",
      "11111111" in out and "22222222" not in out, out.replace("\n"," "))

print()
if fails:
    print("FAILURES:", fails); sys.exit(1)
print("ALL DB INTEGRATION CHECKS PASSED")
