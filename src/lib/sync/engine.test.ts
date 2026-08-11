import { describe, it, expect, beforeEach } from "vitest";
import { SyncEngine } from "./engine";
import { MemoryStore } from "./store";
import { FakeServer } from "./fakeServer";
import { createLogService } from "./logService";
import type { SyncTransport } from "./types";

const ROW = "row-1"; // an exercise_row_id in a program assigned to the athlete

function setup() {
  const store = new MemoryStore();
  const server = new FakeServer();
  const engine = new SyncEngine(store, server, { deviceId: "phone-A" });
  const svc = createLogService(engine);
  return { store, server, engine, svc };
}

describe("offline logging + auto-sync", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("queues while offline and syncs when back online (nothing lost)", async () => {
    const { server, engine, svc } = ctx;
    server.offline = true;
    await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 100, reps: 5 });
    await engine.flush();
    expect(await engine.pendingCount()).toBe(1); // durably queued
    expect(server.rowCount()).toBe(0); // nothing on the server yet

    server.offline = false;
    await engine.flush();
    expect(await engine.pendingCount()).toBe(0);
    expect(server.rowCount()).toBe(1);
  });

  it("auto-saves each set locally the moment it's entered", async () => {
    const { server, engine, svc } = ctx;
    server.offline = true;
    const id = await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 120, reps: 3 });
    // Even with no connectivity, the value is durably on-device immediately.
    const rec = await engine.getRecord(id);
    expect(rec?.fields.weight_kg).toBe(120);
    expect(rec?.dirty).toBe(true);
  });

  it("is idempotent — a replayed insert does not duplicate the row", async () => {
    const { server } = ctx;
    const mutation = {
      clientUuid: "c-1",
      kind: "set_log" as const,
      keys: { exercise_row_id: ROW, set_number: 1 },
      base: null,
      baseVersion: null,
      patch: { weight_kg: 100, reps: 5, set_number: 1 },
      deviceId: "phone-A",
      loggedAt: new Date().toISOString(),
      createdAt: Date.now(),
      attempts: 0,
    };
    const first = await server.push(mutation);
    const second = await server.push(mutation); // e.g. response was lost, client retried
    expect(server.rowCount()).toBe(1);
    expect(second.row.id).toBe(first.row.id);
  });
});

describe("offline-sync conflicts", () => {
  it("merges edits to different fields with no conflict", async () => {
    const { server, engine, svc } = setup();
    const id = await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 100, reps: 5 });
    await engine.flush();

    // The athlete's other phone changed reps -> 3 (now server v2).
    server.externalEdit(id, { reps: 3 });

    // This device changes weight -> 105 (based on the v1 it last saw).
    await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 105, clientUuid: id });
    await engine.flush();

    const rec = await engine.getRecord(id);
    expect(rec?.synced?.fields.weight_kg).toBe(105); // local edit preserved
    expect(rec?.synced?.fields.reps).toBe(3); // remote edit preserved
    expect(await engine.listOpenConflicts()).toHaveLength(0);
  });

  it("flags a genuine same-field conflict and preserves both values", async () => {
    const { server, engine, svc } = setup();
    const id = await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 100 });
    await engine.flush();

    server.externalEdit(id, { weight_kg: 110 }); // other device: 110
    await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 105, clientUuid: id }); // this device: 105
    await engine.flush();

    const rec = await engine.getRecord(id);
    expect(rec?.synced?.fields.weight_kg).toBe(105); // incoming write wins the row
    const conflicts = await engine.listOpenConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fields[0]).toMatchObject({ field: "weight_kg", local: 105, remote: 110 });
  });

  it("renumbers a set-number collision instead of dropping the set", async () => {
    const { server, engine, svc } = setup();
    // Two devices both created 'set 1' for the same exercise row while offline.
    await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 100 });
    await engine.flush();
    const idB = await svc.logSet({ exerciseRowId: ROW, setNumber: 1, weightKg: 102 });
    await engine.flush();

    expect(server.rowCount()).toBe(2); // both survived
    const recB = await engine.getRecord(idB);
    expect(recB?.synced?.fields.set_number).toBe(2); // appended, not overwritten
    expect(await engine.listOpenConflicts()).toHaveLength(1);
  });
});

describe("permanent errors are deadlettered, not retried forever", () => {
  it("clears the outbox and marks the record errored on a server rejection", async () => {
    const store = new MemoryStore();
    const rejecting: SyncTransport = {
      push() {
        const e = new Error("exercise row not in a program assigned to this athlete") as Error & {
          code?: string;
        };
        e.code = "P0001"; // Postgres raise_exception
        return Promise.reject(e);
      },
    };
    const engine = new SyncEngine(store, rejecting, { deviceId: "phone-A" });
    const svc = createLogService(engine);
    const id = await svc.logSet({ exerciseRowId: "bad-row", setNumber: 1, weightKg: 100 });
    await engine.flush();

    expect(await engine.pendingCount()).toBe(0); // not stuck retrying
    const rec = await engine.getRecord(id);
    expect(rec?.error).toBeTruthy();
  });
});
