/**
 * Per-week training stats + status, shared by the Program Viewer, the Builder
 * and the Weeks grid. "Filled / available / draft" is derived here so every
 * week viewer agrees: a week is FILLED once the athlete has logged loads in it,
 * AVAILABLE once published but still empty, DRAFT until it's published.
 */
import { getDashboard, getSessionFor } from "../../lib/data/athleteData";
import { epleyE1rm } from "../../lib/calc/epley";
import { weekOrder, dayDate, type Week } from "./coachProgram";
import type { MainLift, ProgramLogs } from "../../lib/program/program";

const parseReps = (s: string) => parseInt(s, 10) || 1;

/** Real training dates for a dated week (empty if the week has no start date). */
export function weekDates(week: Week): string[] {
  return weekOrder(week)
    .map((wd) => dayDate(week, wd))
    .filter((x): x is string => !!x);
}

/** True once the athlete has actually logged a set (coach prefills don't count). */
export function weekHasLogsIn(logs: ProgramLogs, week: Week): boolean {
  return weekDates(week).some((d) => {
    const sets = logs[d]?.sets ?? {};
    return Object.values(sets).some((s) => {
      const set = s as { weightKg?: number | null; prefill?: boolean; failed?: boolean; done?: boolean };
      return (set.weightKg != null && !set.prefill) || set.failed === true || set.done === true;
    });
  });
}
export function weekHasLogs(athleteId: string, week: Week): boolean {
  return weekHasLogsIn(getDashboard(athleteId).programLogs ?? {}, week);
}

export type WeekState = "draft" | "available" | "filled";
export const WEEK_STATE_LABEL: Record<WeekState, string> = {
  draft: "draft",
  available: "available",
  filled: "filled in",
};

/** Draft until published; then available until the athlete has logged loads. */
export function weekStateFrom(logs: ProgramLogs, week: Week, live: boolean): WeekState {
  if (week.status !== "published") return "draft";
  return live && weekHasLogsIn(logs, week) ? "filled" : "available";
}
export function weekState(athleteId: string, week: Week, live: boolean): WeekState {
  return weekStateFrom(getDashboard(athleteId).programLogs ?? {}, week, live);
}

export type LiftStat = { planned: number; loggedSets: number; vol: number; e1rm: number };
export type WeekStats = {
  base: Record<MainLift, LiftStat>;
  totalVol: number;
  totalSets: number;
  loggedSets: number;
  anyLogged: boolean;
};

/** Sets · tonnage · best e1RM per comp lift for a week, from the athlete's logs. */
export function weekLiftStats(athleteId: string, week: Week, live: boolean): WeekStats {
  const base: Record<MainLift, LiftStat> = {
    squat: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
    bench: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
    deadlift: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
  };
  let totalSets = 0;
  let loggedSets = 0;
  if (live) {
    for (const date of weekDates(week)) {
      const s = getSessionFor(athleteId, date);
      if (s.rest) continue;
      for (const ex of s.exercises) {
        for (const st of ex.sets) {
          totalSets++;
          const logged = st.weightKg != null && !st.prefill; // coach prefills excluded
          if (logged) loggedSets++;
          if (!ex.mainLift) continue;
          const b = base[ex.mainLift];
          b.planned++;
          if (!logged) continue;
          const reps = parseReps(st.targetReps);
          b.loggedSets++;
          b.vol += (st.weightKg as number) * reps;
          b.e1rm = Math.max(b.e1rm, epleyE1rm(st.weightKg as number, reps));
        }
      }
    }
  }
  const totalVol = base.squat.vol + base.bench.vol + base.deadlift.vol;
  return { base, totalVol, totalSets, loggedSets, anyLogged: totalVol > 0 };
}
