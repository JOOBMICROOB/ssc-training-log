/** Per-athlete, per-meet attempt plans (coach-side, meet-day live tracking). */
export type LiftKey = "squat" | "bench" | "deadlift";
export type Which = "opener" | "second" | "third";
/** Each attempt has three coach-typed options: a low, a neutral, and a high. */
export type Slot = { low: number; neutral: number; high: number };
export type Attempt = Record<Which, Slot>;
export type AttemptStatus = "pending" | "hit" | "miss";
export type AttemptStatuses = Record<Which, AttemptStatus>;
export type Goals = { placement: string; gl: number };
export type Targets = { total: number; squat: number; bench: number; deadlift: number };
export type AttemptPlan = {
  rm: Record<LiftKey, number>;
  attempts: Record<LiftKey, Attempt>;
  targets: Targets; // records / goals to chase (total + per lift)
  goals: Goals; // placement + GL target
  warmups: Record<LiftKey, string>; // custom override; "" = auto
  status: Record<LiftKey, AttemptStatuses>; // meet-day hit / miss per attempt
  rivalId: string;
  published?: boolean; // shared with the athlete (their "My attempts" page shows it)
};

import { getAttemptPlans, saveAttemptPlan } from "../../lib/data/athleteData";

const r2 = (n: number) => Math.round(n / 2.5) * 2.5;
const zeroStatus = (): AttemptStatuses => ({ opener: "pending", second: "pending", third: "pending" });
const slot = (v: number): Slot => ({ low: Math.max(0, r2(v - 5)), neutral: r2(v), high: r2(v + 5) });

// Plans live on the athlete's cloud row (so the athlete sees them + the coach's
// live meet-day ticks), not coach-local storage.
function loadAll(athleteId: string): Record<string, Partial<AttemptPlan>> {
  return getAttemptPlans(athleteId) as Record<string, Partial<AttemptPlan>>;
}

function seededAttempts(rm: Record<LiftKey, number>): Record<LiftKey, Attempt> {
  const mk = (m: number): Attempt => ({ opener: slot(m * 0.9), second: slot(m * 0.96), third: slot(m * 1.01) });
  return { squat: mk(rm.squat), bench: mk(rm.bench), deadlift: mk(rm.deadlift) };
}

/** Migrate a stored attempts map: older plans stored a single number per attempt. */
function migrateAttempts(stored: unknown, rm: Record<LiftKey, number>): Record<LiftKey, Attempt> {
  const seed = seededAttempts(rm);
  if (!stored || typeof stored !== "object") return seed;
  const out = {} as Record<LiftKey, Attempt>;
  for (const l of ["squat", "bench", "deadlift"] as LiftKey[]) {
    const a = (stored as Record<LiftKey, unknown>)[l];
    if (!a || typeof a !== "object") { out[l] = seed[l]; continue; }
    const mk = (w: Which): Slot => {
      const v = (a as Record<Which, unknown>)[w];
      if (typeof v === "number") return slot(v); // old numeric attempt → low/neutral/high
      if (v && typeof v === "object") {
        const s = v as Partial<Slot>;
        return { low: s.low ?? 0, neutral: s.neutral ?? 0, high: s.high ?? 0 };
      }
      return seed[l][w];
    };
    out[l] = { opener: mk("opener"), second: mk("second"), third: mk("third") };
  }
  return out;
}

/** Stored plan for a meet (with any newer fields backfilled), or a fresh seed. */
export function getPlan(athleteId: string, compId: string, rm: Record<LiftKey, number>): AttemptPlan {
  const s = loadAll(athleteId)[compId] ?? {};
  return {
    rm: s.rm ?? rm,
    attempts: migrateAttempts(s.attempts, s.rm ?? rm),
    targets: s.targets ?? { total: 0, squat: 0, bench: 0, deadlift: 0 },
    goals: s.goals ?? { placement: "", gl: 0 },
    warmups: s.warmups ?? { squat: "", bench: "", deadlift: "" },
    status: s.status ?? { squat: zeroStatus(), bench: zeroStatus(), deadlift: zeroStatus() },
    rivalId: s.rivalId ?? "",
    published: s.published ?? false,
  };
}

export function savePlan(athleteId: string, compId: string, plan: AttemptPlan) {
  saveAttemptPlan(athleteId, compId, plan);
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
