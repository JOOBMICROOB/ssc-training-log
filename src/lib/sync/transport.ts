import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mutation, SyncResult, SyncTransport } from "./types";
import { RPC } from "./types";

/** Builds the jsonb payload the upsert RPCs expect from an outbox mutation. */
function payloadOf(m: Mutation): Record<string, unknown> {
  return {
    client_uuid: m.clientUuid,
    base_version: m.baseVersion,
    base: m.base,
    patch: m.patch,
    device_id: m.deviceId,
    logged_at: m.loggedAt,
    ...m.keys, // exercise_row_id / set_number / program_session_id / week_start / program_week_id
  };
}

/** SyncTransport backed by the Supabase upsert RPCs (0012/0013). */
export class SupabaseTransport implements SyncTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private supabase: SupabaseClient<any, any, any>) {}

  async push(m: Mutation): Promise<SyncResult> {
    const { data, error } = await this.supabase.rpc(RPC[m.kind], { payload: payloadOf(m) });
    if (error) {
      // Preserve the PostgREST code so the engine can classify permanent vs transient.
      const e = new Error(error.message) as Error & { code?: string };
      e.code = error.code;
      throw e;
    }
    return data as SyncResult;
  }
}
