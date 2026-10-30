import { useMemo, useState } from "react";
import { getDashboard, saveBlockNote } from "../../lib/data/athleteData";
import { notifyAthlete } from "../../lib/auth/coachAuth";
import { addDays } from "../../lib/program/program";
import { NOTE_SECTIONS, SECTION_LABEL, emptySections, splitBlockNotes, findLoomUrl, noteHasContent, type BlockNote, type NoteSection } from "../../lib/program/blockNotes";
import type { Mesocycle } from "./coachProgram";

/** The block's date span from its dated weeks (first start → last week's 7th day). */
function blockSpan(meso: Mesocycle): { start?: string; end?: string } {
  const starts = meso.weeks.map((w) => w.startDate).filter((d): d is string => !!d).sort();
  return starts.length ? { start: starts[0], end: addDays(starts[starts.length - 1], 6) } : {};
}

/**
 * Coach: notes for one block, shown to the athlete in their app. Paste a summary of
 * the block's Loom (or the transcript) → "Split automatically" sorts it into
 * General / Squat / Bench / Deadlift / Accessories, every box stays editable, then
 * Save sends it to the athlete (optionally with a push).
 */
export function BlockNotesEditor({ athleteId, athleteName, meso, onClose }: { athleteId: string; athleteName: string; meso: Mesocycle; onClose: () => void }) {
  const existing = useMemo(() => {
    const n = getDashboard(athleteId).blockNotes?.[meso.id];
    return n && !n.deleted ? n : undefined;
  }, [athleteId, meso.id]);
  const [loomUrl, setLoomUrl] = useState(existing?.loomUrl ?? "");
  const [paste, setPaste] = useState("");
  const [sections, setSections] = useState<Record<NoteSection, string>>(existing?.sections ?? emptySections());
  const [notify, setNotify] = useState(true);

  const anyText = NOTE_SECTIONS.some((s) => sections[s].trim());

  const autoSplit = () => {
    if (!paste.trim()) return;
    if (anyText && !confirm("Replace what's in the boxes with the new split?")) return;
    setSections(splitBlockNotes(paste));
    const url = findLoomUrl(paste);
    if (url && !loomUrl.trim()) setLoomUrl(url);
  };

  const save = () => {
    const note: BlockNote = { id: meso.id, blockName: meso.name, ...blockSpan(meso), loomUrl: loomUrl.trim() || undefined, sections, updatedAt: Date.now() };
    if (!noteHasContent(note)) { alert("Add a Loom link or some notes first."); return; }
    saveBlockNote(athleteId, note);
    if (notify) void notifyAthlete(athleteId, "New block notes", `${meso.name} — your coach added notes for this block.`);
    onClose();
  };

  const remove = () => {
    if (!existing || !confirm(`Remove the notes for ${meso.name}? ${athleteName} won't see them any more.`)) return;
    saveBlockNote(athleteId, { ...existing, deleted: true });
    onClose();
  };

  const label = { font: "600 10px/1 var(--font-heading)", letterSpacing: ".08em", textTransform: "uppercase" as const, color: "var(--accent-700)" };
  const box = { width: "100%", boxSizing: "border-box" as const, padding: "9px 11px", border: "1px solid var(--divider)", borderRadius: 10, font: "400 13px/1.45 var(--font-body)", color: "var(--navy)", background: "var(--paper, #fff)", resize: "vertical" as const };

  return (
    <div className="cc-modal-scrim" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(94vw, 640px)", maxHeight: "92vh", overflowY: "auto" }}>
        <div className="cc-modal-title">Block notes · {meso.name}</div>
        <div className="cc-modal-sub">What {athleteName} reads for this block in their app (Block notes on their dashboard).</div>

        <div style={{ marginTop: 16 }}>
          <div style={label}>Loom link</div>
          <input className="cc-db-search" style={{ marginTop: 6, width: "100%" }} placeholder="https://www.loom.com/share/…" value={loomUrl} onChange={(e) => setLoomUrl(e.target.value)} />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={label}>Paste your Loom summary (or transcript)</div>
          <textarea style={{ ...box, marginTop: 6, minHeight: 90 }} placeholder={"E.g. Loom's AI summary, or your own notes. Headings like \"Squat:\" help, but plain sentences work too."} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="cc-mini cc-mini-solid" style={{ marginTop: 8, padding: "8px 14px" }} disabled={!paste.trim()} onClick={autoSplit}>
            ✨ Split automatically into squat / bench / deadlift / accessories
          </button>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {NOTE_SECTIONS.map((s) => (
            <div key={s}>
              <div style={label}>{SECTION_LABEL[s]}</div>
              <textarea
                style={{ ...box, marginTop: 6, minHeight: s === "general" ? 70 : 54 }}
                placeholder={s === "general" ? "Goal of the block, how it's built up, what to focus on…" : `Notes for ${SECTION_LABEL[s].toLowerCase()}…`}
                value={sections[s]}
                onChange={(e) => setSections({ ...sections, [s]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, font: "400 12.5px/1.3 var(--font-body)", color: "var(--navy)", cursor: "pointer" }}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Send {athleteName} a notification
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          {existing && <button className="cc-mini" style={{ color: "var(--bad)" }} onClick={remove}>Remove notes</button>}
          <span style={{ flex: 1 }} />
          <button className="cc-mini" onClick={onClose}>Cancel</button>
          <button className="cc-mini cc-mini-solid" style={{ padding: "0 16px" }} onClick={save}>Save & send</button>
        </div>
      </div>
    </div>
  );
}
