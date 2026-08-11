/**
 * Planning maths shared by the Client Board (who needs a week written) and the
 * Weeks grid (who has which weeks of the year planned). The single source of
 * truth is the coach's per-athlete Program (mesocycles → dated weeks), the same
 * data the Block Plan draws on — so a week the coach writes shows up in both.
 */
import { addDays } from "../../lib/program/program";
import { peekProgram, mondayOf, weekOrder, dayDate, WEEKDAY_NAME, type Week } from "./coachProgram";
import { getDashboard, getSessionFor } from "../../lib/data/athleteData";
import { weekHasLogsIn } from "./coachStats";

/** A week counts as "planned" once it is dated and holds at least one training day. */
function weekHasContent(w: Week): boolean {
  return w.days.some((d) => !d.rest && d.exercises.length > 0);
}

// How a program week fills a Monday-column: the whole week, only the tail (it
// started mid-week) or only the head (it ends mid-week) → drawn as a half square.
export type Coverage = "full" | "start" | "end";
export type PlannedWeek = {
  monday: string;
  published: boolean;
  filled: boolean; // athlete has logged loads in this week
  mesoName: string;
  color: string;
  weekName: string;
  coverage: Coverage;
};

/**
 * Every dated, non-empty week in an athlete's program, keyed by Monday-column.
 * A week that starts or ends mid-week spans two columns and marks each partial,
 * so the grid can draw a half square.
 */
export function plannedWeeks(athleteId: string): Map<string, PlannedWeek> {
  const p = peekProgram(athleteId);
  const map = new Map<string, PlannedWeek>();
  if (!p) return map;
  const logs = getDashboard(athleteId).programLogs ?? {};
  const put = (mon: string, e: PlannedWeek) => {
    const ex = map.get(mon);
    if (!ex) { map.set(mon, e); return; }
    // A column touched by two partials (one week ends, the next starts) is full.
    const coverage: Coverage = e.coverage === "full" || ex.coverage === "full" || ex.coverage !== e.coverage ? "full" : e.coverage;
    map.set(mon, { ...e, coverage, published: e.published || ex.published, filled: e.filled || ex.filled });
  };
  for (const m of p.mesocycles) {
    for (const w of m.weeks) {
      if (!w.startDate || !weekHasContent(w)) continue;
      const base = { published: w.status === "published", filled: weekHasLogsIn(logs, w), mesoName: m.name, color: m.color, weekName: w.name };
      const startMon = mondayOf(w.startDate);
      const endMon = mondayOf(addDays(w.startDate, 6));
      if (startMon === endMon) {
        put(startMon, { monday: startMon, coverage: "full", ...base });
      } else {
        put(startMon, { monday: startMon, coverage: "start", ...base }); // tail of this column
        put(endMon, { monday: endMon, coverage: "end", ...base }); // head of the next column
      }
    }
  }
  return map;
}

// --- per-week session detail (Weeks-grid hover + click) ----------------------
export type SessionState = "logged" | "started" | "empty";
export type SessionLine = {
  date: string;
  dayName: string; // "THU"
  title: string; // main lifts of the day, e.g. "Squat · Bench"
  state: SessionState;
  loggedSets: number;
  totalSets: number;
};
export type WeekDetail = {
  mesoName: string;
  weekName: string;
  firstTrainingDay: string | null; // "THURSDAY 14 Aug"
  sessions: SessionLine[];
  loggedSessions: number;
  totalSessions: number;
};

const DAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Detail for the week that fills a given Monday-column: each training session,
 * whether the athlete has logged it, and the week's FIRST training day — so a
 * Thursday-start block never gets missed in a hover.
 */
export function weekDetailFor(athleteId: string, monday: string): WeekDetail | null {
  const p = peekProgram(athleteId);
  if (!p) return null;
  let found: { m: string; w: Week } | null = null;
  for (const m of p.mesocycles) {
    for (const w of m.weeks) {
      if (!w.startDate || !weekHasContent(w)) continue;
      if (mondayOf(w.startDate) === monday || mondayOf(addDays(w.startDate, 6)) === monday) {
        // Prefer the week that actually starts in this column.
        if (!found || mondayOf(w.startDate) === monday) found = { m: m.name, w };
      }
    }
  }
  if (!found) return null;
  const { w } = found;
  const sessions: SessionLine[] = [];
  for (const wd of weekOrder(w)) {
    const date = dayDate(w, wd);
    if (!date) continue;
    const day = w.days.find((d) => d.weekday === wd);
    if (!day || day.rest || day.exercises.length === 0) continue;
    const s = getSessionFor(athleteId, date);
    let logged = 0;
    let total = 0;
    for (const ex of s.exercises) {
      for (const st of ex.sets) {
        total++;
        if ((st.weightKg != null && !st.prefill) || st.failed) logged++;
      }
    }
    const lifts = Array.from(new Set(day.exercises.map((e) => e.name).filter(Boolean))).slice(0, 3).join(" · ");
    sessions.push({
      date,
      dayName: DAY_SHORT[new Date(`${date}T00:00:00`).getDay()],
      title: lifts || "Session",
      state: logged === 0 ? "empty" : logged >= Math.ceil(total * 0.7) ? "logged" : "started",
      loggedSets: logged,
      totalSets: total,
    });
  }
  const firstTrainingDay = sessions[0]
    ? `${WEEKDAY_NAME[new Date(`${sessions[0].date}T00:00:00`).getDay()]} ${fmtDay(sessions[0].date)}`
    : null;
  return {
    mesoName: found.m,
    weekName: w.name,
    firstTrainingDay,
    sessions,
    loggedSessions: sessions.filter((x) => x.state === "logged").length,
    totalSessions: sessions.length,
  };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
/** Whole days from a → b (b - a). */
function dayDiff(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime();
  const b = new Date(`${bISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

export type PlanState = "overdue" | "due" | "checked" | "none";
export type ProgramStatus = {
  /** Contiguous written weeks from this week forward (incl. the current one). */
  weeksAhead: number;
  /** First Monday the athlete has no program for — they start "blind" here. */
  runsOutMonday: string | null;
  /** Days from today until that blind Monday. */
  daysUntil: number | null;
  state: PlanState;
  /** true when nothing needs writing yet (next week is already covered). */
  checked: boolean;
  label: string;
  sub: string;
  /** Sort key — smaller = more urgent. */
  rank: number;
};

/**
 * Where an athlete stands on programming. "Due" fires a day early: the coach
 * should have the next block written before the athlete ever starts it.
 */
export function programStatus(athleteId: string, todayISO: string): ProgramStatus {
  const map = plannedWeeks(athleteId);
  const thisMonday = mondayOf(todayISO);

  if (map.size === 0) {
    return { weeksAhead: 0, runsOutMonday: null, daysUntil: null, state: "none", checked: false, label: "NEW", sub: "no program yet", rank: -1 };
  }

  // Count contiguous written weeks starting at this week.
  let weeksAhead = 0;
  let cursor = thisMonday;
  while (map.has(cursor)) {
    weeksAhead++;
    cursor = addDays(cursor, 7);
  }
  const runsOutMonday = cursor; // first blind Monday from today forward
  const daysUntil = dayDiff(todayISO, runsOutMonday);
  const dueBy = addDays(runsOutMonday, -1); // want it written a day before they start

  // In an unwritten week right now → overdue.
  if (weeksAhead === 0) {
    return { weeksAhead, runsOutMonday, daysUntil, state: "overdue", checked: false, label: "OVERDUE", sub: "programme ran out", rank: -10 + daysUntil };
  }
  // Only the current week is written → the next one is due now (a day early).
  if (weeksAhead === 1) {
    const label = daysUntil <= 1 ? (daysUntil <= 0 ? "DUE TODAY" : "DUE TOMORROW") : `${daysUntil} DAYS`;
    return { weeksAhead, runsOutMonday, daysUntil, state: "due", checked: false, label, sub: `have it by ${fmtDay(dueBy)}`, rank: daysUntil };
  }
  // Two or more weeks written ahead → covered for now.
  return { weeksAhead, runsOutMonday, daysUntil, state: "checked", checked: true, label: `${weeksAhead} WEEKS`, sub: `runs to ${fmtDay(runsOutMonday)}`, rank: 100 + daysUntil };
}

/** Mondays (ISO) for a whole year, so the Weeks grid has one column each. */
export function yearMondays(year: number): string[] {
  const jan1 = `${year}-01-01`;
  let m = mondayOf(jan1);
  // Start at the first Monday that lands in the target year.
  if (new Date(`${m}T00:00:00`).getFullYear() < year) m = addDays(m, 7);
  const out: string[] = [];
  while (new Date(`${m}T00:00:00`).getFullYear() === year) {
    out.push(m);
    m = addDays(m, 7);
  }
  return out;
}

export const weekLabel = (iso: string) => fmtDay(iso);
export function monthOf(iso: string): string {
  return MON[new Date(`${iso}T00:00:00`).getMonth()];
}
