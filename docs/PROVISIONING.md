# Provisioning coaches & athletes (invite-only)

Signup is disabled (`enable_signup = false`). Accounts are created by invite, and
every coach/athlete row's primary key **is** its `auth.users` id.

## 1. Create the 3 coaches

For each coach, invite the auth user, then insert the matching `coaches` row.

```bash
# Invite via the Supabase dashboard (Auth -> Users -> Invite) OR the admin API.
# Then, using the returned user id, run (SQL editor / service role):
insert into coaches (id, full_name, email, is_head_coach)
values ('<auth-user-uuid>', 'Noa', 'depaepe.noa14@gmail.com', true);   -- head coach
insert into coaches (id, full_name, email) values ('<uuid>', 'Mika', 'mika@…');
insert into coaches (id, full_name, email) values ('<uuid>', 'Maxim', 'maxim@…');
```

Only **one** coach should have `is_head_coach = true` (Noa). Shop orders route to
whichever coaches are head coaches.

## 2. Invite athletes

A coach invites an athlete, then inserts the `athletes` row with
`primary_coach_id` = that coach's id. In the app this is a single "invite
athlete" action wired to the Auth admin API + this insert; done manually it is:

```sql
insert into athletes (id, full_name, email, primary_coach_id, sex, weight_class)
values ('<auth-user-uuid>', 'Athlete Name', 'athlete@…', '<coach-uuid>', 'male', '-83kg');
```

## Notes

- The admin/invite calls need the **service-role key** — run them from a trusted
  server context (an edge function or the dashboard), never the browser client.
- RLS guards prevent an athlete from moving themselves to another coach and
  prevent non-head-coaches from granting head-coach status (see
  `supabase/migrations/0011_guards.sql`).
