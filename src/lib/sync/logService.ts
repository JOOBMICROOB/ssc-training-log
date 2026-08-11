import type { SyncEngine } from "./engine";
import type { Primitive } from "./types";

/**
 * High-level auto-save API for the athlete UI. Every call persists locally and
 * queues a sync immediately — there is no explicit "save" step, and nothing is
 * lost if the connection drops or the screen locks mid-entry. Pass the returned
 * clientUuid back on subsequent edits to the same record so they coalesce.
 */
export interface SetLogInput {
  exerciseRowId: string;
  setNumber: number;
  weightKg?: number | null;
  reps?: number | null;
  rpe?: number | null;
  velocity?: number | null;
  notes?: string | null;
  clientUuid?: string;
}

export interface SessionLogInput {
  programSessionId: string;
  painRating?: number | null;
  sessionRpe?: number | null;
  notes?: string | null;
  clientUuid?: string;
}

export interface CheckinInput {
  weekStart: string; // ISO date
  programWeekId?: string | null;
  training?: number | null;
  sleep?: number | null;
  nutrition?: number | null;
  stress?: number | null;
  overallFeeling?: number | null;
  motivation?: number | null;
  painAches?: number | null;
  notes?: string | null;
  clientUuid?: string;
}

const clean = (o: Record<string, Primitive | undefined>): Record<string, Primitive> => {
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};

export function createLogService(engine: SyncEngine) {
  return {
    logSet(input: SetLogInput): Promise<string> {
      return engine.stage(
        "set_log",
        { exercise_row_id: input.exerciseRowId, set_number: input.setNumber },
        clean({
          weight_kg: input.weightKg,
          reps: input.reps,
          rpe: input.rpe,
          velocity: input.velocity,
          notes: input.notes,
          set_number: input.setNumber,
        }),
        input.clientUuid,
      );
    },

    logSession(input: SessionLogInput): Promise<string> {
      return engine.stage(
        "session_log",
        { program_session_id: input.programSessionId },
        clean({
          pain_rating: input.painRating,
          session_rpe: input.sessionRpe,
          notes: input.notes,
        }),
        input.clientUuid,
      );
    },

    logCheckin(input: CheckinInput): Promise<string> {
      return engine.stage(
        "weekly_checkin",
        { week_start: input.weekStart, program_week_id: input.programWeekId ?? "" },
        clean({
          training: input.training,
          sleep: input.sleep,
          nutrition: input.nutrition,
          stress: input.stress,
          overall_feeling: input.overallFeeling,
          motivation: input.motivation,
          pain_aches: input.painAches,
          notes: input.notes,
        }),
        input.clientUuid,
      );
    },
  };
}

export type LogService = ReturnType<typeof createLogService>;
