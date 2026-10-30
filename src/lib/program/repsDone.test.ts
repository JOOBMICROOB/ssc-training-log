import { describe, it, expect } from "vitest";
import { getSession, setReps, type WeekTemplate } from "./program";
import { liftProgress } from "./progress";

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

  it("reps done count for RMs / PRs: 4 prescribed, 3 done at 140 → a 3RM, not a 4RM", () => {
    const four = { rest: false, exercises: [{ name: "Squat", mainLift: "squat", kind: "compound", competition: true, scheme: "1×4", sets: [{ targetReps: "4" }] }] };
    const w = [rest, four, rest, rest, rest, rest, rest] as unknown as WeekTemplate;
    const l = { "2026-10-26": { sets: { "0_0": { weightKg: 140, repsDone: 3 } } } };
    const p = liftProgress(w, l, "squat", 1, "2026-10-28");
    expect(p.repMaxes.find((r) => r.reps === 3)?.weight).toBe(140);
    expect(p.repMaxes.find((r) => r.reps === 4)?.weight).toBeNull();
  });

  it("setReps: done wins, else the low end of the prescription", () => {
    expect(setReps({ repsDone: 3, targetReps: "4" })).toBe(3);
    expect(setReps({ repsDone: null, targetReps: "3-5" })).toBe(3);
    expect(setReps({ targetReps: "AMRAP" })).toBeNaN();
  });
});
