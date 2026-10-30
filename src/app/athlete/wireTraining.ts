import {
  getSessionFor,
  getWeekFor,
  getMonthFor,
  getDashboardModel,
  logSet,
  logCardio,
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
  repMaxRows,
  athleteHasProgramOn,
  type ExBest,
} from "../../lib/data/athleteData";
import { addDays, CARDIO_DISCIPLINES, type Session, type SessionExercise, type LoggedSet, type SetLog } from "../../lib/program/program";
import { fmtKg } from "../../lib/calc/records";
import { showShareSheet } from "./shareSession";
import { showToast } from "./toast";
import { openBlockNotes } from "./blockNotesSheet";

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
  // AMRAP: no rep target — show the load + goal, not a "× reps".
  if (s[0].amrap) {
    const goal = [s[0].targetLoad ? `${s[0].targetLoad} kg` : "", s[0].targetRpe ? `RPE${s[0].targetRpe}` : ""].filter(Boolean).join(" @ ");
    return `${s.length} × AMRAP${goal ? `  ·  ${goal}` : ""}`;
  }
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
  const lwNum = st.lastWeekKg ?? NaN;
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

  // One line per set: REPS · RPE · KG, each in its own box, then ↺ (same load as the
  // set before) or ✓ (confirm a prescribed load). Notes / velocity sit underneath.
  // A box with a solid accent border + ✎ is something to fill in; a flat grey box is
  // just the coach's prescription for reference.
  const hasWeight = (st.weightKg != null && !st.prefill) || st.failed || st.done;
  const rpeOk = !st.requiresRpe || st.rpe != null || st.failed; // a failed attempt needs no RPE
  const isLogged = st.amrap ? st.repsDone != null : hasWeight && rpeOk;
  const partial = !st.amrap && hasWeight && !rpeOk;
  // Fixed load / %1RM: the load is known, so rating RPE (or ✓) also logs it.
  const rpePrimary = hasFixed || !!st.percentOfMax || !!st.targetPercent;
  const rpeFixKg = hasFixed ? doneKg : isFinite(sugNum) ? sugNum : NaN;
  const fixAttr = isFinite(rpeFixKg) ? `data-fixkg="${rpeFixKg}"` : "";

  const GREEN = "46,125,90", AMBER = "201,138,30", RED = "180,84,84";
  const boxStyle = {
    fill: "border:1.5px solid rgba(var(--a-accent-rgb),.5);background:rgba(var(--a-accent-rgb),.09);cursor:pointer;",
    info: "border:1px solid rgba(29,31,32,.07);background:rgba(29,31,32,.035);",
    tone: (rgb: string) => `border:1.5px solid rgba(${rgb},.6);background:rgba(${rgb},.11);cursor:pointer;`,
    navy: "border:1.5px solid rgb(var(--a-navy-rgb));background:rgb(var(--a-navy-rgb));cursor:pointer;",
  };
  const cap = (t: string, color = "rgb(120,129,140)") =>
    `<span style="font:600 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:${color};white-space:nowrap;">${t}</span>`;
  const big = (t: string, color: string) =>
    `<span style="font:700 18px/1 'Barlow Condensed',sans-serif;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${t}</span>`;
  const box = (attrs: string, style: string, flex: string, inner: string, tag = "div") =>
    `<${tag} ${attrs} style="flex:${flex};min-width:0;height:50px;padding:0 4px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;-webkit-tap-highlight-color:transparent;touch-action:manipulation;${style}">${inner}</${tag}>`;
  const PEN = '<span style="opacity:.6;">✎</span>';
  const navyTxt = "rgb(var(--a-navy-rgb))", muted = "rgb(120,129,140)";

  // REPS — always one tap to log what was actually done. Shows the prescription
  // until then; afterwards the real count (amber if fewer, green if hit), with the
  // prescription struck through in the caption when it differs.
  const tgtLow = repsLowOf(st.targetReps);
  let repsBox: string;
  if (st.repsDone == null) {
    repsBox = box(`data-repsedit="${key}"`, st.amrap ? boxStyle.tone(AMBER) : boxStyle.fill, "1 1 0",
      cap(`${st.amrap ? "AMRAP" : "REPS"} ${PEN}`, st.amrap ? `rgb(${AMBER})` : "rgb(var(--a-accent2-rgb))") + big(st.amrap ? "?" : st.targetReps, navyTxt));
  } else {
    const tone = isFinite(tgtLow) && st.repsDone < tgtLow ? AMBER : GREEN;
    const differs = String(st.repsDone) !== String(st.targetReps).trim();
    repsBox = box(`data-repsedit="${key}"`, boxStyle.tone(tone), "1 1 0",
      cap(`REPS${differs && !st.amrap ? ` · <s>${st.targetReps}</s>` : ""} ${PEN}`, `rgb(${tone})`) + big(String(st.repsDone), `rgb(${tone})`));
  }

  // RPE — a fill-in button only when the coach asks for it; otherwise the coach's
  // target RPE as a plain reference.
  const tgtRpe = st.targetRpe ? `@${st.targetRpe}` : "";
  let rpeBox: string;
  if (st.failed) {
    rpeBox = box(`data-rpeopen="${key}" ${fixAttr}`, boxStyle.tone(RED), "1 1 0", cap("RPE ✎", `rgb(${RED})`) + big("FAILED", `rgb(${RED})`));
  } else if (st.requiresRpe && st.rpe != null) {
    rpeBox = box(`data-rpeopen="${key}" ${fixAttr}`, boxStyle.navy, "1 1 0",
      cap(`RPE${tgtRpe ? ` · ${tgtRpe}` : ""} ${PEN}`, "rgba(242,242,243,.7)") + big(fmtRpeShort(st.rpe), "rgb(242,242,243)"));
  } else if (st.requiresRpe) {
    rpeBox = box(`data-rpeopen="${key}" ${fixAttr}`, partial ? boxStyle.tone(AMBER) : boxStyle.fill, "1 1 0",
      cap(`RATE RPE ${PEN}`, partial ? `rgb(${AMBER})` : "rgb(var(--a-accent2-rgb))") + big(tgtRpe || "TAP", partial ? `rgb(${AMBER})` : navyTxt));
  } else {
    const ref = st.toFailure ? "FAIL" : tgtRpe || "—";
    rpeBox = box("", boxStyle.info, "1 1 0", cap(st.toFailure ? "TARGET" : "RPE") + big(ref, muted));
  }

  // KG — the athlete's own load is an input; a fixed / prescribed load reads as a
  // reference (still editable to go lighter, capped as before). AMRAP: reference only.
  const loadPh = st.targetLoad ? fmtKg(parseFloat(st.targetLoad.replace(",", ".")) || 0) || st.targetLoad : st.targetSuggest ? st.targetSuggest : isFinite(rpeFixKg) ? fmtKg(rpeFixKg) : "—";
  const loadCap = hasFixed ? "KG · FIXED" : st.targetPercent ? `KG · ${st.targetPercent}%` : st.targetSuggest ? "KG · SUGG." : "KG ✎";
  let loadBox: string;
  if (st.amrap) {
    loadBox = box("", boxStyle.info, "1.25 1 0", cap("KG") + big(st.targetLoad ? `${st.targetLoad}` : "—", muted));
  } else {
    const logged = st.weightKg != null && !st.prefill;
    const style = st.failed ? boxStyle.tone(RED) : logged ? boxStyle.tone(GREEN) : hasFixed || st.targetPercent || st.targetSuggest ? boxStyle.info + "cursor:text;" : boxStyle.fill + "cursor:text;";
    const txt = st.failed ? `rgb(${RED})` : logged ? `rgb(${GREEN})` : navyTxt;
    const input = `<input data-wi="${key}" ${isFinite(capKg) ? `data-fixed="${capKg}"` : ""} ${isFinite(minKg) ? `data-fixmin="${minKg}"` : ""} ${ro} inputmode="decimal" enterkeyhint="next" placeholder="${loadPh}" value="${val}" data-seed="${seed}" style="width:100%;min-width:0;border:none;outline:none;background:transparent;padding:0;text-align:center;font:700 18px/1 'Barlow Condensed',sans-serif;color:${txt};">`;
    loadBox = box("", style, "1.25 1 0", cap(loadCap, logged ? `rgb(${GREEN})` : hasFixed || st.targetPercent || st.targetSuggest ? muted : "rgb(var(--a-accent2-rgb))") + input, "label");
  }

  // ↺ same load as the set before, or ✓ to confirm a prescribed load (no RPE asked).
  const sideBtn = (attrs: string, glyph: string, on: boolean, title: string) =>
    `<button ${attrs} ${dis} title="${title}" style="flex:0 0 auto;width:40px;height:50px;border-radius:10px;cursor:pointer;font:600 17px/1 'Barlow Condensed',sans-serif;border:1px solid ${on ? "#4f9d69" : "rgba(29,31,32,.14)"};background:${on ? "rgba(79,157,105,.16)" : "transparent"};color:${on ? "#2e7d5a" : "rgb(var(--a-accent2-rgb))"};-webkit-tap-highlight-color:transparent;">${glyph}</button>`;
  const side = st.amrap
    ? '<span style="flex:0 0 auto;width:40px;"></span>'
    : rpePrimary && !st.requiresRpe
      ? sideBtn(`data-donefix="${key}" ${fixAttr}`, "✓", hasWeight, "Done at the prescribed load")
      : sideBtn(`data-same="${key}"`, "↺", false, "Same load as the set before");

  // Header: set number + the coach's load notes (top set, back-off, link) + status.
  const tags = [
    st.backoffPct != null && si === 0 ? "TOP SET" : "",
    st.backoffPct != null && si >= 1 && !st.targetLoad ? `−${st.backoffPct}% of set 1` : "",
    st.linkPct != null && !st.targetLoad ? `−${st.linkPct}% linked` : "",
  ].filter(Boolean).map((t) => `<span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">${t}</span>`).join(" · ");
  const badge = isLogged ? '<span style="color:#2e7d5a;font-weight:700;">✓ LOGGED</span>' : partial ? '<span style="color:#c98a1e;font-weight:700;">RATE RPE</span>' : "";
  const header = `<div style="display:flex;align-items:center;gap:8px;min-height:14px;">
      <span style="flex:0 0 auto;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">SET ${si + 1}</span>
      <span style="flex:1 1 0;font:400 10.5px/1.2 Barlow,sans-serif;color:rgb(95,104,115);">${[tags, badge].filter(Boolean).join(" · ")}</span>
    </div>`;
  const rowTint = isLogged ? "border-left:2px solid #4f9d69;background:rgba(79,157,105,.05);" : partial ? "border-left:2px solid #d9a441;" : "border-left:2px solid rgba(var(--a-accent-rgb),.45);";
  const last = st.lastWeek && !hideLastWeek
    ? `<div style="margin-top:6px;font:400 10.5px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(138,146,156);">LAST WEEK · ${st.lastWeek}</div>`
    : "";
  const noteInput = `<input data-note="${key}" ${ro} placeholder="Notes / velocity" value="${st.note.replace(/"/g, "&quot;")}" style="width:100%;margin-top:7px;padding:7px 10px;background:rgb(242,242,243);border:1px solid rgba(29,31,32,.16);color:rgb(29,31,32);font-size:12.5px;border-radius:10px;box-sizing:border-box;">`;
  return `<div style="margin-left:12px;padding:8px 10px 9px 12px;${rowTint}">
    ${header}
    <div style="display:flex;align-items:stretch;gap:6px;margin-top:7px;">${repsBox}${rpeBox}${loadBox}${side}</div>
    ${noteInput}
    ${last}
  </div>`;
}

/** Lowest whole number in a reps prescription ("5" → 5, "8-10" → 8), else NaN. */
const repsLowOf = (s: string): number => { const m = String(s ?? "").match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };

/**
 * Small centered popup to log the reps actually done on a set: − / + around a big
 * number, quick picks around the prescription, SAVE, or back to "as prescribed".
 */
function buildRepsEditor(onSave: (key: string, reps: number | null) => void): { root: HTMLElement; open: (key: string, target: string, current: number | null) => void } {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);z-index:1000;padding:16px;";
  let key = "";
  let value = 0;
  const btn = "border-radius:12px;cursor:pointer;font:700 22px/1 'Barlow Condensed',sans-serif;border:1.5px solid rgba(var(--a-accent-rgb),.35);background:rgba(var(--a-accent-rgb),.08);color:rgb(var(--a-navy-rgb));";
  const paint = (target: string) => {
    const low = repsLowOf(target);
    const base = isFinite(low) ? low : value;
    const picks = Array.from(new Set([base - 3, base - 2, base - 1, base, base + 1, base + 2].filter((n) => n >= 0)));
    root.innerHTML = `<div style="width:320px;max-width:96vw;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font:600 18px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">REPS DONE</div>
        <button data-rx-close style="border:none;background:rgba(29,31,32,.06);width:30px;height:30px;border-radius:50%;font-size:13px;color:#5f6873;cursor:pointer;">✕</button>
      </div>
      <div style="margin-top:4px;font:400 11px/1.4 Barlow,sans-serif;color:rgb(107,116,128);">Prescribed: ${isFinite(repsLowOf(target)) ? `${target} reps` : "as many as possible"}. How many did you actually do?</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px;">
        <button data-rx-step="-1" style="width:52px;height:52px;${btn}">−</button>
        <div data-rx-val style="min-width:70px;text-align:center;font:700 44px/1 'Barlow Condensed',sans-serif;color:rgb(var(--a-navy-rgb));">${value}</div>
        <button data-rx-step="1" style="width:52px;height:52px;${btn}">+</button>
      </div>
      <div style="display:flex;gap:6px;justify-content:center;margin-top:12px;">${picks.map((n) => `<button data-rx-pick="${n}" style="flex:1 1 0;height:36px;font-size:16px;${btn}${n === value ? "background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);border-color:rgb(var(--a-navy-rgb));" : ""}">${n}</button>`).join("")}</div>
      <button data-rx-save style="width:100%;margin-top:14px;padding:13px;border:1px solid rgb(var(--a-navy-rgb));border-radius:12px;background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">SAVE</button>
      <button data-rx-clear style="width:100%;margin-top:8px;padding:11px;border:none;background:transparent;color:rgb(138,146,156);font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">AS PRESCRIBED (CLEAR)</button>
    </div>`;
  };
  let target = "";
  const close = () => { root.style.display = "none"; };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-rx-close]")) return close();
    const step = t.closest<HTMLElement>("[data-rx-step]");
    if (step) { value = Math.max(0, Math.min(100, value + Number(step.dataset.rxStep))); return paint(target); }
    const pick = t.closest<HTMLElement>("[data-rx-pick]");
    if (pick) { value = Number(pick.dataset.rxPick); return paint(target); }
    if (t.closest("[data-rx-save]")) { onSave(key, value); return close(); }
    if (t.closest("[data-rx-clear]")) { onSave(key, null); return close(); }
  });
  const open = (k: string, tgt: string, current: number | null) => {
    key = k;
    target = tgt;
    const low = repsLowOf(tgt);
    value = current ?? (isFinite(low) ? low : 5);
    paint(tgt);
    root.style.display = "flex";
  };
  return { root, open };
}

/** Centered popup: an exercise's rep-maxes 1–12 with the date each was done. */
function buildRmPopup(): { root: HTMLElement; open: (name: string, b: ExBest | undefined) => void } {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);z-index:1000;padding:16px;";
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const open = (name: string, b: ExBest | undefined) => {
    const rows = repMaxRows(b, 12);
    const any = rows.some((r) => r.kg != null);
    const list = rows
      .map((r, i) => {
        // An RM only proven by a higher-rep set (same load + date as the row below —
        // e.g. a 3-rep set also makes the 2RM) reads softer than the real one.
        const next = rows[i + 1];
        const implied = !!next && r.kg != null && r.kg === next.kg && r.date === next.date;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid rgba(29,31,32,.07);">
          <span style="flex:0 0 46px;font:700 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(var(--a-accent2-rgb));">${r.reps}RM</span>
          <span style="flex:1 1 0;font:700 17px/1 'Barlow Condensed',sans-serif;color:${r.kg == null ? "rgb(170,176,184)" : implied ? "rgb(120,129,140)" : "rgb(var(--a-navy-rgb))"};">${r.kg == null ? "—" : `${fmtKg(r.kg)} kg`}</span>
          <span style="flex:0 0 auto;font:400 11px/1 Barlow,sans-serif;color:rgb(138,146,156);">${r.date && r.kg != null ? fmtDate(r.date) : ""}</span>
        </div>`;
      })
      .join("");
    root.innerHTML = `<div style="width:340px;max-width:96vw;max-height:calc(100dvh - 32px);overflow-y:auto;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font:600 18px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">${escapeHtml(name)}</div>
        <button data-rm-close style="flex:0 0 auto;border:none;background:rgba(29,31,32,.06);width:30px;height:30px;border-radius:50%;font-size:13px;color:#5f6873;cursor:pointer;">✕</button>
      </div>
      <div style="margin:4px 0 8px;font:400 11px/1.4 Barlow,sans-serif;color:rgb(107,116,128);">Your rep maxes — the heaviest load you've done for at least that many reps.</div>
      ${any ? list : `<div style="padding:18px 4px;text-align:center;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">No logged sets for this exercise yet.</div>`}
      ${b && b.e1rm > 0 ? `<div style="margin-top:8px;padding-top:9px;border-top:1px solid rgba(29,31,32,.1);font:600 11px/1 Barlow,sans-serif;letter-spacing:.08em;color:rgb(107,116,128);">ESTIMATED 1RM · ${fmtKg(Math.round(b.e1rm * 2) / 2)} kg</div>` : ""}
    </div>`;
    root.style.display = "flex";
  };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-rm-close]")) root.style.display = "none";
  });
  return { root, open };
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
  const header = `<button data-ex="${ei}" style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:11px 12px;cursor:pointer;border-radius:12px;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${headStyle}">
    <div style="flex:1 1 0;">
      <div style="font:600 16px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(var(--a-navy-rgb));">${ex.name}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">${clip}
        <span style="font:400 10.5px/1.2 Barlow,sans-serif;color:rgb(138,146,156);">${ex.scheme}</span></div>
      ${ex.cue && ex.cue.trim() ? `<div style="margin-top:5px;padding:6px 9px;border-radius:8px;background:rgba(var(--a-accent-rgb),.08);border:1px solid rgba(var(--a-accent-rgb),.18);font:400 11.5px/1.35 Barlow,sans-serif;color:rgb(var(--a-accent2-rgb));white-space:normal;"><span style="font:600 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgb(107,116,128);">COACH · </span>${escapeHtml(ex.cue.trim())}</div>` : ""}
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

function bodyMarkup(week: ReturnType<typeof getWeekFor>, session: Session, selected: string, isOpen: (ei: number) => boolean, bests: Map<string, ExBest> | null, noProgram = false): string {
  // The calendar trigger lives in the day row so it's ALWAYS reachable — including
  // on rest days and weeks with no program — letting the athlete jump to any past
  // (or future) week even when the current one has nothing scheduled.
  const calBtn = `<button id="calOpen" title="Open calendar — jump to any week" style="flex:0 0 auto;width:38px;display:grid;place-items:center;border:1px solid rgba(29,31,32,.14);border-radius:8px;background:rgba(var(--a-accent-rgb),.10);color:rgb(var(--a-navy-rgb));cursor:pointer;font-size:16px;line-height:1;">📅</button>`;
  // Step a whole week back / forward — the direct way to reach last week's session
  // (the calendar is still there for jumping further). Always present, every state.
  const wkBtn = (dir: number, glyph: string) => `<button data-week="${dir}" title="${dir < 0 ? "Previous" : "Next"} week" style="flex:0 0 auto;width:26px;display:grid;place-items:center;border:1px solid rgba(29,31,32,.14);border-radius:8px;background:transparent;color:rgb(var(--a-accent2-rgb));cursor:pointer;font:600 15px/1 'Barlow Condensed',sans-serif;">${glyph}</button>`;
  const dayRow = `<div style="flex:0 0 auto;display:flex;align-items:stretch;gap:4px;padding:14px 0 12px;">${wkBtn(-1, "‹")}${dayButtons(week, selected)}${wkBtn(1, "›")}${calBtn}</div>`;
  if (noProgram) {
    return `${dayRow}<div style="flex:0 0 auto;padding:40px 20px;text-align:center;">
      <div style="font:600 20px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(107,116,128);">NO PROGRAM THIS WEEK</div>
      <div style="margin-top:8px;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">Your coach hasn't assigned training for these dates yet.<br>Use ‹ › or the calendar to review your past weeks.</div>
    </div>`;
  }
  if (session.rest) {
    return `${dayRow}<div style="flex:0 0 auto;padding:24px 0;text-align:center;font:600 20px/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(107,116,128);">REST DAY</div>`;
  }
  const bestsOn = !!bests;
  const refToggle = `<button id="refToggle" title="Switch between last week's loads and your all-time bests" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid ${bestsOn ? "rgb(var(--a-accent-rgb))" : "rgba(var(--a-accent-rgb),.4)"};border-radius:9px;background:${bestsOn ? "rgba(var(--a-accent-rgb),.14)" : "transparent"};color:rgb(41,61,80);font:600 9.5px/1 Barlow,sans-serif;letter-spacing:.1em;cursor:pointer;">${bestsOn ? "BESTS" : "LAST WEEK"} ⇄</button>`;
  const title = `<div style="flex:0 0 auto;padding-bottom:10px;">
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <span style="font:600 25px/1 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(var(--a-navy-rgb));">${session.name || (session.cardio.length ? "CARDIO" : "SESSION")}</span>
      <button id="dayPickBtn" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px 4px;border:1px solid rgb(var(--a-accent-rgb));border-radius:9px;background:rgba(var(--a-accent-rgb),.1);color:rgb(var(--a-navy-rgb));font:600 24px/1 'Barlow Condensed',sans-serif;letter-spacing:.02em;cursor:pointer;">${DAY_FULL[session.weekday]}<span style="font-size:12px;color:rgb(var(--a-accent2-rgb));">▾</span></button>
    </div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font:400 11px/1 Barlow,sans-serif;letter-spacing:.1em;color:rgb(107,116,128);">${session.exercises.length === 0 && session.cardio.length ? `${session.cardio.length} CARDIO` : `${session.exercises.length} EXERCISES · ${session.loggedCount} / ${session.setCount} SETS LOGGED`}</span>
      ${refToggle}
    </div>
  </div>`;
  const altBlock = session.hasAlt ? altSelector(session) : "";
  const exercises = session.exercises.map((ex, ei) => exerciseBlock(ex, ei, isOpen(ei), session.confirmed, bests)).join("");
  // Coach-prescribed cardio — the athlete logs type / time / distance / RPE.
  const CARDIO_LABEL: Record<string, string> = { time: "TIME", distance: "DISTANCE", interval: "INTERVAL" };
  const cro = session.confirmed ? "disabled" : "";
  const cin = "height:34px;padding:0 9px;border-radius:9px;font:600 13px/1 'Barlow Condensed',sans-serif;box-sizing:border-box;border:1px solid rgba(var(--a-accent-rgb),.3);background:rgba(var(--a-glass-rgb),.5);color:rgb(var(--a-navy-rgb));";
  const cardioBlock = session.cardio && session.cardio.length
    ? `<div style="flex:0 0 auto;margin-top:6px;">
        <div style="font:600 10px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(107,116,128);margin-bottom:8px;">CARDIO</div>
        ${session.cardio.map((c) => {
          const g = c.log ?? {};
          return `
          <div style="padding:12px 14px;margin-bottom:8px;border:1px solid rgba(29,31,32,.12);border-radius:14px;background:rgba(var(--a-glass-rgb),.62);">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:17px;">🏃</span>
              <div style="flex:1;min-width:0;">
                <div style="font:600 9px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(138,146,156);">${c.discipline ? escapeHtml(c.discipline.toUpperCase()) + " · " : ""}${CARDIO_LABEL[c.kind] ?? "CARDIO"}</div>
                <div style="margin-top:3px;font:600 15px/1.2 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(var(--a-navy-rgb));">${escapeHtml(c.value || "—")}</div>
                ${c.note ? `<div style="margin-top:2px;font:400 11px/1.3 Barlow,sans-serif;color:rgb(107,116,128);">${escapeHtml(c.note)}</div>` : ""}
              </div>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px;">
              <select data-cid="${c.id}" data-cf="type" ${cro} style="flex:1 1 90px;${cin}">
                ${["", ...CARDIO_DISCIPLINES].map((o) => `<option value="${o}"${(g.type ?? c.discipline ?? "") === o ? " selected" : ""}>${o || "Discipline…"}</option>`).join("")}
              </select>
              <input data-cid="${c.id}" data-cf="time" ${cro} inputmode="text" placeholder="time" value="${escapeHtml(g.time ?? "")}" style="flex:1 1 70px;min-width:0;text-align:center;${cin}">
              <input data-cid="${c.id}" data-cf="distance" ${cro} inputmode="text" placeholder="distance" value="${escapeHtml(g.distance ?? "")}" style="flex:1 1 80px;min-width:0;text-align:center;${cin}">
              <input data-cid="${c.id}" data-cf="rpe" ${cro} inputmode="numeric" placeholder="RPE" value="${g.rpe ?? ""}" style="flex:0 0 58px;min-width:0;text-align:center;${cin}">
            </div>
          </div>`;
        }).join("")}
      </div>`
    : "";
  return dayRow + title + altBlock + exercises + cardioBlock;
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
    // Tap the block label → the athlete's blocks with the coach's notes.
    blockEl.style.cursor = "pointer";
    blockEl.title = "Block notes";
    blockEl.addEventListener("click", () => openBlockNotes(athleteId));
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
  // Reps actually done on a set — opened by tapping the set's REPS box.
  const repsEditor = buildRepsEditor((k, reps) => { if (!isLocked()) logSet(athleteId, selected, k, { repsDone: reps }); });
  document.body.appendChild(repsEditor.root);
  // Long-press an exercise → its rep maxes (1–12) with dates.
  const rmPopup = buildRmPopup();
  document.body.appendChild(rmPopup.root);
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

    // No published week covers this date → show a clear "no program" state instead
    // of a session (a week no longer bleeds onto dates it wasn't assigned to).
    if (!athleteHasProgramOn(athleteId, selected)) {
      if (body) body.innerHTML = bodyMarkup(week, session, selected, () => false, null, true);
      const finishTxt = host.querySelector<HTMLElement>("#finishTxt");
      const finishNote = host.querySelector<HTMLElement>("#finishNote");
      if (finishTxt) finishTxt.textContent = "NO PROGRAM";
      if (finishNote) finishNote.textContent = "Nothing scheduled for this week.";
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
      st?.lastWeekKg ?? NaN,
      st?.targetLoad ? parseFloat(st.targetLoad.replace(",", ".")) : NaN,
      st?.targetSuggest ? parseFloat(st.targetSuggest.replace(",", ".")) : NaN,
    ].filter((n) => isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) : 0;
  };

  // Long-press (≈0.5 s, finger held still) on an exercise header opens its rep maxes;
  // the click that follows the release is swallowed so the exercise doesn't toggle.
  let pressTimer: number | null = null;
  let pressFired = false;
  let pressAt: [number, number] = [0, 0];
  const cancelPress = () => { if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; } };
  const openRmFor = (exBtn: HTMLElement) => {
    cancelPress();
    if (pressFired) return; // already open from this press
    pressFired = true;
    const ex = getSessionFor(athleteId, selected).exercises[Number(exBtn.dataset.ex)];
    if (ex) rmPopup.open(ex.name, exerciseBests(athleteId).get(ex.name.trim().toLowerCase()));
    try { navigator.vibrate?.(15); } catch { /* not supported */ }
  };
  body?.addEventListener("pointerdown", (e) => {
    const exBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-ex]");
    cancelPress();
    pressFired = false;
    if (!exBtn) return;
    pressAt = [e.clientX, e.clientY];
    pressTimer = window.setTimeout(() => openRmFor(exBtn), 450);
  });
  body?.addEventListener("pointermove", (e) => {
    if (pressTimer != null && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) cancelPress();
  });
  body?.addEventListener("pointerup", cancelPress);
  body?.addEventListener("pointercancel", cancelPress);
  // Android Chrome claims a held finger for its own long-press (it fires pointercancel,
  // then contextmenu) before our timer runs — so contextmenu opens the popup too.
  body?.addEventListener("contextmenu", (e) => {
    const exBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-ex]");
    if (!exBtn) return;
    e.preventDefault();
    openRmFor(exBtn);
  });

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
    if (t.closest("#dayPickBtn") || t.closest("#calOpen")) return calendar.open();
    const wkNav = t.closest<HTMLElement>("[data-week]");
    if (wkNav) { selected = addDays(selected, Number(wkNav.dataset.week) * 7); manualOpen.clear(); return render(); }
    if (t.closest("#refToggle")) { showBests = !showBests; return render(); }
    const vid = t.closest<HTMLElement>("[data-video]");
    if (vid?.dataset.video) { window.open(vid.dataset.video, "_blank", "noopener"); return; }
    const exBtn = t.closest<HTMLElement>("[data-ex]");
    if (exBtn && pressFired) { pressFired = false; return; } // that was a long-press
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

    // Tap a set's REPS box → log how many were actually done.
    const repsEl = t.closest<HTMLElement>("[data-repsedit]");
    if (repsEl) {
      const k = repsEl.dataset.repsedit!;
      if (!unlockGate()) return;
      let target = "";
      let cur: number | null = null;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) { target = st.targetReps; cur = st.repsDone; } }));
      return repsEditor.open(k, target, cur);
    }

    // edits are gated when the session is confirmed/locked
    if (t.closest("[data-same],[data-done],[data-donefix],[data-rpeopen],[data-secs],[data-wi],[data-note]") && !unlockGate()) return;

    // Plain DONE for a fixed/%1RM set the coach isn't asking RPE for: confirm the
    // prescribed load in one tap (tap again to un-confirm).
    const doneFix = t.closest<HTMLElement>("[data-donefix]");
    if (doneFix) {
      const k = doneFix.dataset.donefix!;
      const kg = parseFloat(doneFix.dataset.fixkg ?? "");
      let has = false;
      getSessionFor(athleteId, selected).exercises.forEach((ex) => ex.sets.forEach((st) => { if (st.key === k) has = (st.weightKg != null && !st.prefill); }));
      return logSet(athleteId, selected, k, has ? { weightKg: null } : { weightKg: isFinite(kg) ? clampKg(kg) : null, failed: false });
    }

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
    if (t.matches("[data-cf]")) {
      const id = t.dataset.cid!;
      const field = t.dataset.cf!;
      const v = t.value.trim();
      if (field === "rpe") {
        const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
        logCardio(athleteId, selected, id, { rpe: v === "" || !Number.isFinite(n) ? undefined : Math.max(1, Math.min(10, n)) });
      } else if (field === "type") logCardio(athleteId, selected, id, { type: v || undefined });
      else if (field === "time") logCardio(athleteId, selected, id, { time: v || undefined });
      else if (field === "distance") logCardio(athleteId, selected, id, { distance: v || undefined });
      return;
    }
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
  // Enter / the keyboard's "Next" on a weight field logs it (via the blur→change
  // above) and jumps straight to the NEXT SET of the same exercise — never the next
  // exercise — so logging set after set is one keypress. Only on Enter, so tapping
  // away to the RPE button or another field is never hijacked. Stops on the last set.
  body?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLInputElement;
    if (isLocked() || !t.matches("[data-wi]")) return;
    e.preventDefault();
    const key = t.dataset.wi!;
    t.blur(); // fires change → logs the weight → re-renders synchronously
    const parts = key.split("_");
    const si = Number(parts.pop());
    const nextEl = body?.querySelector<HTMLInputElement>(`[data-wi="${parts.join("_")}_${si + 1}"]`);
    if (nextEl) { nextEl.focus(); nextEl.select(); }
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
    repsEditor.root.remove();
    rmPopup.root.remove();
    sessRpeSheet.root.remove();
    painSheet.root.remove();
  };
}
