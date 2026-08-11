import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { signIn, type AthleteSession } from "../../lib/auth/authClient";

/**
 * Login page (design frame 3a) — reproduced exactly from the Claude Design
 * capture: the login-bg photograph, the SSC wordmark, and the two-field form.
 * The only additions over the static frame are the behaviour the coach asked
 * for: real credential checking, a wrong-code message, and a signed-in state
 * that leads to either sign-out or the dashboard. No visual restyle.
 */

// --- styles ported verbatim from design-ref/extracted/3a.html --------------
const card: CSSProperties = {
  position: "relative",
  width: 380,
  height: 772,
  color: "rgb(242,242,243)",
  background: 'url("/assets/login-bg.png") center center / cover no-repeat rgb(12,24,36)',
  borderRadius: 26,
  overflow: "visible",
  display: "flex",
  flexDirection: "column",
  boxShadow: "rgba(29,31,32,0.14) 0px 12px 32px",
};
const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: 26,
  background:
    "linear-gradient(rgba(12,24,36,0.55) 0%, rgba(12,24,36,0.42) 42%, rgba(12,24,36,0.88) 100%)",
};
const column: CSSProperties = {
  position: "relative",
  flex: "1 1 0%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  padding: "0px 26px 40px",
};
const logo: CSSProperties = { width: 252, height: "auto", margin: "0px auto auto", paddingTop: 92 };
const label: CSSProperties = {
  font: "400 9px / 1 Barlow, sans-serif",
  letterSpacing: "0.16em",
  color: "rgba(242,242,243,0.72)",
};
const field: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "13px 12px",
  background: "rgba(242,242,243,0.12)",
  border: "1px solid rgba(29,31,32,0.16)",
  borderRadius: 12,
  color: "rgb(242,242,243)",
  font: '600 17px / 1 "Barlow Condensed", sans-serif',
  boxSizing: "border-box",
};
const primaryBtn: CSSProperties = {
  width: "100%",
  marginTop: 18,
  padding: 16,
  border: "1px solid rgb(242,242,243)",
  borderRadius: 14,
  background: "rgb(242,242,243)",
  color: "rgb(29,45,61)",
  font: '600 15px / 1 "Barlow Condensed", sans-serif',
  letterSpacing: "0.16em",
  cursor: "pointer",
};
const helper: CSSProperties = {
  marginTop: 14,
  textAlign: "center",
  font: "400 10.5px / 1.6 Barlow, sans-serif",
  color: "rgba(242,242,243,0.68)",
};
const errorLine: CSSProperties = {
  marginTop: 12,
  textAlign: "center",
  font: '600 11px / 1.5 Barlow, sans-serif',
  color: "#f4b4b4",
  letterSpacing: "0.02em",
};

// Corners are the design's canvas registration marks; athlete-shell.css hides
// them inside .athlete-frame, kept here so the frame renders identically.
const Corners = () => (
  <>
    <i className="corner tl" /> <i className="corner tr" />
    <i className="corner bl" /> <i className="corner br" />
  </>
);

const Card = ({ children }: { children: ReactNode }) => (
  <div className="athlete-frame">
    <div className="blueprint" style={card}>
      <Corners />
      <div style={overlay} />
      <div style={column}>
        <img src="/assets/logo-full-white.png" alt="Specific Strength Coaching" style={logo} />
        {children}
      </div>
    </div>
  </div>
);

// --------------------------------------------------------------------------

export function AthleteLogin({
  session,
  onSignedIn,
  onEnter,
  onSignOut,
}: {
  session: AthleteSession | null;
  onSignedIn: (s: AthleteSession) => void;
  onEnter: () => void;
  onSignOut: () => void;
}) {
  return session ? (
    <SignedIn session={session} onEnter={onEnter} onSignOut={onSignOut} />
  ) : (
    <SignInForm onSignedIn={onSignedIn} />
  );
}

function SignInForm({ onSignedIn }: { onSignedIn: (s: AthleteSession) => void }) {
  const [athleteId, setAthleteId] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await signIn(athleteId, accessCode);
    setBusy(false);
    if (res.ok) onSignedIn(res.session);
    else setError(res.error);
  }

  return (
    <Card>
      <form onSubmit={submit} style={{ marginTop: 26 }}>
        <div style={label}>ATHLETE ID</div>
        <input
          placeholder="RS1203"
          value={athleteId}
          onChange={(e) => setAthleteId(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ ...field, letterSpacing: "0.1em" }}
        />
        <div style={{ marginTop: 14 }}>
          <div style={label}>ACCESS CODE</div>
          <input
            type="password"
            placeholder="••••••"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            style={{ ...field, letterSpacing: "0.3em" }}
          />
        </div>

        <button type="submit" className="scpe" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
          {busy ? "SIGNING IN…" : "SIGN IN"}
        </button>

        {error && <div style={errorLine}>{error}</div>}
        <div style={helper}>Lost your code? Message your coach on WhatsApp.</div>
      </form>
    </Card>
  );
}

function SignedIn({
  session,
  onEnter,
  onSignOut,
}: {
  session: AthleteSession;
  onEnter: () => void;
  onSignOut: () => void;
}) {
  const wa = session.coachWhatsapp?.replace(/[^\d]/g, "");
  return (
    <Card>
      <div style={{ marginTop: 26 }}>
        <div style={label}>SIGNED IN</div>
        <div style={{ marginTop: 6, font: '600 26px / 1.05 "Barlow Condensed", sans-serif', letterSpacing: "0.02em" }}>
          {session.name}
        </div>
        <div style={{ marginTop: 3, font: '600 12px / 1 "Barlow Condensed", sans-serif', letterSpacing: "0.14em", color: "rgba(242,242,243,0.68)" }}>
          {session.athleteId}
        </div>

        <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(242,242,243,0.16)" }}>
          <div style={label}>YOUR COACH</div>
          <div style={{ marginTop: 4, font: '600 16px / 1.1 "Barlow Condensed", sans-serif' }}>{session.coachName}</div>
          <div style={{ ...helper, textAlign: "left", marginTop: 8 }}>
            {wa ? (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={{ color: "rgba(242,242,243,0.85)" }}>
                Message your coach on WhatsApp.
              </a>
            ) : (
              "Message your coach on WhatsApp."
            )}
          </div>
        </div>

        <button type="button" className="scpe" onClick={onEnter} style={{ ...primaryBtn, letterSpacing: "0.16em" }}>
          GO TO DASHBOARD
        </button>
        <button
          type="button"
          onClick={onSignOut}
          style={{
            width: "100%",
            marginTop: 12,
            padding: 16,
            border: "1px solid rgba(242,242,243,0.5)",
            borderRadius: 14,
            background: "transparent",
            color: "rgb(242,242,243)",
            font: '600 15px / 1 "Barlow Condensed", sans-serif',
            letterSpacing: "0.16em",
            cursor: "pointer",
          }}
        >
          SIGN OUT
        </button>
      </div>
    </Card>
  );
}
