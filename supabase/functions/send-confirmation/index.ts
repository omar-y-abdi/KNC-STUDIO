// send-confirmation — Supabase Edge Function (Deno) — SKELETON.
//
// Purpose: when a booking is INSERTed, send the customer a confirmation over the channel they
// chose (SMS via 46elks/Twilio, email via Resend). No provider key exists yet, so this skeleton
// VALIDATES the payload and then SKIPS sending (logs + returns 200 { ok: true, skipped: ... }).
// Wire it to a Database Webhook on `bookings` INSERT — see README.md in this folder.
//
// Invocation: server -> server from a trusted Supabase Database Webhook, so it receives no user
// JWT (config.toml: verify_jwt = false). Secure it with a shared header secret in production
// (see README.md) — never expose it as a public send endpoint.
//
// Deno entrypoint. Run locally with `npx supabase functions serve send-confirmation`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Types ------------------------------------------------------------------------------------

type Method = "sms" | "email";

interface BookingPayload {
  readonly id: string;
  readonly method: Method;
  readonly phone: string | null;
  readonly email: string | null;
  readonly start_at: string; // ISO timestamptz
  readonly barber_id: string;
  readonly service_name: string;
}

type ParseResult =
  | { readonly ok: true; readonly booking: BookingPayload }
  | { readonly ok: false; readonly error: string };

// A Database Webhook posts { type, table, record, old_record, schema }. We accept either that
// envelope (use `.record`) or a bare booking object (for manual testing / direct invokes).
interface WebhookEnvelope {
  readonly type?: string;
  readonly table?: string;
  readonly record?: unknown;
}

// --- Validation (boundary; never trust the request body) --------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseBooking(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "payload must be a JSON object" };
  }
  // Unwrap a Database Webhook envelope if present.
  const env = raw as WebhookEnvelope;
  const candidate: unknown =
    env.record !== undefined ? env.record : raw;

  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, error: "missing booking record" };
  }
  const r = candidate as Record<string, unknown>;

  if (!isNonEmptyString(r.id)) return { ok: false, error: "id is required" };
  if (r.method !== "sms" && r.method !== "email") {
    return { ok: false, error: "method must be 'sms' or 'email'" };
  }
  if (!isNonEmptyString(r.start_at)) {
    return { ok: false, error: "start_at is required" };
  }
  if (!isNonEmptyString(r.barber_id)) {
    return { ok: false, error: "barber_id is required" };
  }
  if (!isNonEmptyString(r.service_name)) {
    return { ok: false, error: "service_name is required" };
  }

  const phone = isNonEmptyString(r.phone) ? r.phone : null;
  const email = isNonEmptyString(r.email) ? r.email : null;

  // The chosen channel must carry a destination.
  if (r.method === "sms" && phone === null) {
    return { ok: false, error: "sms booking requires phone" };
  }
  if (r.method === "email" && email === null) {
    return { ok: false, error: "email booking requires email" };
  }

  return {
    ok: true,
    booking: {
      id: r.id,
      method: r.method,
      phone,
      email,
      start_at: r.start_at,
      barber_id: r.barber_id,
      service_name: r.service_name,
    },
  };
}

// --- Recipient lookup (DB-authoritative; never the request body) ------------------------------

// Re-fetch the customer's contact from the `bookings` row by id using the service-role key (which
// Edge Functions inject as SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). The send TARGET therefore comes
// from the database, NOT the POST body — a webhook caller cannot redirect the message to an arbitrary
// recipient even if they forge the payload.
async function fetchRecipient(id: string, method: Method): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("bookings")
    .select("phone, email")
    .eq("id", id)
    .single();
  if (error || data === null) return null;
  const value = method === "sms" ? data.phone : data.email;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// --- Provider send (DOCUMENTED TODO — gated on env that is absent now) -------------------------

interface SendOutcome {
  readonly sent: boolean;
  readonly skipped?: string;
}

async function sendConfirmation(booking: BookingPayload, recipient: string): Promise<SendOutcome> {
  // `recipient` is the DB-sourced destination (see fetchRecipient) — never the request body.
  if (recipient.length === 0) return { sent: false, skipped: "no_recipient" };

  if (booking.method === "email") {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return { sent: false, skipped: "no_provider_configured" };
    }
    // TODO(email/Resend): POST https://api.resend.com/emails with
    //   Authorization: `Bearer ${resendKey}`, from: a verified sender, to: `recipient`,
    //   subject + html built from booking.service_name / booking.start_at (format in
    //   Europe/Stockholm). Return { sent: true } on 2xx, throw on failure.
    //   Docs: https://resend.com/docs/api-reference/emails/send-email
    return { sent: false, skipped: "email_provider_todo" };
  }

  // method === "sms"
  const elksUser = Deno.env.get("ELKS_API_USERNAME");
  const elksPass = Deno.env.get("ELKS_API_PASSWORD");
  if (!elksUser || !elksPass) {
    return { sent: false, skipped: "no_provider_configured" };
  }
  // TODO(sms/46elks): POST https://api.46elks.com/a1/sms with HTTP Basic auth
  //   (`${elksUser}:${elksPass}`), form fields from=<sender>, to=`recipient`,
  //   message=<confirmation text>. Return { sent: true } on 2xx, throw on failure.
  //   Docs: https://46elks.com/docs/send-sms
  //   (Twilio alternative: POST .../Messages.json with TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.)
  return { sent: false, skipped: "sms_provider_todo" };
}

// --- HTTP handler -----------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Shared-secret auth — FAIL-CLOSED. The webhook is server->server (verify_jwt = false), so this
  // shared secret is the only authentication. If WEBHOOK_SECRET is unset the function is NOT safe to
  // run (it would be a publicly-invokable relay), so reject everything; if set, require the matching
  // header. Set it with `supabase secrets set WEBHOOK_SECRET=...` and send it as `x-webhook-secret`
  // from the Database Webhook config.
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!webhookSecret) {
    return json({ ok: false, error: "not_configured" }, 503);
  }
  if (req.headers.get("x-webhook-secret") !== webhookSecret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = parseBooking(raw);
  if (!parsed.ok) {
    return json({ ok: false, error: "invalid_payload", detail: parsed.error }, 400);
  }

  // Re-fetch the send target from the DB by id — never trust the posted phone/email as the recipient.
  const recipient = await fetchRecipient(parsed.booking.id, parsed.booking.method);
  if (recipient === null) {
    console.error(`send-confirmation: no recipient for booking ${parsed.booking.id}`);
    return json({ ok: false, error: "recipient_not_found" }, 404);
  }

  try {
    const outcome = await sendConfirmation(parsed.booking, recipient);
    if (!outcome.sent) {
      // No provider wired yet (expected today): log and succeed so the webhook is not retried.
      console.log(
        `send-confirmation: skipped (${outcome.skipped}) for booking ${parsed.booking.id} ` +
          `[${parsed.booking.method}]`,
      );
      return json({ ok: true, skipped: outcome.skipped ?? "no_provider_configured" }, 200);
    }
    console.log(`send-confirmation: sent for booking ${parsed.booking.id} [${parsed.booking.method}]`);
    return json({ ok: true, sent: true }, 200);
  } catch (err) {
    // Provider failure: log detail server-side, return a generic error (no PII leak).
    console.error(`send-confirmation: provider error for booking ${parsed.booking.id}:`, err);
    return json({ ok: false, error: "send_failed" }, 502);
  }
});
