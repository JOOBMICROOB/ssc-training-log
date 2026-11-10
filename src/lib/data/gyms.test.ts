import { describe, it, expect, vi, beforeEach } from "vitest";
import { isGymSpecific, mergeGyms, mainGymId } from "../program/gyms";

vi.mock("../supabase", () => ({ supabase: {}, coachSupabase: {} }));

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  // save() queues a cloud push; in node there's no window, so give it a harmless one.
  (globalThis as unknown as { window: unknown }).window = { setTimeout: () => 0, addEventListener: () => {} };
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k), key: () => null, length: 0,
  };
});

describe("isGymSpecific", () => {
  it("machines, cables and dumbbells are per gym; barbell work never is", () => {
    expect(isGymSpecific({ name: "Lat pulldown", mainLift: null })).toBe(true);
    expect(isGymSpecific({ name: "DB row", mainLift: null })).toBe(true);
    expect(isGymSpecific({ name: "Leg press", mainLift: "squat" })).toBe(true); // a machine, even if filed under squat
    expect(isGymSpecific({ name: "Barbell row", mainLift: null })).toBe(false);
    expect(isGymSpecific({ name: "RDL", mainLift: null })).toBe(false);
    expect(isGymSpecific({ name: "Comp squat", mainLift: "squat" })).toBe(false);
    expect(isGymSpecific({ name: "Paused bench", mainLift: "bench" })).toBe(false);
  });
});

describe("mergeGyms", () => {
  it("unions gyms, keeps tombstones, newest main choice wins", () => {
    const a = { list: { g1: { id: "g1", name: "Atlas", city: "Roeselare", type: "plbb" as const, updatedAt: 1 } }, main: { id: "g1", at: 1 } };
    const b = { list: { g2: { id: "g2", name: "Basic-Fit", city: "Gent", type: "commercial" as const, updatedAt: 2 } }, main: { id: "g2", at: 5 } };
    const m = mergeGyms(a, b)!;
    expect(Object.keys(m.list).sort()).toEqual(["g1", "g2"]);
    expect(mainGymId(m)).toBe("g2");
    const del = mergeGyms(m, { list: { g2: { ...b.list.g2, deleted: true, updatedAt: 9 } } })!;
    expect(mainGymId(del)).toBe("g1"); // main was removed → falls back to the remaining gym
  });
});

const rest = { rest: true, exercises: [] };
const day = { rest: false, exercises: [
  { name: "Comp squat", mainLift: "squat", kind: "compound", scheme: "1×5", sets: [{ targetReps: "5" }] },
  { name: "Lat pulldown", mainLift: null, kind: "accessory", scheme: "1×10", sets: [{ targetReps: "10" }] },
] };
const week = [rest, day, rest, rest, rest, rest, rest];

describe("per-gym history", () => {
  it("a machine's 'last time' and bests come from the same gym; barbell stays shared", async () => {
    const A = await import("./athleteData");
    mem.set("ssc.dashboard.T", JSON.stringify({
      athlete: { firstName: "Lieze" },
      publishedWeeks: { "2026-10-19": { week }, "2026-10-26": { week }, "2026-11-02": { week } },
      gyms: { list: { home: { id: "home", name: "Atlas", city: "", type: "plbb", updatedAt: 1 }, away: { id: "away", name: "Basic-Fit", city: "", type: "commercial", updatedAt: 2 } }, main: { id: "home", at: 1 } },
      programLogs: {
        "2026-10-19": { gymId: "home", sets: { "0_0": { weightKg: 120 }, "1_0": { weightKg: 60 } } },
        "2026-10-26": { gymId: "away", sets: { "0_0": { weightKg: 125 }, "1_0": { weightKg: 45 } } },
      },
    }));
    // This Monday at the main gym: the pulldown's last time is two weeks ago at Atlas (60),
    // not last week's 45 at Basic-Fit. The squat still shows plain last week (125).
    const s = A.getSessionFor("T", "2026-11-02");
    expect(s.exercises[1].sets[0].lastWeekKg).toBe(60);
    expect(s.exercises[1].lastAt).toEqual({ gym: "Atlas", date: "2026-10-19" });
    expect(s.exercises[0].sets[0].lastWeekKg).toBe(125);
    expect(s.exercises[0].lastAt).toBeUndefined();
    // Bests per gym for the machine only.
    expect(A.exerciseBests("T", "away").get("lat pulldown")?.maxLoad).toBe(45);
    expect(A.exerciseBests("T", "home").get("lat pulldown")?.maxLoad).toBe(60);
    expect(A.exerciseBests("T", "away").get("comp squat")?.maxLoad).toBe(125);
    // Switching this session to Basic-Fit flips the machine's history.
    A.setSessionGym("T", "2026-11-02", "away");
    expect(A.getSessionFor("T", "2026-11-02").exercises[1].sets[0].lastWeekKg).toBe(45);
  });

  it("the first log of a session is stamped with the main gym", async () => {
    const A = await import("./athleteData");
    mem.set("ssc.dashboard.U", JSON.stringify({ athlete: { firstName: "X" }, publishedWeeks: { "2026-11-02": { week } } }));
    const id = A.saveGym("U", { name: "Atlas", city: "Roeselare", type: "plbb" });
    A.logSet("U", "2026-11-02", "1_0", { weightKg: 50 });
    expect(A.getDashboard("U").programLogs["2026-11-02"].gymId).toBe(id);
  });
});

describe("streak freeze", () => {
  it("a frozen missed day no longer breaks the streak", async () => {
    const A = await import("./athleteData");
    const logged = { sets: { "0_0": { weightKg: 100 }, "1_0": { weightKg: 50 } } };
    mem.set("ssc.dashboard.S", JSON.stringify({
      athlete: { firstName: "Lieze" },
      publishedWeeks: { "2026-10-19": { week }, "2026-10-26": { week }, "2026-11-02": { week } },
      programLogs: { "2026-10-19": logged, "2026-11-02": logged }, // missed Mon 26 Oct
    }));
    const today = new Date("2026-11-03T12:00:00");
    const before = A.streakInfo("S", today);
    expect(before.streak).toBe(1);
    expect(before.breakDay).toBe("2026-10-26");
    A.setStreakFreeze("S", "2026-10-26", true);
    const after = A.streakInfo("S", today);
    expect(after.streak).toBe(2);
    expect(after.frozen).toEqual(["2026-10-26"]);
    A.setStreakFreeze("S", "2026-10-26", false);
    expect(A.streakInfo("S", today).streak).toBe(1);
  });
});
