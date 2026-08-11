import type { Session } from "../program/program";
import { fmtKg } from "../calc/records";

/**
 * Builds a shareable 1080×1920 "story" PNG summarising a finished session —
 * SSC branding + the key lifts, total volume, sets and session RPE — for the
 * athlete to post (and the coach to get some free marketing).
 */

export type ShareLift = { name: string; top: string; volume: string; pr: boolean };
export type ShareData = {
  athleteName: string;
  sessionName: string;
  dateLabel: string;
  lifts: ShareLift[];
  volume: string;
  prCount: number;
};

type Pr = { lift: string; value: string };

const fmtInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function buildShareData(session: Session, prs: Pr[], athleteName: string): ShareData {
  const order: ("squat" | "bench" | "deadlift")[] = ["squat", "bench", "deadlift"];
  const label = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" } as const;
  const prFor = (l: string) => prs.find((p) => new RegExp(l, "i").test(p.lift));

  const lifts: ShareLift[] = order
    .filter((l) => session.exercises.some((e) => e.mainLift === l))
    .map((l) => {
      const exs = session.exercises.filter((e) => e.mainLift === l);
      const logged = exs.flatMap((e) => e.sets).filter((s) => s.weightKg != null && !s.failed);
      const top = logged.length ? Math.max(...logged.map((s) => s.weightKg as number)) : 0;
      let lv = 0;
      exs.forEach((e) =>
        e.sets.forEach((s) => {
          if (s.weightKg != null) lv += s.weightKg * (parseInt(s.targetReps, 10) || 1);
        }),
      );
      const pr = prFor(l === "deadlift" ? "dead" : l);
      const prVal = pr ? parseFloat(pr.value.replace(",", ".")) : NaN;
      return {
        name: label[l],
        top: top ? `${fmtKg(top)} kg` : "—",
        volume: `${fmtInt(lv)} kg`,
        pr: isFinite(prVal) && top > prVal,
      };
    });

  let vol = 0;
  session.exercises.forEach((e) =>
    e.sets.forEach((s) => {
      if (s.weightKg != null) vol += s.weightKg * (parseInt(s.targetReps, 10) || 1);
    }),
  );
  const d = new Date(`${session.date}T00:00:00`);
  const dateLabel = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  return {
    athleteName,
    sessionName: session.name,
    dateLabel,
    lifts,
    volume: `${fmtInt(vol)} kg`,
    prCount: lifts.filter((l) => l.pr).length,
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

export async function renderSessionPng(data: ShareData): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  try {
    await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* fonts optional */
  }

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#22384e");
  bg.addColorStop(0.5, "#132435");
  bg.addColorStop(1, "#0b1622");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  ctx.textAlign = "center";

  // logo wordmark
  try {
    const logo = await loadImage("/assets/logo-full-white.png");
    const lw = 560;
    const lh = (lw * logo.height) / logo.width;
    ctx.drawImage(logo, cx - lw / 2, 150, lw, lh);
  } catch {
    ctx.fillStyle = "#f2f7fc";
    ctx.font = "700 60px 'Barlow Condensed', sans-serif";
    ctx.fillText("SPECIFIC STRENGTH", cx, 240);
  }

  // heading
  ctx.fillStyle = "#9ed0ff";
  ctx.font = "600 30px 'Barlow', sans-serif";
  ctx.fillText("S E S S I O N   C O M P L E T E", cx, 470);

  ctx.fillStyle = "#f2f7fc";
  let nameSize = 78;
  ctx.font = `700 ${nameSize}px 'Barlow Condensed', sans-serif`;
  while (ctx.measureText(data.sessionName).width > W - 140 && nameSize > 44) {
    nameSize -= 4;
    ctx.font = `700 ${nameSize}px 'Barlow Condensed', sans-serif`;
  }
  ctx.fillText(data.sessionName, cx, 560);

  ctx.fillStyle = "rgba(214,231,247,.7)";
  ctx.font = "500 34px 'Barlow', sans-serif";
  ctx.fillText(`${data.athleteName.toUpperCase()}  ·  ${data.dateLabel}`, cx, 620);

  let y = 700;

  // PR badge (only if any)
  if (data.prCount > 0) {
    const txt = `${data.prCount} NEW PR${data.prCount > 1 ? "S" : ""}`;
    ctx.font = "700 42px 'Barlow Condensed', sans-serif";
    const pw = ctx.measureText(txt).width + 90;
    ctx.fillStyle = "#9ed0ff";
    roundRect(ctx, cx - pw / 2, y, pw, 76, 20);
    ctx.fill();
    ctx.fillStyle = "#0b1622";
    ctx.fillText(txt, cx, y + 53);
    y += 140;
  } else {
    y = 760;
  }

  // top set per main lift — the hero
  const n = Math.max(1, data.lifts.length);
  const areaX = 90;
  const areaW = W - 180;
  const gap = 28;
  const tileW = (areaW - gap * (n - 1)) / n;
  const tileH = 330;
  data.lifts.forEach((lift, i) => {
    const x = areaX + i * (tileW + gap);
    ctx.fillStyle = "rgba(158,208,255,.10)";
    roundRect(ctx, x, y, tileW, tileH, 28);
    ctx.fill();
    ctx.strokeStyle = lift.pr ? "rgba(158,208,255,.65)" : "rgba(158,208,255,.25)";
    ctx.lineWidth = lift.pr ? 4 : 2;
    roundRect(ctx, x, y, tileW, tileH, 28);
    ctx.stroke();

    ctx.fillStyle = "rgba(214,231,247,.65)";
    ctx.font = "600 34px 'Barlow', sans-serif";
    ctx.fillText(lift.name, x + tileW / 2, y + 78);

    ctx.fillStyle = "#f2f7fc";
    const vsize = n >= 3 ? 66 : 88;
    ctx.font = `700 ${vsize}px 'Barlow Condensed', sans-serif`;
    ctx.fillText(lift.volume, x + tileW / 2, y + 78 + vsize + 22);

    ctx.fillStyle = "rgba(214,231,247,.5)";
    ctx.font = "600 25px 'Barlow', sans-serif";
    ctx.fillText(`VOLUME · TOP ${lift.top}`, x + tileW / 2, y + tileH - 40);
  });
  y += tileH + 90;

  // session total volume — single line
  ctx.fillStyle = "rgba(214,231,247,.6)";
  ctx.font = "600 32px 'Barlow', sans-serif";
  ctx.fillText("SESSION VOLUME", cx, y);
  ctx.fillStyle = "#9ed0ff";
  ctx.font = "700 100px 'Barlow Condensed', sans-serif";
  ctx.fillText(data.volume, cx, y + 108);

  // footer emblem
  try {
    const emblem = await loadImage("/assets/logo-emblem-white.png");
    const eh = 104;
    const ew = (eh * emblem.width) / emblem.height;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(emblem, cx - ew / 2, H - 210, ew, eh);
    ctx.globalAlpha = 1;
  } catch {
    /* no footer mark */
  }

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}
