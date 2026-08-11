/**
 * Demo dataset so the UI renders fully without a live Supabase project — used
 * for previews, design review, and the phased-rollout demo. The real app swaps
 * this for the Supabase-backed repository; the component tree doesn't change.
 */
export interface Coach { id: string; name: string; head?: boolean; }
export interface LoggedSet { setNo: number; weight: number; reps: number; rpe?: number; pr?: boolean; note?: string; }
export interface ExRow {
  name: string; note?: string; sets: number; reps: number;
  intensity: { type: "rpe" | "percent" | "relative"; value: number };
  logged?: LoggedSet[];
}
export interface Session { name: string; day: string; painRating?: number; sessionRpe?: number; rows: ExRow[]; }
export interface Checkin { training: number; sleep: number; nutrition: number; stress: number; feeling: number; motivation: number; pain: number; notes?: string; }
export interface Program { id: string; name: string; status: "draft" | "published"; week: number; sessions: Session[]; checkin?: Checkin; }
export interface Athlete {
  id: string; name: string; coachId: string; sharedWith?: string[];
  weightClass: string; bodyweight: number; sex: "male" | "female";
  wilks?: number; dots?: number; lastActive: string; program?: Program;
}
export interface Product { id: string; name: string; price: number; desc: string; variants?: string[]; }
export interface Competition { id: string; name: string; date: string; location: string; level: "international" | "national"; }
export interface AppNotification { id: string; title: string; body: string; when: string; unread?: boolean; }

export const COACHES: Coach[] = [
  { id: "noa", name: "Noa", head: true },
  { id: "mika", name: "Mika" },
  { id: "maxim", name: "Maxim" },
];

const squat = (v: number): ExRow["intensity"] => ({ type: "rpe", value: v });

export const ATHLETES: Athlete[] = [
  {
    id: "a1", name: "Jonas Vermeulen", coachId: "noa", weightClass: "-83kg", bodyweight: 82.4, sex: "male",
    wilks: 365.2, dots: 369.3, lastActive: "12 min ago",
    program: {
      id: "p1", name: "Peak Block — Wk 3", status: "published", week: 3,
      checkin: { training: 8, sleep: 6, nutrition: 7, stress: 4, feeling: 7, motivation: 9, pain: 3, notes: "Right hip a little cranky on squats." },
      sessions: [
        {
          name: "Session A", day: "Mon", painRating: 2, sessionRpe: 8,
          rows: [
            { name: "Back Squat", note: "Belt, control the descent", sets: 4, reps: 3, intensity: squat(8),
              logged: [
                { setNo: 1, weight: 190, reps: 3, rpe: 7 },
                { setNo: 2, weight: 200, reps: 3, rpe: 8 },
                { setNo: 3, weight: 205, reps: 3, rpe: 8.5, pr: true, note: "Felt fast" },
                { setNo: 4, weight: 205, reps: 3, rpe: 9 },
              ] },
            { name: "Comp Bench", note: "2ct pause", sets: 3, reps: 4, intensity: squat(7),
              logged: [
                { setNo: 1, weight: 132.5, reps: 4, rpe: 7 },
                { setNo: 2, weight: 132.5, reps: 4, rpe: 7.5 },
                { setNo: 3, weight: 132.5, reps: 4, rpe: 8 },
              ] },
            { name: "RDL", sets: 3, reps: 8, intensity: { type: "percent", value: 65 } },
          ],
        },
        {
          name: "Session B", day: "Thu",
          rows: [
            { name: "Deadlift", note: "Sumo, reset each rep", sets: 3, reps: 2, intensity: squat(8) },
            { name: "Close-Grip Bench", sets: 4, reps: 6, intensity: { type: "percent", value: 70 } },
          ],
        },
      ],
    },
  },
  {
    id: "a2", name: "Elke Dhaenens", coachId: "noa", sharedWith: ["mika"], weightClass: "-63kg", bodyweight: 61.8, sex: "female",
    wilks: 412.7, dots: 448.1, lastActive: "2 h ago",
    program: {
      id: "p2", name: "Hypertrophy — Wk 1", status: "published", week: 1,
      sessions: [
        { name: "Session A", day: "Tue", rows: [
          { name: "Front Squat", sets: 4, reps: 6, intensity: squat(7),
            logged: [ { setNo: 1, weight: 90, reps: 6, rpe: 7 }, { setNo: 2, weight: 92.5, reps: 6, rpe: 7.5, pr: true } ] },
          { name: "Overhead Press", sets: 3, reps: 8, intensity: { type: "percent", value: 65 } },
        ] },
      ],
    },
  },
  {
    id: "a3", name: "Sam Peeters", coachId: "noa", weightClass: "-93kg", bodyweight: 91.2, sex: "male",
    wilks: 338.9, dots: 341.2, lastActive: "yesterday",
    program: { id: "p3", name: "Intro Block — Wk 2", status: "published", week: 2, sessions: [
      { name: "Session A", day: "Mon", rows: [ { name: "Back Squat", sets: 3, reps: 5, intensity: { type: "percent", value: 75 } } ] },
    ] },
  },
  { id: "a4", name: "Lotte Claes", coachId: "mika", weightClass: "-57kg", bodyweight: 56.4, sex: "female", wilks: 389.4, dots: 431.0, lastActive: "3 d ago" },
  { id: "a5", name: "Bram Wouters", coachId: "maxim", weightClass: "-105kg", bodyweight: 103.7, sex: "male", wilks: 356.1, dots: 351.8, lastActive: "5 h ago" },
];

export const PRODUCTS: Product[] = [
  { id: "s1", name: "SSC Training Tee", price: 32, desc: "Breathable cotton blend, embroidered emblem.", variants: ["S", "M", "L", "XL"] },
  { id: "s2", name: "Oversized Hoodie", price: 58, desc: "Heavyweight fleece, dropped shoulder.", variants: ["S", "M", "L", "XL"] },
  { id: "s3", name: "Steel Shaker 750ml", price: 18, desc: "Insulated stainless, leak-proof lid." },
];

export const COMPETITIONS: Competition[] = [
  { id: "c1", name: "Belgian Nationals", date: "2026-10-18", location: "Gent", level: "national" },
  { id: "c2", name: "EPF Classic Europeans", date: "2026-11-22", location: "Kaunas, LT", level: "international" },
];

export const NOTIFICATIONS: AppNotification[] = [
  { id: "n1", title: "New program ready", body: "Peak Block — Wk 3 was published to you.", when: "12 min ago", unread: true },
  { id: "n2", title: "Check-in reminder", body: "Your weekly check-in is due today.", when: "3 h ago", unread: true },
];

export function athletesForCoach(coachId: string): Athlete[] {
  return ATHLETES.filter((a) => a.coachId === coachId || a.sharedWith?.includes(coachId));
}
