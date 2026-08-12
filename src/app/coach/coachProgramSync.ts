/**
 * Cloud sync for the coach's built programs, so the builder / calendar / weeks
 * grid look the same on every device the coach signs in on.
 *
 * Coach programs are otherwise device-local (localStorage `ssc.coach.program.v2.*`).
 * Here we mirror them into the COACH's OWN `app_state` row (keyed by the coach's
 * user id) under `data.coachPrograms = { [athleteId]: { program, updatedAt } }`.
 * That row is private to the coach under RLS — athletes never see these drafts.
 *
 * - On console start we PULL the row and write each program into localStorage
 *   (local-only, so pulling never re-pushes). Cloud wins when its copy is newer
 *   than what this device last wrote.
 * - Every real edit runs through saveProgram → the hook below → a debounced
 *   read-merge-write PUSH, so we never clobber another athlete's program or
 *   other fields on the coach's row.
 */
import { coachSupabase } from "../../lib/supabase";
import { setProgramSaveHook, saveProgramLocalOnly, type Program } from "./coachProgram";

type Entry = { program: Program; updatedAt: string };
type CoachData = Record<string, unknown> & { coachPrograms?: Record<string, Entry> };

const untyped = coachSupabase as unknown as {
  from: (t: string) => {
    select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { data?: CoachData } | null; error: unknown }> } };
    upsert: (v: unknown, o?: unknown) => Promise<{ error: unknown }>;
  };
};

let coachUserId: string | null = null;
let pending: Record<string, Entry> = {}; // edits made this session, keyed by athlete
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const tsKey = (aid: string) => `ssc.coach.program.ts.${aid}`;
const localTs = (aid: string): string => {
  try { return localStorage.getItem(tsKey(aid)) ?? ""; } catch { return ""; }
};
const setLocalTs = (aid: string, ts: string) => {
  try { localStorage.setItem(tsKey(aid), ts); } catch { /* ignore */ }
};

/** Wire the save hook so every real program edit mirrors to the cloud. */
export function enableCoachProgramSync(userId: string) {
  coachUserId = userId;
  setProgramSaveHook(pushProgram);
}

export function disableCoachProgramSync() {
  coachUserId = null;
  pending = {};
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  setProgramSaveHook(null);
}

/** Pull the coach's cloud programs into localStorage. Await before rendering. */
export async function pullCoachPrograms(): Promise<void> {
  if (!coachUserId) return;
  try {
    const { data, error } = await untyped.from("app_state").select("data").eq("user_id", coachUserId).maybeSingle();
    if (error || !data?.data) return;
    const programs = data.data.coachPrograms ?? {};
    for (const [aid, entry] of Object.entries(programs)) {
      if (!entry?.program) continue;
      // Cloud wins only if it's newer than what this device last wrote locally.
      if (!localTs(aid) || entry.updatedAt > localTs(aid)) {
        saveProgramLocalOnly(entry.program);
        setLocalTs(aid, entry.updatedAt);
      }
    }
  } catch {
    /* offline / RLS — the console still runs on local data */
  }
}

function pushProgram(p: Program) {
  if (!coachUserId) return;
  const updatedAt = new Date().toISOString();
  pending[p.athleteId] = { program: p, updatedAt };
  setLocalTs(p.athleteId, updatedAt);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flush(), 800);
}

async function flush() {
  pushTimer = null;
  if (!coachUserId || Object.keys(pending).length === 0) return;
  const batch = pending;
  pending = {};
  try {
    // Read-merge-write: preserve every other field + any newer entries written
    // from another device since we last read.
    const { data } = await untyped.from("app_state").select("data").eq("user_id", coachUserId).maybeSingle();
    const base: CoachData = data?.data ?? {};
    const merged: Record<string, Entry> = { ...(base.coachPrograms ?? {}) };
    for (const [aid, entry] of Object.entries(batch)) {
      const existing = merged[aid];
      if (!existing || entry.updatedAt >= existing.updatedAt) merged[aid] = entry;
    }
    const nextData: CoachData = { ...base, coachPrograms: merged };
    const { error } = await untyped.from("app_state").upsert({ user_id: coachUserId, data: nextData }, { onConflict: "user_id" });
    if (error) Object.assign(pending, batch); // failed — retry on the next edit
  } catch {
    Object.assign(pending, batch);
  }
}
