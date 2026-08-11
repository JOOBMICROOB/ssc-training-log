# SSC Training Log

Training-log app for Specific Strength Coaching — coach console + athlete mobile
app, on **Supabase** (managed Postgres, Auth, Realtime, Storage). Frontend is
React + Vite + TypeScript.

This repo currently contains the **data foundation** and the **offline logging +
conflict-safe sync** layer: full schema, multi-coach row-level security +
sharing, server-side strength calculations, and an offline-first sync engine
with atomic merge RPCs — all with tests (unit + real-Postgres integration). The
app shell, Sheet import, PDF export and shop UI are tracked as later slices (see
[Roadmap](#roadmap)).

## Layout

```
supabase/migrations/   ordered SQL — schema, calcs, triggers, RLS, sync RPCs
supabase/seed.sql      auth-independent reference data (exercise library)
supabase/tests/        real-Postgres integration test (pgserver)
src/lib/calc/          e1RM / Wilks / DOTS / IPF-GL / volume / PR — pure + tested
src/lib/sync/          offline-first outbox engine + three-way merge + tests
src/lib/supabase.ts    typed client (persistent sessions, realtime)
src/types/database.ts  DB types (regenerate with `npm run db:types`)
docs/PROVISIONING.md   invite-only account creation
```

## Offline logging & conflict-safe sync (`src/lib/sync/`)

The athlete side is offline-first. Every edit is written to a durable on-device
outbox (IndexedDB) **immediately** — no explicit save, nothing lost on a dropped
connection or locked screen — and pushed to Supabase opportunistically.

Pushes go through atomic upsert RPCs (`ssc_upsert_set_log` /
`ssc_upsert_session_log` / `ssc_upsert_weekly_checkin`, migrations 0012–0013)
that run a single-transaction **compare-and-swap + three-way field merge**:

- edits to **different fields** from two devices auto-merge;
- edits to the **same field** are flagged in `sync_conflicts` with **both values
  preserved** (never silently overwritten or dropped);
- a **set-number collision** (two devices both create "set 1" offline) is
  **renumbered**, not dropped;
- replays are **idempotent** (keyed by `client_uuid`), so a lost response can be
  safely retried.

`src/lib/sync/merge.ts` is a byte-for-byte mirror of the SQL merge rule, so the
optimistic client and the authoritative server agree.

## Running the tests

Three layers, all green:

```bash
npm test                                   # vitest: calc math + sync/merge/engine (31 tests)
npm run typecheck                          # tsc, no errors
pip install pgserver && \
  python supabase/tests/integration_test.py  # applies all migrations to a real
                                             # throwaway Postgres and exercises the
                                             # RPCs, triggers, RLS and guards (16 checks)
```

## Setup

1. **Create a Supabase project** (or use an existing one). Note the project ref,
   URL, and anon key (Settings → API).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and link:
   ```bash
   supabase link --project-ref YOUR-REF
   ```
3. **Apply migrations** (see the safety rule below before doing this against a DB
   that already holds real athlete data):
   ```bash
   supabase db push          # applies supabase/migrations/* in order
   ```
   For a local dev DB: `supabase start` then `supabase db reset` (also runs the seed).
4. **Frontend env**: copy `.env.example` → `.env.local`, fill `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY`.
5. Install & test:
   ```bash
   npm install
   npm test          # runs the calc suite
   ```
6. Regenerate DB types once the schema is live:
   ```bash
   npm run db:types
   ```
7. **Provision accounts**: follow [docs/PROVISIONING.md](docs/PROVISIONING.md)
   (invite the 3 coaches; flag Noa as head coach).

## Data safety — required project settings

These are called out in the brief and are **not** optional:

- **Point-in-time recovery (PITR)**: enable in the Supabase dashboard
  (Database → Backups → Point-in-Time Recovery). Default daily backups are not
  enough — PITR lets a bad write be rolled back to a specific moment.
- **No destructive migrations once real data exists.** Dropping or renaming a
  column/table that holds athlete data requires an explicit backup step first.
  Prefer additive changes (new nullable columns, new tables) and multi-step
  migrations (add → backfill → switch → later remove). This is a **standing
  rule for every future change**, not just the initial build.
- **Phased rollout**: launch with a small group of athletes before all ~30, to
  catch data-affecting bugs (especially offline logging) while the blast radius
  is small.

## Server-side calculations

All strength math is computed **server-side** (Postgres functions + triggers),
so values are consistent regardless of client, and PR detection runs on every
insert including offline-synced sets:

| Calc | SQL | TS mirror (optimistic UI) |
|------|-----|---------------------------|
| e1RM (Epley) | `ssc_epley_e1rm` | `src/lib/calc/epley.ts` |
| Wilks / DOTS / IPF-GL | `ssc_wilks` / `ssc_dots` / `ssc_ipf_gl` | `src/lib/calc/scores.ts` |
| Volume / tonnage | `ssc_session_tonnage`, `ssc_week_tonnage` views | `src/lib/calc/volume.ts` |
| PR detection + bests | `ssc_set_log_derive`, `ssc_maintain_exercise_bests` triggers | `src/lib/calc/pr.ts` |

The SQL and TS coefficient sets are mirrors of each other; `src/lib/calc/calc.test.ts`
pins them to hand-computed reference values so a mistyped coefficient fails CI.

## Permission model (RLS)

- **Per-coach ownership**: a coach sees only their own athletes/programs by default.
- **Opt-in sharing**: `coach_shares` grants another coach edit access to one
  specific athlete or program. Generic `resource_type` so a future **nutrition**
  module shares through the same mechanism without a redesign.
- **Head coach**: no blanket athlete visibility — its one special power is seeing
  **all shop orders** (orders route to the head coach).
- **Athletes**: see only their own data + assigned, published programs.

Full policy definitions: `supabase/migrations/0010_rls.sql`.

## Roadmap

Built:
1. **Data foundation** — schema, multi-coach RLS + sharing, server-side calcs, tests.
2. **Offline logging + conflict-safe sync** — outbox engine, atomic merge RPCs,
   `sync_conflicts` ledger, tests (unit + real-Postgres integration).
3. **Coach dashboard + athlete app + Google-Sheet import + PWA** — a runnable
   React UI matched to the design (deep-navy blueprint aesthetic): roster cards,
   programmed-vs-logged program view, exercise DB panel, Sheet-import review,
   coach-identity + share, in-app notifications; mobile athlete app wired to the
   live sync engine (auto-save + airplane-mode → queue → sync); installable PWA
   (`manifest.webmanifest` + `public/sw.js`). Sheet parser is unit-tested.

Runs against demo data (`src/app/demo.ts`) so it renders with no backend; the
repository layer swaps to Supabase without touching the component tree.

Next slices: wire the UI to Supabase (replace demo data with live queries +
realtime) → notifications persistence → shop orders write path → PDF/week-block
export → phased rollout.

## Viewing the app

```bash
npm run dev            # http://localhost:5173
```

A bottom-left **Coach / Athlete** toggle switches roles (that's a preview aid —
the shipped app routes by signed-in role). Use a mobile viewport for the athlete
app; the "Airplane" button demonstrates offline logging.
