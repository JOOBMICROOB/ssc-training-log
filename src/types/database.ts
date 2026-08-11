/**
 * Hand-written database types — a stopgap so the client is type-safe before the
 * DB exists. Once migrations are applied, regenerate the authoritative version:
 *
 *   npm run db:types   # supabase gen types typescript --local > src/types/database.ts
 *
 * Kept intentionally close to the migrations in supabase/migrations/*.
 */

export type SscSex = "male" | "female";
export type SscIntensityType = "rpe" | "percent" | "relative";
export type SscProgramStatus = "draft" | "published" | "archived";
export type SscWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type SscCompetitionLevel = "international" | "national";
export type SscCompetitionStatus = "invited" | "opted_in" | "opted_out";
export type SscOrderStatus = "pending" | "fulfilled" | "cancelled";
export type SscShareResource = "athlete" | "program";

type Timestamped = { created_at: string; updated_at: string };

export interface Database {
  public: {
    Tables: {
      coaches: {
        Row: { id: string; full_name: string; email: string | null; is_head_coach: boolean; active: boolean } & Timestamped;
        Insert: { id: string; full_name: string; email?: string | null; is_head_coach?: boolean; active?: boolean };
        Update: Partial<{ full_name: string; email: string | null; is_head_coach: boolean; active: boolean }>;
      };
      athletes: {
        Row: { id: string; full_name: string; email: string | null; primary_coach_id: string; sex: SscSex | null; weight_class: string | null; active: boolean } & Timestamped;
        Insert: { id: string; full_name: string; primary_coach_id: string; email?: string | null; sex?: SscSex | null; weight_class?: string | null; active?: boolean };
        Update: Partial<{ full_name: string; email: string | null; primary_coach_id: string; sex: SscSex | null; weight_class: string | null; active: boolean }>;
      };
      bodyweight_entries: {
        Row: { id: string; athlete_id: string; measured_on: string; bodyweight_kg: number; note: string | null; created_at: string };
        Insert: { athlete_id: string; bodyweight_kg: number; measured_on?: string; note?: string | null };
        Update: Partial<{ measured_on: string; bodyweight_kg: number; note: string | null }>;
      };
      exercises: {
        Row: { id: string; owner_coach_id: string | null; name: string; category: string | null; is_global: boolean } & Timestamped;
        Insert: { name: string; owner_coach_id?: string | null; category?: string | null };
        Update: Partial<{ name: string; category: string | null; owner_coach_id: string | null }>;
      };
      programs: {
        Row: { id: string; owner_coach_id: string; athlete_id: string | null; name: string; status: SscProgramStatus; notes: string | null; published_at: string | null } & Timestamped;
        Insert: { owner_coach_id: string; name: string; athlete_id?: string | null; status?: SscProgramStatus; notes?: string | null };
        Update: Partial<{ athlete_id: string | null; name: string; status: SscProgramStatus; notes: string | null; published_at: string | null }>;
      };
      program_weeks: {
        Row: { id: string; program_id: string; week_number: number; label: string | null; created_at: string };
        Insert: { program_id: string; week_number: number; label?: string | null };
        Update: Partial<{ week_number: number; label: string | null }>;
      };
      program_sessions: {
        Row: { id: string; week_id: string; session_order: number; name: string | null; assigned_day: SscWeekday | null; rest_days_after: number } & Timestamped;
        Insert: { week_id: string; session_order: number; name?: string | null; assigned_day?: SscWeekday | null; rest_days_after?: number };
        Update: Partial<{ session_order: number; name: string | null; assigned_day: SscWeekday | null; rest_days_after: number }>;
      };
      exercise_rows: {
        Row: { id: string; session_id: string; row_order: number; exercise_id: string | null; exercise_name: string; coach_note: string | null; target_sets: number | null; target_reps: number | null; intensity_type: SscIntensityType | null; intensity_value: number | null } & Timestamped;
        Insert: { session_id: string; row_order: number; exercise_name: string; exercise_id?: string | null; coach_note?: string | null; target_sets?: number | null; target_reps?: number | null; intensity_type?: SscIntensityType | null; intensity_value?: number | null };
        Update: Partial<{ row_order: number; exercise_id: string | null; exercise_name: string; coach_note: string | null; target_sets: number | null; target_reps: number | null; intensity_type: SscIntensityType | null; intensity_value: number | null }>;
      };
      set_logs: {
        Row: { id: string; exercise_row_id: string; athlete_id: string; set_number: number; weight_kg: number | null; reps: number | null; rpe: number | null; velocity: number | null; notes: string | null; e1rm: number | null; is_weight_pr: boolean; is_e1rm_pr: boolean; exercise_ref: string | null; warning: string | null; client_uuid: string | null; device_id: string | null; version: number; logged_at: string } & Timestamped;
        // Derived columns (e1rm, pr flags, exercise_ref, warning) are set by triggers — never write them.
        Insert: { exercise_row_id: string; athlete_id: string; set_number: number; weight_kg?: number | null; reps?: number | null; rpe?: number | null; velocity?: number | null; notes?: string | null; client_uuid?: string | null; device_id?: string | null; logged_at?: string };
        Update: Partial<{ set_number: number; weight_kg: number | null; reps: number | null; rpe: number | null; velocity: number | null; notes: string | null; version: number }>;
      };
      session_logs: {
        Row: { id: string; program_session_id: string; athlete_id: string; pain_rating: number | null; session_rpe: number | null; notes: string | null; client_uuid: string | null; version: number; logged_at: string } & Timestamped;
        Insert: { program_session_id: string; athlete_id: string; pain_rating?: number | null; session_rpe?: number | null; notes?: string | null; client_uuid?: string | null; logged_at?: string };
        Update: Partial<{ pain_rating: number | null; session_rpe: number | null; notes: string | null; version: number }>;
      };
      weekly_checkins: {
        Row: { id: string; athlete_id: string; program_week_id: string | null; week_start: string; training: number | null; sleep: number | null; nutrition: number | null; stress: number | null; overall_feeling: number | null; motivation: number | null; pain_aches: number | null; notes: string | null; client_uuid: string | null; version: number } & Timestamped;
        Insert: { athlete_id: string; week_start: string; program_week_id?: string | null; training?: number | null; sleep?: number | null; nutrition?: number | null; stress?: number | null; overall_feeling?: number | null; motivation?: number | null; pain_aches?: number | null; notes?: string | null; client_uuid?: string | null };
        Update: Partial<{ training: number | null; sleep: number | null; nutrition: number | null; stress: number | null; overall_feeling: number | null; motivation: number | null; pain_aches: number | null; notes: string | null; version: number }>;
      };
      exercise_bests: {
        Row: { athlete_id: string; exercise_ref: string; exercise_name: string; best_weight_kg: number | null; best_weight_set_id: string | null; best_weight_at: string | null; best_e1rm: number | null; best_e1rm_set_id: string | null; best_e1rm_at: string | null; updated_at: string };
        Insert: never; // maintained by trigger
        Update: never;
      };
      competitions: {
        Row: { id: string; owner_coach_id: string | null; name: string; comp_date: string; location: string | null; level: SscCompetitionLevel } & Timestamped;
        Insert: { name: string; comp_date: string; level: SscCompetitionLevel; owner_coach_id?: string | null; location?: string | null };
        Update: Partial<{ name: string; comp_date: string; location: string | null; level: SscCompetitionLevel }>;
      };
      competition_entries: {
        Row: { id: string; competition_id: string; athlete_id: string; status: SscCompetitionStatus } & Timestamped;
        Insert: { competition_id: string; athlete_id: string; status?: SscCompetitionStatus };
        Update: Partial<{ status: SscCompetitionStatus }>;
      };
      products: {
        Row: { id: string; created_by_coach_id: string | null; name: string; description: string | null; price_cents: number; image_url: string | null; active: boolean } & Timestamped;
        Insert: { name: string; price_cents: number; created_by_coach_id?: string | null; description?: string | null; image_url?: string | null; active?: boolean };
        Update: Partial<{ name: string; description: string | null; price_cents: number; image_url: string | null; active: boolean }>;
      };
      product_variants: {
        Row: { id: string; product_id: string; label: string; sku: string | null; active: boolean; created_at: string };
        Insert: { product_id: string; label: string; sku?: string | null; active?: boolean };
        Update: Partial<{ label: string; sku: string | null; active: boolean }>;
      };
      orders: {
        Row: { id: string; athlete_id: string; status: SscOrderStatus; note: string | null } & Timestamped;
        Insert: { athlete_id: string; status?: SscOrderStatus; note?: string | null };
        Update: Partial<{ status: SscOrderStatus; note: string | null }>;
      };
      order_items: {
        Row: { id: string; order_id: string; product_id: string; variant_id: string | null; quantity: number; unit_price_cents: number; created_at: string };
        Insert: { order_id: string; product_id: string; quantity: number; unit_price_cents: number; variant_id?: string | null };
        Update: Partial<{ quantity: number; variant_id: string | null }>;
      };
      notifications: {
        Row: { id: string; recipient_user_id: string; type: string; title: string; body: string | null; data: Record<string, unknown>; read_at: string | null; created_at: string };
        Insert: never; // created by trigger
        Update: Partial<{ read_at: string | null }>;
      };
      coach_shares: {
        Row: { id: string; resource_type: SscShareResource; resource_id: string; shared_with_coach_id: string; granted_by_coach_id: string; created_at: string };
        Insert: { resource_type: SscShareResource; resource_id: string; shared_with_coach_id: string; granted_by_coach_id: string };
        Update: never;
      };
    };
    Views: {
      ssc_session_tonnage: {
        Row: { program_session_id: string; athlete_id: string; logged_sets: number; total_reps: number; tonnage_kg: number };
      };
      ssc_week_tonnage: {
        Row: { program_week_id: string; program_id: string; athlete_id: string; tonnage_kg: number; total_reps: number };
      };
    };
    Functions: {
      ssc_epley_e1rm: { Args: { weight_kg: number; reps: number }; Returns: number };
      ssc_wilks: { Args: { sex: SscSex; bodyweight_kg: number; total_kg: number }; Returns: number };
      ssc_dots: { Args: { sex: SscSex; bodyweight_kg: number; total_kg: number }; Returns: number };
      ssc_ipf_gl: { Args: { sex: SscSex; bodyweight_kg: number; total_kg: number; event?: string }; Returns: number };
      ssc_upsert_set_log: { Args: { payload: Record<string, unknown> }; Returns: Record<string, unknown> };
      ssc_upsert_session_log: { Args: { payload: Record<string, unknown> }; Returns: Record<string, unknown> };
      ssc_upsert_weekly_checkin: { Args: { payload: Record<string, unknown> }; Returns: Record<string, unknown> };
    };
    Enums: {
      ssc_sex: SscSex;
      ssc_intensity_type: SscIntensityType;
      ssc_program_status: SscProgramStatus;
      ssc_weekday: SscWeekday;
      ssc_competition_level: SscCompetitionLevel;
      ssc_competition_status: SscCompetitionStatus;
      ssc_order_status: SscOrderStatus;
      ssc_share_resource: SscShareResource;
    };
  };
}
