import { describe, it, expect } from "vitest";
import { parseSheet, parseIntensity } from "./parseSheet";

describe("parseIntensity", () => {
  it("reads RPE forms", () => {
    expect(parseIntensity("@8")).toEqual(["rpe", 8]);
    expect(parseIntensity("RPE 7.5")).toEqual(["rpe", 7.5]);
    expect(parseIntensity("8")).toEqual(["rpe", 8]);
  });
  it("reads percent forms", () => {
    expect(parseIntensity("80%")).toEqual(["percent", 80]);
    expect(parseIntensity("82.5 %")).toEqual(["percent", 82.5]);
    expect(parseIntensity("75")).toEqual(["percent", 75]); // bare >10 => percent
  });
  it("reads relative offsets", () => {
    expect(parseIntensity("+5")).toEqual(["relative", 5]);
    expect(parseIntensity("-10kg")).toEqual(["relative", -10]);
  });
  it("returns nulls when unsure", () => {
    expect(parseIntensity("heavy")).toEqual([null, null]);
  });
});

describe("parseSheet (TSV with headers)", () => {
  const tsv = [
    "Day\tExercise\tSets\tReps\tIntensity\tNotes",
    "Mon\tBack Squat\t5\t3\t@8\tbelt",
    "Mon\tRDL\t3\t8\t70%\t",
    "Wed\tBench Press\t4\t5\t@7\tpause",
    "Wed\tBad Row\t3\t10\theavy\t", // unreadable intensity -> warning
  ].join("\n");

  it("groups rows into sessions by day", () => {
    const { sessions } = parseSheet(tsv);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].day).toBe("Mon");
    expect(sessions[0].rows.map((r) => r.exercise_name)).toEqual(["Back Squat", "RDL"]);
    expect(sessions[1].rows[0].exercise_name).toBe("Bench Press");
  });

  it("parses sets/reps/intensity into the program model", () => {
    const { sessions } = parseSheet(tsv);
    const squat = sessions[0].rows[0];
    expect(squat).toMatchObject({
      target_sets: 5, target_reps: 3, intensity_type: "rpe", intensity_value: 8, coach_note: "belt",
    });
    const rdl = sessions[0].rows[1];
    expect(rdl).toMatchObject({ intensity_type: "percent", intensity_value: 70 });
  });

  it("flags cells it couldn't parse instead of dropping the row", () => {
    const { sessions, warnings } = parseSheet(tsv);
    const badRow = sessions[1].rows[1];
    expect(badRow.exercise_name).toBe("Bad Row"); // row kept
    expect(badRow.intensity_type).toBeNull();
    expect(warnings.some((w) => w.message.includes("heavy"))).toBe(true);
  });
});

describe("parseSheet (CSV, blank-line separated, no Day column)", () => {
  const csv = [
    "Exercise,Sets,Reps,Intensity",
    "Squat,3,5,80%",
    "",
    "Deadlift,1,3,@9",
  ].join("\n");

  it("uses blank lines to separate sessions when there's no day", () => {
    const { sessions } = parseSheet(csv);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe("Session A");
    expect(sessions[1].name).toBe("Session B");
    expect(sessions[1].rows[0].exercise_name).toBe("Deadlift");
  });
});
