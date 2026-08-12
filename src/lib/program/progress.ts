import { epleyE1rm } from "../calc/epley";
import { ipfGlPoints, type Sex } from "../calc/scores";
import { currentWeekWindow, type Weekday } from "../calc/adherence";
import { fmtKg, fmtGl } from "../calc/records";
import { getSession, addDays, type WeekTemplate, type ProgramLogs, type MainLift } from "./program";
import { inferLift } from "./deriveRecords";

/**
 * Per-lift progress for the 6a page. The estimated 1RM each week is Epley from
 * the comp lift's lowest-rep top set that week (variations excluded). Rep-maxes
 * are the heaviest logged weight at each rep count. Tonnage and the estimated
 * total (sum of the three lifts' e1RM + IPF GL) are session/athlete level.
 */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const TITLE_LOWER: Record<MainLift, string> = { squat: "squat", bench: "bench", deadlift: "deadlift" };

export type WeekPoint = { label: string; e1rm: number };
export type RepMax = { reps: number; weight: number | null };
export type VariantPr = { name: string; weight: number; reps: number };
export type LiftProgress = {
  currentLabel: string; // "135 kg"
  deltaLabel: string; // "+7,7 kg over 4 weeks"
  weeks: WeekPoint[];
  repMaxes: RepMax[];
  variants: VariantPr[]; // best all-time logged set per related variant/accessory
  currentE1rm: number;
};

function weekStartOf(weekStartsOn: Weekday, dateISO: string): string {
  return iso(currentWeekWindow(weekStartsOn, new Date(`${dateISO}T00:00:00`)).start);
}

/** e1RM for the comp lift that week: lowest-rep set, heaviest at that rep count. */
function weekE1rm(template: WeekTemplate, logs: ProgramLogs, lift: MainLift, weekStartISO: string): number {
  let lowestReps = Infinity;
  let weightAtLowest = 0;
  let d = weekStartISO;
  for (let i = 0; i < 7; i++) {
    const s = getSession(template, logs, d);
    for (const ex of s.exercises) {
      // Match the lift the same way the dashboard does: the set's mainLift, or —
      // when the coach left it unset — the exercise name (comp squat / squat).
      const exLift = ex.mainLift ?? inferLift(ex.name);
      if (exLift !== lift || !(ex.competition || inferLift(ex.name) === lift)) continue;
      for (const st of ex.sets) {
        if (st.weightKg == null || st.failed || st.prefill) continue; // real logs only
        const reps = parseInt(st.targetReps, 10); // min of a range ("3-5" → 3)
        if (!Number.isFinite(reps) || reps < 1) continue;
        if (reps < lowestReps || (reps === lowestReps && st.weightKg > weightAtLowest)) {
          lowestReps = reps;
          weightAtLowest = st.weightKg;
        }
      }
    }
    d = addDays(d, 1);
  }
  return lowestReps < Infinity ? Math.round(epleyE1rm(weightAtLowest, lowestReps) * 10) / 10 : 0;
}

export function liftProgress(
  template: WeekTemplate,
  logs: ProgramLogs,
  lift: MainLift,
  weekStartsOn: Weekday,
  today: string,
  baseline1rm = 0,
  numWeeks = 4,
  // Resolve the template that was active on a given date, so all-time logs map to
  // the right exercises (a single template only fits the current week).
  templateAt?: (date: string) => WeekTemplate,
): LiftProgress {
  const weeks: WeekPoint[] = [];
  for (let w = numWeeks - 1; w >= 0; w--) {
    const start = weekStartOf(weekStartsOn, addDays(today, -7 * w));
    weeks.push({ label: `W${numWeeks - w}`, e1rm: weekE1rm(template, logs, lift, start) });
  }
  const nonZero = weeks.filter((x) => x.e1rm > 0);
  const currentE1rm = weeks[weeks.length - 1].e1rm || nonZero.at(-1)?.e1rm || 0;
  const first = nonZero[0]?.e1rm ?? 0;
  const delta = currentE1rm && first ? currentE1rm - first : 0;
  const deltaLabel =
    delta !== 0
      ? `${delta >= 0 ? "+" : "−"}${fmtKg(Math.abs(Math.round(delta * 10) / 10))} kg over ${numWeeks} weeks`
      : `over ${numWeeks} weeks`;

  // Every logged comp-lift set (all-time), plus the coach/baseline 1RM. Coach
  // fixed-load prefills and failed attempts don't count as a PR. Related variants
  // (same main lift, not the comp lift) get their own best-logged entry.
  const points: { reps: number; weight: number }[] = [];
  if (baseline1rm > 0) points.push({ reps: 1, weight: baseline1rm });
  const variantBest: Record<string, VariantPr> = {};
  for (const date of Object.keys(logs)) {
    const s = getSession(templateAt ? templateAt(date) : template, logs, date);
    for (const ex of s.exercises) {
      // Same lift-match as the dashboard: mainLift, or the name when it's unset.
      const exLift = ex.mainLift ?? inferLift(ex.name);
      if (exLift !== lift) continue;
      // Every set of this main lift feeds the rep-maxes — exactly what the
      // dashboard PR counts, so the two always agree (a heavy set logged under a
      // variation still shows as the heaviest-logged here). Genuine variations
      // (paused, tempo, box…) ALSO get their own best-logged row for detail.
      const isCompLift = ex.competition || inferLift(ex.name) === lift;
      for (const st of ex.sets) {
        if (st.weightKg == null || st.failed || st.prefill) continue;
        // Min of a rep range (a "3-5" set proves at least a 3RM at that weight).
        const reps = parseInt(st.targetReps, 10);
        if (!Number.isFinite(reps) || reps < 1) continue;
        points.push({ reps, weight: st.weightKg });
        if (!isCompLift) {
          const cur = variantBest[ex.name];
          if (!cur || st.weightKg > cur.weight) variantBest[ex.name] = { name: ex.name, weight: st.weightKg, reps };
        }
      }
    }
  }
  // X-RM = heaviest weight touched for AT LEAST X reps (monotonic): a heavy
  // higher-rep set proves the lower-rep maxes too.
  const repMaxes: RepMax[] = [1, 2, 3, 4].map((x) => {
    const ws = points.filter((p) => p.reps >= x).map((p) => p.weight);
    return { reps: x, weight: ws.length ? Math.max(...ws) : null };
  });
  const variants = Object.values(variantBest).sort((a, b) => b.weight - a.weight);

  return {
    currentLabel: currentE1rm ? `${fmtKg(currentE1rm)} kg` : "—",
    deltaLabel,
    weeks,
    repMaxes,
    variants,
    currentE1rm,
  };
}

// --- tonnage -----------------------------------------------------------------

export type SessionTonnage = { label: string; tonnage: number };

export function weekTonnage(
  template: WeekTemplate,
  logs: ProgramLogs,
  weekStartsOn: Weekday,
  today: string,
  scope: "week" | "block",
  blockStart: string | null,
  lift: MainLift,
): { total: string; caption: string; sessions: SessionTonnage[] } {
  const startISO = scope === "week" ? weekStartOf(weekStartsOn, today) : weekStartOf(weekStartsOn, blockStart ?? today);
  const endISO = addDays(today, 1);
  const sessions: SessionTonnage[] = [];
  let total = 0;
  let d = startISO;
  for (let guard = 0; d < endISO && guard < 400; guard++) {
    const s = getSession(template, logs, d);
    if (!s.rest) {
      // Only this lift and its variations (comp + tempo/paused/etc.).
      let t = 0;
      for (const ex of s.exercises) {
        if (ex.mainLift !== lift) continue;
        for (const st of ex.sets) if (st.weightKg != null) t += st.weightKg * (parseInt(st.targetReps, 10) || 1);
      }
      if (t > 0) {
        const wd = new Date(`${d}T00:00:00`).getDay();
        sessions.push({ label: `${DAY_ABBR[wd]} ${Number(d.slice(8, 10))}`, tonnage: t });
        total += t;
      }
    }
    d = addDays(d, 1);
  }
  return {
    total: `${(total / 1000).toFixed(1).replace(".", ",")} t`,
    caption: `${TITLE_LOWER[lift]} · sets × reps × kg`,
    sessions,
  };
}

// --- estimated total ---------------------------------------------------------

export function estimatedTotal(
  template: WeekTemplate,
  logs: ProgramLogs,
  weekStartsOn: Weekday,
  today: string,
  sex: Sex,
  bodyweightKg: number,
): { total: string; gl: string; glSub: string } {
  const e = (l: MainLift) => liftProgress(template, logs, l, weekStartsOn, today).currentE1rm;
  const total = Math.round(e("squat") + e("bench") + e("deadlift"));
  const gl = total > 0 && bodyweightKg > 0 ? ipfGlPoints(sex, bodyweightKg, total) : 0;
  return {
    total: total > 0 ? `${total} kg` : "—",
    gl: gl ? fmtGl(gl) : "—",
    glSub: `classic raw, at ${fmtKg(bodyweightKg)} kg bodyweight`,
  };
}
