/**
 * Web Push subscription for the athlete app. The athlete grants permission once;
 * we store their push subscription in their account so the coach's publish can
 * fire a real notification (via the `notify-athlete` Edge Function).
 *
 * iOS note: only works for an installed (Home-Screen) PWA on iOS 16.4+.
 */
import { savePushSub } from "../data/athleteData";

// Public VAPID key — safe to ship in the client. The matching PRIVATE key lives
// only as a Supabase secret used by the Edge Function.
const VAPID_PUBLIC = "BCCh2N1DPGs3l19tgml7PFSRFL4xocaJwRBPYgNuY__ShSs5Ov4O2U8nw-Q6ha9Irzt9QR8oiNykc5mCX7XyC9c";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Ask permission, subscribe, and store the subscription on the athlete. */
export async function enablePush(athleteId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "This device or browser can't do notifications. On iPhone, add the app to your Home Screen first." };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: "Notifications are blocked — allow them in your device settings for this app." };
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource,
    }));
    await savePushSub(athleteId, sub.toJSON());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not enable notifications." };
  }
}

/** Already subscribed on this device? */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}
