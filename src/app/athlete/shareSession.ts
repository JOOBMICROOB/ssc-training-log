import { getDashboard, getSessionFor } from "../../lib/data/athleteData";
import { currentWeekWindow } from "../../lib/calc/adherence";
import { buildShareData, renderCardPng, shareOptions } from "../../lib/share/sessionCard";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Shows the shareable "session complete" cards: renders each available layout as
 * a transparent sticker PNG, lets the athlete swipe between them, and offers the
 * phone's native share sheet (Instagram Stories etc.), with a save/copy fallback.
 */
export async function showShareSheet(athleteId: string, date: string) {
  const data = getDashboard(athleteId);

  // This week's sessions (for the weekly S/B/D layout).
  const start = currentWeekWindow(data.weekStartsOn, new Date(`${date}T00:00:00`)).start;
  const weekSessions = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    const ds = iso(dd);
    if (ds !== date) weekSessions.push(getSessionFor(athleteId, ds));
  }

  const shareData = buildShareData(getSessionFor(athleteId, date), data.prs, weekSessions);
  const options = shareOptions(shareData);

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(9,17,28,.7);backdrop-filter:blur(4px);z-index:2000;padding:18px;overflow-y:auto";
  const checker =
    "background-color:#6b7682;background-image:linear-gradient(45deg,#565f6a 25%,transparent 25%),linear-gradient(-45deg,#565f6a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#565f6a 75%),linear-gradient(-45deg,transparent 75%,#565f6a 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0;";
  overlay.innerHTML = `
    <div style="width:340px;max-width:94vw;background:#0f1e2c;border:1px solid rgba(158,208,255,.2);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.5);padding:16px;text-align:center;">
      <div style="font:600 10px/1 Barlow,sans-serif;letter-spacing:.16em;color:rgba(214,231,247,.6);">SHARE YOUR SESSION</div>
      <div data-sub style="margin-top:6px;font:500 10px/1.3 Barlow,sans-serif;color:rgba(214,231,247,.45);">Transparent sticker — swipe to pick a layout, then drag it onto your story.</div>
      <div style="position:relative;margin-top:12px;">
        <div data-scroller style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory;border-radius:14px;scrollbar-width:none;-ms-overflow-style:none;min-height:160px;${checker}">
          <div style="flex:0 0 100%;display:flex;align-items:center;justify-content:center;min-height:160px;"><span style="font:600 12px/1 Barlow,sans-serif;color:rgba(255,255,255,.75);">Generating…</span></div>
        </div>
        <button data-prev style="display:none;position:absolute;top:50%;left:6px;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:50%;background:rgba(10,19,28,.6);color:#fff;font:600 16px/1 sans-serif;cursor:pointer;">‹</button>
        <button data-next style="display:none;position:absolute;top:50%;right:6px;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:50%;background:rgba(10,19,28,.6);color:#fff;font:600 16px/1 sans-serif;cursor:pointer;">›</button>
      </div>
      <div data-dots style="display:flex;gap:7px;justify-content:center;margin-top:12px;"></div>
      <button data-share style="width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#9ed0ff;color:#0b1622;font:600 14px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">SHARE TO STORY</button>
      <button data-copy style="width:100%;margin-top:8px;padding:12px;border:1px solid rgba(158,208,255,.35);border-radius:12px;background:transparent;color:#dceaf6;font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">COPY IMAGE</button>
      <button data-close style="width:100%;margin-top:8px;padding:10px;border:0;background:transparent;color:rgba(214,231,247,.6);font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">CLOSE</button>
    </div>`;
  document.body.appendChild(overlay);

  const urls: string[] = [];
  const cleanup = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    overlay.remove();
  };
  overlay.querySelector("[data-close]")?.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cleanup();
  });

  const scroller = overlay.querySelector<HTMLElement>("[data-scroller]")!;
  const sub = overlay.querySelector<HTMLElement>("[data-sub]")!;
  const dotsWrap = overlay.querySelector<HTMLElement>("[data-dots]")!;

  let blobs: Blob[];
  try {
    blobs = await Promise.all(options.map((o) => renderCardPng(shareData, o.n)));
  } catch {
    scroller.innerHTML = `<div style="flex:0 0 100%;display:flex;align-items:center;justify-content:center;min-height:160px;"><span style="font:600 12px/1 Barlow,sans-serif;color:#f4b4b4;">Could not generate image.</span></div>`;
    return;
  }

  // Build one slide per layout.
  scroller.innerHTML = options
    .map((_, i) => {
      const u = URL.createObjectURL(blobs[i]);
      urls.push(u);
      return `<div style="flex:0 0 100%;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;padding:18px 12px;box-sizing:border-box;"><img src="${u}" style="width:100%;height:auto;display:block;"></div>`;
    })
    .join("");

  // Dots + arrows + caption, tracking the current slide.
  let current = 0;
  const multi = options.length > 1;
  dotsWrap.innerHTML = options
    .map((_, i) => `<button data-dot="${i}" style="width:8px;height:8px;border:0;border-radius:50%;padding:0;cursor:pointer;background:rgba(214,231,247,${i === 0 ? ".9" : ".3"});"></button>`)
    .join("");
  const dots = Array.from(dotsWrap.querySelectorAll<HTMLButtonElement>("[data-dot]"));
  const prev = overlay.querySelector<HTMLButtonElement>("[data-prev]")!;
  const next = overlay.querySelector<HTMLButtonElement>("[data-next]")!;
  if (multi) {
    prev.style.display = next.style.display = "block";
  }

  const setCurrent = (i: number) => {
    current = Math.max(0, Math.min(options.length - 1, i));
    dots.forEach((d, j) => (d.style.background = `rgba(214,231,247,${j === current ? ".9" : ".3"})`));
    sub.textContent = multi
      ? `${options[current].title} · ${current + 1}/${options.length} — swipe for more`
      : "Transparent sticker — drag it onto your story.";
  };
  setCurrent(0);

  scroller.addEventListener("scroll", () => {
    const i = Math.round(scroller.scrollLeft / scroller.clientWidth);
    if (i !== current) setCurrent(i);
  });
  const goTo = (i: number) => scroller.scrollTo({ left: Math.max(0, Math.min(options.length - 1, i)) * scroller.clientWidth, behavior: "smooth" });
  dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));
  prev.addEventListener("click", () => goTo(current - 1));
  next.addEventListener("click", () => goTo(current + 1));

  const fileFor = (i: number) => new File([blobs[i]], `ssc-${options[i].title.toLowerCase().replace(/[^a-z]/g, "")}.png`, { type: "image/png" });
  const copyImage = async (i: number): Promise<boolean> => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blobs[i].type]: blobs[i] })]);
      return true;
    } catch {
      return false;
    }
  };
  const download = (i: number) => {
    const a = document.createElement("a");
    a.href = urls[i];
    a.download = fileFor(i).name;
    a.click();
  };

  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  overlay.querySelector("[data-share]")?.addEventListener("click", async () => {
    const file = fileFor(current);
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "Session complete", text: "Session done — trained with Specific Strength Coaching." });
      } catch {
        /* user cancelled */
      }
    } else if (!(await copyImage(current))) {
      download(current);
    }
  });
  const copyBtn = overlay.querySelector<HTMLButtonElement>("[data-copy]");
  copyBtn?.addEventListener("click", async () => {
    if (await copyImage(current)) {
      copyBtn.textContent = "COPIED ✓";
      setTimeout(() => (copyBtn.textContent = "COPY IMAGE"), 1500);
    } else {
      download(current);
    }
  });
}
