import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ supabase: {}, coachSupabase: {} }));

describe("repMaxRows", () => {
  it("an X-RM is the heaviest load done for at least X reps, with its date", async () => {
    const { repMaxRows } = await import("./athleteData");
    const b = { maxLoad: 150, byReps: { 1: 150, 3: 140, 5: 125 }, byRepsDate: { 1: "2026-09-01", 3: "2026-10-26", 5: "2026-08-10" }, e1rm: 0, mainLift: "squat" as const };
    const rows = repMaxRows(b, 12);
    expect(rows[0]).toEqual({ reps: 1, kg: 150, date: "2026-09-01" });
    expect(rows[1]).toEqual({ reps: 2, kg: 140, date: "2026-10-26" }); // proven by the 3-rep set
    expect(rows[2]).toEqual({ reps: 3, kg: 140, date: "2026-10-26" });
    expect(rows[3]).toEqual({ reps: 4, kg: 125, date: "2026-08-10" });
    expect(rows[5]).toEqual({ reps: 6, kg: null, date: null });
    expect(rows).toHaveLength(12);
  });
});
