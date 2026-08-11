import { useState } from "react";

/**
 * Drag-and-drop program builder (coach). Implements the "fluent program
 * creation" asks with dependency-free native HTML5 DnD:
 *  - reorder sessions by dragging (labels are positional, so nothing renumbers)
 *  - switch a session's day from a dropdown (one action)
 *  - add / remove rest days between sessions; the week reflows automatically
 *  - drag an exercise from the database panel straight into a session
 */

type IntensityType = "rpe" | "percent" | "relative";
interface BuildRow { id: string; name: string; sets: number; reps: number; itype: IntensityType; ivalue: number; note: string; }
interface BuildSession { id: string; day: string; restAfter: number; rows: BuildRow[]; }

type DragItem =
  | { kind: "session"; index: number }
  | { kind: "exercise"; name: string; cat: string };
let dragItem: DragItem | null = null; // dataTransfer isn't readable during dragover

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "—"];
const uid = () => Math.random().toString(36).slice(2, 9);
const letter = (i: number) => String.fromCharCode(65 + i);
const intensityLabel = (t: IntensityType, v: number) => (t === "rpe" ? `RPE ${v}` : t === "percent" ? `${v}%` : `${v > 0 ? "+" : ""}${v}kg`);

const EX_DB = [
  { name: "Back Squat", cat: "Squat" }, { name: "Front Squat", cat: "Squat" },
  { name: "Competition Bench", cat: "Bench" }, { name: "Close-Grip Bench", cat: "Bench" },
  { name: "Conventional Deadlift", cat: "Deadlift" }, { name: "Sumo Deadlift", cat: "Deadlift" },
  { name: "Romanian Deadlift", cat: "Accessory" }, { name: "Barbell Row", cat: "Accessory" },
  { name: "Overhead Press", cat: "Accessory" }, { name: "Pull-up", cat: "Accessory" },
];

const SEED: BuildSession[] = [
  { id: uid(), day: "Mon", restAfter: 1, rows: [
    { id: uid(), name: "Back Squat", sets: 4, reps: 3, itype: "rpe", ivalue: 8, note: "Belt" },
    { id: uid(), name: "Competition Bench", sets: 3, reps: 4, itype: "rpe", ivalue: 7, note: "2ct pause" },
  ] },
  { id: uid(), day: "Thu", restAfter: 2, rows: [
    { id: uid(), name: "Sumo Deadlift", sets: 3, reps: 2, itype: "rpe", ivalue: 8, note: "" },
    { id: uid(), name: "Close-Grip Bench", sets: 4, reps: 6, itype: "percent", ivalue: 70, note: "" },
  ] },
];

export function ProgramBuilder() {
  const [sessions, setSessions] = useState<BuildSession[]>(SEED);
  const [over, setOver] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const mut = (fn: (s: BuildSession[]) => BuildSession[]) => setSessions((s) => fn(s.map((x) => ({ ...x, rows: [...x.rows] }))));

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    setSessions((s) => {
      const next = [...s];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const addRow = (si: number, name: string) =>
    mut((s) => { s[si].rows.push({ id: uid(), name, sets: 3, reps: 5, itype: "rpe", ivalue: 8, note: "" }); return s; });
  const removeRow = (si: number, rid: string) =>
    mut((s) => { s[si].rows = s[si].rows.filter((r) => r.id !== rid); return s; });
  const patchRow = (si: number, rid: string, patch: Partial<BuildRow>) =>
    mut((s) => { s[si].rows = s[si].rows.map((r) => (r.id === rid ? { ...r, ...patch } : r)); return s; });
  const setDay = (si: number, day: string) => mut((s) => { s[si].day = day; return s; });
  const setRest = (si: number, delta: number) => mut((s) => { s[si].restAfter = Math.max(0, s[si].restAfter + delta); return s; });
  const addSession = () => mut((s) => [...s, { id: uid(), day: "—", restAfter: 1, rows: [] }]);
  const removeSession = (si: number) => mut((s) => s.filter((_, i) => i !== si));

  const onSessionDrop = (targetIndex: number) => {
    if (dragItem?.kind === "session") reorder(dragItem.index, targetIndex);
    else if (dragItem?.kind === "exercise") addRow(targetIndex, dragItem.name);
    dragItem = null; setOver(null); setDragging(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 288px", gap: 22, alignItems: "start" }}>
      <div>
        {sessions.map((s, i) => (
          <div key={s.id}>
            <div
              draggable
              onDragStart={() => { dragItem = { kind: "session", index: i }; setDragging(i); }}
              onDragEnd={() => { dragItem = null; setOver(null); setDragging(null); }}
              onDragOver={(e) => { e.preventDefault(); setOver(i); }}
              onDrop={(e) => { e.preventDefault(); onSessionDrop(i); }}
              className="card"
              style={{
                padding: 0, marginBottom: 4, overflow: "hidden",
                opacity: dragging === i ? 0.45 : 1,
                borderTop: over === i && dragItem?.kind === "session" ? "2px solid var(--accent)" : undefined,
                boxShadow: over === i && dragItem?.kind === "exercise" ? "inset 0 0 0 2px var(--accent)" : undefined,
                transition: "box-shadow .12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "color-mix(in srgb, var(--navy) 6%, transparent)", borderBottom: "1px solid var(--divider)" }}>
                <span title="Drag to reorder" style={{ cursor: "grab", color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>⠿</span>
                <h3 style={{ fontSize: 18 }}>Session {letter(i)}</h3>
                <select className="input" value={s.day} onChange={(e) => setDay(i, e.target.value)}
                  style={{ width: "auto", minHeight: 30, padding: "4px 8px", fontSize: 13 }}>
                  {DAYS.map((d) => <option key={d} value={d}>{d === "—" ? "Unassigned" : d}</option>)}
                </select>
                <span className="muted" style={{ fontSize: 12 }}>{s.rows.length} exercise{s.rows.length === 1 ? "" : "s"}</span>
                <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => removeSession(i)} title="Remove session">Remove</button>
              </div>

              <div style={{ padding: "6px 14px 12px" }}>
                {s.rows.length === 0 && (
                  <div className="muted" style={{ fontSize: 13, padding: "14px 0", textAlign: "center", fontStyle: "italic" }}>
                    Drag an exercise here →
                  </div>
                )}
                {s.rows.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 54px 54px 150px 1fr 24px", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--divider)" }}>
                    <input className="input" value={r.name} onChange={(e) => patchRow(i, r.id, { name: e.target.value })} />
                    <input className="input" value={r.sets} onChange={(e) => patchRow(i, r.id, { sets: +e.target.value || 0 })} title="sets" />
                    <input className="input" value={r.reps} onChange={(e) => patchRow(i, r.id, { reps: +e.target.value || 0 })} title="reps" />
                    <IntensityControl type={r.itype} value={r.ivalue}
                      onType={(t) => patchRow(i, r.id, { itype: t })} onValue={(v) => patchRow(i, r.id, { ivalue: v })} />
                    <input className="input" placeholder="cue / note" value={r.note} onChange={(e) => patchRow(i, r.id, { note: e.target.value })} />
                    <button onClick={() => removeRow(i, r.id)} title="Remove" style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* rest-day control between sessions — reflows the week */}
            <RestControl days={s.restAfter} onAdd={() => setRest(i, 1)} onRemove={() => setRest(i, -1)} last={i === sessions.length - 1} />
          </div>
        ))}

        <button className="btn btn-block" style={{ width: "100%", marginTop: 8 }} onClick={addSession}>+ Add session</button>
      </div>

      <ExercisePalette />
    </div>
  );
}

function IntensityControl({ type, value, onType, onValue }: {
  type: IntensityType; value: number; onType: (t: IntensityType) => void; onValue: (v: number) => void;
}) {
  const opts: [IntensityType, string][] = [["rpe", "RPE"], ["percent", "%"], ["relative", "±"]];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--divider)", borderRadius: 3, overflow: "hidden" }}>
        {opts.map(([t, l]) => (
          <button key={t} onClick={() => onType(t)}
            style={{ padding: "5px 7px", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: type === t ? "var(--accent)" : "transparent", color: type === t ? "#fff" : "var(--muted)" }}>{l}</button>
        ))}
      </div>
      <input className="input" value={value} onChange={(e) => onValue(+e.target.value || 0)} style={{ width: 52, padding: "5px 6px" }} title={intensityLabel(type, value)} />
    </div>
  );
}

function RestControl({ days, onAdd, onRemove, last }: { days: number; onAdd: () => void; onRemove: () => void; last: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0 10px", marginLeft: 14 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: days }, (_, k) => (
          <span key={k} className="tag" style={{ fontSize: 9.5, padding: "3px 7px", opacity: 0.75 }}>Rest</span>
        ))}
        {days === 0 && <span className="muted" style={{ fontSize: 11, fontStyle: "italic" }}>no rest{last ? "" : " → back-to-back"}</span>}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button className="btn btn-sm" style={{ padding: "3px 8px" }} onClick={onRemove} disabled={days === 0}>– rest</button>
        <button className="btn btn-sm" style={{ padding: "3px 8px" }} onClick={onAdd}>+ rest</button>
      </div>
    </div>
  );
}

function ExercisePalette() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const cats = ["All", "Squat", "Bench", "Deadlift", "Accessory"];
  const list = EX_DB.filter((e) => (cat === "All" || e.cat === cat) && e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="card" style={{ position: "sticky", top: 16, padding: 18 }}>
      <div className="kicker" style={{ marginBottom: 12 }}>Exercise database</div>
      <input className="input" placeholder="Search exercises…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "14px 0" }}>
        {cats.map((c) => (
          <button key={c} className="tag" onClick={() => setCat(c)}
            style={{ cursor: "pointer", ...(cat === c ? { color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" } : {}) }}>{c}</button>
        ))}
      </div>
      <div style={{ height: 1, background: "var(--divider)", margin: "4px 0 12px" }} />
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>Drag a movement into a session ↓</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((e) => (
          <div key={e.name} draggable
            onDragStart={() => { dragItem = { kind: "exercise", name: e.name, cat: e.cat }; }}
            onDragEnd={() => { dragItem = null; }}
            style={{ padding: "11px 12px", border: "1px solid var(--divider)", borderRadius: 3, background: "var(--surface)", cursor: "grab", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{e.name}</span>
            <span className="kicker" style={{ fontSize: 9.5 }}>{e.cat}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: "var(--divider)", margin: "16px 0 12px" }} />
      <div className="kicker" style={{ marginBottom: 8 }}>Add to database</div>
      <input className="input" placeholder="Exercise name" style={{ marginBottom: 8 }} />
      <button className="btn btn-sm" style={{ width: "100%" }}>+ Add exercise</button>
    </aside>
  );
}
