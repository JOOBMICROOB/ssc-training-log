import { fmtKg } from "./records";
import { currentWeekWindow, type Weekday } from "./adherence";

/**
 * Bodyweight chart geometry + stats, shared by the dashboard sparkline and the
 * full 6e screen so they always agree. Everything is computed in the design's
 * 320×130 viewBox. Data is the athlete's weigh-ins; the newest sits on the right
 * as the "now" marker, with a dotted linear run-out projecting the trend.
 */

export type BwEntry = { date: string; kg: number }; // date = ISO yyyy-mm-dd
export type BwRange = "all" | "meso" | "week";

const VB_H = 130;
const X0 = 10;
const X_LAST = 264;
const X_RUNOUT = 310;
const Y_TOP = 30;
const Y_BOT = 100;

export type BwPoint = { x: number; y: number; kg: number; date: string };

export type BwModel = {
  range: BwRange;
  headerLabel: string;
  currentKg: number | null;
  currentLabel: string;
  deltaBlock: string;
  deltaPrev: string;
  nowLine: string;
  labels: string[];
  points: BwPoint[];
  last: BwPoint | null;
  linePath: string;
  areaPath: string;
  runoutPath: string;
  tooltipLeftPct: number;
  tooltipTopPct: number;
  loggedToday: boolean;
};

export type BwOpts = {
  weekStartsOn: Weekday;
  blockStart?: string | null; // ISO date the current block began
  today?: Date;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return iso(x);
};

function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r >= 0 ? "+" : "-"}${fmtKg(Math.abs(r))} kg`;
}

const DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function rangeStartISO(range: BwRange, o: BwOpts, today: Date): string | null {
  if (range === "all") return null;
  if (range === "week") return iso(currentWeekWindow(o.weekStartsOn, today).start);
  return o.blockStart ?? daysAgo(today, 28); // meso: block start, else last 4 weeks
}

export function bwChart(entries: BwEntry[], range: BwRange, o: BwOpts): BwModel {
  const today = o.today ?? new Date();
  const todayISO = iso(today);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const start = rangeStartISO(range, o, today);
  const inRange = start ? sorted.filter((e) => e.date >= start) : sorted;

  const n = inRange.length;
  const vals = inRange.map((e) => e.kg);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const span = vmax - vmin || 1;
  const yFor = (kg: number) =>
    vmax === vmin ? (Y_TOP + Y_BOT) / 2 : Y_TOP + (1 - (kg - vmin) / span) * (Y_BOT - Y_TOP);
  const xFor = (i: number) => (n > 1 ? X0 + (i * (X_LAST - X0)) / (n - 1) : X_LAST);

  const points: BwPoint[] = inRange.map((e, i) => ({
    x: xFor(i),
    y: yFor(e.kg),
    kg: e.kg,
    date: e.date,
  }));
  const last = points.length ? points[points.length - 1] : null;

  // Smooth curve with horizontal control points (matches the design).
  let linePath = "";
  let areaPath = "";
  if (points.length === 1) {
    linePath = `M ${points[0].x},${points[0].y}`;
  } else if (points.length > 1) {
    linePath = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const xm = ((a.x + b.x) / 2).toFixed(1);
      linePath += ` C ${xm},${a.y.toFixed(1)} ${xm},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    }
    areaPath = `${linePath} L ${last!.x.toFixed(1)},${VB_H} L ${points[0].x.toFixed(1)},${VB_H} Z`;
  }

  // Linear run-out projection from the last two weigh-ins.
  let runoutPath = "";
  if (points.length >= 2) {
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const slope = (b.y - a.y) / (b.x - a.x || 1);
    const projY = Math.max(6, Math.min(VB_H - 6, b.y + slope * (X_RUNOUT - b.x)));
    runoutPath = `M ${b.x.toFixed(1)},${b.y.toFixed(1)} L ${X_RUNOUT},${projY.toFixed(1)}`;
  }

  const currentKg = last ? last.kg : null;
  const firstKg = n ? inRange[0].kg : null;
  const prevKg = n >= 2 ? inRange[n - 2].kg : null;

  const labels: string[] = [];
  if (n > 0) {
    if (range === "week") {
      const startDay = o.weekStartsOn;
      for (let i = 0; i < 7; i++) labels.push(DAY[(startDay + i) % 7]);
    } else {
      const count = Math.min(8, n);
      for (let i = 1; i <= count; i++) labels.push(`W${i}`);
    }
  }

  const headerLabel =
    range === "all"
      ? `BODYWEIGHT · LAST ${n} WEIGH-IN${n === 1 ? "" : "S"}`
      : range === "meso"
        ? "BODYWEIGHT · THIS MESO"
        : "BODYWEIGHT · THIS WEEK";

  return {
    range,
    headerLabel,
    currentKg,
    currentLabel: currentKg == null ? "—" : `${fmtKg(currentKg)} kg`,
    deltaBlock: firstKg == null || currentKg == null ? "" : `${fmtDelta(currentKg - firstKg)} over the block`,
    deltaPrev:
      prevKg == null || currentKg == null ? "First weigh-in" : `${fmtDelta(currentKg - prevKg)} on the weigh-in before`,
    nowLine: currentKg == null ? "NO WEIGH-IN YET" : `NOW · ${fmtKg(currentKg)} kg`,
    labels,
    points,
    last,
    linePath,
    areaPath,
    runoutPath,
    tooltipLeftPct: last ? (last.x / 320) * 100 : 82.5,
    tooltipTopPct: last ? (last.y / 130) * 100 : 26.67,
    loggedToday: sorted.some((e) => e.date === todayISO),
  };
}

// --- SVG rendering (inner markup for a <svg viewBox="0 0 320 130">) ----------

export type BwStyle = {
  uid: string;
  areaColor: string;
  areaOpacity: number;
  line: string;
  lineWidth: number;
  glow: boolean;
  pointFill: string;
  pointStroke: string;
  pointR: number;
  lastFill: string;
  lastR: number;
  runout: string;
  runoutDash: string;
  nowVerticalColor?: string;
};

// Colours are theme vars (rgb(var(--a-*))): the graph recolours with the app
// theme. Emitted via inline style (SVG attributes don't resolve var()).
export const DASH_STYLE: BwStyle = {
  uid: "dash",
  areaColor: "rgb(var(--a-accent-rgb))",
  areaOpacity: 0.28,
  line: "rgb(var(--a-navy-rgb))",
  lineWidth: 2.5,
  glow: false,
  pointFill: "#ffffff",
  pointStroke: "rgb(var(--a-navy-rgb))",
  pointR: 3,
  lastFill: "rgb(var(--a-navy-rgb))",
  lastR: 4.5,
  runout: "rgb(var(--a-accent-rgb))",
  runoutDash: "3 6",
};

export const FULL_STYLE: BwStyle = {
  uid: "full",
  areaColor: "color-mix(in srgb, rgb(var(--a-accent-rgb)) 60%, #fff)",
  areaOpacity: 0.3,
  line: "color-mix(in srgb, rgb(var(--a-accent-rgb)) 45%, #fff)",
  lineWidth: 2.6,
  glow: true,
  pointFill: "color-mix(in srgb, rgb(var(--a-navy-rgb)) 62%, #000)",
  pointStroke: "color-mix(in srgb, rgb(var(--a-accent-rgb)) 45%, #fff)",
  pointR: 3.2,
  lastFill: "#ffffff",
  lastR: 5,
  runout: "rgba(var(--a-accent-rgb), 0.62)",
  runoutDash: "2 7",
  nowVerticalColor: "rgba(var(--a-accent-rgb), 0.35)",
};

export function renderBwSvgInner(m: BwModel, s: BwStyle): string {
  const fillId = `bwfill_${s.uid}`;
  const glowId = `bwglow_${s.uid}`;
  const glowAttr = s.glow ? ` filter="url(#${glowId})"` : "";
  const defs =
    `<defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" style="stop-color:${s.areaColor};stop-opacity:${s.areaOpacity}"></stop>` +
    `<stop offset="100%" style="stop-color:${s.areaColor};stop-opacity:0"></stop></linearGradient>` +
    (s.glow
      ? `<filter id="${glowId}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"></feGaussianBlur><feMerge><feMergeNode in="b"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>`
      : "") +
    `</defs>`;

  const area = m.areaPath ? `<path d="${m.areaPath}" fill="url(#${fillId})"></path>` : "";
  const line = m.linePath
    ? `<path d="${m.linePath}" style="fill:none;stroke:${s.line}" stroke-width="${s.lineWidth}" stroke-linecap="round"${glowAttr}></path>`
    : "";
  const runout = m.runoutPath
    ? `<path d="${m.runoutPath}" style="fill:none;stroke:${s.runout}" stroke-width="2" stroke-dasharray="${s.runoutDash}" stroke-linecap="round"></path>`
    : "";
  const nowV =
    s.nowVerticalColor && m.last
      ? `<line x1="${m.last.x.toFixed(1)}" y1="${m.last.y.toFixed(1)}" x2="${m.last.x.toFixed(1)}" y2="${VB_H}" style="stroke:${s.nowVerticalColor}" stroke-width="1"></line>`
      : "";
  const dots = m.points
    .slice(0, -1)
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${s.pointR}" style="fill:${s.pointFill};stroke:${s.pointStroke}" stroke-width="1.6"></circle>`,
    )
    .join("");
  const lastDot = m.last
    ? `<circle cx="${m.last.x.toFixed(1)}" cy="${m.last.y.toFixed(1)}" r="${s.lastR}" style="fill:${s.lastFill}"${glowAttr}></circle>`
    : "";

  return defs + area + line + runout + nowV + dots + lastDot;
}
