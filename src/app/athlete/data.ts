/** Athlete-side demo data, shaped to the Claude Design frames (2a/1a/6a). */
export interface PR { lift: "SQUAT" | "BENCH" | "DEADLIFT"; kg: number; date: string; delta: number; }
export interface WorkingSet { no: number; targetReps: number; targetKg: number; rpe: number; }
export interface WarmupSet { label: string; kg: number; reps: number; }
export interface Accessory { name: string; scheme: string; }
export interface LiftProgress {
  lift: "SQUAT" | "BENCH" | "DEADLIFT";
  e1rm: number; e1rmDelta: string;
  trend: number[];            // weekly e1RM bars W1..W8
  rms: { label: string; kg: number }[];
}

export const ATHLETE = {
  firstName: "Renée",
  block: "Block 1", week: 1, weekLabel: "Jul 27 – Aug 2",
  age: 24, goalClass: "69 kg", bodyweight: 68, trainingAge: "4 yr",
  bestTotal: 330, bestTotalDelta: 12.5,
  nextSession: { title: "Deadlift & Bench session", day: "Friday", unfinished: "Mon, Thu" },
  adherence: { pct: 61, setsDone: 44, setsTotal: 65, rpeDone: 29, rpeTotal: 42, extrasDone: 0, extrasTotal: 2 },
};

export const PRS: PR[] = [
  { lift: "SQUAT", kg: 105, date: "Jun 2026", delta: 5 },
  { lift: "BENCH", kg: 62.5, date: "May 2026", delta: 2.5 },
  { lift: "DEADLIFT", kg: 130, date: "Jun 2026", delta: 7.5 },
];

export const TODAY_SESSION = {
  title: "Comp Squats", subtitle: "back-off sets",
  topSetKg: 130,
  prevBestE1rm: 137.5,
  warmups: [
    { label: "Empty bar", kg: 20, reps: 8 },
    { label: "40%", kg: 52.5, reps: 5 },
    { label: "60%", kg: 77.5, reps: 4 },
    { label: "75%", kg: 97.5, reps: 3 },
    { label: "85%", kg: 110, reps: 2 },
    { label: "95%", kg: 122.5, reps: 1 },
  ] as WarmupSet[],
  working: [
    { no: 1, targetReps: 3, targetKg: 120, rpe: 7 },
    { no: 2, targetReps: 3, targetKg: 125, rpe: 8 },
    { no: 3, targetReps: 3, targetKg: 130, rpe: 8.5 },
  ] as WorkingSet[],
  accessories: [
    { name: "Paused dips", scheme: "3 × 6–8 · RPE8" },
    { name: "Bulgarian split squats", scheme: "3 × 8–10 · RPE8" },
    { name: "Unilateral row", scheme: "3 × 10" },
    { name: "Copenhagen planks", scheme: "2 × 10–12" },
  ] as Accessory[],
};

export const LIFTS: Record<PR["lift"], LiftProgress> = {
  SQUAT: { lift: "SQUAT", e1rm: 135, e1rmDelta: "+7.5 over 8 weeks",
    trend: [118, 121, 120, 124, 127, 131, 134, 135],
    rms: [{ label: "1RM", kg: 132.5 }, { label: "2RM", kg: 130 }, { label: "3RM", kg: 125 }, { label: "4RM", kg: 122.5 }] },
  BENCH: { lift: "BENCH", e1rm: 78, e1rmDelta: "+3.0 over 8 weeks",
    trend: [70, 71, 72, 72, 74, 75, 77, 78],
    rms: [{ label: "1RM", kg: 76 }, { label: "2RM", kg: 73 }, { label: "3RM", kg: 70 }, { label: "4RM", kg: 68 }] },
  DEADLIFT: { lift: "DEADLIFT", e1rm: 162, e1rmDelta: "+10.0 over 8 weeks",
    trend: [148, 150, 151, 154, 156, 158, 160, 162],
    rms: [{ label: "1RM", kg: 160 }, { label: "2RM", kg: 152 }, { label: "3RM", kg: 147 }, { label: "4RM", kg: 143 }] },
};

export const TONNAGE = {
  week: 35.7,
  rows: [
    { day: "Mon · Squat", kg: 8420, frac: 1 },
    { day: "Tue · Bench", kg: 4980, frac: 0.59 },
    { day: "Thu · Deadlift", kg: 9150, frac: 1.08 },
    { day: "Fri · Bench", kg: 5240, frac: 0.62 },
    { day: "Sat · Squat", kg: 7860, frac: 0.93 },
  ],
};
