/**
 * Tiny namespaced key/value store used by the sync engine to durably hold the
 * optimistic record cache, the outbox, and open conflicts. Abstracted behind an
 * interface so tests run against MemoryStore and the browser uses IndexedDB —
 * the engine logic is identical either way.
 */
export interface KVStore {
  get<T>(ns: string, key: string): Promise<T | undefined>;
  put<T>(ns: string, key: string, value: T): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  list<T>(ns: string): Promise<T[]>;
}

/** In-memory implementation (tests, SSR, and a fallback when IndexedDB is absent). */
export class MemoryStore implements KVStore {
  private data = new Map<string, Map<string, unknown>>();

  private bucket(ns: string): Map<string, unknown> {
    let b = this.data.get(ns);
    if (!b) {
      b = new Map();
      this.data.set(ns, b);
    }
    return b;
  }

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    return structuredCloneSafe(this.bucket(ns).get(key)) as T | undefined;
  }
  async put<T>(ns: string, key: string, value: T): Promise<void> {
    this.bucket(ns).set(key, structuredCloneSafe(value));
  }
  async delete(ns: string, key: string): Promise<void> {
    this.bucket(ns).delete(key);
  }
  async list<T>(ns: string): Promise<T[]> {
    return Array.from(this.bucket(ns).values()).map((v) => structuredCloneSafe(v)) as T[];
  }
}

function structuredCloneSafe<T>(v: T): T {
  if (v === undefined || v === null) return v;
  // Records here are plain JSON — this keeps stored copies isolated from callers.
  return JSON.parse(JSON.stringify(v));
}
