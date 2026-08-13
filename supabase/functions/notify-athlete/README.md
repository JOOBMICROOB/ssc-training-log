# notify-athlete

Sends a Web Push notification to one athlete when the coach publishes a program.
The VAPID private key (which signs the push) lives here as a Supabase secret and
never ships to the browser.

## One-time setup

1. **Set the VAPID private key as a secret** (this is the private half of the key
   pair; the public half is already baked into the app):

   ```bash
   npx supabase secrets set VAPID_PRIVATE_KEY=704DuhwPslKKFdryu-Dw7njgufkPrJjT0kC3tRcHfk8 --project-ref skdjpydjkqjqwrdgqpco
   ```

2. **Deploy the function:**

   ```bash
   npx supabase functions deploy notify-athlete --project-ref skdjpydjkqjqwrdgqpco
   ```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — you don't set those.

## How it works

- The athlete opts in on their phone (a "🔔 Turn on notifications" prompt). Their
  push subscription is stored in their account.
- When you hit **Publish**, the coach app calls this function with the athlete's
  code. It verifies you're their coach, reads their subscription, and sends the
  push. Their phone shows "New program from your coach — tap to open."

## iPhone requirement

Web push on iOS only works when the athlete has **added the app to their Home
Screen** (installed PWA) on **iOS 16.4 or newer**, and tapped **allow** on the
permission prompt. In a plain Safari tab it won't fire. Android/Chrome works in
the browser too.

If a push comes back 404/410 the subscription is dead (they reinstalled / revoked)
— they just re-enable notifications and it works again.
