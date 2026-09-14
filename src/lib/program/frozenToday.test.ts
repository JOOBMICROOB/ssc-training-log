import { describe, it, expect } from "vitest";
import { getSession } from "./program";
import type { WeekTemplate, ProgramLogs, DayTemplate } from "./program";

const rest: DayTemplate = { rest: true, exercises: [] };
const ex = (name: string): DayTemplate => ({ rest: false, exercises: [{ name, mainLift: "squat", kind: "compound", scheme: "Working set", clip: false, sets: [{ targetReps: "3", targetRpe: "8", requiresRpe: true }] }] });
// Monday(1) live template has the NEW full session (2 exercises); frozen has the OLD single.
const liveMon: DayTemplate = { rest: false, exercises: [ex("NEW SQUAT").exercises[0], ex("NEW BENCH").exercises[0]] };
const template: WeekTemplate = [rest, liveMon, rest, rest, rest, rest, rest];
const frozenOld: DayTemplate = ex("OLD SQUAT SINGLE"); // 1 exercise
const logs: ProgramLogs = {};
const TODAY = "2026-09-14"; // Monday

describe("frozen day is ignored for today/future, used for the past", () => {
  it("today: shows the freshly published template, not the stale frozen single", () => {
    const s = getSession(template, logs, "2026-09-14", "A", undefined, undefined, { "2026-09-14": frozenOld }, TODAY);
    expect(s.exercises.map((e) => e.name)).toEqual(["NEW SQUAT", "NEW BENCH"]);
  });
  it("future: also uses the live template", () => {
    const s = getSession(template, logs, "2026-09-21", "A", undefined, undefined, { "2026-09-21": frozenOld }, TODAY);
    expect(s.exercises.map((e) => e.name)).toEqual(["NEW SQUAT", "NEW BENCH"]);
  });
  it("past: still honours the frozen snapshot (logged history preserved)", () => {
    const s = getSession(template, logs, "2026-09-07", "A", undefined, undefined, { "2026-09-07": frozenOld }, TODAY);
    expect(s.exercises.map((e) => e.name)).toEqual(["OLD SQUAT SINGLE"]);
  });
  it("no todayISO passed → old behaviour (frozen always wins)", () => {
    const s = getSession(template, logs, "2026-09-14", "A", undefined, undefined, { "2026-09-14": frozenOld });
    expect(s.exercises.map((e) => e.name)).toEqual(["OLD SQUAT SINGLE"]);
  });
});
