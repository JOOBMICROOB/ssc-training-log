import { useMemo, useState } from "react";
import { loadProgram, weekOrder, dayDate, type Mesocycle, type Week } from "./coachProgram";
import { getCompetitions, getClients } from "./coachData";
import { getDashboard, getSessionFor, getAthleteEvents, addAthleteEvent, removeAthleteEvent, eventsByDate, type AthleteEvent } from "../../lib/data/athleteData";
import { Avatar } from "./Avatar";
import type { MainLift } from "../../lib/program/program";

const SBD: MainLift[] = ["squat", "bench", "deadlift"];

/**
 * Program & Planner → 2 · Calendar & Block Plan. One board tying everything
 * together for an athlete: their programmed weeks (from the builder, placed on
 * real dates via each week's startDate), the sessions they've logged, and the
 * meets from the shared competition calendar. Colour by mesocycle or by week.
 * Reads only data we already have — no new backend.
 */

type Mode = "plain" | "meso" | "week";
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addMonths = (y: number, m: number, n: number) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; };

type DayInfo = { mesoColor: string; mesoName: string; mesoIdx: number; weekName: string; weekIdxInMeso: number; training: boolean; isCurrent: boolean; published: boolean; exCount: number; lifts: MainLift[] };
const sessionLabel = (info: DayInfo | undefined): string => {
  if (!info) return "";
  if (!info.training) return "Rest day";
  const l = SBD.filter((x) => info.lifts.includes(x));
  return (l.length ? l.map((x) => x[0].toUpperCase() + x.slice(1)).join(" & ") : "Accessory") + " session";
};

export function BlockPlanView({ athleteId, athleteName, avatar, onOpenBuilder }: { athleteId: string; athleteName: string; avatar?: string; onOpenBuilder: () => void }) {
  const [mode, setMode] = useState<Mode>("meso");
  const [hideUnopted, setHideUnopted] = useState(false);
  const [eventTick, setEventTick] = useState(0);
  const program = useMemo(() => loadProgram(athleteId), [athleteId]);
  const comps = getCompetitions();
  const clients = getClients();
  const optedIds = useMemo(() => new Set(getDashboard(athleteId).optedInComps ?? []), [athleteId]);
  const events = useMemo(() => getAthleteEvents(athleteId), [athleteId, eventTick]);
  const eventMap = useMemo(() => eventsByDate(events), [events]);

  // date → program day info
  const { dayMap, loggedSet, compMap, months, summary } = useMemo(() => {
    const dayMap: Record<string, DayInfo> = {};
    let minDate = "", maxDate = "";
    const track = (iso: string) => { if (!minDate || iso < minDate) minDate = iso; if (!maxDate || iso > maxDate) maxDate = iso; };

    program.mesocycles.forEach((meso: Mesocycle, mi: number) => {
      if (meso.hidden) return;
      meso.weeks.forEach((week: Week, wi: number) => {
        if (!week.startDate || week.hidden) return;
        weekOrder(week).forEach((wd) => {
          const date = dayDate(week, wd);
          if (!date) return;
          const day = week.days.find((d) => d.weekday === wd);
          dayMap[date] = {
            mesoColor: meso.color,
            mesoName: meso.name,
            mesoIdx: mi,
            weekName: week.name,
            weekIdxInMeso: wi,
            training: !!day && !day.rest && day.exercises.length > 0,
            isCurrent: week.id === program.currentWeekId,
            published: week.status === "published",
            exCount: day ? day.exercises.length : 0,
            lifts: day ? [...new Set(day.exercises.map((e) => e.mainLift).filter((x): x is MainLift => x != null))] : [],
          };
          track(date);
        });
      });
    });

    // Logged = the athlete actually did the session (≥70% real logs); coach
    // fixed-load prefills don't count, so the calendar stays blank until then.
    const logs = getDashboard(athleteId).programLogs ?? {};
    const loggedSet = new Set(Object.keys(logs).filter((d) => getSessionFor(athleteId, d).finished));

    // meets — optionally only the ones THIS athlete is opted into.
    const compMap: Record<string, { level: "national" | "international"; name: string; opted: boolean }> = {};
    comps.forEach((c) => {
      const opted = optedIds.has(c.id);
      if (hideUnopted && !opted) return;
      compMap[c.date] = { level: c.level, name: c.name, opted };
      track(c.date);
    });

    // month span (default: this month + next 5 if nothing dated)
    const start = minDate ? new Date(minDate + "T00:00:00") : new Date();
    const end = maxDate ? new Date(maxDate + "T00:00:00") : new Date();
    const months: { y: number; m: number }[] = [];
    let cur = { y: start.getFullYear(), m: start.getMonth() };
    const last = { y: end.getFullYear(), m: end.getMonth() };
    for (let i = 0; i < 18; i++) {
      months.push(cur);
      if (cur.y === last.y && cur.m === last.m) break;
      cur = addMonths(cur.y, cur.m, 1);
    }
    if (months.length < 6) { // pad to a fuller board
      while (months.length < 6) { const n = addMonths(months[months.length - 1].y, months[months.length - 1].m, 1); months.push(n); }
    }

    const totalWeeks = program.mesocycles.reduce((s, m) => s + m.weeks.length, 0);
    const summary = {
      start: minDate,
      layout: program.mesocycles.map((m) => m.name).join(" · ") || "—",
      weeksWritten: totalWeeks,
    };
    return { dayMap, loggedSet, compMap, months, summary };
  }, [program, comps, athleteId, hideUnopted, optedIds]);

  const today = localIso(new Date());
  const mesoList = program.mesocycles;

  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar src={avatar} name={athleteName} size={40} />Planning · {athleteName}</h1>
          <p className="cc-sub">Programmed weeks, logged sessions and competitions on one board. Colour by block or by week to see pacing.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="cc-side-k" style={{ marginBottom: 0 }}>Colour</span>
          {(["plain", "meso", "week"] as Mode[]).map((mo) => (
            <button key={mo} className="cc-chip" aria-current={mode === mo} onClick={() => setMode(mo)}>{mo === "meso" ? "By block" : mo === "week" ? "By week" : "Plain"}</button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--divider)", margin: "0 2px" }} />
          <button className="cc-chip" aria-current={hideUnopted} onClick={() => setHideUnopted((v) => !v)} title="Only show meets this athlete is opted into">
            {hideUnopted ? "Opted-in meets only ✓" : "All meets"}
          </button>
        </div>
      </div>

      {/* legend */}
      <div className="cc-legend">
        {mode === "meso"
          ? mesoList.map((m) => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)
          : mode === "week"
            ? <><span><i style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)" }} />early week</span><span><i style={{ background: "var(--accent)" }} />later week</span></>
            : <span><i style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)" }} />training day</span>}
        <span><i style={{ background: "color-mix(in srgb, var(--good) 26%, transparent)", border: "1px solid color-mix(in srgb, var(--good) 55%, transparent)" }} />logged</span>
        <span><i style={{ background: "color-mix(in srgb, var(--bad) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--bad) 45%, transparent)" }} />missed</span>
        <span><i style={{ background: "color-mix(in srgb, var(--navy) 5%, transparent)" }} />rest</span>
        <span><i style={{ background: "transparent", border: "1px solid var(--accent)" }} />national</span>
        <span><i style={{ background: "var(--navy)" }} />international</span>
      </div>

      <p className="cc-cell-s" style={{ marginTop: 10 }}>Click a day to see its session; click an empty day to start a block there.</p>

      <div className="cc-plan-grid">
        <div className="cc-months">
          {months.map(({ y, m }) => (
            <MonthCard key={`${y}-${m}`} year={y} month={m} dayMap={dayMap} loggedSet={loggedSet} compMap={compMap} eventMap={eventMap} today={today} mode={mode} selected={selected} onDayClick={setSelected} />
          ))}
        </div>

        <aside className="cc-panel cc-corner cc-plan-rail">
          <i />
          {selected && (
            <div className="cc-day-detail">
              <div className="cc-side-k" style={{ marginBottom: 6 }}>{fmtLong(selected)}</div>
              {(() => {
                const info = dayMap[selected];
                const comp = compMap[selected];
                const ev = eventMap[selected];
                if (comp) return <><div style={{ font: "600 15px/1.1 var(--font-heading)", color: "var(--navy)" }}>{comp.name}</div><div className="cc-cell-s" style={{ marginTop: 3 }}>Competition · {comp.level}</div></>;
                if (ev) return <><div style={{ font: "600 15px/1.1 var(--font-heading)", color: "var(--navy)" }}>{ev.type === "vacation" ? "🌴 " : "★ "}{ev.title}</div><div className="cc-cell-s" style={{ marginTop: 3 }}>{ev.type === "vacation" ? "Time off" : "Event"}{ev.endDate && ev.endDate !== ev.date ? ` · ${fmtLong(ev.date)} → ${fmtLong(ev.endDate)}` : ""} · visible to {athleteName.split(" ")[0]}</div><button className="cc-mini" style={{ marginTop: 10 }} onClick={() => { removeAthleteEvent(athleteId, ev.id); setEventTick((t) => t + 1); }}>Remove</button></>;
                if (!info) return <><div className="cc-cell-s">No session here yet — build it in the program builder and it shows up on this calendar.</div><button className="cc-mini cc-mini-solid" style={{ marginTop: 10 }} onClick={onOpenBuilder}>Open program builder →</button></>;
                return (
                  <>
                    <div style={{ font: "600 15px/1.1 var(--font-heading)", color: "var(--navy)" }}>{sessionLabel(info)}</div>
                    <div className="cc-cell-s" style={{ marginTop: 3 }}>{info.mesoName} · {info.weekName}{info.training ? ` · ${info.exCount} exercises` : ""}{loggedSet.has(selected) ? " · logged ✓" : ""}</div>
                    <button className="cc-mini" style={{ marginTop: 10 }} onClick={onOpenBuilder}>Open in builder →</button>
                  </>
                );
              })()}
              <div style={{ height: 1, background: "var(--divider)", margin: "16px 0" }} />
            </div>
          )}
          <div className="cc-side-k">Summary</div>
          <RailRow k="Athlete" v={athleteName} />
          <RailRow k="Start" v={summary.start ? fmtLong(summary.start) : "not dated yet"} />
          <RailRow k="Layout" v={summary.layout} />
          <RailRow k="Weeks written" v={String(summary.weeksWritten)} />
          <RailRow k="Coach" v="Noa Depaepe" />
          <button className="cc-fullbtn" style={{ marginTop: 14, background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} onClick={onOpenBuilder}>Open program builder →</button>

          <EventEditor
            athleteId={athleteId}
            athleteName={athleteName}
            events={events}
            presetDate={selected}
            onChange={() => setEventTick((t) => t + 1)}
            onSelectDate={setSelected}
          />

          <div className="cc-side-k" style={{ marginTop: 22 }}>On the calendar</div>
          {comps.map((c) => {
            const n = clients.filter((cl) => cl.opts.find((o) => o.id === c.id)?.opted).length;
            const d = new Date(c.date + "T00:00:00");
            return (
              <div key={c.id} className="cc-rail-meet">
                <div className="cc-rail-meet-date">{d.getDate()} {MON[d.getMonth()]}</div>
                <div style={{ flex: 1 }}>
                  <div className="cc-rail-meet-name">{c.name}</div>
                  <div className="cc-rail-meet-sub">{c.location} · {n} opted in</div>
                </div>
                <span className={`cc-level ${c.level === "international" ? "cc-level-int" : "cc-level-nat"}`}>{c.level === "international" ? "INT" : "NAT"}</span>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function MonthCard({ year, month, dayMap, loggedSet, compMap, eventMap, today, mode, selected, onDayClick }: {
  year: number; month: number; dayMap: Record<string, DayInfo>; loggedSet: Set<string>;
  compMap: Record<string, { level: "national" | "international"; name: string; opted?: boolean }>;
  eventMap: Record<string, AthleteEvent>; today: string; mode: Mode;
  selected: string | null; onDayClick: (iso: string) => void;
}) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(localIso(new Date(year, month, d)));

  return (
    <div className="cc-month">
      <div className="cc-month-title">{MON_LONG[month]} {year}</div>
      <div className="cc-month-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <span key={i} className="cc-month-wd">{w}</span>)}
        {cells.map((iso, i) => {
          if (!iso) return <span key={i} />;
          const info = dayMap[iso];
          const comp = compMap[iso];
          const logged = loggedSet.has(iso);
          const isToday = iso === today;
          // A training day in the past that was never logged = missed/open.
          const missed = !!info && info.training && !logged && iso < today;
          const restDay = !!info && !info.training;

          let bg = "transparent", color = "var(--navy)", border = "1px solid transparent";
          if (info) {
            if (mode === "meso") {
              // Alternate the tint per block (mesoIdx) and per week (stripes) so
              // adjacent blocks and weeks read apart even when colours match.
              const strength = info.training ? 26 + (info.weekIdxInMeso % 2) * 12 + (info.mesoIdx % 2) * 6 : 10;
              bg = `color-mix(in srgb, ${info.mesoColor} ${strength}%, transparent)`;
            } else if (mode === "week") bg = `color-mix(in srgb, var(--accent) ${Math.min(48, 12 + info.weekIdxInMeso * 9 + (info.training ? 10 : 0))}%, transparent)`;
            else bg = info.training ? "color-mix(in srgb, var(--accent) 22%, transparent)" : "color-mix(in srgb, var(--navy) 5%, transparent)";
            if (restDay) color = "var(--muted)";
            if (logged) { bg = "color-mix(in srgb, var(--good) 26%, transparent)"; border = "1px solid color-mix(in srgb, var(--good) 55%, transparent)"; }
            else if (missed) { bg = "color-mix(in srgb, var(--bad) 14%, transparent)"; border = "1px solid color-mix(in srgb, var(--bad) 45%, transparent)"; }
            if (info.isCurrent && !logged && !missed) border = "1px solid color-mix(in srgb, var(--good) 55%, transparent)";
          }
          const ev = eventMap[iso];
          if (ev && !comp) {
            // Time off / events override the block tint so they never hide.
            if (ev.type === "vacation") { bg = "color-mix(in srgb, #e8a13a 26%, transparent)"; border = "1px solid color-mix(in srgb, #e8a13a 55%, transparent)"; }
            else { bg = "color-mix(in srgb, #7c6bd6 22%, transparent)"; border = "1px solid color-mix(in srgb, #7c6bd6 55%, transparent)"; }
          }
          if (comp) {
            if (comp.level === "international") { bg = "var(--navy)"; color = "#fff"; border = "1px solid var(--navy)"; }
            else { border = "1px solid var(--accent)"; bg = "color-mix(in srgb, var(--accent) 14%, transparent)"; }
          }
          const shadows: string[] = [];
          if (info?.published) shadows.push("inset 0 1px 5px rgba(20,36,52,.16)"); // "made / published" texture
          if (isToday) shadows.push("inset 0 0 0 2px var(--good)");
          if (iso === selected) shadows.push("0 0 0 2px var(--accent)");
          const stateTitle = comp
            ? comp.name
            : ev
              ? `${ev.type === "vacation" ? "Time off" : "Event"} · ${ev.title}`
              : info
                ? `${info.mesoName} · ${info.weekName} · ${restDay ? "rest" : logged ? "logged ✓" : missed ? "missed / not logged" : info.training ? "to log" : ""}${info.published ? "" : " · draft"}`
                : "no block";
          return (
            <button
              key={i}
              className={`cc-month-day${info?.published ? " cc-day-made" : ""}`}
              title={stateTitle}
              onClick={() => onDayClick(iso)}
              style={{ backgroundColor: bg, color, border, cursor: "pointer", ...(shadows.length ? { boxShadow: shadows.join(", ") } : {}) } as React.CSSProperties}
            >
              {Number(iso.slice(-2))}
              {ev && !comp && <span style={{ position: "absolute", top: 2, right: 3, fontSize: 8, lineHeight: 1 }}>{ev.type === "vacation" ? "🌴" : "★"}</span>}
              {logged && !comp && <i className="cc-day-logged" />}
              {missed && !comp && <i style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: 4, background: "var(--bad)" }} />}
              {restDay && !comp && !logged && !missed && <i style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", width: 8, height: 1.5, borderRadius: 2, background: "var(--muted)", opacity: 0.6 }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Coach-side add / list / remove of an athlete's time off + events. */
function EventEditor({ athleteId, athleteName, events, presetDate, onChange, onSelectDate }: {
  athleteId: string; athleteName: string; events: AthleteEvent[]; presetDate: string | null;
  onChange: () => void; onSelectDate: (iso: string) => void;
}) {
  const [type, setType] = useState<AthleteEvent["type"]>("vacation");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [end, setEnd] = useState("");
  const start = date || presetDate || "";

  const add = () => {
    if (!start) { alert("Pick a start date first."); return; }
    addAthleteEvent(athleteId, {
      date: start,
      endDate: end && end >= start ? end : undefined,
      type,
      title: title.trim() || (type === "vacation" ? "Time off" : "Event"),
    });
    setTitle(""); setDate(""); setEnd("");
    onChange();
  };
  const upcoming = events.filter((e) => (e.endDate ?? e.date) >= localIso(new Date()));

  return (
    <>
      <div className="cc-side-k" style={{ marginTop: 22 }}>Time off &amp; events</div>
      <p style={{ font: "400 10px/1.4 var(--font-body)", color: "var(--muted)", margin: "-2px 0 8px" }}>
        Shows on this calendar and on {athleteName.split(" ")[0]}'s own app.
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button className="cc-chip" aria-current={type === "vacation"} onClick={() => setType("vacation")}>🌴 Time off</button>
        <button className="cc-chip" aria-current={type === "event"} onClick={() => setType("event")}>★ Event</button>
      </div>
      <input className="cc-db-search" placeholder={type === "vacation" ? "e.g. Holiday in Spain" : "e.g. Photoshoot"} value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 6 }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <label style={{ flex: 1, font: "400 9px/1.3 var(--font-body)", color: "var(--muted)" }}>From<input type="date" className="cc-db-search" value={start} onChange={(e) => setDate(e.target.value)} /></label>
        <label style={{ flex: 1, font: "400 9px/1.3 var(--font-body)", color: "var(--muted)" }}>To (optional)<input type="date" className="cc-db-search" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <button className="cc-mini cc-mini-solid" style={{ width: "100%" }} onClick={add}>+ Add to calendar</button>

      {upcoming.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {upcoming.map((e) => {
            const d = new Date(e.date + "T00:00:00");
            return (
              <div key={e.id} className="cc-rail-meet">
                <div className="cc-rail-meet-date">{d.getDate()} {MON[d.getMonth()]}</div>
                <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onSelectDate(e.date)}>
                  <div className="cc-rail-meet-name">{e.type === "vacation" ? "🌴 " : "★ "}{e.title}</div>
                  <div className="cc-rail-meet-sub">{e.endDate && e.endDate !== e.date ? `until ${new Date(e.endDate + "T00:00:00").getDate()} ${MON[new Date(e.endDate + "T00:00:00").getMonth()]}` : "single day"}</div>
                </div>
                <button className="cc-wk-del" title="Remove" onClick={() => { removeAthleteEvent(athleteId, e.id); onChange(); }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RailRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--divider)" }}>
      <span style={{ font: "400 9px/1 var(--font-body)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>{k}</span>
      <span style={{ font: "600 12px/1.2 var(--font-heading)", color: "var(--navy)", textAlign: "right" }}>{v}</span>
    </div>
  );
}
function fmtLong(iso: string) { const d = new Date(iso + "T00:00:00"); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; }
