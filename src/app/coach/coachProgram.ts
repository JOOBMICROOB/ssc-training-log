/**
 * Coach-side program model for the builder. A program is mesocycles → weeks →
 * days → exercise rows. It seeds from the athlete's built-in DEFAULT_WEEK so the
 * builder opens showing what the athlete already trains, and `toTemplate` maps a
 * built week back to the athlete `WeekTemplate` that `publishProgramWeek` writes
 * — so "Publish week to athlete" flows straight to the phone app.
 */
import { DEFAULT_WEEK } from "../../lib/program/seedProgram";
import { addDays, looseLift } from "../../lib/program/program";
export { looseLift };
import { getSharedData, setSharedData } from "../../lib/data/athleteData";
import { inferLift } from "../../lib/program/deriveRecords";
import type { ExerciseTemplate, MainLift, WeekTemplate } from "../../lib/program/program";
import reneeProgram from "./reneeProgram.json";
import liezeProgram from "./liezeProgram.json";
import stefProgram from "./stefProgram.json";
import zitaProgram from "./zitaProgram.json";

export type IntensityType = "rpe" | "percent" | "load" | "fixed" | "failure" | "seconds";
export type ExRow = {
  id: string;
  name: string;
  cue: string;
  video: string;
  sets: number;
  reps: string;
  intensity: IntensityType;
  value: string;
  suggest?: string; // advisory working weight (kg) shown to the athlete as a hint
  scheme: string;
  mainLift: MainLift | null;
};
export type Day = { id: string; weekday: number; rest: boolean; exercises: ExRow[]; alt?: ExRow[]; note?: string };
export type Week = { id: string; name: string; status: "draft" | "published"; days: Day[]; startDate?: string; hidden?: boolean };
export type Mesocycle = { id: string; name: string; color: string; weeks: Week[]; hidden?: boolean };
export type Program = { athleteId: string; mesocycles: Mesocycle[]; currentWeekId?: string };

export type ExGroup = "squat" | "bench" | "deadlift" | "pull" | "accessory";
export type DbExercise = { id: string; name: string; group: ExGroup; video?: string };

/** Which database column an exercise belongs to, inferred from its main lift. */
export function inferGroup(mainLift: MainLift | null): ExGroup {
  return mainLift ?? "accessory";
}

// Monday-first weekday order for display (0=Sun … 6=Sat).
/** Set schemes the coach can tag a row with — shown on the athlete's app too. */
export const SCHEMES = ["Warm-up", "Top set", "Working set", "Back-off", "M.Fatigue", "Fatigue", "Accessory", "Optional", "Timed"] as const;
export type Scheme = (typeof SCHEMES)[number];

export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_NAME = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

let SEQ = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}_${(SEQ++).toString(36)}`;

// --- dates -------------------------------------------------------------------
/** The Monday on or before the given date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const off = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(iso, -off);
}
/** The weekday (0=Sun … 6=Sat) a dated week begins on — its start day. */
export function startWeekday(week: Week): number | null {
  return week.startDate ? new Date(`${week.startDate}T00:00:00`).getDay() : null;
}
/** Display order of the 7 weekdays, beginning on the week's chosen start day. */
export function weekOrder(week: Week): number[] {
  const sw = startWeekday(week);
  if (sw == null) return WEEK_ORDER;
  return Array.from({ length: 7 }, (_, i) => (sw + i) % 7);
}
/** Real date for a weekday within a dated week that starts on any day. */
export function dayDate(week: Week, weekday: number): string | null {
  if (!week.startDate) return null;
  const sw = new Date(`${week.startDate}T00:00:00`).getDay();
  const pos = (weekday - sw + 7) % 7;
  return addDays(week.startDate, pos);
}
export const nextWeekStart = (startDate?: string) => (startDate ? addDays(startDate, 7) : undefined);

/** The week that contains `todayIso` (latest dated week starting on/before it). */
export function weekForToday(p: Program, todayIso: string): string | undefined {
  let chosen: { id: string; start: string } | undefined;
  for (const m of p.mesocycles)
    for (const w of m.weeks) {
      if (!w.startDate || w.startDate > todayIso) continue;
      if (!chosen || w.startDate > chosen.start) chosen = { id: w.id, start: w.startDate };
    }
  return chosen?.id ?? p.currentWeekId;
}

// --- converters --------------------------------------------------------------
function exToRow(ex: ExerciseTemplate): ExRow {
  const first = ex.sets[0];
  const intensity: IntensityType = first?.timed
    ? "seconds"
    : first?.toFailure
      ? "failure"
      : first?.fixedLoad || first?.targetLoad
        ? "fixed"
        : first?.targetPercent
          ? "percent"
          : "rpe";
  const value =
    intensity === "seconds" ? first?.holdSeconds ?? "" : intensity === "fixed" ? first?.targetLoad ?? "" : intensity === "percent" ? first?.targetPercent ?? "" : intensity === "failure" ? "" : first?.targetRpe ?? "";
  return {
    id: uid("ex"),
    name: ex.name,
    cue: "",
    video: ex.video ?? (ex.clip ? "https://" : ""),
    sets: ex.sets.length || 1,
    reps: first?.targetReps ?? "",
    intensity,
    value,
    suggest: first?.targetSuggest ?? "",
    scheme: "Top set",
    mainLift: ex.mainLift,
  };
}

function rowToEx(row: ExRow): ExerciseTemplate {
  // Safety net: if the coach didn't pick a main lift but the name is clearly a
  // comp/main lift ("comp squat" / "squat"…), tag it so PRs, progress and volume
  // all attribute it correctly. Variations (paused, RDL…) stay accessories.
  const mainLift = row.mainLift ?? inferLift(row.name);
  const requiresRpe = row.intensity === "rpe" && mainLift != null;
  // "load" (legacy) and "fixed" are the same now — a prescribed working weight.
  const fixed = row.intensity === "fixed" || row.intensity === "load";
  const failure = row.intensity === "failure";
  const timed = row.intensity === "seconds";
  const sets = Array.from({ length: Math.max(1, row.sets) }, () => ({
    targetReps: row.reps,
    targetRpe: row.intensity === "rpe" ? row.value : "",
    requiresRpe,
    // Carry the coach's prescription through to the athlete's set.
    targetLoad: fixed ? row.value : undefined,
    targetPercent: row.intensity === "percent" ? row.value : undefined,
    // Advisory suggested load — only meaningful when there isn't already a fixed
    // load (RPE / %1RM / to-failure rows). Shown to the athlete as a hint, not a cap.
    targetSuggest: !fixed && row.suggest?.trim() ? row.suggest.trim() : undefined,
    fixedLoad: fixed || undefined,
    toFailure: failure || undefined,
    timed: timed || undefined,
    holdSeconds: timed ? row.value : undefined,
  }));
  return {
    name: row.name,
    mainLift,
    kind: mainLift ? "compound" : "accessory",
    scheme: row.scheme,
    clip: !!row.video && row.video !== "https://",
    video: row.video && row.video !== "https://" ? row.video : undefined,
    sets,
  };
}

/** Athlete WeekTemplate (7 weekday slots) built from a coach Week's days. */
export function toTemplate(week: Week): WeekTemplate {
  return Array.from({ length: 7 }, (_, wd) => {
    const day = week.days.find((d) => d.weekday === wd);
    if (!day || day.rest || day.exercises.length === 0) return { rest: true, exercises: [] };
    const alt = day.alt && day.alt.length ? day.alt.map(rowToEx) : undefined;
    return { rest: false, exercises: day.exercises.map(rowToEx), alt, note: day.note?.trim() || undefined };
  });
}

function daysFromDefault(): Day[] {
  return WEEK_ORDER.map((wd) => {
    const d = DEFAULT_WEEK[wd];
    return {
      id: uid("day"),
      weekday: wd,
      rest: d.rest || d.exercises.length === 0,
      exercises: d.exercises.map(exToRow),
    };
  });
}

function seedWeek(name: string, status: Week["status"]): Week {
  return { id: uid("wk"), name, status, days: daysFromDefault() };
}

/** A fresh block (one week from the default layout) optionally dated. */
export function newMesocycle(name: string, startDate?: string): Mesocycle {
  return { id: uid("meso"), name, color: "#5980a6", weeks: [{ id: uid("wk"), name: "WEEK 1", status: "draft", days: daysFromDefault(), startDate }] };
}

function seedProgram(athleteId: string): Program {
  // Renée's / Lieze's real backfilled blocks are coded seeds.
  if (athleteId === "RS1203") return structuredClone(reneeProgram) as Program;
  if (athleteId === "LV222") return structuredClone(liezeProgram) as Program;
  if (athleteId === "SB428") return structuredClone(stefProgram) as Program;
  if (athleteId === "ZITA") return structuredClone(zitaProgram) as Program;
  // Everyone else: a blank Week 1 dated to THIS week, so the moment the coach
  // adds sessions they land on the calendar / grid for that athlete. It only
  // counts as "planned" once it has real training days (no dummy content).
  const n = new Date();
  const todayIso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  const w1: Week = { ...seedWeek("WEEK 1", "draft"), startDate: mondayOf(todayIso) };
  return {
    athleteId,
    currentWeekId: w1.id,
    mesocycles: [{ id: uid("meso"), name: "BLOCK 1", color: "#5980a6", weeks: [w1] }],
  };
}

// --- exercise database -------------------------------------------------------
const DB_SEED: DbExercise[] = [
  { id: "db_compsq", name: "Competition Squat", group: "squat" },
  { id: "db_highbar", name: "High-Bar Squat", group: "squat" },
  { id: "db_front", name: "Front Squat", group: "squat" },
  { id: "db_pause", name: "Pause Squat", group: "squat" },
  { id: "db_tempo", name: "Tempo Squat", group: "squat" },
  { id: "db_hack", name: "Hack Squat", group: "squat" },
  { id: "db_compbn", name: "Competition Bench", group: "bench" },
  { id: "db_larsen", name: "Larsen Bench Press", group: "bench" },
  { id: "db_cgbn", name: "Close-Grip Bench", group: "bench" },
  { id: "db_incdb", name: "Incline DB Press", group: "bench" },
  { id: "db_compdl", name: "Competition Deadlift", group: "deadlift" },
  { id: "db_rdl", name: "Romanian Deadlift", group: "deadlift" },
  { id: "db_deficit", name: "Deficit Deadlift", group: "deadlift" },
  { id: "db_row", name: "Chest-Supported Row", group: "pull" },
  { id: "db_pulldown", name: "Supinated Grip Pulldown", group: "pull" },
  { id: "db_facepull", name: "Face Pull", group: "pull" },
  { id: "db_legpress", name: "Leg Press", group: "accessory" },
  { id: "db_legcurl", name: "Lying Leg Curl", group: "accessory" },
  { id: "db_legext", name: "Leg Extension", group: "accessory" },
  { id: "db_lateral", name: "Lateral Raises", group: "accessory" },
  { id: "db_tricep", name: "Tricep Extension", group: "accessory" },
  { id: "db_calf", name: "Standing Calf Raise", group: "accessory" },
];

const groupToLift: Record<ExGroup, MainLift | null> = { squat: "squat", bench: "bench", deadlift: "deadlift", pull: null, accessory: null };

export function dbToRow(ex: DbExercise): ExRow {
  const isMain = ex.group === "squat" || ex.group === "bench" || ex.group === "deadlift";
  return {
    id: uid("ex"),
    name: ex.name.toUpperCase(),
    cue: "",
    video: ex.video ?? "",
    sets: 3,
    reps: isMain ? "3" : "10",
    intensity: "rpe",
    value: "8",
    scheme: "Top set",
    mainLift: groupToLift[ex.group],
  };
}

export function blankRow(): ExRow {
  return { id: uid("ex"), name: "NEW EXERCISE", cue: "", video: "", sets: 3, reps: "8", intensity: "rpe", value: "8", scheme: "Top set", mainLift: null };
}

// --- persistence -------------------------------------------------------------
// v2: reset every athlete to a blank program (old seeded weeks are orphaned).
const progKey = (athleteId: string) => `ssc.coach.program.v2.${athleteId}`;

const hasTraining = (w: Week) => w.days.some((d) => !d.rest && d.exercises.length > 0);
/**
 * Give any undated week that already has training content a date, so weeks built
 * before dating existed (or on an older app) still land on the calendar / grid.
 * Dates run sequentially from this Monday.
 */
function ensureDated(p: Program): Program {
  const n = new Date();
  let cursor = mondayOf(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`);
  let changed = false;
  const mesocycles = p.mesocycles.map((m) => ({
    ...m,
    weeks: m.weeks.map((w) => {
      if (w.startDate) { cursor = addDays(w.startDate, 7); return w; }
      if (!hasTraining(w)) return w;
      changed = true;
      const dated = { ...w, startDate: cursor };
      cursor = addDays(cursor, 7);
      return dated;
    }),
  }));
  return changed ? { ...p, mesocycles } : p;
}

/** Any block with at least one real training day. */
function programHasTraining(p: Program): boolean {
  return p.mesocycles.some((m) => m.weeks.some(hasTraining));
}

export function loadProgram(athleteId: string): Program {
  try {
    const raw = localStorage.getItem(progKey(athleteId));
    if (raw) {
      const parsed = JSON.parse(raw) as Program;
      // A blank cached program (e.g. from opening a seeded athlete on an older
      // build) must not shadow their real backfilled block — fall back to the seed.
      if (!programHasTraining(parsed) && (athleteId === "RS1203" || athleteId === "LV222" || athleteId === "SB428" || athleteId === "ZITA")) {
        const seed = seedProgram(athleteId);
        saveProgramLocalOnly(seed);
        return seed;
      }
      const migrated = ensureDated(parsed);
      // Local-only: dating is recomputed per device and a seed must never push
      // up and clobber a cloud program the coach built on another device.
      if (migrated !== parsed) saveProgramLocalOnly(migrated);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  const p = seedProgram(athleteId);
  saveProgramLocalOnly(p);
  return p;
}
/** Read a saved program without creating a seed — for read-only planning views. */
export function peekProgram(athleteId: string): Program | null {
  try {
    const raw = localStorage.getItem(progKey(athleteId));
    if (raw) return ensureDated(JSON.parse(raw) as Program);
  } catch {
    /* ignore */
  }
  // Renée's / Lieze's real blocks show on the board / grid before the builder opens.
  if (athleteId === "RS1203") return structuredClone(reneeProgram) as Program;
  if (athleteId === "LV222") return structuredClone(liezeProgram) as Program;
  if (athleteId === "SB428") return structuredClone(stefProgram) as Program;
  if (athleteId === "ZITA") return structuredClone(zitaProgram) as Program;
  return null;
}
// A save hook lets the cloud-sync layer mirror every real edit to Supabase
// without coachProgram needing to know about the network. Seeds/migrations use
// saveProgramLocalOnly so they never trigger it.
let saveHook: ((p: Program) => void) | null = null;
export function setProgramSaveHook(fn: ((p: Program) => void) | null) {
  saveHook = fn;
}
/** Write to this device only — no cloud push. */
export function saveProgramLocalOnly(p: Program) {
  try {
    localStorage.setItem(progKey(p.athleteId), JSON.stringify(p));
  } catch {
    /* storage may be unavailable */
  }
}
export function saveProgram(p: Program) {
  saveProgramLocalOnly(p);
  saveHook?.(p);
}

// The exercise database is a shared catalogue (synced across coaches + the
// Exercises page + the builder), so anything added anywhere shows everywhere.
export function loadExercises(): DbExercise[] {
  return getSharedData<DbExercise[]>("exercises", DB_SEED);
}
export function saveExercises(list: DbExercise[]) {
  setSharedData("exercises", list);
}
export function removeExercise(id: string) {
  saveExercises(loadExercises().filter((e) => e.id !== id));
}
export function addExercise(ex: DbExercise) {
  if (loadExercises().some((e) => e.name.toLowerCase() === ex.name.toLowerCase())) return;
  saveExercises([ex, ...loadExercises()]);
}

// --- shared program library (share blocks between coaches) -------------------
export type SharedProgram = { id: string; name: string; author: string; weeks: number; mesocycle: Mesocycle };

export function getSharedPrograms(): SharedProgram[] {
  return getSharedData<SharedProgram[]>("shared_programs", []);
}
/** Publish a block to the shared library for other coaches to import. */
export function shareProgram(meso: Mesocycle, author: string) {
  const entry: SharedProgram = { id: uid("shared"), name: meso.name, author, weeks: meso.weeks.length, mesocycle: meso };
  setSharedData("shared_programs", [...getSharedPrograms(), entry]);
}
export function removeSharedProgram(id: string) {
  setSharedData("shared_programs", getSharedPrograms().filter((p) => p.id !== id));
}
/** Fresh copy of a shared mesocycle with new ids (safe to add to a program). */
export function cloneShared(src: Mesocycle): Mesocycle {
  return {
    id: uid("meso"),
    name: src.name,
    color: src.color,
    weeks: src.weeks.map((w) => ({
      ...w,
      id: uid("wk"),
      status: "draft" as const,
      days: w.days.map((d) => ({ ...d, id: uid("day"), exercises: d.exercises.map((e) => ({ ...e, id: uid("ex") })) })),
    })),
  };
}

// --- copy-week-forward progression ------------------------------------------
function bump(v: string, delta: number, cap?: number): string {
  const n = parseFloat(v.replace(",", "."));
  if (!isFinite(n)) return v;
  let out = n + delta;
  if (cap != null) out = Math.min(out, cap);
  return String(Math.round(out * 10) / 10);
}
function scale(v: string, pct: number): string {
  const n = parseFloat(v.replace(",", "."));
  if (!isFinite(n)) return v;
  // round to nearest 2.5 (kg-friendly) for loads / percentages
  return String(Math.round((n * (1 + pct / 100)) / 2.5) * 2.5);
}

/**
 * Back-off deload: duplicate the week but drop volume by one set on the
 * back-downs — every exercise except each day's opening (top) movement, floored
 * at one set — and take a touch off RPE. Mirrors how a real deload is written.
 */
export function deloadWeek(src: Week, name: string): Week {
  return {
    id: uid("wk"),
    name,
    status: "draft",
    startDate: nextWeekStart(src.startDate),
    days: src.days.map((d) => ({
      ...d,
      id: uid("day"),
      exercises: d.exercises.map((ex, i) => ({
        ...ex,
        id: uid("ex"),
        sets: i === 0 ? ex.sets : Math.max(1, ex.sets - 1), // keep the top lift, cut the back-downs
        value: ex.intensity === "rpe" ? bump(ex.value, -1, 10) : ex.value,
      })),
    })),
  };
}

export type ProgressOpts = {
  rpeDelta?: number; // +RPE on RPE-prescribed rows
  loadPct?: number; // +% on load/percent rows
  fixedDelta?: number; // +kg on fixed-load rows
  compoundsOnly?: boolean; // only progress the main lifts, hold accessories
};

/**
 * Duplicate a week and progress it. RPE rows move by rpeDelta, load/percent rows
 * by loadPct, fixed-load rows by fixedDelta (kg). With compoundsOnly, accessories
 * (no main lift) are held at last week's numbers.
 */
export function progressWeek(src: Week, name: string, opts: ProgressOpts = {}): Week {
  const { rpeDelta = 0, loadPct = 0, fixedDelta = 0, compoundsOnly = false } = opts;
  return {
    id: uid("wk"),
    name,
    status: "draft",
    startDate: nextWeekStart(src.startDate),
    days: src.days.map((d) => ({
      ...d,
      id: uid("day"),
      exercises: d.exercises.map((ex) => {
        const hold = compoundsOnly && ex.mainLift == null;
        const value = hold
          ? ex.value
          : ex.intensity === "rpe"
            ? bump(ex.value, rpeDelta, 10)
            : ex.intensity === "fixed"
              ? bump(ex.value, fixedDelta)
              : scale(ex.value, loadPct);
        return { ...ex, id: uid("ex"), value };
      }),
    })),
  };
}

// --- week-over-week diff -----------------------------------------------------
// Compares a week's rows to the same day in the previous week (same block) so
// the builder / viewer can flag exactly what a coach changed: prescription,
// suggested load, reps, sets, plus added (NEW) and removed exercises.

export type DiffChange = { from: string; to: string; dir: "up" | "down" | "flat" };
export type RowDiff = { isNew: boolean; changed: boolean; presc?: DiffChange; suggest?: DiffChange; reps?: DiffChange; sets?: DiffChange };
export type DayDiff = { diffs: RowDiff[]; removed: ExRow[]; count: number };

/** Human label of a row's intensity prescription (RPE7 / 120 kg / 80% / to failure / 40 s). */
export function rowPresc(ex: ExRow): string {
  switch (ex.intensity) {
    case "fixed":
    case "load": return `${ex.value || "?"} kg`;
    case "percent": return `${ex.value || "?"}%`;
    case "failure": return "to failure";
    case "seconds": return `${ex.value || "?"} s`;
    default: return ex.value ? `RPE${ex.value}` : "—";
  }
}
const diffNum = (s: string): number | null => {
  const n = parseFloat(String(s).replace(",", "."));
  return isFinite(n) ? n : null;
};
function mkChange(from: string, to: string, fromN: number | null, toN: number | null): DiffChange {
  const dir = fromN != null && toN != null ? (toN > fromN ? "up" : toN < fromN ? "down" : "flat") : "flat";
  return { from, to, dir };
}
/** Diff one row against its previous-week match. prev === undefined ⇒ a new row. */
export function diffRow(cur: ExRow, prev: ExRow | undefined): RowDiff {
  if (!prev) return { isNew: true, changed: true };
  const presc = rowPresc(cur) !== rowPresc(prev) ? mkChange(rowPresc(prev), rowPresc(cur), diffNum(prev.value), diffNum(cur.value)) : undefined;
  const cs = (cur.suggest ?? "").trim(), ps = (prev.suggest ?? "").trim();
  const suggest = cs !== ps && (cs || ps) ? mkChange(ps ? `${ps} kg` : "—", cs ? `${cs} kg` : "—", diffNum(ps), diffNum(cs)) : undefined;
  const reps = cur.reps !== prev.reps ? { from: prev.reps || "—", to: cur.reps || "—", dir: "flat" as const } : undefined;
  const sets = cur.sets !== prev.sets ? mkChange(String(prev.sets), String(cur.sets), prev.sets, cur.sets) : undefined;
  return { isNew: false, changed: !!(presc || suggest || reps || sets), presc, suggest, reps, sets };
}
/**
 * Diff a day's current rows against the same day last week. Matched by exercise
 * name, honoring duplicates by order of appearance.
 *  - prevRows === null ⇒ no previous week (block's week 1): nothing is flagged.
 *  - prevRows === []   ⇒ the day existed last week but was empty/rest: rows are NEW.
 */
export function diffDay(cur: ExRow[], prevRows: ExRow[] | null): DayDiff {
  if (prevRows === null) return { diffs: cur.map(() => ({ isNew: false, changed: false })), removed: [], count: 0 };
  const used = new Set<number>();
  const take = (name: string): ExRow | undefined => {
    const key = name.trim().toLowerCase();
    for (let i = 0; i < prevRows.length; i++) {
      if (!used.has(i) && prevRows[i].name.trim().toLowerCase() === key) { used.add(i); return prevRows[i]; }
    }
    return undefined;
  };
  const diffs = cur.map((c) => diffRow(c, take(c.name)));
  const removed = prevRows.filter((_, i) => !used.has(i));
  return { diffs, removed, count: diffs.filter((d) => d.changed).length + removed.length };
}

// --- smart scheme defaults ---------------------------------------------------
// When a coach types an exercise name, pick the scheme + intensity they'd almost
// always want, so they stop setting it by hand: a comp lift or its variation is a
// working set on RPE (a Top set if it's the first of that lift in the day); anything
// else is an accessory taken to failure. `priorSameLift` = an earlier row that day
// already trains this lift.
export function smartDefaults(name: string, priorSameLift: boolean): { scheme: Scheme; intensity: IntensityType } {
  const lift = looseLift(name);
  if (!lift) return { scheme: "Accessory", intensity: "failure" };
  return { scheme: priorSameLift ? "Working set" : "Top set", intensity: "rpe" };
}
