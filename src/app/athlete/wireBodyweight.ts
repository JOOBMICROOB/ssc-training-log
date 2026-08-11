import {
  getDashboardModel,
  setBwRange,
  subscribeDashboard,
  type DashboardModel,
} from "../../lib/data/athleteData";
import { renderBwSvgInner, FULL_STYLE, type BwRange } from "../../lib/calc/bwChart";
import { logWithConfirm } from "./bwLog";

/**
 * Wires the full bodyweight screen (design 6e): the glowing graph, the header
 * stats, the ALL / THIS MESO / THIS WEEK range selector (persisted, so the
 * dashboard sparkline matches), the log input, and the ✕ close.
 */

const RANGES: { key: BwRange; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "meso", label: "THIS MESO" },
  { key: "week", label: "THIS WEEK" },
];

const AXIS_LABEL =
  "font: 400 8.5px / 1 Barlow, sans-serif; letter-spacing: 0.1em; color: rgba(214, 231, 247, 0.42);";
const RANGE_BASE =
  "flex: 1 1 0%; min-height: 38px; padding: 10px 4px; border-radius: 11px; font: 600 9.5px / 1 'Barlow Condensed', sans-serif; letter-spacing: 0.1em; cursor: pointer;";
const RANGE_ON = "border: 1px solid rgb(158, 208, 255); background: rgba(158, 208, 255, 0.22); color: rgb(242, 247, 252);";
const RANGE_OFF = "border: 1px solid rgba(214, 231, 247, 0.25); background: transparent; color: rgba(214, 231, 247, 0.6);";

function txt(host: HTMLElement, id: string, v: string) {
  const el = host.querySelector<HTMLElement>(`#${id}`);
  if (el) el.textContent = v;
}

function render(host: HTMLElement, model: DashboardModel) {
  const bw = model.bw;
  txt(host, "bwHeaderLabel", bw.headerLabel);
  txt(host, "bwBig", bw.currentLabel);
  txt(host, "bwDeltaBlock", bw.deltaBlock);
  txt(host, "bwClass", model.bodyweight.classLabel);
  txt(host, "bwNow", bw.nowLine);
  txt(host, "bwDeltaPrev", bw.deltaPrev);
  txt(host, "bwClassNote", model.bodyweight.note);

  const svg = host.querySelector("#bwFullSvg");
  if (svg) svg.innerHTML = renderBwSvgInner(bw, FULL_STYLE);

  const tip = host.querySelector<HTMLElement>("#bwFullTip");
  if (tip) {
    tip.textContent = bw.currentLabel;
    const wrap = tip.parentElement;
    if (wrap) {
      wrap.style.left = `${bw.tooltipLeftPct}%`;
      wrap.style.top = `${bw.tooltipTopPct}%`;
      wrap.style.display = bw.last ? "" : "none";
    }
  }

  const axis = host.querySelector<HTMLElement>("#bwAxis");
  if (axis) axis.innerHTML = bw.labels.map((l) => `<span style="${AXIS_LABEL}">${l}</span>`).join("");

  const ranges = host.querySelector<HTMLElement>("#bwRanges");
  if (ranges)
    ranges.innerHTML = RANGES.map(
      (r) =>
        `<button data-range="${r.key}" style="${RANGE_BASE}${r.key === bw.range ? RANGE_ON : RANGE_OFF}">${r.label}</button>`,
    ).join("");

  const input = host.querySelector<HTMLInputElement>("#bwFullInput");
  if (input) {
    input.value = "";
    input.placeholder = model.bwLoggedToday ? `Today: ${bw.currentLabel}` : "Enter BW for today";
  }
}

export function wireBodyweight(host: HTMLElement, athleteId: string, onClose: () => void): () => void {
  render(host, getDashboardModel(athleteId));

  host.querySelector<HTMLElement>("#bwClose")?.addEventListener("click", onClose);

  const ranges = host.querySelector<HTMLElement>("#bwRanges");
  ranges?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-range]");
    if (btn) setBwRange(athleteId, btn.dataset.range as BwRange);
  });

  const input = host.querySelector<HTMLInputElement>("#bwFullInput");
  const doLog = () => {
    const v = (input?.value || "").trim();
    if (v) logWithConfirm(athleteId, v);
  };
  host.querySelector<HTMLElement>("#bwFullLog")?.addEventListener("click", doLog);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLog();
  });

  const unsub = subscribeDashboard(() => render(host, getDashboardModel(athleteId)));
  return () => unsub();
}
