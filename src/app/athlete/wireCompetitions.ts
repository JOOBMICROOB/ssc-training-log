import { getDashboard, subscribeDashboard, getMonthFor, optInComp, getAttemptPlans, type DashboardData } from "../../lib/data/athleteData";
import { autoWarmups, type AttemptPlan, type LiftKey, type Which } from "../coach/coachAttempts";

/**
 * Competitions (design 5a). Coach-managed meet calendar + the athlete's opt-ins.
 * Filter defaults to NATIONAL — international meets need a placement/selection,
 * so nationals are what most athletes look at first. The calendar overlays the
 * training-block colour codes (blue dot) with meet markers (national = blue
 * outline, international = navy fill) for clear contrast. Opting in is a one-way
 * action for the athlete: it takes a confirmation and then locks — only the
 * coach can withdraw an entry (they follow up from the dashboard).
 */

type Comp = DashboardData["competitions"][number];
type Filter = "all" | "national" | "international";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_LONG = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole weeks between today and a meet date (never negative). */
function weeksOut(dateStr: string, today: string): number {
  const a = new Date(today + "T00:00:00");
  const b = new Date(dateStr + "T00:00:00");
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (7 * 864e5)));
}
function weeksLabel(w: number) {
  return w <= 0 ? "this week" : `${w} week${w === 1 ? "" : "s"} out`;
}

export function wireCompetitions(host: HTMLElement, athleteId: string): () => void {
  const calEl = host.querySelector<HTMLElement>("#compCalendar");
  const countEl = host.querySelector<HTMLElement>("#compCount");
  const listEl = host.querySelector<HTMLElement>("#compList");

  const today = isoLocal(new Date());
  let filter: Filter = "national"; // default — internationals need selection
  // Calendar starts on the month of the next upcoming meet (or this month).
  const start = new Date(today + "T00:00:00");
  let year = start.getFullYear();
  let month = start.getMonth();

  const matches = (c: Comp) => filter === "all" || c.level === filter;

  function filterBtn(label: string, value: Filter): string {
    const on = filter === value;
    return `<button data-filter="${value}" style="flex:1 1 0%;padding:8px 0;border-radius:10px;font:600 10.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.09em;cursor:pointer;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${
      on
        ? "border:1px solid rgb(29,45,61);background:rgb(29,45,61);color:rgb(242,242,243);"
        : "border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(107,116,128);"
    }">${label}</button>`;
  }

  function renderCalendar(d: DashboardData) {
    if (!calEl) return;
    const cells = getMonthFor(athleteId, year, month, today);

    // Map each visible day to a meet marker (respecting the active filter).
    const meetOn = new Map<string, { level: Comp["level"]; opted: boolean }>();
    for (const c of d.competitions) {
      if (!matches(c)) continue;
      const dd = new Date(c.date + "T00:00:00");
      if (dd.getFullYear() !== year || dd.getMonth() !== month) continue;
      const opted = d.optedInComps.includes(c.id);
      const prev = meetOn.get(c.date);
      // International outranks national on a shared day; an opt-in always wins.
      if (!prev || opted || (c.level === "international" && prev.level === "national"))
        meetOn.set(c.date, { level: c.level, opted: opted || prev?.opted || false });
    }

    const dayCells = cells
      .map((cell) => {
        if (!cell.date)
          return `<div style="height:32px;"></div>`;
        const meet = meetOn.get(cell.date);
        const training = cell.status === "training" || cell.status === "logged";

        let border = "1px solid rgba(29,31,32,.1)";
        let bg = "rgba(255,255,255,.66)";
        let color = "rgb(29,45,61)";
        let dot = "transparent";
        if (training) dot = "rgb(89,128,166)";
        if (meet) {
          dot = "transparent";
          if (meet.level === "international" || meet.opted) {
            bg = "rgb(29,45,61)";
            color = "rgb(242,242,243)";
            border = meet.opted ? "1px solid rgb(89,128,166)" : "1px solid rgb(29,45,61)";
          } else {
            border = "1px solid rgb(89,128,166)";
            bg = "rgba(89,128,166,.14)";
          }
        } else if (cell.isToday) {
          border = "1px solid rgba(89,128,166,.7)";
        }

        return `<div style="position:relative;height:32px;display:grid;place-items:center;border:${border};border-radius:8px;background:${bg};color:${color};font:600 12px/1 'Barlow Condensed',sans-serif;backdrop-filter:blur(12px);box-shadow:rgba(20,36,52,.06) 0px 2px 6px;">
          <span>${cell.day}</span>
          <span style="position:absolute;left:50%;bottom:3px;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:${dot};"></span>
        </div>`;
      })
      .join("");

    calEl.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:9px;">
        <span style="font:600 25px/1 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(29,45,61);">${MONTHS_LONG[month]} ${year}</span>
        <button data-nav="-1" style="margin-left:auto;width:26px;height:26px;border:1px solid rgba(29,31,32,.14);border-radius:8px;background:transparent;color:rgb(65,97,128);font-size:11px;cursor:pointer;">‹</button>
        <button data-nav="1" style="width:26px;height:26px;border:1px solid rgba(29,31,32,.14);border-radius:8px;background:transparent;color:rgb(65,97,128);font-size:11px;cursor:pointer;">›</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;">
        ${filterBtn("ALL", "all")}${filterBtn("NATIONAL", "national")}${filterBtn("INTERNATIONAL", "international")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:12px;">
        ${["M", "T", "W", "T", "F", "S", "S"]
          .map((w) => `<div style="text-align:center;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.08em;color:rgb(162,169,178);">${w}</div>`)
          .join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:5px;">${dayCells}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:9px;font:400 9px/1 Barlow,sans-serif;letter-spacing:.07em;color:rgb(107,116,128);">
        <span style="flex:0 0 auto;white-space:nowrap;display:flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:rgb(89,128,166);"></span>TRAINING</span>
        <span style="flex:0 0 auto;white-space:nowrap;display:flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border:1px solid rgb(89,128,166);border-radius:2px;"></span>NATIONAL</span>
        <span style="flex:0 0 auto;white-space:nowrap;display:flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;background:rgb(29,45,61);border-radius:2px;"></span>INTERNATIONAL</span>
      </div>`;
  }

  function card(c: Comp, d: DashboardData): string {
    const opted = d.optedInComps.includes(c.id);
    const dd = new Date(c.date + "T00:00:00");
    const going = c.going + (opted ? 1 : 0);
    const natBadge =
      c.level === "international"
        ? `<span style="flex:0 0 auto;padding:4px 8px;border:1px solid rgb(29,45,61);border-radius:8px;background:rgb(29,45,61);color:rgb(242,242,243);font:600 9px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;">INTERNATIONAL</span>`
        : `<span style="flex:0 0 auto;padding:4px 8px;border:1px solid rgba(89,128,166,.4);border-radius:8px;background:rgba(89,128,166,.12);color:rgb(65,97,128);font:600 9px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;">NATIONAL</span>`;

    const toggle = opted
      ? `<button style="width:100%;margin-top:11px;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgb(89,128,166);border-radius:12px;background:rgba(89,128,166,.12);cursor:default;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
          <span style="flex:0 0 auto;width:34px;height:20px;border-radius:11px;background:rgb(89,128,166);position:relative;display:block;">
            <span style="position:absolute;top:2px;left:16px;width:16px;height:16px;border-radius:50%;background:rgb(242,242,243);box-shadow:rgba(29,31,32,.35) 0px 1px 3px;"></span>
          </span>
          <span style="flex:1 1 0%;text-align:left;font:600 12.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.09em;color:rgb(29,45,61);">ENTRY CONFIRMED · LOCKED</span>
          <span style="flex:0 0 auto;font:400 9.5px/1 Barlow,sans-serif;color:rgb(138,146,156);">🔒 ${going} going</span>
        </button>
        <button data-attempts="${c.id}" style="width:100%;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:none;border-radius:12px;background:rgb(29,45,61);color:rgb(242,242,243);font:600 12.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;box-shadow:rgba(20,36,52,.18) 0px 5px 14px;">🏋️ MY ATTEMPTS ›</button>`
      : `<button data-optin="${c.id}" style="width:100%;margin-top:11px;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(29,31,32,.14);border-radius:12px;background:transparent;cursor:pointer;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
          <span style="flex:0 0 auto;width:34px;height:20px;border-radius:11px;background:rgba(29,31,32,.2);position:relative;display:block;">
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:rgb(242,242,243);box-shadow:rgba(29,31,32,.35) 0px 1px 3px;"></span>
          </span>
          <span style="flex:1 1 0%;text-align:left;font:600 12.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.09em;color:rgb(107,116,128);">OPT IN TO THIS MEET</span>
          <span style="flex:0 0 auto;font:400 9.5px/1 Barlow,sans-serif;color:rgb(138,146,156);">${going} going</span>
        </button>`;

    const cardBorder = opted ? "rgb(89,128,166)" : "rgba(29,31,32,.14)";
    const cardBg = opted ? "rgba(89,128,166,.14)" : "rgba(255,255,255,.62)";

    return `<div style="padding:13px;border-radius:14px;border:1px solid ${cardBorder};background:${cardBg};backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="flex:0 0 auto;width:54px;text-align:center;padding:7px 0;border:1px solid rgba(89,128,166,.4);border-radius:10px;background:rgb(242,242,243);">
            <div style="font:600 21px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${dd.getDate()}</div>
            <div style="margin-top:2px;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.13em;color:rgb(107,116,128);">${MONTHS[dd.getMonth()]}</div>
          </div>
          <div style="flex:1 1 0%;">
            <div style="font:600 17px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(29,45,61);">${c.name}</div>
            <div style="margin-top:3px;font:400 11px/1.35 Barlow,sans-serif;color:rgb(107,116,128);">${c.location} · ${weeksLabel(weeksOut(c.date, today))}</div>
          </div>
          ${natBadge}
        </div>
        ${toggle}
      </div>`;
  }

  function render() {
    const d = getDashboard(athleteId);
    renderCalendar(d);

    const shown = d.competitions.filter(matches).slice().sort((a, b) => a.date.localeCompare(b.date));
    const optedCount = d.competitions.filter((c) => d.optedInComps.includes(c.id)).length;
    if (countEl)
      countEl.textContent = `${shown.length} ON THE CALENDAR · ${optedCount} OPTED IN`;
    if (listEl)
      listEl.innerHTML = shown.length
        ? shown.map((c) => card(c, d)).join("")
        : `<div style="padding:24px 12px;text-align:center;font:400 11px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">No ${filter === "all" ? "" : filter + " "}meets on the calendar.</div>`;
  }

  calEl?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const nav = t.closest<HTMLElement>("[data-nav]");
    if (nav) {
      month += Number(nav.dataset.nav);
      if (month < 0) { month = 11; year--; }
      if (month > 11) { month = 0; year++; }
      render();
      return;
    }
    const f = t.closest<HTMLElement>("[data-filter]");
    if (f?.dataset.filter) {
      filter = f.dataset.filter as Filter;
      render();
    }
  });

  listEl?.addEventListener("click", (e) => {
    const att = (e.target as HTMLElement).closest<HTMLElement>("[data-attempts]");
    if (att?.dataset.attempts) { openSheet(att.dataset.attempts); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-optin]");
    if (!b?.dataset.optin) return;
    const c = getDashboard(athleteId).competitions.find((x) => x.id === b.dataset.optin);
    if (!c) return;
    if (
      confirm(
        `Opt in to ${c.name}?\n\nThis confirms your entry and locks it — only your coach can withdraw you afterwards.`,
      )
    )
      optInComp(athleteId, c.id);
  });

  // ---- athlete attempt sheet (read view of the coach's plan + live ticks) ----
  const LIFTS: LiftKey[] = ["squat", "bench", "deadlift"];
  const WHICHES: Which[] = ["opener", "second", "third"];
  const LIFT_LABEL: Record<LiftKey, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
  const WHICH_LABEL: Record<Which, string> = { opener: "Opener", second: "Second", third: "Third" };
  const kg = (n: number) => (n ? `${String(n).replace(".", ",")}` : "—");

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;display:none;flex-direction:column;background:#f4f8fc;z-index:1200;overflow-y:auto;padding:0 0 40px;";
  host.appendChild(overlay);
  const closeSheet = () => (overlay.style.display = "none");

  function statusChip(s: "pending" | "hit" | "miss"): string {
    const m = s === "hit" ? ["#2e7d5a", "rgba(79,157,105,.16)", "✓ HIT"] : s === "miss" ? ["#b45454", "rgba(217,138,138,.16)", "✗ MISS"] : ["#8a929c", "transparent", "—"];
    return `<span style="flex:0 0 auto;padding:3px 8px;border-radius:6px;background:${m[1]};color:${m[0]};font:600 8.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.08em;">${m[2]}</span>`;
  }

  function openSheet(compId: string) {
    const d = getDashboard(athleteId);
    const comp = d.competitions.find((c) => c.id === compId);
    if (!comp) return;
    overlay.dataset.comp = compId;
    const plan = getAttemptPlans(athleteId)[compId] as AttemptPlan | undefined;
    const dd = new Date(comp.date + "T00:00:00");
    const head = `<div style="position:sticky;top:0;background:rgb(29,45,61);color:#f2f2f3;padding:calc(16px + env(safe-area-inset-top)) 18px 16px;display:flex;align-items:center;gap:12px;box-shadow:rgba(9,17,28,.25) 0 3px 12px;">
        <button data-close style="flex:0 0 auto;width:34px;height:34px;border:1px solid rgba(255,255,255,.25);border-radius:10px;background:rgba(255,255,255,.1);color:#f2f2f3;font-size:18px;cursor:pointer;">‹</button>
        <div style="flex:1 1 0;"><div style="font:600 19px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;">${comp.name}</div>
          <div style="margin-top:2px;font:400 10px/1 Barlow,sans-serif;letter-spacing:.1em;color:rgba(242,242,243,.7);">${dd.getDate()}/${dd.getMonth() + 1}/${dd.getFullYear()} · ${comp.location}</div></div>
      </div>`;

    if (!plan) {
      overlay.innerHTML = head + `<div style="padding:40px 22px;text-align:center;font:400 13px/1.6 Barlow,sans-serif;color:rgb(107,116,128);">Your coach hasn't set your attempts for this meet yet.<br>They'll show here once they do.</div>`;
      overlay.style.display = "flex";
      return;
    }

    const bestHit = (l: LiftKey) => { let b = 0; for (const w of WHICHES) if (plan.status[l][w] === "hit") b = Math.max(b, plan.attempts[l][w].neutral); return b; };
    const liveTotal = LIFTS.reduce((s, l) => s + bestHit(l), 0);
    const planned = LIFTS.reduce((s, l) => s + plan.attempts[l].third.neutral, 0);

    const liftBlocks = LIFTS.map((l) => {
      const warm = plan.warmups[l]?.trim() || autoWarmups(plan.attempts[l].opener.neutral);
      const rows = WHICHES.map((w) => {
        const a = plan.attempts[l][w];
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(29,31,32,.08);">
          <span style="flex:0 0 auto;width:60px;font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em;color:rgb(107,116,128);">${WHICH_LABEL[w]}</span>
          <span style="flex:1 1 0;font:700 22px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${kg(a.neutral)}<span style="font-size:12px;color:rgb(138,146,156);"> kg</span></span>
          <span style="flex:0 0 auto;font:400 9.5px/1.4 Barlow,sans-serif;color:rgb(138,146,156);text-align:right;">low ${kg(a.low)}<br>high ${kg(a.high)}</span>
          ${statusChip(plan.status[l][w])}
        </div>`;
      }).join("");
      return `<div style="margin:14px 18px 0;padding:14px;border-radius:16px;background:rgba(255,255,255,.72);border:1px solid rgba(29,31,32,.08);box-shadow:rgba(20,36,52,.06) 0 4px 14px;">
        <div style="font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;color:rgb(29,45,61);">${LIFT_LABEL[l]}</div>
        ${rows}
        ${warm ? `<div style="margin-top:10px;padding-top:9px;border-top:1px solid rgba(29,31,32,.08);font:400 10.5px/1.4 Barlow,sans-serif;color:rgb(65,97,128);"><strong style="letter-spacing:.06em;">WARM-UP</strong> · ${warm}</div>` : ""}
      </div>`;
    }).join("");

    const summary = `<div style="margin:16px 18px 0;padding:14px;border-radius:16px;background:rgb(29,45,61);color:#f2f2f3;display:flex;gap:20px;flex-wrap:wrap;">
        <div><div style="font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgba(242,242,243,.6);">CONFIRMED TOTAL</div><div style="margin-top:4px;font:700 24px/1 'Barlow Condensed',sans-serif;">${liveTotal ? kg(liveTotal) + " kg" : "—"}</div></div>
        <div><div style="font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgba(242,242,243,.6);">PLANNED TOTAL</div><div style="margin-top:4px;font:700 24px/1 'Barlow Condensed',sans-serif;">${kg(planned)} kg</div></div>
        ${plan.goals.placement ? `<div><div style="font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;color:rgba(242,242,243,.6);">GOAL</div><div style="margin-top:4px;font:600 15px/1.1 'Barlow Condensed',sans-serif;">${plan.goals.placement}</div></div>` : ""}
      </div>`;

    overlay.innerHTML = head + summary + liftBlocks + `<div style="margin:16px 18px 0;font:400 10px/1.5 Barlow,sans-serif;color:rgb(138,146,156);text-align:center;">Your coach updates this live during the meet — hit/miss shows here as attempts are called.</div>`;
    overlay.style.display = "flex";
  }

  overlay.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-close]")) closeSheet(); });

  const unsub = subscribeDashboard(() => { render(); if (overlay.style.display === "flex") { const id = overlay.dataset.comp; if (id) openSheet(id); } });
  render();
  return () => { unsub(); overlay.remove(); };
}
