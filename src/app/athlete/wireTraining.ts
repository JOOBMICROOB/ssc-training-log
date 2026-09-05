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
import { addDays, type Session, type SessionExercise, type LoggedSet, type SetLog } from "../../lib/program/program";
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
const RPE_VALUES = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]; // 5–10 in 0.5 steps
const fmtRpeShort = (v: number) => String(v).replace(".", ","); // 8 → "8", 8.5 → "8,5"
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
        ? "border:1px solid rgb(var(--a-navy-rgb));background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);"
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
  const doneKg = range ? range.lo : NaN; // the prescribed / low-end weight the RPE tap logs
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
        <input data-secs="${key}" ${ro} inputmode="numeric" placeholder="held (s)" value="${secVal}" style="flex:1.4 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 15px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;border:1px solid rgba(var(--a-accent-rgb),.45);background:rgba(var(--a-accent-rgb),.08);color:rgb(var(--a-navy-rgb));">
        <input data-wi="${key}" ${ro} inputmode="decimal" placeholder="+kg" value="${val}" style="flex:1 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 14px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;border:1px solid rgba(var(--a-accent-rgb),.25);background:rgba(var(--a-accent-rgb),.05);color:rgb(var(--a-navy-rgb));">
        <button data-done="${key}" ${dis} title="Mark done without a time" style="flex:0 0 auto;width:44px;height:36px;border-radius:9px;cursor:pointer;font:600 15px/1 'Barlow Condensed',sans-serif;border:1px solid ${on ? "#4f9d69" : "rgba(var(--a-accent-rgb),.45)"};background:${on ? "rgba(79,157,105,.16)" : "transparent"};color:${on ? "#2e7d5a" : "rgb(var(--a-accent2-rgb))"};">✓</button>
      </div>
      ${st.note ? `<input data-note="${key}" ${ro} placeholder="Notes" value="${st.note.replace(/"/g, "&quot;")}" style="width:100%;margin-top:6px;padding:7px 10px;background:rgb(242,242,243);border:1px solid rgba(29,31,32,.16);color:rgb(29,31,32);font-size:12.5px;border-radius:10px;">` : ""}
    </div>`;
  }
  const inStyle = st.failed
    ? "border:1px solid #d98a8a;background:rgba(217,138,138,.12);color:#b45454;"
    : "border:1px solid rgba(var(--a-accent-rgb),.45);background:rgba(var(--a-accent-rgb),.08);color:rgb(var(--a-navy-rgb));";
  const step = (label: string, attr: string) =>
    `<button ${attr} ${dis} style="flex:0 0 auto;width:32px;height:36px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:#fff;color:rgb(var(--a-accent2-rgb));font:600 17px/1 'Barlow Condensed',sans-serif;cursor:pointer;">${label}</button>`;
  // A set reads as LOGGED (green) once its weight/fail/done is in and — if required
  // — its RPE is rated; a weight in but RPE missing shows amber ("rate RPE").
  const hasWeight = (st.weightKg != null && !st.prefill) || st.failed || st.done;
  const rpeOk = !st.requiresRpe || st.rpe != null;
  const isLogged = hasWeight && rpeOk;
  const partial = hasWeight && !rpeOk;
  // Fixed load / %1RM: the load is known, so RATING RPE is the main action — tapping
  // it logs the prescribed/suggested load too. Otherwise the athlete logs their load.
  const rpePrimary = hasFixed || !!st.percentOfMax || !!st.targetPercent;
  const rpeFixKg = hasFixed ? doneKg : isFinite(sugNum) ? sugNum : NaN;
  const showRpe = st.requiresRpe || rpePrimary;
  const rpeText = st.failed ? "FAILED" : st.rpe != null ? `RPE ${fmtRpeShort(st.rpe)} ✓` : rpePrimary ? "TAP TO RATE RPE" : "RATE RPE";
  const rpeStyle = st.failed
    ? "border:1px solid #d98a8a;background:rgba(217,138,138,.14);color:#b45454;"
    : st.rpe != null
      ? "border:1px solid rgb(var(--a-navy-rgb));background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);"
      : "border:1px solid rgb(var(--a-accent-rgb));background:rgba(var(--a-accent-rgb),.12);color:rgb(var(--a-accent2-rgb));";
  // The RPE button opens the big slider popup. Primary (fixed/%) = full-width CTA.
  const rpeBtn = (primary: boolean) =>
    `<button data-rpeopen="${key}" ${isFinite(rpeFixKg) ? `data-fixkg="${rpeFixKg}"` : ""} ${dis} style="${primary ? "width:100%;height:44px;font-size:14px;" : "flex:1 1 0;height:36px;font-size:12px;"}border-radius:10px;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.06em;box-sizing:border-box;${rpeStyle}">${rpeText}</button>`;
  const badge = isLogged ? ' · <span style="color:#2e7d5a;font-weight:700;">✓ LOGGED</span>' : partial ? ' · <span style="color:#c98a1e;font-weight:700;">RATE RPE</span>' : "";
  const rowTint = isLogged ? "border-left:2px solid #4f9d69;background:rgba(79,157,105,.05);" : partial ? "border-left:2px solid #d9a441;" : "border-left:2px solid rgba(var(--a-accent-rgb),.45);";
  const last = st.lastWeek && !hideLastWeek
    ? `<div style="margin-top:6px;font:400 10.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(138,146,156);">LAST WEEK · ${st.lastWeek}</div>`
    : "";
  const header = `<div style="display:flex;align-items:center;gap:8px;">
      <span style="flex:0 0 auto;width:44px;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">SET ${si + 1}</span>
      <span style="flex:1 1 0;font:400 11.5px/1 Barlow,sans-serif;color:rgb(95,104,115);">${st.targetReps} reps${targetShort(st) ? ` @ ${targetShort(st)}` : ""}${st.targetSuggest && !st.targetLoad ? ` · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">try ${st.targetSuggest} kg</span>` : ""}${st.backoffPct != null && si === 0 ? ' · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">TOP SET</span>' : ""}${st.backoffPct != null && si >= 1 && !st.targetLoad ? ` · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">−${st.backoffPct}% of set 1</span>` : ""}${st.linkPct != null && !st.targetLoad ? ` · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">−${st.linkPct}% linked</span>` : ""}${st.fixedLoad ? ' · <span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">FIXED</span>' : ""}${badge}</span>
    </div>`;
  const loadRow = `<div style="display:flex;align-items:center;gap:5px;">
      ${step("−", `data-dec="${key}"`)}
      <input data-wi="${key}" ${isFinite(capKg) ? `data-fixed="${capKg}"` : ""} ${isFinite(minKg) ? `data-fixmin="${minKg}"` : ""} ${ro} inputmode="decimal" placeholder="${st.targetLoad ? `${st.targetLoad} kg` : st.targetSuggest ? `${st.targetSuggest} kg` : "kg"}" value="${val}" data-seed="${seed}" style="flex:1 1 0;min-width:0;height:36px;padding:0 8px;text-align:center;border-radius:9px;font:600 15px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;${inStyle}">
      ${step("+", `data-inc="${key}"`)}
      <button data-same="${key}" ${dis} title="Same load as the set before" style="flex:0 0 auto;width:36px;height:36px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:transparent;color:rgb(var(--a-accent2-rgb));font-size:13px;cursor:pointer;">↺</button>
    </div>`;
  const noteInput = `<input data-note="${key}" ${ro} placeholder="Notes / velocity" value="${st.note.replace(/"/g, "&quot;")}" style="width:100%;margin-top:6px;padding:7px 10px;background:rgb(242,242,243);border:1px solid rgba(29,31,32,.16);color:rgb(29,31,32);font-size:12.5px;border-radius:10px;">`;

  if (rpePrimary) {
    // Load is prescribed → RPE is the big main action; the load sits below, compact,
    // for the rare "I went lighter" adjust (it still logs on change).
    return `<div style="margin-left:12px;padding:7px 10px 8px 12px;${rowTint}">
      ${header}
      <div style="margin-top:7px;">${rpeBtn(true)}</div>
      <div style="margin-top:8px;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgb(138,146,156);">LOAD${st.targetLoad ? ` · ${st.targetLoad} kg` : isFinite(rpeFixKg) ? ` · ${fmtKg(rpeFixKg)} kg` : ""} — change only if you went lighter</div>
      <div style="margin-top:4px;">${loadRow}</div>
      ${noteInput}
      ${last}
    </div>`;
  }
  // Athlete logs their own load → load is the main row; RPE (if any) sits below.
  return `<div style="margin-left:12px;padding:7px 10px 8px 12px;${rowTint}">
    ${header}
    <div style="margin-top:5px;">${loadRow}</div>
    ${showRpe ? `<div style="margin-top:7px;display:flex;align-items:center;gap:6px;"><span style="flex:0 0 auto;width:28px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.08em;color:${st.rpe == null && st.requiresRpe ? "#b45454" : "rgb(138,146,156)"};">RPE</span>${rpeBtn(false)}</div>` : ""}
    ${noteInput}
    ${last}
  </div>`;
}

function exerciseBlock(ex: SessionExercise, ei: number, expanded: boolean, locked: boolean, bests: Map<string, ExBest> | null): string {
  const headStyle = expanded
    ? "border:1px solid rgb(var(--a-accent-rgb));background:rgba(var(--a-accent-rgb),.14);"
    : "border:1px solid rgba(29,31,32,.14);background:rgba(255,255,255,.62);";
  const clip = ex.video
    ? `<span data-video="${encodeURI(ex.video)}" title="Watch the coach's clip" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:6px;background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);font:600 8px/1 Barlow,sans-serif;letter-spacing:.06em;cursor:pointer;">▶ WATCH</span>`
    : ex.clip
      ? `<span title="Coach attached a clip" style="flex:0 0 auto;display:grid;place-items:center;width:15px;height:15px;border-radius:5px;background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);font-size:7px;">▶</span>`
      : "";
  const header = `<button data-ex="${ei}" style="width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:11px 12px;cursor:pointer;border-radius:12px;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${headStyle}">
    <div style="flex:1 1 0;">
      <div style="font:600 16px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(var(--a-navy-rgb));">${ex.name}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">${clip}
        <span style="font:400 10.5px/1.2 Barlow,sans-serif;color:rgb(138,146,156);">${ex.scheme}</span></div>
      ${(() => {
        if (bests) { const b = bestLabel(ex.name, ex.mainLift, bests); return b ? `<div style="margin-top:3px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(var(--a-accent2-rgb));">BESTS · ${b}</div>` : ""; }
        return ex.lastWeekLabel ? `<div style="margin-top:3px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(var(--a-accent2-rgb));">LAST WEEK · ${ex.lastWeekLabel}</div>` : "";
      })()}
    </div>
    <div style="flex:0 0 auto;text-align:right;">
      <div style="font:600 16px/1.15 'Barlow Condensed',sans-serif;letter-spacing:.02em;white-space:nowrap;color:rgb(74,84,96);">${prescription(ex)}</div>
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
      <span style="font:600 25px/1 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(var(--a-navy-rgb));">${session.name}</span>
      <button id="dayPickBtn" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px 4px;border:1px solid rgb(var(--a-accent-rgb));border-radius:9px;background:rgba(var(--a-accent-rgb),.1);color:rgb(var(--a-navy-rgb));font:600 24px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em;cursor:pointer;">${DAY_FULL[session.weekday]}<span style="font-size:12px;color:rgb(var(--a-accent2-rgb));">▾</span></button>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font:400 11px/1 Barlow,sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">${session.exercises.length} EXERCISES · ${session.loggedCount} / ${session.setCount} SETS LOGGED</span>
      ${refToggle}
    </div>
  </div>`;
  const altBlock = session.hasAlt ? altSelector(session) : "";
  const exercises = session.exercises.map((ex, ei) => exerciseBlock(ex, ei, isOpen(ei), session.confirmed, bests)).join("");
  return dayRow + title + altBlock + exercises;
}

/** Option A / Option B toggle + the coach's note, shown when the day has an alternate session. */
function altSelector(session: Session): string {
  const btn = (opt: "A" | "B") => {
    const on = session.option === opt;
    return `<button data-opt="${opt}" style="flex:1 1 0;padding:9px 0;border:1px solid ${on ? "rgb(var(--a-accent-rgb))" : "rgba(var(--a-accent-rgb),.28)"};border-radius:10px;background:${on ? "rgba(var(--a-accent-rgb),.14)" : "transparent"};color:${on ? "rgb(var(--a-navy-rgb))" : "rgb(107,116,128)"};font:600 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;cursor:pointer;">OPTION ${opt}</button>`;
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
      <div style="font:600 22px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">NEXT WEEK IS LOCKED</div>
      <div style="max-width:280px;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(89,101,115);">
        You've logged <strong>${currentPct}%</strong> of this week so far. Get to <strong>50%</strong> and next week unlocks automatically — it keeps your training honest and your coach's data clean.
      </div>
      <button data-goto="${backTo}" style="display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:11px 18px;border-radius:12px;border:1px solid rgb(var(--a-accent-rgb));background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;cursor:pointer;">← BACK TO THE WEEK YOU'RE LOGGING</button>
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
        const dotColor = c.status === "rest" ? "transparent" : c.status === "logged" ? "rgb(var(--a-navy-rgb))" : "rgb(var(--a-accent-rgb))";
        const tile = sel
          ? "background:rgb(var(--a-navy-rgb));color:#f2f2f3;"
          : ev
            ? (ev.type === "vacation" ? "background:rgba(232,161,58,.24);color:rgb(var(--a-navy-rgb));" : "background:rgba(124,107,214,.2);color:rgb(var(--a-navy-rgb));")
            : c.status === "logged"
              ? "background:rgba(var(--a-accent-rgb),.22);color:rgb(var(--a-navy-rgb));" // logged → light blue
              : c.status === "training"
                ? "background:#e6eaef;color:rgb(var(--a-navy-rgb));" // planned, not logged → light grey
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
            <span style="display:block;font:600 13px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">${d.name} · ${DAY_FULL[d.weekday]}</span>
            <span style="display:block;margin-top:2px;font:400 10.5px/1 Barlow,sans-serif;color:#8a929c;">${d.exerciseCount} exercises · ${d.setCount} sets</span>
          </span>
          <span style="flex:0 0 auto;font:600 9.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(var(--a-accent2-rgb));">${status}</span>
        </button>`;
      })
      .join("");
    root.innerHTML = `<div style="width:344px;max-width:96vw;max-height:calc(100dvh - 32px);overflow-y:auto;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button data-cal-prev style="width:34px;height:34px;border:1px solid rgba(29,31,32,.14);border-radius:9px;background:#fff;color:rgb(var(--a-accent2-rgb));cursor:pointer;">‹</button>
        <div style="flex:1 1 0;text-align:center;font:600 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(var(--a-navy-rgb));">${MONTHS[month]} ${year}</div>
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
      <button data-cal="${today}" style="width:100%;margin-top:12px;padding:11px;border:1px solid rgb(var(--a-accent-rgb));border-radius:12px;background:rgba(var(--a-accent-rgb),.12);color:rgb(var(--a-navy-rgb));font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">GO TO TODAY'S SESSION</button>
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
    // Only skip a day the athlete has actually CONFIRMED (or that auto-locked).
    // A day that's merely ≥70% logged is still being trained — don't jump past it
    // to the next day while they're mid-session.
    if (!s.rest && !s.confirmed) return date;
  }
  return today;
}

// Plain-language cue for each RPE, so the picker reads as effort, not a bare number.
const RPE_WORD: Record<string, string> = {
  "10": "MAX — nothing left", "9.5": "maybe ½ rep left", "9": "1 rep left", "8.5": "1–2 reps left",
  "8": "2 reps left", "7.5": "2–3 reps left", "7": "3 reps left", "6.5": "3–4 reps left",
  "6": "easy — 4+ left", "5.5": "very easy", "5": "warm-up easy",
};
// Session RPE reads as overall energy / how much the whole session took out of you,
// not reps-in-reserve.
const SESS_RPE_WORD: Record<string, string> = {
  "10": "all-out — completely spent", "9.5": "almost nothing left", "9": "very hard",
  "8.5": "hard", "8": "tough but doable", "7.5": "solid effort", "7": "moderate",
  "6.5": "comfortable", "6": "easy", "5.5": "light", "5": "very light — barely tired",
};

// Pain scale (0 = none) — optional, defaults to zero until the athlete sets it.
const PAIN_VALUES = Array.from({ length: 11 }, (_, i) => i); // 0..10
const painWord = (v: number) => (v === 0 ? "no pain" : v <= 3 ? "mild" : v <= 6 ? "moderate — keep an eye on it" : v <= 9 ? "high — tell your coach" : "severe — stop, message your coach");

// Opaque context carried through the per-set RPE picker (which set + its fixed load).
type PickCtx = { key: string; fixKg: number | null } | null;

/**
 * A centered value-picker popup (same overlay as the calendar, not a full-screen
 * sheet): a big scrollable scale of tappable pills, current pick highlighted, with
 * an optional FAILED row. Reused for per-set RPE, session RPE and pain.
 */
function buildPicker(
  opts: { title: string; sub: string; values: number[]; wordOf: (v: number) => string; allowFail?: boolean; fmt?: (v: number) => string },
  onPick: (value: number | null, failed: boolean, ctx: PickCtx) => void,
): { root: HTMLElement; open: (current: number | null, failed: boolean, ctx?: PickCtx) => void } {
  const fmt = opts.fmt ?? fmtRpeShort;
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);z-index:1000;padding:16px;";
  const pill = (v: number) =>
    `<button data-pv="${v}" style="display:flex;align-items:center;gap:12px;width:100%;padding:11px 13px;border-radius:12px;cursor:pointer;text-align:left;border:1.5px solid rgba(var(--a-accent-rgb),.28);background:rgba(var(--a-accent-rgb),.06);">
       <span class="a-pk-num" style="flex:0 0 auto;width:40px;text-align:center;font:700 21px/1 'Barlow Condensed',sans-serif;color:rgb(var(--a-navy-rgb));">${fmt(v)}</span>
       <span class="a-pk-word" style="flex:1 1 0;font:400 12px/1.2 Barlow,sans-serif;color:rgb(95,104,115);">${opts.wordOf(v)}</span>
       <span class="a-pk-tick" style="flex:0 0 auto;font-size:15px;color:transparent;">✓</span>
     </button>`;
  const pills = opts.values.slice().reverse().map(pill).join(""); // highest at the top
  const failPill = opts.allowFail
    ? `<button data-pv="fail" style="display:flex;align-items:center;gap:12px;width:100%;margin-top:2px;padding:11px 13px;border-radius:12px;cursor:pointer;text-align:left;border:1.5px solid rgba(217,138,138,.5);background:rgba(217,138,138,.1);">
         <span class="a-pk-num" style="flex:0 0 auto;width:40px;text-align:center;font:700 15px/1 'Barlow Condensed',sans-serif;color:#b45454;">✕</span>
         <span style="flex:1 1 0;font:600 12.5px/1.2 Barlow,sans-serif;color:#b45454;">FAILED — couldn't complete the reps</span>
         <span class="a-pk-tick" style="flex:0 0 auto;font-size:15px;color:transparent;">✓</span>
       </button>`
    : "";
  root.innerHTML = `<div style="width:344px;max-width:96vw;max-height:calc(100dvh - 32px);overflow-y:auto;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font:600 18px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">${opts.title}</div>
        <button data-pk-close style="border:none;background:rgba(29,31,32,.06);width:30px;height:30px;border-radius:50%;font-size:13px;color:#5f6873;cursor:pointer;">✕</button>
      </div>
      <div style="font:400 11px/1.4 Barlow,sans-serif;color:rgb(107,116,128);margin-bottom:11px;">${opts.sub}</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${pills}${failPill}</div>
    </div>`;
  const close = () => { root.style.display = "none"; };
  let ctx: PickCtx = null;
  const open = (current: number | null, failed: boolean, c: PickCtx = null) => {
    ctx = c;
    root.querySelectorAll<HTMLElement>("[data-pv]").forEach((el) => {
      const raw = el.dataset.pv!;
      const on = raw === "fail" ? failed : !failed && current != null && Number(raw) === current;
      const tick = el.querySelector<HTMLElement>(".a-pk-tick");
      if (raw === "fail") {
        el.style.background = on ? "rgba(217,138,138,.22)" : "rgba(217,138,138,.1)";
        el.style.borderColor = on ? "#d98a8a" : "rgba(217,138,138,.5)";
        if (tick) tick.style.color = on ? "#b45454" : "transparent";
      } else {
        el.style.background = on ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.06)";
        el.style.borderColor = on ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.28)";
        const num = el.querySelector<HTMLElement>(".a-pk-num");
        const word = el.querySelector<HTMLElement>(".a-pk-word");
        if (num) num.style.color = on ? "rgb(242,242,243)" : "rgb(var(--a-navy-rgb))";
        if (word) word.style.color = on ? "rgba(242,242,243,.85)" : "rgb(95,104,115)";
        if (tick) tick.style.color = on ? "rgb(242,242,243)" : "transparent";
      }
    });
    root.style.display = "flex";
  };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-pk-close]")) return close();
    const p = t.closest<HTMLElement>("[data-pv]");
    if (!p) return;
    const raw = p.dataset.pv!;
    if (raw === "fail") onPick(null, true, ctx);
    else onPick(Number(raw), false, ctx);
    close();
  });
  return { root, open };
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
  const painBtn = host.querySelector<HTMLElement>("#painBtn");
  const sessRpeBtn = host.querySelector<HTMLElement>("#sessRpeBtn");
  const finishBtn = host.querySelector<HTMLElement>("#finishBtn");

  // Share-to-story button (shown once the session is confirmed).
  const shareBtn = document.createElement("button");
  shareBtn.textContent = "↗ SHARE TO STORY";
  shareBtn.style.cssText =
    "width:100%;margin-top:8px;padding:13px;border:1px solid rgb(var(--a-accent-rgb));border-radius:14px;background:rgba(var(--a-accent-rgb),.12);color:rgb(var(--a-navy-rgb));font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;display:none;";
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

  // Per-set RPE picker. Choosing a value logs it (and, for a fixed / %1RM set, the
  // prescribed load too, so one tap completes the set).
  const rpeSheet = buildPicker(
    { title: "HOW HARD DID IT FEEL?", sub: "Tap the effort — 10 is all-out, 5 is very easy.", values: RPE_VALUES, wordOf: (v) => RPE_WORD[String(v)] ?? "", allowFail: true },
    (rpe, failed, ctx) => {
      if (isLocked() || !ctx) return;
      const patch: SetLog = failed ? { failed: true, rpe: null } : { rpe, failed: false };
      if (ctx.fixKg != null && !failed) {
        let hasReal = false;
        getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === ctx.key) hasReal = st.weightKg != null && !st.prefill; }));
        if (!hasReal) patch.weightKg = ctx.fixKg; // log the coach's prescribed load in the same tap
      }
      logSet(athleteId, selected, ctx.key, patch);
    },
  );
  // Session-level effort — the same scale for the whole session.
  const sessRpeSheet = buildPicker(
    { title: "HOW HARD WAS THE SESSION?", sub: "How much did the whole session take out of you?", values: [5, 6, 7, 8, 9, 10], wordOf: (v) => SESS_RPE_WORD[String(v)] ?? "" },
    (v) => { if (!isLocked() && v != null) setSessionMeta(athleteId, selected, { sessionRpe: v }); },
  );
  // Pain — optional, defaults to zero (None) until the athlete sets it.
  const painSheet = buildPicker(
    { title: "ANY PAIN TODAY?", sub: "Optional — 0 is none, 10 is severe. Leave it if you're pain-free.", values: PAIN_VALUES, wordOf: painWord, fmt: (v) => String(v) },
    (v) => { if (!isLocked() && v != null) setSessionMeta(athleteId, selected, { pain: v }); },
  );
  document.body.appendChild(rpeSheet.root);
  document.body.appendChild(sessRpeSheet.root);
  document.body.appendChild(painSheet.root);

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
        curWeek.find((d) => { const s = getSessionFor(athleteId, d.date); return !s.rest && !s.confirmed; })?.date ??
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

    // Pain (defaults to None / 0) + session RPE buttons — open the picker on tap.
    const painVal = host.querySelector<HTMLElement>("#painVal");
    if (painVal && painBtn) {
      // Pain sits at 0 by default; it only reads as "marked" (red) once the athlete
      // logs an actual pain level (>0). A logged 0 looks the same as the default.
      const has = session.pain != null && session.pain > 0;
      painVal.textContent = has ? String(session.pain) : "0";
      painBtn.style.border = has ? "1px solid #d98a8a" : "1px solid rgba(29,31,32,.14)";
      painBtn.style.background = has ? "rgba(217,138,138,.14)" : "#fff";
      painBtn.style.color = has ? "#b45454" : "rgb(138,146,156)";
    }
    const sessRpeVal = host.querySelector<HTMLElement>("#sessRpeVal");
    if (sessRpeVal && sessRpeBtn) {
      const has = session.sessionRpe != null;
      sessRpeVal.textContent = has ? fmtRpeShort(session.sessionRpe!) : "RATE";
      sessRpeBtn.style.background = has ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.08)";
      sessRpeBtn.style.color = has ? "rgb(242,242,243)" : "rgb(var(--a-navy-rgb))";
      sessRpeBtn.style.borderColor = has ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.45)";
    }

    // Don't let a session lock until BOTH every set has a weight AND every
    // required RPE is rated — otherwise tapping finish on the last set confirms
    // it with RPEs still blank ("locks too soon").
    const setsLeft = session.setCount - session.loggedCount;
    const rpeLeft = Math.max(0, session.rpeRequired - session.rpeLogged);
    const canConfirm = !session.rest && setsLeft === 0 && rpeLeft === 0 && session.setCount > 0;
    const finishTxt = host.querySelector<HTMLElement>("#finishTxt");
    const finishNote = host.querySelector<HTMLElement>("#finishNote");
    const locked = session.confirmed; // hand-confirmed or auto-locked (2h untouched)
    if (finishTxt)
      finishTxt.textContent = session.rest
        ? "REST DAY"
        : locked
          ? "SESSION CONFIRMED ✓ · TAP TO UNLOCK"
          : setsLeft > 0
            ? `LOG EVERY SET TO FINISH · ${setsLeft} LEFT`
            : rpeLeft > 0
              ? `RATE RPE ON EVERY SET · ${rpeLeft} LEFT`
              : "CONFIRM SESSION";
    if (finishBtn) {
      const active = canConfirm || locked;
      finishBtn.style.cursor = active ? "pointer" : "default";
      finishBtn.style.background = locked ? "rgba(46,125,90,.14)" : canConfirm ? "rgb(var(--a-navy-rgb))" : "transparent";
      finishBtn.style.color = locked ? "#2e7d5a" : canConfirm ? "rgb(242,242,243)" : "rgb(138,146,156)";
      finishBtn.style.border = locked
        ? "1px solid rgba(46,125,90,.5)"
        : canConfirm
          ? "1px solid rgb(var(--a-navy-rgb))"
          : "1px solid rgba(29,31,32,.16)";
    }
    if (finishNote)
      finishNote.textContent = session.rest
        ? ""
        : locked
          ? "Confirmed — your coach can see this session."
          : setsLeft > 0
            ? `${setsLeft} set${setsLeft === 1 ? "" : "s"} still need a weight before you can confirm.`
            : rpeLeft > 0
              ? `${rpeLeft} RPE rating${rpeLeft === 1 ? "" : "s"} still to enter before you can confirm.`
              : "Everything's logged — confirm to lock the session.";
    shareBtn.style.display = locked ? "block" : "none";
  }

  // Locked = read-only. Only a hand-confirm or the 2h auto-lock locks a session —
  // reaching 70% marks it "done" for display but keeps it fully editable.
  const isLocked = () => getSessionFor(athleteId, selected).confirmed;
  // Any edit on a confirmed session offers to unlock first.
  const unlockGate = (): boolean => {
    if (!isLocked()) return true;
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
    if (t.closest("[data-inc],[data-dec],[data-same],[data-done],[data-rpeopen],[data-secs],[data-wi],[data-note]") && !unlockGate()) return;

    // RPE button → open the big slider popup. For a fixed / %1RM set (data-fixkg),
    // picking an RPE also logs the prescribed load, so it's a one-tap complete.
    const rpeOpen = t.closest<HTMLElement>("[data-rpeopen]");
    if (rpeOpen) {
      const k = rpeOpen.dataset.rpeopen!;
      const fixKg = parseFloat(rpeOpen.dataset.fixkg ?? "");
      let cur: number | null = null;
      let failed = false;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) { cur = st.rpe; failed = st.failed; } }));
      rpeSheet.open(cur, failed, { key: k, fixKg: isFinite(fixKg) ? fixKg : null });
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
  });

  body?.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (isLocked()) return;
    if (t.matches("[data-secs]")) {
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
    if (!isLocked() && t.matches("[data-note]")) logSet(athleteId, selected, t.dataset.note!, { note: t.value });
  }, true);

  // Pain / session-RPE: tap opens the centered picker (guarded when locked).
  painBtn?.addEventListener("click", () => {
    if (!unlockGate()) return;
    painSheet.open(getSessionFor(athleteId, selected).pain ?? 0, false);
  });
  sessRpeBtn?.addEventListener("click", () => {
    if (!unlockGate()) return;
    sessRpeSheet.open(getSessionFor(athleteId, selected).sessionRpe, false);
  });
  finishBtn?.addEventListener("click", () => {
    const s = getSessionFor(athleteId, selected);
    if (s.rest) return;
    if (s.confirmed) {
      if (confirm("Unlock this confirmed session to make changes?")) setSessionMeta(athleteId, selected, { finished: false });
      return;
    }
    if (s.loggedCount >= s.setCount && s.rpeLogged >= s.rpeRequired && s.setCount > 0) {
      setSessionMeta(athleteId, selected, { finished: true });
      showShareSheet(athleteId, selected);
    } else if (s.loggedCount >= s.setCount && s.rpeRequired > s.rpeLogged) {
      showToast(`Rate the RPE on every set first — ${s.rpeRequired - s.rpeLogged} still to go.`);
    }
  });

  const unsub = subscribeDashboard(() => render());
  render();

  return () => {
    unsub();
    calendar.root.remove();
    rpeSheet.root.remove();
    sessRpeSheet.root.remove();
    painSheet.root.remove();
  };
}
