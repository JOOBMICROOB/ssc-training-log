-- 0015_new_athlete_trigger.sql
-- ---------------------------------------------------------------------------
-- When the coach console creates an athlete it calls supabase.auth.signUp with
-- the athlete's details in user metadata (role/code/name/coach_user_id). This
-- trigger turns that new auth user into an app_profiles row automatically —
-- running as the DB owner so it bypasses RLS (a coach can't insert another
-- user's profile directly).
--
-- Run this file in the Supabase SQL editor, and disable "Confirm email" under
-- Authentication → Providers → Email so provisioned logins work immediately.
-- ---------------------------------------------------------------------------

create or replace function app_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.raw_user_meta_data ->> 'role') = 'athlete' then
    insert into app_profiles (user_id, role, code, name, coach_user_id)
    values (
      new.id,
      'athlete',
      new.raw_user_meta_data ->> 'code',
      new.raw_user_meta_data ->> 'name',
      nullif(new.raw_user_meta_data ->> 'coach_user_id', '')::uuid
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists app_on_auth_user_created on auth.users;
create trigger app_on_auth_user_created
  after insert on auth.users
  for each row execute function app_handle_new_user();
