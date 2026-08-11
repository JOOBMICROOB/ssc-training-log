/**
 * Volume / tonnage aggregation.
 *
 * Tonnage for a single set = reps * weight. Aggregations (session / week /
 * block) are plain sums of their sets. Kept as a pure reducer so the same
 * code path serves optimistic client totals and can be validated against the
 * SQL aggregate (ssc_session_tonnage view) in the DB.
 */
export interface SetLike {
  reps: number;
  weightKg: number;
}

export function setTonnage(set: SetLike): number {
  if (set.reps <= 0 || set.weightKg <= 0) return 0;
  return set.reps * set.weightKg;
}

export function totalTonnage(sets: SetLike[]): number {
  return sets.reduce((sum, s) => sum + setTonnage(s), 0);
}

/** Total reps performed across sets (a.k.a. volume by reps). */
export function totalReps(sets: SetLike[]): number {
  return sets.reduce((sum, s) => sum + (s.reps > 0 ? s.reps : 0), 0);
}
