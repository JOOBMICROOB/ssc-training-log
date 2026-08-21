import { currentWeekWindow, type Weekday } from "../calc/adherence";
import { fmtKg } from "../calc/records";

/**
 * Training program model.
 *
 * The coach sets a weekly TEMPLATE (which weekday trains what, the exercises and
 * their prescribed sets). The athlete's LOGS (weight/RPE/notes per set, session
 * RPE, pain, finished) are keyed by calendar date and merged onto the template
 * to produce a concrete Session for any day. Session names always follow SBD
 * order (Squat → Bench → Deadlift).
 */

export type MainLift = "squat" | "bench" | "deadlift";

export type SetTemplate = {
  targetReps: string;
  targetRpe: string;
  requiresRpe: boolean;
  targetLoad?: string; // coach-prescribed working weight (kg)
  targetPercent?: string; // coach-prescribed %1RM
  targetSuggest?: string; // advisory working weight (kg) shown as a hint — NOT a cap
  fixedLoad?: boolean; // load is fixed — the athlete may only go lighter, with a warning
  toFailure?: boolean; // no target — push to failure and log what you did
  timed?: boolean; // a time-based hold — no weight, athlete just marks it done
  holdSeconds?: string; // target duration for a timed set, e.g. "40-60"
};
export type ExerciseTemplate = {
  name: string;
  mainLift: MainLift | null; // null = accessory
  kind: "compound" | "accessory";
  scheme: string; // "Compound · log every set" or a block scheme
  clip: boolean; // coach attached a video clip
  video?: string; // the clip URL the athlete can open
  sets: SetTemplate[];
  competition?: boolean; // the actual comp lift (not a paused/tempo/etc. variation)
};
export type DayTemplate = {
  rest: boolean;
  exercises: ExerciseTemplate[];
  alt?: ExerciseTemplate[]; // optional Option B session (e.g. an injury alternative)
  note?: string; // coach's word of info shown above the A/B picker
};
export type WeekTemplate = DayTemplate[]; // length 7, index by weekday 0=Sun … 6=Sat

export type SetLog = {
  weightKg?: number | null;
  rpe?: number | null;
  note?: string;
  failed?: boolean;
  done?: boolean; // a timed set the athlete marked complete (no weight)
  heldSeconds?: number | null; // for a timed set — how long the athlete actually held it
  // Coach-prescribed fixed load, pre-filled on publish. It shows the weight but
  // does NOT count as the athlete's logging until they confirm/edit it.
  prefill?: boolean;
};
export type DayLog = {
  sets?: Record<string, SetLog>; // key `${exIdx}_${setIdx}`
  sessionRpe?: number;
  pain?: number;
  finished?: boolean;
};
export type ProgramLogs = Record<string, DayLog>; // key = ISO date

// --- merged (concrete) session ----------------------------------------------

export type LoggedSet = SetTemplate & {
  key: string;
  weightKg: number | null;
  rpe: number | null;
  note: string;
  failed: boolean;
  done: boolean; // timed set marked complete
  heldSeconds: number | null; // logged hold duration for a timed set
  prefill: boolean; // shown but not yet confirmed by the athlete
  lastWeek: string; // "137,5 kg @ RPE8" or ""
};
export type SessionExercise = {
  name: string;
  mainLift: MainLift | null;
  kind: "compound" | "accessory";
  scheme: string;
  clip: boolean;
  video?: string;
  competition: boolean;
  sets: LoggedSet[];
  setCount: number;
  loggedCount: number;
  lastWeekLabel: string; // compact summary for the header, e.g. "3 × 142,5 kg @8"
};
export type Session = {
  date: string;
  weekday: number;
  rest: boolean;
  name: string;
  exercises: SessionExercise[];
  setCount: number;
  loggedCount: number;
  rpeRequired: number;
  rpeLogged: number;
  sessionRpe: number | null;
  pain: number | null;
  finished: boolean;
  hasAlt: boolean; // an Option B exists for this day
  note: string; // coach's info for the day (shown above the A/B picker)
  option: "A" | "B"; // which session this is
};

const ORDER: MainLift[] = ["squat", "bench", "deadlift"];
// Local-date string (NOT toISOString, which is UTC and shifts the day in +TZ).
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s: string) => new Date(`${s}T00:00:00`);
export const addDays = (s: string, n: number) => {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

// Loose lift detection for NAMING ONLY — matches comp lifts AND their variations
// (2CT paused squat, larsen bench, stiff-legged deadlift, RDL…) by substring, so a
// session full of squat variants still reads "SQUAT SESSION" instead of "ACCESSORY".
// PR / volume attribution stays strict (see inferLift) — this never feeds those.
const LIFT_PATTERN: [MainLift, RegExp][] = [
  ["squat", /squat/],
  ["bench", /bench|larsen/],
  ["deadlift", /deadlift|dead ?lift|\brdl\b|romanian|stiff.?leg/],
];
export function looseLift(name: string): MainLift | null {
  const n = name.trim().toLowerCase();
  for (const [lift, re] of LIFT_PATTERN) if (re.test(n)) return lift;
  return null;
}
export function sessionLifts(ex: ExerciseTemplate[]): MainLift[] {
  return ORDER.filter((l) => ex.some((e) => (e.mainLift ?? looseLift(e.name)) === l));
}

/** Session title in SBD order, e.g. "BENCH & DEADLIFT SESSION". */
export function sessionName(ex: ExerciseTemplate[]): string {
  const lifts = sessionLifts(ex);
  if (!lifts.length) return "ACCESSORY SESSION";
  return `${lifts.map((l) => l.toUpperCase()).join(" & ")} SESSION`;
}

const BARE_LIFT: Record<MainLift, string[]> = {
  squat: ["squat"],
  bench: ["bench", "bench press", "benchpress"],
  deadlift: ["deadlift", "dead lift"],
};
/** The competition lift for a main movement: a "COMP …" name or the bare name. */
function isCompLift(name: string, mainLift: MainLift | null): boolean {
  if (mainLift == null) return false;
  const n = name.trim().toLowerCase();
  return /^comp\b|^competition\b/.test(n) || BARE_LIFT[mainLift].includes(n);
}

export function getSession(template: WeekTemplate, logs: ProgramLogs, date: string, option: "A" | "B" = "A"): Session {
  const weekday = fromISO(date).getDay();
  const day = template[weekday] ?? { rest: true, exercises: [] };
  const hasAlt = !!day.alt && day.alt.length > 0;
  // Option B (the injury alternative) uses its own exercises + a "B"-prefixed log
  // key namespace, so A's logs and B's logs never collide when the athlete switches.
  const useB = option === "B" && hasAlt;
  const exSource = useB ? day.alt! : day.exercises;
  const kp = useB ? "B" : "";
  const dayLog = logs[date] ?? {};
  const prevLog = logs[addDays(date, -7)] ?? {};

  let setCount = 0;
  let loggedCount = 0;
  let rpeRequired = 0;
  let rpeLogged = 0;

  const exercises: SessionExercise[] = day.rest
    ? []
    : exSource.map((ex, ei) => {
        const sets: LoggedSet[] = ex.sets.map((st, si) => {
          const key = `${kp}${ei}_${si}`;
          const log = dayLog.sets?.[key] ?? {};
          const weightKg = log.weightKg ?? null;
          const rpe = log.rpe ?? null;
          const failed = log.failed ?? false;
          const done = log.done ?? false;
          const heldSeconds = log.heldSeconds ?? null;
          const prefill = log.prefill ?? false;
          const prev = prevLog.sets?.[key];
          setCount++;
          // Athlete-logged = a real weight they confirmed (not a coach prefill), a
          // failed attempt, or a timed set marked done. Coach prefills don't count.
          if ((weightKg != null && !prefill) || failed || done) loggedCount++;
          if (st.requiresRpe) {
            rpeRequired++;
            if (rpe != null) rpeLogged++;
          }
          const lw =
            prev?.weightKg != null
              ? `${fmtKg(prev.weightKg)} kg${prev.rpe != null ? ` @ RPE${prev.rpe}` : ""}${prev.failed ? " · failed" : ""}`
              : "";
          return { ...st, key, weightKg, rpe, note: log.note ?? "", failed, done, heldSeconds, prefill, lastWeek: lw };
        });
        // Compact last-week summary for the collapsed header.
        const prevWeights = ex.sets
          .map((_, si) => prevLog.sets?.[`${kp}${ei}_${si}`]?.weightKg)
          .filter((w): w is number => w != null);
        let lastWeekLabel = "";
        if (prevWeights.length) {
          const same = prevWeights.every((w) => w === prevWeights[0]);
          const prevRpes = ex.sets
            .map((_, si) => prevLog.sets?.[`${kp}${ei}_${si}`]?.rpe)
            .filter((r): r is number => r != null);
          const rpeStr = prevRpes.length && prevRpes.every((r) => r === prevRpes[0]) ? ` @${prevRpes[0]}` : "";
          lastWeekLabel = same
            ? `${prevWeights.length} × ${fmtKg(prevWeights[0])} kg${rpeStr}`
            : `${fmtKg(Math.min(...prevWeights))}–${fmtKg(Math.max(...prevWeights))} kg`;
        }
        return {
          name: ex.name,
          mainLift: ex.mainLift,
          kind: ex.kind,
          scheme: ex.scheme,
          clip: ex.clip,
          video: ex.video,
          // The comp lift: flagged by the coach, or auto-detected from "COMP <lift>".
          // The competition movement: a "COMP …" name or the bare lift name
          // (so "COMP SQUATS", "Competition Squat" and "Squat" all feed the
          // rep-max, while paused/tempo/front variants stay separate).
          competition: ex.competition ?? isCompLift(ex.name, ex.mainLift),
          sets,
          setCount: sets.length,
          loggedCount: sets.filter((s) => (s.weightKg != null && !s.prefill) || s.failed || s.done).length,
          lastWeekLabel,
        };
      });

  return {
    date,
    weekday,
    rest: day.rest,
    name: day.rest ? "REST DAY" : sessionName(exSource),
    exercises,
    setCount,
    loggedCount,
    rpeRequired,
    rpeLogged,
    sessionRpe: dayLog.sessionRpe ?? null,
    pain: dayLog.pain ?? null,
    // Auto-done once the athlete has logged ≥70% of the session (coach prefills
    // don't count); an explicit "finish" always wins.
    finished: dayLog.finished ?? (setCount > 0 && loggedCount >= Math.ceil(setCount * 0.7)),
    hasAlt,
    note: day.note ?? "",
    option: useB ? "B" : "A",
  };
}

// --- week view (the day buttons + "sessions this week" list) -----------------

export type WeekDay = {
  date: string;
  weekday: number;
  rest: boolean;
  sessionLabel: string; // "S1" or "REST"
  name: string;
  exerciseCount: number;
  setCount: number;
  loggedCount: number;
  status: "done" | "upcoming" | "partial" | "rest";
};

export function weekDates(weekStartsOn: Weekday, ref: string): string[] {
  const start = iso(currentWeekWindow(weekStartsOn, fromISO(ref)).start);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function getWeek(
  template: WeekTemplate,
  logs: ProgramLogs,
  weekStartsOn: Weekday,
  ref: string,
  today: string,
): WeekDay[] {
  const dates = weekDates(weekStartsOn, ref);
  let sIdx = 0;
  return dates.map((date) => {
    const s = getSession(template, logs, date);
    const label = s.rest ? "REST" : `S${++sIdx}`;
    const status: WeekDay["status"] = s.rest
      ? "rest"
      : s.finished
        ? "done"
        : date > today
          ? "upcoming"
          : "partial";
    return {
      date,
      weekday: s.weekday,
      rest: s.rest,
      sessionLabel: label,
      name: s.name,
      exerciseCount: s.exercises.length,
      setCount: s.setCount,
      loggedCount: s.loggedCount,
      status,
    };
  });
}

/**
 * Adherence counts for the sessions DUE SO FAR this week: from the week-start
 * day up to and including today. Future days aren't counted until they arrive,
 * and it resets each week (previous weeks never carry over) — a real-time
 * "so far this week" figure, not a running backlog.
 */
export function dueSoFarAdherence(
  template: WeekTemplate,
  logs: ProgramLogs,
  weekStartsOn: Weekday,
  today: string,
): { setsDone: number; setsTotal: number; rpeDone: number; rpeTotal: number } {
  let d = iso(currentWeekWindow(weekStartsOn, fromISO(today)).start);
  let setsDone = 0;
  let setsTotal = 0;
  let rpeDone = 0;
  let rpeTotal = 0;
  // A training week is 7 days — bound the loop so a date-math slip can never hang.
  for (let i = 0; i < 7 && d <= today; i++) {
    const s = getSession(template, logs, d);
    if (!s.rest) {
      setsTotal += s.setCount;
      setsDone += s.loggedCount;
      rpeTotal += s.rpeRequired;
      rpeDone += s.rpeLogged;
    }
    d = addDays(d, 1);
  }
  return { setsDone, setsTotal, rpeDone, rpeTotal };
}

/** Adherence counts for a whole (completed) week starting on weekStartISO. */
export function fullWeekCounts(
  template: WeekTemplate,
  logs: ProgramLogs,
  weekStartISO: string,
): { setsDone: number; setsTotal: number; rpeDone: number; rpeTotal: number } {
  let d = weekStartISO;
  let setsDone = 0;
  let setsTotal = 0;
  let rpeDone = 0;
  let rpeTotal = 0;
  for (let i = 0; i < 7; i++) {
    const s = getSession(template, logs, d);
    if (!s.rest) {
      setsTotal += s.setCount;
      setsDone += s.loggedCount;
      rpeTotal += s.rpeRequired;
      rpeDone += s.rpeLogged;
    }
    d = addDays(d, 1);
  }
  return { setsDone, setsTotal, rpeDone, rpeTotal };
}

// --- month view (calendar grid) ---------------------------------------------

export type MonthCell = {
  date: string | null; // null = padding cell
  day: number;
  status: "training" | "logged" | "rest";
  isToday: boolean;
};

/** Monday-first grid of the given month. */
export function getMonth(
  template: WeekTemplate,
  logs: ProgramLogs,
  year: number,
  month: number, // 0-11
  today: string,
): MonthCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ date: null, day: 0, status: "rest", isToday: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(new Date(year, month, d));
    const s = getSession(template, logs, date);
    const status: MonthCell["status"] = s.rest ? "rest" : s.finished ? "logged" : "training";
    cells.push({ date, day: d, status, isToday: date === today });
  }
  return cells;
}
