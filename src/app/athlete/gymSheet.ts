import { getGyms, saveGym, removeGym, setMainGym } from "../../lib/data/athleteData";
import { GYM_TYPES, GYM_TYPE_SHORT, type Gym, type GymType } from "../../lib/program/gyms";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const OVERLAY = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(9,17,28,.55);backdrop-filter:blur(3px);padding:16px;";
const CARD = "width:360px;max-width:96vw;max-height:calc(100dvh - 32px);overflow-y:auto;background:#f4f8fc;border:1px solid rgba(29,31,32,.12);border-radius:20px;box-shadow:0 24px 60px rgba(9,17,28,.4);padding:16px;";
const INPUT = "width:100%;box-sizing:border-box;height:42px;padding:0 12px;border:1px solid rgba(var(--a-accent-rgb),.4);border-radius:10px;background:#fff;color:rgb(var(--a-navy-rgb));font:500 16px/1 Barlow,sans-serif;";
const LABEL = "display:block;margin:12px 0 5px;font:700 9px/1 Barlow,sans-serif;letter-spacing:.14em;color:rgb(var(--a-accent2-rgb));";
const PRIMARY = "width:100%;margin-top:14px;padding:13px;border:1px solid rgb(var(--a-navy-rgb));border-radius:12px;background:rgb(var(--a-navy-rgb));color:#f2f2f3;font:600 13px/1 'Barlow Condensed',sans-serif;letter-spacing:.12em;cursor:pointer;";
const head = (title: string, sub: string) => `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px;">
    <div><div style="font:600 19px/1 'Barlow Condensed',sans-serif;letter-spacing:.03em;color:rgb(var(--a-navy-rgb));">${title}</div>
    <div style="margin-top:5px;font:400 11px/1.4 Barlow,sans-serif;color:rgb(107,116,128);">${sub}</div></div>
    <button data-g-close style="flex:0 0 auto;border:none;background:rgba(29,31,32,.06);width:30px;height:30px;border-radius:50%;font-size:13px;color:#5f6873;cursor:pointer;">✕</button>
  </div>`;

/**
 * "My gyms": the athlete's main gym plus any others they train at. Machine / cable /
 * dumbbell exercises are tracked per gym, so a second gym gets its own numbers.
 * With no gym yet it opens straight on the add form.
 */
export function openGyms(athleteId: string, onChange?: () => void): void {
  const root = document.createElement("div");
  root.dataset.sscPopup = "gyms";
  root.style.cssText = OVERLAY;
  let editing: Gym | "new" | null = getGyms(athleteId).gyms.length ? null : "new";

  const form = (g: Gym | null, type: GymType | null) => {
    const first = !getGyms(athleteId).gyms.length;
    return `<div style="${CARD}">
      ${head(first ? "ADD YOUR MAIN GYM" : g ? "EDIT GYM" : "ADD A GYM", first ? "Where you usually train. Add a second gym later — your machine and cable exercises are then tracked per gym." : "Machine, cable and dumbbell exercises get their own numbers per gym.")}
      <label style="${LABEL}">GYM NAME</label>
      <input data-g-name style="${INPUT}" placeholder="Gym name" value="${esc(g?.name ?? "")}" autocomplete="off">
      <label style="${LABEL}">CITY</label>
      <input data-g-city style="${INPUT}" placeholder="City" value="${esc(g?.city ?? "")}" autocomplete="off">
      <label style="${LABEL}">TYPE OF GYM</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${GYM_TYPES.map((t) => { const on = type === t.id; return `<button data-g-type="${t.id}" style="min-height:40px;padding:8px;border-radius:10px;cursor:pointer;font:600 12px/1.2 Barlow,sans-serif;text-align:center;border:1.5px solid ${on ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.3)"};background:${on ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.06)"};color:${on ? "#f2f2f3" : "rgb(var(--a-navy-rgb))"};">${t.label}</button>`; }).join("")}
      </div>
      <button data-g-save style="${PRIMARY}">SAVE</button>
      ${first ? "" : `<button data-g-back style="width:100%;margin-top:6px;padding:10px;border:none;background:transparent;color:rgb(138,146,156);font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">BACK</button>`}
    </div>`;
  };

  const list = () => {
    const { gyms, mainId } = getGyms(athleteId);
    const row = (g: Gym) => {
      const main = g.id === mainId;
      return `<div style="padding:12px;border:1.5px solid ${main ? "rgba(var(--a-accent-rgb),.55)" : "rgba(29,31,32,.1)"};border-radius:14px;background:#fff;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">📍</span>
          <div style="flex:1 1 0;min-width:0;">
            <div style="font:600 16px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:rgb(var(--a-navy-rgb));">${esc(g.name)}${main ? ` <span style="margin-left:4px;padding:2px 6px;border-radius:5px;background:rgb(var(--a-navy-rgb));color:#f2f2f3;font:700 8px/1 Barlow,sans-serif;letter-spacing:.12em;vertical-align:middle;">MAIN</span>` : ""}</div>
            <div style="margin-top:3px;font:400 11px/1.2 Barlow,sans-serif;color:rgb(138,146,156);">${esc([g.city, GYM_TYPE_SHORT[g.type]].filter(Boolean).join(" · "))}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          ${main ? "" : `<button data-g-main="${g.id}" style="flex:1 1 0;height:34px;border-radius:9px;border:1px solid rgba(var(--a-accent-rgb),.45);background:rgba(var(--a-accent-rgb),.08);color:rgb(var(--a-navy-rgb));font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">MAKE MAIN</button>`}
          <button data-g-edit="${g.id}" style="flex:1 1 0;height:34px;border-radius:9px;border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(var(--a-navy-rgb));font:600 11px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">EDIT</button>
          <button data-g-del="${g.id}" title="Remove" style="flex:0 0 auto;width:38px;height:34px;border-radius:9px;border:1px solid rgba(29,31,32,.14);background:transparent;color:rgb(160,96,96);font-size:14px;cursor:pointer;">✕</button>
        </div>
      </div>`;
    };
    return `<div style="${CARD}">
      ${head("MY GYMS", "Your main gym is the default for every session. Train somewhere else? Pick that gym at the top of the session.")}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${gyms.map(row).join("")}</div>
      <button data-g-add style="${PRIMARY}">+ ADD ${gyms.length ? "ANOTHER" : "A"} GYM</button>
    </div>`;
  };

  let pickedType: GymType | null = null; // the type tapped in the form (before saving)
  const render = () => {
    const base = editing && editing !== "new" ? editing : null;
    root.innerHTML = editing ? form(base, pickedType ?? base?.type ?? null) : list();
  };
  render();

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-g-close]")) { root.remove(); onChange?.(); return; }
    const typeBtn = t.closest<HTMLElement>("[data-g-type]");
    if (typeBtn) {
      const name = root.querySelector<HTMLInputElement>("[data-g-name]")?.value ?? "";
      const city = root.querySelector<HTMLInputElement>("[data-g-city]")?.value ?? "";
      pickedType = typeBtn.dataset.gType as GymType;
      render();
      const n = root.querySelector<HTMLInputElement>("[data-g-name]"); if (n) n.value = name;
      const c = root.querySelector<HTMLInputElement>("[data-g-city]"); if (c) c.value = city;
      return;
    }
    if (t.closest("[data-g-save]")) {
      const name = root.querySelector<HTMLInputElement>("[data-g-name]")?.value.trim() ?? "";
      const city = root.querySelector<HTMLInputElement>("[data-g-city]")?.value.trim() ?? "";
      const type = pickedType ?? (editing !== "new" && editing ? editing.type : null);
      if (!name) { alert("Give your gym a name."); return; }
      if (!type) { alert("Pick the type of gym."); return; }
      saveGym(athleteId, { id: editing !== "new" && editing ? editing.id : undefined, name, city, type });
      editing = null; pickedType = null;
      render(); onChange?.();
      return;
    }
    if (t.closest("[data-g-back]")) { editing = null; pickedType = null; render(); return; }
    if (t.closest("[data-g-add]")) { editing = "new"; pickedType = null; render(); return; }
    const ed = t.closest<HTMLElement>("[data-g-edit]");
    if (ed) { editing = getGyms(athleteId).gyms.find((g) => g.id === ed.dataset.gEdit) ?? null; pickedType = null; render(); return; }
    const mk = t.closest<HTMLElement>("[data-g-main]");
    if (mk) { setMainGym(athleteId, mk.dataset.gMain!); render(); onChange?.(); return; }
    const del = t.closest<HTMLElement>("[data-g-del]");
    if (del) {
      const g = getGyms(athleteId).gyms.find((x) => x.id === del.dataset.gDel);
      if (g && confirm(`Remove ${g.name}? Sessions you trained there keep their numbers.`)) { removeGym(athleteId, g.id); render(); onChange?.(); }
    }
  });
  document.body.appendChild(root);
  if (editing) root.querySelector<HTMLInputElement>("[data-g-name]")?.focus();
}

/** Small picker: which gym is this session at? (plus a link to manage gyms) */
export function pickSessionGym(athleteId: string, currentId: string | undefined, onPick: (gymId: string) => void): void {
  const { gyms, mainId } = getGyms(athleteId);
  const root = document.createElement("div");
  root.dataset.sscPopup = "gympick";
  root.style.cssText = OVERLAY;
  root.innerHTML = `<div style="${CARD}">
    ${head("WHICH GYM TODAY?", "Machine, cable and dumbbell exercises show your numbers from this gym.")}
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
      ${gyms.map((g) => {
        const on = g.id === currentId;
        return `<button data-gp="${g.id}" style="display:flex;align-items:center;gap:10px;width:100%;padding:12px;border-radius:12px;cursor:pointer;text-align:left;border:1.5px solid ${on ? "rgb(var(--a-navy-rgb))" : "rgba(var(--a-accent-rgb),.3)"};background:${on ? "rgb(var(--a-navy-rgb))" : "#fff"};">
          <span style="font-size:16px;">📍</span>
          <span style="flex:1 1 0;min-width:0;">
            <span style="display:block;font:600 15px/1.1 'Barlow Condensed',sans-serif;letter-spacing:.02em;color:${on ? "#f2f2f3" : "rgb(var(--a-navy-rgb))"};">${esc(g.name)}${g.id === mainId ? " · MAIN" : ""}</span>
            <span style="display:block;margin-top:3px;font:400 11px/1.2 Barlow,sans-serif;color:${on ? "rgba(242,242,243,.7)" : "rgb(138,146,156)"};">${esc([g.city, GYM_TYPE_SHORT[g.type]].filter(Boolean).join(" · "))}</span>
          </span>
          ${on ? '<span style="color:#f2f2f3;">✓</span>' : ""}
        </button>`;
      }).join("")}
    </div>
    <button data-gp-manage style="width:100%;margin-top:10px;padding:10px;border:none;background:transparent;color:rgb(var(--a-accent2-rgb));font:600 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.1em;cursor:pointer;">MANAGE MY GYMS</button>
  </div>`;
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === root || t.closest("[data-g-close]")) { root.remove(); return; }
    const p = t.closest<HTMLElement>("[data-gp]");
    if (p) { root.remove(); onPick(p.dataset.gp!); return; }
    if (t.closest("[data-gp-manage]")) { root.remove(); openGyms(athleteId); }
  });
  document.body.appendChild(root);
}
