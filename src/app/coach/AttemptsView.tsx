import { useState, type ReactNode, type CSSProperties } from "react";
import { getDashboardModel } from "../../lib/data/athleteData";
import { ipfGlPoints, type Sex } from "../../lib/calc/scores";
import { fmtKg } from "../../lib/calc/records";
import { getClients } from "./coachData";
import { getPlan, savePlan, autoWarmups, type AttemptPlan, type LiftKey, type Which, type AttemptStatus } from "./coachAttempts";
import { Avatar } from "./Avatar";

/**
 * Competing → Attempts. A full attempt-selection + meet-day sheet per meet the
 * athlete is entered in: current 1RMs, openers/seconds/thirds with an adjustable
 * low/high spread and % of 1RM, coach-written goals (placement / total / GL), a
 * head-to-head GL comparison against another athlete, editable warm-ups, and a
 * live tracker — tick each attempt hit or missed and the confirmed total + GL
 * update instantly. Saves per meet.
 */

const LIFTS: LiftKey[] = ["squat", "bench", "deadlift"];
const WHICHES: Which[] = ["opener", "second", "third"];
const LABEL: Record<LiftKey, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
const WLABEL: Record<Which, string> = { opener: "Opener", second: "Second", third: "Third" };
const num = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const category = (level: "national" | "international") => (level === "international" ? "equipped_full" : "raw_full");

export function AttemptsView({ athleteId, athleteName, avatar }: { athleteId: string; athleteName: string; avatar?: string }) {
  const model = getDashboardModel(athleteId);
  const sex: Sex = model.athlete.sex === "male" ? "male" : "female";
  const bw = num(model.bodyweightAvg4w) || num(model.athlete.bodyweightTile);
  const rmOf = (prefix: string) => num(model.prs.find((p) => p.lift.startsWith(prefix))?.value ?? "");
  const rm = { squat: rmOf("SQUAT"), bench: rmOf("BENCH"), deadlift: rmOf("DEAD") };

  const meets = model.competitions
    .filter((c) => model.optedInComps.includes(c.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar src={avatar} name={athleteName} size={40} />Attempts · {athleteName}</h1>
          <p className="cc-sub">Plan openers/seconds/thirds, set goals, compare GL against a rival, then track hit/miss live on meet day — the total + IPF GL update instantly.</p>
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
        meets.map((c) => (
          <AttemptCard key={c.id} athleteId={athleteId} athleteName={athleteName} compId={c.id} title={c.name} date={c.date} level={c.level} rm={rm} bw={bw} sex={sex} />
        ))
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
  const cat = category(level);

  const setAttempt = (lift: LiftKey, which: Which, v: number) =>
    set({ ...plan, attempts: { ...plan.attempts, [lift]: { ...plan.attempts[lift], [which]: v } } });
  const setRm = (lift: LiftKey, v: number) => set({ ...plan, rm: { ...plan.rm, [lift]: v } });
  const setSpread = (v: number) => set({ ...plan, spread: Math.max(0, v) });
  const setGoal = (patch: Partial<AttemptPlan["goals"]>) => set({ ...plan, goals: { ...plan.goals, ...patch } });
  const setWarmup = (lift: LiftKey, v: string) => set({ ...plan, warmups: { ...plan.warmups, [lift]: v } });
  const setRival = (id: string) => set({ ...plan, rivalId: id });
  const cycleStatus = (lift: LiftKey, which: Which) => {
    const cur = plan.status[lift][which];
    const next: AttemptStatus = cur === "pending" ? "hit" : cur === "hit" ? "miss" : "pending";
    set({ ...plan, status: { ...plan.status, [lift]: { ...plan.status[lift], [which]: next } } });
  };

  const pct = (lift: LiftKey, v: number) => (plan.rm[lift] > 0 ? Math.round((v / plan.rm[lift]) * 100) : 0);
  const total = (which: Which) => LIFTS.reduce((s, l) => s + plan.attempts[l][which], 0);
  const low = (l: LiftKey, w: Which) => Math.max(0, plan.attempts[l][w] - plan.spread);
  const high = (l: LiftKey, w: Which) => plan.attempts[l][w] + plan.spread;

  const projected = total("third");
  const openersTotal = total("opener");
  const projGl = ipfGlPoints(sex, bw, projected, cat);

  // Live (meet-day): heaviest HIT attempt per lift → confirmed total + GL.
  const bestHit = (l: LiftKey) => {
    let best = 0;
    for (const w of WHICHES) if (plan.status[l][w] === "hit") best = Math.max(best, plan.attempts[l][w]);
    return best;
  };
  const anyTicked = LIFTS.some((l) => WHICHES.some((w) => plan.status[l][w] !== "pending"));
  const liveTotal = LIFTS.reduce((s, l) => s + bestHit(l), 0);
  const liveGl = ipfGlPoints(sex, bw, liveTotal, cat);

  // Rival head-to-head (another athlete's projected numbers for this meet).
  const rivals = getClients().filter((c) => c.athleteId !== athleteId);
  const rival = plan.rivalId ? rivalNumbers(plan.rivalId, compId, cat) : null;

  const warmup = (l: LiftKey) => (plan.warmups[l].trim() || autoWarmups(plan.attempts[l].opener));
  const d = new Date(date + "T00:00:00");
  const CELL = "1fr 1fr 1fr 84px";

  return (
    <div className="cc-panel cc-corner" style={{ position: "relative", marginTop: 16 }}>
      <i />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ font: "600 18px/1 var(--font-heading)", letterSpacing: ".02em", color: "var(--navy)" }}>{title}
          <span className={`cc-level ${level === "international" ? "cc-level-int" : "cc-level-nat"}`} style={{ marginLeft: 10 }}>{level === "international" ? "INTERNATIONAL" : "NATIONAL"}</span>
        </div>
        <div className="cc-cell-s">{d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</div>
      </div>

      {/* ---- attempt grid ---- */}
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <div style={{ minWidth: 520 }}>
          <Row label="" cells={CELL} head>
            {LIFTS.map((l) => <span key={l} style={{ textAlign: "center" }}>{LABEL[l]}</span>)}
            <span style={{ textAlign: "center" }}>TOTAL</span>
          </Row>
          {/* 1RM */}
          <Row label="Current 1RM" cells={CELL}>
            {LIFTS.map((l) => (
              <span key={l} style={{ textAlign: "center" }}>
                <input className="cc-in" value={plan.rm[l] || ""} onChange={(e) => setRm(l, num(e.target.value))} style={{ width: 66, textAlign: "center" }} />
              </span>
            ))}
            <Tot v={LIFTS.reduce((s, l) => s + plan.rm[l], 0)} muted />
          </Row>

          {/* spread control */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", font: "600 10px/1 var(--font-body)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Low / high spread
            <button className="cc-wk-del" onClick={() => setSpread(plan.spread - 2.5)} title="Narrower">−</button>
            <span style={{ font: "700 12px/1 var(--font-heading)", color: "var(--navy)" }}>± {fmtKg(plan.spread)} kg</span>
            <button className="cc-wk-del" onClick={() => setSpread(plan.spread + 2.5)} title="Wider">+</button>
          </div>

          {WHICHES.map((w) => (
            <div key={w} style={{ marginTop: 6, borderTop: "1px solid var(--divider)", paddingTop: 6 }}>
              <Row label="low" cells={CELL} sub>
                {LIFTS.map((l) => <NumRO key={l} v={low(l, w)} pct={pct(l, low(l, w))} />)}
                <Tot v={LIFTS.reduce((s, l) => s + low(l, w), 0)} sub />
              </Row>
              <Row label={WLABEL[w]} cells={CELL}>
                {LIFTS.map((l) => (
                  <span key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <span style={{ font: "600 9px/1 var(--font-body)", color: "var(--accent-700)" }}>{pct(l, plan.attempts[l][w])}%</span>
                    <input className="cc-in" value={plan.attempts[l][w] || ""} onChange={(e) => setAttempt(l, w, num(e.target.value))} style={{ width: 66, textAlign: "center" }} />
                    <StatusChip status={plan.status[l][w]} onClick={() => cycleStatus(l, w)} />
                  </span>
                ))}
                <Tot v={total(w)} />
              </Row>
              <Row label="high" cells={CELL} sub>
                {LIFTS.map((l) => <NumRO key={l} v={high(l, w)} pct={pct(l, high(l, w))} />)}
                <Tot v={LIFTS.reduce((s, l) => s + high(l, w), 0)} sub />
              </Row>
            </div>
          ))}
        </div>
      </div>

      {/* ---- live tracker ---- */}
      <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: anyTicked ? "color-mix(in srgb, var(--good) 10%, transparent)" : "color-mix(in srgb, var(--navy) 4%, transparent)", border: `1px solid ${anyTicked ? "color-mix(in srgb, var(--good) 35%, transparent)" : "var(--divider)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <span className="cc-side-k" style={{ marginBottom: 0 }}>Live · confirmed so far</span>
          <span className="cc-cell-s">tap an attempt: — → ✓ hit → ✗ miss</span>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
          {LIFTS.map((l) => <Metric key={l} k={LABEL[l]} v={bestHit(l) ? `${fmtKg(bestHit(l))} kg` : "—"} />)}
          <Metric k="Total" v={liveTotal ? `${fmtKg(liveTotal)} kg` : "—"} big />
          <Metric k="Live GL" v={liveTotal ? liveGl.toFixed(1) : "—"} big />
        </div>
      </div>

      {/* ---- projections + goals ---- */}
      <div className="cc-att-summary" style={{ marginTop: 14 }}>
        <div><span className="cc-vlk">If openers land</span><span className="cc-vlv">{fmtKg(openersTotal)}<em> kg</em></span></div>
        <div><span className="cc-vlk">If thirds land</span><span className="cc-vlv">{fmtKg(projected)}<em> kg</em></span></div>
        <div><span className="cc-vlk">IPF GL (projected)</span><span className="cc-vlv">{projGl ? projGl.toFixed(1) : "—"}</span></div>
      </div>

      <div className="cc-side-k" style={{ marginTop: 16 }}>Goals</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 6 }}>
        <GoalField label="Target placement">
          <input className="cc-db-search" value={plan.goals.placement} onChange={(e) => setGoal({ placement: e.target.value })} placeholder="e.g. 1st · podium" />
        </GoalField>
        <GoalField label="Target total (kg)" note={goalDelta(projected, plan.goals.total, "kg")}>
          <input className="cc-db-search" value={plan.goals.total || ""} onChange={(e) => setGoal({ total: num(e.target.value) })} placeholder="—" />
        </GoalField>
        <GoalField label="Target GL" note={goalDelta(projGl, plan.goals.gl, "gl")}>
          <input className="cc-db-search" value={plan.goals.gl || ""} onChange={(e) => setGoal({ gl: num(e.target.value) })} placeholder="—" />
        </GoalField>
      </div>

      {/* ---- rival compare ---- */}
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

      {/* ---- warm-ups (editable) ---- */}
      <div className="cc-side-k" style={{ marginTop: 16 }}>Warm-ups to the opener <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--muted)", fontWeight: 400 }}>· editable, blank = auto</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {LIFTS.map((l) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ color: "var(--navy)", font: "600 11px/1 var(--font-heading)", width: 64, flex: "0 0 auto" }}>{LABEL[l]}</strong>
            <input className="cc-db-search" style={{ flex: 1 }} value={plan.warmups[l]} onChange={(e) => setWarmup(l, e.target.value)} placeholder={autoWarmups(plan.attempts[l].opener) || "set an opener first"} />
          </div>
        ))}
      </div>
      <p className="cc-cell-s" style={{ marginTop: 8 }}>Warm-up plan: {LIFTS.map((l) => `${LABEL[l]} ${warmup(l) || "—"}`).join("  ·  ")}</p>
    </div>
  );
}

/** A rival athlete's projected total + GL for the same meet (from their plan). */
function rivalNumbers(rivalId: string, compId: string, cat: "equipped_full" | "raw_full") {
  const m = getDashboardModel(rivalId);
  const n = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
  const rmOf = (p: string) => n(m.prs.find((x) => x.lift.startsWith(p))?.value ?? "");
  const rrm = { squat: rmOf("SQUAT"), bench: rmOf("BENCH"), deadlift: rmOf("DEAD") };
  const rp = getPlan(rivalId, compId, rrm);
  const total = LIFTS.reduce((s, l) => s + rp.attempts[l].third, 0);
  const rbw = n(m.bodyweightAvg4w) || n(m.athlete.bodyweightTile);
  const rsex: Sex = m.athlete.sex === "male" ? "male" : "female";
  const gl = ipfGlPoints(rsex, rbw, total, cat);
  const name = m.athlete.firstName ? m.athlete.firstName[0] + m.athlete.firstName.slice(1).toLowerCase() : "Rival";
  return { name, total, gl };
}

function goalDelta(actual: number, goal: number, kind: "kg" | "gl"): { text: string; ok: boolean } | null {
  if (!goal) return null;
  const diff = Math.round((actual - goal) * 10) / 10;
  if (diff >= 0) return { text: `on track · +${kind === "kg" ? fmtKg(diff) : diff.toFixed(1)}`, ok: true };
  return { text: `${kind === "kg" ? fmtKg(diff) : diff.toFixed(1)} to go`, ok: false };
}

function aheadStyle(diff: number): CSSProperties {
  if (diff === 0) return { background: "color-mix(in srgb, var(--muted) 18%, transparent)", color: "var(--navy)" };
  return diff > 0
    ? { background: "color-mix(in srgb, var(--good) 18%, transparent)", color: "var(--good)" }
    : { background: "color-mix(in srgb, var(--bad) 16%, transparent)", color: "var(--bad)" };
}

// ---- small building blocks ----
function Row({ label, cells, children, head, sub }: { label: string; cells: string; children: ReactNode; head?: boolean; sub?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `120px ${cells}`, alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span style={{ font: head ? "600 9px/1 var(--font-body)" : sub ? "400 9px/1 var(--font-body)" : "600 11px/1 var(--font-heading)", letterSpacing: head ? ".1em" : ".02em", textTransform: head ? "uppercase" : "none", color: sub ? "var(--muted)" : head ? "var(--muted)" : "var(--navy)" }}>{label}</span>
      {children}
    </div>
  );
}
function NumRO({ v, pct }: { v: number; pct: number }) {
  return <span style={{ textAlign: "center", font: "500 12px/1.2 var(--font-heading)", color: "var(--muted)" }}>{fmtKg(v)}<em style={{ display: "block", font: "400 8.5px/1 var(--font-body)", color: "var(--accent-700)", fontStyle: "normal" }}>{pct}%</em></span>;
}
function Tot({ v, muted, sub }: { v: number; muted?: boolean; sub?: boolean }) {
  return <span style={{ textAlign: "center", font: `${sub ? 500 : 600} ${sub ? 12 : 14}px/1 var(--font-heading)`, color: muted || sub ? "var(--muted)" : "var(--navy)" }}>{fmtKg(v)}</span>;
}
function StatusChip({ status, onClick }: { status: AttemptStatus; onClick: () => void }) {
  const s = status === "hit"
    ? { bg: "var(--good)", fg: "#fff", t: "✓" }
    : status === "miss"
      ? { bg: "var(--bad)", fg: "#fff", t: "✗" }
      : { bg: "transparent", fg: "var(--muted)", t: "—" };
  return (
    <button onClick={onClick} title="Tap: hit / miss / clear" style={{ width: 42, height: 20, borderRadius: 6, border: status === "pending" ? "1px solid var(--divider)" : "none", background: s.bg, color: s.fg, font: "700 11px/1 var(--font-heading)", cursor: "pointer" }}>{s.t}</button>
  );
}
function Metric({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div>
      <div style={{ font: "600 8.5px/1 var(--font-body)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>{k}</div>
      <div style={{ font: `700 ${big ? 20 : 15}px/1.1 var(--font-heading)`, color: "var(--navy)", marginTop: 3 }}>{v}</div>
    </div>
  );
}
function GoalField({ label, note, children }: { label: string; note?: { text: string; ok: boolean } | null; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 6, font: "600 9px/1.3 var(--font-body)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
        {label}{note && <span style={{ color: note.ok ? "var(--good)" : "var(--bad)", textTransform: "none", letterSpacing: 0 }}>{note.text}</span>}
      </span>
      {children}
    </label>
  );
}
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v" style={{ fontSize: 18 }}>{v}</div>
    </div>
  );
}
