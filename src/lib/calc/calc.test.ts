import { describe, it, expect } from "vitest";
import { epleyE1rm } from "./epley";
import { wilks, dots, ipfGlPoints } from "./scores";
import { setTonnage, totalTonnage, totalReps } from "./volume";
import { detectPr } from "./pr";

describe("epley e1RM", () => {
  it("returns the weight unchanged for a true single", () => {
    expect(epleyE1rm(200, 1)).toBeCloseTo(200, 6);
  });
  it("adds reps/30 of the weight", () => {
    // 100 * (1 + 5/30) = 116.6666...
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.6667, 3);
  });
  it("is zero for non-positive input", () => {
    expect(epleyE1rm(0, 5)).toBe(0);
    expect(epleyE1rm(100, 0)).toBe(0);
  });
});

// Reference values below were computed by hand from the published coefficient
// sets (see scores.ts provenance). Tolerances are tight enough to catch a
// single mistyped coefficient.
describe("Wilks (classic)", () => {
  it("male 100kg / 600kg total ≈ 365.2", () => {
    expect(wilks("male", 100, 600)).toBeCloseTo(365.2, 0);
  });
  it("scales linearly with total", () => {
    expect(wilks("male", 100, 1200)).toBeCloseTo(2 * wilks("male", 100, 600), 6);
  });
  it("is zero for non-positive input", () => {
    expect(wilks("male", 0, 600)).toBe(0);
    expect(wilks("male", 100, 0)).toBe(0);
  });
});

describe("DOTS", () => {
  it("male 100kg / 600kg total ≈ 369.3", () => {
    expect(dots("male", 100, 600)).toBeCloseTo(369.3, 0);
  });
  it("female 60kg / 400kg total ≈ 443.4", () => {
    expect(dots("female", 60, 400)).toBeCloseTo(443.4, 0);
  });
  it("clamps bodyweight to the fit range (male >210 == 210)", () => {
    expect(dots("male", 250, 600)).toBeCloseTo(dots("male", 210, 600), 6);
  });
});

describe("IPF GL points", () => {
  it("male raw 100kg / 600kg total ≈ 75.8", () => {
    expect(ipfGlPoints("male", 100, 600)).toBeCloseTo(75.8, 0);
  });
  it("bench event differs from full", () => {
    expect(ipfGlPoints("male", 100, 200, "raw_bench")).not.toBeCloseTo(
      ipfGlPoints("male", 100, 200, "raw_full"),
      1,
    );
  });
});

describe("volume / tonnage", () => {
  it("set tonnage is reps * weight", () => {
    expect(setTonnage({ reps: 5, weightKg: 100 })).toBe(500);
  });
  it("sums across sets", () => {
    const sets = [
      { reps: 5, weightKg: 100 },
      { reps: 3, weightKg: 120 },
      { reps: 1, weightKg: 140 },
    ];
    expect(totalTonnage(sets)).toBe(500 + 360 + 140);
    expect(totalReps(sets)).toBe(9);
  });
  it("ignores non-positive entries", () => {
    expect(setTonnage({ reps: 0, weightKg: 100 })).toBe(0);
    expect(setTonnage({ reps: 5, weightKg: -100 })).toBe(0);
  });
});

describe("PR detection", () => {
  it("flags a weight PR against no history", () => {
    const r = detectPr({ weightKg: 100, reps: 3 }, { bestWeightKg: null, bestE1rm: null });
    expect(r.isWeightPr).toBe(true);
    expect(r.isE1rmPr).toBe(true);
    expect(r.isPr).toBe(true);
  });
  it("flags an e1RM PR even when weight is lower", () => {
    // 90x5 -> e1RM 105; beats a prior best e1RM of 100 but not prior best weight 95.
    const r = detectPr(
      { weightKg: 90, reps: 5 },
      { bestWeightKg: 95, bestE1rm: 100 },
    );
    expect(r.e1rm).toBeCloseTo(105, 6);
    expect(r.isWeightPr).toBe(false);
    expect(r.isE1rmPr).toBe(true);
    expect(r.isPr).toBe(true);
  });
  it("is not a PR when it beats nothing", () => {
    const r = detectPr(
      { weightKg: 80, reps: 2 },
      { bestWeightKg: 100, bestE1rm: 130 },
    );
    expect(r.isPr).toBe(false);
  });
});
