/** Per-athlete, per-meet attempt plans (coach-side). */
export type LiftKey = "squat" | "bench" | "deadlift";
export type Attempt = { opener: number; second: number; third: number };
export type AttemptPlan = { rm: Record<LiftKey, number>; attempts: Record<LiftKey, Attempt> };

const key = (athleteId: string) => `ssc.coach.attempts.${athleteId}`;
const r2 = (n: number) => Math.round(n / 2.5) * 2.5;

function loadAll(athleteId: string): Record<string, AttemptPlan> {
  try {
    return JSON.parse(localStorage.getItem(key(athleteId)) || "{}");
  } catch {
    return {};
  }
}

/** Stored plan for a meet, or a sensible default seeded from the current 1RMs. */
export function getPlan(athleteId: string, compId: string, rm: Record<LiftKey, number>): AttemptPlan {
  const stored = loadAll(athleteId)[compId];
  if (stored) return stored;
  const mk = (m: number): Attempt => ({ opener: r2(m * 0.9), second: r2(m * 0.96), third: r2(m * 1.01) });
  return { rm, attempts: { squat: mk(rm.squat), bench: mk(rm.bench), deadlift: mk(rm.deadlift) } };
}

export function savePlan(athleteId: string, compId: string, plan: AttemptPlan) {
  const all = loadAll(athleteId);
  all[compId] = plan;
  try {
    localStorage.setItem(key(athleteId), JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
