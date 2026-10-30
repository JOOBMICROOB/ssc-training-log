import { getDashboard } from "../../lib/data/athleteData";
import { addDays } from "../../lib/program/program";
import { athleteBlocks, noteHasContent, NOTE_SECTIONS, SECTION_LABEL, type AthleteBlock, type BlockNote } from "../../lib/program/blockNotes";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const localIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const SECTION_ICON: Record<string, string> = { general: "📋", squat: "🏋️", bench: "💪", deadlift: "⛓️", accessories: "➕" };

/** The athlete's blocks, the one running today first if there is one. */
export function blocksFor(athleteId: string): AthleteBlock[] {
  const d = getDashboard(athleteId);
  return athleteBlocks(d.publishedWeeks, d.blockNotes, addDays);
}
/** The block that covers today, if any. */
export function currentBlock(blocks: AthleteBlock[], today = localIso()): AthleteBlock | undefined {
  return blocks.find((b) => b.start && b.end && b.start <= today && today <= b.end);
}

/**
 * "My blocks": every block the athlete has had (newest first) with the coach's
 * notes per lift and the block's Loom. The current block opens expanded; tap any
 * other to read it. Read-only — the coach writes these from the builder.
 */
export function openBlockNotes(athleteId: string): void {
  const blocks = blocksFor(athleteId);
  markLoomsSeen(athleteId, blocks.map((b) => b.note).filter((n): n is BlockNote => !!n));
  const today = localIso();
  const cur = currentBlock(blocks, today);
  const open = new Set<string>(cur ? [cur.key] : blocks[0] ? [blocks[0].key] : []);

  const root = document.createElement("div");
  root.dataset.sscPopup = "blocks";
  root.style.cssText =
    "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);padding:16px;";

  const card = (b: AthleteBlock) => {
    const isOpen = open.has(b.key);
    const isNow = b === cur;
    const upcoming = !!b.start && b.start > today;
    const span = b.start ? `${fmtDay(b.start)} – ${fmtDay(b.end)}${b.weeks ? ` · ${b.weeks} wk` : ""}` : "";
    const has = noteHasContent(b.note);
    const tag = isNow
      ? `<span style="padding:3px 7px;border-radius:6px;background:rgb(var(--a-navy-rgb));color:#f2f2f3;font:700 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;">NOW</span>`
      : upcoming ? `<span style="padding:3px 7px;border-radius:6px;background:rgba(var(--a-accent-rgb),.16);color:rgb(var(--a-accent2-rgb));font:700 8.5px/1 Barlow,sans-serif;letter-spacing:.12em;">NEXT</span>` : "";
    const head = `<button data-bn="${esc(b.key)}" style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 13px;border:none;background:transparent;cursor:pointer;text-align:left;">
        <div style="flex:1 1 0;min-width:0;">
          <div style="display:flex;align-items:center;gap:7px;"><span style="font:600 16px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(var(--a-navy-rgb));">${esc(b.name)}</span>${tag}</div>
          <div style="margin-top:3px;font:400 10.5px/1.2 Barlow,sans-serif;color:rgb(138,146,156);">${span}${has ? `${span ? " · " : ""}<span style="color:rgb(var(--a-accent2-rgb));font-weight:600;">coach notes</span>` : ""}</div>
        </div>
        <span style="flex:0 0 auto;font-size:11px;color:rgb(var(--a-accent2-rgb));">${isOpen ? "▴" : "▾"}</span>
      </button>`;
    if (!isOpen) return `<div style="border:1px solid rgba(29,31,32,.1);border-radius:14px;background:rgba(255,255,255,.7);">${head}</div>`;
    const n = b.note;
    const loom = n?.loomUrl && /^https?:\/\//i.test(n.loomUrl)
      ? `<button data-loom="${esc(n.loomUrl)}" style="width:100%;margin:2px 0 10px;padding:11px;border:1px solid rgb(var(--a-navy-rgb));border-radius:11px;background:rgb(var(--a-navy-rgb));color:#f2f2f3;font:600 12.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">▶ WATCH THE LOOM</button>`
      : "";
    const secs = n
      ? NOTE_SECTIONS.filter((s) => n.sections[s]?.trim())
          .map((s) => `<div style="margin-bottom:10px;">
              <div style="font:700 9px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(var(--a-accent2-rgb));">${SECTION_ICON[s]} ${SECTION_LABEL[s].toUpperCase()}</div>
              <div style="margin-top:5px;white-space:pre-wrap;font:400 13px/1.5 Barlow,sans-serif;color:rgb(55,64,74);">${esc(n.sections[s].trim())}</div>
            </div>`)
          .join("")
      : "";
    const body = has ? `${loom}${secs}` : `<div style="padding:4px 0 8px;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">No coach notes for this block yet.</div>`;
    return `<div style="border:1.5px solid ${isNow ? "rgba(var(--a-accent-rgb),.55)" : "rgba(29,31,32,.1)"};border-radius:14px;background:rgba(255,255,255,.85);">${head}<div style="padding:0 14px 6px;">${body}</div></div>`;
  };

  const render = () => {
    root.innerHTML = `<div style="width:380px;max-width:96vw;max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 16px 10px;">
        <div>
          <div style="font:600 19px/1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(var(--a-navy-rgb));">MY BLOCKS</div>
          <div style="margin-top:4px;font:400 11px/1.3 Barlow,sans-serif;color:rgb(107,116,128);">Your coach's notes per block and lift.</div>
        </div>
        <button data-bn-close style="border:none;background:rgba(29,31,32,.06);width:30px;height:30px;border-radius:50%;font-size:13px;color:#5f6873;cursor:pointer;">✕</button>
      </div>
      <div style="flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 12px 14px;display:flex;flex-direction:column;gap:8px;">
        ${blocks.length ? blocks.map(card).join("") : `<div style="padding:24px 8px;text-align:center;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(138,146,156);">No blocks yet — they show up here once your coach publishes your program.</div>`}
      </div>
    </div>`;
  };
  render();
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-bn-close]")) { root.remove(); return; }
    const loom = t.closest<HTMLElement>("[data-loom]");
    if (loom?.dataset.loom) { window.open(loom.dataset.loom, "_blank", "noopener"); return; }
    const head = t.closest<HTMLElement>("[data-bn]");
    if (head?.dataset.bn) {
      const k = head.dataset.bn;
      if (open.has(k)) open.delete(k); else open.add(k);
      const scroller = root.querySelector<HTMLElement>("div[style*='overflow-y:auto']");
      const top = scroller?.scrollTop ?? 0;
      render();
      const s2 = root.querySelector<HTMLElement>("div[style*='overflow-y:auto']");
      if (s2) s2.scrollTop = top;
    }
  });
  document.body.appendChild(root);
}

// --- "new Loom" notice -----------------------------------------------------------
// When the coach adds (or changes) a block's Loom, the athlete gets a popup the
// next time the app shows it: watch it, read the notes, or later. "Seen" is per
// block + Loom link, so editing only the text doesn't nag again; "Later" only
// snoozes it for this session.

const seenKey = (athleteId: string) => `ssc.athlete.loomSeen.${athleteId}`;
function seenLooms(athleteId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(seenKey(athleteId)) || "{}") as Record<string, string>; } catch { return {}; }
}
function markLoomsSeen(athleteId: string, notes: BlockNote[]) {
  const seen = seenLooms(athleteId);
  let changed = false;
  for (const n of notes) if (n.loomUrl && !n.deleted && seen[n.id] !== n.loomUrl) { seen[n.id] = n.loomUrl; changed = true; }
  if (changed) { try { localStorage.setItem(seenKey(athleteId), JSON.stringify(seen)); } catch { /* ignore */ } }
}
const snoozed = new Set<string>(); // "Later" — this session only

/** The newest block note with a Loom the athlete hasn't seen yet. */
function unseenLoom(athleteId: string): BlockNote | undefined {
  const seen = seenLooms(athleteId);
  return Object.values(getDashboard(athleteId).blockNotes ?? {})
    .filter((n) => n && !n.deleted && n.loomUrl && /^https?:\/\//i.test(n.loomUrl) && seen[n.id] !== n.loomUrl && !snoozed.has(`${n.id}|${n.loomUrl}`))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/**
 * Show the "new Loom" popup if there is one and no other popup is open. Safe to call
 * on every data update (the note may only arrive after the cloud sync). Returns
 * true when it showed.
 */
export function maybeLoomNotice(athleteId: string): boolean {
  if (document.querySelector("[data-ssc-popup]")) return false;
  const n = unseenLoom(athleteId);
  if (!n?.loomUrl) return false;
  const root = document.createElement("div");
  root.dataset.sscPopup = "loom";
  root.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);padding:20px;";
  root.innerHTML = `
    <div style="width:100%;max-width:340px;background:var(--a-panel-bg,#fbfdff);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:22px 20px 16px;text-align:center;">
      <div style="width:64px;height:64px;margin:0 auto 12px;border-radius:50%;background:rgba(var(--a-accent-rgb),.14);display:grid;place-items:center;font-size:30px;">🎥</div>
      <div style="font:600 20px/1.15 'Barlow Condensed',sans-serif;letter-spacing:.01em;color:rgb(var(--a-ink-rgb));">Nieuwe Loom van je coach</div>
      <div style="margin-top:8px;font:400 12.5px/1.5 Barlow,sans-serif;color:rgb(107,116,128);">Je coach heeft een Loom${NOTE_SECTIONS.some((s) => n.sections[s]?.trim()) ? " en notities" : ""} toegevoegd voor <b style="color:rgb(var(--a-ink-rgb));">${esc(n.blockName)}</b>.</div>
      <button data-ln="watch" style="width:100%;margin-top:16px;padding:13px;border:1px solid rgb(var(--a-navy-rgb));border-radius:12px;background:rgb(var(--a-navy-rgb));color:rgb(242,242,243);font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">▶ BEKIJK DE LOOM</button>
      <button data-ln="read" style="width:100%;margin-top:8px;padding:12px;border:1px solid rgba(var(--a-accent-rgb),.5);border-radius:12px;background:rgba(var(--a-accent-rgb),.08);color:rgb(var(--a-navy-rgb));font:600 12.5px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">LEES DE NOTITIES</button>
      <button data-ln="later" style="width:100%;margin-top:6px;padding:10px;border:none;background:transparent;color:rgb(138,146,156);font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">LATER</button>
    </div>`;
  root.addEventListener("click", (e) => {
    const what = (e.target as HTMLElement).closest<HTMLElement>("[data-ln]")?.dataset.ln;
    if (!what) return;
    root.remove();
    if (what === "later") { snoozed.add(`${n.id}|${n.loomUrl}`); return; }
    markLoomsSeen(athleteId, [n]);
    if (what === "watch") window.open(n.loomUrl!, "_blank", "noopener");
    else openBlockNotes(athleteId);
  });
  document.body.appendChild(root);
  return true;
}

/** Remove a pending "new Loom" popup (screen unmount). */
export function closeLoomNotice() {
  document.querySelectorAll("[data-ssc-popup='loom']").forEach((el) => el.remove());
}
