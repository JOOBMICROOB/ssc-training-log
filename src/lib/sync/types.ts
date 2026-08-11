import type { Primitive, RecordConflict } from "./merge";

export type { Primitive, RecordConflict };

/** The three loggable record kinds and the fields the merge operates over. */
export type LogKind = "set_log" | "session_log" | "weekly_checkin";

export const FIELDS: Record<LogKind, string[]> = {
  set_log: ["weight_kg", "reps", "rpe", "velocity", "notes", "set_number"],
  session_log: ["pain_rating", "session_rpe", "notes"],
  weekly_checkin: [
    "training", "sleep", "nutrition", "stress",
    "overall_feeling", "motivation", "pain_aches", "notes",
  ],
};

export const RPC: Record<LogKind, string> = {
  set_log: "ssc_upsert_set_log",
  session_log: "ssc_upsert_session_log",
  weekly_checkin: "ssc_upsert_weekly_checkin",
};

/** Natural keys that identify the target row server-side (besides client_uuid). */
export type LogKeys = Record<string, string | number>;

/** A pending change waiting in the outbox to be pushed to the server. */
export interface Mutation {
  clientUuid: string;
  kind: LogKind;
  keys: LogKeys;
  base: Record<string, Primitive> | null; // last server-confirmed values (null = insert)
  baseVersion: number | null; // null = insert
  patch: Record<string, Primitive>; // current desired values
  deviceId: string;
  loggedAt: string;
  createdAt: number;
  attempts: number;
}

/** Optimistic local copy of a record — the durable source of truth on-device. */
export interface LocalRecord {
  clientUuid: string;
  kind: LogKind;
  keys: LogKeys;
  fields: Record<string, Primitive>; // current (optimistic) values
  synced: { fields: Record<string, Primitive>; version: number; serverId: string } | null;
  dirty: boolean; // has edits not yet confirmed by the server
  error: string | null; // permanent (non-retryable) push error, if any
  updatedAt: number;
}

export type SyncStatus =
  | "inserted"
  | "updated"
  | "merged"
  | "renumbered";

/** Shape returned by the upsert RPCs (0012/0013). */
export interface SyncResult {
  status: SyncStatus;
  row: Record<string, Primitive> & { id: string; version: number };
  conflicts: RecordConflict[];
}

export interface SyncTransport {
  push(mutation: Mutation): Promise<SyncResult>;
}

/** A conflict surfaced to the UI for review (never auto-discarded). */
export interface OpenConflict {
  clientUuid: string;
  kind: LogKind;
  serverId: string;
  fields: RecordConflict[];
  at: number;
}
