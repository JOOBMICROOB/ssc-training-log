import { useEffect, useState } from "react";
import { getCoachTodos, addCoachTodo, toggleCoachTodo, removeCoachTodo, subscribeCoach } from "./coachData";

/**
 * Structured coach notes for one athlete — add, check off, remove. The same store
 * (per athlete, coach-private) backs this everywhere it's opened (Weeks + Clients),
 * so notes stay in sync across the console. Centered overlay.
 */
export function NotesPopup({ athleteId, athleteName, onClose }: { athleteId: string; athleteName: string; onClose: () => void }) {
  const [, force] = useState(0);
  const [draft, setDraft] = useState("");
  useEffect(() => subscribeCoach(() => force((n) => n + 1)), []);

  const todos = getCoachTodos(athleteId);
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  const add = () => { if (draft.trim()) { addCoachTodo(athleteId, draft); setDraft(""); } };

  const Row = ({ t }: { t: (typeof todos)[number] }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--divider)" }}>
      <button
        onClick={() => toggleCoachTodo(athleteId, t.id)}
        title={t.done ? "Mark not done" : "Check off"}
        style={{ flex: "0 0 auto", width: 20, height: 20, marginTop: 1, borderRadius: 6, cursor: "pointer",
          border: `1.5px solid ${t.done ? "var(--good, #4f9d69)" : "rgba(29,31,32,.3)"}`,
          background: t.done ? "var(--good, #4f9d69)" : "transparent", color: "#fff", font: "700 12px/1 var(--font-heading)", display: "grid", placeItems: "center" }}
      >{t.done ? "✓" : ""}</button>
      <span style={{ flex: "1 1 0", font: "400 13px/1.4 var(--font-body)", color: t.done ? "var(--muted)" : "var(--navy)", textDecoration: t.done ? "line-through" : "none", wordBreak: "break-word" }}>{t.text}</span>
      <button onClick={() => removeCoachTodo(athleteId, t.id)} title="Remove" style={{ flex: "0 0 auto", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
    </div>
  );

  return (
    <div className="cc-modal-scrim" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="cc-modal-title">Notes · {athleteName}</div>
        <div className="cc-modal-sub">Your private notes for this athlete — shared across the console (Weeks + Clients).</div>

        <div style={{ display: "flex", gap: 8, margin: "16px 0 4px" }}>
          <input
            className="cc-db-search" style={{ flex: "1 1 0" }} placeholder="Add a note…" value={draft} autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
          <button className="cc-mini cc-mini-solid" style={{ padding: "0 16px" }} onClick={add}>Add</button>
        </div>

        <div style={{ marginTop: 10, maxHeight: "48vh", overflowY: "auto" }}>
          {open.length === 0 && done.length === 0 && <p className="cc-cell-s" style={{ margin: "10px 0" }}>No notes yet.</p>}
          {open.map((t) => <Row key={t.id} t={t} />)}
          {done.length > 0 && (
            <>
              <div className="cc-side-k" style={{ marginTop: 14, marginBottom: 2 }}>Done · {done.length}</div>
              {done.map((t) => <Row key={t.id} t={t} />)}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="cc-mini" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
