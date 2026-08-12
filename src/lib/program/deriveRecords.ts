import { ipfGlPoints, type Sex } from "../calc/scores";
import { fmtKg, fmtGl } from "../calc/records";
import { getSession, type WeekTemplate, type ProgramLogs, type MainLift } from "./program";

/**
 * Personal records, best gym total and IPF GL — all derived from the training
 * log. A lift's PR is the heaviest weight ever logged for it (any rep count
 * counts, since the heaviest load moved is the top single), combined with a
 * coach/starting baseline. The total is the sum; GL is scored at the bodyweight
 * logged nearest the most recent PR. Recomputed live, so logging heavier updates
 * the dashboard — and, once synced, the coach.
 */

export type Baseline = { value: number; date: string; delta: number };
export type BwPoint = { date: string; kg: number };

export type DerivedRecords = {
  prs: { lift: string; key: MainLift; value: string; date: string; delta: string }[];
  gym: string;
  gymDelta: string;
  glCurrent: string;
  glBest: string;
  glNote: string;
};

const LABEL: Record<MainLift, string> = { squat: "SQUAT", bench: "BENCH PRESS", deadlift: "DEADLIFT" };
const ORDER: MainLift[] = ["squat", "bench", "deadlift"];

// Fallback when an exercise has no mainLift set: recognise the competition lift
// or the plain lift by name — "comp squat" counts as squat — but NOT variations
// (romanian deadlift, paused/box/front squat, etc.) so accessories never inflate
// a main-lift PR. The coach normally sets mainLift, so this is just a safety net.
const LIFT_WORDS: [MainLift, RegExp][] = [
  ["squat", /^(comp\.?\s*|competition\s*)?(back\s*)?squats?$/],
  ["bench", /^(comp\.?\s*|competition\s*)?bench(\s*press)?e?s?$/],
  ["deadlift", /^(comp\.?\s*|competition\s*)?(conventional\s*|sumo\s*)?deadlifts?$/],
];
function inferLift(name: string): MainLift | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [lift, re] of LIFT_WORDS) if (re.test(n)) return lift;
  return null;
}

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

function nearestBw(entries: BwPoint[], targetISO: string, fallback: number): number {
  if (!entries.length) return fallback;
  const t = Date.parse(`${targetISO}T00:00:00`);
  let best = entries[0];
  let bestGap = Infinity;
  for (const e of entries) {
    const gap = Math.abs(Date.parse(`${e.date}T00:00:00`) - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = e;
    }
  }
  return best.kg;
}

export function deriveRecords(
  template: WeekTemplate,
  logs: ProgramLogs,
  baselines: Record<MainLift, Baseline>,
  bwEntries: BwPoint[],
  sexInput: Sex,
  // Resolve the template that was active on a given date, so every logged set
  // maps onto the exercises it was actually done under. Without this, logs from
  // an earlier week get read against today's layout and their loads are missed.
  templateAt?: (date: string) => WeekTemplate,
): DerivedRecords {
  const sex: Sex = sexInput === "male" ? "male" : "female"; // guard undefined/legacy data
  // Heaviest logged weight per main lift, with the date it was hit. A lift's
  // competition variant (comp squat, etc.) carries the same mainLift, so it's
  // counted here too — logging a heavier comp squat lifts the squat PR.
  const maxByLift: Record<MainLift, { weight: number; date: string } | null> = {
    squat: null,
    bench: null,
    deadlift: null,
  };
  for (const date of Object.keys(logs)) {
    const s = getSession(templateAt ? templateAt(date) : template, logs, date);
    for (const ex of s.exercises) {
      const lift = ex.mainLift ?? inferLift(ex.name);
      if (!lift) continue;
      for (const st of ex.sets) {
        if (st.weightKg != null && !st.failed && !st.prefill) {
          const cur = maxByLift[lift];
          if (!cur || st.weightKg > cur.weight) maxByLift[lift] = { weight: st.weightKg, date };
        }
      }
    }
  }

  let lastPrDate: string | null = null;
  let totalDelta = 0;
  const prs = ORDER.map((l) => {
    const base = baselines[l];
    const logged = maxByLift[l];
    let best = base.value;
    let date = base.date;
    let delta = base.delta;
    if (logged && logged.weight > base.value) {
      best = logged.weight;
      delta = logged.weight - base.value;
      date = monthLabel(logged.date);
      if (!lastPrDate || logged.date > lastPrDate) lastPrDate = logged.date;
    }
    totalDelta += delta;
    return { lift: LABEL[l], key: l, value: fmtKg(best), date, delta: `+${fmtKg(delta)}`, best };
  });

  const gymTotal = prs.reduce((s, p) => s + p.best, 0);
  const sorted = [...bwEntries].sort((a, b) => a.date.localeCompare(b.date));
  const bwForGl = lastPrDate
    ? nearestBw(sorted, lastPrDate, sorted.at(-1)?.kg ?? 0)
    : (sorted.at(-1)?.kg ?? 0);
  const gl = bwForGl > 0 ? ipfGlPoints(sex, bwForGl, gymTotal) : 0;

  return {
    prs: prs.map(({ lift, key, value, date, delta }) => ({ lift, key, value, date, delta })),
    gym: fmtKg(gymTotal),
    gymDelta: `+${fmtKg(totalDelta)} kg since starting`,
    glCurrent: gl ? fmtGl(gl) : "—",
    glBest: gl ? fmtGl(gl) : "—",
    glNote: `GL points from ${fmtKg(gymTotal)} kg at ${fmtKg(bwForGl)} kg bodyweight.`,
  };
}
