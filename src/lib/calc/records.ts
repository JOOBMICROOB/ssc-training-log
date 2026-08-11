import { ipfGlPoints, type Sex } from "./scores";

/**
 * Personal records → best gym total → IPF GL points.
 *
 * Source of truth is the athlete's logged singles (from the training log). The
 * best squat, bench and deadlift are the three PRs; their sum is the best gym
 * total. Each PR's delta is how much it beat the previous PR by.
 *
 * GL (current): the best total scored at the bodyweight the athlete logged at
 * their last PR (their newest tracked heaviest load) — that bodyweight is the
 * coefficient. GL (best) is simply the highest GL they've ever reached, kept as
 * a running maximum.
 */

export type PrRecord = {
  lift: string; // "SQUAT" | "BENCH PRESS" | "DEADLIFT"
  best: number; // heaviest single logged, kg
  previousBest: number; // the PR it beat, kg
  date: string; // display date of the best
};

/** kg formatter: comma decimals, no trailing ",0" (5 -> "5", 2.5 -> "2,5"). */
export const fmtKg = (n: number): string =>
  (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace(".", ",");

/** GL formatter: always one decimal with a comma (68.9 -> "68,9"). */
export const fmtGl = (n: number): string => n.toFixed(1).replace(".", ",");

export const gymTotal = (prs: PrRecord[]): number => prs.reduce((s, p) => s + p.best, 0);

/** Total kg gained across the current PRs vs the PRs they replaced. */
export const gymImprovement = (prs: PrRecord[]): number =>
  prs.reduce((s, p) => s + Math.max(0, p.best - p.previousBest), 0);

/** How much this PR beat the previous one by (kg). */
export const prDelta = (p: PrRecord): number => Math.max(0, p.best - p.previousBest);

/**
 * GL now: total from the best S/B/D, coefficient from the bodyweight logged at
 * the last PR (pass the athlete's latest logged bodyweight).
 */
export const glCurrent = (sex: Sex, bodyweightAtLastPrKg: number, prs: PrRecord[]): number =>
  ipfGlPoints(sex, bodyweightAtLastPrKg, gymTotal(prs));

/** Running best GL: the higher of the stored best and the current GL. */
export const glBest = (storedBest: number, current: number): number => Math.max(storedBest, current);
