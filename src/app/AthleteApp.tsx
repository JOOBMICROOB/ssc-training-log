import { useEffect, useRef, useState } from "react";
import "./athlete/design.css";
import "./athlete/athlete-shell.css";
import { AthleteLogin } from "./athlete/LoginScreen";
import { wireDashboard } from "./athlete/wireDashboard";
import { wireBodyweight } from "./athlete/wireBodyweight";
import { wireTraining } from "./athlete/wireTraining";
import { wireProgress } from "./athlete/wireProgress";
import { wireShop } from "./athlete/wireShop";
import { wireCompetitions } from "./athlete/wireCompetitions";
import type { MainLift } from "../lib/program/program";
import { getSession, signOut, subscribe, type AthleteSession } from "../lib/auth/authClient";
import { finalizeWeeklyAdherence, hydrateFromServer } from "../lib/data/athleteData";
import { wirePullToRefresh } from "./athlete/pullToRefresh";

// The REAL design frames (rendered markup captured from Claude Design), imported
// verbatim. The app renders these directly so it IS the design, not a rebuild.
import frame2a from "./athlete/frames/2a.html?raw";
import frame1a from "./athlete/frames/1a.html?raw";
import frame6a from "./athlete/frames/6a.html?raw";
import frame6e from "./athlete/frames/6e.html?raw";
import frame5b from "./athlete/frames/5b.html?raw";
import frame5a from "./athlete/frames/5a.html?raw";

type Screen = "login" | "dashboard" | "training" | "lift" | "bodyweight" | "shop" | "competitions";
const FRAME: Record<Exclude<Screen, "login">, string> = {
  dashboard: frame2a,
  training: frame1a,
  lift: frame6a,
  bodyweight: frame6e,
  shop: frame5b,
  competitions: frame5a,
};

// The captured frames reference real asset paths under /assets — served as-is.
function prep(html: string): string {
  return html;
}

const SCREEN_KEY = "ssc.athlete.screen";
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/**
 * Resume the last screen when the athlete reopens the app — unless a new day has
 * started, in which case they land on the dashboard for a fresh start.
 */
function restoreScreen(hasSession: boolean): Screen {
  if (!hasSession) return "login";
  try {
    const raw = localStorage.getItem(SCREEN_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { screen?: Screen; date?: string };
      if (s.date === todayStr() && s.screen && s.screen !== "login") return s.screen;
    }
  } catch {
    /* ignore malformed */
  }
  return "dashboard"; // new day / first open → dashboard
}

export function AthleteApp() {
  const [session, setSession] = useState<AthleteSession | null>(() => getSession());
  const [screen, setScreen] = useState<Screen>(() => restoreScreen(!!getSession()));
  const [selectedLift, setSelectedLift] = useState<MainLift>("squat");
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep session in sync with sign-in / sign-out (incl. other tabs).
  useEffect(() => subscribe(setSession), []);

  // On open/resume: reconnect cloud sync (persisted Supabase session), then
  // snapshot last week's final adherence if a new week has begun.
  useEffect(() => {
    if (!session) return;
    void hydrateFromServer(session.athleteId).finally(() => finalizeWeeklyAdherence(session.athleteId));
  }, [session?.athleteId]);

  // Remember the current screen + day so a background reload resumes it.
  useEffect(() => {
    try {
      if (session && screen !== "login") localStorage.setItem(SCREEN_KEY, JSON.stringify({ screen, date: todayStr() }));
    } catch {
      /* storage may be unavailable */
    }
  }, [screen, session]);

  // Sign-out → login; coming back online (session restored) → resume last screen.
  useEffect(() => {
    if (!session) setScreen("login");
    else setScreen((cur) => (cur === "login" ? restoreScreen(true) : cur));
  }, [session]);

  // The login page (3a) and its signed-in state are real React (see below).
  // Every other screen is the captured design frame, injected as-is and wired.
  const showFrame = !!session && screen !== "login";

  useEffect(() => {
    if (!showFrame) return;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = prep(FRAME[screen as Exclude<Screen, "login">]);

    const go = (s: Screen) => (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      setScreen(s);
    };
    const clickable = (el: HTMLElement) => {
      el.style.cursor = "pointer";
    };

    // Logo (top-left) -> dashboard.
    host.querySelectorAll<HTMLElement>('img[src^="data:image/svg"]').forEach((img) => {
      clickable(img);
      img.addEventListener("click", go("dashboard"));
    });

    let cleanup: (() => void) | undefined;

    // Pull-to-refresh on every screen → a real cloud resync (and it retries any
    // logs that failed to upload earlier).
    let ptrCleanup: (() => void) | undefined;
    if (session) {
      const scrollEl = host.querySelector<HTMLElement>('div[style*="overflow-y: auto"]');
      if (scrollEl) ptrCleanup = wirePullToRefresh(scrollEl, () => hydrateFromServer(session.athleteId));
    }

    if (screen === "dashboard") {
      // Data-driven adherence + interactive weekly check-in, bodyweight log
      // (tap chart → 6e), next-session card → training, and each PR → progress.
      if (session)
        cleanup = wireDashboard(
          host,
          session.athleteId,
          () => setScreen("bodyweight"),
          () => setScreen("training"),
          (lift) => {
            setSelectedLift(lift as MainLift);
            setScreen("lift");
          },
        );
      host.querySelector<HTMLElement>("#teamShopBtn")?.addEventListener("click", go("shop"));
      host.querySelector<HTMLElement>("#competitionsBtn")?.addEventListener("click", go("competitions"));

      // Log-out control, injected INSIDE the scrolling dashboard content so it
      // sits within the phone frame (not off-screen below it).
      const scroll = host.querySelector<HTMLElement>('div[style*="overflow-y: auto"]');
      if (scroll && session) {
        const btn = document.createElement("button");
        btn.textContent = `Log out · ${session.athleteId}`;
        btn.style.cssText =
          "align-self:center;margin:6px auto 2px;border:1px solid rgba(29,31,32,.16);background:transparent;color:rgb(107,116,128);font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:11px 22px;border-radius:999px;cursor:pointer;";
        btn.addEventListener("click", () => { if (confirm("Log out of the app?")) void signOut(); });
        scroll.appendChild(btn);
      }
    }

    if (screen === "competitions" && session) {
      cleanup = wireCompetitions(host, session.athleteId);
    }

    if (screen === "lift" && session) {
      cleanup = wireProgress(host, session.athleteId, selectedLift);
    }

    if (screen === "shop" && session) {
      cleanup = wireShop(host, session.athleteId);
    }

    if (screen === "bodyweight" && session) {
      cleanup = wireBodyweight(host, session.athleteId, () => setScreen("dashboard"));
    }

    if (screen === "training" || screen === "lift" || screen === "shop" || screen === "competitions") {
      // Put a real, tappable back control in the header, immediately left of the
      // emblem — grouped with it so the emblem shifts right and the block label
      // stays on the right.
      const header = host.querySelector<HTMLElement>(".blueprint > div");
      const emblemNode = header?.firstElementChild as HTMLElement | null;
      if (header && emblemNode) {
        const back = document.createElement("button");
        back.className = "athlete-back";
        back.setAttribute("aria-label", "Back to dashboard");
        back.textContent = "‹";
        back.addEventListener("click", go("dashboard"));
        const group = document.createElement("div");
        group.style.cssText = "display:flex;align-items:center;gap:12px;";
        header.insertBefore(group, emblemNode);
        group.appendChild(back);
        group.appendChild(emblemNode);
      }
    }

    if (screen === "training" && session) {
      cleanup = wireTraining(host, session.athleteId);
    }

    return () => { cleanup?.(); ptrCleanup?.(); };
  }, [screen, showFrame, session, selectedLift]);

  return (
    <div className="athlete-shell">
      {!showFrame ? (
        <AthleteLogin
          session={session}
          onSignedIn={setSession}
          onEnter={() => setScreen("dashboard")}
          onSignOut={() => void signOut()}
        />
      ) : (
        <div ref={hostRef} className="athlete-frame" />
      )}
    </div>
  );
}
