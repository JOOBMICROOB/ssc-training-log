import { useState } from "react";
import { loadExercises, addExercise, removeExercise, uid, type ExGroup } from "./coachProgram";

/**
 * Dashboard → Exercises. The shared exercise database — the same store the
 * program builder drags from, so anything added here appears in the builder's
 * database panel (and anything a coach adds while building shows up here).
 */

const GROUPS: (ExGroup | "all")[] = ["all", "squat", "bench", "deadlift", "pull", "accessory"];

export function ExercisesView() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ExGroup | "all">("all");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<ExGroup>("accessory");
  const [video, setVideo] = useState("");

  const all = loadExercises();
  const shown = all.filter((e) => (filter === "all" || e.group === filter) && e.name.toLowerCase().includes(q.toLowerCase()));
  const byGroup = (g: ExGroup) => all.filter((e) => e.group === g).length;

  const add = () => {
    if (!name.trim()) return;
    addExercise({ id: uid("db"), name: name.trim(), group, video: video.trim() || undefined });
    setName("");
    setVideo("");
  };

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Exercise Database</h1>
          <p className="cc-sub">Shared by every coach and linked to the program builder — add an exercise here and it’s available to drag into any program, and vice-versa.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Exercises" v={all.length} />
          <Stat k="Squat" v={byGroup("squat")} />
          <Stat k="Bench" v={byGroup("bench")} />
          <Stat k="Deadlift" v={byGroup("deadlift")} />
        </div>
      </div>

      <div className="cc-plan-grid" style={{ marginTop: 22 }}>
        <div className="cc-panel cc-corner" style={{ position: "relative" }}>
          <i />
          <input className="cc-db-search" placeholder="Search the database" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="cc-db-filters" style={{ margin: "12px 0" }}>
            {GROUPS.map((g) => (
              <button key={g} aria-current={filter === g} onClick={() => setFilter(g)}>{g}</button>
            ))}
          </div>
          <div className="cc-ex-db-grid">
            {shown.map((ex) => (
              <div key={ex.id} className="cc-db-item" style={{ cursor: "default", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cc-db-name">{ex.name}</div>
                  <div className="cc-db-grp">{ex.group}{ex.video ? " · clip" : ""}</div>
                </div>
                <button className="cc-wk-del" title="Remove" onClick={() => { if (confirm(`Remove ${ex.name} from the database?`)) removeExercise(ex.id); }}>×</button>
              </div>
            ))}
            {!shown.length && <div className="cc-cell-s">No matches.</div>}
          </div>
        </div>

        <aside className="cc-panel cc-corner" style={{ position: "relative", alignSelf: "start" }}>
          <i />
          <div className="cc-side-k">Add an exercise</div>
          <div style={{ marginTop: 10 }}>
            <input className="cc-db-search" style={{ marginBottom: 8 }} placeholder="Exercise name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="cc-db-search" style={{ marginBottom: 8 }} value={group} onChange={(e) => setGroup(e.target.value as ExGroup)}>
              {(["squat", "bench", "deadlift", "pull", "accessory"] as ExGroup[]).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input className="cc-db-search" style={{ marginBottom: 10 }} placeholder="Video url (optional)" value={video} onChange={(e) => setVideo(e.target.value)} />
            <button className="cc-fullbtn" style={{ background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} onClick={add}>Save exercise</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v">{v}</div>
    </div>
  );
}
