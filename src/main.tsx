import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the PWA service worker (app-shell caching for offline use) and keep
// it fresh: when a new worker takes control, reload once so installed phones
// pick up the latest deploy instead of serving a stale build.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only reload for a REAL update (there was already a worker), never on the
    // very first install — and only once.
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update().catch(() => {});
      // Re-check for a new build when the app is reopened / refocused.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => {
      /* SW registration is best-effort; the app still works without it */
    });
  });
}
