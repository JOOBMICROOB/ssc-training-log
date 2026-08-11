/**
 * Estimated 1-rep-max (e1RM) via the Epley formula.
 *
 *   e1RM = weight * (1 + reps / 30)
 *
 * A true single (reps === 1) returns the weight unchanged — pure Epley would
 * overestimate a maximal single by ~3.3%, which is misleading to display and
 * would make e1RM PRs disagree with weight PRs for singles. Mirrored
 * server-side in supabase/migrations as ssc_epley_e1rm() — keep both in sync;
 * the DB trigger is the source of truth for stored values, this copy exists
 * only for optimistic client display.
 */
export function epleyE1rm(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return NaN;
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}
