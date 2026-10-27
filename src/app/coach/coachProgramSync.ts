/**
 * Cloud sync for the coach's built programs, so the builder / calendar / weeks
 * grid look the same on every device the coach signs in on.
 *
 * The CLOUD is the truth: programs live in the COACH's OWN `app_state` row (keyed
 * by the coach's user id) under `data.coachPrograms = { [athleteId]: { program,
 * updatedAt } }`. That row is private to the coach under RLS — athletes never see
 * these drafts (they only ever see what's published into their own row).
 *
 * - On console start we PULL the row into memory (coachProgram's store) before
 *   the console renders. Nothing is kept in localStorage long-term any more — ~30
 *   full programs there is what filled the browser's ~5 MB quota.
 * - Every real edit runs through saveProgram → pushProgram: it's buffered in
 *   localStorage (`ssc.coach.program.pending.*`) until the cloud confirms it, then
 *   the buffer is cleared. A closed tab / lost signal just resends on the next open.
 * - Nothing is ever silently dropped: an edit that can't safely overwrite the cloud
 *   copy (another device was newer, or this device was working from a fallback
 *   while offline) is parked under `coachProgramsConflicts`, and the one-time move
 *   off the old per-device copies backs everything up under `coachProgramsBackups`.
 */
import { coachSupabase } from "../../lib/supabase";
import {
  setProgramSaveHook, saveProgramLocalOnly, peekStoredProgram, clearProgramMemory, LEGACY_PROG_PREFIX, type Program,
} from "./coachProgram";

/** How many weeks in a program actually hold training (a day with exercises or cardio). */
const trainingWeeks = (p: Program): number =>
  p.mesocycles.reduce((n, m) => n + m.weeks.filter((w) => w.days.some((d) => !d.rest && (d.exercises.length > 0 || (d.cardio?.length ?? 0) > 0))).length, 0);
/** Training-week count of whatever this device currently holds for an athlete. */
const heldTrainingWeeks = (aid: string): number => {
  const p = peekStoredProgram(aid);
  return p ? trainingWeeks(p) : 0;
};

type Entry = { program: Program; updatedAt: string };
type PendingEntry = Entry & { cloudBased?: boolean };
type Backup = { savedAt: string; local: Record<string, Entry>; cloudReplaced: Record<string, Entry> };
type CoachData = Record<string, unknown> & {
  coachPrograms?: Record<string, Entry>;
  coachProgramsBackups?: Record<string, Backup>;
  coachProgramsConflicts?: Record<string, Entry[]>;
};

const untyped = coachSupabase as unknown as {
  from: (t: string) => {
    select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { data?: CoachData } | null; error: unknown }> } };
    upsert: (v: unknown, o?: unknown) => Promise<{ error: unknown }>;
  };
};

let coachUserId: string | null = null;
let pending: Record<string, PendingEntry> = {}; // edits waiting for the next flush
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let onlineHooked = false;
// Athletes the coach has edited this session. Their in-memory copy is authoritative —
// a cloud pull must never auto-overwrite live work the coach is building right now.
const touched = new Set<string>();
// Athletes whose in-memory program is built on the cloud copy. A program that is NOT
// (a fallback shown while the cloud couldn't be read) may never overwrite a real
// cloud block — its edits are parked as a conflict instead.
const cloudBased = new Set<string>();
let cloudLoaded = false;
let migrationTried = false; // one attempt per session (each attempt writes a backup)

const BACKUP_DAYS = 30;
const tsKey = (aid: string) => `ssc.coach.program.ts.${aid}`;
const pendKey = (aid: string) => `ssc.coach.program.pending.${aid}`;
const PEND_PREFIX = "ssc.coach.program.pending.";
const localTs = (aid: string): string => {
  try { return localStorage.getItem(tsKey(aid)) ?? ""; } catch { return ""; }
};
const setLocalTs = (aid: string, ts: string) => {
  try { localStorage.setItem(tsKey(aid), ts); } catch { /* ignore */ }
};

/** Every localStorage entry whose key starts with `prefix`, parsed. */
function readPrefixed<T>(prefix: string): Record<string, T> {
  const out: Record<string, T> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try { out[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k) ?? "null") as T; } catch { /* skip corrupt */ }
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}
const removeKey = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

/** Clear a buffered edit once the cloud holds it — unless a newer edit replaced it. */
function clearPending(aid: string, updatedAt: string) {
  let cur: PendingEntry | null = null;
  try { cur = JSON.parse(localStorage.getItem(pendKey(aid)) ?? "null") as PendingEntry | null; } catch { /* corrupt → clear */ }
  if (!cur || cur.updatedAt <= updatedAt) removeKey(pendKey(aid));
}

async function readCoachRow(): Promise<CoachData | null> {
  if (!coachUserId) return null;
  const { data, error } = await untyped.from("app_state").select("data").eq("user_id", coachUserId).maybeSingle();
  if (error) throw error;
  return data?.data ?? {};
}

/** Read-merge-write the coach's row; true once the cloud accepted it. */
async function writeCoachRow(mutate: (cur: CoachData) => CoachData): Promise<boolean> {
  if (!coachUserId) return false;
  try {
    const cur = (await readCoachRow()) ?? {};
    const { error } = await untyped.from("app_state").upsert({ user_id: coachUserId, data: mutate(cur) }, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

/** Backups older than BACKUP_DAYS are dropped so the row doesn't grow forever. */
function pruneBackups(b: CoachData["coachProgramsBackups"]): Record<string, Backup> {
  const cutoff = new Date(Date.now() - BACKUP_DAYS * 86400000).toISOString();
  return Object.fromEntries(Object.entries(b ?? {}).filter(([, v]) => (v?.savedAt ?? "") >= cutoff));
}

/** Wire the save hook so every real program edit mirrors to the cloud. */
export function enableCoachProgramSync(userId: string) {
  coachUserId = userId;
  setProgramSaveHook(pushProgram);
  if (!onlineHooked && typeof window !== "undefined") {
    onlineHooked = true;
    window.addEventListener("online", () => { if (Object.keys(pending).length) void flush(); });
  }
}

export function disableCoachProgramSync() {
  coachUserId = null;
  pending = {};
  touched.clear();
  cloudBased.clear();
  cloudLoaded = false;
  migrationTried = false;
  clearProgramMemory();
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  setProgramSaveHook(null);
}

/** Pull the coach's cloud programs into memory. Await before rendering. */
export async function pullCoachPrograms(): Promise<void> {
  if (!coachUserId) return;
  let base: CoachData;
  try {
    base = (await readCoachRow()) ?? {};
  } catch {
    // Offline / auth hiccup: run on whatever this device still has (old per-device
    // copies + unsent edits). Nothing is deleted; these are NOT cloud-based, so
    // they can never overwrite a real cloud block later.
    if (!cloudLoaded) {
      for (const [aid, p] of Object.entries(readPrefixed<Program>(LEGACY_PROG_PREFIX))) {
        if (p && !touched.has(aid) && !peekStoredProgram(aid)) saveProgramLocalOnly(p);
      }
      for (const [aid, e] of Object.entries(readPrefixed<PendingEntry>(PEND_PREFIX))) {
        if (e?.program && !touched.has(aid)) saveProgramLocalOnly(e.program);
      }
    }
    return;
  }
  cloudLoaded = true;

  const programs = base.coachPrograms ?? {};
  // Snapshot this device's last-write times BEFORE the cloud loop below updates
  // them — the migration needs the originals to tell a newer local copy apart.
  const tsBefore: Record<string, string> = {};
  for (const aid of Object.keys(readPrefixed<unknown>(LEGACY_PROG_PREFIX))) tsBefore[aid] = localTs(aid);
  for (const [aid, entry] of Object.entries(programs)) {
    if (!entry?.program) continue;
    // Never auto-overwrite an athlete the coach is actively building this session.
    if (touched.has(aid)) continue;
    // Take the cloud when this device holds nothing yet, or when the cloud is newer
    // than this device's last write and isn't a lower-content copy.
    const held = peekStoredProgram(aid);
    const newer = !localTs(aid) || entry.updatedAt > localTs(aid);
    if (!held || (newer && trainingWeeks(entry.program) >= heldTrainingWeeks(aid))) {
      saveProgramLocalOnly(entry.program);
      setLocalTs(aid, entry.updatedAt);
    }
    cloudBased.add(aid);
  }

  if (!migrationTried) {
    migrationTried = true;
    await migrateLegacy(base, tsBefore);
  }

  // Edits a previous session buffered but never got confirmed: if they're newer
  // than the cloud, restore them and send them again; otherwise they're done.
  for (const [aid, e] of Object.entries(readPrefixed<PendingEntry>(PEND_PREFIX))) {
    if (!e?.program || touched.has(aid)) continue;
    const c = programs[aid];
    if (c && c.updatedAt >= e.updatedAt) { removeKey(pendKey(aid)); continue; }
    saveProgramLocalOnly(e.program);
    if (e.cloudBased || !c) cloudBased.add(aid); else cloudBased.delete(aid);
    touched.add(aid);
    pending[aid] = e;
  }
  if (Object.keys(pending).length) schedule(800);
}

/**
 * One-time move off the old per-device copies (`ssc.coach.program.v2.*`):
 *  1. back up EVERY local copy (+ any cloud copy it will replace) in the cloud,
 *  2. upload the local copy where it's the better one (no cloud copy, newer, or more
 *     training weeks — never risk dropping weeks),
 *  3. read the cloud back and only then delete each local copy it confirms.
 * Any failure stops before deleting; it simply retries on the next open.
 */
async function migrateLegacy(base: CoachData, tsBefore: Record<string, string>): Promise<void> {
  const legacy = readPrefixed<Program>(LEGACY_PROG_PREFIX);
  const ids = Object.keys(legacy).filter((aid) => legacy[aid]?.mesocycles);
  if (!ids.length) return;
  const cloud = base.coachPrograms ?? {};
  const savedAt = new Date().toISOString();

  const upload: Record<string, Entry> = {};
  for (const aid of ids) {
    if (touched.has(aid)) continue;
    const local = legacy[aid];
    const c = cloud[aid];
    if (trainingWeeks(local) === 0) continue; // nothing to keep (still backed up below)
    const ts = tsBefore[aid] ?? "";
    const localWins = !c || (!!ts && ts > c.updatedAt) || trainingWeeks(local) > trainingWeeks(c.program);
    if (localWins) upload[aid] = { program: local, updatedAt: savedAt };
  }

  // 1. Backup first.
  const backup: Backup = {
    savedAt,
    local: Object.fromEntries(ids.map((aid) => [aid, { program: legacy[aid], updatedAt: tsBefore[aid] || savedAt }])),
    cloudReplaced: Object.fromEntries(Object.keys(upload).filter((aid) => cloud[aid]).map((aid) => [aid, cloud[aid]])),
  };
  const backedUp = await writeCoachRow((cur) => ({
    ...cur,
    coachProgramsBackups: { ...pruneBackups(cur.coachProgramsBackups), [savedAt]: backup },
  }));
  if (!backedUp) return;

  // 2. Upload the local winners.
  if (Object.keys(upload).length) {
    const ok = await writeCoachRow((cur) => ({ ...cur, coachPrograms: { ...(cur.coachPrograms ?? {}), ...upload } }));
    if (!ok) return;
    for (const [aid, e] of Object.entries(upload)) {
      saveProgramLocalOnly(e.program);
      setLocalTs(aid, e.updatedAt);
      cloudBased.add(aid);
    }
  }

  // 3. Verify, then free the local copies.
  let after: CoachData | null = null;
  try { after = await readCoachRow(); } catch { return; }
  if (!after?.coachProgramsBackups?.[savedAt]) return;
  for (const aid of ids) {
    const c = after.coachPrograms?.[aid];
    const safe = upload[aid] ? c?.updatedAt === upload[aid].updatedAt : !!c || trainingWeeks(legacy[aid]) === 0;
    if (safe) removeKey(LEGACY_PROG_PREFIX + aid);
  }
}

function pushProgram(p: Program) {
  if (!coachUserId) return;
  const aid = p.athleteId;
  const updatedAt = new Date().toISOString();
  touched.add(aid);
  const entry: PendingEntry = { program: p, updatedAt, cloudBased: cloudBased.has(aid) };
  pending[aid] = entry;
  // Buffer locally until the cloud confirms it (survives a closed tab / no signal).
  try { localStorage.setItem(pendKey(aid), JSON.stringify(entry)); } catch { /* still flushes from memory */ }
  setLocalTs(aid, updatedAt);
  schedule(800);
}

function schedule(ms: number) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flush(), ms);
}

async function flush() {
  pushTimer = null;
  if (!coachUserId || Object.keys(pending).length === 0) return;
  const batch = pending;
  pending = {};
  const written: string[] = [];
  const ok = await writeCoachRow((base) => {
    written.length = 0;
    const merged: Record<string, Entry> = { ...(base.coachPrograms ?? {}) };
    const conflicts: Record<string, Entry[]> = { ...(base.coachProgramsConflicts ?? {}) };
    let parked = false;
    const park = (aid: string, e: Entry) => {
      conflicts[aid] = [...(conflicts[aid] ?? []), { program: e.program, updatedAt: e.updatedAt }].slice(-5);
      parked = true;
    };
    for (const [aid, e] of Object.entries(batch)) {
      const existing = merged[aid];
      const entry: Entry = { program: e.program, updatedAt: e.updatedAt };
      // A wipe to NOTHING over a real block is almost always an accident — ignore it.
      if (existing && trainingWeeks(entry.program) === 0 && trainingWeeks(existing.program) > 0) continue;
      // Built on a fallback (cloud unreadable at the time) over a real cloud block, or
      // older than what another device saved since: keep it aside, never overwrite.
      if (existing && ((!e.cloudBased && !cloudBased.has(aid) && trainingWeeks(existing.program) > 0) || existing.updatedAt > entry.updatedAt)) {
        park(aid, entry);
        continue;
      }
      merged[aid] = entry;
      written.push(aid);
    }
    return { ...base, coachPrograms: merged, ...(parked ? { coachProgramsConflicts: conflicts } : {}) };
  });
  if (ok) {
    for (const aid of written) cloudBased.add(aid);
    // The cloud now holds (or deliberately parked/ignored) every edit in the batch.
    for (const [aid, e] of Object.entries(batch)) clearPending(aid, e.updatedAt);
  } else {
    // Failed — keep them (newer edits made meanwhile win) and retry shortly.
    pending = { ...batch, ...pending };
    schedule(15000);
  }
}
