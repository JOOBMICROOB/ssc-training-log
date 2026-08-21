// Lightweight, non-blocking toast for the athlete app — a floating pill at the
// bottom that fades out on its own. Replaces blocking alert()s for reassurances
// (e.g. "going lighter is fine") so logging never stops to wait for a click.
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, ms = 3400) {
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));" +
      "transform:translateX(-50%) translateY(10px);max-width:min(92vw,430px);z-index:9999;" +
      "padding:12px 16px;border-radius:14px;background:rgba(29,45,61,.96);color:#f2f2f3;" +
      "font:500 13px/1.45 Barlow,sans-serif;box-shadow:0 10px 34px rgba(20,36,52,.30);" +
      "opacity:0;transition:opacity .18s ease,transform .18s ease;pointer-events:none;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => { if (el) { el.style.opacity = "1"; el.style.transform = "translateX(-50%) translateY(0)"; } });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { if (el) { el.style.opacity = "0"; el.style.transform = "translateX(-50%) translateY(10px)"; } }, ms);
}
