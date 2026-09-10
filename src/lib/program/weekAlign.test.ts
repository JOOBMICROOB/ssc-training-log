import { describe, it, expect } from "vitest";
import { getWeek } from "./program";
import type { WeekTemplate, ProgramLogs, DayTemplate } from "./program";

/**
 * Regression: a block whose weeks don't all start on the display week-start day.
 * Leyton's week 1 started TUESDAY (2026-09-01) and week 2 MONDAY (2026-09-07),
 * while the app displays Monday-aligned weeks. The displayed "previous week"
 * therefore straddles the gap + week 1. Each displayed day must resolve its OWN
 * program week; otherwise the strip renders last week through the wrong week's
 * weekday layout — hiding real sessions and showing phantom ones (the reported
 * "only one session exists instead of all four" / "last week's data on this
 * week's sessions" bug).
 */
const restDay: DayTemplate = { rest: true, exercises: [] };
const train = (name: string): DayTemplate => ({
  rest: false,
  exercises: [{ name, mainLift: "squat", kind: "compound", scheme: "Top set", clip: false, sets: [{ targetReps: "5", targetRpe: "8", requiresRpe: true, targetLoad: "100", fixedLoad: true }] }],
});
// weekday-indexed 0=Sun..6=Sat
const W1: WeekTemplate = [restDay, restDay, train("W1a"), train("W1b"), train("W1c"), train("W1d"), restDay]; // Tue–Fri
const W2: WeekTemplate = [restDay, train("W2a"), restDay, train("W2b"), restDay, train("W2c"), restDay]; // Mon/Wed/Fri
const W1_START = "2026-09-01"; // Tuesday
const W2_START = "2026-09-07"; // Monday
function addDays(iso: string, n: number) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const within = (start: string, date: string) => date >= start && date <= addDays(start, 6);
const EMPTY: WeekTemplate = Array.from({ length: 7 }, () => restDay);
const resolve = (date: string): WeekTemplate => (within(W2_START, date) ? W2 : within(W1_START, date) ? W1 : EMPTY);
const logs: ProgramLogs = {
  "2026-09-01": { sets: { "0_0": { weightKg: 90, rpe: 8 } }, finished: true }, // Tue
  "2026-09-02": { sets: { "0_0": { weightKg: 90, rpe: 8 } }, finished: true }, // Wed
  "2026-09-03": { sets: { "0_0": { weightKg: 90, rpe: 8 } }, finished: true }, // Thu
  "2026-09-04": { sets: { "0_0": { weightKg: 90, rpe: 8 } }, finished: true }, // Fri
  "2026-09-07": { sets: { "0_0": { weightKg: 95, prefill: true } } }, // week2 Mon prefill (NOT a real log)
};

describe("week strip resolves each day's own program week", () => {
  it("previous week shows ALL FOUR of week 1's sessions, each logged", () => {
    const week = getWeek(W1, logs, 1, "2026-09-03", "2026-09-10", undefined, resolve);
    const training = week.filter((d) => !d.rest);
    expect(training.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(training.every((d) => d.loggedCount === 1)).toBe(true);
  });

  it("this week shows only week 2's sessions — no last-week logs bleed in", () => {
    const week = getWeek(W2, logs, 1, "2026-09-10", "2026-09-10", undefined, resolve);
    const training = week.filter((d) => !d.rest);
    expect(training.map((d) => d.date)).toEqual(["2026-09-07", "2026-09-09", "2026-09-11"]);
    // Mon 09-07 is only a coach prefill; nothing this week counts as athlete-logged.
    expect(training.every((d) => d.loggedCount === 0)).toBe(true);
  });

  it("the old single-template behaviour is what hid week 1's sessions", () => {
    // Without a resolver, the previous-week strip is drawn with week 2's weekday
    // layout, so week 1's Tue & Thu sessions vanish (rendered as REST).
    const week = getWeek(W2, logs, 1, "2026-09-03", "2026-09-10");
    expect(week.find((d) => d.date === "2026-09-01")!.rest).toBe(true); // Tue session lost
    expect(week.find((d) => d.date === "2026-09-03")!.rest).toBe(true); // Thu session lost
  });
});
