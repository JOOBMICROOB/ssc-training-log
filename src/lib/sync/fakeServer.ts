import type { Mutation, Primitive, SyncResult, SyncTransport } from "./types";
import { FIELDS } from "./types";
import { mergeRecord } from "./merge";

interface Row {
  id: string;
  version: number;
  clientUuid: string;
  keys: Record<string, string | number>;
  fields: Record<string, Primitive>;
}

/**
 * In-memory stand-in for the Supabase upsert RPCs, implementing the SAME
 * contract as ssc_upsert_set_log / _session_log / _weekly_checkin (compare-and-
 * swap + three-way merge + conflict preservation). Used by the engine tests so
 * the offline→online→conflict path is exercised end to end without a database.
 * Because it reuses merge.ts — the mirror of SQL ssc_merge3 — its behaviour
 * matches the server's.
 */
export class FakeServer implements SyncTransport {
  private rows = new Map<string, Row>(); // by clientUuid
  private seq = 0;
  offline = false;

  private naturalKey(m: Mutation, fields: Record<string, Primitive>): string {
    switch (m.kind) {
      case "set_log":
        return `${m.keys.exercise_row_id}#${fields.set_number}`;
      case "session_log":
        return `${m.keys.program_session_id}`;
      case "weekly_checkin":
        return `${m.keys.week_start}`;
    }
  }

  private rowByNatural(m: Mutation, fields: Record<string, Primitive>): Row | undefined {
    const key = this.naturalKey(m, fields);
    for (const r of this.rows.values()) {
      if (r.clientUuid === m.clientUuid) continue;
      if (this.naturalKey({ ...m, keys: r.keys }, r.fields) === key) return r;
    }
    return undefined;
  }

  private maxSetNumber(exerciseRowId: string): number {
    let max = 0;
    for (const r of this.rows.values()) {
      if (r.keys.exercise_row_id === exerciseRowId) {
        max = Math.max(max, Number(r.fields.set_number ?? 0));
      }
    }
    return max;
  }

  /** Simulate a concurrent edit made elsewhere (e.g. the athlete's other phone). */
  externalEdit(clientUuid: string, patch: Record<string, Primitive>): void {
    const r = this.rows.get(clientUuid);
    if (!r) throw new Error("no such row");
    r.fields = { ...r.fields, ...patch };
    r.version += 1;
  }

  private result(status: SyncResult["status"], r: Row, conflicts: SyncResult["conflicts"]): SyncResult {
    return { status, row: { id: r.id, version: r.version, ...r.fields }, conflicts };
  }

  async push(m: Mutation): Promise<SyncResult> {
    if (this.offline) {
      const err = new Error("network offline") as Error & { code?: string };
      throw err; // transient — no P0 code
    }
    const fields = FIELDS[m.kind];
    const existing = this.rows.get(m.clientUuid);

    // ---- INSERT path ----
    if (!existing) {
      const wanted = pick(m.patch, fields);
      const clash = this.rowByNatural(m, wanted);
      if (clash) {
        if (m.kind === "set_log") {
          // Preserve data by appending under the next free set number.
          const newNo = this.maxSetNumber(String(m.keys.exercise_row_id)) + 1;
          wanted.set_number = newNo;
          const row = this.insert(m, wanted);
          return this.result("renumbered", row, [
            { field: "set_number", base: null, local: Number(m.keys.set_number), remote: Number(m.keys.set_number) },
          ]);
        }
        // session/checkin: a row already exists under a different client_uuid.
        return this.mergeInto(m, clash, fields, /*forceMerge*/ true);
      }
      const row = this.insert(m, wanted);
      return this.result("inserted", row, []);
    }

    // ---- Idempotent replay of an already-applied insert ----
    if (m.baseVersion === null) {
      return this.result("inserted", existing, []);
    }

    // ---- Clean update (no concurrent change) ----
    if (m.baseVersion === existing.version) {
      for (const f of fields) if (f in m.patch) existing.fields[f] = m.patch[f];
      existing.version += 1;
      return this.result("updated", existing, []);
    }

    // ---- Concurrent change: three-way merge ----
    return this.mergeInto(m, existing, fields, false);
  }

  private insert(m: Mutation, fields: Record<string, Primitive>): Row {
    const row: Row = {
      id: `srv-${++this.seq}`,
      version: 1,
      clientUuid: m.clientUuid,
      keys: m.keys,
      fields,
    };
    this.rows.set(m.clientUuid, row);
    return row;
  }

  private mergeInto(m: Mutation, target: Row, fields: string[], forceMerge: boolean): SyncResult {
    const base = forceMerge ? null : m.base;
    const { merged, conflicts } = mergeRecord(fields, base, m.patch, target.fields);
    target.fields = merged;
    target.version += 1;
    return this.result(conflicts.length ? "merged" : "updated", target, conflicts);
  }

  // Test introspection helpers.
  allRows(): Array<{ id: string; version: number; fields: Record<string, Primitive> }> {
    return Array.from(this.rows.values()).map((r) => ({ id: r.id, version: r.version, fields: r.fields }));
  }
  rowCount(): number {
    return this.rows.size;
  }
}

function pick(src: Record<string, Primitive>, fields: string[]): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const f of fields) out[f] = src[f] ?? null;
  return out;
}
