# reset-athlete-password

Server-side password reset for athlete accounts. A coach, signed into the
console, can set a new password for one of **their** athletes. The admin key
that makes this possible lives only in this function on Supabase's servers — it
is never shipped to the browser.

## Why a function (and not a button in the app)

Changing another user's Supabase password requires the `service_role` key. That
key can read and write *everything* in your project, bypassing all row-level
security. If it were in the web app, anyone could extract it from the browser.
So the reset runs here instead, where only Supabase can see the key, and the
function checks that the caller really is the coach who owns that athlete.

## Deploy (one time)

You need the Supabase CLI and to be logged in (`supabase login`).

```bash
# from the repo root
supabase functions deploy reset-athlete-password --project-ref skdjpydjkqjqwrdgqpco
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically into deployed functions — you do **not** set them yourself, and
you must **never** put the service_role key in the web app or commit it.

That's it. Once deployed, the **Reset password** button on each athlete's
profile in the coach console works. Until it's deployed, the button shows a
"function isn't deployed yet" message and changes nothing.

## What it checks

1. The caller is signed in (their JWT is sent automatically).
2. Their profile role is `coach`.
3. The target athlete exists and their `coach_user_id` is the caller.

Only then does it update the password. Passwords themselves are never returned
or logged — they can't be read back out of Supabase, only replaced.
