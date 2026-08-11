import { ROSTER } from "./roster";
import { supabase } from "../supabase";
import { hydrateFromServer, stopSync } from "../data/athleteData";

/**
 * Athlete auth for the phone app.
 *
 * The design's rule: the coach issues credentials, there is no sign-up and no
 * email — just an ATHLETE ID + ACCESS CODE. The session persists on the device
 * so athletes don't re-enter it each visit.
 *
 * Backend seam: this validates against the local `ROSTER` today. When the coach
 * dashboard lands it provisions athletes into Supabase Auth (athlete id -> a
 * synthetic email, access code -> password), and only `signIn` below changes to
 * call `supabase.auth.signInWithPassword`. Everything else — the screen, the
 * session shape, sign-out — stays the same.
 */

export type AthleteSession = {
  athleteId: string;
  name: string;
  coachName: string;
  coachWhatsapp?: string;
  signedInAt: string; // ISO
};

export type SignInResult =
  | { ok: true; session: AthleteSession }
  | { ok: false; error: string };

const STORAGE_KEY = "ssc.athlete.session";

const listeners = new Set<(s: AthleteSession | null) => void>();

function read(): AthleteSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AthleteSession;
    if (!parsed?.athleteId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(session: AthleteSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage can be unavailable (private mode); session just won't persist */
  }
  listeners.forEach((cb) => cb(session));
}

const normalizeId = (id: string) => id.trim().toUpperCase();
// Athlete IDs map to a synthetic login email (the coach provisions these).
const idToEmail = (id: string) => `${id.trim().toLowerCase()}@ssc.app`;

/** Current signed-in session, or null. */
export function getSession(): AthleteSession | null {
  return read();
}

/**
 * Validate credentials and start a session. Async so the Supabase swap is a
 * drop-in later. Returns a typed result rather than throwing so the screen can
 * show the wrong-code state.
 */
export async function signIn(athleteId: string, accessCode: string): Promise<SignInResult> {
  const id = normalizeId(athleteId);
  const code = accessCode.trim();
  if (!id || !code) return { ok: false, error: "Enter your athlete ID and access code." };

  // Authenticate against Supabase (id -> synthetic email, access code -> password).
  const { error } = await supabase.auth.signInWithPassword({ email: idToEmail(id), password: code });
  if (error) {
    return { ok: false, error: "That ID and code don't match. Check both and try again." };
  }

  // Display metadata (name, coach) still comes from the roster; identity is Supabase's.
  const match = ROSTER.find((a) => normalizeId(a.athleteId) === id);
  const session: AthleteSession = {
    athleteId: id,
    name: match?.name ?? id,
    coachName: match?.coachName ?? "your coach",
    coachWhatsapp: match?.coachWhatsapp,
    signedInAt: new Date().toISOString(),
  };
  // Pull the athlete's cloud data (or seed it) before the app renders.
  try {
    await hydrateFromServer(id);
  } catch {
    /* offline / transient — the app still works on local data and re-syncs later */
  }
  write(session);
  return { ok: true, session };
}

/** Clear the session on this device. */
export async function signOut(): Promise<void> {
  stopSync();
  await supabase.auth.signOut().catch(() => {});
  write(null);
}

/**
 * Subscribe to session changes (sign-in / sign-out, incl. from other tabs).
 * Returns an unsubscribe function.
 */
export function subscribe(cb: (s: AthleteSession | null) => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(read());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
