import { describe, it, expect } from "vitest";
import { mergeField, mergeRecord } from "./merge";

describe("three-way field merge", () => {
  it("takes remote when this device didn't change the field", () => {
    // base=100, local unchanged (100), remote changed to 105 -> remote wins, no conflict.
    expect(mergeField(100, 100, 105)).toEqual({ value: 105, conflict: false });
  });
  it("takes local when the server didn't change the field", () => {
    expect(mergeField(100, 105, 100)).toEqual({ value: 105, conflict: false });
  });
  it("no conflict when both changed to the same value", () => {
    expect(mergeField(100, 110, 110)).toEqual({ value: 110, conflict: false });
  });
  it("flags a conflict when both changed differently (local wins the row)", () => {
    expect(mergeField(100, 105, 110)).toEqual({ value: 105, conflict: true });
  });
  it("normalises undefined to null", () => {
    expect(mergeField(undefined, undefined, 5)).toEqual({ value: 5, conflict: false });
  });
});

describe("record merge (disjoint edits auto-merge)", () => {
  it("merges non-overlapping field edits with no conflict", () => {
    // base: weight 100 / reps 5. This device changed weight; server changed reps.
    const base = { weight_kg: 100, reps: 5, rpe: null, velocity: null, notes: null, set_number: 1 };
    const local = { ...base, weight_kg: 105 };
    const remote = { ...base, reps: 3 };
    const { merged, conflicts } = mergeRecord(
      ["weight_kg", "reps", "rpe", "velocity", "notes", "set_number"],
      base, local, remote,
    );
    expect(conflicts).toHaveLength(0);
    expect(merged.weight_kg).toBe(105); // local edit preserved
    expect(merged.reps).toBe(3); // remote edit preserved
  });

  it("flags overlapping edits and preserves both values", () => {
    const base = { weight_kg: 100, reps: 5, rpe: null, velocity: null, notes: null, set_number: 1 };
    const local = { ...base, weight_kg: 105 };
    const remote = { ...base, weight_kg: 110 };
    const { merged, conflicts } = mergeRecord(
      ["weight_kg", "reps", "rpe", "velocity", "notes", "set_number"],
      base, local, remote,
    );
    expect(merged.weight_kg).toBe(105); // incoming write wins the row
    expect(conflicts).toEqual([{ field: "weight_kg", base: 100, local: 105, remote: 110 }]);
  });
});
