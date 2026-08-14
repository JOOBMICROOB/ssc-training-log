# daily-notifications

Scheduled push notifications for athletes:

- **morning** (~9:00 Brussels): weekly check-in reminder on the last day of each
  athlete's training week + meet countdowns (3 / 2 / 1 weeks + "tomorrow").
- **evening** (~18:00 Brussels): missed-session nudge — a training day with
  nothing logged yet.

It reuses the same VAPID key as the publish notification. It's a system call
(cron), so it's protected by a shared `CRON_SECRET` header instead of a login.

## One-time setup

1. **Set the secrets** (VAPID_PRIVATE_KEY is already set from the push feature):

   ```bash
   cd /Users/noadepaepe/REMOTION && npx supabase secrets set CRON_SECRET=IRNFQSfgrformQ1LGqoBEfsc0CX28CoA --project-ref skdjpydjkqjqwrdgqpco
   ```

2. **Deploy the function:**

   ```bash
   cd /Users/noadepaepe/REMOTION && npx supabase functions deploy daily-notifications --project-ref skdjpydjkqjqwrdgqpco
   ```

3. **Schedule it** — in the Supabase dashboard → **Database → Extensions**, enable
   **pg_cron** and **pg_net**. Then run this in the **SQL Editor** (7:00 and 16:00
   UTC ≈ 9:00 and 18:00 Brussels in summer):

   ```sql
   select cron.schedule('ssc-morning', '0 7 * * *', $$
     select net.http_post(
       url := 'https://skdjpydjkqjqwrdgqpco.supabase.co/functions/v1/daily-notifications?slot=morning',
       headers := jsonb_build_object('x-cron-secret','IRNFQSfgrformQ1LGqoBEfsc0CX28CoA','Content-Type','application/json'),
       body := '{}'::jsonb
     );
   $$);

   select cron.schedule('ssc-evening', '0 16 * * *', $$
     select net.http_post(
       url := 'https://skdjpydjkqjqwrdgqpco.supabase.co/functions/v1/daily-notifications?slot=evening',
       headers := jsonb_build_object('x-cron-secret','IRNFQSfgrformQ1LGqoBEfsc0CX28CoA','Content-Type','application/json'),
       body := '{}'::jsonb
     );
   $$);
   ```

## Test it now

```bash
curl -X POST "https://skdjpydjkqjqwrdgqpco.supabase.co/functions/v1/daily-notifications?slot=morning" \
  -H "x-cron-secret: IRNFQSfgrformQ1LGqoBEfsc0CX28CoA"
```

Returns `{ "ok": true, "slot": "morning", "sent": N }`. Only athletes who enabled
notifications (and match the day's condition) get one.

## Notes

- Times assume Belgium (Europe/Brussels). To change, edit the cron UTC hours.
- To remove a schedule: `select cron.unschedule('ssc-morning');`
