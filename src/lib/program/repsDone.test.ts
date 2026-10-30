import { describe, it, expect } from "vitest";
import { getSession, type WeekTemplate } from "./program";

const rest = { rest: true, exercises: [] };
const squat = { rest: false, exercises: [{ name: "Squat", mainLift: "squat", kind: "compound", scheme: "3×5", sets: [{ targetReps: "5" }, { targetReps: "5" }, { targetReps: "5" }] }] };
const week = [rest, squat, rest, rest, rest, rest, rest] as unknown as WeekTemplate;

describe("reps done per set", () => {
  const logs = { "2026-10-26": { sets: { "0_1": { weightKg: 100, repsDone: 4 } } } };

  it("shows the reps the athlete logged on that day", () => {
    const s = getSession(week, logs, "2026-10-26");
    expect(s.exercises[0].sets[1].repsDone).toBe(4);
    expect(s.exercises[0].sets[1].targetReps).toBe("5");
    expect(s.exercises[0].sets[0].repsDone).toBeNull();
  });

  it("a new week with the same layout starts from the prescription, not last week's reps", () => {
    const s = getSession(week, logs, "2026-11-02", "A", week);
    for (const st of s.exercises[0].sets) {
      expect(st.repsDone).toBeNull();
      expect(st.targetReps).toBe("5");
    }
  });
});
