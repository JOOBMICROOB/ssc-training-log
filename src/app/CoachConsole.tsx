import { useEffect, useMemo, useState } from "react";
import "./coach/coach.css";
import { ProgramBuilder } from "./coach/ProgramBuilder";
import { ProgramViewer } from "./coach/ProgramViewer";
import { CompetingView } from "./coach/CompetingView";
import { BlockPlanView } from "./coach/BlockPlanView";
import { AthleteProfileView, AthletePanels } from "./coach/AthleteProfileView";
import { ExercisesView } from "./coach/ExercisesView";
import { ShopView } from "./coach/ShopView";
import { AttemptsView } from "./coach/AttemptsView";
import { WeeksGridView } from "./coach/WeeksGridView";
import { Avatar } from "./coach/Avatar";
import {
  COACHES,
  getClients,
  teamSummary,
  setCoachNote,
  setHideMaxes,
  toggleOpt,
  subscribeCoach,
  setRealAthletes,
  type ClientRow,
  type Coach,
} from "./coach/coachData";
import { getCoachSession, signInCoach, signOutCoach, startCoachSync, type CoachSession } from "../lib/auth/coachAuth";

/**
 * Coach desktop console (/coach). Rebuilt from Noa's Claude Design coach frames
 * in the shared app identity (navy/Barlow blueprint), convention-first. The one
 * real athlete (Renée) is wired to the live athlete data service, so what the
 * coach sees and edits here is the same data the phone app reads.
 *
 * Built page-by-page. Live now: Dashboard → Team + Clients. The remaining tabs
 * render an on-brand placeholder until each is built out.
 */

type Heading = "dashboard" | "program" | "competing";
const HEADINGS: [Heading, string][] = [
  ["dashboard", "Dashboard"],
  ["program", "Program & Planner"],
  ["competing", "Competing"],
];
const SUBNAV: Record<Heading, [string, string][]> = {
  dashboard: [["team", "Team"], ["clients", "Clients"], ["weeks", "Weeks"], ["exercises", "Exercises"], ["shop", "Shop"]],
  program: [["athlete", "1 · Athlete"], ["calendar", "2 · Calendar & Block Plan"], ["program", "3 · Program"]],
  competing: [["calendar", "Calendar"], ["attempts", "Attempts"]],
};

function useForceRender() {
  const [, set] = useState(0);
  useEffect(() => subscribeCoach(() => set((n) => n + 1)), []);
}

/** Auth gate: the console only renders once a coach is signed into Supabase. */
export function CoachConsole() {
  const [session, setSession] = useState<CoachSession | null | "loading">("loading");

  const load = () =>
    getCoachSession().then((s) => {
      setSession(s);
      if (s) void startCoachSync(s.userId).then((list) => setRealAthletes(list.map((a) => ({ ...a, coachId: s.code }))));
    });
  useEffect(() => { void load(); }, []);

  if (session === "loading") {
    return <div className="cc" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--muted)" }}>Loading…</div>;
  }
  if (!session) return <CoachLogin onSignedIn={load} />;
  return <ConsoleShell session={session} onSignOut={async () => { await signOutCoach(); setSession(null); }} />;
}

function CoachLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signInCoach(email, password);
    setBusy(false);
    if (res.ok) onSignedIn();
    else setError(res.error ?? "Sign-in failed.");
  };

  return (
    <div className="cc" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form onSubmit={submit} className="cc-panel cc-corner" style={{ width: 340, padding: 28 }}>
        <i />
        <img src="/assets/logo-emblem-white.png" alt="" style={{ height: 26, filter: "invert(1)", opacity: 0.8 }} />
        <div style={{ font: "600 22px/1 var(--font-heading)", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--navy)", marginTop: 14 }}>Coach Console</div>
        <div className="cc-sub" style={{ marginTop: 6 }}>Sign in to manage your athletes.</div>
        <label className="cc-side-k" style={{ display: "block", marginTop: 18 }}>Email</label>
        <input className="cc-db-search" style={{ marginTop: 4 }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="noa@ssc.app" />
        <label className="cc-side-k" style={{ display: "block", marginTop: 12 }}>Password</label>
        <input className="cc-db-search" style={{ marginTop: 4 }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={{ marginTop: 12, color: "var(--bad)", font: "500 12px/1.4 var(--font-body)" }}>{error}</div>}
        <button className="cc-fullbtn" style={{ marginTop: 18, background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const NAV_KEY = "ssc.coach.nav";
const navToday = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** Resume the coach's last page on reopen, unless a new day has begun. */
function restoreNav(): { heading: Heading; sub: string } {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { heading?: Heading; sub?: string; date?: string };
      if (s.date === navToday() && s.heading && s.sub && SUBNAV[s.heading]?.some(([k]) => k === s.sub)) {
        return { heading: s.heading, sub: s.sub };
      }
    }
  } catch {
    /* ignore */
  }
  return { heading: "dashboard", sub: "team" };
}

function ConsoleShell({ session, onSignOut }: { session: CoachSession; onSignOut: () => void }) {
  useForceRender();
  const [coachId, setCoachId] = useState<Coach["id"]>("noa");
  const [heading, setHeading] = useState<Heading>(() => restoreNav().heading);
  const [sub, setSub] = useState<string>(() => restoreNav().sub);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [programView, setProgramView] = useState<"view" | "build">("view");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [newAthleteSignal, setNewAthleteSignal] = useState(0);

  // Remember the current page + day so a reopen resumes it (fresh each new day).
  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify({ heading, sub, date: navToday() }));
    } catch {
      /* storage may be unavailable */
    }
  }, [heading, sub]);

  const coach = COACHES.find((c) => c.id === coachId)!;
  const allClients = getClients();
  // The logged-in coach's OWN athletes drive the program pages + switcher; the
  // client board can still filter to other coaches for the head-coach overview.
  const myCoach = session.code;
  const myAthletes = allClients.filter((c) => c.coachId === myCoach);
  const selected =
    allClients.find((c) => c.athleteId === selectedId) ??
    myAthletes[0] ??
    allClients[0];

  const go = (h: Heading) => {
    setHeading(h);
    setSub(SUBNAV[h][0][0]);
  };
  const openProgram = (athleteId: string) => {
    setSelectedId(athleteId);
    setHeading("program");
    setSub("program");
    setProgramView("view");
  };
  const openAthlete = (athleteId: string) => {
    setSelectedId(athleteId);
    setHeading("program");
    setSub("athlete");
  };

  return (
    <div className="cc">
      <header className="cc-bar">
        <div className="cc-brand">
          <img className="cc-emblem" src="/assets/logo-emblem-white.png" alt="" />
          <span className="cc-brand-txt">COACH CONSOLE</span>
        </div>
        <nav className="cc-seg cc-center">
          {HEADINGS.map(([h, label]) => (
            <button key={h} className="cc-tab" aria-current={heading === h} onClick={() => go(h)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="cc-athlete-switch">
          <button className="cc-athlete-chip" onClick={() => setPickerOpen((o) => !o)} title="Switch athlete">
            <div className="cc-chip-meta">
              <div className="cc-chip-kicker">ATHLETE</div>
              <div className="cc-chip-name">{selected?.name ?? "—"} <span style={{ opacity: 0.6 }}>▾</span></div>
            </div>
            <Avatar src={selected?.avatar} name={selected?.name ?? "?"} size={30} />
          </button>
          {pickerOpen && (
            <>
              <div className="cc-picker-backdrop" onClick={() => setPickerOpen(false)} />
              <div className="cc-athlete-menu">
                <input className="cc-db-search" autoFocus placeholder="Search athletes…" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} />
                <div className="cc-athlete-menu-list">
                  {myAthletes
                    .filter((c) => c.name.toLowerCase().includes(pickerQ.toLowerCase()))
                    .map((c) => (
                      <button
                        key={c.athleteId}
                        className={`cc-athlete-menu-item${c.athleteId === selected?.athleteId ? " cc-current" : ""}`}
                        onClick={() => { setSelectedId(c.athleteId); setPickerOpen(false); setPickerQ(""); }}
                      >
                        <Avatar src={c.avatar} name={c.name} size={26} />
                        <span>{c.name}</span>
                        {c.live && <span className="cc-pr-badge" style={{ marginLeft: "auto", borderColor: "var(--good)", color: "var(--good)" }}>LIVE</span>}
                      </button>
                    ))}
                </div>
                <button className="cc-athlete-menu-new" onClick={() => { setPickerOpen(false); setHeading("program"); setSub("athlete"); setNewAthleteSignal((n) => n + 1); }}>+ New athlete</button>
              </div>
            </>
          )}
        </div>
        <div className="cc-coach-pill">
          <img src="/assets/coach-noa.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span className="cc-coach-name">{coach.name.toUpperCase()}</span>
          <button className="cc-signout" title="Sign out" onClick={onSignOut}>⏻</button>
        </div>
      </header>

      <div className="cc-subnav">
        {SUBNAV[heading].map(([s, label]) => (
          <button key={s} className="cc-subtab" aria-current={sub === s} onClick={() => { setSub(s); if (s === "program") setProgramView("view"); }}>
            <span className="cc-dot">·</span>
            {label}
          </button>
        ))}
      </div>

      {heading === "dashboard" && sub === "team" && (
        <TeamView onSeeCoach={(id) => { setCoachId(id); setSub("clients"); }} />
      )}
      {heading === "dashboard" && sub === "clients" && (
        <ClientsView coachId={coachId} setCoachId={setCoachId} onOpenProgram={openProgram} onOpenAthlete={openAthlete} onSelect={setSelectedId} />
      )}
      {heading === "dashboard" && sub === "weeks" && (
        <WeeksGridView coachId={coachId} onOpenProgram={openProgram} onSelect={setSelectedId} />
      )}
      {heading === "dashboard" && sub === "exercises" && <ExercisesView />}
      {heading === "dashboard" && sub === "shop" && <ShopView coachId={myCoach} />}
      {heading === "program" && sub === "program" && selected && programView === "view" && (
        <ProgramViewer
          key={selected.athleteId}
          athleteId={selected.athleteId}
          athleteName={selected.name}
          avatar={selected.avatar}
          live={selected.live}
          onOpenBuilder={() => setProgramView("build")}
        />
      )}
      {heading === "program" && sub === "program" && selected && programView === "build" && (
        <ProgramBuilder
          key={selected.athleteId}
          athleteId={selected.athleteId}
          athleteName={selected.name}
          avatar={selected.avatar}
          live={selected.live}
          coachName={session.name}
          onBack={() => setProgramView("view")}
        />
      )}
      {heading === "program" && sub === "calendar" && selected && (
        <BlockPlanView
          key={selected.athleteId}
          athleteId={selected.athleteId}
          athleteName={selected.name}
          avatar={selected.avatar}
          onOpenBuilder={() => { setSub("program"); setProgramView("build"); }}
        />
      )}
      {heading === "program" && sub === "athlete" && selected && (
        <AthleteProfileView
          client={selected}
          coachUserId={session.userId}
          newSignal={newAthleteSignal}
          roster={myAthletes}
          onSelect={setSelectedId}
          onRosterChange={() => void startCoachSync(session.userId).then((list) => setRealAthletes(list.map((a) => ({ ...a, coachId: session.code }))))}
        />
      )}
      {heading === "competing" && sub === "calendar" && <CompetingView coachId={myCoach} />}
      {heading === "competing" && sub === "attempts" && selected && (
        <AttemptsView key={selected.athleteId} athleteId={selected.athleteId} athleteName={selected.name} avatar={selected.avatar} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Team --- */
function TeamView({ onSeeCoach }: { onSeeCoach: (coachId: string) => void }) {
  const summary = teamSummary();
  const totals = {
    athletes: summary.reduce((s, r) => s + r.count, 0),
    coaches: COACHES.length,
    competing: summary.reduce((s, r) => s + r.competing, 0),
    flagged: summary.reduce((s, r) => s + r.flagged, 0),
  };

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Team Overview</h1>
          <p className="cc-sub">Head-coach view: headcount, adherence and who needs a week written. Programs themselves stay with the coach who wrote them.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Athletes in the system" v={totals.athletes} />
          <Stat k="Coaches" v={totals.coaches} />
          <Stat k="Competing" v={totals.competing} />
          <Stat k="Flagged this week" v={totals.flagged} />
        </div>
      </div>

      <div className="cc-team-grid">
        {summary.map(({ coach, count, competing, avgAdherence, dueSoon, flagged, names }) => (
          <div key={coach.id} className="cc-panel cc-corner cc-team-card">
            <i />
            <div className="cc-team-top">
              <div>
                <div className="cc-team-name">{coach.name}</div>
                <div className="cc-team-sub">Athletes · {count ? `${competing} competing` : "no athletes assigned yet"}</div>
              </div>
              <div className="cc-team-count">{count}</div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="cc-team-sub">Avg adherence</div>
              <div className="cc-metric-row" style={{ marginTop: 6 }}>
                <div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${avgAdherence}%` }} /></div>
                <div style={{ font: "600 15px/1 var(--font-heading)", color: "var(--navy)", minWidth: 40 }}>{count ? `${avgAdherence}%` : "—"}</div>
              </div>
            </div>
            <div className="cc-metric-row" style={{ marginTop: 10 }}>
              <div style={{ marginRight: 26 }}><div className="cc-mk" style={{ font: "400 7.5px/1 var(--font-body)", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>Due ≤3 d</div><div style={{ marginTop: 4, font: "600 15px/1 var(--font-heading)", color: "var(--navy)" }}>{dueSoon}</div></div>
              <div><div className="cc-mk" style={{ font: "400 7.5px/1 var(--font-body)", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>Flagged</div><div style={{ marginTop: 4, font: "600 15px/1 var(--font-heading)", color: "var(--accent-700)" }}>{flagged}</div></div>
            </div>
            {count ? (
              <div className="cc-team-names">{names.join(" · ")}</div>
            ) : (
              <div className="cc-team-names" style={{ marginTop: 20 }}>Nobody on this list — every athlete currently sits with Noa.</div>
            )}
            <button className="cc-fullbtn" onClick={() => onSeeCoach(coach.id)}>See these athletes</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Clients --- */
type DueFilter = "all" | "due" | "overdue";
type SortMode = "urgent" | "name" | "adherence";
function ClientsView({
  coachId,
  setCoachId,
  onOpenProgram,
  onOpenAthlete,
  onSelect,
}: {
  coachId: string;
  setCoachId: (id: string) => void;
  onOpenProgram: (athleteId: string) => void;
  onOpenAthlete: (athleteId: string) => void;
  onSelect: (athleteId: string) => void;
}) {
  const [scope, setScope] = useState<string>(coachId); // "all" or a coachId
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("urgent");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => setScope(coachId), [coachId]);

  const clients = useMemo(() => {
    let rows = getClients(scope === "all" ? undefined : scope);
    if (dueFilter === "due") rows = rows.filter((r) => !r.checked && (r.due.flagged || (r.due.days !== null && r.due.days <= 7)));
    if (dueFilter === "overdue") rows = rows.filter((r) => r.due.flagged);
    const sorted = [...rows];
    if (sortMode === "urgent") sorted.sort((a, b) => a.rank - b.rank);
    else if (sortMode === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === "adherence") sorted.sort((a, b) => a.adherence - b.adherence);
    return sorted;
  }, [scope, dueFilter, sortMode]);

  const weeksToWrite = clients.filter((r) => !r.checked && (r.due.flagged || (r.due.days !== null && r.due.days <= 7))).length;
  const flagged = clients.filter((r) => r.due.flagged).length;

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Client Board</h1>
          <p className="cc-sub">Where every athlete sits right now: the session they’re on, the last one they logged, and when their program runs out.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Athletes shown" v={clients.length} />
          <Stat k="Weeks to write" v={weeksToWrite} />
          <Stat k="Flagged" v={flagged} />
        </div>
      </div>

      <div className="cc-chips">
        <button className="cc-chip" aria-current={scope === "all"} onClick={() => setScope("all")}>All coaches</button>
        {COACHES.map((c) => (
          <button key={c.id} className="cc-chip" aria-current={scope === c.id} onClick={() => { setScope(c.id); setCoachId(c.id); }}>
            {c.name}
          </button>
        ))}
        <span style={{ width: 1, background: "var(--divider)", margin: "0 4px" }} />
        <button className="cc-chip" aria-current={dueFilter === "all"} onClick={() => setDueFilter("all")}>All due</button>
        <button className="cc-chip" aria-current={dueFilter === "due"} onClick={() => setDueFilter("due")}>Needs a week</button>
        <button className="cc-chip" aria-current={dueFilter === "overdue"} onClick={() => setDueFilter("overdue")}>Overdue</button>
        <span style={{ width: 1, background: "var(--divider)", margin: "0 4px" }} />
        <span className="cc-cell-s" style={{ alignSelf: "center", marginRight: 2 }}>Order</span>
        <button className="cc-chip" aria-current={sortMode === "urgent"} onClick={() => setSortMode("urgent")}>Needs program first</button>
        <button className="cc-chip" aria-current={sortMode === "name"} onClick={() => setSortMode("name")}>Name</button>
        <button className="cc-chip" aria-current={sortMode === "adherence"} onClick={() => setSortMode("adherence")}>Adherence</button>
      </div>

      <div style={{ marginTop: 22 }}>
        <div className="cc-board-head">
          <span>Athlete</span><span>Week</span><span>Current session</span><span>Last logged</span>
          <span>Adherence</span><span>Program due in</span><span>Coach note</span><span />
        </div>
        {clients.map((c) => (
          <div key={c.athleteId} className={`cc-client${c.due.flagged ? " cc-flagged" : ""}`}>
            <div className="cc-client-row" onClick={() => { onSelect(c.athleteId); setExpanded(expanded === c.athleteId ? null : c.athleteId); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <button
                  title="Open athlete profile"
                  style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex" }}
                  onClick={(e) => { e.stopPropagation(); onOpenAthlete(c.athleteId); }}
                >
                  <Avatar src={c.avatar} name={c.name} size={34} />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div className="cc-name">
                    {c.name}
                    {c.competing && <span className="cc-pr-badge">PR</span>}
                    {c.live && <span className="cc-pr-badge" style={{ borderColor: "var(--good)", color: "var(--good)" }}>LIVE</span>}
                  </div>
                  <div className="cc-city">{c.city} · {c.competing ? "competing" : "non-competing"}</div>
                </div>
              </div>
              <div className="cc-cell-k">{c.block}</div>
              <div><div className="cc-cell-k">{c.session.title}</div><div className="cc-cell-s">{c.session.detail}</div></div>
              <div><div className="cc-cell-k" style={{ fontWeight: 400 }}>{c.lastLogged.what}</div><div className="cc-cell-s">{c.lastLogged.when}</div></div>
              <div className="cc-adh">
                <div className="cc-bar-track"><div className="cc-bar-fill" style={{ width: `${c.adherence}%`, background: "var(--navy)" }} /></div>
                <span className="cc-cell-k" style={{ fontSize: 11 }}>{c.adherence}%</span>
              </div>
              <div>
                <div className="cc-cell-k" style={{ color: c.due.flagged ? "var(--bad)" : c.checked ? "var(--good)" : "var(--navy)", display: "flex", alignItems: "center", gap: 5 }}>
                  {c.checked && <span aria-hidden style={{ font: "700 12px/1 var(--font-heading)" }}>✓</span>}
                  {c.due.label}
                </div>
                <div className="cc-cell-s">{c.due.sub}</div>
              </div>
              <div className="cc-note-wrap" onClick={(e) => e.stopPropagation()}>
                <div className="cc-note-lab">Private {c.ping && <span className="cc-ping" title="Unread message from athlete" />}</div>
                <input
                  className="cc-note-input"
                  defaultValue={c.note}
                  placeholder="only you see this"
                  onBlur={(e) => { if (e.target.value !== c.note) setCoachNote(c.athleteId, e.target.value); }}
                />
              </div>
              <div className="cc-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="cc-mini cc-mini-solid" onClick={() => onOpenProgram(c.athleteId)}>Open</button>
                <button className="cc-mini" onClick={() => { onSelect(c.athleteId); setExpanded(expanded === c.athleteId ? null : c.athleteId); }}>
                  {expanded === c.athleteId ? "▴ Hide" : "▾ Athlete input"}
                </button>
              </div>
            </div>
            {expanded === c.athleteId && <ClientDetail c={c} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientDetail({ c }: { c: ClientRow }) {
  return (
    <div className="cc-detail-full">
      {/* Same profile panels as Program & Planner → Athlete. */}
      <AthletePanels client={c} />

      {/* Coach-only controls that don't live on the profile page. */}
      <div className="cc-profile-grid" style={{ marginTop: 14 }}>
        <div className="cc-panel cc-corner" style={{ position: "relative" }}>
          <i />
          <div className="cc-side-k">Coach controls</div>
          <button className="cc-switch" style={{ marginTop: 12 }} aria-pressed={c.hideMaxes} onClick={() => setHideMaxes(c.athleteId, !c.hideMaxes)}>
            <span className="cc-knob"><i /></span>
            <span className="cc-sw-txt">
              1RM &amp; e1RM · {c.hideMaxes ? "hidden" : "visible"}
              <span className="cc-sw-sub">Their app hides estimated maxes — logging and tonnage stay.</span>
            </span>
          </button>
        </div>

        <div className="cc-panel cc-corner" style={{ position: "relative" }}>
          <i />
          <div className="cc-side-k">Meets · opt in for them</div>
          <div className="cc-opt-list" style={{ marginTop: 10 }}>
            {c.opts.length ? (
              c.opts.slice(0, 5).map((o) => (
                <button
                  key={o.id}
                  className="cc-switch"
                  aria-pressed={o.opted}
                  onClick={() => toggleOpt(c.athleteId, o.id, !o.opted)}
                  title={o.opted ? "Only the coach can withdraw an entry" : "Opt this athlete in"}
                >
                  <span className="cc-knob"><i /></span>
                  <span className="cc-sw-txt">
                    {o.name}
                    <span className="cc-sw-sub">{fmtDate(o.date)} · {o.level === "international" ? "INT" : "NAT"}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="cc-cell-s">No meets on the calendar.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits --- */
function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v">{v}</div>
    </div>
  );
}
function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()]}`;
}
