import { getDashboard, subscribeDashboard, setShopSize, setShopQty, setShopNote, submitShopOrder, type DashboardData } from "../../lib/data/athleteData";

/**
 * Team shop (design 5b). Coach-managed catalogue + the athlete's request — no
 * checkout, payment by invoice, kit collected at the gym. Size (apparel only),
 * quantities and note persist. The comp tee's first unit is free until the
 * athlete's free-tee allowance is used (coach-toggled); extras are paid.
 */

const SIZES = ["XS", "S", "M", "L", "XL"];
type Product = DashboardData["shopProducts"][number];

const freeUnits = (p: Product, athlete: DashboardData["athlete"]) =>
  p.freeEligible && !athlete.freeTeeUsed ? 1 : 0;

export function wireShop(host: HTMLElement, athleteId: string): () => void {
  const sizesEl = host.querySelector<HTMLElement>("#shopSizes");
  const listEl = host.querySelector<HTMLElement>("#shopProducts");
  const noteEl = host.querySelector<HTMLTextAreaElement>("#shopNote");
  const countEl = host.querySelector<HTMLElement>("#shopCount");
  const totalEl = host.querySelector<HTMLElement>("#shopTotal");
  const submitEl = host.querySelector<HTMLElement>("#shopSubmit");
  const submitTxt = host.querySelector<HTMLElement>("#shopSubmitTxt");

  // Photo lightbox (supports up to 3 images, horizontal scroll-snap).
  const light = document.createElement("div");
  light.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(9,17,28,.82);backdrop-filter:blur(3px);z-index:1500;padding:24px;";
  document.body.appendChild(light);
  const openLightbox = (images: string[]) => {
    light.innerHTML = `<div style="width:100%;max-width:360px;">
      <div style="display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;border-radius:16px;">
        ${images.map((src) => `<img src="${src}" style="flex:0 0 100%;scroll-snap-align:center;width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border-radius:16px;display:block;">`).join("")}
      </div>
      ${images.length > 1 ? `<div style="text-align:center;margin-top:10px;font:600 10px/1 'Barlow Condensed',sans-serif;letter-spacing:.14em;color:rgba(214,231,247,.7);">SWIPE FOR MORE · ${images.length} PHOTOS</div>` : ""}
      <button data-close style="display:block;margin:14px auto 0;padding:10px 20px;border:1px solid rgba(214,231,247,.35);border-radius:12px;background:transparent;color:#dceaf6;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;">CLOSE</button>
    </div>`;
    light.style.display = "flex";
  };
  light.addEventListener("click", (e) => {
    if (e.target === light || (e.target as HTMLElement).closest("[data-close]")) light.style.display = "none";
  });

  function render() {
    const d = getDashboard(athleteId);
    const { size, cart } = d.shopOrder;

    if (sizesEl)
      sizesEl.innerHTML = SIZES.map(
        (s) =>
          `<button data-size="${s}" style="flex:1 1 0%;padding:8px 0;border-radius:10px;font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.08em;cursor:pointer;backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;${s === size ? "border:1px solid rgb(29,45,61);background:rgb(29,45,61);color:rgb(242,242,243);" : "border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(107,116,128);"}">${s}</button>`,
      ).join("");

    if (listEl)
      listEl.innerHTML = d.shopProducts
        .map((p) => {
          const qty = cart[p.id] ?? 0;
          const imgs = p.images ?? [];
          // Show "1st free" only until the free unit is actually in the cart.
          const freeRemaining = freeUnits(p, d.athlete) > qty;
          const meta = [p.desc, p.sized ? `size ${size}` : null, freeRemaining ? "1st free" : null].filter(Boolean).join(" · ");
          const price = freeRemaining ? "1ST FREE" : `€${p.price}`;
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 11px;border:1px solid rgba(29,31,32,.14);border-radius:12px;background:rgba(255,255,255,.62);backdrop-filter:blur(16px);box-shadow:rgba(20,36,52,.07) 0px 4px 14px;">
            <button data-photo="${p.id}" style="flex:0 0 auto;width:48px;height:48px;padding:0;border:1px solid rgba(29,31,32,.12);border-radius:9px;overflow:hidden;background:rgb(233,234,236);cursor:zoom-in;">
              <img src="${imgs[0] ?? ""}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">
            </button>
            <div style="flex:1 1 0%;min-width:0;">
              <div style="font:600 15px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(29,45,61);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
              <div style="margin-top:4px;font:400 10.5px/1.35 Barlow,sans-serif;color:rgb(138,146,156);">${meta}</div>
            </div>
            <div style="flex:0 0 auto;text-align:right;min-width:40px;white-space:nowrap;font:600 13px/1 'Barlow Condensed',sans-serif;color:${freeRemaining ? "rgb(65,97,128)" : "rgb(29,45,61)"};">${price}</div>
            <div style="flex:0 0 auto;display:flex;align-items:center;gap:4px;">
              <button data-minus="${p.id}" style="width:26px;height:26px;border:1px solid rgba(29,31,32,.16);border-radius:8px;background:transparent;color:rgb(65,97,128);font-size:13px;cursor:pointer;">−</button>
              <span style="width:16px;text-align:center;font:600 14px/1 'Barlow Condensed',sans-serif;color:rgb(29,45,61);">${qty}</span>
              <button data-plus="${p.id}" style="width:26px;height:26px;border:1px solid rgba(89,128,166,.45);border-radius:8px;background:rgba(89,128,166,.1);color:rgb(65,97,128);font-size:13px;cursor:pointer;">+</button>
            </div>
          </div>`;
        })
        .join("");

    if (noteEl && document.activeElement !== noteEl) noteEl.value = d.shopOrder.note;

    const items = Object.values(cart).reduce((a, b) => a + b, 0);
    const total = d.shopProducts.reduce((sum, p) => sum + Math.max(0, (cart[p.id] ?? 0) - freeUnits(p, d.athlete)) * p.price, 0);
    if (countEl) countEl.textContent = items === 0 ? "NOTHING SELECTED" : `${items} ITEM${items === 1 ? "" : "S"} · SIZE ${size}`;
    if (totalEl) totalEl.textContent = `€${total}`;
    if (submitTxt) submitTxt.textContent = items === 0 ? "PICK SOMETHING FIRST" : "SEND REQUEST TO COACH";
    if (submitEl) {
      submitEl.style.cursor = items === 0 ? "default" : "pointer";
      submitEl.style.background = items === 0 ? "transparent" : "rgb(29,45,61)";
      submitEl.style.color = items === 0 ? "rgb(138,146,156)" : "rgb(242,242,243)";
      submitEl.style.border = items === 0 ? "1px solid rgba(29,31,32,.14)" : "1px solid rgb(29,45,61)";
    }
  }

  sizesEl?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-size]");
    if (b?.dataset.size) setShopSize(athleteId, b.dataset.size);
  });
  listEl?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const photo = t.closest<HTMLElement>("[data-photo]");
    if (photo?.dataset.photo) {
      const p = getDashboard(athleteId).shopProducts.find((x) => x.id === photo.dataset.photo);
      if (p) openLightbox(p.images);
      return;
    }
    const plus = t.closest<HTMLElement>("[data-plus]");
    if (plus?.dataset.plus) return setShopQty(athleteId, plus.dataset.plus, 1);
    const minus = t.closest<HTMLElement>("[data-minus]");
    if (minus?.dataset.minus) return setShopQty(athleteId, minus.dataset.minus, -1);
  });
  noteEl?.addEventListener("input", () => setShopNote(athleteId, noteEl.value));
  submitEl?.addEventListener("click", () => {
    const d = getDashboard(athleteId);
    const items = Object.values(d.shopOrder.cart).reduce((a, b) => a + b, 0);
    if (items === 0) return;
    if (confirm("Send this request to your coach? Payment by invoice.")) {
      submitShopOrder(athleteId);
      alert("Request sent — your coach will invoice you.");
    }
  });

  const unsub = subscribeDashboard(render);
  render();
  return () => {
    unsub();
    light.remove();
  };
}
