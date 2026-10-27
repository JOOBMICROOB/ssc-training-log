import { describe, it, expect, beforeEach, vi } from "vitest";

// --- fakes: an in-memory localStorage + the coach's single app_state row ------
class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const cloud: { row: Record<string, unknown> | null; failWrites: boolean; failReads: boolean } = { row: null, failWrites: false, failReads: false };
const fakeClient = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => (cloud.failReads ? { data: null, error: new Error("offline") } : { data: cloud.row ? { data: structuredClone(cloud.row) } : null, error: null }) }) }),
    upsert: async (v: { data: Record<string, unknown> }) => {
      if (cloud.failWrites) return { error: new Error("offline") };
      cloud.row = structuredClone(v.data);
      return { error: null };
    },
  }),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  auth: { getUser: async () => ({ data: { user: null } }) },
};
vi.mock("../../lib/supabase", () => ({ supabase: fakeClient, coachSupabase: fakeClient }));

const prog = (aid: string, weeks: number, tag = "") => ({
  athleteId: aid,
  currentWeekId: "w0",
  mesocycles: [{
    id: "m", name: `BLOCK${tag}`, color: "#000",
    weeks: Array.from({ length: weeks }, (_, i) => ({
      id: `w${i}`, name: `W${i}`, status: "draft", startDate: `2026-10-${String(5 + i * 7).padStart(2, "0")}`,
      days: [{ id: "d", weekday: 1, rest: false, exercises: [{ id: "x", name: "Squat" }] }],
    })),
  }],
});
type P = ReturnType<typeof prog>;
const LEG = "ssc.coach.program.v2.";

async function load() {
  vi.resetModules();
  const sync = await import("./coachProgramSync");
  const store = await import("./coachProgram");
  return { sync, store };
}
const coachPrograms = () => (cloud.row?.coachPrograms ?? {}) as Record<string, { program: P; updatedAt: string }>;

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  cloud.row = null; cloud.failWrites = false; cloud.failReads = false;
  vi.useRealTimers();
});

describe("coach program migration off localStorage", () => {
  it("backs up every local copy, uploads the better ones, then frees localStorage", async () => {
    const old = "2026-10-01T00:00:00.000Z", newer = "2026-10-20T00:00:00.000Z";
    cloud.row = {
      other: "keep me",
      coachPrograms: {
        B: { program: prog("B", 3, "cloud"), updatedAt: newer }, // cloud newer + bigger → cloud wins
        C: { program: prog("C", 2, "cloud"), updatedAt: old },   // local newer → local wins
        D: { program: prog("D", 1, "cloud"), updatedAt: newer }, // cloud newer (fewer weeks) → cloud still wins
      },
    };
    localStorage.setItem(LEG + "A", JSON.stringify(prog("A", 2, "local"))); // only local
    localStorage.setItem(LEG + "B", JSON.stringify(prog("B", 2, "local")));
    localStorage.setItem("ssc.coach.program.ts.B", old);
    localStorage.setItem(LEG + "C", JSON.stringify(prog("C", 2, "local")));
    localStorage.setItem("ssc.coach.program.ts.C", newer);
    localStorage.setItem(LEG + "D", JSON.stringify(prog("D", 4, "local")));
    localStorage.setItem("ssc.coach.program.ts.D", old);

    const { sync, store } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();

    const cp = coachPrograms();
    expect(cp.A.program.mesocycles[0].name).toBe("BLOCKlocal");
    expect(cp.B.program.mesocycles[0].name).toBe("BLOCKcloud");
    expect(cp.C.program.mesocycles[0].name).toBe("BLOCKlocal");
    expect(cp.D.program.mesocycles[0].weeks.length).toBe(1);
    expect(cloud.row?.other).toBe("keep me");
    // Backup holds every local copy AND the cloud copies that were replaced.
    const backups = Object.values(cloud.row?.coachProgramsBackups as Record<string, { local: Record<string, unknown>; cloudReplaced: Record<string, { program: P }> }>);
    expect(backups).toHaveLength(1);
    expect(Object.keys(backups[0].local).sort()).toEqual(["A", "B", "C", "D"]);
    expect(Object.keys(backups[0].cloudReplaced).sort()).toEqual(["C"]);
    expect(backups[0].cloudReplaced.C.program.mesocycles[0].name).toBe("BLOCKcloud");
    expect((backups[0].local as Record<string, { program: P }>).D.program.mesocycles[0].weeks.length).toBe(4);
    // Local copies are gone; memory shows the winners.
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter((k) => k?.startsWith(LEG))).toEqual([]);
    expect(store.peekStoredProgram("B")?.mesocycles[0].name).toBe("BLOCKcloud");
    expect(store.peekStoredProgram("D")?.mesocycles[0].weeks.length).toBe(1);
  });

  it("keeps the local copies when the cloud can't be written", async () => {
    cloud.row = { coachPrograms: {} };
    localStorage.setItem(LEG + "A", JSON.stringify(prog("A", 2)));
    cloud.failWrites = true;
    const { sync } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();
    expect(localStorage.getItem(LEG + "A")).not.toBeNull();
  });

  it("an edit that never reached the cloud is resent on the next open", async () => {
    cloud.row = { coachPrograms: { A: { program: prog("A", 1), updatedAt: "2026-10-01T00:00:00.000Z" } } };
    vi.useFakeTimers();
    let m = await load();
    m.sync.enableCoachProgramSync("coach");
    await m.sync.pullCoachPrograms();
    cloud.failWrites = true;
    m.store.saveProgram(prog("A", 3, "edited") as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(coachPrograms().A.program.mesocycles[0].weeks.length).toBe(1); // didn't land
    expect(localStorage.getItem("ssc.coach.program.pending.A")).not.toBeNull();

    // Tab closed; next open with the network back.
    cloud.failWrites = false;
    m = await load();
    m.sync.enableCoachProgramSync("coach");
    await m.sync.pullCoachPrograms();
    expect(m.store.peekStoredProgram("A")?.mesocycles[0].name).toBe("BLOCKedited");
    await vi.advanceTimersByTimeAsync(1000);
    expect(coachPrograms().A.program.mesocycles[0].name).toBe("BLOCKedited");
    expect(localStorage.getItem("ssc.coach.program.pending.A")).toBeNull();
  });

  it("an edit built on an offline fallback never overwrites the real cloud block", async () => {
    cloud.row = { coachPrograms: { A: { program: prog("A", 5, "real"), updatedAt: "2026-10-01T00:00:00.000Z" } } };
    vi.useFakeTimers();
    cloud.failReads = true;
    const { sync, store } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms(); // offline: nothing held
    cloud.failReads = false;
    store.saveProgram(prog("A", 1, "fallback") as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(coachPrograms().A.program.mesocycles[0].name).toBe("BLOCKreal");
    const parked = (cloud.row?.coachProgramsConflicts as Record<string, { program: P }[]>).A;
    expect(parked[0].program.mesocycles[0].name).toBe("BLOCKfallback");
  });

  it("normal edits save straight to the cloud and leave no local copy", async () => {
    cloud.row = { coachPrograms: { A: { program: prog("A", 1), updatedAt: "2026-10-01T00:00:00.000Z" } } };
    vi.useFakeTimers();
    const { sync, store } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();
    store.saveProgram(prog("A", 2, "next") as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(coachPrograms().A.program.mesocycles[0].name).toBe("BLOCKnext");
    const keys = [...Array(localStorage.length)].map((_, i) => localStorage.key(i));
    expect(keys.filter((k) => k?.includes("program.v2") || k?.includes("pending"))).toEqual([]);
  });

  // --- repair against what the athlete actually has published -----------------
  const dayT = { rest: false, exercises: [{ name: "Squat", sets: [{ targetReps: "5", targetRpe: "8" }] }] };
  const restT = { rest: true, exercises: [] };
  const weekT = [restT, dayT, restT, restT, restT, restT, restT];
  const publish = (aid: string, starts: string[]) =>
    localStorage.setItem(`ssc.dashboard.${aid}`, JSON.stringify({
      athlete: { firstName: "Lieze" },
      publishedWeeks: Object.fromEntries(starts.map((d) => [d, { week: weekT, blockName: "CURRENT" }])),
    }));

  it("restores the backed-up version that holds the latest published week", async () => {
    // prog() weeks start 2026-10-05, -12, -19, -26 …
    publish("LV", ["2026-10-19"]);
    cloud.row = {
      coachPrograms: { LV: { program: prog("LV", 1, "stale"), updatedAt: "2026-10-25T00:00:00.000Z" } },
      coachProgramsBackups: { b: { savedAt: new Date().toISOString(), local: { LV: { program: prog("LV", 3, "good"), updatedAt: "2026-10-20T00:00:00.000Z" } }, cloudReplaced: {} } },
    };
    const { sync, store } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();
    expect(await sync.repairProgramsFromPublished(["LV"])).toEqual(["LV"]);
    expect(store.peekStoredProgram("LV")?.mesocycles[0].name).toBe("BLOCKgood");
    expect(coachPrograms().LV.program.mesocycles[0].name).toBe("BLOCKgood");
    // the version it replaced is parked, not lost
    expect((cloud.row?.coachProgramsConflicts as Record<string, { program: P }[]>).LV[0].program.mesocycles[0].name).toBe("BLOCKstale");
  });

  it("with no saved version, adds the published weeks back into the builder", async () => {
    publish("LV", ["2026-10-19", "2026-10-26"]);
    cloud.row = { coachPrograms: { LV: { program: prog("LV", 1, "stale"), updatedAt: "2026-10-25T00:00:00.000Z" } } };
    const { sync, store } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();
    await sync.repairProgramsFromPublished(["LV"]);
    const p = store.peekStoredProgram("LV")!;
    const starts = p.mesocycles.flatMap((m) => m.weeks.map((w) => w.startDate));
    expect(starts).toEqual(["2026-10-05", "2026-10-19", "2026-10-26"]);
  });

  it("leaves a program alone when it already holds the latest published week", async () => {
    publish("LV", ["2026-10-12"]);
    cloud.row = { coachPrograms: { LV: { program: prog("LV", 2, "ok"), updatedAt: "2026-10-25T00:00:00.000Z" } } };
    const { sync } = await load();
    sync.enableCoachProgramSync("coach");
    await sync.pullCoachPrograms();
    expect(await sync.repairProgramsFromPublished(["LV"])).toEqual([]);
    expect(cloud.row?.coachProgramsConflicts).toBeUndefined();
  });
});
