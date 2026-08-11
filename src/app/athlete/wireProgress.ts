import { getDashboard, subscribeDashboard, templateForDate } from "../../lib/data/athleteData";
import { DEFAULT_WEEK } from "../../lib/program/seedProgram";
import { liftProgress, weekTonnage, estimatedTotal, type LiftProgress, type SessionTonnage } from "../../lib/program/progress";
import { fmtKg } from "../../lib/calc/records";
import type { MainLift } from "../../lib/program/program";

/**
 * Per-lift progress page (design 6a) — estimated-1RM card (lift selector +
 * weekly bars + rep-max tiles), tonnage card (week/block), and estimated total
 * + IPF GL. Bodyweight card removed (it lives on the dashboard / 6e).
 */

const LIFTS: { key: MainLift; label: string }[] = [
  { key: "squat", label: "SQUAT" },
  { key: "bench", label: "BENCH" },
  { key: "deadlift", label: "DEADLIFT" },
];
const TITLE: Record<MainLift, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CARD =
  "padding:15px 16px;border:1px solid rgba(255,255,255,.75);border-radius:16px;background:rgba(255,255,255,.62);backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;";

function e1rmCard(lift: MainLift, p: LiftProgress): string {
  const one = p.repMaxes[0]; // real 1RM (highest touched at ≥1 rep)
  const others = p.repMaxes.slice(1); // 2RM / 3RM / 4RM
  const maxE = Math.max(...p.weeks.map((w) => w.e1rm), 1);
  const bars = p.weeks
    .map((w, i) => {
      const h = w.e1rm > 0 ? Math.max(4, Math.round((w.e1rm / maxE) * 82)) : 2;
      const last = i === p.weeks.length - 1 && w.e1rm > 0;
      return `<span style="flex:1 1 0%;display:flex;flex-direction:column;align-items:center;gap:5px;">
        <span title="${w.e1rm ? `${fmtKg(w.e1rm)} kg` : "—"}" style="width:100%;height:${h}px;background:${last ? "rgb(29,45,61)" : "rgba(89,128,166,.5)"};border-radius:3px 3px 0 0;"></span>
        <span style="font:400 8px/1 Barlow,sans-serif;letter-spacing:.06em;color:rgb(162,169,178);">${w.label}</span>
      </span>`;
    })
    .join("");
  const tiles = others
    .map(
      (rm) =>
        `<div style="flex:1 1 0%;padding:9px 8px;border:1px solid rgba(29,31,32,.12);border-radius:11px;text-align:center;background:rgba(255,255,255,.62);backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
          <div style="font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.13em;color:rgb(138,146,156);">${rm.reps}RM</div>
          <div style="margin-top:5px;font:600 17px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${rm.weight != null ? `${fmtKg(rm.weight)} kg` : "—"}</div>
        </div>`,
    )
    .join("");
  const sel = LIFTS.map(
    (l) =>
      `<button data-lift="${l.key}" style="flex:1 1 0%;min-height:38px;padding:10px 4px;border-radius:11px;font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${l.key === lift ? "border:1px solid rgb(29,45,61);background:rgb(29,45,61);color:rgb(242,242,243);" : "border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(107,116,128);"}">${l.label}</button>`,
  ).join("");
  const variantRows = p.variants
    .map(
      (v) => `<div style="display:flex;align-items:baseline;gap:10px;padding:7px 0;border-top:1px solid rgba(29,31,32,.08);">
        <span style="flex:1 1 0%;font:600 12px/1.15 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(29,45,61);">${v.name}</span>
        <span style="flex:0 0 auto;font:600 15px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${fmtKg(v.weight)} kg</span>
        <span style="flex:0 0 auto;width:34px;text-align:right;font:400 10px/1 Barlow,sans-serif;color:rgb(138,146,156);">×${v.reps}</span>
      </div>`,
    )
    .join("");
  const variantBlock = p.variants.length
    ? `<div style="height:1px;background:rgba(29,31,32,.1);margin:15px 0 0;"></div>
       <div style="margin-top:13px;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.15em;color:rgb(138,146,156);">VARIANTS · BEST LOGGED (ALL-TIME)</div>
       <div style="margin-top:4px;">${variantRows}</div>`
    : "";
  return `<div style="${CARD}">
    <div style="display:flex;gap:5px;">${sel}</div>

    <div style="margin-top:14px;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.15em;color:rgb(138,146,156);">${TITLE[lift]} · 1RM (HEAVIEST LOGGED)</div>
    <div style="margin-top:6px;font:600 40px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${one.weight != null ? `${fmtKg(one.weight)} kg` : "—"}</div>
    <div style="display:flex;gap:6px;margin-top:11px;">${tiles}</div>
    ${variantBlock}

    <div style="height:1px;background:rgba(29,31,32,.1);margin:15px 0 0;"></div>
    <div style="margin-top:13px;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.15em;color:rgb(138,146,156);">ESTIMATED 1RM · LAST ${p.weeks.length} WEEKS</div>
    <div style="display:flex;align-items:baseline;gap:9px;margin-top:6px;">
      <span style="font:600 26px/1 'Barlow Condensed',sans-serif;color:rgb(65,97,128);">${p.currentLabel}</span>
      <span style="font:400 10.5px/1.3 Barlow,sans-serif;color:rgb(138,146,156);">${p.deltaLabel}</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:5px;height:86px;margin-top:11px;">${bars}</div>
    <div style="margin-top:7px;font:400 9.5px/1.4 Barlow,sans-serif;color:rgb(162,169,178);">Estimated (Epley) from each week's lowest-rep top set — not a tested max.</div>
  </div>`;
}

function tonnageCard(ton: { total: string; caption: string; sessions: SessionTonnage[] }, scope: "week" | "block"): string {
  const max = Math.max(...ton.sessions.map((s) => s.tonnage), 1);
  const bars =
    ton.sessions
      .map((s) => {
        const isMax = s.tonnage === max;
        const pct = Math.round((s.tonnage / max) * 100);
        return `<div style="display:flex;align-items:center;gap:9px;">
          <span style="flex:0 0 auto;width:84px;font:400 9.5px/1 Barlow,sans-serif;letter-spacing:.07em;color:rgb(107,116,128);">${s.label}</span>
          <span style="flex:1 1 0%;height:7px;border-radius:4px;background:rgba(29,31,32,.1);overflow:hidden;"><span style="display:block;height:100%;width:${pct}%;background:${isMax ? "rgb(29,45,61)" : "rgba(89,128,166,.5)"};"></span></span>
          <span style="flex:0 0 auto;width:66px;text-align:right;font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.04em;color:rgb(29,45,61);">${Math.round(s.tonnage).toLocaleString("de-DE")} kg</span>
        </div>`;
      })
      .join("") || `<span style="font:400 10px/1.4 Barlow,sans-serif;color:rgb(138,146,156);">No sessions logged yet this ${scope}.</span>`;
  const scopeBtn = (key: "week" | "block", label: string) =>
    `<button data-scope="${key}" style="flex:0 0 auto;min-height:32px;padding:9px 11px;border-radius:10px;font:600 9.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${scope === key ? "border:1px solid rgb(29,45,61);background:rgb(29,45,61);color:rgb(242,242,243);" : "border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(107,116,128);"}">${label}</button>`;
  return `<div style="${CARD}">
    <div style="display:flex;align-items:center;gap:9px;">
      <span style="flex:1 1 0%;font:400 8.5px/1 Barlow,sans-serif;letter-spacing:.15em;color:rgb(138,146,156);">TONNAGE</span>
      ${scopeBtn("week", "THIS WEEK")}${scopeBtn("block", "THIS BLOCK")}
    </div>
    <div style="display:flex;align-items:baseline;gap:9px;margin-top:9px;">
      <span style="font:600 30px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${ton.total}</span>
      <span style="font:400 10.5px/1.3 Barlow,sans-serif;color:rgb(138,146,156);">${ton.caption}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:7px;margin-top:11px;">${bars}</div>
  </div>`;
}

function estCard(est: { total: string; gl: string; glSub: string }): string {
  const row = (label: string, sub: string, val: string) =>
    `<div style="display:flex;align-items:baseline;gap:10px;">
      <span style="flex:1 1 0%;"><span style="display:block;font:400 9px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(138,146,156);">${label}</span><span style="display:block;margin-top:4px;font:400 10.5px/1.3 Barlow,sans-serif;color:rgb(162,169,178);">${sub}</span></span>
      <span style="flex:0 0 auto;font:600 23px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${val}</span>
    </div>`;
  return `<div style="${CARD}display:flex;flex-direction:column;gap:11px;">
    ${row("ESTIMATED TOTAL", "squat + bench + deadlift e1RM", est.total)}
    ${row("IPF GL POINTS", est.glSub, est.gl)}
  </div>`;
}

export function wireProgress(host: HTMLElement, athleteId: string, initialLift: MainLift): () => void {
  const body = host.querySelector<HTMLElement>("#progressBody");
  const today = iso(new Date());
  let lift: MainLift = initialLift;
  let scope: "week" | "block" = "week";

  function render() {
    if (!body) return;
    const data = getDashboard(athleteId);
    const logs = data.programLogs ?? {};
    const baseName = lift === "deadlift" ? "dead" : lift;
    const basePr = data.prs.find((p) => new RegExp(baseName, "i").test(p.lift));
    const baseline = basePr ? parseFloat(basePr.value.replace(",", ".")) : 0;
    const tpl = data.programWeek ?? DEFAULT_WEEK;
    const prog = liftProgress(tpl, logs, lift, data.weekStartsOn, today, baseline, 4, (d) => templateForDate(data, d));
    const ton = weekTonnage(tpl, logs, data.weekStartsOn, today, scope, data.blockStart, lift);
    const bwKg = data.bwEntries?.at(-1)?.kg ?? 68;
    const est = estimatedTotal(tpl, logs, data.weekStartsOn, today, data.athlete.sex, bwKg);
    body.innerHTML = e1rmCard(lift, prog) + tonnageCard(ton, scope) + estCard(est);
  }

  body?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const l = t.closest<HTMLElement>("[data-lift]");
    if (l?.dataset.lift) {
      lift = l.dataset.lift as MainLift;
      return render();
    }
    const sc = t.closest<HTMLElement>("[data-scope]");
    if (sc?.dataset.scope) {
      scope = sc.dataset.scope as "week" | "block";
      return render();
    }
  });

  const unsub = subscribeDashboard(render);
  render();
  return () => unsub();
}
