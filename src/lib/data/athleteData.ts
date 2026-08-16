import seed from "./athleteSeed.json";
import { supabase, coachSupabase } from "../supabase";
import { computeAdherence, currentWeekWindow, type AdherenceView, type Weekday } from "../calc/adherence";
import { bwChart, type BwEntry, type BwModel, type BwRange } from "../calc/bwChart";
import { fmtKg } from "../calc/records";
import { DEFAULT_WEEK } from "../program/seedProgram";
import { deriveRecords, type Baseline } from "../program/deriveRecords";
import {
  getSession,
  getWeek,
  getMonth,
  dueSoFarAdherence,
  fullWeekCounts,
  addDays,
  type ProgramLogs,
  type Session,
  type WeekDay,
  type MonthCell,
  type SetLog,
  type WeekTemplate,
} from "../program/program";

/**
 * Athlete dashboard data.
 *
 * This is the single source the dashboard renders from. Today it's stored per
 * athlete in localStorage (seeded with the demo values). When the coach
 * dashboard exists it writes the same shape into Supabase — profile, program,
 * PRs, totals, coach note — and the athlete sees it here. Athlete-side inputs
 * (bodyweight logs, the weekly check-in) are written back the same way.
 */

export type CheckinScores = {
  training: number; sleep: number; nutrition: number;
  stress: number; overall: number; motivation: number; pain: number;
};

export type DashboardData = {
  weekStartsOn: Weekday;
  blockStart: string | null;
  program: { blockName: string; weekName?: string };
  // Best competition lifts (kg strings) — coach-entered on the profile.
  compPr?: { squat: string; bench: string; deadlift: string };
  athlete: {
    firstName: string;
    welcomeSub: string;
    sex: "male" | "female";
    age: string;
    goalClass: string;
    bodyweightTile: string;
    trainingAge: string;
    avatar?: string; // data URL of the profile picture
    freeTeeUsed?: boolean; // coach-set: has the athlete already claimed their free tee
  };
  nextSession: { status: string; title: string };
  metrics: { setsDone: number; setsTotal: number; rpeDone: number; rpeTotal: number };
  totals: { gym: string; gymDelta: string; comp: string; compNote: string };
  prs: { lift: string; key?: string; value: string; date: string; delta: string }[];
  gl: { current: string; best: string; goal?: string; note: string };
  bodyweight: { value: string; classLabel: string; note: string; tooltip: string; inputValue: string };
  bwRange: BwRange;
  bwEntries: BwEntry[];
  coach: { name: string; role: string };
  shop: { sub: string };
  // Coach-managed catalogue + the athlete's request (they collect kit at the gym).
  shopProducts: {
    id: string;
    name: string;
    desc: string;
    price: number; // €, paid price
    sized: boolean; // apparel needs a size; a bottle does not
    freeEligible?: boolean; // first one free while the athlete still has their free tee
    images: string[]; // 1–3 product photos
  }[];
  shopOrder: { size: string; cart: Record<string, number>; note: string };
  // The order the athlete last sent to the coach (so the coach sees it).
  shopSubmitted?: { at: string; size: string; cart: Record<string, number>; note: string };
  // Coach-managed competition calendar + the athlete's opt-ins (coach follows up).
  competitions: { id: string; name: string; date: string; location: string; level: "national" | "international"; going: number; note?: string }[];
  optedInComps: string[];
  checkin: { weekStart: string | null; submitted: boolean; scores: CheckinScores; note: string };
  programLogs: ProgramLogs;
  // Weekly template published by the coach. Absent → the built-in DEFAULT_WEEK.
  // Legacy single week — kept as a fallback; publishedWeeks (dated) is preferred.
  programWeek?: WeekTemplate;
  // Dated weeks the coach published, keyed by each week's start date. The app
  // resolves the week whose start is on/before a given date, so making weeks in
  // advance never changes what's "current" — the date does.
  publishedWeeks?: Record<string, { week: WeekTemplate; blockName?: string; weekName?: string }>;
  // Weekly adherence snapshots — the score the coach tracks over time.
  adherenceHistory: { weekStart: string; percent: number }[];
  lastSnapshotWeek: string | null;
  // Notes the athlete sends the coach. `checkedAt` is set when the coach marks it
  // read — that starts the 4-week window before it drops off the athlete's screen
  // (the coach keeps it forever).
  // `deleted` = tombstone keys for single removed notes; `wipe` = a timestamp
  // that clears every note sent before it. Both survive the union-merge so a
  // cached copy on any device can't resurrect a delete. `sentAt` (ms) lets a
  // note outlive a wipe only if it was sent afterwards.
  notes: { tags: string[]; sent: { id?: string; date: string; text: string; checkedAt?: string; sentAt?: number }[]; deleted?: string[]; wipe?: number };
  // Week-lock: future weeks blur until the athlete keeps ≥50% logging in the
  // week before them. Coach-controlled — off for good (weekLockOff) or unlocked
  // for specific week-starts (weekLockBypass), so the coach can grant access.
  weekLockOff?: boolean;
  weekLockBypass?: string[];
  // Streak only counts training days on/after this date — so backfilled history
  // (weeks logged in retrospect) never inflates the streak.
  streakStart?: string;
  // Web-push subscription (PushSubscription JSON) so the coach's publish can send
  // this athlete a notification. Written by their device when they opt in.
  pushSub?: unknown;
  // Attempt plans per meet (coach-authored). Stored on the athlete so the athlete
  // sees their attempts + the coach's live meet-day ticks. Keyed by competition id.
  attemptPlans?: Record<string, unknown>;
  // The athlete's A/B session pick per date, when a day has an Option B.
  sessionChoice?: Record<string, "A" | "B">;
  // Coach-set time off + events for this athlete — shown on the coach calendar
  // and on the athlete's own calendar + dashboard. `endDate` (inclusive) makes a
  // multi-day span like a holiday; omit it for a single-day event.
  events?: AthleteEvent[];
};

export type AthleteEvent = { id: string; date: string; endDate?: string; type: "vacation" | "event"; title: string };

/** The flat view the UI renders: raw data plus computed adherence + bw chart. */
export type DashboardModel = DashboardData & {
  adherence: AdherenceView;
  checkinStatus: string;
  weeklySubmitted: boolean;
  bw: BwModel;
  bwLoggedToday: boolean;
  todayCard: { label: string; title: string; sub: string; done: boolean; rest: boolean };
  blockLabel: string;
  compCountdown: string; // "3 WEEKS OUT · <meet>" if opted in, else "" (blank)
  bodyweightAvg4w: string;
  streak: number; // consecutive training days logged ≥80% (rest days don't break it)
};

export type LogResult =
  | { status: "added" | "overwritten" }
  | { status: "exists"; existingKg: number }
  | { status: "invalid" };

const SEED = seed as unknown as DashboardData;

// The per-athlete DEFAULT. The seed JSON is Renée's real data, so using it as a
// fallback leaked her PRs / bodyweight / block into any athlete who hadn't loaded
// their own data yet. BLANK keeps only the generic structure (shop, coach, tiles,
// check-in defaults) and zeroes everything athlete-specific, so every account
// starts — and stays — private.
const BLANK: DashboardData = {
  ...SEED,
  program: { blockName: "" },
  athlete: { ...SEED.athlete, firstName: "ATHLETE", welcomeSub: "" },
  blockStart: null,
  bwEntries: [],
  prs: [],
  compPr: { squat: "", bench: "", deadlift: "" },
  totals: { gym: "—", gymDelta: "", comp: "—", compNote: "First competition still to come" },
  gl: { current: "—", best: "—", note: "" },
  adherenceHistory: [],
  lastSnapshotWeek: null,
  optedInComps: [],
  programLogs: {},
  publishedWeeks: {},
  programWeek: undefined,
  notes: { ...SEED.notes, sent: [] },
};

const key = (athleteId: string) => `ssc.dashboard.${athleteId}`;
const listeners = new Set<() => void>();
// Local-date string (toISOString is UTC and shifts the day in +TZ).
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();

function isoWeekStart(data: DashboardData, today = new Date()): string {
  return iso(currentWeekWindow(data.weekStartsOn, today).start);
}

const baselineFor = (prs: DashboardData["prs"], name: string): Baseline => {
  const p = prs.find((x) => new RegExp(name, "i").test(x.lift));
  return p
    ? { value: parseFloat(p.value.replace(",", ".")), date: p.date, delta: parseFloat(p.delta.replace(",", ".").replace("+", "")) }
    : { value: 0, date: "", delta: 0 };
};

/** Distinct days with a bodyweight entry inside the current training week. */
function bwDaysThisWeek(data: DashboardData, today = new Date()): number {
  const { start, end } = currentWeekWindow(data.weekStartsOn, today);
  const s = iso(start);
  const e = iso(end);
  const days = new Set(data.bwEntries.filter((x) => x.date >= s && x.date < e).map((x) => x.date));
  return days.size;
}

export function getDashboard(athleteId: string): DashboardData {
  try {
    const raw = localStorage.getItem(key(athleteId));
    if (raw) {
      const s = JSON.parse(raw) as Partial<DashboardData>;
      // Deep-merge nested objects onto the BLANK default so missing fields fill
      // with generic (not Renée's) values, keeping every account private.
      return {
        ...BLANK,
        ...s,
        program: { ...BLANK.program, ...s.program },
        athlete: { ...BLANK.athlete, ...s.athlete },
        nextSession: { ...BLANK.nextSession, ...s.nextSession },
        metrics: { ...BLANK.metrics, ...s.metrics },
        totals: { ...BLANK.totals, ...s.totals },
        gl: { ...BLANK.gl, ...s.gl },
        bodyweight: { ...BLANK.bodyweight, ...s.bodyweight },
        coach: { ...BLANK.coach, ...s.coach },
        shop: { ...BLANK.shop, ...s.shop },
        // Coach-editable shared catalogues (shop + competitions) — every athlete
        // reads them; only coaches write, synced via app_shared.
        shopProducts: getSharedData("shopProducts", SEED.shopProducts),
        shopOrder: { ...BLANK.shopOrder, ...s.shopOrder },
        competitions: getSharedCompetitions(), // coach-managed shared catalogue
        optedInComps: s.optedInComps ?? BLANK.optedInComps,
        checkin: { ...BLANK.checkin, ...s.checkin },
        notes: { ...BLANK.notes, ...s.notes },
      };
    }
  } catch {
    /* fall through to blank */
  }
  return BLANK;
}

function save(athleteId: string, data: DashboardData) {
  try {
    localStorage.setItem(key(athleteId), JSON.stringify(data));
  } catch {
    /* storage may be unavailable */
  }
  pushToServer(athleteId, data);
  listeners.forEach((cb) => cb());
}

/**
 * Countdown to the athlete's next opted-in competition — "3 WEEKS OUT · <meet>"
 * or "5 DAYS OUT · <meet>", blank when they're not opted into any upcoming meet.
 * The coach opting them in makes this appear (opt-ins are shared state).
 */
function compCountdown(data: DashboardData, todayISO: string): string {
  const next = (data.competitions ?? [])
    .filter((c) => data.optedInComps.includes(c.id) && c.date >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next) return "";
  const days = Math.round((Date.parse(`${next.date}T00:00:00`) - Date.parse(`${todayISO}T00:00:00`)) / 86400000);
  const meet = next.name.toUpperCase();
  if (days <= 0) return `COMPETITION TODAY · ${meet}`;
  if (days < 14) return `${days} DAY${days === 1 ? "" : "S"} OUT · ${meet}`;
  return `${Math.round(days / 7)} WEEKS OUT · ${meet}`;
}

/** Weight-class label from the athlete's selected goal class ("69 KG" → "−69 kg class"). */
function classLabelFor(goalClass: string | undefined): string {
  const g = (goalClass ?? "").trim();
  const m = g.match(/^(\d+)(\+?)/);
  if (!m) return "";
  return m[2] ? `${m[1]}+ kg class` : `−${m[1]} kg class`;
}
/** How far the athlete's current weight is from their class limit. */
function classNoteFor(goalClass: string | undefined, bwKg: number): string {
  const m = (goalClass ?? "").trim().match(/^(\d+)(\+?)/);
  if (!m || m[2] === "+") return ""; // open class or none set
  if (!isFinite(bwKg) || bwKg <= 0) return "";
  const d = Math.round((parseInt(m[1], 10) - bwKg) * 10) / 10;
  if (d === 0) return "on the limit";
  return d > 0 ? `${fmtKg(d)} kg under the limit` : `${fmtKg(-d)} kg over the limit`;
}

/** Block · week label — blank until the athlete actually has a programmed block. */
function blockLabelOf(blockName: string | undefined, weekName: string | undefined, weekNum: number, tpl: WeekTemplate): string {
  const hasProgram = tpl.some((d) => !d.rest && d.exercises.length > 0);
  if (blockName) return `${blockName} · ${weekName ?? `WEEK ${weekNum}`}`.toUpperCase();
  if (weekName) return weekName.toUpperCase();
  return hasProgram ? `WEEK ${weekNum}` : "";
}

/**
 * Streak = consecutive completed training days going back from today. A training
 * day counts once the athlete has logged ≥80% of its sets; a rest day never
 * breaks the chain (it just doesn't add to it). Today is given grace — an
 * unfinished session today doesn't reset the streak, it simply doesn't count yet.
 */
function computeStreak(data: DashboardData, today: Date): number {
  const logs = data.programLogs ?? {};
  const todayIso = iso(today);
  let streak = 0;
  let cursor = todayIso;
  const floor = data.streakStart ?? "";
  for (let guard = 0; guard < 400; guard++) {
    if (floor && cursor < floor) break; // don't count backfilled history before the floor
    const s = getSession(templateForDate(data, cursor), logs, cursor);
    if (s.rest || s.exercises.length === 0) {
      cursor = addDays(cursor, -1);
      continue; // rest day — doesn't break, doesn't count
    }
    let total = 0;
    let logged = 0;
    for (const ex of s.exercises) {
      for (const st of ex.sets) {
        total++;
        if ((st.weightKg != null && !st.prefill) || st.failed || st.done) logged++;
      }
    }
    const frac = total ? logged / total : 0;
    if (frac >= 0.8) {
      streak++;
      cursor = addDays(cursor, -1);
      continue;
    }
    if (cursor === todayIso) {
      cursor = addDays(cursor, -1);
      continue; // today's session still in progress — grace, no break
    }
    break; // a past training day left unlogged ends the streak
  }
  return streak;
}

/**
 * Average logged fraction across the week's DUE training sessions (0–100). Only
 * sessions on/before `todayISO` count, so a week is judged on what's elapsed. No
 * due sessions yet → 100 (nothing to hold against the athlete).
 */
export function weekCompletionPct(data: DashboardData, weekStartISO: string, todayISO: string): number {
  const logs = data.programLogs ?? {};
  let fracSum = 0;
  let sessions = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartISO, i);
    if (date > todayISO) break;
    const s = getSession(templateForDate(data, date), logs, date);
    if (s.rest || s.exercises.length === 0) continue;
    let total = 0;
    let logged = 0;
    for (const ex of s.exercises) {
      for (const st of ex.sets) {
        total++;
        if ((st.weightKg != null && !st.prefill) || st.failed || st.done) logged++;
      }
    }
    if (total === 0) continue;
    fracSum += logged / total;
    sessions++;
  }
  return sessions ? Math.round((fracSum / sessions) * 100) : 100;
}

function weekStartFor(data: DashboardData, dateISO: string): string {
  return iso(currentWeekWindow(data.weekStartsOn, new Date(`${dateISO}T00:00:00`)).start);
}

/**
 * Is a session on `date` locked behind the current week? Future weeks blur until
 * the athlete keeps ≥50% logging this week. Coach can switch it off entirely
 * (weekLockOff) or grant a specific week (weekLockBypass). Current and past
 * weeks are always open.
 */
export function isDateWeekLocked(athleteId: string, date: string, todayISO = iso(new Date())): boolean {
  const data = getDashboard(athleteId);
  if (data.weekLockOff) return false;
  const dw = weekStartFor(data, date);
  const cw = weekStartFor(data, todayISO);
  if (dw <= cw) return false;
  if ((data.weekLockBypass ?? []).includes(dw)) return false;
  return weekCompletionPct(data, cw, todayISO) < 50;
}

/** Build the render model: compute adherence, the bw chart, and weekly reset. */
export function buildDashboardModel(data: DashboardData, today = new Date()): DashboardModel {
  const thisWeek = isoWeekStart(data, today);
  const weeklySubmitted = data.checkin.submitted && data.checkin.weekStart === thisWeek;
  // The week whose start is on/before today drives the app — so publishing weeks
  // in advance never changes what's current; the date does.
  const tpl = templateForDate(data, iso(today));
  const curMeta = weekMetaForDate(data, iso(today));
  // Sets/RPE come from the real training log — only sessions due so far this week.
  const counts = dueSoFarAdherence(tpl, data.programLogs ?? {}, data.weekStartsOn, iso(today));
  const adherence = computeAdherence({
    setsDone: counts.setsDone,
    setsTotal: counts.setsTotal,
    rpeDone: counts.rpeDone,
    rpeTotal: counts.rpeTotal,
    bwLogsThisWeek: bwDaysThisWeek(data, today),
    weeklyScoresEntered: weeklySubmitted,
  });
  const bw = bwChart(data.bwEntries, data.bwRange, {
    weekStartsOn: data.weekStartsOn,
    blockStart: data.blockStart,
    today,
  });
  const todaySession = getSession(tpl, data.programLogs ?? {}, iso(today));
  const dueLabel = dayLabel(new Date(`${addDays(thisWeek, 6)}T00:00:00`));
  // Bodyweight tile = average of the last 4 weeks of weigh-ins.
  const bwCutoff = addDays(iso(today), -28);
  const recentBw = (data.bwEntries ?? []).filter((e) => e.date >= bwCutoff);
  const bodyweightAvg4w = recentBw.length
    ? fmtKg(Math.round((recentBw.reduce((s, e) => s + e.kg, 0) / recentBw.length) * 10) / 10)
    : data.athlete.bodyweightTile;
  // Which week of the current block (block start day → now), block name coach-set.
  const blockWeekStart = data.blockStart
    ? iso(currentWeekWindow(data.weekStartsOn, new Date(`${data.blockStart}T00:00:00`)).start)
    : thisWeek;
  const weekNum = Math.max(
    1,
    Math.round((Date.parse(`${thisWeek}T00:00:00`) - Date.parse(`${blockWeekStart}T00:00:00`)) / (7 * 86400000)) + 1,
  );
  // PRs, best total and GL are derived live from the training log.
  const records = deriveRecords(
    tpl,
    data.programLogs ?? {},
    {
      squat: baselineFor(data.prs, "squat"),
      bench: baselineFor(data.prs, "bench"),
      deadlift: baselineFor(data.prs, "dead"),
    },
    data.bwEntries ?? [],
    data.athlete.sex,
    (d) => templateForDate(data, d), // resolve each logged date's own week template
  );
  return {
    ...data,
    prs: records.prs,
    totals: { ...data.totals, gym: records.gym, gymDelta: records.gymDelta },
    gl: { ...data.gl, current: records.glCurrent, best: records.glBest, note: records.glNote },
    adherence,
    streak: computeStreak(data, today),
    weeklySubmitted,
    checkinStatus: weeklySubmitted ? "Submitted ✓" : `Due · ${dueLabel}`,
    bw,
    bwLoggedToday: bw.loggedToday,
    todayCard: {
      label: `TODAY · ${dayLabel(today)}`,
      title: todaySession.rest ? "Rest day" : todaySession.finished ? "Session done for the day" : todaySession.name,
      sub: todaySession.rest
        ? "Recovery — nothing programmed today"
        : todaySession.finished
          ? "All sets logged — nice work"
          : "Tap to open today's session",
      done: todaySession.finished,
      rest: todaySession.rest,
    },
    // The dated week's own labels win, then the coach-set names, then "WEEK n".
    // Blank until there's an actual block (a new athlete shows nothing here).
    blockLabel: blockLabelOf(curMeta.blockName ?? data.program.blockName, curMeta.weekName ?? data.program.weekName, weekNum, tpl),
    compCountdown: compCountdown(data, iso(today)),
    // Weight class follows the athlete's selected goal class — not a dummy label.
    bodyweight: {
      ...data.bodyweight,
      classLabel: classLabelFor(data.athlete.goalClass),
      note: classNoteFor(data.athlete.goalClass, data.bwEntries?.at(-1)?.kg ?? parseFloat((data.athlete.bodyweightTile ?? "").replace(",", "."))),
    },
    bodyweightAvg4w,
  };
}

export function getDashboardModel(athleteId: string, today = new Date()): DashboardModel {
  return buildDashboardModel(getDashboard(athleteId), today);
}

// --- athlete-side writes -----------------------------------------------------

/** Submit the weekly check-in (feeds the adherence extra for this week). */
export function submitCheckin(athleteId: string, scores: CheckinScores, note: string) {
  const data = getDashboard(athleteId);
  save(athleteId, {
    ...data,
    checkin: { weekStart: isoWeekStart(data), submitted: true, scores, note },
  });
}

/**
 * Log bodyweight for today. First log of the day adds an entry; a second log the
 * same day returns { status: "exists" } so the UI can confirm an overwrite, then
 * call again with { overwrite: true }.
 */
export function logBodyweight(athleteId: string, value: string, opts?: { overwrite?: boolean }): LogResult {
  const kg = parseFloat(String(value).replace(",", "."));
  if (!isFinite(kg) || kg < 30 || kg > 300) return { status: "invalid" }; // plausible bodyweight range
  const data = getDashboard(athleteId);
  const today = iso(new Date());
  const entries = [...data.bwEntries];
  const idx = entries.findIndex((e) => e.date === today);
  if (idx >= 0 && !opts?.overwrite) return { status: "exists", existingKg: entries[idx].kg };
  const overwrote = idx >= 0;
  if (overwrote) entries[idx] = { date: today, kg };
  else entries.push({ date: today, kg });
  save(athleteId, {
    ...data,
    bwEntries: entries,
    bodyweight: { ...data.bodyweight, value: `${fmtKg(kg)} kg`, tooltip: `${fmtKg(kg)} kg`, inputValue: String(value) },
  });
  return { status: overwrote ? "overwritten" : "added" };
}

/** Persist the selected graph range so the dashboard sparkline matches 6e. */
export function setBwRange(athleteId: string, range: BwRange) {
  save(athleteId, { ...getDashboard(athleteId), bwRange: range });
}

/**
 * Snapshot the just-ended week's FINAL adherence into the athlete's history the
 * first time the app opens in a new week. This is the weekly score the coach
 * tracks (and averages) — stored locally now, synced to the coach via Supabase
 * later. A precise last-day server job replaces this lazy trigger with the
 * backend; the recorded number is the same.
 */
export function finalizeWeeklyAdherence(athleteId: string, today = new Date()) {
  const data = getDashboard(athleteId);
  const currentWeekStart = isoWeekStart(data, today);
  if (data.lastSnapshotWeek == null) {
    save(athleteId, { ...data, lastSnapshotWeek: currentWeekStart });
    return;
  }
  if (data.lastSnapshotWeek >= currentWeekStart) return; // still the same week

  // Snapshot EVERY ended week between the last snapshot and now — always
  // recomputed from the saved logs, so each week's final score is exact even if
  // the athlete skipped the app for a while. Idempotent + bounded.
  const history = [...(data.adherenceHistory ?? [])];
  let wk = data.lastSnapshotWeek;
  for (let guard = 0; wk < currentWeekStart && guard < 60; guard++) {
    if (!history.some((h) => h.weekStart === wk)) {
      const counts = fullWeekCounts(data.programWeek ?? DEFAULT_WEEK, data.programLogs ?? {}, wk);
      const end = addDays(wk, 7);
      const bwDays = new Set(
        (data.bwEntries ?? []).filter((e) => e.date >= wk && e.date < end).map((e) => e.date),
      ).size;
      const view = computeAdherence({
        setsDone: counts.setsDone,
        setsTotal: counts.setsTotal,
        rpeDone: counts.rpeDone,
        rpeTotal: counts.rpeTotal,
        bwLogsThisWeek: bwDays,
        weeklyScoresEntered: data.checkin.submitted && data.checkin.weekStart === wk,
      });
      history.push({ weekStart: wk, percent: view.percentValue });
    }
    wk = addDays(wk, 7);
  }
  save(athleteId, { ...data, adherenceHistory: history, lastSnapshotWeek: currentWeekStart });
}

// --- training program --------------------------------------------------------

const todayISO = () => iso(new Date());

/** The published week whose start is on/before `date` (the latest such). */
function weekKeyForDate(d: DashboardData, date: string): string | null {
  const keys = Object.keys(d.publishedWeeks ?? {}).sort();
  let chosen: string | null = null;
  for (const k of keys) {
    if (k <= date) chosen = k;
    else break;
  }
  return chosen;
}

/** The template that drives this athlete's sessions on a given date. */
export function templateForDate(d: DashboardData, date: string): WeekTemplate {
  const k = weekKeyForDate(d, date);
  if (k && d.publishedWeeks?.[k]) return d.publishedWeeks[k].week;
  return d.programWeek ?? DEFAULT_WEEK;
}

/** The block / week label for a given date, from the dated week it falls in. */
export function weekMetaForDate(d: DashboardData, date: string): { blockName?: string; weekName?: string } {
  const k = weekKeyForDate(d, date);
  const e = k ? d.publishedWeeks?.[k] : undefined;
  return { blockName: e?.blockName, weekName: e?.weekName };
}

export function getSessionFor(athleteId: string, date: string): Session {
  const d = getDashboard(athleteId);
  return getSession(templateForDate(d, date), d.programLogs ?? {}, date, d.sessionChoice?.[date] ?? "A");
}

/** The athlete's A/B pick for a given day (Option B = the injury alternative). */
export function setSessionChoice(athleteId: string, date: string, option: "A" | "B") {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, sessionChoice: { ...(d.sessionChoice ?? {}), [date]: option } });
}

export function getWeekFor(athleteId: string, ref: string, today = todayISO()): WeekDay[] {
  const d = getDashboard(athleteId);
  return getWeek(templateForDate(d, ref), d.programLogs ?? {}, d.weekStartsOn, ref, today);
}

export function getMonthFor(athleteId: string, year: number, month: number, today = todayISO()): MonthCell[] {
  const d = getDashboard(athleteId);
  return getMonth(templateForDate(d, today), d.programLogs ?? {}, year, month, today);
}

/**
 * Coach publishes a weekly template to the athlete — it drives their app. An
 * optional block start date anchors the athlete's calendar / week numbering, and
 * an optional week-start weekday (0=Sun … 6=Sat) aligns their week window to the
 * day the coach chose to start the week on.
 */
/**
 * A fixed load is the coach's set weight, so it counts as logged the moment it's
 * published — the athlete sees it filled in on both apps and can only adjust it
 * DOWN. Pre-fills the week's fixed sets (never overwriting a real log).
 */
function prelogFixedLoads(logs: ProgramLogs, week: WeekTemplate, weekStart: string): ProgramLogs {
  const sw = new Date(`${weekStart}T00:00:00`).getDay();
  const out: ProgramLogs = { ...logs };
  week.forEach((day, wd) => {
    if (day.rest) return;
    const date = addDays(weekStart, (wd - sw + 7) % 7);
    day.exercises.forEach((ex, ei) => {
      ex.sets.forEach((st, si) => {
        if (!st.fixedLoad || !st.targetLoad) return;
        const kg = parseFloat(st.targetLoad.replace(",", "."));
        if (!isFinite(kg)) return;
        const key = `${ei}_${si}`;
        if (out[date]?.sets?.[key]?.weightKg != null) return; // keep a real log
        const dayLog = { ...(out[date] ?? {}) };
        dayLog.sets = { ...(dayLog.sets ?? {}), [key]: { ...(dayLog.sets?.[key] ?? {}), weightKg: kg, prefill: true } };
        out[date] = dayLog;
      });
    });
  });
  return out;
}

export function publishProgramWeek(
  athleteId: string,
  week: WeekTemplate,
  // `blockStart` here is THIS week's start date — the date it's placed on.
  opts: { blockStart?: string; weekStartsOn?: number; blockName?: string; weekName?: string } = {},
) {
  const d = getDashboard(athleteId);
  const weekStart = opts.blockStart;
  const published = { ...(d.publishedWeeks ?? {}) };
  if (weekStart) published[weekStart] = { week, blockName: opts.blockName, weekName: opts.weekName };
  // Fixed loads are logged on publish so they show + count on both apps.
  const programLogs = weekStart ? prelogFixedLoads(d.programLogs ?? {}, week, weekStart) : d.programLogs;

  const weekStartsOn = (opts.weekStartsOn ?? d.weekStartsOn) as Weekday;
  const keys = Object.keys(published).sort();
  // The block is anchored to its earliest week (keep any earlier existing start).
  const earliest = keys[0];
  const blockStart =
    earliest && (!d.blockStart || earliest < d.blockStart) ? earliest : d.blockStart ?? weekStart ?? null;
  // Legacy single template + labels track TODAY's week, whichever was published.
  const todayKey = weekKeyForDate({ ...d, publishedWeeks: published }, iso(new Date()));
  const cur = todayKey ? published[todayKey] : undefined;
  save(athleteId, {
    ...d,
    publishedWeeks: published,
    programWeek: cur?.week ?? week,
    programLogs: programLogs ?? d.programLogs,
    blockStart,
    weekStartsOn,
    program: {
      ...d.program,
      blockName: cur?.blockName ?? opts.blockName ?? d.program.blockName,
      weekName: cur?.weekName ?? d.program.weekName,
    },
  });
}

/** Coach renames the block / current week — updates the athlete's label live. */
export function setProgramLabels(athleteId: string, patch: { blockName?: string; weekName?: string }) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, program: { ...d.program, ...patch } });
}

/** Store this athlete's web-push subscription (from their device opt-in). */
export function savePushSub(athleteId: string, sub: unknown) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, pushSub: sub });
}

/** Attempt plans (all meets) stored on the athlete — read by coach + athlete. */
export function getAttemptPlans(athleteId: string): Record<string, unknown> {
  return getDashboard(athleteId).attemptPlans ?? {};
}
/** Coach writes an attempt plan onto the athlete (syncs to their app). */
export function saveAttemptPlan(athleteId: string, compId: string, plan: unknown) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, attemptPlans: { ...(d.attemptPlans ?? {}), [compId]: plan } });
}
/** Coach removes an athlete's attempt plan for a meet entirely. */
export function removeAttemptPlan(athleteId: string, compId: string) {
  const d = getDashboard(athleteId);
  const plans = { ...(d.attemptPlans ?? {}) };
  delete plans[compId];
  save(athleteId, { ...d, attemptPlans: plans });
}

/** Coach turns the week-lock motivator off (or back on) for an athlete — all-time. */
export function setWeekLockOff(athleteId: string, off: boolean) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, weekLockOff: off });
}
/** Coach unlocks a single upcoming week for an athlete (a one-week pass). */
export function grantWeekAccess(athleteId: string, weekStartISO: string) {
  const d = getDashboard(athleteId);
  const set = new Set(d.weekLockBypass ?? []);
  set.add(weekStartISO);
  save(athleteId, { ...d, weekLockBypass: [...set] });
}

// --- athlete events / time off (coach-set, visible to the athlete too) --------
export function getAthleteEvents(athleteId: string): AthleteEvent[] {
  return (getDashboard(athleteId).events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
}
export function addAthleteEvent(athleteId: string, e: Omit<AthleteEvent, "id">) {
  const d = getDashboard(athleteId);
  const ev: AthleteEvent = { ...e, id: `ev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  save(athleteId, { ...d, events: [...(d.events ?? []), ev] });
}
export function removeAthleteEvent(athleteId: string, id: string) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, events: (d.events ?? []).filter((x) => x.id !== id) });
}
/** Map of ISO date → the event covering it (single day or within a span). */
export function eventsByDate(events: AthleteEvent[]): Record<string, AthleteEvent> {
  const map: Record<string, AthleteEvent> = {};
  for (const e of events) {
    let d = e.date;
    const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
    for (let guard = 0; guard < 400 && d <= end; guard++) {
      if (!map[d]) map[d] = e;
      d = addDays(d, 1);
    }
  }
  return map;
}

/** Log (or clear) one set's weight / RPE / note for a given date. */
export function logSet(athleteId: string, date: string, key: string, patch: SetLog) {
  const data = getDashboard(athleteId);
  const logs: ProgramLogs = { ...(data.programLogs ?? {}) };
  const day = { ...(logs[date] ?? {}) };
  const merged: SetLog = { ...(day.sets?.[key] ?? {}), ...patch };
  // The athlete confirming/entering a weight (or a fail) turns a coach prefill
  // into a real log, so it now counts toward "done".
  if (patch.weightKg !== undefined || patch.failed !== undefined || patch.done !== undefined || patch.heldSeconds !== undefined) merged.prefill = false;
  day.sets = { ...(day.sets ?? {}), [key]: merged };
  logs[date] = day;
  save(athleteId, { ...data, programLogs: logs });
}

/** Set session-level fields (session RPE, pain, finished) for a date. */
export function setSessionMeta(
  athleteId: string,
  date: string,
  patch: { sessionRpe?: number; pain?: number; finished?: boolean },
) {
  const data = getDashboard(athleteId);
  const logs: ProgramLogs = { ...(data.programLogs ?? {}) };
  logs[date] = { ...(logs[date] ?? {}), ...patch };
  save(athleteId, { ...data, programLogs: logs });
}

// --- coach-side / server writes ---------------------------------------------

/** Coach dashboard (later, via Supabase) patches any part of the athlete's data. */
export function updateFromCoach(athleteId: string, patch: Partial<DashboardData>) {
  save(athleteId, { ...getDashboard(athleteId), ...patch });
}

/** Edit an athlete profile field (age, goal class, training age). */
export function setAthleteInfo(athleteId: string, patch: Partial<DashboardData["athlete"]>) {
  const data = getDashboard(athleteId);
  save(athleteId, { ...data, athlete: { ...data.athlete, ...patch } });
}

/** Official IPF weight classes (kg), by sex — used for the goal-class dropdown. */
export const IPF_CLASSES: Record<"male" | "female", string[]> = {
  male: ["53 KG", "59 KG", "66 KG", "74 KG", "83 KG", "93 KG", "105 KG", "120 KG", "120+ KG"],
  female: ["43 KG", "47 KG", "52 KG", "57 KG", "63 KG", "69 KG", "76 KG", "84 KG", "84+ KG"],
};

/** Set the best competition total — coach-entered now, OpenIPF cron later. */
export function setCompTotal(athleteId: string, comp: string, compNote: string) {
  const data = getDashboard(athleteId);
  save(athleteId, { ...data, totals: { ...data.totals, comp, compNote } });
}

/** Set best competition lifts (squat/bench/deadlift). */
export function setCompPr(athleteId: string, patch: Partial<{ squat: string; bench: string; deadlift: string }>) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, compPr: { squat: "", bench: "", deadlift: "", ...d.compPr, ...patch } });
}

const PR_LABEL: Record<"squat" | "bench" | "deadlift", string> = { squat: "SQUAT", bench: "BENCH PRESS", deadlift: "DEADLIFT" };
/**
 * Set the STARTING (baseline) PR for a lift — used by the coach on setup and the
 * athlete via double-tap. The dashboard still shows max(baseline, heaviest logged),
 * so a genuine logged lift always wins and the auto-update is never lost.
 */
export function setPrBaseline(athleteId: string, lift: "squat" | "bench" | "deadlift", value: string) {
  const d = getDashboard(athleteId);
  const nameRe = lift === "deadlift" ? /dead/i : new RegExp(lift, "i");
  const prs = [...(d.prs ?? [])];
  const idx = prs.findIndex((p) => p.key === lift || nameRe.test(p.lift));
  const entry = { lift: PR_LABEL[lift], key: lift, value: value.trim(), date: "", delta: "+0" };
  if (idx >= 0) prs[idx] = { ...prs[idx], lift: PR_LABEL[lift], key: lift, value: value.trim() };
  else prs.push(entry);
  save(athleteId, { ...d, prs });
}

type SentNote = { id: string; date: string; text: string; checkedAt?: string };
const FOUR_WEEKS_MS = 28 * 86400000;

/** Normalise stored notes (older items may lack an id). */
export function sentNotes(data: DashboardData): SentNote[] {
  const deleted = new Set(data.notes?.deleted ?? []);
  const wipe = data.notes?.wipe ?? 0;
  const seen = new Set<string>();
  return (data.notes?.sent ?? [])
    .filter((n) => !deleted.has(noteKey(n)) && (n.sentAt ?? 0) >= wipe) // dropped or pre-wipe
    .filter((n) => { const k = noteKey(n); if (seen.has(k)) return false; seen.add(k); return true; }) // de-dupe
    .map((n) => ({ id: noteKey(n), date: n.date, text: n.text, checkedAt: n.checkedAt }));
}

/** Notes the ATHLETE still sees: unread, or read by the coach within 4 weeks. */
export function athleteVisibleNotes(data: DashboardData, today = new Date()): SentNote[] {
  const now = today.getTime();
  return sentNotes(data)
    .filter((n) => !n.checkedAt || now - Date.parse(`${n.checkedAt}T00:00:00`) < FOUR_WEEKS_MS)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Athlete sends a note to the coach. */
export function sendNoteToCoach(athleteId: string, text: string) {
  const clean = text.trim();
  if (!clean) return;
  const d = getDashboard(athleteId);
  const note = { id: `n_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`, date: iso(new Date()), text: clean, sentAt: Date.now() };
  save(athleteId, { ...d, notes: { ...d.notes, sent: [note, ...(d.notes?.sent ?? [])] } });
}

/** Coach marks a note read — starts its 4-week window on the athlete's screen. */
export function markNoteChecked(athleteId: string, noteId: string) {
  const d = getDashboard(athleteId);
  const sent = sentNotes(d).map((n) => (n.id === noteId && !n.checkedAt ? { ...n, checkedAt: iso(new Date()) } : n));
  save(athleteId, { ...d, notes: { ...d.notes, sent } });
}

/** Coach deletes a single note for good — tombstoned so it can't come back. */
export function removeNote(athleteId: string, noteId: string) {
  const d = getDashboard(athleteId);
  const sent = (d.notes?.sent ?? []).filter((n) => noteKey(n) !== noteId);
  const deleted = [...new Set([...(d.notes?.deleted ?? []), noteId])];
  save(athleteId, { ...d, notes: { ...d.notes, sent, deleted } });
}

/** Coach clears an athlete's whole note history — a wipe timestamp clears every
 * note sent before now and survives the union-merge, so nothing resurrects. */
export function clearNotes(athleteId: string) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, notes: { ...d.notes, sent: [], wipe: Date.now() } });
}

/** Opt in to a meet. Athletes can opt in but only the coach can undo it. */
export function optInComp(athleteId: string, compId: string) {
  const d = getDashboard(athleteId);
  if (d.optedInComps.includes(compId)) return;
  save(athleteId, { ...d, optedInComps: [...d.optedInComps, compId] });
}

/**
 * Coach-side opt-in control: set or clear an athlete's entry for a meet. This is
 * the only path that can *remove* an opt-in — the athlete app can add but never
 * withdraw, so a locked entry can only be undone from the coach console.
 */
export function coachSetOptIn(athleteId: string, compId: string, opted: boolean) {
  const d = getDashboard(athleteId);
  const has = d.optedInComps.includes(compId);
  if (opted === has) return;
  const optedInComps = opted ? [...d.optedInComps, compId] : d.optedInComps.filter((id) => id !== compId);
  save(athleteId, { ...d, optedInComps });
}

// --- team shop ---------------------------------------------------------------

export function setShopSize(athleteId: string, size: string) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, shopOrder: { ...d.shopOrder, size } });
}

export function setShopQty(athleteId: string, productId: string, delta: number) {
  const d = getDashboard(athleteId);
  const cart = { ...d.shopOrder.cart };
  const q = Math.max(0, (cart[productId] ?? 0) + delta);
  if (q === 0) delete cart[productId];
  else cart[productId] = q;
  save(athleteId, { ...d, shopOrder: { ...d.shopOrder, cart } });
}

export function setShopNote(athleteId: string, note: string) {
  const d = getDashboard(athleteId);
  save(athleteId, { ...d, shopOrder: { ...d.shopOrder, note } });
}

/** Send the request to the coach and reset it. Ordering the free tee claims it. */
export function submitShopOrder(athleteId: string) {
  const d = getDashboard(athleteId);
  const claimedFreeTee = d.shopProducts.some((p) => p.freeEligible && (d.shopOrder.cart[p.id] ?? 0) > 0);
  save(athleteId, {
    ...d,
    athlete: { ...d.athlete, freeTeeUsed: d.athlete.freeTeeUsed || claimedFreeTee },
    // Snapshot the order so the coach can see + fulfil it, then clear the cart.
    shopSubmitted: { at: new Date().toISOString(), size: d.shopOrder.size, cart: { ...d.shopOrder.cart }, note: d.shopOrder.note },
    shopOrder: { ...d.shopOrder, cart: {}, note: "" },
  });
}

/** Coach edits the shop catalogue — reaches every athlete. */
export function setShopProducts(list: DashboardData["shopProducts"]) {
  setSharedData("shopProducts", list);
}
export function getShopProducts(): DashboardData["shopProducts"] {
  return getSharedData("shopProducts", SEED.shopProducts);
}

export function subscribeDashboard(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith("ssc.dashboard.")) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// --- Supabase sync -----------------------------------------------------------
// localStorage stays the synchronous source the UI reads; these mirror it to the
// cloud. Each athleteId maps to one auth user's app_state row. An athlete syncs
// exactly their own row; a coach syncs each of their athletes' rows (RLS allows
// the coach to read + write those). Realtime keeps every mapped row in step.

type RawClient = typeof supabase;
type SyncTarget = { userId: string; channel: ReturnType<typeof supabase.channel> | null; raw: RawClient };
const syncTargets: Record<string, SyncTarget> = {};
// The generated Database type predates app_state/app_profiles; use an untyped
// view for those table calls until `supabase gen types` is re-run.
type UntypedClient = { from: (t: string) => { upsert: (v: unknown, o?: unknown) => Promise<unknown>; select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { data?: DashboardData } | null; error: unknown }> } } } };
const untyped = (c: RawClient) => c as unknown as UntypedClient;

// The athlete app uses `supabase`; the coach console switches these to its own
// client (separate auth session) via enableCoachSync so its RLS-authorised
// reads/writes of athlete + shared rows run as the coach, not the athlete.
let coachRaw: RawClient = supabase;
let sharedRaw: RawClient = supabase;
export function enableCoachSync() {
  coachRaw = coachSupabase;
  sharedRaw = coachSupabase;
}

/** Union two program-log maps: keep every date + set, incoming wins per set key. */
function mergeLogs(a: ProgramLogs = {}, b: ProgramLogs = {}): ProgramLogs {
  const out: ProgramLogs = { ...a };
  for (const date of Object.keys(b)) {
    out[date] = { ...(a[date] ?? {}), ...b[date], sets: { ...(a[date]?.sets ?? {}), ...(b[date]?.sets ?? {}) } };
  }
  return out;
}
const byKey = <T,>(rows: T[] | undefined, k: keyof T): Record<string, T> =>
  Object.fromEntries((rows ?? []).map((r) => [String(r[k]), r]));

/** Stable key for a note — date|text (ignores id, so exact duplicates collapse). */
const noteKey = (n: { date: string; text: string }) => `${n.date}|${n.text}`;

/** Union sent notes by key so neither the athlete's new note nor the coach's
 * read-mark is lost when both write around the same time — but honour tombstones
 * and the wipe timestamp so a coach's delete/clear can't be resurrected by a
 * stale cached copy. */
function mergeNotes(a: DashboardData["notes"] | undefined, b: DashboardData["notes"] | undefined): DashboardData["notes"] {
  const deleted = new Set([...(a?.deleted ?? []), ...(b?.deleted ?? [])]);
  const wipe = Math.max(a?.wipe ?? 0, b?.wipe ?? 0);
  const map = new Map<string, DashboardData["notes"]["sent"][number]>();
  const add = (n: DashboardData["notes"]["sent"][number]) => {
    const k = noteKey(n);
    if (deleted.has(k) || (n.sentAt ?? 0) < wipe) return; // tombstoned or pre-wipe
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, ...n, checkedAt: n.checkedAt ?? prev.checkedAt } : n);
  };
  (a?.sent ?? []).forEach(add);
  (b?.sent ?? []).forEach(add);
  const sent = [...map.values()].sort((x, y) => y.date.localeCompare(x.date));
  return { tags: b?.tags ?? a?.tags ?? [], sent, deleted: [...deleted], wipe };
}

/**
 * Merge a device's write onto the freshest server row so it can't wipe fields it
 * doesn't currently hold. Objects merge field-by-field (a value the writer lacks
 * is kept from the server — this is what stops a coach edit erasing a photo the
 * athlete just added); logs / weigh-ins / published weeks are unioned so nothing
 * logged is ever lost.
 */
function mergeDashboard(server: Partial<DashboardData>, incoming: DashboardData): DashboardData {
  const obj = <K extends keyof DashboardData>(k: K) => ({ ...(server[k] as object), ...(incoming[k] as object) });
  return {
    ...server,
    ...incoming,
    athlete: obj("athlete") as DashboardData["athlete"],
    program: obj("program") as DashboardData["program"],
    compPr: (incoming.compPr ?? server.compPr) as DashboardData["compPr"],
    totals: obj("totals") as DashboardData["totals"],
    gl: obj("gl") as DashboardData["gl"],
    bodyweight: obj("bodyweight") as DashboardData["bodyweight"],
    checkin: obj("checkin") as DashboardData["checkin"],
    notes: mergeNotes(server.notes, incoming.notes),
    programLogs: mergeLogs(server.programLogs, incoming.programLogs),
    publishedWeeks: { ...server.publishedWeeks, ...incoming.publishedWeeks },
    bwEntries: Object.values({ ...byKey(server.bwEntries, "date"), ...byKey(incoming.bwEntries, "date") }).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    adherenceHistory: Object.values({
      ...byKey(server.adherenceHistory, "weekStart"),
      ...byKey(incoming.adherenceHistory, "weekStart"),
    }).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
  };
}

// A logged set that fails to upload (offline / weak signal / lapsed auth) must
// never be stranded on the phone. Failed pushes are remembered here and retried
// automatically — on reconnect, on the next app open, and on a short timer — so
// the athlete's data always catches up to the cloud.
const pendingPush = new Set<string>();
let onlineHooked = false;
function hookOnline() {
  if (onlineHooked || typeof window === "undefined") return;
  onlineHooked = true;
  window.addEventListener("online", () => void flushPendingSync());
}
function queuePending(athleteId: string, delay = 6000) {
  pendingPush.add(athleteId);
  hookOnline();
  window.setTimeout(() => {
    if (pendingPush.has(athleteId)) pushToServer(athleteId, getDashboard(athleteId));
  }, delay);
}
/** Re-push every athlete whose last upload failed. Safe to call anytime. */
export function flushPendingSync() {
  for (const id of [...pendingPush]) pushToServer(id, getDashboard(id));
}
/** True if any local change is still waiting to reach the cloud (for UI hints). */
export function hasPendingSync(): boolean {
  return pendingPush.size > 0;
}

// Serialize pushes per athlete so read-merge-write steps never race each other.
const pushChain: Record<string, Promise<void>> = {};
function pushToServer(athleteId: string, data: DashboardData) {
  const t = syncTargets[athleteId];
  if (!t) { queuePending(athleteId); return; } // not synced yet → remember + retry
  const sb = untyped(t.raw);
  const run = async () => {
    try {
      const { data: row } = await sb.from("app_state").select("data").eq("user_id", t.userId).maybeSingle();
      const merged = row?.data ? mergeDashboard(row.data as Partial<DashboardData>, data) : data;
      await sb.from("app_state").upsert({ user_id: t.userId, data: merged }, { onConflict: "user_id" });
      // Reflect the merged truth locally so this device stops carrying stale fields.
      try {
        localStorage.setItem(key(athleteId), JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      pendingPush.delete(athleteId); // upload landed
      listeners.forEach((cb) => cb());
    } catch (e) {
      console.warn("[sync] push failed — will retry", e);
      queuePending(athleteId); // remember it and try again later
    }
  };
  pushChain[athleteId] = (pushChain[athleteId] ?? Promise.resolve()).then(run, run);
}

async function hydrateTarget(athleteId: string, userId: string, seedIfEmpty: boolean, raw: RawClient): Promise<void> {
  syncTargets[athleteId]?.channel?.unsubscribe();
  syncTargets[athleteId] = { userId, channel: null, raw };
  const sb = untyped(raw);

  const { data: row, error } = await sb.from("app_state").select("data").eq("user_id", userId).maybeSingle();
  if (!error && row?.data) {
    const server = row.data as DashboardData;
    // Own data: keep any local-only logs the server hasn't seen yet, but let the
    // server win on profile/scalars. Coach view: take the server as-is.
    const next = seedIfEmpty ? mergeDashboard(getDashboard(athleteId), server) : server;
    try {
      localStorage.setItem(key(athleteId), JSON.stringify(next));
    } catch {
      /* ignore */
    }
    listeners.forEach((cb) => cb());
    if (seedIfEmpty && JSON.stringify(next) !== JSON.stringify(server)) pushToServer(athleteId, next);
  } else if (!error && seedIfEmpty) {
    // First login on the server: push whatever this device has (seed or local).
    await sb.from("app_state").upsert({ user_id: userId, data: getDashboard(athleteId) }, { onConflict: "user_id" });
  }

  const channel = raw
    .channel(`app_state:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        const remote = (payload.new as { data?: DashboardData } | null)?.data;
        if (!remote) return;
        const next = seedIfEmpty ? mergeDashboard(getDashboard(athleteId), remote) : remote;
        try {
          localStorage.setItem(key(athleteId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        listeners.forEach((cb) => cb());
      },
    )
    .subscribe();
  const t = syncTargets[athleteId];
  if (t) t.channel = channel;
}

/**
 * Athlete self-sync after sign-in: pull their row into localStorage (or seed the
 * server from local on first login), then keep both in step. Safe to call again.
 */
export async function hydrateFromServer(athleteId: string): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id ?? null;
  if (!uid) return; // no session → stay local-only
  await hydrateTarget(athleteId, uid, true, supabase);
  flushPendingSync(); // re-push anything a previous session failed to upload
  await hydrateShared(false); // pull the shared competition list too
}

/** Coach-side: connect each of the coach's athletes' rows (read + live). */
export async function hydrateAthletes(list: { athleteId: string; userId: string }[]): Promise<void> {
  for (const a of list) await hydrateTarget(a.athleteId, a.userId, false, coachRaw);
}

/** Drop all cloud connections (on sign-out). */
export function stopSync() {
  for (const id of Object.keys(syncTargets)) {
    syncTargets[id].channel?.unsubscribe();
    delete syncTargets[id];
  }
  sharedChannel?.unsubscribe();
  sharedChannel = null;
}

// --- shared coach-managed catalogues -----------------------------------------
// Things every athlete sees but only the coach edits (the competition list; the
// shop catalogue later). Stored once in app_shared, mirrored to localStorage so
// reads stay synchronous. RLS: any signed-in user reads, only coaches write.

const sharedKey = (k: string) => `ssc.shared.${k}`;
type SharedClient = {
  from: (t: string) => {
    select: (c: string) => Promise<{ data: { key: string; data: unknown }[] | null; error: unknown }>;
    upsert: (v: unknown, o?: unknown) => { then: (f: () => void, r: (e: unknown) => void) => void };
  };
};
const sharedView = (c: RawClient) => c as unknown as SharedClient;
let sharedChannel: ReturnType<typeof supabase.channel> | null = null;

function getShared<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(sharedKey(k));
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function getSharedCompetitions(): DashboardData["competitions"] {
  return getShared("competitions", SEED.competitions);
}

/** Read any shared catalogue (localStorage-mirrored). */
export function getSharedData<T>(key: string, fallback: T): T {
  return getShared(key, fallback);
}

/** Write any shared catalogue — coach-only via RLS; reaches every reader. */
export function setSharedData(key: string, data: unknown) {
  try {
    localStorage.setItem(sharedKey(key), JSON.stringify(data));
  } catch {
    /* ignore */
  }
  listeners.forEach((cb) => cb());
  sharedView(sharedRaw)
    .from("app_shared")
    .upsert({ key, data }, { onConflict: "key" })
    .then(
      () => {},
      (e: unknown) => console.warn("[sync] shared push failed", e),
    );
}

/** Coach writes the competition catalogue — reaches every athlete. */
export function setSharedCompetitions(list: DashboardData["competitions"]) {
  setSharedData("competitions", list);
}
/** Replace the shared calendar with the app's built-in default list. */
export function resetCompetitionsToDefault() {
  setSharedData("competitions", SEED.competitions);
}

/** Pull shared catalogues into localStorage + keep them live. Coaches seed the
 *  competition list from the app's defaults the first time (seedIfEmpty). */
export async function hydrateShared(seedIfEmpty = false): Promise<void> {
  const { data, error } = await sharedView(sharedRaw).from("app_shared").select("key,data");
  if (!error && data) {
    for (const row of data) {
      try {
        localStorage.setItem(sharedKey(row.key), JSON.stringify(row.data));
      } catch {
        /* ignore */
      }
    }
    listeners.forEach((cb) => cb());
    if (seedIfEmpty && !data.some((r) => r.key === "competitions")) {
      setSharedCompetitions(SEED.competitions);
    }
  }
  sharedChannel?.unsubscribe();
  sharedChannel = sharedRaw
    .channel("app_shared")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_shared" }, (payload) => {
      const r = payload.new as { key?: string; data?: unknown } | null;
      if (!r?.key) return;
      try {
        localStorage.setItem(sharedKey(r.key), JSON.stringify(r.data));
      } catch {
        /* ignore */
      }
      listeners.forEach((cb) => cb());
    })
    .subscribe();
}
