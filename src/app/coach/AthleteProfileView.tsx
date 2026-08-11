import { useEffect, useState } from "react";
import { getDashboardModel, getDashboard, getSessionFor, setAthleteInfo, setCompPr, setCompTotal, setPrBaseline, markNoteChecked, setWeekLockOff, IPF_CLASSES } from "../../lib/data/athleteData";
import { createAthlete } from "../../lib/auth/coachAuth";
import { fmtKg } from "../../lib/calc/records";
import { renderBwSvgInner, DASH_STYLE } from "../../lib/calc/bwChart";
import { Avatar } from "./Avatar";
import { COACHES, setCoach } from "./coachData";
import type { ClientRow } from "./coachData";

/**
 * Program & Planner → 1 · Athlete. The athlete's full profile for the coach:
 * their real name + photo, every editable number (writes straight to their
 * dashboard + syncs), training numbers, weekly adherence, bodyweight trend,
 * check-in, notes and their latest logged session. Plus a "+ New athlete" tool.
 */

type Sex = "male" | "female";
const REST_WEEK = Array.from({ length: 7 }, () => ({ rest: true, exercises: [] }));
const rnd = (n: number) => Array.from({ length: n }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 30)]).join("");
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDay = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()} ${MON[d.getMonth()]}`; };

function pickPhoto(athleteId: string) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = () => {
    const file = inp.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 220;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const scale = Math.max(size / img.width, size / img.height);
        ctx.drawImage(img, (size - img.width * scale) / 2, (size - img.height * scale) / 2, img.width * scale, img.height * scale);
        setAthleteInfo(athleteId, { avatar: canvas.toDataURL("image/jpeg", 0.82) });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

export function AthleteProfileView({ client, coachUserId, newSignal, roster, onSelect, onRosterChange }: { client: ClientRow; coachUserId: string; newSignal?: number; roster: ClientRow[]; onSelect: (id: string) => void; onRosterChange: () => void }) {
  const [mode, setMode] = useState<"edit" | "new">("edit");
  useEffect(() => { if (newSignal) setMode("new"); }, [newSignal]);

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Athlete · {mode === "edit" ? client.name : "New intake"}</h1>
          <p className="cc-sub">{mode === "edit" ? "Everything you need on one page — edits write straight to their app and sync." : "Create a new athlete with a login that works immediately."}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cc-chip" aria-current={mode === "edit"} onClick={() => setMode("edit")}>Profile</button>
          <button className="cc-chip" aria-current={mode === "new"} onClick={() => setMode("new")}>+ New athlete</button>
        </div>
      </div>

      <div className="cc-athlete-layout">
        <aside className="cc-panel cc-corner cc-athlete-roster">
          <i />
          <div className="cc-side-k">Your athletes · {roster.length}</div>
          <div className="cc-athlete-roster-list">
            {roster.map((c) => (
              <button key={c.athleteId} className={`cc-athlete-menu-item${c.athleteId === client.athleteId && mode === "edit" ? " cc-current" : ""}`} onClick={() => { setMode("edit"); onSelect(c.athleteId); }}>
                <Avatar src={c.avatar} name={c.name} size={28} />
                <span>{c.name}</span>
                {c.live && <span className="cc-pr-badge" style={{ marginLeft: "auto", borderColor: "var(--good)", color: "var(--good)" }}>LIVE</span>}
              </button>
            ))}
          </div>
          <button className="cc-athlete-menu-new" style={{ marginTop: 10 }} onClick={() => setMode("new")}>+ New athlete</button>
        </aside>

        <div>
          {mode === "edit" ? <FullProfile key={client.athleteId} client={client} /> : <NewAthlete coachUserId={coachUserId} onCreated={() => { setMode("edit"); onRosterChange(); }} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="cc-side-k" style={{ marginBottom: 5 }}>{label}</div>{children}</div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="cc-panel cc-corner" style={{ position: "relative" }}><i /><div className="cc-side-k">{title}</div>{children}</div>;
}

/* -------------------------------------------------------------- profile ----- */
function FullProfile({ client }: { client: ClientRow }) {
  const athleteId = client.athleteId;
  const live = client.live;
  const m = getDashboardModel(athleteId);
  const a = m.athlete;
  const cp = m.compPr ?? { squat: "", bench: "", deadlift: "" };
  const prVal = (lift: "squat" | "bench" | "deadlift") => m.prs.find((p) => p.key === lift)?.value ?? "";
  const [sex, setSex] = useState<Sex>(a.sex === "male" ? "male" : "female");
  const [lockOff, setLockOff] = useState<boolean>(getDashboard(athleteId).weekLockOff ?? false);
  const save = (patch: Parameters<typeof setAthleteInfo>[1]) => setAthleteInfo(athleteId, patch);
  const firstDefault = live ? a.firstName : client.name.split(" ")[0];

  return (
    <>
      {/* header + editable fields */}
      <div className="cc-panel cc-corner" style={{ position: "relative" }}>
        <i />
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <Avatar src={client.avatar} name={client.name} size={72} />
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 24px/1 var(--font-heading)", letterSpacing: ".01em", color: "var(--navy)" }}>{client.name}</div>
            <div className="cc-cell-s" style={{ marginTop: 4 }}>{client.city} · {client.competing ? "competing" : "non-competing"} · block {client.block}</div>
            <button className="cc-mini" style={{ marginTop: 9 }} onClick={() => pickPhoto(athleteId)}>Change photo</button>
          </div>
          {live ? <span className="cc-pr-badge" style={{ borderColor: "var(--good)", color: "var(--good)" }}>LIVE</span> : <span className="cc-cell-s">demo — not a real account yet</span>}
        </div>

        <div className="cc-side-k" style={{ marginBottom: 5 }}>Details</div>
        <div className="cc-form-grid">
          <Field label="First name"><input className="cc-db-search" defaultValue={firstDefault} onBlur={(e) => save({ firstName: e.target.value })} /></Field>
          <Field label="Sex">
            <select className="cc-db-search" value={sex} onChange={(e) => { const v = e.target.value as Sex; setSex(v); save({ sex: v }); }}>
              <option value="female">Female</option><option value="male">Male</option>
            </select>
          </Field>
          <Field label="Age"><input className="cc-db-search" defaultValue={a.age} onBlur={(e) => save({ age: e.target.value })} /></Field>
          <Field label="Training age"><input className="cc-db-search" defaultValue={a.trainingAge} onBlur={(e) => save({ trainingAge: e.target.value })} placeholder="4 YR" /></Field>
          <Field label="Goal weight class">
            <select className="cc-db-search" defaultValue={a.goalClass} onChange={(e) => save({ goalClass: e.target.value })}>
              {(IPF_CLASSES[sex] ?? IPF_CLASSES.female).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Bodyweight (nominal)"><input className="cc-db-search" defaultValue={a.bodyweightTile} onBlur={(e) => save({ bodyweightTile: e.target.value })} /></Field>
          <Field label="Coach">
            <select className="cc-db-search" defaultValue={client.coachId} onChange={(e) => setCoach(athleteId, e.target.value)}>
              {COACHES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="cc-side-k" style={{ marginTop: 18, marginBottom: 5 }}>Current PRs (kg) · shows on their dashboard</div>
        <p style={{ font: "400 10px/1.4 var(--font-body)", color: "var(--muted)", margin: "-2px 0 8px" }}>A logged lift heavier than this always takes over automatically.</p>
        <div className="cc-form-grid">
          <Field label="Squat"><input className="cc-db-search" defaultValue={prVal("squat")} onBlur={(e) => setPrBaseline(athleteId, "squat", e.target.value)} placeholder="—" /></Field>
          <Field label="Bench"><input className="cc-db-search" defaultValue={prVal("bench")} onBlur={(e) => setPrBaseline(athleteId, "bench", e.target.value)} placeholder="—" /></Field>
          <Field label="Deadlift"><input className="cc-db-search" defaultValue={prVal("deadlift")} onBlur={(e) => setPrBaseline(athleteId, "deadlift", e.target.value)} placeholder="—" /></Field>
        </div>
        <div className="cc-side-k" style={{ marginTop: 18, marginBottom: 5 }}>Competition bests (kg)</div>
        <div className="cc-form-grid">
          <Field label="Comp squat"><input className="cc-db-search" defaultValue={cp.squat} onBlur={(e) => setCompPr(athleteId, { squat: e.target.value })} /></Field>
          <Field label="Comp bench"><input className="cc-db-search" defaultValue={cp.bench} onBlur={(e) => setCompPr(athleteId, { bench: e.target.value })} /></Field>
          <Field label="Comp deadlift"><input className="cc-db-search" defaultValue={cp.deadlift} onBlur={(e) => setCompPr(athleteId, { deadlift: e.target.value })} /></Field>
          <Field label="Best comp total"><input className="cc-db-search" defaultValue={m.totals.comp === "—" ? "" : m.totals.comp} onBlur={(e) => setCompTotal(athleteId, e.target.value.trim() || "—", e.target.value.trim() ? "Coach-entered" : "First competition still to come")} /></Field>
        </div>
        <div className="cc-side-k" style={{ marginTop: 18, marginBottom: 5 }}>Coaching controls</div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!lockOff}
            style={{ marginTop: 2 }}
            onChange={(e) => { const on = e.target.checked; setLockOff(!on); setWeekLockOff(athleteId, !on); }}
          />
          <span>
            <span style={{ font: "600 12px/1.2 var(--font-body)", color: "var(--navy)" }}>Week-lock (motivate logging)</span>
            <span style={{ display: "block", font: "400 10.5px/1.45 var(--font-body)", color: "var(--muted)", marginTop: 2 }}>
              Blurs next week for {a.firstName} until they keep this week ≥50% logged. Turn off for athletes who don't need the nudge.
            </span>
          </span>
        </label>
        {!live && <p className="cc-cell-s" style={{ marginTop: 12 }}>This is a demo entry — the training panels below fill in once they’re a real synced account (create one with “+ New athlete”).</p>}
      </div>

      <AthletePanels client={client} />
    </>
  );
}

/**
 * The athlete's training variables as a grid of panels — reused both on the
 * profile page and inside the Client Board's expanded row so they read the same.
 */
export function AthletePanels({ client }: { client: ClientRow }) {
  const athleteId = client.athleteId;
  const live = client.live;
  const m = getDashboardModel(athleteId);
  const history = live ? m.adherenceHistory.slice(-10) : [];
  const latest = live ? latestSession(athleteId) : null;
  const scores = client.checkin;

  return (
      <div className="cc-profile-grid">
        <Panel title="Training numbers">
          <div className="cc-view-lift-grid" style={{ marginTop: 10 }}>
            {client.prs.length ? client.prs.map((p) => (
              <div key={p.lift}><span className="cc-vlk">{p.lift}</span><span className="cc-vlv">{p.value}<em> kg</em></span></div>
            )) : <div className="cc-cell-s">No PRs logged yet.</div>}
            {live && <>
              <div><span className="cc-vlk">Gym total</span><span className="cc-vlv">{m.totals.gym}<em> kg</em></span></div>
              <div><span className="cc-vlk">Comp total</span><span className="cc-vlv">{m.totals.comp === "—" ? "—" : `${m.totals.comp}`}<em>{m.totals.comp === "—" ? "" : " kg"}</em></span></div>
              <div><span className="cc-vlk">IPF GL · now / best</span><span className="cc-vlv">{m.gl.current} / {m.gl.best}</span></div>
            </>}
          </div>
        </Panel>

        <Panel title="Adherence · weekly">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 90, marginTop: 12 }}>
            {history.length === 0 && <div className="cc-cell-s">{live ? "No completed weeks yet." : "—"}</div>}
            {history.map((h, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={`${fmtDay(h.weekStart)} · ${h.percent}%`}>
                <div style={{ width: "100%", background: "color-mix(in srgb, var(--accent) 55%, transparent)", borderRadius: "3px 3px 0 0", height: `${Math.max(4, h.percent)}%` }} />
                <span style={{ font: "500 7.5px/1 var(--font-body)", color: "var(--muted)" }}>{h.percent}</span>
              </div>
            ))}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title="this week so far">
              <div style={{ width: "100%", background: "var(--navy)", borderRadius: "3px 3px 0 0", height: `${Math.max(4, client.adherence)}%` }} />
              <span style={{ font: "600 7.5px/1 var(--font-body)", color: "var(--navy)" }}>{client.adherence}</span>
            </div>
          </div>
          <div className="cc-cell-s" style={{ marginTop: 8 }}>Each week resets on their training week; the last bar (navy) is this week so far.</div>
        </Panel>

        <Panel title="Bodyweight trend">
          <div style={{ font: "600 24px/1 var(--font-heading)", color: "var(--navy)", marginTop: 8 }}>{m.bw.currentLabel}</div>
          <div className="cc-cell-s">{client.bodyweight.delta}</div>
          {m.bw.last ? (
            <div style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 320 130" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:auto;">${renderBwSvgInner(m.bw, DASH_STYLE)}</svg>` }} />
          ) : (
            <div className="cc-cell-s" style={{ marginTop: 12 }}>No weigh-ins yet.</div>
          )}
        </Panel>

        <Panel title="Weekly check-in">
          {[["Sleep", scores.sleep], ["Nutrition", scores.nutrition], ["Stress", scores.stress], ["Motivation", scores.motivation], ["Pain", scores.pain]].map(([k, v]) => (
            <div key={k as string} className="cc-checkin-row">
              <span className="cc-ck-lab">{k}</span>
              <div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${(v as number) * 10}%`, background: "var(--navy)" }} /></div>
              <span className="cc-ck-val">{v}/10</span>
            </div>
          ))}
        </Panel>

        <Panel title="Notes from athlete">
          <div className="cc-cell-s" style={{ marginTop: 8 }}>Last logged: <strong style={{ color: "var(--navy)" }}>{client.lastLogged.what}</strong> · {client.lastLogged.when}</div>
          {client.notes.length === 0 && <div className="cc-cell-s" style={{ marginTop: 8 }}>No notes sent yet.</div>}
          {client.notes.map((n) => (
            <div key={n.id} className="cc-msg-box" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="cc-d-k">{fmtDay(n.date)}</span>
                {n.checkedAt
                  ? <span className="cc-cell-s" style={{ color: "var(--good)" }}>read · {fmtDay(n.checkedAt)}</span>
                  : <button className="cc-mini cc-mini-solid" onClick={() => markNoteChecked(client.athleteId, n.id)}>Mark read</button>}
              </div>
              <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.45, color: "var(--navy)" }}>{n.text}</div>
            </div>
          ))}
        </Panel>

        {live && latest && (
          <Panel title={`Latest session · ${fmtDay(latest.date)}`}>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {latest.session.exercises.map((ex, i) => (
                <div key={i}>
                  <div style={{ font: "600 13px/1.1 var(--font-heading)", color: "var(--navy)" }}>{ex.name}</div>
                  <div className="cc-cell-s" style={{ marginTop: 2 }}>{ex.sets.map((s) => (s.weightKg != null ? `${fmtKg(s.weightKg)}${s.rpe != null ? `@${s.rpe}` : ""}` : "—")).join(" · ")}</div>
                </div>
              ))}
              {latest.session.exercises.length === 0 && <div className="cc-cell-s">Rest day.</div>}
            </div>
          </Panel>
        )}
      </div>
  );
}


function latestSession(athleteId: string) {
  const d = getDashboard(athleteId);
  const dates = Object.keys(d.programLogs ?? {}).filter((k) => Object.keys(d.programLogs?.[k]?.sets ?? {}).length > 0).sort();
  const last = dates[dates.length - 1];
  if (!last) return null;
  return { date: last, session: getSessionFor(athleteId, last) };
}

/* ----------------------------------------------------------------- new ----- */
function NewAthlete({ coachUserId, onCreated }: { coachUserId: string; onCreated: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [sex, setSex] = useState<Sex>("female");
  const [age, setAge] = useState("");
  const [trainingAge, setTrainingAge] = useState("");
  const [bw, setBw] = useState("");
  const [squatPr, setSquatPr] = useState("");
  const [benchPr, setBenchPr] = useState("");
  const [deadPr, setDeadPr] = useState("");
  const [goalClass, setGoalClass] = useState(IPF_CLASSES.female[3]);
  const [id, setId] = useState("");
  const [password, setPassword] = useState(rnd(8));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const suggestId = () => setId(((first[0] ?? "") + (last[0] ?? "")).toUpperCase() + String(100 + Math.floor(Math.random() * 900)));

  const create = async () => {
    if (!first.trim()) return setMsg({ ok: false, text: "Enter at least a first name." });
    if (!id.trim() || id.trim().length < 3) return setMsg({ ok: false, text: "Give them an ID of at least 3 characters." });
    if (password.length < 6) return setMsg({ ok: false, text: "Password must be at least 6 characters." });
    setBusy(true);
    setMsg(null);
    const name = `${first.trim()} ${last.trim()}`.trim();
    // Fully blank slate — explicit empty values so nothing inherits the seed
    // (Renée's) defaults. Block name, bodyweight, PRs and totals all start empty
    // until the coach or the athlete enters them.
    const state = {
      athlete: { firstName: first.trim().toUpperCase(), sex, age: age.trim(), goalClass, bodyweightTile: "—", trainingAge: trainingAge.trim() || "0 YR", welcomeSub: "Welcome — your coach is setting up your program." },
      program: { blockName: "" },
      programWeek: REST_WEEK,
      publishedWeeks: {},
      programLogs: {},
      prs: [
        squatPr.trim() && { lift: "SQUAT", key: "squat", value: squatPr.trim(), date: "", delta: "+0" },
        benchPr.trim() && { lift: "BENCH PRESS", key: "bench", value: benchPr.trim(), date: "", delta: "+0" },
        deadPr.trim() && { lift: "DEADLIFT", key: "deadlift", value: deadPr.trim(), date: "", delta: "+0" },
      ].filter(Boolean),
      compPr: { squat: "", bench: "", deadlift: "" },
      bwEntries: [],
      totals: { gym: "—", gymDelta: "", comp: "—", compNote: "First competition still to come" },
      gl: { current: "—", best: "—", note: "" },
      adherenceHistory: [],
      lastSnapshotWeek: null,
      optedInComps: [],
      blockStart: null,
    };
    const res = await createAthlete({ id: id.trim(), password, name, coachUserId, state });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `${name} is set up. Hand them ID “${id.trim().toUpperCase()}” and password “${password}”. They can log in now.` });
      onCreated();
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not create the account." });
    }
  };

  return (
    <div className="cc-plan-grid">
      <div className="cc-panel cc-corner" style={{ position: "relative" }}>
        <i />
        <div className="cc-side-k">Details</div>
        <div className="cc-form-grid" style={{ marginTop: 12 }}>
          <Field label="First name"><input className="cc-db-search" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Last name"><input className="cc-db-search" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
          <Field label="Sex">
            <select className="cc-db-search" value={sex} onChange={(e) => { const v = e.target.value as Sex; setSex(v); setGoalClass((IPF_CLASSES[v] ?? IPF_CLASSES.female)[3]); }}>
              <option value="female">Female</option><option value="male">Male</option>
            </select>
          </Field>
          <Field label="Age"><input className="cc-db-search" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
          <Field label="Training age"><input className="cc-db-search" value={trainingAge} onChange={(e) => setTrainingAge(e.target.value)} placeholder="4 YR" /></Field>
          <Field label="Bodyweight"><input className="cc-db-search" value={bw} onChange={(e) => setBw(e.target.value)} placeholder="68" /></Field>
          <Field label="Goal weight class">
            <select className="cc-db-search" value={goalClass} onChange={(e) => setGoalClass(e.target.value)}>
              {(IPF_CLASSES[sex] ?? IPF_CLASSES.female).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="cc-side-k" style={{ marginTop: 16 }}>Current PRs (kg) · optional</div>
        <p style={{ font: "400 10px/1.4 var(--font-body)", color: "var(--muted)", margin: "4px 0 10px" }}>Starting numbers — a logged lift heavier than this always takes over automatically.</p>
        <div className="cc-form-grid">
          <Field label="Squat"><input className="cc-db-search" value={squatPr} onChange={(e) => setSquatPr(e.target.value)} placeholder="—" /></Field>
          <Field label="Bench"><input className="cc-db-search" value={benchPr} onChange={(e) => setBenchPr(e.target.value)} placeholder="—" /></Field>
          <Field label="Deadlift"><input className="cc-db-search" value={deadPr} onChange={(e) => setDeadPr(e.target.value)} placeholder="—" /></Field>
        </div>
      </div>

      <aside className="cc-panel cc-corner" style={{ position: "relative" }}>
        <i />
        <div className="cc-side-k">Login credentials</div>
        <p style={{ font: "400 10.5px/1.4 var(--font-body)", color: "var(--muted)", margin: "6px 0 12px" }}>The athlete signs in with this ID + password. Hand them over in person.</p>
        <Field label="ID / username">
          <div style={{ display: "flex", gap: 6 }}>
            <input className="cc-db-search" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="e.g. BD204" />
            <button className="cc-mini" onClick={suggestId}>Suggest</button>
          </div>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Password">
          <div style={{ display: "flex", gap: 6 }}>
            <input className="cc-db-search" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="cc-mini" onClick={() => setPassword(rnd(8))}>New</button>
          </div>
        </Field>
        <button className="cc-fullbtn" style={{ marginTop: 18, background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} disabled={busy} onClick={create}>{busy ? "Creating…" : "Create account"}</button>
        {msg && <div style={{ marginTop: 12, font: "500 12px/1.5 var(--font-body)", color: msg.ok ? "var(--good)" : "var(--bad)" }}>{msg.text}</div>}
      </aside>
    </div>
  );
}
