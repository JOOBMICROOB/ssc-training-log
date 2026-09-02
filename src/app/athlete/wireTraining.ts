import {
  getSessionFor,
  getWeekFor,
  getMonthFor,
  getDashboardModel,
  logSet,
  setSessionMeta,
  subscribeDashboard,
  isDateWeekLocked,
  weekCompletionPct,
  getDashboard,
  getAthleteEvents,
  eventsByDate,
  setSessionChoice,
  exerciseBests,
  bestLabel,
  type ExBest,
} from "../../lib/data/athleteData";
import { addDays, type Session, type SessionExercise, type LoggedSet } from "../../lib/program/program";
import { fmtKg } from "../../lib/calc/records";
import { showShareSheet } from "./shareSession";
import { showToast } from "./toast";

/** Parse a coach load field: "105" → {lo:105,hi:105}; "80-90" → {lo:80,hi:90}. */
function parseLoadRange(s?: string): { lo: number; hi: number } | null {
  if (!s) return null;
  const m = s.replace(",", ".").match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  if (m) { const lo = parseFloat(m[1]), hi = parseFloat(m[2]); return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }; }
  const n = parseFloat(s.replace(",", "."));
  return isFinite(n) ? { lo: n, hi: n } : null;
}

/**
 * Wires the session-log screen (design 1a): day buttons (2-letter day + S#),
 * SBD session title with a calendar trigger, the exercise accordion with
 * per-set weight/RPE/notes logging, and the pain / session-RPE footer + finish.
 * A calendar popup navigates months and the week's sessions.
 */

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const MAX_SET_KG = 600; // anything heavier is a mistype
const DAY2 = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const clampKg = (n: number) => Math.max(0, Math.min(MAX_SET_KG, Math.round(n * 2) / 2));
const DAY_FULL = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseKg = (s: string) => parseFloat(s.replace(",", ".").replace(/[^0-9.]/g, ""));

// The coach's prescribed target for a set: a fixed load, a %1RM, an RPE, or
// "to failure" (no number — push until you can't).
function targetShort(st: { targetRpe: string; targetLoad?: string; targetPercent?: string; toFailure?: boolean; timed?: boolean; holdSeconds?: string }): string {
  if (st.timed) return st.holdSeconds ? `${st.holdSeconds} s` : "for time";
  if (st.toFailure) return "to failure";
  if (st.targetLoad) return `${st.targetLoad} kg`;
  if (st.targetPercent) return `${st.targetPercent}%`;
  if (st.targetRpe) return `RPE${st.targetRpe}`;
  return "";
}

function prescription(ex: SessionExercise): string {
  const s = ex.sets;
  if (!s.length) return "";
  const t = targetShort(s[0]);
  const same = s.every((x) => x.targetReps === s[0].targetReps && targetShort(x) === t);
  return same ? `${s.length} × ${s[0].targetReps}${t ? `  ·  ${t}` : ""}` : `${s.length} sets`;
}

// --- markup builders ---------------------------------------------------------

function dayButtons(week: ReturnType<typeof getWeekFor>, selected: string): string {
  return week
    .map((d) => {
      const active = d.date === selected;
      const style = active
        ? "border:1px solid rgb(29,45,61);background:rgb(29,45,61);color:rgb(242,242,243);"
        : d.rest
          ? "border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(138,146,156);"
          : "border:1px solid rgba(29,31,32,.14);background:rgba(var(--a-accent-rgb),.12);color:rgb(60,69,79);";
      return `<button data-day="${d.date}" style="flex:1 1 0;padding:5px 0;text-align:center;border-radius:8px;cursor:pointer;font:600 10px/1.2 'Barlow Condensed',sans-serif;letter-spacing:.08em;${style}">
        <span style="display:block;font-size:8px;opacity:.7">${DAY2[d.weekday]}</span>
        <span style="display:block;margin-top:1px">${d.sessionLabel}</span></button>`;
    })
    .join("");
}

function setRow(ex: SessionExercise, ei: number, st: LoggedSet, si: number, locked: boolean, hideLastWeek = false): string {
  const key = `${ei}_${si}`;
  const lwNum = parseFloat(st.lastWeek.replace(",", "."));
  const loadNum = st.targetLoad ? parseFloat(st.targetLoad.replace(",", ".")) : NaN;
  // Advisory suggested load (RPE / % rows) — a starting hint, never a cap.
  const sugNum = st.targetSuggest ? parseFloat(st.targetSuggest.replace(",", ".")) : NaN;
  // A fixed load: the athlete may only go lighter (capped). The coach may write a
  // single value ("105") or a range ("80-90") — cap at the top, floor at the low end.
  const range = st.fixedLoad ? parseLoadRange(st.targetLoad) : null;
  const capKg = range ? range.hi : NaN; // hard cap (they can match it or go lighter)
  const minKg = range ? range.lo : NaN; // low end of the range (or the single value)
  // Any fixed-load set gets a one-tap DONE (single value, range, or a backoff's
  // computed load). "Done" logs the prescribed load (the low end for a range) so
  // the athlete never has to retype a number that's already on screen.
  const hasFixed = !!range && isFinite(capKg);
  const doneKg = range ? range.lo : NaN; // what DONE logs — the prescribed / low-end weight
  const fixedDone = hasFixed && st.weightKg != null && !st.prefill; // they've confirmed a real weight
  // Seed steppers/↺ from the logged weight, else the coach's fixed load or suggestion, else last week.
  const seed = st.weightKg ?? ex.sets[si - 1]?.weightKg ?? (isFinite(loadNum) ? loadNum : isFinite(sugNum) ? sugNum : isFinite(lwNum) ? lwNum : "");
  const val = st.weightKg != null ? fmtKg(st.weightKg) : "";
  const dis = locked ? "disabled" : "";
  const ro = locked ? "readonly" : "";

  // Timed / hold set — no weight to log; the athlete just marks it done (they can
  // add a kg if it was weighted).
  if (st.timed) {
    const hold = st.holdSeconds || st.targetReps || "";
    const on = st.done || st.heldSeconds != null;
    const secVal = st.heldSeconds != null ? String(st.heldSeconds) : "";
    return `<div style="margin-left:12px;padding:7px 10px 8px 12px;border-left:2px solid rgba(var(--a-accent-rgb),.45);">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="flex:0 0 auto;width:44px;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">SET ${si + 1}</span>
        <span style="flex:1 1 0;font:400 11.5px/1 Barlow,sans-serif;color:rgb(95,104,115);">Target hold ${hold ? `${hold} s` : "for time"}${st.heldSeconds != null ? ` · <span style="color:#2e7d5a;font-weight:600;">held ${st.heldSeconds}s</span>` : on ? ' · <span style="color:#2e7d5a;font-weight:600;">DONE</span>' : ""}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:5px;">
        <input data-secs="${key}" ${ro} inputmode="numeric" placeholder="held (s)" value="${secVal}" style="flex:1.4 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 15px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;border:1px solid rgba(var(--a-accent-rgb),.45);background:rgba(var(--a-accent-rgb),.08);color:#1d2d3d;">
        <input data-wi="${key}" ${ro} inputmode="decimal" placeholder="+kg" value="${val}" style="flex:1 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 14px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;border:1px solid rgba(var(--a-accent-rgb),.25);background:rgba(var(--a-accent-rgb),.05);color:#1d2d3d;">
        <button data-done="${key}" ${dis} title="Mark done without a time" style="flex:0 0 auto;width:44px;height:36px;border-radius:9px;cursor:pointer;font:600 15px/1 'Barlow Condensed',sans-serif;border:1px solid ${on ? "#4f9d69" : "rgba(var(--a-accent-rgb),.45)"};background:${on ? "rgba(79,157,105,.16)" : "transparent"};color:${on ? "#2e7d5a" : "rgb(var(--a-accent2-rgb))"};">✓</button>
      </div>
      ${st.note ? `<input data-note="${key}" ${ro} placeholder="Notes" value="${st.note.replace(/"/g, "&quot;")}" style="width:100%;margin-top:6px;padding:7px 10px;background:rgb(242,242,243);border:1px solid rgba(29,31,32,.16);color:rgb(29,31,32);font-size:12.5px;border-radius:10px;">` : ""}
    </div>`;
  }
  const inStyle = st.failed
    ? "border:1px solid #d98a8a;background:rgba(217,138,138,.12);color:#b45454;"
    : "border:1px solid rgba(var(--a-accent-rgb),.45);background:rgba(var(--a-accent-rgb),.08);color:#1d2d3d;";
  const step = (label: string, attr: string) =>
    `<button ${attr} ${dis} style="flex:0 0 auto;width:32px;height:36px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:#fff;color:rgb(var(--a-accent2-rgb));font:600 17px/1 'Barlow Condensed',sans-serif;cursor:pointer;">${label}</button>`;
  const failBtn = st.requiresRpe
    ? `<button data-fail="${key}" ${dis} title="Failed rep" style="flex:0 0 auto;padding:0 9px;height:36px;border:1px solid ${st.failed ? "#d98a8a" : "rgba(29,31,32,.14)"};border-radius:9px;background:${st.failed ? "rgba(217,138,138,.15)" : "transparent"};color:${st.failed ? "#b45454" : "#8a929c"};font:600 10px/1 'Barlow Condensed',sans-serif;letter-spacing:.08em;cursor:pointer;">FAIL</button>`
    : "";
  const rpeRow = st.requiresRpe
    ? `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
        <span style="flex:0 0 auto;width:44px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgb(138,146,156);">RPE</span>
        <input type="range" data-rpe="${key}" ${dis} min="5" max="10" step="0.5" value="${st.rpe ?? 7.5}" style="flex:1 1 0;height:18px;accent-color:rgb(var(--a-accent2-rgb));">
        <span data-rpeval="${key}" style="flex:0 0 auto;width:56px;text-align:right;font:600 14px/1 'Barlow Condensed',sans-serif;color:rgb(var(--a-accent2-rgb));">${st.rpe != null ? st.rpe : "RATE"}</span>
      </div>`
    : "";
  const last = st.lastWeek && !hideLastWeek
    ? `<div style="margin-top:6px;font:400 10.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(138,146,156);">LAST WEEK · ${st.lastWeek}</div>`
    : "";
  return `<div style="margin-left:12px;padding:7px 10px 8px 12px;border-left:2px solid rgba(var(--a-accent-rgb),.45);">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="flex:0 0 auto;width:44px;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">SET ${si + 1}</span>
      <span style="flex:1 1 0;font:400 11.5px/1 Barlow,sans-serif;color:rgb(95,104,115);">${st.targetReps} reps${targetShort(st) ? ` @ ${targetShort(st)}` : ""}${st.targetSuggest && !st.targetLoad ? ` · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">try ${st.targetSuggest} kg</span>` : ""}${st.backoffPct != null && si === 0 ? ' · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">TOP SET</span>' : ""}${st.backoffPct != null && si >= 1 && !st.targetLoad ? ` · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">−${st.backoffPct}% of set 1</span>` : ""}${st.fixedLoad ? ' · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">FIXED</span>' : ""}${st.failed ? ' · <span style="color:#b45454;font-weight:600;">FAILED</span>' : ""}</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;margin-top:5px;">
      ${step("−", `data-dec="${key}"`)}
      <input data-wi="${key}" ${isFinite(capKg) ? `data-fixed="${capKg}"` : ""} ${isFinite(minKg) ? `data-fixmin="${minKg}"` : ""} ${ro} inputmode="decimal" placeholder="${st.targetLoad ? `${st.targetLoad} kg` : st.targetSuggest ? `${st.targetSuggest} kg` : "kg"}" value="${val}" data-seed="${seed}" style="flex:1 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 15px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;${inStyle}">
      ${step("+", `data-inc="${key}"`)}
      <button data-same="${key}" ${dis} title="Same load as the set before" style="flex:0 0 auto;width:36px;height:36px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:transparent;color:rgb(var(--a-accent2-rgb));font-size:13px;cursor:pointer;">↺</button>
      ${hasFixed ? `<button data-fixdone="${key}" data-fx="${doneKg}" ${dis} title="Log the prescribed load — no need to retype it" style="flex:0 0 auto;padding:0 12px;height:36px;border-radius:9px;cursor:pointer;font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.05em;border:1px solid ${fixedDone ? "#4f9d69" : "rgba(var(--a-accent-rgb),.6)"};background:${fixedDone ? "rgba(79,157,105,.16)" : "rgba(var(--a-accent-rgb),.1)"};color:${fixedDone ? "#2e7d5a" : "rgb(var(--a-accent2-rgb))"};">${fixedDone ? "✓ DONE" : "DONE"}</button>` : ""}
      ${failBtn}
    </div>
    ${rpeRow}
    <input data-note="${key}" ${ro} placeholder="Notes / velocity" value="${st.note.replace(/"/g, "&quot;")}" style="width:100%;margin-top:6px;padding:7px 10px;background:rgb(242,242,243);border:1px solid rgba(29,31,32,.16);color:rgb(29,31,32);font-size:12.5px;border-radius:10px;">
    ${last}
  </div>`;
}

function exerciseBlock(ex: SessionExercise, ei: number, expanded: boolean, locked: boolean, bests: Map<string, ExBest> | null): string {
  const headStyle = expanded
    ? "border:1px solid rgb(var(--a-accent-rgb));background:rgba(var(--a-accent-rgb),.14);"
    : "border:1px solid rgba(29,31,32,.14);background:rgba(255,255,255,.62);";
  const clip = ex.video
    ? `<span data-video="${encodeURI(ex.video)}" title="Watch the coach's clip" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:6px;background:rgb(29,45,61);color:rgb(242,242,243);font:600 8px/1 Barlow,sans-serif;letter-spacing:.06em;cursor:pointer;">▶ WATCH</span>`
    : ex.clip
      ? `<span title="Coach attached a clip" style="flex:0 0 auto;display:grid;place-items:center;width:15px;height:15px;border-radius:5px;background:rgb(29,45,61);color:rgb(242,242,243);font-size:7px;">▶</span>`
      : "";
  const header = `<button data-ex="${ei}" style="width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:11px 12px;cursor:pointer;border-radius:12px;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${headStyle}">
    <div style="flex:1 1 0;">
      <div style="font:600 16px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(29,45,61);">${ex.name}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">${clip}
        <span style="font:400 10.5px/1.2 Barlow,sans-serif;color:rgb(138,146,156);">${ex.scheme}</span></div>
      ${(() => {
        if (bests) { const b = bestLabel(ex.name, ex.mainLift, bests); return b ? `<div style="margin-top:3px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(var(--a-accent2-rgb));">BESTS · ${b}</div>` : ""; }
        return ex.lastWeekLabel ? `<div style="margin-top:3px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(var(--a-accent2-rgb));">LAST WEEK · ${ex.lastWeekLabel}</div>` : "";
      })()}
    </div>
    <div style="flex:0 0 auto;text-align:right;">
      <div style="font:600 11.5px/1.2 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:rgb(107,116,128);">${prescription(ex)}</div>
      <div style="margin-top:2px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.08em;color:rgb(var(--a-accent2-rgb));">${ex.loggedCount} / ${ex.setCount} LOGGED</div>
    </div>
    <span style="flex:0 0 auto;font-size:11px;color:rgb(var(--a-accent2-rgb));">${expanded ? "▴" : "▾"}</span>
  </button>`;
  const body = expanded ? ex.sets.map((st, si) => setRow(ex, ei, st, si, locked, !!bests)).join("") : "";
  return `<div>${header}${body}</div>`;
}

function bodyMarkup(week: ReturnType<typeof getWeekFor>, session: Session, selected: string, isOpen: (ei: number) => boolean, bests: Map<string, ExBest> | null): string {
  const dayRow = `<div style="flex:0 0 auto;display:flex;gap:5px;padding:14px 0 12px;">${dayButtons(week, selected)}</div>`;
  if (session.rest) {
    return `${dayRow}<div style="flex:0 0 auto;padding:24px 0;text-align:center;font:600 20px/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(107,116,128);">REST DAY</div>`;
  }
  const bestsOn = !!bests;
  const refToggle = `<button id="refToggle" title="Switch between last week's loads and your all-time bests" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid ${bestsOn ? "rgb(var(--a-accent-rgb))" : "rgba(var(--a-accent-rgb),.4)"};border-radius:9px;background:${bestsOn ? "rgba(var(--a-accent-rgb),.14)" : "transparent"};color:rgb(41,61,80);font:600 9.5px/1 Barlow,sans-serif;letter-spacing:.1em;cursor:pointer;">${bestsOn ? "BESTS" : "LAST WEEK"} ⇄</button>`;
  const title = `<div style="flex:0 0 auto;padding-bottom:10px;">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <span style="font:600 25px/1 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(29,45,61);">${session.name}</span>
      <button id="dayPickBtn" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px 4px;border:1px solid rgb(var(--a-accent-rgb));border-radius:9px;background:rgba(var(--a-accent-rgb),.1);color:rgb(29,45,61);font:600 24px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em;cursor:pointer;">${DAY_FULL[session.weekday]}<span style="font-size:12px;color:rgb(var(--a-accent2-rgb));">▾</span></button>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font:400 11px/1 Barlow,sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">${session.exercises.length} EXERCISES · ${session.loggedCount} / ${session.setCount} SETS LOGGED</span>
      ${refToggle}
    </div>
  </div>`;
  const altBlock = session.hasAlt ? altSelector(session) : "";
  const exercises = session.exercises.map((ex, ei) => exerciseBlock(ex, ei, isOpen(ei), session.finished, bests)).join("");
  return dayRow + title + altBlock + exercises;
}

/** Option A / Option B toggle + the coach's note, shown when the day has an alternate session. */
function altSelector(session: Session): string {
  const btn = (opt: "A" | "B") => {
    const on = session.option === opt;
    return `<button data-opt="${opt}" style="flex:1 1 0;padding:9px 0;border:1px solid ${on ? "rgb(var(--a-accent-rgb))" : "rgba(var(--a-accent-rgb),.28)"};border-radius:10px;background:${on ? "rgba(var(--a-accent-rgb),.14)" : "transparent"};color:${on ? "rgb(29,45,61)" : "rgb(107,116,128)"};font:600 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;cursor:pointer;">OPTION ${opt}</button>`;
  };
  const note = session.note
    ? `<div style="margin-top:9px;padding:10px 12px;border-radius:10px;background:rgba(var(--a-accent-rgb),.08);border:1px solid rgba(var(--a-accent-rgb),.18);font:400 13px/1.45 Barlow,sans-serif;color:rgb(var(--a-accent2-rgb));"><span style="display:block;font:600 10px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(107,116,128);margin-bottom:4px;">FROM YOUR COACH</span>${escapeHtml(session.note)}</div>`
    : "";
  return `<div style="flex:0 0 auto;padding-bottom:12px;">
    <div style="display:flex;gap:6px;">${btn("A")}${btn("B")}</div>
    ${note}
  </div>`;
}

/** Blurred lock screen for a future week the athlete hasn't earned yet. */
function lockMarkup(week: ReturnType<typeof getWeekFor>, selected: string, currentPct: number, backTo: string): string {
  const dayRow = `<div style="flex:0 0 auto;display:flex;gap:5px;padding:14px 0 12px;">${dayButtons(week, selected)}</div>`;
  return `${dayRow}
    <div style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px 22px;gap:14px;">
      <div style="width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:rgba(var(--a-accent-rgb),.12);border:1px solid rgba(var(--a-accent-rgb),.3);font-size:30px;">🔒</div>
      <div style="font:600 22px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(29,45,61);">NEXT WEEK IS LOCKED</div>
      <div style="max-width:280px;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(89,101,115);">
        You've logged <strong>${currentPct}%</strong> of this week so far. Get to <strong>50%</strong> and next week unlocks automatically — it keeps your training honest and your coach's data clean.
      </div>
      <button data-goto="${backTo}" style="display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:11px 18px;border-radius:12px;border:1px solid rgb(var(--a-accent-rgb));background:rgb(29,45,61);color:rgb(242,242,243);font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;cursor:pointer;">← BACK TO THE WEEK YOU'RE LOGGING</button>
      <div style="max-width:280px;font:400 11px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">
        Need this week opened early? Message your coach — they can unlock it for you.
      </div>
    </div>`;
}

// --- calendar popup ----------------------------------------------------------

function statusLabel(s: { setCount: number; loggedCount: number; status: string }): string {
  if (s.status === "done") return "DONE";
  if (s.status === "upcoming") return "UPCOMING";
  return `${s.loggedCount}/${s.setCount}`;
}

function buildCalendar(
  athleteId: string,
  getSelected: () => string,
  onPick: (date: string) => void,
): { root: HTMLDivElement; open: () => void } {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);z-index:1000;padding:16px;overflow-y:auto";
  let year = 0;
  let month = 0;
  const today = iso(new Date());
  const close = () => (root.style.display = "none");

  function draw() {
    const selected = getSelected();
    const cells = getMonthFor(athleteId, year, month, today);
    const eventMap = eventsByDate(getAthleteEvents(athleteId));
    const grid = cells
      .map((c) => {
        if (!c.date) return `<div></div>`;
        const sel = c.date === selected;
        const ev = eventMap[c.date];
        // No dot on rest days (a plain tile already reads as rest).
        const dotColor = c.status === "rest" ? "transparent" : c.status === "logged" ? "#1d2d3d" : "rgb(var(--a-accent-rgb))";
        const tile = sel
          ? "background:#1d2d3d;color:#f2f2f3;"
          : ev
            ? (ev.type === "vacation" ? "background:rgba(232,161,58,.24);color:#1d2d3d;" : "background:rgba(124,107,214,.2);color:#1d2d3d;")
            : c.status === "logged"
              ? "background:rgba(var(--a-accent-rgb),.22);color:#1d2d3d;" // logged → light blue
              : c.status === "training"
                ? "background:#e6eaef;color:#1d2d3d;" // planned, not logged → light grey
                : "background:transparent;color:#aab0b8;"; // rest → plain
        const ring = c.isToday && !sel ? "box-shadow:0 0 0 2.5px rgb(var(--a-accent-rgb)) inset;" : "";
        const evMark = ev ? `<span style="position:absolute;top:2px;right:4px;font-size:8px;line-height:1;">${ev.type === "vacation" ? "🌴" : "★"}</span>` : "";
        return `<button data-cal="${c.date}" title="${ev ? ev.title.replace(/"/g, "&quot;") : ""}" style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:44px;border:0;border-radius:11px;cursor:pointer;font:600 13px/1 'Barlow Condensed',sans-serif;${tile}${ring}">
          ${evMark}<span>${c.day}</span><span style="width:5px;height:5px;border-radius:50%;background:${dotColor};"></span></button>`;
      })
      .join("");
    const week = getWeekFor(athleteId, selected, today).filter((d) => !d.rest);
    const sessions = week
      .map((d) => {
        const sel = d.date === selected;
        const status = statusLabel(d);
        return `<button data-cal="${d.date}" style="width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:11px 12px;margin-top:6px;border-radius:14px;cursor:pointer;border:1px solid ${sel ? "rgb(var(--a-accent-rgb))" : "rgba(29,31,32,.10)"};background:${sel ? "rgba(var(--a-accent-rgb),.12)" : "rgba(255,255,255,.7)"};">
          <span style="flex:0 0 auto;width:30px;text-align:center;font:600 16px/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(var(--a-accent2-rgb));">${d.sessionLabel}</span>
          <span style="flex:1 1 0;">
            <span style="display:block;font:600 13px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:#1d2d3d;">${d.name} · ${DAY_FULL[d.weekday]}</span>
            <span style="display:block;margin-top:2px;font:400 10.5px/1 Barlow,sans-serif;color:#8a929c;">${d.exerciseCount} exercises · ${d.setCount} sets</span>
          </span>
          <span style="flex:0 0 auto;font:600 9.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(var(--a-accent2-rgb));">${status}</span>
        </button>`;
      })
      .join("");
    root.innerHTML = `<div style="width:344px;max-width:96vw;max-height:calc(100dvh - 32px);overflow-y:auto;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button data-cal-prev style="width:34px;height:34px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:#fff;color:rgb(var(--a-accent2-rgb));cursor:pointer;">‹</button>
        <div style="flex:1 1 0;text-align:center;font:600 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:#1d2d3d;">${MONTHS[month]} ${year}</div>
        <button data-cal-next style="width:34px;height:34px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:#fff;color:rgb(var(--a-accent2-rgb));cursor:pointer;">›</button>
        <button data-cal-close style="width:34px;height:34px;border:0;background:transparent;color:rgb(var(--a-accent2-rgb));font-size:16px;cursor:pointer;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.1em;color:#8a929c;text-align:center;">
        ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div>${d}</div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:6px;">${grid}</div>
      <div style="display:flex;gap:14px;margin-top:12px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.06em;color:#6b7480;">
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:#e6eaef;margin-right:5px;vertical-align:-1px;"></span>TRAINING</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:rgba(var(--a-accent-rgb),.4);margin-right:5px;vertical-align:-1px;"></span>LOGGED</span>
      </div>
      <button data-cal="${today}" style="width:100%;margin-top:12px;padding:11px;border:1px solid rgb(var(--a-accent-rgb));border-radius:12px;background:rgba(var(--a-accent-rgb),.12);color:#1d2d3d;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">GO TO TODAY'S SESSION</button>
      <div style="height:1px;background:rgba(29,31,32,.1);margin:14px 0 4px;"></div>
      <div style="font:400 9px/1 Barlow,sans-serif;letter-spacing:.14em;color:#8a929c;">SESSIONS THIS WEEK</div>
      ${sessions}
    </div>`;
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root) return close();
    if (t.closest("[data-cal-prev]")) {
      month--; if (month < 0) { month = 11; year--; } return draw();
    }
    if (t.closest("[data-cal-next]")) {
      month++; if (month > 11) { month = 0; year++; } return draw();
    }
    if (t.closest("[data-cal-close]")) return close();
    const cell = t.closest<HTMLElement>("[data-cal]");
    if (cell?.dataset.cal) {
      onPick(cell.dataset.cal);
      close();
    }
  });

  return {
    root,
    open: () => {
      const d = new Date(`${getSelected()}T00:00:00`);
      year = d.getFullYear();
      month = d.getMonth();
      draw();
      root.style.display = "flex";
    },
  };
}

// --- main wiring -------------------------------------------------------------

function firstOpenDate(athleteId: string, today: string): string {
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    const s = getSessionFor(athleteId, date);
    if (!s.rest && !s.finished) return date;
  }
  return today;
}

export function wireTraining(host: HTMLElement, athleteId: string): () => void {
  const today = iso(new Date());
  let selected = firstOpenDate(athleteId, today);
  // Exercises start collapsed — the athlete taps one to open it. A per-exercise
  // manual override wins; otherwise an exercise auto-opens while it's mid-log
  // (some but not all sets done) so logging never collapses under you.
  const manualOpen = new Map<number, boolean>();
  let showBests = false; // reference line: false = last week's loads, true = all-time bests
  const inProgress = (ex: SessionExercise) => ex.loggedCount > 0 && ex.loggedCount < ex.setCount;
  const isExOpen = (session: Session, ei: number) =>
    manualOpen.has(ei) ? manualOpen.get(ei)! : !!session.exercises[ei] && inProgress(session.exercises[ei]);

  const body = host.querySelector<HTMLElement>("#trainBody");
  const painSlider = host.querySelector<HTMLInputElement>("#painSlider");
  const sessRpeSlider = host.querySelector<HTMLInputElement>("#sessRpeSlider");
  const finishBtn = host.querySelector<HTMLElement>("#finishBtn");

  // Share-to-story button (shown once the session is confirmed).
  const shareBtn = document.createElement("button");
  shareBtn.textContent = "↗ SHARE TO STORY";
  shareBtn.style.cssText =
    "width:100%;margin-top:8px;padding:13px;border:1px solid rgb(var(--a-accent-rgb));border-radius:14px;background:rgba(var(--a-accent-rgb),.12);color:rgb(29,45,61);font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;display:none;";
  finishBtn?.parentElement?.insertBefore(shareBtn, finishBtn.nextSibling);
  shareBtn.addEventListener("click", () => showShareSheet(athleteId, selected));

  // Header block label (coach-set block name + computed week number).
  const blockEl = host.querySelector<HTMLElement>("#blockLabel");
  if (blockEl) {
    const m = getDashboardModel(athleteId);
    blockEl.textContent = `${m.blockLabel} · ${m.athlete.firstName}`;
  }

  const calendar = buildCalendar(athleteId, () => selected, (date) => {
    selected = date;
    manualOpen.clear();
    render();
  });
  document.body.appendChild(calendar.root);

  function render() {
    const session = getSessionFor(athleteId, selected);
    const week = getWeekFor(athleteId, selected, today);

    // Week-lock: a future week stays blurred until this week hits ≥50% logging.
    if (isDateWeekLocked(athleteId, selected, today)) {
      const data = getDashboard(athleteId);
      const curWeek = getWeekFor(athleteId, today, today);
      const curWeekStart = curWeek[0]?.date ?? today;
      const pct = weekCompletionPct(data, curWeekStart, today);
      // Where "back" takes them: a day in the CURRENT week — the one the lock is
      // gating on ("you've logged X% of this week"). It's never locked (dw === cw),
      // unlike scanning forward, which could land on another blocked future week.
      // Prefer the first session that still needs logging, else the first training day.
      const backTo =
        curWeek.find((d) => { const s = getSessionFor(athleteId, d.date); return !s.rest && !s.finished; })?.date ??
        curWeek.find((d) => !d.rest)?.date ??
        curWeekStart;
      if (body) body.innerHTML = lockMarkup(week, selected, pct, backTo);
      const finishTxt = host.querySelector<HTMLElement>("#finishTxt");
      const finishNote = host.querySelector<HTMLElement>("#finishNote");
      if (finishTxt) finishTxt.textContent = "LOCKED";
      if (finishNote) finishNote.textContent = "Log this week to unlock the next one.";
      if (finishBtn) {
        finishBtn.style.cursor = "default";
        finishBtn.style.background = "transparent";
        finishBtn.style.color = "rgb(138,146,156)";
        finishBtn.style.border = "1px solid rgba(29,31,32,.16)";
      }
      shareBtn.style.display = "none";
      return;
    }

    if (body) body.innerHTML = bodyMarkup(week, session, selected, (ei) => isExOpen(session, ei), showBests ? exerciseBests(athleteId) : null);

    if (painSlider && session.pain != null) painSlider.value = String(session.pain);
    host.querySelector("#painVal") && (host.querySelector<HTMLElement>("#painVal")!.textContent = String(session.pain ?? painSlider?.value ?? 0));
    if (sessRpeSlider && session.sessionRpe != null) sessRpeSlider.value = String(session.sessionRpe);
    host.querySelector("#sessRpeVal") && (host.querySelector<HTMLElement>("#sessRpeVal")!.textContent = String(session.sessionRpe ?? sessRpeSlider?.value ?? 8));

    const left = session.setCount - session.loggedCount;
    const canConfirm = !session.rest && left === 0 && session.setCount > 0;
    const finishTxt = host.querySelector<HTMLElement>("#finishTxt");
    const finishNote = host.querySelector<HTMLElement>("#finishNote");
    if (finishTxt)
      finishTxt.textContent = session.rest
        ? "REST DAY"
        : session.finished
          ? "SESSION CONFIRMED ✓ · TAP TO UNLOCK"
          : left > 0
            ? `LOG EVERY SET TO FINISH · ${left} LEFT`
            : "CONFIRM SESSION";
    if (finishBtn) {
      const active = canConfirm || session.finished;
      finishBtn.style.cursor = active ? "pointer" : "default";
      finishBtn.style.background = session.finished ? "rgba(46,125,90,.14)" : canConfirm ? "rgb(29,45,61)" : "transparent";
      finishBtn.style.color = session.finished ? "#2e7d5a" : canConfirm ? "rgb(242,242,243)" : "rgb(138,146,156)";
      finishBtn.style.border = session.finished
        ? "1px solid rgba(46,125,90,.5)"
        : canConfirm
          ? "1px solid rgb(29,45,61)"
          : "1px solid rgba(29,31,32,.16)";
    }
    if (finishNote)
      finishNote.textContent = session.rest
        ? ""
        : session.finished
          ? "Confirmed — your coach can see this session."
          : left > 0
            ? `${left} set${left === 1 ? "" : "s"} still need a weight before you can confirm.`
            : "Everything's logged — confirm to lock the session.";
    shareBtn.style.display = session.finished ? "block" : "none";
  }

  const isFinished = () => getSessionFor(athleteId, selected).finished;
  // Any edit on a confirmed session offers to unlock first.
  const unlockGate = (): boolean => {
    if (!isFinished()) return true;
    if (confirm("This session is confirmed and locked. Unlock to make changes?")) setSessionMeta(athleteId, selected, { finished: false });
    return false;
  };
  const seedOf = (key: string): number => {
    const el = body?.querySelector<HTMLInputElement>(`[data-wi="${key}"]`);
    const cur = parseKg(el?.value || "");
    if (isFinite(cur) && cur > 0) return cur;
    const s = parseKg(el?.dataset.seed || "");
    return isFinite(s) ? s : 0;
  };
  // The heaviest weight we have any evidence this athlete handles on this exercise
  // — all-time best, last week, the prescribed/suggested load. A log far above it
  // is almost always a typo (10 → 100), so we confirm before writing it.
  const refWeight = (key: string): number => {
    const m = key.match(/^B?(\d+)_(\d+)$/);
    if (!m) return 0;
    const session = getSessionFor(athleteId, selected);
    const ex = session.exercises[Number(m[1])];
    const st = ex?.sets[Number(m[2])];
    if (!ex) return 0;
    const best = exerciseBests(athleteId).get(ex.name.trim().toLowerCase())?.maxLoad ?? 0;
    const nums = [
      best,
      st ? parseFloat(String(st.lastWeek).replace(",", ".")) : NaN,
      st?.targetLoad ? parseFloat(st.targetLoad.replace(",", ".")) : NaN,
      st?.targetSuggest ? parseFloat(st.targetSuggest.replace(",", ".")) : NaN,
    ].filter((n) => isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) : 0;
  };
  // Fixed loads cap the "+" stepper — the athlete can't step above the fixed weight.
  const capFixed = (key: string, kg: number): number => {
    const f = parseFloat(body?.querySelector<HTMLInputElement>(`[data-wi="${key}"]`)?.dataset.fixed ?? "");
    return isFinite(f) ? Math.min(kg, f) : kg;
  };

  body?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const dayBtn = t.closest<HTMLElement>("[data-day]");
    if (dayBtn) { selected = dayBtn.dataset.day!; manualOpen.clear(); return render(); }
    const gotoBtn = t.closest<HTMLElement>("[data-goto]");
    if (gotoBtn) { selected = gotoBtn.dataset.goto!; manualOpen.clear(); return render(); }
    const optBtn = t.closest<HTMLElement>("[data-opt]");
    if (optBtn) {
      setSessionChoice(athleteId, selected, optBtn.dataset.opt as "A" | "B");
      manualOpen.clear();
      return render();
    }
    if (t.closest("#dayPickBtn")) return calendar.open();
    if (t.closest("#refToggle")) { showBests = !showBests; return render(); }
    const vid = t.closest<HTMLElement>("[data-video]");
    if (vid?.dataset.video) { window.open(vid.dataset.video, "_blank", "noopener"); return; }
    const exBtn = t.closest<HTMLElement>("[data-ex]");
    if (exBtn) {
      const i = Number(exBtn.dataset.ex);
      const session = getSessionFor(athleteId, selected);
      const willOpen = !isExOpen(session, i);
      // Accordion: opening one collapses the rest so the page stays clean. Manual
      // toggle still wins over the in-progress auto-open, and closing just closes i.
      if (willOpen) session.exercises.forEach((_, j) => manualOpen.set(j, j === i));
      else manualOpen.set(i, false);
      return render();
    }

    // edits are gated when the session is confirmed/locked
    if (t.closest("[data-inc],[data-dec],[data-same],[data-fail],[data-done],[data-fixdone],[data-secs],[data-wi],[data-note]") && !unlockGate()) return;

    // Fixed-load "DONE": confirm the prescribed load without retyping it (a plain
    // pre-fill never counts as logged until the athlete confirms). Toggles off.
    const fixdone = t.closest<HTMLElement>("[data-fixdone]");
    if (fixdone) {
      const k = fixdone.dataset.fixdone!;
      const fx = parseFloat(fixdone.dataset.fx ?? "");
      let already = false;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) already = st.weightKg != null && !st.prefill; }));
      if (already) return logSet(athleteId, selected, k, { weightKg: null });
      if (isFinite(fx)) { logSet(athleteId, selected, k, { weightKg: fx, failed: false }); showToast(`Logged at ${fmtKg(fx)} kg 👍 Going lighter is always fine.`); }
      return;
    }

    const done = t.closest<HTMLElement>("[data-done]");
    if (done) {
      const k = done.dataset.done!;
      let cur = false;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) cur = st.done; }));
      return logSet(athleteId, selected, k, { done: !cur });
    }
    const inc = t.closest<HTMLElement>("[data-inc]");
    if (inc) { const k = inc.dataset.inc!; return logSet(athleteId, selected, k, { weightKg: clampKg(capFixed(k, seedOf(k) + 2.5)), failed: false }); }
    const dec = t.closest<HTMLElement>("[data-dec]");
    if (dec) { const k = dec.dataset.dec!; return logSet(athleteId, selected, k, { weightKg: clampKg(seedOf(k) - 2.5), failed: false }); }
    const same = t.closest<HTMLElement>("[data-same]");
    if (same) {
      const k = same.dataset.same!;
      const s = parseKg(body?.querySelector<HTMLInputElement>(`[data-wi="${k}"]`)?.dataset.seed || "");
      if (isFinite(s) && s > 0) logSet(athleteId, selected, k, { weightKg: s, failed: false });
      return;
    }
    const fail = t.closest<HTMLElement>("[data-fail]");
    if (fail) {
      const k = fail.dataset.fail!;
      let cur = false;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) cur = st.failed; }));
      return logSet(athleteId, selected, k, { failed: !cur });
    }
  });

  body?.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-rpe]")) {
      const badge = body?.querySelector<HTMLElement>(`[data-rpeval="${t.dataset.rpe}"]`);
      if (badge) badge.textContent = t.value;
    }
  });
  body?.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (isFinished()) return;
    if (t.matches("[data-rpe]")) logSet(athleteId, selected, t.dataset.rpe!, { rpe: Number(t.value) });
    else if (t.matches("[data-secs]")) {
      const v = parseInt(t.value.replace(/[^0-9]/g, ""), 10);
      if (t.value.trim() === "") logSet(athleteId, selected, t.dataset.secs!, { heldSeconds: null, done: false });
      else if (Number.isFinite(v) && v > 0) logSet(athleteId, selected, t.dataset.secs!, { heldSeconds: v, done: true });
    }
    else if (t.matches("[data-wi]")) {
      const v = t.value.trim();
      if (v === "") {
        logSet(athleteId, selected, t.dataset.wi!, { weightKg: null });
      } else {
        let kg = parseKg(v);
        const cap = parseFloat(t.dataset.fixed ?? ""); // top of the range / the single fixed value
        const lo = parseFloat(t.dataset.fixmin ?? ""); // low end of the range (== cap when single)
        const rangeLabel = isFinite(lo) && isFinite(cap) && lo !== cap ? `${fmtKg(lo)}–${fmtKg(cap)} kg range` : `${fmtKg(cap)} kg`;
        if (isFinite(cap) && isFinite(kg) && kg > cap) {
          // above the cap → clamp, and reassure (lighter is always the safe direction)
          showToast(`That's above your ${rangeLabel} — set to ${fmtKg(cap)} kg. Going lighter is completely fine 👍`);
          kg = cap;
        } else if (isFinite(lo) && isFinite(kg) && kg < lo) {
          showToast(`Below your ${rangeLabel} — that's completely fine, lighter is OK 👍`);
        }
        if (isFinite(kg) && kg > 0 && kg <= MAX_SET_KG) {
          // Mislog guard — only for free (non-capped) entries: a value far above
          // everything known for this exercise is almost always a typo.
          if (!isFinite(cap)) {
            const ref = refWeight(t.dataset.wi!);
            if (ref >= 20 && kg > ref * 1.6 && kg - ref >= 25) {
              if (!confirm(`${fmtKg(kg)} kg is well above anything logged for this exercise (best so far ${fmtKg(ref)} kg).\n\nIs that right?`)) {
                render(); // typo — revert the field to the stored value
                return;
              }
            }
          }
          logSet(athleteId, selected, t.dataset.wi!, { weightKg: kg, failed: false });
        } else {
          showToast(`Enter a weight between 0 and ${MAX_SET_KG} kg.`);
          render(); // revert the field to the stored value
        }
      }
    }
  });
  body?.addEventListener("blur", (e) => {
    const t = e.target as HTMLInputElement;
    if (!isFinished() && t.matches("[data-note]")) logSet(athleteId, selected, t.dataset.note!, { note: t.value });
  }, true);

  // Sliders: repaint the number live on every tick (cheap), but only PERSIST on
  // release. Saving on each input tick fired a full save + dashboard re-render per
  // pixel, which is what made the drag stutter.
  painSlider?.addEventListener("input", () => {
    host.querySelector<HTMLElement>("#painVal") && (host.querySelector<HTMLElement>("#painVal")!.textContent = String(Number(painSlider.value)));
  });
  painSlider?.addEventListener("change", () => setSessionMeta(athleteId, selected, { pain: Number(painSlider.value) }));
  sessRpeSlider?.addEventListener("input", () => {
    host.querySelector<HTMLElement>("#sessRpeVal") && (host.querySelector<HTMLElement>("#sessRpeVal")!.textContent = String(Number(sessRpeSlider.value)));
  });
  sessRpeSlider?.addEventListener("change", () => setSessionMeta(athleteId, selected, { sessionRpe: Number(sessRpeSlider.value) }));
  finishBtn?.addEventListener("click", () => {
    const s = getSessionFor(athleteId, selected);
    if (s.rest) return;
    if (s.finished) {
      if (confirm("Unlock this confirmed session to make changes?")) setSessionMeta(athleteId, selected, { finished: false });
      return;
    }
    if (s.loggedCount >= s.setCount && s.setCount > 0) {
      setSessionMeta(athleteId, selected, { finished: true });
      showShareSheet(athleteId, selected);
    }
  });

  const unsub = subscribeDashboard(() => render());
  render();

  return () => {
    unsub();
    calendar.root.remove();
  };
}
