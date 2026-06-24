// submit-booking — Supabase Edge Function (Deno) — the public booking GATEWAY (PLAN §3).
//
// The browser (anon) no longer calls create_booking directly. It POSTs here. This function:
//   1. verifies a Cloudflare Turnstile token server-side (fail-OPEN if TURNSTILE_SECRET is unset,
//      so booking still works before the key is configured — IP/phone limits still apply),
//   2. throttles per client IP (hashed) over a short window,
//   3. limits per phone over a day,
//   4. records the attempt + opportunistically prunes old rows, then
//   5. calls create_booking (9-arg) via the service_role key and returns its Result VERBATIM.
//
// Invocation: browser -> this function (verify_jwt = false; see supabase/config.toml). It is CORS-
// enabled (preflight + every response) because it is called cross-origin from the static site.
//
// HTTP-STATUS DISCIPLINE: supabase-js `functions.invoke` turns any non-2xx into a FunctionsHttpError
// (data:null, reason buried in error.context). So EVERY EXPECTED outcome — failed_challenge,
// rate_limited, and every pass-through create_booking error (slot_taken, outside_hours, invalid, ...) —
// returns HTTP 200 with { ok:false, error }. Non-2xx is reserved for true faults: a bad JSON body (400)
// or an unhandled exception (500).
//
// Run locally: npx supabase functions serve submit-booking --no-verify-jwt --env-file supabase/functions/.env

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --- CORS -------------------------------------------------------------------------------------

// `*` because the static site is served from a different origin (Vercel) than the function (Supabase),
// and the request carries no credentials/cookies — only the public anon apikey header.
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Tunable backstops ------------------------------------------------------------------------
// GENEROUS, coarse limits — tunable; Turnstile is the real bot gate. These must NOT false-positive on
// shared CGNAT / salon Wi-Fi (many people behind one IP) or a parent booking self + 2 kids in a row.
const MAX_PER_IP = 10;                 // max accepted attempts per IP hash within IP_WINDOW_MS
const IP_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const MAX_PER_PHONE = 5;               // max bookings per phone within PHONE_WINDOW_MS
const PHONE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const ATTEMPT_TTL_MS = 60 * 60 * 1000; // prune booking_attempts rows older than 1 hour

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// --- Types ------------------------------------------------------------------------------------

interface BookingInput {
  readonly barberId: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly price: number;
  readonly durationMin: number;
  readonly startAt: string; // ISO timestamptz string (already Stockholm-correct; see PLAN §3 H2)
  readonly phone: string;
  readonly lang: string;
  readonly customerName: string;
}

type ParseResult =
  | { readonly ok: true; readonly booking: BookingInput; readonly turnstileToken: string }
  | { readonly ok: false; readonly error: string };

// --- Validation (boundary; never trust the request body) --------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseRequest(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const root = raw as Record<string, unknown>;
  const b = root.booking;
  if (typeof b !== "object" || b === null) {
    return { ok: false, error: "booking is required" };
  }
  const r = b as Record<string, unknown>;

  if (!isNonEmptyString(r.barberId)) return { ok: false, error: "barberId is required" };
  if (!isNonEmptyString(r.serviceId)) return { ok: false, error: "serviceId is required" };
  if (!isNonEmptyString(r.serviceName)) return { ok: false, error: "serviceName is required" };
  if (!isFiniteNumber(r.price)) return { ok: false, error: "price must be a number" };
  if (!isFiniteNumber(r.durationMin)) return { ok: false, error: "durationMin must be a number" };
  if (!isNonEmptyString(r.startAt)) return { ok: false, error: "startAt is required" };
  if (!isNonEmptyString(r.phone)) return { ok: false, error: "phone is required" };
  if (!isNonEmptyString(r.lang)) return { ok: false, error: "lang is required" };
  if (!isNonEmptyString(r.customerName)) return { ok: false, error: "customerName is required" };

  // turnstileToken is optional (empty when the widget is offline / unconfigured); coerce to string.
  const token = typeof root.turnstileToken === "string" ? root.turnstileToken : "";

  return {
    ok: true,
    turnstileToken: token,
    booking: {
      barberId: r.barberId,
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      price: r.price,
      durationMin: r.durationMin,
      startAt: r.startAt,
      phone: r.phone,
      lang: r.lang,
      customerName: r.customerName,
    },
  };
}

// --- Helpers ----------------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// SHA-256 hex of (ip + salt) via Web Crypto. We persist the HASH, never the raw IP -> PII-minimal.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Best-effort client IP. x-forwarded-for is a comma-list (client first); cf-connecting-ip is a single
// value. Falls back to "unknown" so the hash is still deterministic (one shared bucket) rather than null.
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

// Turnstile siteverify. Returns true to PROCEED (success OR no secret configured = fail-open), false to
// reject. A network/HTTP error during verification is treated as a failed challenge (fail-closed on the
// verify call itself, once a secret IS configured).
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) {
    console.warn("submit-booking: TURNSTILE_SECRET unset — skipping challenge (fail-open).");
    return true;
  }
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip && ip !== "unknown") form.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("submit-booking: Turnstile verify error:", err);
    return false;
  }
}

// --- HTTP handler -----------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight — must be the first thing handled, with the CORS headers.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // Parse + validate the body. Bad JSON / wrong shape is a true client fault -> non-2xx.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const parsed = parseRequest(raw);
  if (!parsed.ok) {
    return json({ ok: false, error: "invalid_payload", detail: parsed.error }, 400);
  }
  const { booking, turnstileToken } = parsed;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("submit-booking: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    return json({ ok: false, error: "not_configured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const ip = clientIp(req);

  // 1. Turnstile — server-side challenge (fail-open when no secret is set).
  const challengeOk = await verifyTurnstile(turnstileToken, ip);
  if (!challengeOk) {
    return json({ ok: false, error: "failed_challenge" }, 200);
  }

  try {
    // 2. IP hash.
    const ipSalt = Deno.env.get("IP_SALT") ?? "";
    const ipHash = await sha256Hex(ip + ipSalt);

    // 3. Per-IP throttle: count accepted attempts for this hash within the window.
    const ipSince = new Date(Date.now() - IP_WINDOW_MS).toISOString();
    const ipCount = await supabase
      .from("booking_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", ipSince);
    if (ipCount.error) throw ipCount.error;
    if ((ipCount.count ?? 0) >= MAX_PER_IP) {
      return json({ ok: false, error: "rate_limited" }, 200);
    }

    // 4. Per-phone limit: count bookings for this phone within the 24h window. bookings is PII and
    //    RPC-gated (the gateway has no direct SELECT on it), so we count via a definer RPC that returns
    //    just an integer — keeping the "bookings only via RPC" boundary intact.
    const phoneSince = new Date(Date.now() - PHONE_WINDOW_MS).toISOString();
    const phoneCount = await supabase.rpc("recent_booking_count_by_phone", {
      p_phone: booking.phone,
      p_since: phoneSince,
    });
    if (phoneCount.error) throw phoneCount.error;
    if ((phoneCount.data ?? 0) >= MAX_PER_PHONE) {
      return json({ ok: false, error: "rate_limited" }, 200);
    }

    // 5. Record this attempt, then opportunistically prune rows older than the TTL. The prune is
    //    best-effort: a failure to prune must not fail the booking, so we log and continue.
    const inserted = await supabase.from("booking_attempts").insert({ ip_hash: ipHash });
    if (inserted.error) throw inserted.error;
    const pruneBefore = new Date(Date.now() - ATTEMPT_TTL_MS).toISOString();
    const pruned = await supabase.from("booking_attempts").delete().lt("created_at", pruneBefore);
    if (pruned.error) console.error("submit-booking: attempt prune failed:", pruned.error);

    // 6. Create the booking via the schedule-enforcing RPC (service_role). Return its Result verbatim.
    const rpc = await supabase.rpc("create_booking", {
      p_barber_id: booking.barberId,
      p_service_id: booking.serviceId,
      p_service_name: booking.serviceName,
      p_price: booking.price,
      p_duration_min: booking.durationMin,
      p_start_at: booking.startAt,
      p_phone: booking.phone,
      p_lang: booking.lang,
      p_customer_name: booking.customerName,
    });
    if (rpc.error) throw rpc.error;

    // create_booking always returns a JSONB Result ({ok:true,...} | {ok:false,error}); pass it through.
    return json(rpc.data, 200);
  } catch (err) {
    console.error("submit-booking: unhandled error:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
