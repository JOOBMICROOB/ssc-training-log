import { useMemo, useState } from "react";
import {
  getCompetitions,
  getClients,
  toggleOpt,
  addCompetition,
  updateCompetition,
  removeCompetition,
  type Competition,
  type ClientRow,
} from "./coachData";
import { resetCompetitionsToDefault } from "../../lib/data/athleteData";

/**
 * Competing → Calendar. The coach-managed meet list (shared to every athlete's
 * Competitions page) plus who's opted in. Opt-ins land here the moment an athlete
 * flips the toggle in their app; the coach can opt athletes in or out (the only
 * side that can withdraw an entry). Filter national / international / with opt-ins.
 */

type Filter = "all" | "national" | "international" | "optins" | "archive";
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function weeksOut(date: string): number {
  const a = new Date(isoToday() + "T00:00:00");
  const b = new Date(date + "T00:00:00");
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (7 * 864e5)));
}
const weeksLabel = (w: number) => (w <= 0 ? "this week" : `${w} week${w === 1 ? "" : "s"} out`);
const fmtBadge = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return { day: d.getDate(), mon: MON[d.getMonth()] };
};

export function CompetingView({ coachId }: { coachId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const comps = getCompetitions();
  const clients = getClients(coachId);

  const rosterFor = (compId: string): ClientRow[] =>
    clients.filter((c) => c.opts.find((o) => o.id === compId)?.opted);

  // Past meets drop out of the calendar into the archive.
  const today = isoToday();
  const isPast = (c: Competition) => c.date < today;
  const active = comps.filter((c) => !isPast(c));

  const shown = useMemo(() => {
    if (filter === "archive") return comps.filter(isPast);
    return active.filter((c) => {
      if (filter === "national") return c.level === "national";
      if (filter === "international") return c.level === "international";
      if (filter === "optins") return rosterFor(c.id).length > 0;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comps, filter, clients]);

  const counts = {
    all: active.length,
    national: active.filter((c) => c.level === "national").length,
    international: active.filter((c) => c.level === "international").length,
    optins: active.filter((c) => rosterFor(c.id).length > 0).length,
    archive: comps.filter(isPast).length,
  };

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Competition Calendar</h1>
          <p className="cc-sub">Opt-ins land here the moment an athlete flips the toggle in their app. Add meets that reach every athlete; opt athletes in or out yourself.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cc-mini" style={{ padding: "11px 14px", fontSize: 11 }} onClick={() => { if (confirm("Load the built-in default calendar? This replaces the current meet list for everyone.")) resetCompetitionsToDefault(); }}>Load default calendar</button>
          <button className="cc-mini cc-mini-solid" style={{ padding: "11px 16px", fontSize: 11 }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "+ New meet"}
          </button>
        </div>
      </div>

      {adding && <MeetForm onSave={(c) => { addCompetition(c); setAdding(false); }} onCancel={() => setAdding(false)} />}

      <div className="cc-chips">
        {([["all", `All ${counts.all}`], ["national", `National ${counts.national}`], ["international", `International ${counts.international}`], ["optins", `With opt-ins ${counts.optins}`], ["archive", `📁 Archive ${counts.archive}`]] as const).map(([f, label]) => (
          <button key={f} className="cc-chip" aria-current={filter === f} onClick={() => setFilter(f as Filter)}>{label}</button>
        ))}
      </div>
      {filter === "archive" && <div className="cc-cell-s" style={{ marginTop: 10 }}>Past meets — kept for reference. They no longer show in athletes' calendars.</div>}

      <div className="cc-compete-grid">
        {/* meets */}
        <div>
          {shown.map((c) => {
            const roster = rosterFor(c.id);
            const notOpted = clients.filter((cl) => !roster.includes(cl));
            const b = fmtBadge(c.date);
            const editing = editingId === c.id;
            return (
              <div key={c.id} className={`cc-meet${roster.length ? " cc-meet-live" : ""}`}>
                {editing ? (
                  <MeetForm initial={c} onSave={(patch) => { updateCompetition(c.id, patch); setEditingId(null); }} onCancel={() => setEditingId(null)} />
                ) : (
                  <>
                    <div className="cc-meet-head">
                      <div className="cc-meet-date"><span className="cc-meet-day">{b.day}</span><span className="cc-meet-mon">{b.mon}</span></div>
                      <div style={{ flex: 1 }}>
                        <div className="cc-meet-name">{c.name}
                          <span className={`cc-level ${c.level === "international" ? "cc-level-int" : "cc-level-nat"}`}>{c.level === "international" ? "INTERNATIONAL" : "NATIONAL"}</span>
                        </div>
                        <div className="cc-meet-loc">{c.location} · {weeksLabel(weeksOut(c.date))}</div>
                        {c.note && <div className="cc-cell-s" style={{ marginTop: 4, fontStyle: "italic" }}>{c.note}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="cc-xbtn" onClick={() => setEditingId(c.id)}>Edit</button>
                        <button className="cc-xbtn" onClick={() => { if (confirm(`Remove ${c.name} from the calendar? Every athlete loses it.`)) removeCompetition(c.id); }}>Remove</button>
                      </div>
                    </div>

                    <div className="cc-meet-roster">
                      <div className="cc-side-k" style={{ margin: "2px 0 8px" }}>{roster.length ? `${roster.length} athlete${roster.length === 1 ? "" : "s"} opted in` : "Nobody opted in yet"}</div>
                      <div className="cc-chip-row">
                        {roster.map((a) => (
                          <span key={a.athleteId} className="cc-athlete-tag">
                            {a.name}
                            <button title="Opt out" onClick={() => toggleOpt(a.athleteId, c.id, false)}>×</button>
                          </span>
                        ))}
                        {pickerFor === c.id ? (
                          <select
                            className="cc-day-select"
                            autoFocus
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) toggleOpt(e.target.value, c.id, true); setPickerFor(null); }}
                            onBlur={() => setPickerFor(null)}
                          >
                            <option value="" disabled>Add an athlete…</option>
                            {notOpted.map((a) => <option key={a.athleteId} value={a.athleteId}>{a.name}</option>)}
                          </select>
                        ) : (
                          <button className="cc-add-tag" onClick={() => setPickerFor(c.id)}>+ Opt an athlete in</button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {!shown.length && <div className="cc-cell-s" style={{ marginTop: 20 }}>No meets match this filter.</div>}
        </div>

        {/* who is competing */}
        <aside className="cc-panel cc-corner" style={{ position: "sticky", top: 96, alignSelf: "start" }}>
          <i />
          <div className="cc-side-k">Who is competing</div>
          <div style={{ marginTop: 10 }}>
            {comps.map((c) => {
              const n = rosterFor(c.id).length;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid var(--divider)" }}>
                  <div>
                    <div style={{ font: "600 12px/1.2 var(--font-heading)", color: "var(--navy)" }}>{c.name}</div>
                    <div style={{ font: "400 9px/1 var(--font-body)", letterSpacing: ".06em", color: "var(--muted)", marginTop: 2 }}>{fmtBadge(c.date).day} {fmtBadge(c.date).mon} · {c.level === "international" ? "INT" : "NAT"}</div>
                  </div>
                  <div style={{ font: "600 18px/1 var(--font-heading)", color: n ? "var(--navy)" : "var(--muted)" }}>{n}</div>
                </div>
              );
            })}
          </div>
          <p style={{ font: "400 10px/1.4 var(--font-body)", color: "var(--muted)", marginTop: 12 }}>Athletes opt in from their own calendar; the count updates here. Only you can opt someone out.</p>
        </aside>
      </div>
    </div>
  );
}

// --- add / edit meet form ----------------------------------------------------
function MeetForm({ initial, onSave, onCancel }: { initial?: Competition; onSave: (c: Competition) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [level, setLevel] = useState<Competition["level"]>(initial?.level ?? "national");
  const [note, setNote] = useState(initial?.note ?? "");

  const save = () => {
    if (!name.trim() || !date) { alert("A meet needs at least a name and a date."); return; }
    onSave({
      id: initial?.id ?? `comp_${Date.now().toString(36)}`,
      name: name.trim(),
      date,
      location: location.trim() || "TBD",
      level,
      going: initial?.going ?? 0,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <div className="cc-panel cc-corner" style={{ margin: "8px 0 16px", display: "grid", gridTemplateColumns: "2fr 1fr 2fr 1.2fr", gap: 10, alignItems: "end" }}>
      <i />
      <div><div className="cc-side-k">Meet name</div><input className="cc-db-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="VK Open & Masters" /></div>
      <div><div className="cc-side-k">Date</div><input className="cc-db-search" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div><div className="cc-side-k">Location</div><input className="cc-db-search" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Power Gym (Izegem)" /></div>
      <div><div className="cc-side-k">Level</div>
        <select className="cc-db-search" value={level} onChange={(e) => setLevel(e.target.value as Competition["level"])}>
          <option value="national">National</option>
          <option value="international">International</option>
        </select>
      </div>
      <div style={{ gridColumn: "1 / -1" }}><div className="cc-side-k">Requirements / note (optional)</div><input className="cc-db-search" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. minima in laatste 12 maanden" /></div>
      <div style={{ display: "flex", gap: 6, gridColumn: "1 / -1" }}>
        <button className="cc-mini cc-mini-solid" onClick={save}>{initial ? "Save" : "Add"}</button>
        <button className="cc-mini" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
