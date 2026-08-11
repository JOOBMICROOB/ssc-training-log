// Provisioned athlete credentials — the login details the coach hands out.
//
// TRANSITIONAL: today this list lives in the app so you can hand out an ID +
// access code and have it work immediately on the phone. Once the coach
// dashboard exists it will provision athletes into Supabase Auth instead, and
// `authClient` swaps its lookup from this file to Supabase without any change
// to the login screen. See [[ssc-training-log-project]].
//
// To add an athlete: give them an `athleteId` (any short code, case-insensitive)
// and an `accessCode`, then hand those two values to the athlete.

export type AthleteCredential = {
  /** What the athlete types in the ATHLETE ID field. Matched case-insensitively. */
  athleteId: string;
  /** What the athlete types in the ACCESS CODE field. Matched exactly. */
  accessCode: string;
  /** Shown in the signed-in state. */
  name: string;
  /** Who to contact if they lose their code. */
  coachName: string;
  /** Optional E.164 number (e.g. "+32470123456"). If set, the "message your
   *  coach" line becomes a WhatsApp link; if omitted it stays plain text. */
  coachWhatsapp?: string;
};

export const ROSTER: AthleteCredential[] = [
  // Demo athlete — the ID/code used as the placeholder in the design.
  // Replace or extend with the real athletes you hand credentials to.
  {
    athleteId: "RS1203",
    accessCode: "SSC-1203",
    name: "Demo Athlete",
    coachName: "Noa",
  },
];
