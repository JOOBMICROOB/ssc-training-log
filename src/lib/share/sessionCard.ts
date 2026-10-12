import type { Session } from "../program/program";
import { fmtKg } from "../calc/records";
import { musclesForSession, muscleMapSvg, type Region } from "./muscleMap";

/**
 * Builds a shareable "session complete" PNG — a COMPACT, transparent card (not a
 * full-screen frame) so once it's saved it drops onto a story as a movable
 * sticker. Shows each S/B/D with its actual sets (and a PR badge), total volume,
 * training time and a targeted-muscle map, under a single SSC wordmark.
 */

export type ShareLift = {
  name: string; // SQUAT / BENCH / DEADLIFT
  sets: string; // "100×5 · 110×5 · 140×1" — what the sets actually were
  pr: boolean; // top set beat the stored PR → show the PR badge
};
export type ShareData = {
  lifts: ShareLift[]; // the S/B/D trained this session (≤3)
  volume: string;
  durationLabel: string; // "" when the session clock is unknown
  muscles: Region[];
};

type Pr = { lift: string; value: string };

const fmtInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${sec}s`;
};

export function buildShareData(session: Session, prs: Pr[]): ShareData {
  const order: ("squat" | "bench" | "deadlift")[] = ["squat", "bench", "deadlift"];
  const label = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" } as const;
  const prFor = (l: string) => prs.find((p) => new RegExp(l, "i").test(p.lift));

  // Each S/B/D trained this session: the actual sets (weight×reps), and a PR flag
  // when the top logged set beat the stored PR.
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
      const sets = logged
        .map((s) => `${fmtKg(s.weightKg as number)}×${s.repsDone != null ? s.repsDone : s.targetReps || "?"}`)
        .join("   ·   ");
      return { name: label[l], sets, pr: isFinite(prVal) && top > prVal && top > 0 };
    })
    .filter((x) => x.sets);

  // Total volume actually done — confirmed loads only (no coach prefills / fails).
  let vol = 0;
  session.exercises.forEach((e) =>
    e.sets.forEach((s) => {
      if (s.weightKg != null && !s.prefill && !s.failed) vol += s.weightKg * (parseInt(s.targetReps, 10) || 1);
    }),
  );

  // Training time: the app's session clock — first real set (startedAt) to the
  // last set touched (editedAt). Hidden if the clock wasn't captured.
  const durationLabel =
    session.startedAt && session.editedAt && session.editedAt > session.startedAt
      ? fmtDuration(session.editedAt - session.startedAt)
      : "";

  return { lifts, volume: `${fmtInt(vol)} kg`, durationLabel, muscles: [...musclesForSession(session)] };
}

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

const WHITE = "#f2f7fc";
const LABEL = "rgba(224,236,248,.72)";
const ACCENT = "#9ed0ff";
const INK = "#0b1622"; // dark text on the accent PR badge
const spaced = (t: string) => t.split("").join(" "); // hair-space tracking

type Row = { h: number; draw: (ctx: CanvasRenderingContext2D, yTop: number) => void };

/**
 * Renders a COMPACT, auto-sized card — not a full-screen frame — so when it's
 * saved and added to a story it behaves like a movable sticker. Fixed width,
 * height grows to fit, equal gaps between every row, transparent background.
 */
export async function renderSessionPng(data: ShareData): Promise<Blob> {
  try {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts optional */
  }

  const W = 820;
  const cx = W / 2;
  const contentW = W - 104;
  const gap = 52; // equal spacing between every row
  const padTop = 56;
  const padBottom = 60;

  // Preload images first so their heights are known before sizing the canvas.
  let logo: HTMLImageElement | null = null;
  let map: HTMLImageElement | null = null;
  try {
    logo = await loadImage("/assets/logo-full-white.png");
  } catch {
    /* text fallback */
  }
  try {
    map = await loadImage(`data:image/svg+xml;utf8,${encodeURIComponent(muscleMapSvg(new Set(data.muscles)))}`);
  } catch {
    /* map optional */
  }

  const liftH = 106;
  const statH = 130;
  const mapW = 340;
  const mapH = map ? Math.round((mapW * map.height) / map.width) : 0;
  const logoW = 300;
  const logoH = logo ? Math.round((logoW * logo.height) / logo.width) : 56;

  const rows: Row[] = [];

  for (const lift of data.lifts) {
    rows.push({
      h: liftH,
      draw: (ctx, yTop) => {
        ctx.textBaseline = "top";
        // name (+ PR badge) centred on one line
        ctx.font = "700 54px 'Barlow Condensed', sans-serif";
        const nameW = ctx.measureText(lift.name).width;
        let badgeW = 0;
        const badgeGap = 18;
        if (lift.pr) {
          ctx.font = "700 27px 'Barlow Condensed', sans-serif";
          badgeW = ctx.measureText("PR").width + 40;
        }
        const total = nameW + (lift.pr ? badgeGap + badgeW : 0);
        const sx = cx - total / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = WHITE;
        ctx.font = "700 54px 'Barlow Condensed', sans-serif";
        ctx.fillText(lift.name, sx, yTop);
        if (lift.pr) {
          const bx = sx + nameW + badgeGap;
          const by = yTop + 7;
          const bh = 44;
          ctx.fillStyle = ACCENT;
          roundRect(ctx, bx, by, badgeW, bh, 12);
          ctx.fillStyle = INK;
          ctx.font = "700 27px 'Barlow Condensed', sans-serif";
          ctx.fillText("PR", bx + 20, by + 11);
        }
        // sets line — shrink to fit the box width
        let s = 33;
        ctx.font = `600 ${s}px 'Barlow', sans-serif`;
        while (ctx.measureText(lift.sets).width > contentW && s > 22) {
          s -= 1;
          ctx.font = `600 ${s}px 'Barlow', sans-serif`;
        }
        ctx.textAlign = "center";
        ctx.fillStyle = LABEL;
        ctx.fillText(lift.sets, cx, yTop + 62);
      },
    });
  }

  const stat = (labelText: string, value: string): Row => ({
    h: statH,
    draw: (ctx, yTop) => {
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      ctx.fillStyle = LABEL;
      ctx.font = "600 26px 'Barlow', sans-serif";
      ctx.fillText(spaced(labelText), cx, yTop);
      ctx.fillStyle = WHITE;
      ctx.font = "700 92px 'Barlow Condensed', sans-serif";
      ctx.fillText(value, cx, yTop + 38);
    },
  });

  rows.push(stat("TOTAL VOLUME", data.volume));
  if (data.durationLabel) rows.push(stat("TIME", data.durationLabel));

  if (map) {
    rows.push({ h: mapH, draw: (ctx, yTop) => ctx.drawImage(map!, cx - mapW / 2, yTop, mapW, mapH) });
  }
  rows.push({
    h: logoH,
    draw: (ctx, yTop) => {
      if (logo) ctx.drawImage(logo, cx - logoW / 2, yTop, logoW, logoH);
      else {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = WHITE;
        ctx.font = "700 48px 'Barlow Condensed', sans-serif";
        ctx.fillText("SPECIFIC STRENGTH", cx, yTop);
      }
    },
  });

  const H = padTop + rows.reduce((s, r) => s + r.h, 0) + gap * (rows.length - 1) + padBottom;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // Transparent background; a soft dark shadow keeps light text legible on photos.
  ctx.shadowColor = "rgba(8,14,22,.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;

  let y = padTop;
  for (const r of rows) {
    r.draw(ctx, y);
    y += r.h + gap;
  }

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}
