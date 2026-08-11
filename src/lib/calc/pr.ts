/**
 * PR (personal record) detection for a newly logged set.
 *
 * A set can set a PR two independent ways:
 *   - by raw weight moved (heaviest weight for the exercise, any rep count)
 *   - by estimated 1RM (best Epley e1RM for the exercise)
 *
 * The server (DB trigger ssc_detect_pr) is authoritative — it recomputes
 * against the athlete's full history on every insert so offline-synced sets
 * are evaluated server-side regardless of what the client believed. This copy
 * mirrors that logic for optimistic UI.
 */
import { epleyE1rm } from "./epley";

export interface LoggedSetInput {
  weightKg: number;
  reps: number;
}

export interface PriorBest {
  /** Heaviest weight previously recorded for this athlete+exercise, or null. */
  bestWeightKg: number | null;
  /** Best e1RM previously recorded for this athlete+exercise, or null. */
  bestE1rm: number | null;
}

export interface PrResult {
  e1rm: number;
  isWeightPr: boolean;
  isE1rmPr: boolean;
  isPr: boolean;
}

export function detectPr(set: LoggedSetInput, prior: PriorBest): PrResult {
  const e1rm = epleyE1rm(set.weightKg, set.reps);
  const valid = set.weightKg > 0 && set.reps > 0;

  const isWeightPr =
    valid && (prior.bestWeightKg === null || set.weightKg > prior.bestWeightKg);
  const isE1rmPr =
    valid && (prior.bestE1rm === null || e1rm > prior.bestE1rm);

  return { e1rm, isWeightPr, isE1rmPr, isPr: isWeightPr || isE1rmPr };
}
