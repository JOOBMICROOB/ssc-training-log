import type { KVStore } from "./store";
import type {
  LocalRecord, LogKeys, LogKind, Mutation, OpenConflict, Primitive,
  SyncResult, SyncTransport,
} from "./types";
import { FIELDS } from "./types";

const NS_REC = "records";
const NS_OUT = "outbox";
const NS_CONF = "conflicts";

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (non-crypto) — only used where WebCrypto is unavailable.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function isOnline(): boolean {
  const n = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return n?.onLine ?? true; // assume online when the API is absent (Node/tests)
}

/** A permanent, non-retryable push failure (e.g. a server integrity rejection). */
export class PermanentSyncError extends Error {}

function classifyError(err: unknown): "permanent" | "transient" {
  if (err instanceof PermanentSyncError) return "permanent";
  const e = err as { code?: string; message?: string; name?: string };
  // Postgres raise_exception (RLS/integrity) surfaces as code P0001 via PostgREST.
  if (typeof e?.code === "string" && e.code.startsWith("P0")) return "permanent";
  return "transient"; // network/timeouts/etc — safe to retry
}

function pick(row: Record<string, Primitive>, fields: string[]): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

function sameFields(a: Record<string, Primitive>, b: Record<string, Primitive>, fields: string[]) {
  return fields.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

export interface EngineOptions {
  deviceId?: string;
  /** Called after every flush so a UI can refresh (records, conflicts). */
  onChange?: () => void;
}

/**
 * Offline-first sync engine. Every edit is persisted locally first (durable,
 * survives reload / dropped connection / locked screen) and pushed to the server
 * opportunistically. Pushes go through the atomic upsert RPCs, so a set logged
 * offline and later synced is merged — never silently overwritten — server-side.
 */
export class SyncEngine {
  // Flushes are serialized through a promise chain so awaiting flush() always
  // awaits a full drain — no caller returns while a drain is still in flight.
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private store: KVStore,
    private transport: SyncTransport,
    private opts: EngineOptions = {},
  ) {}

  private deviceId(): string {
    return this.opts.deviceId ?? "unknown-device";
  }

  /** Wire up automatic flushing when connectivity returns. */
  start(): void {
    const g = globalThis as { addEventListener?: (t: string, cb: () => void) => void };
    g.addEventListener?.("online", () => void this.flush());
    void this.flush();
  }

  async getRecord(clientUuid: string): Promise<LocalRecord | undefined> {
    return this.store.get<LocalRecord>(NS_REC, clientUuid);
  }
  async listRecords(): Promise<LocalRecord[]> {
    return this.store.list<LocalRecord>(NS_REC);
  }
  async listOpenConflicts(): Promise<OpenConflict[]> {
    return this.store.list<OpenConflict>(NS_CONF);
  }
  async resolveConflict(clientUuid: string): Promise<void> {
    await this.store.delete(NS_CONF, clientUuid);
    this.opts.onChange?.();
  }
  async pendingCount(): Promise<number> {
    return (await this.store.list<Mutation>(NS_OUT)).length;
  }

  /**
   * Auto-save entry point. Applies `patch` to the local record immediately and
   * queues a coalesced mutation. Returns the record's client_uuid (generate it
   * once per logical record and pass it back in for subsequent edits).
   */
  async stage(
    kind: LogKind,
    keys: LogKeys,
    patch: Record<string, Primitive>,
    clientUuid: string = uuid(),
    loggedAt: string = new Date().toISOString(),
  ): Promise<string> {
    const rec = await this.store.get<LocalRecord>(NS_REC, clientUuid);
    const fields = { ...(rec?.fields ?? {}), ...patch };

    const next: LocalRecord = {
      clientUuid,
      kind,
      keys: rec?.keys ?? keys,
      fields,
      synced: rec?.synced ?? null,
      dirty: true,
      error: null,
      updatedAt: Date.now(),
    };
    await this.store.put(NS_REC, clientUuid, next);

    const existing = await this.store.get<Mutation>(NS_OUT, clientUuid);
    const mutation: Mutation = existing
      ? { ...existing, patch: fields, loggedAt } // coalesce: keep original base/version
      : {
          clientUuid,
          kind,
          keys: next.keys,
          base: next.synced?.fields ?? null,
          baseVersion: next.synced?.version ?? null,
          patch: fields,
          deviceId: this.deviceId(),
          loggedAt,
          createdAt: Date.now(),
          attempts: 0,
        };
    await this.store.put(NS_OUT, clientUuid, mutation);

    void this.flush();
    return clientUuid;
  }

  /**
   * Drain the outbox. Safe to call repeatedly; calls are serialized, so
   * `await flush()` resolves only once this call's drain has fully completed.
   */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drainOnce());
    return this.chain;
  }

  private async drainOnce(): Promise<void> {
    if (!isOnline()) return;
    const queue = (await this.store.list<Mutation>(NS_OUT)).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    for (const m of queue) {
      try {
        const res = await this.transport.push(m);
        await this.applyResult(m, res);
      } catch (err) {
        if (classifyError(err) === "permanent") {
          await this.markPermanentError(m, err);
          continue; // deadletter this one, keep draining the rest
        }
        // Transient: bump attempts, stop draining to preserve FIFO order.
        await this.store.put(NS_OUT, m.clientUuid, { ...m, attempts: m.attempts + 1 });
        break;
      }
    }
    this.opts.onChange?.();
  }

  private async applyResult(sent: Mutation, res: SyncResult): Promise<void> {
    const fields = FIELDS[sent.kind];
    const serverFields = pick(res.row, fields);
    const synced = { fields: serverFields, version: res.row.version, serverId: res.row.id };

    // Did the user edit again while this push was in flight?
    const current = await this.store.get<Mutation>(NS_OUT, sent.clientUuid);
    const superseded = current && !sameFields(current.patch, sent.patch, fields);

    const rec = await this.store.get<LocalRecord>(NS_REC, sent.clientUuid);
    if (rec) {
      await this.store.put<LocalRecord>(NS_REC, sent.clientUuid, {
        ...rec,
        // If nothing newer is pending, adopt the server's merged truth.
        fields: superseded ? rec.fields : serverFields,
        synced,
        dirty: !!superseded,
        error: null,
        updatedAt: Date.now(),
      });
    }

    if (superseded && current) {
      // Rebase the still-pending edit onto the freshly-synced server state.
      await this.store.put<Mutation>(NS_OUT, sent.clientUuid, {
        ...current,
        base: serverFields,
        baseVersion: res.row.version,
        attempts: 0,
      });
    } else {
      await this.store.delete(NS_OUT, sent.clientUuid);
    }

    if (res.conflicts.length > 0) {
      const conflict: OpenConflict = {
        clientUuid: sent.clientUuid,
        kind: sent.kind,
        serverId: res.row.id,
        fields: res.conflicts,
        at: Date.now(),
      };
      await this.store.put(NS_CONF, sent.clientUuid, conflict);
    }
  }

  private async markPermanentError(m: Mutation, err: unknown): Promise<void> {
    await this.store.delete(NS_OUT, m.clientUuid);
    const rec = await this.store.get<LocalRecord>(NS_REC, m.clientUuid);
    if (rec) {
      await this.store.put<LocalRecord>(NS_REC, m.clientUuid, {
        ...rec,
        error: (err as Error)?.message ?? "sync failed",
        updatedAt: Date.now(),
      });
    }
  }
}
