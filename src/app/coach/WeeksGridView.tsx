import { useMemo, useState } from "react";
import { type ClientRow } from "./coachData";
import { plannedWeeks, yearMondays, monthOf, weekDetailFor, weekLabel, type Coverage } from "./coachPlanning";
import { mondayOf } from "./coachProgram";
import { Avatar } from "./Avatar";

/** Square style for a planned week: solid, or a half square for a part-week. */
function cellFill(state: "filled" | "avail" | "draft", coverage: Coverage, now: boolean): import("react").CSSProperties {
  const fill = state === "filled" ? "var(--good)" : state === "avail" ? "var(--navy)" : "color-mix(in srgb, var(--accent) 32%, transparent)";
  const border = state === "draft" ? "1.5px dashed var(--accent-700)" : `1px solid ${fill}`;
  const bg =
    coverage === "full"
      ? fill
      : coverage === "start"
        ? `linear-gradient(90deg, transparent 0 50%, ${fill} 50% 100%)` // week starts mid-week → right half
        : `linear-gradient(90deg, ${fill} 0 50%, transparent 50% 100%)`; // week ends mid-week → left half
  return {
    width: 14,
    height: 14,
    borderRadius: 4,
    background: bg,
    border,
    display: "inline-block",
    boxSizing: "border-box",
    cursor: "pointer",
    // The week in progress right now stands out with an amber ring — it's the one being filled in.
    ...(now ? { boxShadow: "0 0 0 2px var(--bg, #fff), 0 0 0 3.5px var(--accent-700)" } : {}),
  };
}

/** Multi-line hover text for a week cell — status + per-session breakdown. */
function hoverText(
  name: string,
  athleteId: string,
  mon: string,
  mesoName: string,
  weekName: string,
  state: "filled" | "avail" | "draft",
  coverage: Coverage,
  isNow: boolean,
): string {
  const st = state === "filled" ? "filled in" : state === "avail" ? "available — not logged yet" : "draft — not sent";
  const lines = [`${name} · ${mesoName} · ${weekName}${isNow ? "  (THIS WEEK)" : ""}`, st];
  if (coverage !== "full") lines.push("part-week");
  const d = weekDetailFor(athleteId, mon);
  if (d) {
    if (d.firstTrainingDay) lines.push(`First training day: ${d.firstTrainingDay}`);
    lines.push(`Sessions logged: ${d.loggedSessions}/${d.totalSessions}`);
    for (const s of d.sessions) {
      const mark = s.state === "logged" ? "✓" : s.state === "started" ? "◐" : "·";
      lines.push(`  ${mark} ${s.dayName} — ${s.title} (${s.loggedSets}/${s.totalSets})`);
    }
  }
  lines.push("— click for full detail —");
  return lines.join("\n");
}

/**
 * Year-at-a-glance planner: every athlete stacked as a row, every Monday of the
 * year as a column. A cell is ticked when that athlete has a week written whose
 * start lands on that Monday — solid for published, outline for a draft — so the
 * coach can see in one look who is programmed how far ahead, and where the gaps
 * are. Reads the same written weeks as the Block Plan and the Client Board.
 */
export function WeeksGridView({
  roster,
  onOpenProgram,
  onSelect,
}: {
  roster: ClientRow[];
  onOpenProgram: (athleteId: string) => void;
  onSelect: (athleteId: string) => void;
}) {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [detail, setDetail] = useState<{ athleteId: string; name: string; monday: string } | null>(null);

  // Weeks is program-planning, so it's scoped to THIS coach's own + shared
  // athletes only — never other coaches' rosters.
  const rows: ClientRow[] = roster;
  const mondays = useMemo(() => yearMondays(year), [year]);
  const thisMonday = mondayOf(
    (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    })(),
  );

  // Per-athlete planned-week map, computed once.
  const plans = useMemo(() => {
    const m = new Map<string, ReturnType<typeof plannedWeeks>>();
    rows.forEach((r) => m.set(r.athleteId, plannedWeeks(r.athleteId)));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, rows.length]);

  const totalPlanned = rows.reduce((s, r) => s + (plans.get(r.athleteId)?.size ?? 0), 0);
  const covered = rows.filter((r) => (plans.get(r.athleteId)?.size ?? 0) > 0).length;

  const NAME_W = 190;
  const COL_W = 24;
  const template = `${NAME_W}px repeat(${mondays.length}, ${COL_W}px)`;

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Weeks</h1>
          <p className="cc-sub">Every athlete against every week of the year (Monday start). A tick means that week is written — solid is published, outline is a draft still to send.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Athletes covered" v={`${covered}/${rows.length}`} />
          <Stat k="Weeks written" v={totalPlanned} />
        </div>
      </div>

      <div className="cc-chips">
        <button className="cc-chip" onClick={() => setYear((y) => y - 1)}>◂</button>
        <button className="cc-chip" aria-current>{year}</button>
        <button className="cc-chip" onClick={() => setYear((y) => y + 1)}>▸</button>
        <span style={{ flex: 1 }} />
        <span className="cc-yg-legend"><i className="cc-yg-filled" /> filled in</span>
        <span className="cc-yg-legend"><i className="cc-yg-avail" /> available</span>
        <span className="cc-yg-legend"><i className="cc-yg-draft" /> draft</span>
        <span className="cc-yg-legend"><i className="cc-yg-now" /> this week</span>
      </div>

      <div className="cc-grid-scroll" style={{ marginTop: 18 }}>
        <div className="cc-yggrid" style={{ gridTemplateColumns: template }}>
          {/* header: month + day */}
          <div className="cc-yg-corner">Athlete</div>
          {mondays.map((mon, i) => {
            const prev = i > 0 ? monthOf(mondays[i - 1]) : "";
            const mo = monthOf(mon);
            const day = new Date(`${mon}T00:00:00`).getDate();
            const isNow = mon === thisMonday;
            return (
              <div key={mon} className={`cc-yg-head${isNow ? " cc-yg-head-now" : ""}`}>
                <span className="cc-yg-mo">{mo !== prev ? mo : ""}</span>
                <span className="cc-yg-day">{day}</span>
              </div>
            );
          })}

          {/* athlete rows */}
          {rows.map((r) => {
            const plan = plans.get(r.athleteId);
            return (
              <div key={r.athleteId} className="cc-yg-rowline" style={{ display: "contents" }}>
                <button
                  className="cc-yg-name"
                  title="Open programme"
                  onClick={() => { onSelect(r.athleteId); onOpenProgram(r.athleteId); }}
                >
                  <Avatar src={r.avatar} name={r.name} size={26} />
                  <span className="cc-yg-nametxt">{r.name}</span>
                </button>
                {mondays.map((mon) => {
                  const w = plan?.get(mon);
                  const isNow = mon === thisMonday;
                  const state = w ? (!w.published ? "draft" : w.filled ? "filled" : "avail") : null;
                  return (
                    <div key={mon} className={`cc-yg-cell${isNow ? " cc-yg-cell-now" : ""}`}>
                      {w && state && (
                        <span
                          style={cellFill(state, w.coverage, isNow)}
                          title={hoverText(r.name, r.athleteId, mon, w.mesoName, w.weekName, state, w.coverage, isNow)}
                          onClick={() => setDetail({ athleteId: r.athleteId, name: r.name, monday: mon })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && <p className="cc-sub" style={{ marginTop: 18 }}>No athletes on this list yet.</p>}

      {detail && (
        <WeekDetailModal
          athleteId={detail.athleteId}
          name={detail.name}
          monday={detail.monday}
          onClose={() => setDetail(null)}
          onOpen={() => { onSelect(detail.athleteId); onOpenProgram(detail.athleteId); setDetail(null); }}
        />
      )}
    </div>
  );
}

/** Full-detail card for a single week: every session, logged vs to-fill. */
function WeekDetailModal({
  athleteId,
  name,
  monday,
  onClose,
  onOpen,
}: {
  athleteId: string;
  name: string;
  monday: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const d = weekDetailFor(athleteId, monday);
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,20,30,0.44)", display: "grid", placeItems: "center", zIndex: 60, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 94vw)", background: "var(--card, #fff)", borderRadius: 16, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.28)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ font: "700 15px/1.2 var(--font-head, inherit)" }}>{name}</div>
            <div className="cc-sub" style={{ marginTop: 2 }}>
              Week of {weekLabel(monday)}
              {d ? ` · ${d.mesoName} · ${d.weekName}` : ""}
            </div>
          </div>
          <button className="cc-wk-del" title="Close" onClick={onClose}>×</button>
        </div>

        {!d ? (
          <p className="cc-sub" style={{ marginTop: 14 }}>No training written for this week.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, margin: "14px 0 10px", flexWrap: "wrap" }}>
              <Badge k="Sessions logged" v={`${d.loggedSessions}/${d.totalSessions}`} />
              {d.firstTrainingDay && <Badge k="First training day" v={d.firstTrainingDay} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {d.sessions.map((s) => {
                const tone = s.state === "logged" ? "var(--good)" : s.state === "started" ? "var(--accent-700)" : "var(--muted)";
                return (
                  <div key={s.date} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "color-mix(in srgb, var(--divider) 40%, transparent)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: tone, flex: "0 0 auto" }} />
                    <span style={{ font: "700 11px/1 var(--font-body)", minWidth: 34 }}>{s.dayName}</span>
                    <span style={{ flex: 1, font: "500 12px/1.3 var(--font-body)" }}>{s.title}</span>
                    <span style={{ font: "600 11px/1 var(--font-body)", color: tone }}>
                      {s.state === "logged" ? "logged" : s.state === "started" ? "started" : "to fill"} · {s.loggedSets}/{s.totalSets}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <button className="cc-mini cc-mini-solid" style={{ marginTop: 16, width: "100%", padding: "11px 16px", fontSize: 12 }} onClick={onOpen}>
          Open programme →
        </button>
      </div>
    </div>
  );
}

function Badge({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ font: "600 9.5px/1 var(--font-body)", color: "var(--muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ font: "700 13px/1.2 var(--font-body)", marginTop: 3 }}>{v}</div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v">{v}</div>
    </div>
  );
}
