-- 0019_nutritionist_card.sql
-- ---------------------------------------------------------------------------
-- Let the nutritionist (Jess) publish her "card" (name + photo) onto the
-- dashboards of the athletes she follows. The nutritionist is otherwise
-- read-only, so this is done through a tightly-scoped security-definer RPC that
-- only writes the `nutritionist` key of each flagged athlete's app_state — she
-- can't touch anything else.
--
-- SAFE + ADDITIVE. Keep PITR on (or a quick pg_dump). Run in the SQL editor.
-- ---------------------------------------------------------------------------

create or replace function app_stamp_nutritionist(photo text) returns void
language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if not app_is_nutritionist() then
    raise exception 'not a nutritionist';
  end if;
  select name into me from app_profiles where user_id = auth.uid();

  -- Write the card onto every athlete currently flagged nutrition…
  update app_state s
     set data = jsonb_set(
       coalesce(s.data, '{}'::jsonb), '{nutritionist}',
       jsonb_build_object('name', coalesce(me, 'Nutritionist'), 'role', 'Nutritionist', 'photo', photo))
   where s.user_id in (select user_id from app_profiles where nutrition = true);

  -- …and clear it from anyone who's no longer a nutrition client.
  update app_state s
     set data = s.data - 'nutritionist'
   where s.data ? 'nutritionist'
     and s.user_id in (select user_id from app_profiles where coalesce(nutrition, false) = false);
end;
$$;
grant execute on function app_stamp_nutritionist(text) to authenticated;

notify pgrst, 'reload schema';
