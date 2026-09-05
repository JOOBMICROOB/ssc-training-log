-- 0017_coach_read_all.sql
-- ---------------------------------------------------------------------------
-- Team visibility: every coach can SEE every athlete's scores/info on the Team
-- and Clients pages — but still only EDIT (program/weeks/planner) their own +
-- shared athletes. Programs aren't shown for other coaches' athletes in the UI;
-- this just lets the board/summary read their dashboard data.
--
-- Adds a read-only SELECT policy for coaches over ALL app_state. Writes stay
-- governed by the existing owner/shared policy (state_coach) + the athlete's own
-- (state_self). RLS is permissive (OR), so this only widens READ, never write.
-- Additive + non-destructive. Run in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

drop policy if exists state_read_coaches on app_state;
create policy state_read_coaches on app_state for select using (app_is_coach());
