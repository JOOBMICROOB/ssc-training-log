import { getDashboard, getSessionFor } from "../../lib/data/athleteData";
import { buildShareData, renderSessionPng } from "../../lib/share/sessionCard";

/**
 * Shows the shareable "session complete" card: renders the story PNG, previews
 * it, and offers the phone's native share sheet (Instagram Stories etc.) via the
 * Web Share API, with a save-image fallback.
 */
export async function showShareSheet(athleteId: string, date: string) {
  const data = getDashboard(athleteId);
  const shareData = buildShareData(getSessionFor(athleteId, date), data.prs, data.athlete.firstName);

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(9,17,28,.7);backdrop-filter:blur(4px);z-index:2000;padding:18px;overflow-y:auto";
  overlay.innerHTML = `
    <div style="width:330px;max-width:94vw;background:#0f1e2c;border:1px solid rgba(158,208,255,.2);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.5);padding:16px;text-align:center;">
      <div style="font:600 10px/1 Barlow,sans-serif;letter-spacing:.16em;color:rgba(214,231,247,.6);">SHARE YOUR SESSION</div>
      <div data-preview style="margin-top:12px;border-radius:14px;overflow:hidden;background:#132435;aspect-ratio:1080/1920;display:flex;align-items:center;justify-content:center;">
        <span style="font:600 12px/1 Barlow,sans-serif;color:rgba(214,231,247,.5);">Generating…</span>
      </div>
      <button data-share style="width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#9ed0ff;color:#0b1622;font:600 14px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">SHARE TO STORY</button>
      <button data-copy style="width:100%;margin-top:8px;padding:12px;border:1px solid rgba(158,208,255,.35);border-radius:12px;background:transparent;color:#dceaf6;font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">COPY IMAGE</button>
      <button data-close style="width:100%;margin-top:8px;padding:10px;border:0;background:transparent;color:rgba(214,231,247,.6);font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">CLOSE</button>
    </div>`;
  document.body.appendChild(overlay);

  let url = "";
  const cleanup = () => {
    if (url) URL.revokeObjectURL(url);
    overlay.remove();
  };
  overlay.querySelector("[data-close]")?.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cleanup();
  });

  let blob: Blob;
  try {
    blob = await renderSessionPng(shareData);
  } catch {
    const p = overlay.querySelector<HTMLElement>("[data-preview]");
    if (p) p.innerHTML = `<span style="font:600 12px/1 Barlow,sans-serif;color:#f4b4b4;">Could not generate image.</span>`;
    return;
  }
  url = URL.createObjectURL(blob);
  const file = new File([blob], "ssc-session.png", { type: "image/png" });
  const preview = overlay.querySelector<HTMLElement>("[data-preview]");
  if (preview) preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block;">`;

  const download = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "ssc-session.png";
    a.click();
  };
  const copyImage = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch {
      return false;
    }
  };

  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  overlay.querySelector("[data-share]")?.addEventListener("click", async () => {
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "Session complete", text: "Session done — trained with Specific Strength Coaching." } as ShareData);
      } catch {
        /* user cancelled */
      }
    } else if (!(await copyImage())) {
      download();
    }
  });
  const copyBtn = overlay.querySelector<HTMLButtonElement>("[data-copy]");
  copyBtn?.addEventListener("click", async () => {
    if (await copyImage()) {
      copyBtn.textContent = "COPIED ✓";
      setTimeout(() => (copyBtn.textContent = "COPY IMAGE"), 1500);
    } else {
      download();
    }
  });
}
