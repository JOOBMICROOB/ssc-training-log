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

/** How many weeks in a program actually hold training (a day with exercises). */
const trainingWeeks = (p: Program): number =>
  p.mesocycles.reduce((n, m) => n + m.weeks.filter((w) => w.days.some((d) => !d.rest && d.exercises.length > 0)).length, 0);
/** Training-week count of whatever is currently in this device's localStorage. */
const localTrainingWeeks = (aid: string): number => {
  try {
    const raw = localStorage.getItem(`ssc.coach.program.v2.${aid}`);
    return raw ? trainingWeeks(JSON.parse(raw) as Program) : 0;
  } catch { return 0; }
};

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
// Athletes the coach has edited this session. Their LOCAL copy is authoritative —
// a cloud pull must never auto-overwrite live work the coach is building right now
// (that's what made a just-built week vanish when the console re-pulled on focus).
const touched = new Set<string>();

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
  touched.clear();
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
      // Never auto-overwrite an athlete the coach is actively building this session —
      // their local copy wins until they sign out (otherwise a re-pull on focus wipes
      // the week they just made).
      if (touched.has(aid)) continue;
      // Cloud wins only if it's newer than what this device last wrote locally AND it
      // isn't a lower-content copy: a stale 1-week seed edited on a fresh device must
      // never wipe a full multi-week block that's synced everywhere. (This device can
      // still shrink a block itself; it just won't auto-adopt a smaller cloud copy.)
      const newer = !localTs(aid) || entry.updatedAt > localTs(aid);
      if (newer && trainingWeeks(entry.program) >= localTrainingWeeks(aid)) {
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
  touched.add(p.athleteId);
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
      // Only refuse a push that would wipe a real block to NOTHING (0 training weeks)
      // — that's almost always an accident on a fresh device. A deliberate new block
      // (1+ training weeks) always pushes, even if it's smaller than the old cloud copy,
      // so the coach's new week isn't held hostage by a stale bigger block.
      if (existing && trainingWeeks(entry.program) === 0 && trainingWeeks(existing.program) > 0) continue;
      if (!existing || entry.updatedAt >= existing.updatedAt) merged[aid] = entry;
    }
    const nextData: CoachData = { ...base, coachPrograms: merged };
    const { error } = await untyped.from("app_state").upsert({ user_id: coachUserId, data: nextData }, { onConflict: "user_id" });
    if (error) Object.assign(pending, batch); // failed — retry on the next edit
  } catch {
    Object.assign(pending, batch);
  }
}
