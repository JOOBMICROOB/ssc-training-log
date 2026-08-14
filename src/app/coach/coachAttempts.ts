/** Per-athlete, per-meet attempt plans (coach-side, meet-day live tracking). */
export type LiftKey = "squat" | "bench" | "deadlift";
export type Which = "opener" | "second" | "third";
export type Attempt = { opener: number; second: number; third: number };
export type AttemptStatus = "pending" | "hit" | "miss";
export type AttemptStatuses = { opener: AttemptStatus; second: AttemptStatus; third: AttemptStatus };
export type Goals = { placement: string; total: number; gl: number };
export type AttemptPlan = {
  rm: Record<LiftKey, number>;
  attempts: Record<LiftKey, Attempt>;
  spread: number; // ± kg for the low / high ends around each planned attempt
  goals: Goals; // coach-written targets
  warmups: Record<LiftKey, string>; // custom override; "" = auto from the opener
  status: Record<LiftKey, AttemptStatuses>; // meet-day: hit / miss per attempt
  rivalId: string; // athlete to compare GL against ("" = none)
};

const key = (athleteId: string) => `ssc.coach.attempts.${athleteId}`;
const r2 = (n: number) => Math.round(n / 2.5) * 2.5;
const zeroStatus = (): AttemptStatuses => ({ opener: "pending", second: "pending", third: "pending" });

function loadAll(athleteId: string): Record<string, Partial<AttemptPlan>> {
  try {
    return JSON.parse(localStorage.getItem(key(athleteId)) || "{}");
  } catch {
    return {};
  }
}

function seededAttempts(rm: Record<LiftKey, number>): Record<LiftKey, Attempt> {
  const mk = (m: number): Attempt => ({ opener: r2(m * 0.9), second: r2(m * 0.96), third: r2(m * 1.01) });
  return { squat: mk(rm.squat), bench: mk(rm.bench), deadlift: mk(rm.deadlift) };
}

/** Stored plan for a meet (with any newer fields backfilled), or a fresh seed. */
export function getPlan(athleteId: string, compId: string, rm: Record<LiftKey, number>): AttemptPlan {
  const s = loadAll(athleteId)[compId] ?? {};
  return {
    rm: s.rm ?? rm,
    attempts: s.attempts ?? seededAttempts(s.rm ?? rm),
    spread: s.spread ?? 2.5,
    goals: s.goals ?? { placement: "", total: 0, gl: 0 },
    warmups: s.warmups ?? { squat: "", bench: "", deadlift: "" },
    status: s.status ?? { squat: zeroStatus(), bench: zeroStatus(), deadlift: zeroStatus() },
    rivalId: s.rivalId ?? "",
  };
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

/**
 * Warm-up ladder up to (but not including) an attempt. Empty bar, then +50 kg
 * jumps while there's room, then one smaller final ~15 kg under the attempt —
 * e.g. 235 → 20·70·120·170·220, 315 → 20·70·120·170·220·270·300.
 */
export function autoWarmups(target: number): string {
  if (!target || target <= 25) return "";
  const r5 = (n: number) => Math.round(n / 5) * 5;
  const steps = [20];
  let cur = 20;
  while (cur + 50 < target - 20) {
    cur += 50;
    steps.push(cur);
  }
  const final = r5(target - 15);
  if (final > cur + 5) steps.push(final);
  return steps.join(" · ");
}
