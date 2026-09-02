/* SSC Training Log — service worker.
   App-shell caching so the app opens offline (add-to-homescreen PWA).

   IMPORTANT: bump CACHE on every meaningful change to this file. A changed
   sw.js is what makes the browser install a new worker, drop the old caches,
   and (with skipWaiting + clients.claim + the reload hook in main.tsx) pull the
   latest deploy onto installed phones instead of serving a stale build forever.

   Navigations + the app's HTML are network-first (a new deploy always wins);
   content-hashed assets are cache-first (immutable). Supabase is never cached. */
const CACHE = "ssc-shell-v32";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

// Web push: show the notification the coach sent (e.g. a new program).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* plain text / empty */ }
  e.waitUntil(self.registration.showNotification(d.title || "SSC Training", {
    body: d.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: d.url || "/" },
    tag: d.tag || "ssc",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ("focus" in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache Supabase (data/auth/realtime) — always network.
  if (url.hostname.endsWith(".supabase.co")) return;

  // App navigations + HTML → network-first so a fresh deploy is picked up the
  // moment the phone is online; fall back to the cached shell offline.
  if (req.mode === "navigate" || (url.origin === self.location.origin && url.pathname.endsWith(".html"))) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html"))),
    );
    return;
  }

  // Content-hashed assets (JS/CSS/images/fonts) → cache-first; a new build has
  // new filenames, so this never serves stale code.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok && url.origin === self.location.origin) caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }),
    ),
  );
});
