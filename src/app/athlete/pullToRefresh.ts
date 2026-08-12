/**
 * Pull-to-refresh for the athlete app — shared by every screen.
 *
 * Pull down at the top and the whole content card slides down, uncovering the
 * navy frame behind it with a spinning emblem in the gap — so it reads clearly
 * as a refresh, not a page that scrolled up. Releasing past the threshold kicks
 * a real cloud re-sync; the card snaps back once it's done.
 *
 * `scroll` is the frost content card (the `overflow-y:auto` element). Its parent
 * is the navy `.blueprint`, which is what shows through as you pull.
 */
export function wirePullToRefresh(scroll: HTMLElement, onRefresh: () => void | Promise<void>): () => void {
  const frame = scroll.parentElement;
  if (!frame) return () => {};

  // Keep native scroll fast + stop the bounce chaining to the page.
  scroll.style.overscrollBehaviorY = "contain";
  scroll.style.willChange = "transform";

  // Spinning emblem, parked above the card in the navy gap.
  const chip = document.createElement("div");
  chip.style.cssText =
    "position:absolute;top:52px;left:50%;width:40px;height:40px;border-radius:50%;background:#16232f;" +
    "display:grid;place-items:center;box-shadow:rgba(0,0,0,.3) 0 6px 16px;opacity:0;z-index:2;pointer-events:none;" +
    "transform:translate(-50%,-46px);";
  chip.innerHTML = '<img class="ptr-logo" src="/assets/logo-emblem-white.png" style="height:23px;width:auto;display:block;">';
  const img = chip.firstElementChild as HTMLElement;
  frame.appendChild(chip);

  let startY = 0;
  let pulling = false;
  let pull = 0;
  let refreshing = false;
  const THRESH = 64;
  const MAXD = 96;

  const setCard = (y: number, animate: boolean) => {
    scroll.style.transition = animate ? "transform .34s cubic-bezier(.22,1,.36,1)" : "none";
    scroll.style.transform = y ? `translateY(${y}px)` : "";
  };
  const setChip = (y: number, opacity: number, animate: boolean) => {
    chip.style.transition = animate ? "transform .34s cubic-bezier(.22,1,.36,1), opacity .3s ease" : "none";
    chip.style.transform = `translate(-50%, ${y}px)`;
    chip.style.opacity = String(opacity);
  };

  const reset = () => {
    setCard(0, true);
    setChip(-46, 0, true);
    window.setTimeout(() => { img.classList.remove("ptr-spinning"); refreshing = false; }, 340);
  };

  const onStart = (e: TouchEvent) => {
    if (!refreshing && scroll.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = true; pull = 0; }
  };
  const onMove = (e: TouchEvent) => {
    if (!pulling) return;
    if (scroll.scrollTop > 0) { pulling = false; reset(); return; }
    pull = e.touches[0].clientY - startY;
    if (pull <= 0) { setCard(0, false); setChip(-46, 0, false); return; }
    const d = Math.min(pull * 0.55, MAXD); // eased resistance
    setCard(d, false);
    setChip(Math.min(d * 0.55, 30), Math.min(1, d / 44), false);
    if (!refreshing) img.style.transform = `rotate(${d * 3}deg)`; // track the drag before it spins
  };
  const onEnd = () => {
    if (!pulling) return;
    pulling = false;
    if (pull > THRESH) {
      refreshing = true;
      img.style.transform = "";
      img.classList.add("ptr-spinning");
      setCard(52, true);
      setChip(28, 1, true);
      const done = () => window.setTimeout(reset, 260);
      try {
        const r = onRefresh();
        if (r && typeof (r as Promise<void>).then === "function") {
          (r as Promise<void>).then(done, done);
          window.setTimeout(reset, 4000); // hard stop if the sync hangs
        } else {
          window.setTimeout(reset, 1200);
        }
      } catch {
        done();
      }
    } else {
      setCard(0, true);
      setChip(-46, 0, true);
    }
  };

  scroll.addEventListener("touchstart", onStart, { passive: true });
  scroll.addEventListener("touchmove", onMove, { passive: true });
  scroll.addEventListener("touchend", onEnd, { passive: true });
  scroll.addEventListener("touchcancel", onEnd, { passive: true });

  return () => {
    scroll.removeEventListener("touchstart", onStart);
    scroll.removeEventListener("touchmove", onMove);
    scroll.removeEventListener("touchend", onEnd);
    scroll.removeEventListener("touchcancel", onEnd);
    chip.remove();
  };
}
