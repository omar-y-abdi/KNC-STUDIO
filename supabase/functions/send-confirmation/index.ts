// send-confirmation — Supabase Edge Function (Deno).
//
// Purpose: when a booking is INSERTed, send the customer an SMS confirmation. Email is removed
// (PLAN §1) — every booking is `method='sms'`, so this builds a localized SMS message from the
// DB-authoritative booking row and hands it to an iPhone via a Pushcut webhook (PLAN §4):
//
//   Supabase DB Webhook (bookings INSERT) -> this function -> Pushcut webhook URL -> iPhone
//   notification -> a Pushcut/Shortcuts automation sends the SMS from the phone's Messages app.
//
// With no PUSHCUT_WEBHOOK_URL set it VALIDATES + logs and returns 200 { ok:true, skipped: ... } (no
// send), so the webhook is wired before the bridge exists without retry storms.
//
// Invocation: server -> server from a trusted Supabase Database Webhook, so it receives no user JWT
// (config.toml: verify_jwt = false). Secured by a shared header secret (WEBHOOK_SECRET, fail-closed).
//
// Deno entrypoint. Run locally with `npx supabase functions serve send-confirmation`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- Types ------------------------------------------------------------------------------------

// We accept either a Database Webhook envelope ({ type, table, record, ... }, we read `record`) or a
// bare booking object (for manual curl tests). Only `id` is required from the payload — every field
// used to BUILD the message is re-read from the DB by id (see fetchBooking), so a forged payload can
// neither redirect the SMS nor alter its contents.
interface WebhookEnvelope {
  readonly type?: string;
  readonly table?: string;
  readonly record?: unknown;
}

interface BookingRow {
  readonly phone: string;
  readonly customer_name: string;
  readonly start_at: string; // ISO timestamptz
  readonly service_name: string;
  readonly barber_name: string;
  readonly lang: string;
}

type IdResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

// --- Validation (boundary; never trust the request body) --------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Extract the booking id from the payload (envelope `record.id` or a bare `id`). Everything else is
// read from the DB, so the id is all we need from the (untrusted) body.
function parseBookingId(raw: unknown): IdResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "payload must be a JSON object" };
  }
  const env = raw as WebhookEnvelope;
  const candidate: unknown = env.record !== undefined ? env.record : raw;
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, error: "missing booking record" };
  }
  const r = candidate as Record<string, unknown>;
  if (!isNonEmptyString(r.id)) return { ok: false, error: "id is required" };
  return { ok: true, id: r.id };
}

// --- DB-authoritative read (service-role; never the request body) -----------------------------

// Re-fetch the booking by id with the service-role key (Edge Functions inject SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY). bookings is PII and RPC-gated even for service_role (migration 0002), so
// we read through the definer RPC booking_confirmation_details(p_id) which returns EXACTLY the SMS
// fields (incl. the barber's display name). The send TARGET (phone) AND the message content both come
// from the DATABASE, NOT the POST body — a forged webhook payload cannot redirect or rewrite the SMS (M3).
async function fetchBooking(id: string): Promise<BookingRow | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("booking_confirmation_details", { p_id: id });
  if (error || data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // A null phone (e.g. a legacy email-method row) means there is no SMS recipient.
  if (
    !isNonEmptyString(d.phone) ||
    !isNonEmptyString(d.customer_name) ||
    !isNonEmptyString(d.start_at) ||
    !isNonEmptyString(d.service_name) ||
    !isNonEmptyString(d.barber_name) ||
    !isNonEmptyString(d.lang)
  ) {
    return null;
  }
  return {
    phone: d.phone,
    customer_name: d.customer_name,
    start_at: d.start_at,
    service_name: d.service_name,
    barber_name: d.barber_name,
    lang: d.lang,
  };
}

// --- Message building (Stockholm-local, localized) --------------------------------------------

// First name only — the SMS greets "Hej Hassan!", not the full booked name.
function firstName(customerName: string): string {
  const first = customerName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : customerName;
}

function buildMessage(booking: BookingRow, barberName: string): string {
  const when = new Date(booking.start_at);
  const isEn = booking.lang === "en";
  const locale = isEn ? "en-GB" : "sv-SE";
  // Stockholm wall-clock, regardless of the server's timezone (DST-safe via Intl + timeZone).
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Stockholm",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(when);
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(when);

  const name = firstName(booking.customer_name);
  if (isEn) {
    return `Hi ${name}! Your appointment with ${barberName} at KNC Studio is booked: ` +
      `${date} at ${time} (${booking.service_name}). See you soon!`;
  }
  return `Hej ${name}! Din tid hos ${barberName} på KNC Studio är bokad: ` +
    `${date} kl ${time} (${booking.service_name}). Välkommen!`;
}

// --- Pushcut bridge ---------------------------------------------------------------------------

interface SendOutcome {
  readonly sent: boolean;
  readonly skipped?: string;
}

// POST { phone, message } (server -> server) to the Pushcut webhook URL, which fires an iPhone
// notification whose Pushcut/Shortcuts automation sends the SMS. Unset URL -> skip (current behavior).
//
// HONEST iOS CAVEAT: iOS does NOT allow a Shortcut to send an SMS fully unattended in the background —
// "Send Message" typically requires a tap to confirm on the device (and reliable triggering usually
// needs Pushcut Automation Server / a always-on device). So this bridge DELIVERS the ready-to-send
// message to the phone; the final send is semi-automatic. Documented in README.md.
async function sendViaPushcut(phone: string, message: string): Promise<SendOutcome> {
  const pushcutUrl = Deno.env.get("PUSHCUT_WEBHOOK_URL");
  if (!pushcutUrl) {
    return { sent: false, skipped: "no_pushcut_configured" };
  }
  const res = await fetch(pushcutUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Pushcut reads { text/title } for the notification; we also pass phone + message explicitly so a
    // Shortcut automation can populate the Messages recipient + body from the webhook payload.
    body: JSON.stringify({ phone, message, title: "KNC Studio", text: message }),
  });
  if (!res.ok) {
    throw new Error(`Pushcut webhook returned ${res.status}`);
  }
  return { sent: true };
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
  // header. Set it with `supabase secrets set WEBHOOK_SECRET=...` and send it as `x-webhook-secret`.
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

  const parsed = parseBookingId(raw);
  if (!parsed.ok) {
    return json({ ok: false, error: "invalid_payload", detail: parsed.error }, 400);
  }

  // Re-read the booking from the DB by id — the phone AND the message content are DB-authoritative.
  const booking = await fetchBooking(parsed.id);
  if (booking === null) {
    console.error(`send-confirmation: no sendable booking for id ${parsed.id}`);
    return json({ ok: false, error: "recipient_not_found" }, 404);
  }

  try {
    const message = buildMessage(booking, booking.barber_name);
    const outcome = await sendViaPushcut(booking.phone, message);
    if (!outcome.sent) {
      // No Pushcut URL wired yet: log and succeed so the webhook is not retried.
      console.log(`send-confirmation: skipped (${outcome.skipped}) for booking ${parsed.id} [sms]`);
      return json({ ok: true, skipped: outcome.skipped ?? "no_pushcut_configured" }, 200);
    }
    console.log(`send-confirmation: sent for booking ${parsed.id} [sms]`);
    return json({ ok: true, sent: true }, 200);
  } catch (err) {
    // Bridge failure: log detail server-side, return a generic error (no PII leak).
    console.error(`send-confirmation: pushcut error for booking ${parsed.id}:`, err);
    return json({ ok: false, error: "send_failed" }, 502);
  }
});
