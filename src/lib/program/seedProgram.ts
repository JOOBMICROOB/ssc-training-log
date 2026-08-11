import type { ExerciseTemplate, SetTemplate, WeekTemplate } from "./program";

/**
 * Renée's current weekly program (week of Mon 3 Aug 2026), transcribed from the
 * coach's sheet. Weekday index: 0=Sun … 6=Sat. Train Mon/Tue/Thu/Fri/Sat, rest
 * Wed + Sun. Loads are the coach-prescribed working weights (targetLoad); RPE is
 * the intensity guide. This is the default template until the coach publishes a
 * new week from the console.
 */

type Opt = { rpe?: string; load?: string };
const S = (n: number, reps: string, o: Opt = {}, reqRpe = false): SetTemplate[] =>
  Array.from({ length: n }, () => ({
    targetReps: reps,
    targetRpe: o.rpe ?? "",
    requiresRpe: reqRpe,
    ...(o.load ? { targetLoad: o.load } : {}),
  }));

const main = (name: string, lift: ExerciseTemplate["mainLift"], sets: SetTemplate[]): ExerciseTemplate =>
  ({ name, mainLift: lift, kind: "compound", scheme: "", clip: false, sets });
const acc = (name: string, sets: SetTemplate[]): ExerciseTemplate =>
  ({ name, mainLift: null, kind: "accessory", scheme: "", clip: false, sets });

const REST = { rest: true, exercises: [] as ExerciseTemplate[] };

/**
 * Blank week — the default until the coach writes and publishes a program. Every
 * athlete starts here (no sessions) so nothing is programmed until it's built in
 * the console. Renée's real transcribed week is kept below as RENEE_WEEK, ready
 * to load into the builder when we set up her first block.
 */
export const DEFAULT_WEEK: WeekTemplate = Array.from({ length: 7 }, () => ({ rest: true, exercises: [] as ExerciseTemplate[] }));

/** Renée's real week, transcribed from the coach's sheet — build source only. */
export const RENEE_WEEK: WeekTemplate = [
  // 0 Sun — rest
  REST,
  // 1 Mon — Session 1
  {
    rest: false,
    exercises: [
      main("COMP SQUAT", "squat", S(1, "1", { rpe: "6", load: "115" }, true)),
      main("COMP SQUAT", "squat", S(3, "4", { rpe: "6", load: "100" }, true)),
      acc("DIPS PAUSED", S(3, "6-8", { rpe: "6", load: "6" })),
      acc("BULGARIAN SPLIT SQUAT", S(3, "8-10", { load: "40" })),
      acc("UNILATERAL ROW", S(3, "10", { load: "17,5" })),
      acc("COPENHAGEN PLANK", S(2, "10-12", { load: "20" })),
    ],
  },
  // 2 Tue — Session 2
  {
    rest: false,
    exercises: [
      main("CLUSTER DEADLIFT 2CT PAUSE", "deadlift", S(4, "1", { load: "100" }, true)),
      main("RDL", "deadlift", S(3, "6-8", { rpe: "6", load: "60" }, true)),
      main("LONG PAUSED BENCH", "bench", S(4, "2", { rpe: "6", load: "60" }, true)),
      acc("FEET-UP DB BENCH", S(3, "8-10", { rpe: "6", load: "18" })),
      acc("UNILATERAL TRICEP EXTENSION", S(3, "8-10", { load: "8" })),
      acc("SUPINATED GRIP PULLDOWN", S(3, "10-12", { load: "45" })),
    ],
  },
  // 3 Wed — rest
  REST,
  // 4 Thu — Session 3
  {
    rest: false,
    exercises: [
      main("COMP SQUAT", "squat", S(3, "6", { rpe: "6", load: "85" }, true)),
      main("COMP BENCH", "bench", S(1, "1", { rpe: "6" }, true)),
      main("COMP BENCH", "bench", S(4, "4", { rpe: "6", load: "60-62,5" }, true)),
      acc("LEG EXTENSION", S(3, "8-10", { rpe: "8" })),
      acc("LATERAL RAISES", S(3, "6-10")),
      acc("TRICEP EXTENSION OF CHOICE", S(2, "8-10")),
      acc("PLANKS (BRACE EMPHASIS)", S(3, "20-60 sec")),
    ],
  },
  // 5 Fri — Session 4
  {
    rest: false,
    exercises: [
      main("COMP DEADLIFT", "deadlift", S(1, "1", { rpe: "5", load: "115-120" }, true)),
      main("COMP DEADLIFT", "deadlift", S(1, "4", { rpe: "4", load: "95-102,5" }, true)),
      main("COMP DEADLIFT", "deadlift", S(1, "4", { rpe: "5", load: "100-107,5" }, true)),
      main("COMP DEADLIFT", "deadlift", S(1, "4", { rpe: "6", load: "105-112,5" }, true)),
      main("LARSEN BENCH", "bench", S(3, "5", { rpe: "6", load: "50" }, true)),
      acc("SHOULDER PRESS MACHINE", S(3, "8-10", { rpe: "7" })),
      acc("TRICEP EXTENSION OF CHOICE", S(2, "12", { rpe: "8" })),
      acc("ABDUCTION WITH BAND", S(2, "10-12", { rpe: "8" })),
    ],
  },
  // 6 Sat — Session 5
  {
    rest: false,
    exercises: [
      main("PAUSED SQUAT", "squat", S(4, "3", { load: "90" }, true)),
      main("2CT PAUSED BENCH", "bench", S(1, "1", { load: "65" }, true)),
      main("COMP BENCH", "bench", S(4, "3", { load: "60" }, true)),
      acc("INCLINE PRESS (MACHINE/DB)", S(3, "8-10", { rpe: "8" })),
      acc("CHEST SUPPORTED ROW", S(2, "12", { rpe: "8" })),
      acc("BICEP CURLS OF CHOICE", S(3, "8-10", { rpe: "8" })),
    ],
  },
];
