import { useEffect, useState } from "react";
import "./coach/coach.css";
import { ProgramViewer } from "./coach/ProgramViewer";
import { AthletePanels } from "./coach/AthleteProfileView";
import { Avatar } from "./coach/Avatar";
import { getClients, setRealAthletes, subscribeCoach } from "./coach/coachData";
import { startNutritionistSync, type CoachSession } from "../lib/auth/coachAuth";

/**
 * Read-only console for the nutritionist (Jess). Lists every athlete a coach
 * flagged "nutrition" and shows each one's training program via the normal
 * ProgramViewer in read-only mode — she follows along, changes nothing. All
 * writes are blocked server-side too (RLS has no nutritionist write policy).
 */
export function NutritionConsole({ session, onSignOut }: { session: CoachSession; onSignOut: () => void }) {
  const [, force] = useState(0);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"program" | "info">("program");

  useEffect(() => subscribeCoach(() => force((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const list = await startNutritionistSync();
      if (!alive) return;
      setRealAthletes(list);
      setReady(true);
    };
    void sync();
    const onVis = () => { if (document.visibilityState === "visible") void sync(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const clients = getClients().filter((c) => c.nutrition);
  const selected = clients.find((c) => c.athleteId === selectedId) ?? clients[0];

  return (
    <div className="cc">
      <header className="cc-bar">
        <div className="cc-brand">
          <img className="cc-emblem" src="/assets/logo-emblem-white.png" alt="" />
          <span className="cc-brand-txt">NUTRITION CONSOLE</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
          <span className="cc-cell-s">Read-only · {session.name}</span>
          <button className="cc-mini" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {!ready ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "var(--muted)" }}>Loading nutrition athletes…</div>
      ) : clients.length === 0 ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "var(--muted)", textAlign: "center", padding: 24 }}>
          No nutrition athletes yet. A coach ticks “Nutrition” on an athlete to share their training here.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 18, padding: 18, alignItems: "start" }}>
          <aside className="cc-panel cc-corner" style={{ position: "relative", padding: 10 }}>
            <i />
            <div className="cc-side-k" style={{ padding: "4px 8px 8px" }}>Nutrition athletes · {clients.length}</div>
            {clients.map((c) => (
              <button
                key={c.athleteId}
                className={`cc-athlete-menu-item${c.athleteId === selected?.athleteId ? " cc-current" : ""}`}
                style={{ width: "100%" }}
                onClick={() => setSelectedId(c.athleteId)}
              >
                <Avatar src={c.avatar} name={c.name} size={26} />
                <span>{c.name}</span>
                {c.live && <span className="cc-pr-badge" style={{ marginLeft: "auto", borderColor: "var(--good)", color: "var(--good)" }}>LIVE</span>}
              </button>
            ))}
          </aside>
          <main>
            {selected && (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  <button className="cc-chip" aria-current={view === "program"} onClick={() => setView("program")}>Program</button>
                  <button className="cc-chip" aria-current={view === "info"} onClick={() => setView("info")}>Info &amp; progress</button>
                </div>
                {view === "program" ? (
                  <ProgramViewer
                    key={selected.athleteId}
                    athleteId={selected.athleteId}
                    athleteName={selected.name}
                    avatar={selected.avatar}
                    live
                    readOnly
                    onOpenBuilder={() => {}}
                  />
                ) : (
                  <AthletePanels key={selected.athleteId} client={selected} />
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
