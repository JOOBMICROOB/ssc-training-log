import type { Session } from "../program/program";
import { fmtKg } from "../calc/records";
import { musclesForSession, muscleMapSvg, type Region } from "./muscleMap";

/**
 * Builds shareable "session complete" PNGs — compact, transparent stickers (not
 * full-screen frames) so once saved they drop onto a story and stay movable.
 * Three layouts the athlete can scroll between:
 *   1 — Session: each S/B/D with its sets (+ PR badge), volume, time, muscle map.
 *   2 — Stats: a Strava-style dotted-leader list (top compound, heaviest load…).
 *   3 — Weekly SBD: squat / bench / deadlift bests + weekly total (only when all
 *       three were trained this week).
 */

export type ShareLift = { name: string; sets: string; pr: boolean };
export type ShareData = {
  // option 1
  lifts: ShareLift[];
  volume: string;
  durationLabel: string; // "" when the session clock is unknown
  muscles: Region[];
  // option 2
  topCompound: string; // the top compound set, "Squat 180×4", or ""
  setsCount: number;
  prCount: number;
  // option 3 — only present when squat, bench AND deadlift were trained this week
  weekly?: { squat: string; bench: string; deadlift: string; total: string };
};

export type ShareOption = { n: 1 | 2 | 3; title: string };

type Pr = { lift: string; value: string };

const fmtInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${sec}s`;
};

const LIFT_LABEL = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" } as const;
const repsOf = (s: { repsDone: number | null; targetReps: string }) =>
  s.repsDone != null ? String(s.repsDone) : s.targetReps || "?";

/** Heaviest logged weight for a main lift across a list of sessions (0 if none). */
function bestWeight(sessions: Session[], lift: "squat" | "bench" | "deadlift"): number {
  let best = 0;
  for (const se of sessions)
    for (const e of se.exercises)
      if (e.mainLift === lift)
        for (const s of e.sets)
          if (s.weightKg != null && !s.failed && !s.prefill) best = Math.max(best, s.weightKg);
  return best;
}

export function buildShareData(session: Session, prs: Pr[], weekSessions: Session[] = []): ShareData {
  const order: ("squat" | "bench" | "deadlift")[] = ["squat", "bench", "deadlift"];
  const label = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" } as const;
  const prFor = (l: string) => prs.find((p) => new RegExp(l, "i").test(p.lift));

  // Each S/B/D trained today: the actual sets (weight×reps), and a PR flag.
  const lifts: ShareLift[] = order
    .filter((l) => session.exercises.some((e) => e.mainLift === l))
    .map((l) => {
      const logged = session.exercises
        .filter((e) => e.mainLift === l)
        .flatMap((e) => e.sets)
        .filter((s) => s.weightKg != null && !s.failed && !s.prefill);
      const top = logged.length ? Math.max(...logged.map((s) => s.weightKg as number)) : 0;
      const pr = prFor(l === "deadlift" ? "dead" : l);
      const prVal = pr ? parseFloat(pr.value.replace(",", ".")) : NaN;
      const sets = logged.map((s) => `${fmtKg(s.weightKg as number)}×${repsOf(s)}`).join("   ·   ");
      return { name: label[l], sets, pr: isFinite(prVal) && top > prVal && top > 0 };
    })
    .filter((x) => x.sets);

  // Total volume + set count, confirmed loads only.
  let vol = 0;
  let setsCount = 0;
  for (const e of session.exercises)
    for (const s of e.sets)
      if (s.weightKg != null && !s.prefill && !s.failed) {
        vol += s.weightKg * (parseInt(s.targetReps, 10) || 1);
        setsCount += 1;
      }

  // Top compound of the day: the S/B/D with the heaviest top set (weight×reps).
  let topCompound = "";
  let topW = 0;
  for (const l of order) {
    const real = session.exercises
      .filter((e) => e.mainLift === l)
      .flatMap((e) => e.sets)
      .filter((s) => s.weightKg != null && !s.failed && !s.prefill);
    if (!real.length) continue;
    const topSet = real.reduce((a, b) => ((b.weightKg as number) > (a.weightKg as number) ? b : a));
    if ((topSet.weightKg as number) > topW) {
      topW = topSet.weightKg as number;
      topCompound = `${LIFT_LABEL[l]} ${fmtKg(topSet.weightKg as number)}×${repsOf(topSet)}`;
    }
  }

  // Training time: the app's session clock (first real set → last set touched).
  const durationLabel =
    session.startedAt && session.editedAt && session.editedAt > session.startedAt
      ? fmtDuration(session.editedAt - session.startedAt)
      : "";

  // Weekly S/B/D — only when all three were trained this week.
  const all = [session, ...weekSessions];
  const ws = bestWeight(all, "squat");
  const wb = bestWeight(all, "bench");
  const wd = bestWeight(all, "deadlift");
  const weekly =
    ws > 0 && wb > 0 && wd > 0
      ? {
          squat: `${fmtKg(ws)} kg`,
          bench: `${fmtKg(wb)} kg`,
          deadlift: `${fmtKg(wd)} kg`,
          total: `${fmtInt(ws + wb + wd)} kg`,
        }
      : undefined;

  return {
    lifts,
    volume: `${fmtInt(vol)} kg`,
    durationLabel,
    muscles: [...musclesForSession(session)],
    topCompound,
    setsCount,
    prCount: lifts.filter((l) => l.pr).length,
    weekly,
  };
}

/** Which layouts are available for this session (option 3 only when eligible). */
export function shareOptions(data: ShareData): ShareOption[] {
  const opts: ShareOption[] = [
    { n: 1, title: "SESSION" },
    { n: 2, title: "STATS" },
  ];
  if (data.weekly) opts.push({ n: 3, title: "WEEKLY S/B/D" });
  return opts;
}

// --- rendering --------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

const W = 820;
const CX = W / 2;
const CONTENT = W - 104;
const PADX = (W - CONTENT) / 2;
const WHITE = "#f2f7fc";
const LABEL = "rgba(224,236,248,.72)";
const DIM = "rgba(234,243,255,.9)";
const ACCENT = "#9ed0ff";
const INK = "#0b1622";
const spaced = (t: string) => t.split("").join(" ");

type Item = { h: number; draw: (ctx: CanvasRenderingContext2D, yTop: number) => void };

const liftItem = (lift: ShareLift): Item => ({
  h: 100,
  draw: (ctx, yTop) => {
    ctx.textBaseline = "top";
    ctx.font = "700 54px 'Barlow Condensed', sans-serif";
    const nameW = ctx.measureText(lift.name).width;
    let badgeW = 0;
    const badgeGap = 18;
    if (lift.pr) {
      ctx.font = "700 27px 'Barlow Condensed', sans-serif";
      badgeW = ctx.measureText("PR").width + 40;
    }
    const sx = CX - (nameW + (lift.pr ? badgeGap + badgeW : 0)) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.font = "700 54px 'Barlow Condensed', sans-serif";
    ctx.fillText(lift.name, sx, yTop);
    if (lift.pr) {
      const bx = sx + nameW + badgeGap;
      ctx.fillStyle = ACCENT;
      roundRect(ctx, bx, yTop + 7, badgeW, 44, 12);
      ctx.fillStyle = INK;
      ctx.font = "700 27px 'Barlow Condensed', sans-serif";
      ctx.fillText("PR", bx + 20, yTop + 18);
    }
    let s = 33;
    ctx.font = `600 ${s}px 'Barlow', sans-serif`;
    while (ctx.measureText(lift.sets).width > CONTENT && s > 22) {
      s -= 1;
      ctx.font = `600 ${s}px 'Barlow', sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = LABEL;
    ctx.fillText(lift.sets, CX, yTop + 60);
  },
});

const statItem = (labelText: string, value: string): Item => ({
  h: 124,
  draw: (ctx, yTop) => {
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = LABEL;
    ctx.font = "600 26px 'Barlow', sans-serif";
    ctx.fillText(spaced(labelText), CX, yTop);
    ctx.fillStyle = WHITE;
    ctx.font = "700 90px 'Barlow Condensed', sans-serif";
    ctx.fillText(value, CX, yTop + 36);
  },
});

// Strava-style: label left, value right, dotted leader between.
const leaderItem = (labelText: string, value: string): Item => ({
  h: 66,
  draw: (ctx, yTop) => {
    ctx.textBaseline = "alphabetic";
    const baseY = yTop + 42;
    ctx.textAlign = "left";
    ctx.fillStyle = DIM;
    ctx.font = "600 38px 'Barlow', sans-serif";
    ctx.fillText(labelText, PADX, baseY);
    const lw = ctx.measureText(labelText).width;
    ctx.textAlign = "right";
    ctx.fillStyle = WHITE;
    ctx.font = "700 42px 'Barlow Condensed', sans-serif";
    ctx.fillText(value, W - PADX, baseY);
    const vw = ctx.measureText(value).width;
    ctx.fillStyle = "rgba(234,243,255,.34)";
    for (let x = PADX + lw + 18; x <= W - PADX - vw - 18; x += 16) {
      ctx.beginPath();
      ctx.arc(x, baseY - 11, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});

const imageItem = (img: HTMLImageElement, w: number): Item => {
  const h = Math.round((w * img.height) / img.width);
  return { h, draw: (ctx, yTop) => ctx.drawImage(img, CX - w / 2, yTop, w, h) };
};

/** Render one of the three share layouts to a compact, transparent PNG. */
export async function renderCardPng(data: ShareData, option: 1 | 2 | 3 = 1): Promise<Blob> {
  try {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts optional */
  }

  const items: Item[] = [];

  if (option === 1) {
    for (const lift of data.lifts) items.push(liftItem(lift));
    items.push(statItem("TOTAL VOLUME", data.volume));
    if (data.durationLabel) items.push(statItem("TIME", data.durationLabel));
    try {
      const map = await loadImage(`data:image/svg+xml;utf8,${encodeURIComponent(muscleMapSvg(new Set(data.muscles)))}`);
      items.push(imageItem(map, 340));
    } catch {
      /* map optional */
    }
  } else if (option === 2) {
    if (data.topCompound) items.push(leaderItem("Topset", data.topCompound));
    items.push(leaderItem("Total volume", data.volume));
    if (data.durationLabel) items.push(leaderItem("Time", data.durationLabel));
    items.push(leaderItem("Sets", String(data.setsCount)));
    if (data.prCount > 0) items.push(leaderItem("New PRs", String(data.prCount)));
  } else {
    const w = data.weekly!;
    items.push(leaderItem("Squat", w.squat));
    items.push(leaderItem("Bench", w.bench));
    items.push(leaderItem("Deadlift", w.deadlift));
    items.push(leaderItem("Weekly total", w.total));
  }

  // Single SSC wordmark at the bottom (its own item).
  try {
    const logo = await loadImage("/assets/logo-full-white.png");
    items.push(imageItem(logo, 300));
  } catch {
    items.push({
      h: 56,
      draw: (ctx, yTop) => {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = WHITE;
        ctx.font = "700 48px 'Barlow Condensed', sans-serif";
        ctx.fillText("SPECIFIC STRENGTH", CX, yTop);
      },
    });
  }

  const gap = option === 1 ? 40 : 30; // tight, even rhythm (lists sit closer)
  const padTop = 56;
  const padBottom = 60;
  const H = padTop + items.reduce((s, it) => s + it.h, 0) + gap * (items.length - 1) + padBottom;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.shadowColor = "rgba(8,14,22,.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;

  let y = padTop;
  for (const it of items) {
    it.draw(ctx, y);
    y += it.h + gap;
  }

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

// Back-compat: the old single-layout export maps to option 1.
export const renderSessionPng = (data: ShareData) => renderCardPng(data, 1);
