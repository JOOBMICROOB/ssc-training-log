import { describe, it, expect } from "vitest";
import { resolveRpe, toTemplate, type ExRow, type Week, type RpeMode } from "./coachProgram";

const row = (name: string, sets: number, rpeMode?: RpeMode): ExRow => ({
  id: "x", name, cue: "", video: "", sets, reps: "5", intensity: "rpe", value: "8", scheme: "Working set", mainLift: null, rpeMode,
});
const weekWith = (r: ExRow): Week => ({
  id: "w", name: "W1", status: "draft",
  days: [{ id: "d", weekday: 1, rest: false, exercises: [r] }],
});
// toTemplate builds 7 weekday slots; Monday = index 1
const setsOf = (r: ExRow) => toTemplate(weekWith(r))[1].exercises[0].sets.map((s) => s.requiresRpe);

describe("perceived-RPE resolution", () => {
  it("auto: on for SBD lifts + variations, off for isolation", () => {
    expect(resolveRpe(row("Comp squats", 3)).ask).toBe(true);
    expect(resolveRpe(row("2CT paused benchpress", 3)).ask).toBe(true); // variation
    expect(resolveRpe(row("Larsen benchpress paused", 3)).ask).toBe(true);
    expect(resolveRpe(row("Lat pulldown", 3)).ask).toBe(false); // isolation
    expect(resolveRpe(row("Lateral raises", 3)).ask).toBe(false);
  });
  it("each: RPE on every set", () => {
    expect(setsOf(row("Lat pulldown", 3, "each"))).toEqual([true, true, true]);
  });
  it("last: RPE only on the final set (one RPE for the exercise)", () => {
    expect(setsOf(row("Comp squats", 3, "last"))).toEqual([false, false, true]);
  });
  it("off: never asks, even for a compound", () => {
    expect(setsOf(row("Comp squats", 3, "off"))).toEqual([false, false, false]);
  });
  it("auto on a variation asks every set", () => {
    expect(setsOf(row("Tempo squats", 2))).toEqual([true, true]);
  });
});
