// Shared theme store for the athlete app. The theme is applied by setting
// data-theme on the .athlete-shell (theme.css re-points the accent + background
// vars per value). Both React (AthleteApp) and the DOM-wired dashboard widget
// go through here so the choice stays in sync and persists per device.
export type Theme = "strength" | "flower" | "flame" | "nature";

export const THEMES: { id: Theme; name: string; sub: string; swatch: string }[] = [
  { id: "strength", name: "Specific Strength", sub: "The original blue", swatch: "rgb(89,128,166)" },
  { id: "flower", name: "Flower", sub: "Soft pink bloom", swatch: "rgb(214,96,158)" },
  { id: "flame", name: "Flame", sub: "Warm coral red", swatch: "rgb(224,101,74)" },
  { id: "nature", name: "Nature", sub: "Fresh green", swatch: "rgb(112,176,70)" },
];

const KEY = "ssc.theme";

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY) as Theme; if (THEMES.some((x) => x.id === t)) return t; } catch { /* ignore */ }
  return "strength";
}

export function themeName(id: Theme): string {
  return THEMES.find((t) => t.id === id)?.name ?? "Specific Strength";
}

/** Persist + apply a theme. Set on <html> so body-appended popups (check-in,
 *  bodyweight confirm, calendar, share sheet…) inherit the themed vars too — the
 *  .athlete-shell only covers in-frame content. Coach UI doesn't use --a-* vars,
 *  so a stray attribute on <html> is harmless there. */
export function applyTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll<HTMLElement>(".athlete-shell").forEach((el) => el.setAttribute("data-theme", t));
  window.dispatchEvent(new CustomEvent("ssc-theme", { detail: t }));
}
