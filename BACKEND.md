# Going live — KNC Studio Supabase backend

The site ships **mock-by-default**: with no `VITE_SUPABASE_*` env it runs fully on the offline
adapters (bookings/reviews/cancellation are simulated, nothing is persisted) and the visual baseline
is unchanged. Setting the two public env vars flips the whole app to the real Supabase backend — no
code change. This document is the ordered checklist to do that.

Everything runs from the project root (`/Users/k/dev/barber/project`). The database layer
(`supabase/`) is already written, migration-tested (pgTAP) and integration-tested against a local
stack; you only need to create a cloud project, push the migrations, and set two Vercel env vars.

---

## 1. Log in to the Supabase CLI

```bash
npx supabase login
```

Opens a browser to authorize the CLI against your Supabase account.

## 2. Create the cloud project

In the Supabase dashboard (https://supabase.com/dashboard) → **New project**:

- **Name:** `knc-studio` (matches `project_id` in `supabase/config.toml`).
- **Region:** pick the one closest to Sweden — **`eu-north-1` (Stockholm)** is ideal, `eu-central-1`
  (Frankfurt) is the fallback. Low latency for Gothenburg customers.
- **Database password:** generate a strong one and store it in your password manager (you will not
  need it for the steps below, but you do for direct `psql`/backups).

Copy the project's **Reference ID** (Project Settings → General → "Reference ID", looks like
`abcdefghijklmnop`).

## 3. Link the local repo to the cloud project

```bash
npx supabase link --project-ref <ref>
```

## 4. Push the database (migrations + seed)

```bash
npx supabase db push          # applies supabase/migrations/* (schema, RLS, RPCs)
```

This creates the `bookings` + `reviews` tables, the row-level security, the SECURITY DEFINER RPCs,
and the no-double-booking exclusion constraint. The 3 placeholder reviews in `supabase/seed.sql` are
loaded automatically on a local `db reset`; to seed the **cloud** project once, run the seed
explicitly (it is idempotent only if the table is empty — run it a single time):

```bash
# Optional: load the placeholder reviews into the cloud DB (run once).
npx supabase db push --include-seed
```

(If your CLI version does not support `--include-seed`, paste `supabase/seed.sql` into the
dashboard's SQL editor once instead.)

## 5. Point the live site at the backend (Vercel)

In the Supabase dashboard → **Project Settings → API**, copy:

- **Project URL** → set as `VITE_SUPABASE_URL`
- **anon / public key** → set as `VITE_SUPABASE_ANON_KEY`

In **Vercel → your project → Settings → Environment Variables**, add both (Production, and Preview if
you want previews on the real backend):

```
VITE_SUPABASE_URL        = https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY   = <the anon public key>
```

The **anon key is public and safe** to expose in the client bundle — the security boundary is RLS +
the contact-proving RPCs, not key secrecy. **Never** set the `service_role` key in Vercel or with a
`VITE_` prefix; it bypasses RLS and must stay server-only.

**Redeploy** (Vercel → Deployments → Redeploy, or push a commit). The live site now:

- persists bookings (with the no-double-booking guarantee enforced in the DB),
- greys time slots from **real** availability (`taken_slots`),
- persists + lists real reviews,
- looks up + cancels real bookings by proven contact.

With the env **unset**, it silently falls back to the mocks — so a missing/typo'd var degrades
gracefully rather than breaking the page.

## 6. Admin panel — create the login accounts

The admin panel lives at `/login` + `/admin`. It needs Supabase Auth accounts: one **owner** (you,
full access) and one **barber** per barber who should manage their own schedule + bookings. After
`db push`:

1. **Create the users** — dashboard → **Authentication → Users → Add user**: add your owner email +
   a strong password, and one per barber. (Email confirmation can be turned off for staff accounts.)
2. **Assign roles** — **SQL Editor**, once per user (the `id` is that user's UID from the Users list):
   ```sql
   -- owner (you): full access, no barber link
   insert into public.profiles (id, role, barber_id) values ('<owner-uid>', 'owner', null);
   -- each barber: scoped to their own barber row (barber_id matches a public.barbers.id)
   insert into public.profiles (id, role, barber_id) values ('<barber-uid>', 'barber', 'hassan');
   ```
3. Sign in at `https://<your-site>/login`. The owner sees + manages everything (all barbers,
   bookings, Om oss text, gallery); a barber sees ONLY their own bookings + schedule.

Security is enforced by **RLS**, not the UI: a barber cannot read or change another barber's data
even if they tamper with the client. The `service_role` key is **never** used in the browser or set
in Vercel — the admin uses the signed-in user's Auth session + the public anon key.

## 7. (Optional, later) Confirmation messages — Edge Function + webhook

The `supabase/functions/send-confirmation` function is a **skeleton**: it validates the booking
payload and, with no provider key, logs and returns `{ ok: true, skipped: "no_provider_configured" }`.
To enable real SMS/email confirmations:

1. **Deploy the function:**
   ```bash
   npx supabase functions deploy send-confirmation
   ```
2. **Add a provider key** (Project Settings → Edge Functions → Secrets, or
   `npx supabase secrets set ...`):
   - Email: `RESEND_API_KEY`
   - SMS: `ELKS_*` (46elks) or your Twilio credentials
   Then implement the documented `TODO` send in `index.ts` (see its `README.md`).
3. **Wire a Database Webhook** (dashboard → Database → Webhooks): on `bookings` **INSERT**, POST the
   row to the function's URL. The function runs server→server (`verify_jwt = false`); secure it with
   a shared header secret as described in `supabase/functions/send-confirmation/README.md`. Do **not**
   create the webhook before the function is deployed (it needs the live function URL).

## 8. Free-tier operational notes

- **Auto-pause:** a free project **pauses after ~7 days of inactivity**. A static site that gets
  occasional traffic may go cold. Add a tiny keep-alive (e.g. a scheduled GitHub Action / cron that
  hits a cheap endpoint daily), or upgrade to Pro.
- **No automated backups** on free tier. Schedule a periodic `pg_dump` (the DB connection string is
  in Project Settings → Database), or upgrade to Pro for daily PITR backups. The `bookings` table is
  real customer PII — treat backups accordingly.

---

## Reverting to mocks

Remove (or blank) `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel and redeploy. The app
returns to the offline mock adapters with zero code changes.

## Verifying locally before go-live

```bash
npm run build            # tsc strict + vite build — clean
npx eslint .             # exit 0
npm test                 # unit tests (mock path), green
npx supabase start       # boot the local stack (Docker), then:
npx supabase test db     # pgTAP DB tests, green
npm run test:integration # real adapters against the local stack, green
```

`npm run test:integration` auto-discovers the running local stack via `supabase status`; if the
stack is down it **skips** (so it never blocks a normal `npm test`).
