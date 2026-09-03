import { describe, it, expect } from "vitest";
import { getSession, type WeekTemplate, type DayTemplate, type ProgramLogs } from "./program";

// A Wednesday (weekday 3) session with two exercises, in a specific order.
const ex = (name: string, sets = 1): DayTemplate["exercises"][number] => ({
  name,
  mainLift: null,
  kind: "accessory",
  scheme: "Working set",
  clip: false,
  sets: Array.from({ length: sets }, () => ({ targetReps: "5", targetRpe: "8", requiresRpe: false })),
});

const dayWith = (names: string[]): DayTemplate => ({ rest: false, exercises: names.map((n) => ex(n)) });
const weekWith = (day: DayTemplate): WeekTemplate =>
  Array.from({ length: 7 }, (_, wd) => (wd === 3 ? day : { rest: true, exercises: [] }));

// 2025-01-01 is a Wednesday (weekday 3).
const DATE = "2025-01-01";

describe("frozen logged-day snapshots", () => {
  it("keeps a logged set readable after the coach REORDERS the week", () => {
    const original = dayWith(["SQUAT", "LEG CURL"]); // athlete logged against this order
    // Athlete logged SQUAT (position 0) at 100 kg.
    const logs: ProgramLogs = { [DATE]: { sets: { "0_0": { weightKg: 100 } } } };

    // Coach later swaps the order — now LEG CURL is position 0, SQUAT is position 1.
    const edited = dayWith(["LEG CURL", "SQUAT"]);

    // WITHOUT a frozen snapshot: the 100 kg log (key 0_0) now reads against LEG CURL.
    const broken = getSession(weekWith(edited), logs, DATE);
    const brokenSquat = broken.exercises.find((e) => e.name === "SQUAT");
    expect(brokenSquat?.sets[0].weightKg).toBe(null); // squat looks unlogged — the bug
    expect(broken.loggedCount).toBe(1); // the 100 kg landed on the wrong lift

    // WITH the frozen snapshot (the day the athlete actually logged against):
    const frozen = { [DATE]: original };
    const fixed = getSession(weekWith(edited), logs, DATE, "A", undefined, undefined, frozen);
    const fixedSquat = fixed.exercises.find((e) => e.name === "SQUAT");
    expect(fixedSquat?.sets[0].weightKg).toBe(100); // squat still shows its logged load
    expect(fixed.loggedCount).toBe(1);
    expect(fixed.exercises.map((e) => e.name)).toEqual(["SQUAT", "LEG CURL"]);
  });

  it("keeps a session 'finished' after the coach ADDS exercises to the week", () => {
    const original = dayWith(["BENCH"]); // one exercise, athlete logged it
    const logs: ProgramLogs = { [DATE]: { sets: { "0_0": { weightKg: 80 } } } };

    // Coach adds two more exercises → setCount jumps, so the 70%-logged fallback drops.
    const edited = dayWith(["BENCH", "TRICEP", "FLY"]);

    const broken = getSession(weekWith(edited), logs, DATE);
    expect(broken.finished).toBe(false); // 1 of 3 logged → reads unfinished (the bug)

    const fixed = getSession(weekWith(edited), logs, DATE, "A", undefined, undefined, { [DATE]: original });
    expect(fixed.finished).toBe(true); // 1 of 1 against the frozen day → still done
  });

  it("uses the live template for dates the athlete has NOT logged (no snapshot)", () => {
    const edited = dayWith(["LEG CURL", "SQUAT"]);
    const empty: ProgramLogs = {};
    const s = getSession(weekWith(edited), empty, DATE, "A", undefined, undefined, {});
    expect(s.exercises.map((e) => e.name)).toEqual(["LEG CURL", "SQUAT"]); // follows the edit
  });
});
