-- 0010_rls.sql
-- Row-level security. Two authenticated principals: coaches and athletes
-- (identified by which table holds their auth.uid()). Default data ownership
-- is per-coach; cross-coach access is granted only through coach_shares.
-- Head coach has no blanket athlete visibility — its one special power is
-- seeing every shop order (orders route to the head coach).
--
-- Access helpers are SECURITY DEFINER + STABLE so they read identity/ownership
-- without being filtered by the very policies they inform (no RLS recursion).

-- ---- identity / access helpers -------------------------------------------
create or replace function ssc_current_coach()
returns uuid language sql stable security definer set search_path = public as $$
  select id from coaches where id = (select auth.uid()) and active;
$$;

create or replace function ssc_current_athlete()
returns uuid language sql stable security definer set search_path = public as $$
  select id from athletes where id = (select auth.uid()) and active;
$$;

create or replace function ssc_is_head_coach()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_head_coach from coaches
                   where id = (select auth.uid()) and active), false);
$$;

create or replace function ssc_coach_can_access_athlete(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from athletes where id = a and primary_coach_id = (select auth.uid())
  ) or exists (
    select 1 from coach_shares
    where resource_type = 'athlete' and resource_id = a
      and shared_with_coach_id = (select auth.uid())
  );
$$;

create or replace function ssc_coach_can_access_program(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs where id = p and owner_coach_id = (select auth.uid())
  ) or exists (
    select 1 from coach_shares
    where resource_type = 'program' and resource_id = p
      and shared_with_coach_id = (select auth.uid())
  );
$$;

-- Is program p assigned+published to the current athlete?
create or replace function ssc_athlete_has_program(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from programs
    where id = p and athlete_id = (select auth.uid()) and status = 'published'
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------------
alter table coaches               enable row level security;
alter table athletes              enable row level security;
alter table bodyweight_entries    enable row level security;
alter table exercises             enable row level security;
alter table programs              enable row level security;
alter table program_weeks         enable row level security;
alter table program_sessions      enable row level security;
alter table exercise_rows         enable row level security;
alter table set_logs              enable row level security;
alter table session_logs          enable row level security;
alter table weekly_checkins       enable row level security;
alter table exercise_bests        enable row level security;
alter table competitions          enable row level security;
alter table competition_entries   enable row level security;
alter table products              enable row level security;
alter table product_variants      enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table notifications         enable row level security;
alter table coach_shares          enable row level security;

-- ---- coaches --------------------------------------------------------------
-- Names are needed for the "share with" picker; readable by any authenticated user.
create policy coaches_select on coaches for select to authenticated using (true);
create policy coaches_update_self on coaches for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- New coach rows are provisioned by the head coach (invite flow).
create policy coaches_insert_head on coaches for insert to authenticated
  with check (ssc_is_head_coach());

-- ---- athletes -------------------------------------------------------------
create policy athletes_select on athletes for select to authenticated using (
  id = (select auth.uid()) or ssc_coach_can_access_athlete(id)
);
-- A coach invites an athlete onto their own roster.
create policy athletes_insert_coach on athletes for insert to authenticated
  with check (primary_coach_id = (select auth.uid()) and ssc_current_coach() is not null);
create policy athletes_update on athletes for update to authenticated
  using (id = (select auth.uid()) or ssc_coach_can_access_athlete(id))
  with check (id = (select auth.uid()) or ssc_coach_can_access_athlete(id));

-- ---- bodyweight_entries ---------------------------------------------------
create policy bw_select on bodyweight_entries for select to authenticated using (
  athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id)
);
create policy bw_write_athlete on bodyweight_entries for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));

-- ---- exercises ------------------------------------------------------------
create policy exercises_select on exercises for select to authenticated using (
  owner_coach_id is null or owner_coach_id = (select auth.uid())
);
create policy exercises_write_owner on exercises for all to authenticated
  using (owner_coach_id = (select auth.uid()))
  with check (owner_coach_id = (select auth.uid()));
-- Global (shared) exercises are curated by the head coach.
create policy exercises_write_global on exercises for all to authenticated
  using (owner_coach_id is null and ssc_is_head_coach())
  with check (owner_coach_id is null and ssc_is_head_coach());

-- ---- programs -------------------------------------------------------------
create policy programs_select on programs for select to authenticated using (
  ssc_coach_can_access_program(id)
  or (athlete_id = (select auth.uid()) and status = 'published')
);
create policy programs_insert_coach on programs for insert to authenticated
  with check (owner_coach_id = (select auth.uid()) and ssc_current_coach() is not null);
create policy programs_update_coach on programs for update to authenticated
  using (ssc_coach_can_access_program(id))
  with check (ssc_coach_can_access_program(id));
create policy programs_delete_owner on programs for delete to authenticated
  using (owner_coach_id = (select auth.uid()));

-- ---- program_weeks / sessions / exercise_rows (inherit program access) ----
create policy weeks_all on program_weeks for all to authenticated
  using (ssc_coach_can_access_program(program_id))
  with check (ssc_coach_can_access_program(program_id));
create policy weeks_athlete_select on program_weeks for select to authenticated
  using (ssc_athlete_has_program(program_id));

create policy sessions_all on program_sessions for all to authenticated
  using (ssc_coach_can_access_program((select program_id from program_weeks where id = week_id)))
  with check (ssc_coach_can_access_program((select program_id from program_weeks where id = week_id)));
create policy sessions_athlete_select on program_sessions for select to authenticated
  using (ssc_athlete_has_program((select program_id from program_weeks where id = week_id)));

create policy rows_all on exercise_rows for all to authenticated
  using (ssc_coach_can_access_program(
    (select pw.program_id from program_sessions ps
       join program_weeks pw on pw.id = ps.week_id where ps.id = session_id)))
  with check (ssc_coach_can_access_program(
    (select pw.program_id from program_sessions ps
       join program_weeks pw on pw.id = ps.week_id where ps.id = session_id)));
create policy rows_athlete_select on exercise_rows for select to authenticated
  using (ssc_athlete_has_program(
    (select pw.program_id from program_sessions ps
       join program_weeks pw on pw.id = ps.week_id where ps.id = session_id)));

-- ---- set_logs / session_logs / weekly_checkins ----------------------------
-- Athlete owns their logs; an accessing coach can read them (requirement #6).
create policy set_logs_athlete on set_logs for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));
create policy set_logs_coach_select on set_logs for select to authenticated
  using (ssc_coach_can_access_athlete(athlete_id));

create policy session_logs_athlete on session_logs for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));
create policy session_logs_coach_select on session_logs for select to authenticated
  using (ssc_coach_can_access_athlete(athlete_id));

create policy checkins_athlete on weekly_checkins for all to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));
create policy checkins_coach_select on weekly_checkins for select to authenticated
  using (ssc_coach_can_access_athlete(athlete_id));

-- ---- exercise_bests (read-only to clients; written by SECURITY DEFINER trigger)
create policy bests_select on exercise_bests for select to authenticated using (
  athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id)
);

-- ---- competitions (shared calendar) ---------------------------------------
create policy competitions_select on competitions for select to authenticated using (true);
create policy competitions_write_owner on competitions for all to authenticated
  using (owner_coach_id = (select auth.uid()))
  with check (owner_coach_id = (select auth.uid()));
create policy competitions_write_global on competitions for all to authenticated
  using ((owner_coach_id is null) and ssc_is_head_coach())
  with check ((owner_coach_id is null) and ssc_is_head_coach());

create policy comp_entries_select on competition_entries for select to authenticated using (
  athlete_id = (select auth.uid()) or ssc_coach_can_access_athlete(athlete_id)
);
create policy comp_entries_athlete on competition_entries for update to authenticated
  using (athlete_id = (select auth.uid()))
  with check (athlete_id = (select auth.uid()));
create policy comp_entries_coach_write on competition_entries for all to authenticated
  using (ssc_coach_can_access_athlete(athlete_id))
  with check (ssc_coach_can_access_athlete(athlete_id));

-- ---- shop: products/variants readable by all; managed by any coach --------
create policy products_select on products for select to authenticated using (true);
create policy products_write_coach on products for all to authenticated
  using (ssc_current_coach() is not null)
  with check (ssc_current_coach() is not null);

create policy variants_select on product_variants for select to authenticated using (true);
create policy variants_write_coach on product_variants for all to authenticated
  using (ssc_current_coach() is not null)
  with check (ssc_current_coach() is not null);

-- ---- orders: athlete places/sees own; ALL orders route to the head coach --
create policy orders_athlete_insert on orders for insert to authenticated
  with check (athlete_id = (select auth.uid()));
create policy orders_athlete_select on orders for select to authenticated
  using (athlete_id = (select auth.uid()));
create policy orders_head_select on orders for select to authenticated
  using (ssc_is_head_coach());
create policy orders_head_update on orders for update to authenticated
  using (ssc_is_head_coach()) with check (ssc_is_head_coach());

create policy order_items_select on order_items for select to authenticated using (
  ssc_is_head_coach()
  or exists (select 1 from orders o where o.id = order_id and o.athlete_id = (select auth.uid()))
);
create policy order_items_athlete_insert on order_items for insert to authenticated with check (
  exists (select 1 from orders o where o.id = order_id and o.athlete_id = (select auth.uid()))
);

-- ---- notifications: recipient reads + marks read; inserts via trigger only -
create policy notifications_select on notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()));
create policy notifications_update on notifications for update to authenticated
  using (recipient_user_id = (select auth.uid()))
  with check (recipient_user_id = (select auth.uid()));

-- ---- coach_shares: grantor/grantee can see; owner grants, grantor revokes --
create policy shares_select on coach_shares for select to authenticated using (
  granted_by_coach_id = (select auth.uid()) or shared_with_coach_id = (select auth.uid())
);
create policy shares_insert on coach_shares for insert to authenticated with check (
  granted_by_coach_id = (select auth.uid())
  and case resource_type
        when 'athlete' then exists (select 1 from athletes
              where id = resource_id and primary_coach_id = (select auth.uid()))
        when 'program' then exists (select 1 from programs
              where id = resource_id and owner_coach_id = (select auth.uid()))
      end
);
create policy shares_delete on coach_shares for delete to authenticated using (
  granted_by_coach_id = (select auth.uid())
);
