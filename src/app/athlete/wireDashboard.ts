import {
  getDashboard,
  getDashboardModel,
  submitCheckin,
  subscribeDashboard,
  hydrateFromServer,
  athleteVisibleNotes,
  sendNoteToCoach,
  setAthleteInfo,
  setCompTotal,
  setPrBaseline,
  IPF_CLASSES,
  type CheckinScores,
  type DashboardData,
  type DashboardModel,
} from "../../lib/data/athleteData";
import { renderBwSvgInner, DASH_STYLE } from "../../lib/calc/bwChart";
import { logWithConfirm } from "./bwLog";

/**
 * Makes the injected 2a dashboard interactive:
 *  - renders computed adherence (ring, %, extras, detail),
 *  - the weekly check-in modal (7 sliders) — feeds the adherence extra, resets weekly,
 *  - the bodyweight card: sparkline from the shared chart, daily log (with a
 *    same-day overwrite confirm), and tap-to-open the full 6e graph.
 * Everything reads/writes the athlete data service, so it persists on the device.
 */

const SLIDERS: { key: keyof CheckinScores; label: string }[] = [
  { key: "training", label: "TRAINING" },
  { key: "sleep", label: "SLEEP" },
  { key: "nutrition", label: "NUTRITION" },
  { key: "stress", label: "STRESS" },
  { key: "overall", label: "OVERALL FEELING" },
  { key: "motivation", label: "MOTIVATION" },
  { key: "pain", label: "PAIN / ACHES" },
];

function setText(host: HTMLElement, id: string, value: string) {
  const el = host.querySelector<HTMLElement>(`#${id}`);
  if (el) el.textContent = value;
}

function prRowHtml(p: { lift: string; key?: string; value: string; date: string; delta: string }): string {
  return `<div data-lift="${p.key ?? ""}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.75);border-radius:16px;background:rgba(255,255,255,.62);backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;cursor:pointer;">
    <span style="flex:1 1 0%;font:600 15px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(29,45,61);">${p.lift}</span>
    <span data-pr-value style="flex:0 0 auto;font:600 20px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${p.value}</span>
    <span style="flex:0 0 auto;width:64px;text-align:right;font:400 10px/1.2 Barlow,sans-serif;color:rgb(107,116,128);">${p.date}</span>
    <span style="flex:0 0 auto;width:46px;text-align:right;font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;color:rgb(65,97,128);">${p.delta}</span>
  </div>`;
}

const NOTE_MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const NOTE_DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function fmtNoteDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return `${NOTE_DOW[d.getDay()]} ${d.getDate()} ${NOTE_MON[d.getMonth()]}`;
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Render the athlete's own sent notes (unread, or read within 4 weeks). */
function renderSentNotes(host: HTMLElement, model: DashboardModel) {
  const list = host.querySelector<HTMLElement>("#sentNotes");
  const wrap = host.querySelector<HTMLElement>("#sentNotesWrap");
  if (!list) return;
  const notes = athleteVisibleNotes(model);
  if (wrap) wrap.style.display = notes.length ? "" : "none";
  list.innerHTML = notes
    .map(
      (n) => `<div style="padding:10px 12px;border:1px solid rgba(29,31,32,.12);border-radius:16px;background:rgba(255,255,255,.62);backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
        <div style="display:flex;justify-content:space-between;gap:8px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgb(138,146,156);">
          <span>${fmtNoteDate(n.date)}</span><span style="${n.checkedAt ? "color:rgb(79,157,105);" : ""}">${n.checkedAt ? "SEEN ✓" : "SENT"}</span>
        </div>
        <div style="margin-top:4px;font:400 12.5px/1.45 Barlow,sans-serif;color:rgb(60,69,79);">${escapeHtml(n.text)}</div>
      </div>`,
    )
    .join("");
}

function applyModel(host: HTMLElement, model: DashboardModel) {
  const a = model.adherence;
  setText(host, "adPercent", a.percent);
  setText(host, "adTag", a.tag);
  setText(host, "adSets", a.sets);
  setText(host, "adRpe", a.rpe);
  setText(host, "adExtras", a.extras);
  host.querySelector("#ringSets")?.setAttribute("stroke-dasharray", a.setsDash);
  host.querySelector("#ringRpe")?.setAttribute("stroke-dasharray", a.rpeDash);
  host.querySelector("#ringExtras")?.setAttribute("stroke-dasharray", a.extrasDash);
  const detail = host.querySelector<HTMLElement>("#adDetail");
  if (detail) detail.innerHTML = `${a.detailLine1}<br>${a.detailLine2}`;
  setText(host, "checkinStatus", model.checkinStatus);

  // Bodyweight card
  const bw = model.bw;
  const svg = host.querySelector("#bwSvg");
  if (svg) svg.innerHTML = renderBwSvgInner(bw, DASH_STYLE);
  const tip = host.querySelector<HTMLElement>("#bwTip");
  if (tip) {
    tip.textContent = bw.currentLabel;
    const wrap = tip.parentElement;
    if (wrap) {
      wrap.style.left = `${bw.tooltipLeftPct}%`;
      wrap.style.top = `${bw.tooltipTopPct}%`;
      wrap.style.display = bw.last ? "" : "none";
    }
  }
  setText(host, "bwValue", bw.currentLabel);
  setText(host, "bwClass2", model.bodyweight.classLabel);
  setText(host, "bwNote2", model.bodyweight.note);
  const input = host.querySelector<HTMLInputElement>("#bwInput");
  if (input) {
    input.value = "";
    input.placeholder = model.bwLoggedToday ? `Today: ${bw.currentLabel}` : "Enter BW for today";
  }

  setText(host, "blockLabel", model.blockLabel);
  setText(host, "welcomeSub", model.compCountdown);
  renderSentNotes(host, model);
  setText(host, "nextLabel", model.todayCard.label);
  setText(host, "nextTitle", model.todayCard.title);
  setText(host, "nextSub", model.todayCard.sub);
  {
    const done = model.todayCard.done;
    const rest = model.todayCard.rest;
    const accent = done ? "79, 157, 105" : rest ? "138, 146, 156" : "89, 128, 166";
    const solid = done ? "rgb(79,157,105)" : rest ? "rgb(107,116,128)" : "rgb(29,45,61)";
    const btn = host.querySelector<HTMLElement>("#nextSessionBtn");
    const icon = host.querySelector<HTMLElement>("#nextIcon");
    if (btn) {
      btn.style.borderColor = `rgb(${accent})`;
      btn.style.background = `rgba(${accent}, 0.14)`;
    }
    if (icon) {
      icon.textContent = done ? "✓" : rest ? "○" : "›";
      icon.style.background = solid;
    }
  }

  setText(host, "tileAgeVal", model.athlete.age);
  setText(host, "tileGoalVal", model.athlete.goalClass);
  setText(host, "tileBwVal", model.bodyweightAvg4w); // 4-week average, not editable
  setText(host, "tileTaVal", model.athlete.trainingAge);

  // Records derived from the training log.
  setText(host, "gymTotalVal", model.totals.gym);
  setText(host, "gymDeltaVal", model.totals.gymDelta);
  setText(host, "compTotalVal", model.totals.comp);
  setText(host, "compNoteVal", model.totals.compNote);
  setText(host, "glCurVal", model.gl.current);
  setText(host, "glBestVal", model.gl.best);
  setText(host, "glNoteVal", model.gl.note);
  const prRows = host.querySelector("#prRows");
  if (prRows) prRows.innerHTML = model.prs.map(prRowHtml).join("");

  setText(host, "welcomeName", model.athlete.firstName);
  // Streak flame — consecutive training days logged ≥80% (rest days don't break it).
  const streakBadge = host.querySelector<HTMLElement>("#streakBadge");
  if (streakBadge) {
    if (model.streak > 0) {
      streakBadge.style.display = "inline-flex";
      streakBadge.title = `${model.streak}-day streak — keep logging ≥80% of every session to grow it. Rest days are safe.`;
      const num = streakBadge.querySelector("#streakNum");
      if (num) num.textContent = String(model.streak);
    } else {
      streakBadge.style.display = "none";
    }
  }
  const pic = host.querySelector<HTMLElement>("#profilePic");
  if (pic)
    pic.innerHTML = model.athlete.avatar
      ? `<img style="width:100%;height:100%;object-fit:cover;display:block;" src="${model.athlete.avatar}">`
      : (model.athlete.firstName[0] ?? "").toUpperCase();
}

function pickAvatar(athleteId: string) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = () => {
    const file = inp.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 220; // square, compressed — small enough for localStorage
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setAthleteInfo(athleteId, { avatar: canvas.toDataURL("image/jpeg", 0.82) });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

/** Double-tap a PR to set its starting number; logged lifts still win. */
function editPrBaseline(athleteId: string, valueSpan: HTMLElement, lift: "squat" | "bench" | "deadlift") {
  const current = (valueSpan.textContent ?? "").replace(/[^0-9.,]/g, "").trim();
  const inp = document.createElement("input");
  inp.value = current;
  inp.inputMode = "decimal";
  inp.style.cssText =
    "width:74px;font:600 18px/1 'Barlow Condensed',sans-serif;color:#1d2d3d;border:1px solid rgb(89,128,166);border-radius:8px;padding:2px 6px;background:#fff;text-align:right;";
  valueSpan.style.display = "none";
  valueSpan.parentElement?.insertBefore(inp, valueSpan.nextSibling);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    inp.remove();
    valueSpan.style.display = "";
    if (commit && v && v !== current) {
      const name = lift === "bench" ? "bench" : lift;
      if (window.confirm(`Set your ${name} PR to ${v} kg?\n\nYour logged lifts always count — this only sets your starting number.`)) {
        setPrBaseline(athleteId, lift, v);
      }
    }
  };
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") inp.blur();
    if (e.key === "Escape") finish(false);
  });
}

type EditField = "age" | "goalClass" | "trainingAge";

function openTileEditor(athleteId: string, span: HTMLElement, field: EditField, kind: "text" | "select") {
  const current = (span.textContent ?? "").trim();
  const parent = span.parentElement;
  if (!parent) return;
  let editor: HTMLInputElement | HTMLSelectElement;
  if (kind === "select") {
    const sel = document.createElement("select");
    const sex = getDashboard(athleteId).athlete.sex;
    (IPF_CLASSES[sex] ?? IPF_CLASSES.female).forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      if (c.toUpperCase() === current.toUpperCase()) o.selected = true;
      sel.appendChild(o);
    });
    editor = sel;
  } else {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = current;
    inp.size = 6;
    editor = inp;
  }
  editor.style.cssText =
    "font:600 16px/1 'Barlow Condensed',sans-serif;color:#1d2d3d;border:1px solid rgb(89,128,166);border-radius:8px;padding:2px 6px;background:#fff;max-width:100%;";
  span.style.display = "none";
  parent.appendChild(editor);
  editor.focus();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const revert = () => {
      editor.remove();
      span.style.display = "";
    };
    const raw = editor.value.trim();
    let saveVal = raw;
    if (field === "age") {
      const n = parseInt(raw, 10);
      if (!isFinite(n) || n < 10 || n > 99) {
        alert("Enter an age between 10 and 99.");
        return revert();
      }
      saveVal = String(n);
    } else if (field === "trainingAge") {
      const n = parseFloat(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
      if (!isFinite(n) || n < 0 || n > 60) {
        alert("Enter a training age between 0 and 60 years.");
        return revert();
      }
      saveVal = `${n} YR`;
    }
    if (saveVal && saveVal !== current && confirm(`Save "${saveVal}" to your profile?`)) {
      setAthleteInfo(athleteId, { [field]: saveVal } as Partial<DashboardData["athlete"]>);
    }
    revert();
  };
  editor.addEventListener("blur", finish);
  if (kind === "select") editor.addEventListener("change", finish);
  else
    editor.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") editor.blur();
    });
}

/**
 * Double-tap the "Best comp total" value to self-report it (the coach can still
 * override, and OpenIPF sync comes later). Athlete-entered totals are flagged in
 * the note so it's clear where the number came from.
 */
function editCompTotal(athleteId: string, span: HTMLElement) {
  const current = (span.textContent ?? "").trim();
  const parent = span.parentElement;
  if (!parent) return;

  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = current === "—" ? "" : current;
  inp.size = 6;
  inp.placeholder = "kg";
  inp.style.cssText =
    "font:600 28px/1 'Barlow Condensed',sans-serif;color:#1d2d3d;border:1px solid rgb(89,128,166);border-radius:8px;padding:1px 6px;background:#fff;width:110px;max-width:100%;";
  span.style.display = "none";
  parent.appendChild(inp);
  inp.focus();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const revert = () => {
      inp.remove();
      span.style.display = "";
    };
    const raw = inp.value.trim();
    // Empty clears the total back to "no meet yet".
    if (raw === "") {
      if (current !== "—" && confirm("Clear your best competition total?"))
        setCompTotal(athleteId, "—", "First competition still to come");
      return revert();
    }
    const n = parseFloat(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n <= 0 || n > 1500) {
      alert("Enter a total between 1 and 1500 kg.");
      return revert();
    }
    // Belgian locale: comma decimal, drop a trailing ,0.
    const display = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
    if (display !== current && confirm(`Save ${display} kg as your best competition total?`))
      setCompTotal(athleteId, display, "Self-entered · confirm at your next meet");
    revert();
  };
  inp.addEventListener("blur", finish);
  inp.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") inp.blur();
  });
}

function setupTileEditing(host: HTMLElement, athleteId: string) {
  const fields: { id: string; field: EditField; kind: "text" | "select" }[] = [
    { id: "tileAgeVal", field: "age", kind: "text" },
    { id: "tileGoalVal", field: "goalClass", kind: "select" },
    { id: "tileTaVal", field: "trainingAge", kind: "text" },
  ];
  fields.forEach(({ id, field, kind }) => {
    const span = host.querySelector<HTMLElement>(`#${id}`);
    const tile = span?.parentElement?.parentElement;
    if (!span || !tile) return;
    tile.style.cursor = "pointer";
    tile.title = "Double-tap to edit";
    tile.addEventListener("dblclick", () => openTileEditor(athleteId, span, field, kind));
  });
}

function buildModal(model: DashboardModel): {
  root: HTMLDivElement;
  open: () => void;
  onSubmit: (cb: (scores: CheckinScores, note: string) => void) => void;
} {
  const scores = model.checkin.scores;
  const rows = SLIDERS.map(
    ({ key, label }) => `
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font:400 10px/1 Barlow,sans-serif;letter-spacing:.12em;color:#6b7480">${label}</span>
          <span data-v="${key}" style="font:600 15px/1 'Barlow Condensed',sans-serif;color:#1d2d3d">${scores[key]}</span>
        </div>
        <input type="range" min="0" max="10" value="${scores[key]}" data-k="${key}"
          style="width:100%;margin-top:7px;height:6px;accent-color:#1d2d3d">
      </div>`,
  ).join("");

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);z-index:1000;padding:16px";
  root.innerHTML = `
    <div style="width:330px;max-width:94vw;max-height:88vh;overflow-y:auto;background:linear-gradient(180deg,#f4f8fc,#eaf1f8);border:1px solid rgba(29,31,32,.12);border-radius:18px;box-shadow:0 20px 60px rgba(9,17,28,.4);padding:18px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div style="font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.14em;color:#8a929c">WEEKLY CHECK-IN</div>
          <div style="margin-top:5px;font:600 17px/1.1 'Barlow Condensed',sans-serif;color:#1d2d3d">${model.checkinStatus}</div>
        </div>
        <button data-close style="border:0;background:transparent;color:#41617f;font-size:16px;cursor:pointer;line-height:1">▴</button>
      </div>
      <div style="height:1px;background:rgba(29,31,32,.1);margin:14px 0 2px"></div>
      ${rows}
      <textarea data-note placeholder="Additional information for the coach" style="width:100%;min-height:64px;margin-top:16px;padding:11px;background:rgba(255,255,255,.6);border:1px solid rgba(29,31,32,.14);border-radius:12px;color:#1d2d3d;font-size:12.5px;resize:none;box-sizing:border-box">${model.checkin.note}</textarea>
      <button data-submit style="width:100%;margin-top:12px;padding:14px;border:1px solid #1d2d3d;border-radius:12px;background:#1d2d3d;color:#f2f2f3;font:600 14px/1 'Barlow Condensed',sans-serif;letter-spacing:.14em;cursor:pointer">SUBMIT CHECK-IN</button>
    </div>`;

  const close = () => {
    root.style.display = "none";
  };
  root.querySelector<HTMLElement>("[data-close]")?.addEventListener("click", close);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  root.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((s) => {
    s.addEventListener("input", () => {
      const badge = root.querySelector<HTMLElement>(`[data-v="${s.dataset.k}"]`);
      if (badge) badge.textContent = s.value;
    });
  });

  let submitCb: (scores: CheckinScores, note: string) => void = () => {};
  root.querySelector<HTMLElement>("[data-submit]")?.addEventListener("click", () => {
    const collected = {} as CheckinScores;
    root.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((s) => {
      collected[s.dataset.k as keyof CheckinScores] = Number(s.value);
    });
    const note = root.querySelector<HTMLTextAreaElement>("[data-note]")?.value ?? "";
    submitCb(collected, note);
    close();
  });

  return { root, open: () => (root.style.display = "flex"), onSubmit: (cb) => (submitCb = cb) };
}

/**
 * Instagram-style pull-to-refresh: pull down at the top of the dashboard and a
 * spinning emblem drops in with a bit of resistance, then snaps away quickly
 * after it kicks a cloud re-sync. Pure gimmick to make the app feel legit.
 */
function wirePullToRefresh(scroll: HTMLElement, onRefresh: () => void) {
  // Keep the native scroll on its fast path (listeners stay PASSIVE — a
  // non-passive touchmove is what made scrolling choppy) and stop the bounce
  // from chaining to the page.
  scroll.style.overscrollBehaviorY = "contain";
  const chip = document.createElement("div");
  chip.style.cssText =
    "position:absolute;top:0;left:50%;width:38px;height:38px;border-radius:50%;background:#1d2d3d;display:grid;place-items:center;box-shadow:rgba(20,36,52,.28) 0 5px 14px;opacity:0;z-index:6;pointer-events:none;transform:translate(-50%,-50px);";
  chip.innerHTML = '<img class="ptr-logo" src="/assets/logo-emblem-white.png" style="height:22px;width:auto;display:block;">';
  const img = chip.firstElementChild as HTMLElement;
  scroll.appendChild(chip);

  let startY = 0;
  let pulling = false;
  let pull = 0;
  let refreshing = false;
  const THRESH = 66;
  const hide = (ms: number) => {
    chip.style.transition = `transform ${ms}ms ease, opacity ${ms}ms ease`;
    chip.style.opacity = "0";
    chip.style.transform = "translate(-50%,-50px)";
    window.setTimeout(() => { chip.style.transition = "none"; img.classList.remove("ptr-spinning"); refreshing = false; }, ms);
  };
  scroll.addEventListener("touchstart", (e) => {
    if (!refreshing && scroll.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = true; pull = 0; }
  }, { passive: true });
  scroll.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    if (scroll.scrollTop > 0) { pulling = false; hide(150); return; }
    pull = e.touches[0].clientY - startY;
    if (pull <= 0) { chip.style.opacity = "0"; chip.style.transform = "translate(-50%,-50px)"; return; }
    const d = Math.min(pull * 0.5, 86);
    chip.style.transition = "none";
    chip.style.opacity = String(Math.min(1, d / 38));
    chip.style.transform = `translate(-50%, ${d - 50}px)`;
    if (!refreshing) img.style.transform = `rotate(${d * 4}deg)`;
  }, { passive: true });
  const end = () => {
    if (!pulling) return;
    pulling = false;
    if (pull > THRESH) {
      refreshing = true;
      img.style.transform = "";
      img.classList.add("ptr-spinning");
      chip.style.transition = "transform .2s ease";
      chip.style.transform = "translate(-50%,22px)";
      chip.style.opacity = "1";
      try { onRefresh(); } catch { /* ignore */ }
      window.setTimeout(() => hide(320), 1500); // let it spin a good while
    } else {
      hide(200);
    }
  };
  scroll.addEventListener("touchend", end, { passive: true });
  scroll.addEventListener("touchcancel", end, { passive: true });
}

export function wireDashboard(
  host: HTMLElement,
  athleteId: string,
  onOpenBw: () => void,
  onOpenTraining: () => void,
  onOpenProgress: (lift: string) => void,
): () => void {
  applyModel(host, getDashboardModel(athleteId));

  const scroll = host.querySelector<HTMLElement>('div[style*="overflow-y: auto"]');
  if (scroll) wirePullToRefresh(scroll, () => void hydrateFromServer(athleteId));

  const modal = buildModal(getDashboardModel(athleteId));
  document.body.appendChild(modal.root);
  modal.onSubmit((scores, note) => submitCheckin(athleteId, scores, note));
  host.querySelector<HTMLElement>("#checkinBtn")?.addEventListener("click", modal.open);

  // Next-session card opens the training screen.
  host.querySelector<HTMLElement>("#nextSessionBtn")?.addEventListener("click", onOpenTraining);

  // Each PR row: single tap opens its progress page; double tap edits the
  // starting number (a logged lift always still wins — auto-update is kept).
  let prTimer: number | null = null;
  host.querySelector<HTMLElement>("#prRows")?.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-lift]");
    const lift = row?.dataset.lift;
    if (!lift) return;
    if (prTimer != null) {
      window.clearTimeout(prTimer);
      prTimer = null;
      const span = row!.querySelector<HTMLElement>("[data-pr-value]");
      if (span) editPrBaseline(athleteId, span, lift as "squat" | "bench" | "deadlift");
    } else {
      prTimer = window.setTimeout(() => { prTimer = null; onOpenProgress(lift); }, 250);
    }
  });

  // Note to coach: type in the box and SEND — it saves, syncs, and confirms.
  host.querySelector<HTMLElement>("#sendNoteBtn")?.addEventListener("click", () => {
    const ta = host.querySelector<HTMLTextAreaElement>("#noteToCoach");
    const text = ta?.value.trim() ?? "";
    if (!text) return;
    sendNoteToCoach(athleteId, text);
    if (ta) ta.value = "";
    const msg = host.querySelector<HTMLElement>("#noteSentMsg");
    if (msg) {
      msg.style.display = "block";
      window.setTimeout(() => { msg.style.display = "none"; }, 2600);
    }
  });

  // Bodyweight: tap the chart to open 6e; LOG the daily weigh-in.
  host.querySelector<HTMLElement>("#bwOpen")?.addEventListener("click", onOpenBw);
  const bwInput = host.querySelector<HTMLInputElement>("#bwInput");
  host.querySelector<HTMLElement>("#bwLog")?.addEventListener("click", () => {
    const v = (bwInput?.value || "").trim();
    if (v) logWithConfirm(athleteId, v);
  });

  // Double-tap the profile tiles (age, goal class, training age) to edit.
  setupTileEditing(host, athleteId);
  // Double-tap the best comp total to self-report it.
  const compSpan = host.querySelector<HTMLElement>("#compTotalVal");
  const compTile = compSpan?.parentElement?.parentElement;
  if (compSpan && compTile) {
    compTile.style.cursor = "pointer";
    compTile.title = "Double-tap to edit";
    compTile.addEventListener("dblclick", () => editCompTotal(athleteId, compSpan));
  }
  // Double-tap the avatar to pick a new profile picture.
  host.querySelector<HTMLElement>("#profilePic")?.addEventListener("dblclick", () => pickAvatar(athleteId));

  const unsub = subscribeDashboard(() => applyModel(host, getDashboardModel(athleteId)));
  return () => {
    unsub();
    modal.root.remove();
  };
}
