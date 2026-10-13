import { describe, it, expect } from "vitest";
import { countsForLift, nameInLiftFamily, inferLift } from "./deriveRecords";
import { movementGroup } from "../../app/coach/coachProgram";

// Regression: a leg press saved with mainLift "bench" was inflating the bench
// 1RM (e.g. 140 kg) because PR/e1RM derivation trusted the tag blindly.
describe("lift-family guard (mis-tagged accessory)", () => {
  it("rejects a leg press tagged bench", () => {
    expect(countsForLift({ name: "Leg Press", mainLift: "bench" }, "bench")).toBe(false);
    expect(nameInLiftFamily("Leg Press", "bench")).toBe(false);
  });

  it("keeps genuine bench variations", () => {
    for (const name of ["Comp benchpress", "2CT paused benchpress", "Larsen benchpress", "Midgrip benchpress"]) {
      expect(countsForLift({ name, mainLift: "bench" }, "bench")).toBe(true);
    }
  });

  it("keeps squat and deadlift variations, rejects their accessories", () => {
    expect(countsForLift({ name: "Pause Squat", mainLift: "squat" }, "squat")).toBe(true);
    expect(countsForLift({ name: "Front Squat", mainLift: "squat" }, "squat")).toBe(true);
    expect(countsForLift({ name: "Romanian Deadlift", mainLift: "deadlift" }, "deadlift")).toBe(true);
    expect(countsForLift({ name: "RDL", mainLift: "deadlift" }, "deadlift")).toBe(true);
    // Accessories mis-tagged as a comp lift are excluded.
    expect(countsForLift({ name: "Leg Curl", mainLift: "deadlift" }, "deadlift")).toBe(false);
    expect(countsForLift({ name: "Leg Extension", mainLift: "squat" }, "squat")).toBe(false);
  });

  it("honours the competition flag as an escape hatch for odd-named variations", () => {
    // A variation whose name shares no family word still counts when flagged comp.
    expect(countsForLift({ name: "Spoto Press", mainLift: "bench", competition: true }, "bench")).toBe(true);
    expect(countsForLift({ name: "Spoto Press", mainLift: "bench" }, "bench")).toBe(false);
  });

  it("does nothing when the tag doesn't match the lift in question", () => {
    expect(countsForLift({ name: "Comp Squat", mainLift: "squat" }, "bench")).toBe(false);
    // Untagged still falls back to inferLift for the plain comp lift.
    expect(inferLift("Comp Squat")).toBe("squat");
    expect(countsForLift({ name: "Comp Squat", mainLift: null }, "squat")).toBe(true);
  });
});

describe("movementGroup (viewer colour-coding)", () => {
  it("colours main lifts and their variations by lift", () => {
    expect(movementGroup({ name: "Comp benchpress", mainLift: "bench" })).toBe("bench");
    expect(movementGroup({ name: "2CT paused benchpress", mainLift: "bench" })).toBe("bench");
    expect(movementGroup({ name: "Front Squat", mainLift: "squat" })).toBe("squat");
    expect(movementGroup({ name: "Romanian Deadlift", mainLift: "deadlift" })).toBe("deadlift");
  });

  it("colours a mis-tagged leg press as a neutral accessory, not bench", () => {
    expect(movementGroup({ name: "Leg Press", mainLift: "bench" })).toBe("accessory");
  });

  it("detects back / pull work by name", () => {
    for (const name of ["Chest-Supported Row", "Supinated Grip Pulldown", "Face Pull", "Pull-ups", "Lat Pulldown"]) {
      expect(movementGroup({ name, mainLift: null })).toBe("pull");
    }
  });

  it("leaves genuine accessories neutral", () => {
    for (const name of ["Leg Press", "Lying Leg Curl", "Leg Extension", "Lateral Raises", "Tricep Extension", "Standing Calf Raise"]) {
      expect(movementGroup({ name, mainLift: null })).toBe("accessory");
    }
  });

  it("groups every S/B/D variation with its lift by name — even untagged", () => {
    for (const name of ["Paused Squat", "Tempo Squat", "2CT paused squat", "Front Squat", "Box Squat", "Pin Squat", "Hack Squat"])
      expect(movementGroup({ name, mainLift: null })).toBe("squat");
    for (const name of ["Paused Bench", "Tempo benchpress", "Midgrip benchpress", "Close-Grip Bench", "Larsen Bench Press", "Spoto Press", "Floor Press"])
      expect(movementGroup({ name, mainLift: null })).toBe("bench");
    for (const name of ["RDL", "B-stance RDL", "Romanian Deadlift", "Stiff-leg deadlift", "Deficit Deadlift", "Rack Pull", "Block Pulls", "2CT paused deadlift"])
      expect(movementGroup({ name, mainLift: null })).toBe("deadlift");
  });
});
