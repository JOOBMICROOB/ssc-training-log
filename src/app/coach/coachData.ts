/**
 * Coach-console data layer.
 *
 * Every athlete surfaces as a uniform `ClientRow`. The REAL athlete (Renée, the
 * one in the auth roster whose phone app writes to `athleteData`) resolves live
 * — her adherence, current session, bodyweight, PRs, check-in and meet opt-ins
 * are the same values the athlete app shows, so edits flow both ways. The rest
 * of the roster is static demo data so the board looks like a real gym.
 *
 * A thin coach-side overlay (private note, program-due, city/competing flag)
 * persists in localStorage — that's the coach's own planning metadata, not the
 * athlete's training log.
 */
import {
  getDashboardModel,
  subscribeDashboard,
  coachSetOptIn,
  getSharedCompetitions,
  setSharedCompetitions,
  sentNotes,
  type DashboardModel,
  type DashboardData,
} from "../../lib/data/athleteData";
import { programStatus } from "./coachPlanning";

export type Coach = { id: string; name: string; head?: boolean };
export type Competition = DashboardData["competitions"][number];

// The real coaches, loaded from Supabase on sign-in (see setCoaches). `id` is the
// coach's code. Defaults to just the seed team until the live list arrives — kept
// as `let` so importers see the updated list (ES module live binding).
export let COACHES: Coach[] = [
  { id: "noa", name: "Noa Depaepe", head: true },
  { id: "mika", name: "Mika Vankerckhove" },
  { id: "maxim", name: "Maxim Stepman" },
];
// user_id → coach code, so an athlete's owner (a UUID) maps to a coach column.
let coachByUserId: Record<string, string> = {};
/** Replace the coach list with the real coaches from Supabase. */
export function setCoaches(list: { userId: string; code: string; name: string }[]) {
  if (!list.length) return;
  COACHES = list.map((c, i) => ({ id: c.code, name: c.name, head: i === 0 || /noa/i.test(c.name) }));
  coachByUserId = Object.fromEntries(list.map((c) => [c.userId, c.code]));
  emit();
}

export type Due = { label: string; sub: string; days: number | null; flagged?: boolean };
export type MeetOpt = { id: string; name: string; date: string; level: "national" | "international"; opted: boolean };

export type ClientRow = {
  athleteId: string;
  name: string;
  avatar?: string; // uploaded profile photo (data URL)
  city: string;
  competing: boolean;
  coachId: string;
  live: boolean;
  block: string; // "B1 W1"
  session: { title: string; detail: string };
  lastLogged: { what: string; when: string };
  adherence: number; // %
  due: Due;
  checked: boolean; // next block already written — nothing to do right now
  rank: number; // sort key for the board: smaller = needs attention sooner
  note: string; // coach-private
  ping: boolean; // unread athlete message
  // --- expanded detail ---
  bodyweight: { value: string; delta: string; bars: number[] };
  prs: { lift: string; value: string }[];
  prsNote: string;
  checkin: { sleep: number; nutrition: number; stress: number; motivation: number; pain: number };
  sessionNotes: { last: string; prev: string; week: string };
  message: string;
  // The athlete's real notes to the coach — the coach sees all of them forever.
  notes: { id: string; date: string; text: string; checkedAt?: string }[];
  hideMaxes: boolean;
  disabled: boolean; // archived by the coach — hidden from board + switcher, reversible
  shared?: boolean; // in this coach's roster because another coach shared them (not owned)
  owned?: boolean; // this coach owns the athlete (can edit their program)
  streak: number; // athlete's current logging streak (0 = none / demo)
  opts: MeetOpt[];
};

// The one athlete wired to the live athlete app (auth roster RS1203 = Renée).
export const LIVE_ATHLETE_ID = "RS1203";

// Real, cloud-synced athletes the coach owns (from app_profiles). The console
// fills this after startCoachSync so getClients can turn each into a live row —
// this is how a newly created account appears on the board.
export type RealAthlete = { athleteId: string; userId: string; name: string; coachId?: string; shared?: boolean; owned?: boolean; ownerId?: string | null };
let realAthletes: RealAthlete[] = [];
export function setRealAthletes(list: RealAthlete[]) {
  realAthletes = list;
  emit();
}
/** The Supabase user id behind an athlete code (for sharing) — null if unknown. */
export function getAthleteUserId(athleteId: string): string | null {
  return realAthletes.find((a) => a.athleteId === athleteId)?.userId ?? null;
}
/** True if this athlete is in the roster because another coach shared them. */
export function isSharedAthlete(athleteId: string): boolean {
  return !!realAthletes.find((a) => a.athleteId === athleteId)?.shared;
}

// --- coach-side overlay (private notes, program-due) -------------------------
type Overlay = { note?: string; hideMaxes?: boolean; coachId?: string; disabled?: boolean };
const OVERLAY_KEY = "ssc.coach.overlay";
function readOverlay(): Record<string, Overlay> {
  try {
    return JSON.parse(localStorage.getItem(OVERLAY_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeOverlay(o: Record<string, Overlay>) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(o));
  } catch {
    /* storage may be unavailable */
  }
}
export function setCoachNote(athleteId: string, note: string) {
  const o = readOverlay();
  o[athleteId] = { ...o[athleteId], note };
  writeOverlay(o);
  emit();
}
export function setHideMaxes(athleteId: string, hideMaxes: boolean) {
  const o = readOverlay();
  o[athleteId] = { ...o[athleteId], hideMaxes };
  writeOverlay(o);
  emit();
}
/** Archive (disable) or restore an athlete — hides them from the board and the
 * top-right switcher without deleting anything. Fully reversible. */
export function setAthleteDisabled(athleteId: string, disabled: boolean) {
  const o = readOverlay();
  o[athleteId] = { ...o[athleteId], disabled };
  writeOverlay(o);
  emit();
}
export function athleteDisabled(athleteId: string): boolean {
  return readOverlay()[athleteId]?.disabled === true;
}
/** Reassign an athlete to a coach — the coach picks manually, persisted locally. */
export function setCoach(athleteId: string, coachId: string) {
  const o = readOverlay();
  o[athleteId] = { ...o[athleteId], coachId };
  writeOverlay(o);
  emit();
}
/** Coach toggles an athlete's meet entry (the only way to withdraw one). */
export function toggleOpt(athleteId: string, compId: string, opted: boolean) {
  // Every REAL (cloud-synced) athlete writes to their own data so the opt-in
  // actually reaches their app — not just Renée. Only demo placeholders use the
  // local overlay.
  const isReal = athleteId === LIVE_ATHLETE_ID || realAthletes.some((a) => a.athleteId === athleteId);
  if (isReal) coachSetOptIn(athleteId, compId, opted);
  else {
    // Demo athletes: keep the toggle in the overlay so the UI reflects the change.
    const o = readOverlay() as Record<string, Overlay & { opts?: Record<string, boolean> }>;
    const cur = o[athleteId] ?? {};
    o[athleteId] = { ...cur, opts: { ...(cur as { opts?: Record<string, boolean> }).opts, [compId]: opted } };
    writeOverlay(o);
  }
  emit();
}

// --- change notifications ----------------------------------------------------
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
export function subscribeCoach(cb: () => void): () => void {
  listeners.add(cb);
  // Live-athlete edits (from either side) also refresh the console.
  const unsubData = subscribeDashboard(cb);
  return () => {
    listeners.delete(cb);
    unsubData();
  };
}

// --- static demo roster ------------------------------------------------------
type Seed = Partial<ClientRow> & { name: string; coachId: string };
const A = (s: Seed): ClientRow => ({
  athleteId: s.athleteId ?? s.name.split(" ").map((w) => w[0]).join("").toUpperCase() + "00",
  city: "—",
  competing: false,
  live: false,
  block: "B1 W1",
  session: { title: "Squat & Bench · Tue", detail: "not started" },
  lastLogged: { what: "—", when: "—" },
  adherence: 0,
  due: { label: "—", sub: "", days: null },
  checked: false,
  rank: 500,
  note: "",
  ping: false,
  bodyweight: { value: "—", delta: "", bars: [] },
  prs: [],
  prsNote: "Nothing beaten yet this block.",
  checkin: { sleep: 5, nutrition: 5, stress: 5, motivation: 5, pain: 3 },
  sessionNotes: { last: "", prev: "", week: "" },
  message: "",
  notes: [],
  hideMaxes: false,
  disabled: false,
  streak: 0,
  opts: [],
  ...s,
} as ClientRow);

// Set false for the real trial: the roster becomes just Renée + accounts you
// create, so you enter every athlete's info yourself (no placeholder names).
const SHOW_DEMO_ATHLETES = false;
const DEMO: ClientRow[] = [
  A({
    name: "Bram Deckmyn", athleteId: "BD1203", coachId: "noa", city: "Kachtem", competing: false,
    block: "B1 W1", session: { title: "Squat & Bench · Tue", detail: "in progress · 4 / 12 sets" },
    lastLogged: { what: "Deadlift session", when: "Tue 28 Jul" }, adherence: 62,
    due: { label: "OVERDUE", sub: "block ended", days: -1, flagged: true }, ping: true, note: "",
    bodyweight: { value: "60,9 kg", delta: "-0,5 kg over 8 weigh-ins", bars: [58, 62, 55, 70, 60, 48, 64, 40] },
    checkin: { sleep: 5, nutrition: 5, stress: 2, motivation: 6, pain: 0 },
    sessionNotes: {
      last: "Right hip a bit tight on the second squat set, backed off to RPE 7.",
      prev: "Slept badly, still hit every rep. Bar speed felt slow on the top set.",
      week: "Belt notch changed, feels much better on the deadlift setup.",
    },
    message: "Can we move the Thursday session to Friday this week?",
  }),
  A({
    name: "Zita Depoorter", athleteId: "ZD", coachId: "noa", city: "Handzame", competing: true,
    block: "B2 W2", session: { title: "Deadlift · Thu", detail: "not started" },
    lastLogged: { what: "Upper session", when: "Sun 26 Jul" }, adherence: 75,
    due: { label: "5 DAYS", sub: "write week 3", days: 5 },
  }),
  A({
    name: "Brendon de Wit", athleteId: "BW", coachId: "noa", city: "Diksmuide", competing: true,
    block: "B3 W3", session: { title: "Bench · Wed", detail: "logged 9 / 9 sets" },
    lastLogged: { what: "Deload lower", when: "Sat 25 Jul" }, adherence: 88,
    due: { label: "10 DAYS", sub: "write week 4", days: 10 }, note: "Shift work — never program Thursdays.",
  }),
  A({ name: "Jess Clarysse", coachId: "noa", city: "Kortrijk", competing: true, block: "B1 W4", adherence: 81, due: { label: "3 DAYS", sub: "write week 5", days: 3 }, lastLogged: { what: "Squat session", when: "Fri 24 Jul" } }),
  A({ name: "Miel Loonis", coachId: "noa", city: "Roeselare", block: "B2 W1", adherence: 69, due: { label: "8 DAYS", sub: "write week 2", days: 8 }, lastLogged: { what: "Full body", when: "Thu 23 Jul" } }),
  A({ name: "Jonas Depaepe", coachId: "noa", city: "Ingelmunster", block: "B1 W2", adherence: 90, due: { label: "6 DAYS", sub: "write week 3", days: 6 }, lastLogged: { what: "Bench session", when: "Wed 29 Jul" } }),
  A({ name: "Gauthier Verkinderen", coachId: "noa", city: "Izegem", competing: true, block: "B4 W1", adherence: 84, due: { label: "12 DAYS", sub: "write week 2", days: 12 }, lastLogged: { what: "Deadlift", when: "Tue 28 Jul" } }),
  A({ name: "Dante Leerberghe", coachId: "noa", city: "Ardooie", block: "B1 W3", adherence: 58, due: { label: "OVERDUE", sub: "block ended", days: -1, flagged: true }, ping: true, lastLogged: { what: "Squat session", when: "Mon 20 Jul" } }),
  A({ name: "Jana Dutordoir", coachId: "noa", city: "Wevelgem", competing: true, block: "B3 W2", adherence: 92, due: { label: "4 DAYS", sub: "write week 3", days: 4 }, lastLogged: { what: "Bench session", when: "Wed 29 Jul" } }),
  A({ name: "Maxim Stepman", coachId: "noa", city: "Roeselare", block: "B2 W3", adherence: 77, due: { label: "9 DAYS", sub: "write week 4", days: 9 }, lastLogged: { what: "Upper session", when: "Sun 26 Jul" } }),
  A({ name: "Wout Vanoutryve", coachId: "noa", city: "Menen", competing: true, block: "B1 W1", adherence: 71, due: { label: "7 DAYS", sub: "write week 2", days: 7 }, lastLogged: { what: "Full body", when: "Thu 23 Jul" } }),
  A({ name: "Louis De Gruyter", coachId: "noa", city: "Torhout", block: "B2 W2", adherence: 66, due: { label: "OVERDUE", sub: "block ended", days: -1, flagged: true }, ping: true, lastLogged: { what: "Deadlift", when: "Fri 24 Jul" } }),
  A({ name: "Alessie De Baets", coachId: "noa", city: "Lichtervelde", competing: true, block: "B3 W1", adherence: 85, due: { label: "11 DAYS", sub: "write week 2", days: 11 }, lastLogged: { what: "Squat session", when: "Tue 28 Jul" } }),
  A({ name: "Phébe Verhamme", coachId: "noa", city: "Zonnebeke", block: "B1 W2", adherence: 73, due: { label: "5 DAYS", sub: "write week 3", days: 5 }, lastLogged: { what: "Bench session", when: "Wed 29 Jul" } }),
  A({ name: "Dylan Vandenabeel", coachId: "noa", city: "Staden", block: "B2 W1", adherence: 60, due: { label: "OVERDUE", sub: "block ended", days: -1, flagged: true }, ping: true, lastLogged: { what: "Upper session", when: "Sat 25 Jul" } }),
  A({ name: "Manon Geldof", coachId: "noa", city: "Hooglede", block: "B1 W3", adherence: 79, due: { label: "6 DAYS", sub: "write week 4", days: 6 }, lastLogged: { what: "Full body", when: "Thu 23 Jul" } }),
  A({ name: "Emmanuel Debackere", coachId: "noa", city: "Moorslede", block: "B4 W2", adherence: 82, due: { label: "13 DAYS", sub: "write week 3", days: 13 }, lastLogged: { what: "Deadlift", when: "Mon 27 Jul" } }),
  A({ name: "Jeroen Goethals", coachId: "noa", city: "Gits", block: "B2 W2", adherence: 68, due: { label: "OVERDUE", sub: "block ended", days: -1, flagged: true }, ping: true, lastLogged: { what: "Squat session", when: "Sun 19 Jul" } }),

  // Mika Vankerckhove's athletes (from his hand-off list — not yet real accounts).
  A({ name: "Brecht Colemont", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
  A({ name: "Brent Vandeburie", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
  A({ name: "Emmy Fonteyne", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
  A({ name: "Guliano Pottier", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
  A({ name: "Tim Heyrick", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
  A({ name: "Charlotte Staelen", coachId: "mika", city: "—", block: "—", adherence: 0, due: { label: "NEW", sub: "set up program", days: null } }),
];

// Which meets each demo athlete is opted into (real athletes use their own data).
const DEMO_OPTS: Record<string, string[]> = {
  ZD: ["vk-subj-jun"], // Zita Depoorter
  BW: ["vk-open"], // Brendon de Wit
  JC00: ["vk-subj-jun", "vk-open"], // Jess Clarysse
  GV00: ["wk-jun"], // Gauthier Verkinderen
  JD00: ["wec", "vk-open"], // Jana Dutordoir
  WV00: ["vk-subj-jun"], // Wout Vanoutryve
  ADB00: ["vk-subj-jun", "bk-classic"], // Alessie De Baets
};

/** Build a demo athlete's opt list from the catalogue + seed + overlay changes. */
function demoOpts(athleteId: string, overlayOpts?: Record<string, boolean>): MeetOpt[] {
  const set = new Set(DEMO_OPTS[athleteId] ?? []);
  if (overlayOpts) for (const [cid, on] of Object.entries(overlayOpts)) (on ? set.add(cid) : set.delete(cid));
  return getSharedCompetitions()
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ id: c.id, name: c.name, date: c.date, level: c.level, opted: set.has(c.id) }));
}

// --- live athlete row --------------------------------------------------------
function abbrevBlock(blockLabel: string): string {
  // "BLOCK 1 · WEEK 1" → "B1 W1"
  const b = blockLabel.match(/BLOCK\s*(\d+)/i)?.[1] ?? "1";
  const w = blockLabel.match(/WEEK\s*(\d+)/i)?.[1] ?? "1";
  return `B${b} W${w}`;
}

/** Build a live ClientRow for any real, cloud-synced athlete from their model. */
function liveRow(model: DashboardModel, overlay: Overlay, opt: { athleteId?: string; name?: string; city?: string; coachId?: string } = {}): ClientRow {
  const opts: MeetOpt[] = model.competitions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ id: c.id, name: c.name, date: c.date, level: c.level, opted: model.optedInComps.includes(c.id) }));
  const lastMsg = model.notes.sent[0];
  const scores = model.checkin.scores;
  const bwBars = model.bwEntries.slice(-8).map((e) => e.kg);
  const nameFromModel = model.athlete.firstName ? `${model.athlete.firstName[0]}${model.athlete.firstName.slice(1).toLowerCase()}` : "Athlete";
  return {
    athleteId: opt.athleteId ?? LIVE_ATHLETE_ID,
    name: opt.name ?? `${nameFromModel} Strauwen`,
    avatar: model.athlete.avatar,
    city: opt.city ?? "—",
    competing: model.optedInComps.length > 0,
    coachId: opt.coachId ?? "noa",
    live: true,
    block: abbrevBlock(model.blockLabel),
    session: { title: model.todayCard.title, detail: model.checkinStatus.startsWith("Submitted") ? "check-in in" : "current session" },
    lastLogged: { what: "Last logged session", when: model.checkinStatus.replace("Due · ", "due ") },
    adherence: parseInt(model.adherence.percent, 10) || 0,
    due: { label: "THIS WEEK", sub: "live athlete", days: 0 },
    checked: false,
    rank: 0,
    note: overlay.note ?? "",
    ping: sentNotes(model).some((n) => !n.checkedAt), // unread notes only
    bodyweight: {
      value: model.bw.currentLabel,
      delta: `${model.bwEntries.length} weigh-ins`,
      bars: bwBars,
    },
    prs: model.prs.map((p) => ({ lift: p.lift, value: p.value })),
    prsNote: model.totals.comp === "—" ? "No comp total yet." : `Best comp total ${model.totals.comp} kg.`,
    checkin: {
      sleep: scores.sleep,
      nutrition: scores.nutrition,
      stress: scores.stress,
      motivation: scores.motivation,
      pain: scores.pain,
    },
    sessionNotes: {
      last: lastMsg?.text ?? "",
      prev: model.notes.sent[1]?.text ?? "",
      week: "",
    },
    message: lastMsg?.text ?? "",
    notes: sentNotes(model).sort((a, b) => b.date.localeCompare(a.date)),
    hideMaxes: overlay.hideMaxes ?? false,
    disabled: overlay.disabled ?? false,
    streak: model.streak ?? 0,
    opts,
  };
}

// --- public reads ------------------------------------------------------------
function isoToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/**
 * Overlay each row with real programming status from the coach's written weeks.
 * Athletes with no written program keep their authored due (demo filler) but
 * still get a sensible sort key so the board can order by "needs a week".
 */
function withPlan(r: ClientRow, today: string): ClientRow {
  const st = programStatus(r.athleteId, today);
  if (st.state === "none") {
    const days = r.due.days;
    // Brand-new athletes (nothing logged, no block) need a programme written —
    // float them up near the flagged rows rather than burying them.
    const brandNew = r.adherence === 0 && (r.block === "—" || r.block === "");
    const rank = r.due.flagged ? -50 + (days ?? 0) : brandNew ? -20 : days == null ? 900 : 200 + days;
    return { ...r, checked: days != null && days > 7 && !r.due.flagged, rank };
  }
  return {
    ...r,
    due: {
      label: st.label,
      sub: st.sub,
      days: st.daysUntil,
      flagged: st.state === "overdue" || (st.state === "due" && (st.daysUntil ?? 99) <= 1),
    },
    checked: st.checked,
    rank: st.rank,
  };
}

export function getClients(coachId?: string, opts?: { includeDisabled?: boolean }): ClientRow[] {
  const overlay = readOverlay();
  const today = isoToday();
  const seen = new Set<string>();
  const rows: ClientRow[] = [];

  // Every real account this coach OWNS or has SHARED to them (cloud-synced live
  // rows from startCoachSync). This is the whole roster — no hardcoded athletes,
  // so each coach sees only their own people (Renée included, via her coach link).
  for (const a of realAthletes) {
    if (seen.has(a.athleteId)) continue;
    seen.add(a.athleteId);
    const o = overlay[a.athleteId] ?? {};
    rows.push({
      ...liveRow(getDashboardModel(a.athleteId), o, {
        athleteId: a.athleteId,
        name: a.name,
        // The athlete's column = their OWNER coach (mapped from user_id), so the
        // Team board groups everyone under the right coach.
        coachId: o.coachId ?? (a.ownerId ? coachByUserId[a.ownerId] : undefined) ?? a.coachId ?? "noa",
      }),
      shared: a.shared,
      owned: a.owned,
    });
  }

  // Demo placeholders (skip any that are now real accounts).
  for (const d of SHOW_DEMO_ATHLETES ? DEMO : []) {
    if (seen.has(d.athleteId)) continue;
    const o = overlay[d.athleteId] as (Overlay & { opts?: Record<string, boolean> }) | undefined;
    const opts = demoOpts(d.athleteId, o?.opts);
    rows.push({ ...d, note: o?.note ?? d.note, hideMaxes: o?.hideMaxes ?? d.hideMaxes, disabled: o?.disabled ?? false, coachId: o?.coachId ?? d.coachId, opts, competing: d.competing || opts.some((x) => x.opted) });
  }

  const withPlans = rows.map((r) => withPlan(r, today));
  const scoped = coachId ? withPlans.filter((r) => r.coachId === coachId) : withPlans;
  // Disabled (archived) athletes are hidden everywhere unless explicitly asked
  // for — that's how the roster and the top-right switcher stay decluttered.
  return opts?.includeDisabled ? scoped : scoped.filter((r) => !r.disabled);
}

// --- competition catalogue (coach-managed, shared to every athlete) ----------
export function getCompetitions(): Competition[] {
  return getSharedCompetitions().slice().sort((a, b) => a.date.localeCompare(b.date));
}
export function addCompetition(c: Competition) {
  setSharedCompetitions([...getSharedCompetitions(), c]);
  emit();
}
export function updateCompetition(id: string, patch: Partial<Competition>) {
  setSharedCompetitions(getSharedCompetitions().map((c) => (c.id === id ? { ...c, ...patch } : c)));
  emit();
}
export function removeCompetition(id: string) {
  setSharedCompetitions(getSharedCompetitions().filter((c) => c.id !== id));
  emit();
}

export function teamSummary() {
  const all = getClients();
  return COACHES.map((c) => {
    const roster = all.filter((r) => r.coachId === c.id);
    const avg = roster.length ? Math.round(roster.reduce((s, r) => s + r.adherence, 0) / roster.length) : 0;
    return {
      coach: c,
      count: roster.length,
      competing: roster.filter((r) => r.competing).length,
      avgAdherence: avg,
      dueSoon: roster.filter((r) => r.due.days !== null && r.due.days <= 3).length,
      flagged: roster.filter((r) => r.due.flagged).length,
      names: roster.map((r) => r.name),
    };
  });
}
