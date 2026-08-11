import { useEffect, useState } from "react";
import { CoachConsole } from "./app/CoachConsole";
import { AthleteApp } from "./app/AthleteApp";

/**
 * Top-level shell / router.
 *
 * Two entry points that share one app (and, once wired, one data service):
 *   - the athlete phone app at the root link  (e.g. 192.168.x.x:5173/)
 *   - the coach desktop console at /coach      (e.g. 192.168.x.x:5173/coach)
 *
 * Plain History routing — no router dependency. The floating COACH/ATHLETE pill
 * stays as a dev convenience but now just navigates between the two links, so it
 * matches what a real bookmark does. Later, role-based login can redirect a coach
 * account straight to /coach.
 */

const isCoachPath = (p: string) => p.replace(/\/+$/, "").endsWith("/coach");

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [installEvt, setInstallEvt] = useState<Event | null>(null);

  // Keep the view in sync with back/forward navigation.
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const navigate = (to: string) => {
    if (window.location.pathname !== to) window.history.pushState({}, "", to);
    setPath(to);
  };

  const isCoach = isCoachPath(path);

  return (
    <div style={{ minHeight: "100%", background: isCoach ? "var(--bg)" : "var(--navy-2)" }}>
      {/* preview switch — dev convenience; production uses the plain /coach link (or role-based login). */}
      <div className="dev-role-switch" style={{ position: "fixed", bottom: 14, left: 14, zIndex: 50, display: "flex", gap: 6, padding: 5,
        background: "#fff", border: "1px solid var(--divider)", borderRadius: 999, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }}>
        {([["coach", "/coach"], ["athlete", "/"]] as const).map(([label, to]) => {
          const active = (label === "coach") === isCoach;
          return (
            <button key={label} onClick={() => navigate(to)} style={{ padding: "6px 14px", borderRadius: 999, border: "none",
              background: active ? "var(--accent)" : "transparent", color: active ? "#fff" : "var(--text)",
              font: "600 11px/1 var(--font-heading)", letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</button>
          );
        })}
        {installEvt && (
          <button onClick={() => { (installEvt as unknown as { prompt: () => void }).prompt(); setInstallEvt(null); }}
            style={{ padding: "6px 14px", borderRadius: 999, border: "none", background: "var(--navy)", color: "#fff", font: "600 11px/1 var(--font-heading)", letterSpacing: ".1em", textTransform: "uppercase" }}>
            Install
          </button>
        )}
      </div>

      {isCoach ? <CoachConsole /> : <AthleteApp />}
    </div>
  );
}
