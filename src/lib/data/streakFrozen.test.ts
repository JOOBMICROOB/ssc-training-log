import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ supabase: {}, coachSupabase: {} }));

describe("streak survives a re-published, already-logged week", () => {
  it("counts the day against the template it was logged on", async () => {
    const mem = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k), key: () => null, length: 0,
    };
    const { getDashboardModel } = await import("./athleteData");
    const rest = { rest: true, exercises: [] };
    const day = (name: string) => ({ rest: false, exercises: [{ name, sets: [{ targetReps: "5" }, { targetReps: "5" }] }] });
    // Mon 2026-10-26 logged against "Squat"; coach later re-published that Monday as "Bench + Row".
    const republished = [rest, { rest: false, exercises: [day("Bench").exercises[0], day("Row").exercises[0]] }, rest, rest, rest, rest, rest];
    const data = {
      athlete: { firstName: "Lieze" },
      publishedWeeks: { "2026-10-26": { week: republished } },
      programLogs: { "2026-10-26": { sets: { "0_0": { weightKg: 100 }, "0_1": { weightKg: 100 } } } },
      loggedDays: { "2026-10-26": day("Squat") },
    };
    mem.set("ssc.dashboard.LV", JSON.stringify(data));
    const model = getDashboardModel("LV", new Date("2026-10-27T12:00:00"));
    expect(model.streak).toBe(1);
  });
});
