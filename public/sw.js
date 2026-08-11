/* SSC Training Log — service worker.
   App-shell caching so the athlete app opens offline (add-to-homescreen PWA).
   Navigation + static assets are served cache-first with a network fallback;
   Supabase API/auth calls are always network (never cached). */
const CACHE = "ssc-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache Supabase (data/auth/realtime) — always go to the network.
  if (url.hostname.endsWith(".supabase.co")) return;

  // App navigations: serve the cached shell when offline (SPA fallback).
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // Static assets: cache-first, then populate the cache on first fetch.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok && url.origin === self.location.origin) caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }),
    ),
  );
});
