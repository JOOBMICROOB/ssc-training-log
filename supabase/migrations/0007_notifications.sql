-- 0007_notifications.sql
-- In-app notifications. Rows are created server-side by triggers (never by the
-- client directly). The first source is program publish/assign -> notify the
-- athlete; the trigger lives here so the target table exists.

create table notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type              text not null,          -- e.g. 'program_published'
  title             text not null,
  body              text,
  data              jsonb not null default '{}'::jsonb,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index notifications_recipient_idx
  on notifications (recipient_user_id, created_at desc);
create index notifications_unread_idx
  on notifications (recipient_user_id) where read_at is null;

-- Fire a notification to the assigned athlete when a program becomes published,
-- or when an already-published program is (re)assigned to a different athlete.
create or replace function ssc_notify_program_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  do_notify boolean := false;
begin
  -- Referencing OLD only inside the UPDATE branch: OLD is unassigned on INSERT.
  if new.status = 'published' and new.athlete_id is not null then
    if tg_op = 'INSERT' then
      do_notify := true;
    else
      do_notify := old.status is distinct from 'published'
                   or new.athlete_id is distinct from old.athlete_id;
    end if;
  end if;

  if do_notify then
    insert into notifications (recipient_user_id, type, title, body, data)
    values (
      new.athlete_id,
      'program_published',
      'New program ready',
      coalesce(new.name, 'A new program') || ' is ready to view.',
      jsonb_build_object('program_id', new.id, 'program_name', new.name)
    );
  end if;
  return new;
end;
$$;

create trigger programs_notify_assigned
  after insert or update on programs
  for each row execute function ssc_notify_program_assigned();
