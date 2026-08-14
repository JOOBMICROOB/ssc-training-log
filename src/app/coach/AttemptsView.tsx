import { useState, type ReactNode, type CSSProperties } from "react";
import { getDashboardModel } from "../../lib/data/athleteData";
import { ipfGlPoints, type Sex } from "../../lib/calc/scores";
import { fmtKg } from "../../lib/calc/records";
import { getClients } from "./coachData";
import { getPlan, savePlan, autoWarmups, type AttemptPlan, type LiftKey, type Which, type AttemptStatus } from "./coachAttempts";
import { Avatar } from "./Avatar";

/**
 * Competing → Attempts. The coach's meet tool: type low/neutral/high options for
 * each attempt (% of 1RM shown beside each), set target records (total + per
 * lift) and watch the gap to hit them, compare GL against a rival, get a warm-up
 * ladder, and on meet day tick each attempt hit/miss for a live total + GL.
 */

const LIFTS: LiftKey[] = ["squat", "bench", "deadlift"];
const WHICHES: Which[] = ["opener", "second", "third"];
const ROWS = ["low", "neutral", "high"] as const;
const LABEL: Record<LiftKey, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
const WLABEL: Record<Which, string> = { opener: "Opener", second: "Second", third: "Third" };
const num = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const cat = (level: "national" | "international") => (level === "international" ? "equipped_full" : "raw_full");

export function AttemptsView({ athleteId, athleteName, avatar }: { athleteId: string; athleteName: string; avatar?: string }) {
  const model = getDashboardModel(athleteId);
  const sex: Sex = model.athlete.sex === "male" ? "male" : "female";
  const bw = num(model.bodyweightAvg4w) || num(model.athlete.bodyweightTile);
  const rmOf = (p: string) => num(model.prs.find((x) => x.lift.startsWith(p))?.value ?? "");
  const rm = { squat: rmOf("SQUAT"), bench: rmOf("BENCH"), deadlift: rmOf("DEAD") };
  const meets = model.competitions.filter((c) => model.optedInComps.includes(c.id)).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar src={avatar} name={athleteName} size={40} />Attempts · {athleteName}</h1>
          <p className="cc-sub">Type low/neutral/high for each attempt, set target records, then tick hit/miss live on meet day — total + IPF GL update instantly.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Bodyweight" v={bw ? `${fmtKg(bw)} kg` : "—"} />
          <Stat k="Comp total" v={model.totals.comp === "—" ? "—" : `${model.totals.comp} kg`} />
          <Stat k="Best GL" v={model.gl.best} />
        </div>
      </div>

      {meets.length === 0 ? (
        <div className="cc-placeholder">Opt {athleteName} into a meet (Competing → Calendar) to plan attempts.</div>
      ) : (
        meets.map((c) => <AttemptCard key={c.id} athleteId={athleteId} athleteName={athleteName} compId={c.id} title={c.name} date={c.date} level={c.level} rm={rm} bw={bw} sex={sex} />)
      )}
    </div>
  );
}

function AttemptCard({ athleteId, athleteName, compId, title, date, level, rm, bw, sex }: {
  athleteId: string; athleteName: string; compId: string; title: string; date: string;
  level: "national" | "international"; rm: Record<LiftKey, number>; bw: number; sex: Sex;
}) {
  const [plan, setPlan] = useState<AttemptPlan>(() => getPlan(athleteId, compId, rm));
  const set = (next: AttemptPlan) => { setPlan(next); savePlan(athleteId, compId, next); };
  const category = cat(level);

  const setVal = (l: LiftKey, w: Which, r: (typeof ROWS)[number], v: number) =>
    set({ ...plan, attempts: { ...plan.attempts, [l]: { ...plan.attempts[l], [w]: { ...plan.attempts[l][w], [r]: v } } } });
  const setRm = (l: LiftKey, v: number) => set({ ...plan, rm: { ...plan.rm, [l]: v } });
  const setTarget = (patch: Partial<AttemptPlan["targets"]>) => set({ ...plan, targets: { ...plan.targets, ...patch } });
  const setGoal = (patch: Partial<AttemptPlan["goals"]>) => set({ ...plan, goals: { ...plan.goals, ...patch } });
  const setWarmup = (l: LiftKey, v: string) => set({ ...plan, warmups: { ...plan.warmups, [l]: v } });
  const setRival = (id: string) => set({ ...plan, rivalId: id });
  const cycle = (l: LiftKey, w: Which) => {
    const cur = plan.status[l][w];
    const next: AttemptStatus = cur === "pending" ? "hit" : cur === "hit" ? "miss" : "pending";
    set({ ...plan, status: { ...plan.status, [l]: { ...plan.status[l], [w]: next } } });
  };

  const pct = (l: LiftKey, v: number) => (plan.rm[l] > 0 ? Math.round((v / plan.rm[l]) * 100) : 0);
  const rowTotal = (w: Which, r: (typeof ROWS)[number]) => LIFTS.reduce((s, l) => s + plan.attempts[l][w][r], 0);
  const projected = rowTotal("third", "neutral"); // planned best
  const projGl = ipfGlPoints(sex, bw, projected, category);

  const bestHit = (l: LiftKey) => {
    let best = 0;
    for (const w of WHICHES) if (plan.status[l][w] === "hit") best = Math.max(best, plan.attempts[l][w].neutral);
    return best;
  };
  const anyTicked = LIFTS.some((l) => WHICHES.some((w) => plan.status[l][w] !== "pending"));
  const liveTotal = LIFTS.reduce((s, l) => s + bestHit(l), 0);
  const liveGl = ipfGlPoints(sex, bw, liveTotal, category);

  const rivals = getClients().filter((c) => c.athleteId !== athleteId);
  const rival = plan.rivalId ? rivalNumbers(plan.rivalId, compId, category) : null;
  const warmup = (l: LiftKey) => (plan.warmups[l].trim() || autoWarmups(plan.attempts[l].opener.neutral));
  const d = new Date(date + "T00:00:00");
  const G = "112px 1fr 1fr 1fr 78px"; // grid columns

  return (
    <div className="cc-panel cc-corner" style={{ position: "relative", marginTop: 16 }}>
      <i />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ font: "600 18px/1 var(--font-heading)", letterSpacing: ".02em", color: "var(--navy)" }}>{title}
          <span className={`cc-level ${level === "international" ? "cc-level-int" : "cc-level-nat"}`} style={{ marginLeft: 10 }}>{level === "international" ? "INTERNATIONAL" : "NATIONAL"}</span>
        </div>
        <div className="cc-cell-s">{d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</div>
      </div>

      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <div style={{ minWidth: 540 }}>
          <Grid cols={G} head><span /> {LIFTS.map((l) => <C key={l}>{LABEL[l]}</C>)}<C>TOTAL</C></Grid>
          <Grid cols={G}>
            <L>Current 1RM</L>
            {LIFTS.map((l) => <C key={l}><input className="cc-in" style={IN} value={plan.rm[l] || ""} onChange={(e) => setRm(l, num(e.target.value))} /></C>)}
            <Tot v={LIFTS.reduce((s, l) => s + plan.rm[l], 0)} muted />
          </Grid>

          {WHICHES.map((w) => (
            <div key={w} style={{ marginTop: 8, borderTop: "1px solid var(--divider)", paddingTop: 6 }}>
              <div style={{ font: "600 10px/1 var(--font-heading)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent-700)", margin: "0 0 4px 2px" }}>{WLABEL[w]}</div>
              {ROWS.map((r) => (
                <Grid key={r} cols={G}>
                  <L sub={r !== "neutral"}>{r}</L>
                  {LIFTS.map((l) => (
                    <span key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ font: "600 8.5px/1 var(--font-body)", color: "var(--accent-700)" }}>{pct(l, plan.attempts[l][w][r])}%</span>
                      <input className="cc-in" style={{ ...IN, ...(r === "neutral" ? { borderColor: "var(--accent)", fontWeight: 700 } : { opacity: 0.85 }) }}
                        value={plan.attempts[l][w][r] || ""} onChange={(e) => setVal(l, w, r, num(e.target.value))} />
                      {r === "neutral" && <StatusChip status={plan.status[l][w]} onClick={() => cycle(l, w)} />}
                    </span>
                  ))}
                  <Tot v={rowTotal(w, r)} bold={r === "neutral"} sub={r !== "neutral"} />
                </Grid>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* live tracker */}
      <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: anyTicked ? "color-mix(in srgb, var(--good) 10%, transparent)" : "color-mix(in srgb, var(--navy) 4%, transparent)", border: `1px solid ${anyTicked ? "color-mix(in srgb, var(--good) 35%, transparent)" : "var(--divider)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <span className="cc-side-k" style={{ marginBottom: 0 }}>Live · confirmed so far</span>
          <span className="cc-cell-s">tap a neutral attempt: — → ✓ hit → ✗ miss</span>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
          {LIFTS.map((l) => <Metric key={l} k={LABEL[l]} v={bestHit(l) ? `${fmtKg(bestHit(l))} kg` : "—"} />)}
          <Metric k="Total" v={liveTotal ? `${fmtKg(liveTotal)} kg` : "—"} big />
          <Metric k="Live GL" v={liveTotal ? liveGl.toFixed(1) : "—"} big />
        </div>
      </div>

      {/* projections */}
      <div className="cc-att-summary" style={{ marginTop: 14 }}>
        <div><span className="cc-vlk">Planned total</span><span className="cc-vlv">{fmtKg(projected)}<em> kg</em></span></div>
        <div><span className="cc-vlk">IPF GL (projected)</span><span className="cc-vlv">{projGl ? projGl.toFixed(1) : "—"}</span></div>
        <div><span className="cc-vlk">If openers land</span><span className="cc-vlv">{fmtKg(rowTotal("opener", "neutral"))}<em> kg</em></span></div>
      </div>

      {/* target records */}
      <div className="cc-side-k" style={{ marginTop: 16 }}>Target records <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted)", fontWeight: 400 }}>· gap = what's still needed off the planned third</span></div>
      <div style={{ marginTop: 6, overflowX: "auto" }}>
        <div style={{ minWidth: 460 }}>
          <Grid cols={G}>
            <L>Target</L>
            {LIFTS.map((l) => <C key={l}><input className="cc-in" style={IN} value={plan.targets[l] || ""} onChange={(e) => setTarget({ [l]: num(e.target.value) } as Partial<AttemptPlan["targets"]>)} placeholder="—" /></C>)}
            <C><input className="cc-in" style={IN} value={plan.targets.total || ""} onChange={(e) => setTarget({ total: num(e.target.value) })} placeholder="—" /></C>
          </Grid>
          <Grid cols={G}>
            <L sub>Needed</L>
            {LIFTS.map((l) => <Gap key={l} target={plan.targets[l]} have={plan.attempts[l].third.neutral} />)}
            <Gap target={plan.targets.total} have={projected} />
          </Grid>
        </div>
      </div>

      {/* goals + rival */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 16 }}>
        <GoalField label="Target placement"><input className="cc-db-search" value={plan.goals.placement} onChange={(e) => setGoal({ placement: e.target.value })} placeholder="e.g. 1st · podium" /></GoalField>
        <GoalField label="Target GL" note={plan.goals.gl ? gap(projGl, plan.goals.gl, "gl") : null}><input className="cc-db-search" value={plan.goals.gl || ""} onChange={(e) => setGoal({ gl: num(e.target.value) })} placeholder="—" /></GoalField>
      </div>

      <div className="cc-side-k" style={{ marginTop: 16 }}>Head-to-head · GL</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        <select className="cc-db-search" style={{ maxWidth: 220 }} value={plan.rivalId} onChange={(e) => setRival(e.target.value)}>
          <option value="">Compare against…</option>
          {rivals.map((r) => <option key={r.athleteId} value={r.athleteId}>{r.name}</option>)}
        </select>
        {rival && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <Metric k={`${rival.name} · total`} v={rival.total ? `${fmtKg(rival.total)} kg` : "—"} />
            <Metric k="Their GL" v={rival.gl ? rival.gl.toFixed(1) : "—"} />
            <span style={{ font: "700 12px/1.2 var(--font-heading)", padding: "6px 11px", borderRadius: 999, ...aheadStyle(projGl - rival.gl) }}>
              {projGl === rival.gl ? "Level on GL" : projGl > rival.gl ? `${athleteName.split(" ")[0]} ahead by ${(projGl - rival.gl).toFixed(1)} GL` : `Behind by ${(rival.gl - projGl).toFixed(1)} GL`}
            </span>
          </div>
        )}
      </div>

      {/* warm-ups */}
      <div className="cc-side-k" style={{ marginTop: 16 }}>Warm-ups to the opener <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted)", fontWeight: 400 }}>· editable, blank = auto</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {LIFTS.map((l) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "var(--navy)", font: "600 11px/1 var(--font-heading)", width: 64, flex: "0 0 auto" }}>{LABEL[l]}</strong>
            <input className="cc-db-search" style={{ flex: 1 }} value={plan.warmups[l]} onChange={(e) => setWarmup(l, e.target.value)} placeholder={autoWarmups(plan.attempts[l].opener.neutral) || "set an opener first"} />
          </div>
        ))}
      </div>
      <p className="cc-cell-s" style={{ marginTop: 8 }}>{LIFTS.map((l) => `${LABEL[l]} ${warmup(l) || "—"}`).join("  ·  ")}</p>
    </div>
  );
}

function rivalNumbers(rivalId: string, compId: string, category: "equipped_full" | "raw_full") {
  const m = getDashboardModel(rivalId);
  const n = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
  const rmOf = (p: string) => n(m.prs.find((x) => x.lift.startsWith(p))?.value ?? "");
  const rrm = { squat: rmOf("SQUAT"), bench: rmOf("BENCH"), deadlift: rmOf("DEAD") };
  const rp = getPlan(rivalId, compId, rrm);
  const total = LIFTS.reduce((s, l) => s + rp.attempts[l].third.neutral, 0);
  const rbw = n(m.bodyweightAvg4w) || n(m.athlete.bodyweightTile);
  const rsex: Sex = m.athlete.sex === "male" ? "male" : "female";
  return { name: m.athlete.firstName ? m.athlete.firstName[0] + m.athlete.firstName.slice(1).toLowerCase() : "Rival", total, gl: ipfGlPoints(rsex, rbw, total, category) };
}

function gap(actual: number, goal: number, kind: "kg" | "gl"): { text: string; ok: boolean } | null {
  if (!goal) return null;
  const diff = Math.round((actual - goal) * 10) / 10;
  return diff >= 0 ? { text: `+${kind === "kg" ? fmtKg(diff) : diff.toFixed(1)}`, ok: true } : { text: `${kind === "kg" ? fmtKg(diff) : diff.toFixed(1)}`, ok: false };
}
function aheadStyle(diff: number): CSSProperties {
  if (diff === 0) return { background: "color-mix(in srgb, var(--muted) 18%, transparent)", color: "var(--navy)" };
  return diff > 0 ? { background: "color-mix(in srgb, var(--good) 18%, transparent)", color: "var(--good)" } : { background: "color-mix(in srgb, var(--bad) 16%, transparent)", color: "var(--bad)" };
}

// ---- layout atoms ----
const IN: CSSProperties = { width: 62, textAlign: "center" };
function Grid({ cols, children, head }: { cols: string; children: ReactNode; head?: boolean }) {
  return <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 6, padding: "3px 0", ...(head ? { font: "600 9px/1 var(--font-body)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" } : {}) }}>{children}</div>;
}
function C({ children }: { children: ReactNode }) { return <span style={{ textAlign: "center" }}>{children}</span>; }
function L({ children, sub }: { children: ReactNode; sub?: boolean }) {
  return <span style={{ font: sub ? "400 9px/1 var(--font-body)" : "600 11px/1 var(--font-heading)", textTransform: sub ? "none" : "none", color: sub ? "var(--muted)" : "var(--navy)" }}>{children}</span>;
}
function Tot({ v, muted, bold, sub }: { v: number; muted?: boolean; bold?: boolean; sub?: boolean }) {
  return <span style={{ textAlign: "center", font: `${bold ? 700 : sub ? 500 : 600} ${sub ? 12 : 14}px/1 var(--font-heading)`, color: muted || sub ? "var(--muted)" : "var(--navy)" }}>{fmtKg(v)}</span>;
}
function Gap({ target, have }: { target: number; have: number }) {
  if (!target) return <C><span style={{ color: "var(--muted)" }}>—</span></C>;
  const diff = Math.round((have - target) * 10) / 10;
  const ok = diff >= 0;
  return <C><span style={{ font: "700 12px/1 var(--font-heading)", color: ok ? "var(--good)" : "var(--bad)" }}>{ok ? "✓" : `+${fmtKg(-diff)}`}</span></C>;
}
function StatusChip({ status, onClick }: { status: AttemptStatus; onClick: () => void }) {
  const s = status === "hit" ? { bg: "var(--good)", fg: "#fff", t: "✓" } : status === "miss" ? { bg: "var(--bad)", fg: "#fff", t: "✗" } : { bg: "transparent", fg: "var(--muted)", t: "—" };
  return <button onClick={onClick} title="hit / miss / clear" style={{ width: 40, height: 18, borderRadius: 6, border: status === "pending" ? "1px solid var(--divider)" : "none", background: s.bg, color: s.fg, font: "700 10px/1 var(--font-heading)", cursor: "pointer" }}>{s.t}</button>;
}
function Metric({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return <div><div style={{ font: "600 8.5px/1 var(--font-body)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>{k}</div><div style={{ font: `700 ${big ? 20 : 15}px/1.1 var(--font-heading)`, color: "var(--navy)", marginTop: 3 }}>{v}</div></div>;
}
function GoalField({ label, note, children }: { label: string; note?: { text: string; ok: boolean } | null; children: ReactNode }) {
  return <label style={{ display: "block" }}><span style={{ display: "flex", justifyContent: "space-between", gap: 6, font: "600 9px/1.3 var(--font-body)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{label}{note && <span style={{ color: note.ok ? "var(--good)" : "var(--bad)", textTransform: "none", letterSpacing: 0 }}>{note.text}</span>}</span>{children}</label>;
}
function Stat({ k, v }: { k: string; v: string }) {
  return <div className="cc-stat cc-corner" style={{ position: "relative" }}><i /><div className="cc-stat-k">{k}</div><div className="cc-stat-v" style={{ fontSize: 18 }}>{v}</div></div>;
}
