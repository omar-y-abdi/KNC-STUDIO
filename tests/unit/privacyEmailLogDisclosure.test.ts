import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_RECEIPT_COOKIE,
  CUSTOMER_SESSION_COOKIE,
  customerCookieHeader,
} from '../../supabase/functions/_shared/customerCookies'
import {
  BOOKING_ACTIONS,
  customerGateway,
  GATEWAY_RATE_LIMIT_PERIOD_SECONDS,
  type GatewayRateLimit,
} from '../../supabase/worker/customerGateway'
import worker, { PublicContent } from '../../supabase/worker/index'
import { requestSchema as submitBooking } from '../../supabase/functions/submit-booking/request'

const source = (path: string): string => readFileSync(path, 'utf8').replace(/\s+/g, ' ')

const MIGRATIONS = 'supabase/migrations'
const BASELINE = '20261105182545_baseline.sql'
const REVIEW_MODERATION = '20261110120100_review_moderation.sql'
const CONTACT_CLEANUP = '20261110120300_orphaned_customer_contact_cleanup.sql'
const BOOKING_RETENTION = '20261110120400_booking_retention.sql'

interface Decided {
  readonly kind: 'function' | 'job' | 'policy' | 'constraint' | 'table'
  readonly name: string
  /** Every migration with a statement that defines or changes it, oldest first. */
  readonly files: readonly [string, ...string[]]
  /** Words of the policy that rest on it. */
  readonly states: string
}

const EMAIL_COPIES = 'Varje kopia raderas automatiskt 30 dagar efter det första sändningsförsöket.'
const BOOKING_AGE =
  'En bokning raderas automatiskt när det har gått mer än 12 månader sedan den bokade tiden slutade.'
const EARLIER_DELETE =
  'Salongens ägare, och en barberare för sina egna bokningar, kan radera avbokade och avslutade bokningar tidigare.'
const CONTACT_DATA =
  'Åtkomstlänken till Mina bokningar [...] tas bort av en nattlig rensning när varken e-postadressen eller någon e-postadress som är kopplad till den längre har någon bokning [...]'
const LINK_LIFE =
  'Länken har ingen fast tidsgräns. Den slutar fungera när den tas bort av rensningen [...]'
const LINK_REPLACED =
  'en ny begäran om länk för samma e-postadress ersätter och återkallar den tidigare länken'
const SESSION_END =
  'Servern avslutar sessionen när tiden har gått ut och kan återkalla den innan dess.'
const SESSION_LIFE = 'nödvändig HttpOnly-sessioncookie [...] i högst 30 dagar.'
const RATE_LIMIT =
  'Posterna raderas när de är äldre än två dygn: för bokningar en gång i timmen, för övriga i samband med nästa sådana förfrågan som godkänns.'
const REVIEW_SHOWN = 'Lämnar du ett omdöme visas det öppet på webbplatsen [...]'
const REVIEW_TAKEN_DOWN =
  'Salongens ägare kan dölja ett omdöme, som då sparas men inte längre visas på webbplatsen, eller ta bort det.'
const BARBER_EMAIL =
  'Har barberaren du bokar hos ett eget barberarkonto på webbplatsen får barberaren ett mejl [...]'

// The objects the policy rests on, each pinned in the last file of its row. The first test fails
// when a newer migration touches one, so the policy is checked before that file joins the row.
const DECIDED = [
  {
    kind: 'function',
    name: 'internal_purge_email_send_log',
    files: [BASELINE],
    states: EMAIL_COPIES,
  },
  { kind: 'job', name: 'email-send-log-purge', files: [BASELINE], states: EMAIL_COPIES },
  {
    kind: 'constraint',
    name: 'email_send_log_booking_id_fkey',
    files: [BASELINE],
    states: 'Raderas bokningen tidigare finns kopian kvar till dess, utan koppling till bokningen.',
  },
  {
    kind: 'function',
    name: 'internal_purge_expired_bookings',
    files: [BOOKING_RETENTION],
    states: BOOKING_AGE,
  },
  { kind: 'job', name: 'booking-retention-purge', files: [BOOKING_RETENTION], states: BOOKING_AGE },
  { kind: 'function', name: 'admin_delete_bookings', files: [BASELINE], states: EARLIER_DELETE },
  { kind: 'function', name: 'is_owner', files: [BASELINE], states: EARLIER_DELETE },
  { kind: 'function', name: 'current_barber_id', files: [BASELINE], states: EARLIER_DELETE },
  {
    kind: 'function',
    name: 'customer_emails_in_use',
    files: [CONTACT_CLEANUP],
    states: CONTACT_DATA,
  },
  {
    kind: 'function',
    name: 'cleanup_customer_booking_access',
    files: [BASELINE, CONTACT_CLEANUP],
    states: CONTACT_DATA,
  },
  {
    kind: 'job',
    name: 'customer-booking-access-cleanup',
    files: [BASELINE],
    states: CONTACT_DATA,
  },
  {
    kind: 'function',
    name: 'establish_customer_booking_session',
    files: [BASELINE],
    states: LINK_LIFE,
  },
  {
    kind: 'function',
    name: 'exchange_customer_booking_access',
    files: [BASELINE],
    states: SESSION_LIFE,
  },
  {
    kind: 'function',
    name: 'rotate_customer_booking_access_token',
    files: [BASELINE],
    states: LINK_REPLACED,
  },
  {
    kind: 'function',
    name: 'customer_booking_access_scope',
    files: [BASELINE],
    states: SESSION_END,
  },
  {
    kind: 'table',
    name: 'customer_booking_receipts',
    files: [BASELINE],
    states: 'Den innehåller inga kontaktuppgifter och gäller i högst 30 dagar.',
  },
  { kind: 'function', name: 'create_booking_with_limits', files: [BASELINE], states: RATE_LIMIT },
  { kind: 'job', name: 'booking-attempt-cleanup', files: [BASELINE], states: RATE_LIMIT },
  {
    kind: 'function',
    name: 'consume_public_action_attempt',
    files: [BASELINE],
    states: RATE_LIMIT,
  },
  { kind: 'function', name: 'create_review_for_browser', files: [BASELINE], states: REVIEW_SHOWN },
  { kind: 'policy', name: 'reviews_select_published', files: [BASELINE], states: REVIEW_SHOWN },
  {
    kind: 'constraint',
    name: 'reviews_booking_id_fkey',
    files: [BASELINE],
    states: 'Omdömet finns kvar även när bokningen har raderats.',
  },
  {
    kind: 'function',
    name: 'admin_set_review_published',
    files: [REVIEW_MODERATION],
    states: REVIEW_TAKEN_DOWN,
  },
  {
    kind: 'function',
    name: 'admin_delete_review',
    files: [REVIEW_MODERATION],
    states: REVIEW_TAKEN_DOWN,
  },
  {
    kind: 'function',
    name: 'booking_confirmation_details',
    files: [BASELINE],
    states: BARBER_EMAIL,
  },
] as const satisfies readonly Decided[]

type Named<Kind extends Decided['kind']> = Extract<
  (typeof DECIDED)[number],
  { readonly kind: Kind }
>['name']

const statements = (file: string): string =>
  source(`${MIGRATIONS}/${file}`).toLowerCase().replace(/"/g, '')

/** Statements that define or change an object of each kind; group 1 is its name. */
const STATEMENT = {
  function:
    /\b(?:create or replace|create|alter|drop) function (?:if exists )?(?:public\.)?(\w+) ?\(/g,
  policy: /\bpolicy (?:if exists )?(\w+)/g,
  constraint: /\bconstraint (?:if exists )?(\w+)/g,
  table:
    /\b(?:create|alter|drop) table (?:if not exists |if exists )?(?:only )?(?:public\.)?(\w+)/g,
} as const satisfies Readonly<Record<Exclude<Decided['kind'], 'job'>, RegExp>>

function concerns(sql: string, kind: Decided['kind'], name: string): boolean {
  // Scheduling, unscheduling and altering a job all quote its name.
  if (kind === 'job') return sql.includes(`'${name}'`)
  return [...sql.matchAll(STATEMENT[kind])].some((match) => match[1] === name)
}

function migrationsWhere(holds: (sql: string) => boolean): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => holds(statements(file)))
}

function decidingFile(kind: Decided['kind'], name: string): string {
  const listed: Decided | undefined = DECIDED.find((row) => row.kind === kind && row.name === name)
  if (listed === undefined) throw new Error(`${kind} ${name} is not listed in DECIDED`)
  return `${MIGRATIONS}/${listed.files[listed.files.length - 1] ?? listed.files[0]}`
}

/** A function as its deciding migration defines it, so a pin cannot match another function. */
function definition(name: Named<'function'>): string {
  const file = decidingFile('function', name)
  const sql = source(file)
  const start = [...sql.matchAll(/create or replace function "?public"?\."?(\w+)"?\(/gi)].find(
    (match) => match[1] === name,
  )?.index
  const length = start === undefined ? -1 : sql.slice(start).search(/\$_?\$;/)
  if (start === undefined || length < 0) throw new Error(`${file} does not define ${name}`)
  return sql.slice(start, start + length)
}

function deciding<Kind extends Exclude<Decided['kind'], 'function'>>(
  kind: Kind,
  name: Named<Kind>,
): string {
  return source(decidingFile(kind, name))
}

// The delivery log stores a copy of every app email and keeps it after its booking is deleted.
// The shipped privacy page is the static /privacy answer and the Studio seed of a missing CMS
// privacy page, so both language sections must describe that copy and its retention.
async function servedPrivacyPolicy(): Promise<string> {
  const env = {
    ASSETS: {
      fetch: async () =>
        new Response(readFileSync('public/privacy.html', 'utf8'), {
          headers: { 'Content-Type': 'text/html' },
        }),
    },
  }
  const content = new PublicContent({} as never, env)
  const response = await worker.fetch(new Request('https://salon.example.test/privacy'), env, {
    exports: { PublicContent: { fetch: (request: Request) => content.fetch(request) } },
  })
  expect(response.status).toBe(200)
  return (await response.text()).replace(/\s+/g, ' ')
}

describe('the migrations the privacy policy is pinned to', () => {
  it('are the only ones that define what its sentences rest on', () => {
    for (const { kind, name, files, states } of DECIDED)
      expect(
        migrationsWhere((sql) => concerns(sql, kind, name)),
        `${kind} ${name} decides "${states}"`,
      ).toEqual(files)
  })
})

describe('public privacy disclosure of stored email copies', () => {
  it('keeps the retention it states equal to the delivery log purge', () => {
    expect(definition('internal_purge_email_send_log')).toContain(
      "delete from public.email_send_log l where l.created_at < pg_catalog.now() - interval '30 days';",
    )
    expect(deciding('job', 'email-send-log-purge')).toContain(
      "cron.schedule('email-send-log-purge', '29 3 * * *', 'select public.internal_purge_email_send_log()')",
    )
    expect(deciding('constraint', 'email_send_log_booking_id_fkey')).toContain(
      'ALTER TABLE ONLY "public"."email_send_log" ADD CONSTRAINT "email_send_log_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;',
    )
  })

  it('describes the stored copy and its retention in Swedish', async () => {
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      '<p> När webbplatsen skickar ett mejl, till exempel en bokningsbekräftelse, påminnelse, ' +
        'avbokning eller åtkomstlänk, sparas en kopia i Supabase: mottagarens e-postadress, ' +
        'ämnesraden, mejlets innehåll som HTML och text, tidpunkten och om Resend tog emot mejlet. ' +
        'Inloggnings- och åtkomstlänkar ersätts med [dold länk] innan kopian sparas. Endast ' +
        'salongens ägare kan läsa kopiorna i webbplatsens administration, för att kontrollera och ' +
        'felsöka utskick. Varje kopia raderas automatiskt 30 dagar efter det första ' +
        'sändningsförsöket. Rensningen körs en gång per dygn, så en kopia kan finnas kvar upp till ' +
        'ett dygn längre. Raderas bokningen tidigare finns kopian kvar till dess, utan koppling ' +
        'till bokningen. </p>',
    )
    expect(privacy).toContain(
      'Sparade kopior av skickade mejl raderas automatiskt 30 dagar efter det första sändningsförsöket.',
    )
    expect(privacy).toContain('Senast uppdaterad 11 november 2026')
    expect(privacy).not.toContain('Senast uppdaterad 10 november 2026')
    expect(privacy).not.toContain('Senast uppdaterad 4 november 2026')
  })

  it('describes the stored copy and its retention in English', async () => {
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      '<p> When the website sends an email, for example a booking confirmation, reminder, ' +
        "cancellation or access link, a copy is stored in Supabase: the recipient's email " +
        'address, the subject line, the message content as HTML and text, the time, and whether ' +
        'Resend accepted the message. Sign-in and access links are replaced with [dold länk] ' +
        '(hidden link) before the copy is stored. Only the salon owner can read these copies in ' +
        "the website's administration, to check and troubleshoot delivery. Each copy is deleted " +
        'automatically 30 days after the first send attempt. The cleanup runs once a day, so a ' +
        'copy can remain up to one day longer. If the booking is deleted sooner, the copy remains ' +
        'until then without a link to the booking. </p>',
    )
    expect(privacy).toContain(
      'Stored copies of sent email are deleted automatically 30 days after the first send attempt.',
    )
    expect(privacy).toContain('Last updated 11 November 2026')
    expect(privacy).not.toContain('Last updated 10 November 2026')
    expect(privacy).not.toContain('Last updated 4 November 2026')
  })
})

// Each test pins the deciding code and the sentence in both languages, so neither changes alone.
describe('public privacy disclosure of retention, backups, reviews and browser storage', () => {
  it('states the booking retention the nightly purge applies and who may delete sooner', async () => {
    const purge = definition('internal_purge_expired_bookings')
    expect(purge).toContain("v_cutoff timestamptz := pg_catalog.now() - interval '12 months';")
    expect(purge).toContain(
      "delete from public.bookings b where b.id = any (v_ids) and b.end_at < v_cutoff and not exists ( select 1 from public.booking_email_delivery_jobs j where j.booking_id = b.id and j.status in ('pending', 'dispatching', 'failed') );",
    )
    expect(deciding('job', 'booking-retention-purge')).toContain(
      "cron.schedule( 'booking-retention-purge', '11 3 * * *', 'select public.internal_purge_expired_bookings()' )",
    )
    // Before then the owner may delete any ended or cancelled booking, a barber only their own.
    const remove = definition('admin_delete_bookings')
    expect(remove).toContain(
      'v_is_owner boolean := public.is_owner(); v_barber_id text := public.current_barber_id();',
    )
    expect(remove).toContain(
      "if not v_is_owner and v_barber_id is null then return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden'); end if; if not v_is_owner and exists ( select 1 from pg_catalog.unnest(p_ids) as req(id) where not exists ( select 1 from public.bookings b where b.id = req.id and b.barber_id = v_barber_id ) ) then return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden'); end if;",
    )
    expect(remove).toContain(
      "delete from public.bookings where id = any(p_ids) and not (status = 'confirmed' and end_at > pg_catalog.now());",
    )
    expect(definition('is_owner')).toContain(
      "select p.role = 'owner' from public.profiles p where p.id = (select auth.uid()) and p.account_enabled = true",
    )
    expect(definition('current_barber_id')).toContain(
      "select p.barber_id from public.profiles p where p.id = (select auth.uid()) and p.role = 'barber' and p.account_enabled = true;",
    )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'En bokning raderas automatiskt när det har gått mer än 12 månader sedan den bokade tiden ' +
        'slutade. Rensningen körs en gång per dygn. En bokning vars bekräftelse- eller ' +
        'avbokningsmejl fortfarande väntar på att skickas raderas först när mejlet inte längre ' +
        'väntar. Salongens ägare, och en barberare för sina egna bokningar, kan radera avbokade ' +
        'och avslutade bokningar tidigare.',
    )
    expect(privacy).toContain(
      'A booking is deleted automatically once more than 12 months have passed since the ' +
        'appointment ended. The cleanup runs once a day. A booking whose confirmation or ' +
        'cancellation email is still waiting to be sent is deleted only when that email is no ' +
        'longer waiting. The salon owner, and a barber for their own bookings, can delete ' +
        'cancelled and finished bookings sooner.',
    )
    expect(privacy).not.toContain('Bokningshistorik ligger kvar tills salongen raderar den')
    expect(privacy).not.toContain('Booking history remains until the salon deletes it')
    expect(privacy).not.toContain('Salongens ägare kan radera avbokade')
    expect(privacy).not.toContain('The salon owner can delete cancelled')
  })

  it('states when contact data outside a booking is removed', async () => {
    // What keeps an address in use: a booking, a live session, an unsent access link, a live
    // device receipt, a stored request to connect addresses.
    const inUse = definition('customer_emails_in_use')
    expect(inUse).toContain('from public.bookings b where b.email is not null union')
    expect(inUse).toContain(
      'from public.customer_booking_access_sessions s where s.expires_at > pg_catalog.now() union',
    )
    expect(inUse).toContain(
      'from public.customer_booking_access_challenges c where c.used_at is null and c.expires_at > pg_catalog.now() union',
    )
    expect(inUse).toContain(
      'where rb.parent_email is not null and r.expires_at > pg_catalog.now() union',
    )
    expect(inUse).toContain(
      'select l.source_email from public.customer_email_links l union select l.target_email from public.customer_email_links l;',
    )
    const cleanup = definition('cleanup_customer_booking_access')
    expect(cleanup).toContain(
      'delete from public.customer_booking_access_tokens t where t.email = any (v_emails)',
    )
    expect(cleanup).toContain(
      'delete from public.customer_profile_emails e where e.email = any (v_emails)',
    )
    // Per group of connected addresses: an unused address stays while any of its profile is in use.
    expect(cleanup).toContain(
      'with in_use as materialized ( select u.email from public.customer_emails_in_use() as u(email) ) delete from public.customer_booking_access_tokens t',
    )
    expect(cleanup).toContain(
      'and not exists ( select 1 from public.customer_profile_emails own where own.email = t.email and ( not (own.profile_id = any (v_profiles)) or exists ( select 1 from public.customer_profile_emails sibling join in_use u on u.email = sibling.email where sibling.profile_id = own.profile_id ) ) );',
    )
    expect(cleanup).toContain(
      'and e.profile_id = any (v_profiles) and not exists ( select 1 from public.customer_profile_emails sibling join in_use u on u.email = sibling.email where sibling.profile_id = e.profile_id );',
    )
    // An unused access link is deleted once its e-mail can no longer be sent (no pending or
    // dispatching job), and never while that e-mail is still waiting.
    const waiting =
      "not exists ( select 1 from public.external_action_jobs j where j.action_type = 'customer_access_email_send' and j.payload ->> 'challenge_id' = c.id::text and j.status in ('pending', 'dispatching') )"
    expect(cleanup).toContain(
      `select distinct pg_catalog.lower(pg_catalog.btrim(c.email)) as email from public.customer_booking_access_challenges c where c.used_at is null and c.expires_at > pg_catalog.now() and ${waiting} ) d order by d.email limit 200 loop if pg_catalog.pg_try_advisory_xact_lock( pg_catalog.hashtext('customer-email-access'), pg_catalog.hashtext(v_email)) then v_dead := v_dead || v_email; end if; end loop;`,
    )
    expect(cleanup).toContain(
      `with dead as ( select c.id from public.customer_booking_access_challenges c where pg_catalog.lower(pg_catalog.btrim(c.email)) = any (v_dead) and c.used_at is null and c.expires_at > pg_catalog.now() and ${waiting} for update of c skip locked ) delete from public.customer_booking_access_challenges c using dead where c.id = dead.id;`,
    )
    expect(deciding('job', 'customer-booking-access-cleanup')).toContain(
      "cron.schedule('customer-booking-access-cleanup', '23 3 * * *', 'select public.cleanup_customer_booking_access()')",
    )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'Åtkomstlänken till Mina bokningar, med e-postadress och telefonnummer, och kopplingen ' +
        'mellan dina e-postadresser tas bort av en nattlig rensning när varken e-postadressen ' +
        'eller någon e-postadress som är kopplad till den längre har någon bokning, och ingen ' +
        'av dem används för inloggning, enhetsåtkomst, en åtkomstlänk som väntar på att skickas ' +
        'eller en begäran om koppling mellan e-postadresser.',
    )
    expect(privacy).toContain(
      'The access link to My appointments, with its email address and phone number, and the ' +
        'connection between your email addresses are removed by a nightly cleanup once neither ' +
        'the email address nor any email address connected to it has a booking, and none of ' +
        'them is used for a sign-in, device access, an access link waiting to be sent or a ' +
        'request to connect email addresses.',
    )
    expect(privacy).not.toContain('när e-postadressen inte längre har någon bokning')
    expect(privacy).not.toContain('once the email address no longer has any booking')
  })

  it('states how long the access link and its session last', async () => {
    // The link is its token row: without the row no session is made, with it one of 30 days.
    expect(definition('establish_customer_booking_session')).toContain(
      "select t.phone, t.email into v_phone, v_email from public.customer_booking_access_tokens t where t.token_hash = p_access_token for share; if not found then return false; end if; insert into public.customer_booking_access_sessions (phone, email, token_hash, expires_at) values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');",
    )
    // A new request replaces the token and ends the sessions of the address.
    const rotate = definition('rotate_customer_booking_access_token')
    expect(rotate).toContain(
      'on conflict (email) do update set phone = excluded.phone, token_hash = excluded.token_hash, token_ciphertext = excluded.token_ciphertext, generation = public.customer_booking_access_tokens.generation + 1, updated_at = pg_catalog.now();',
    )
    expect(rotate).toContain(
      'delete from public.customer_booking_access_sessions s where pg_catalog.lower(s.email) = v_email;',
    )
    expect(definition('customer_booking_access_scope')).toContain(
      'from public.customer_booking_access_sessions s where s.token_hash = p_session_hash and s.expires_at > pg_catalog.now()',
    )
    const privacy = await servedPrivacyPolicy()
    const swedish =
      'Länken har ingen fast tidsgräns. Den slutar fungera när den tas bort av rensningen som ' +
      'beskrivs under Ansvar, rättslig grund och dina rättigheter nedan, och en ny begäran om ' +
      'länk för samma e-postadress ersätter och återkallar den tidigare länken.'
    const english =
      'The link has no fixed time limit. It stops working when it is removed by the cleanup ' +
      'described under Responsibility and your rights below, and a new link request for the ' +
      'same email address replaces and revokes the previous link.'
    // Each sentence names a heading of the page, and the cleanup is described below that heading.
    for (const [sentence, heading, removal] of [
      [swedish, '<h2>Ansvar, rättslig grund och dina rättigheter</h2>', 'Åtkomstlänken till Mina'],
      [english, '<h2>Responsibility and your rights</h2>', 'The access link to My appointments'],
    ] as const) {
      const at = [sentence, heading, removal].map((text) => privacy.indexOf(text))
      expect(at.every((index) => index >= 0)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
      expect(privacy.split(heading)).toHaveLength(2)
    }
    expect(privacy).toContain(
      'Servern avslutar sessionen när tiden har gått ut och kan återkalla den innan dess.',
    )
    expect(privacy).toContain('The server expires and can revoke the session')
    expect(privacy).not.toContain('Länken har ingen tidsgräns')
    expect(privacy).not.toContain('The link has no time limit')
    expect(privacy).not.toContain('kan återkalla den tidigare.')
  })

  it('states where the encrypted backups are kept and for how long', async () => {
    const workflow = source('.github/workflows/database-backup.yml')
    expect(workflow).toContain('age --recipient "$AGE_RECIPIENT"')
    expect(workflow).toContain('uses: actions/upload-artifact@')
    expect(workflow.match(/retention-days: \d+/g)).toEqual(['retention-days: 30'])
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'Krypterade säkerhetskopior av databasen och uppladdade filer lagras hos GitHub och ' +
        'raderas automatiskt efter 30 dagar. Uppgifter som har raderats kan därför finnas kvar ' +
        'i en säkerhetskopia tills den har raderats.',
    )
    expect(privacy).toContain(
      'Encrypted backups of the database and uploaded files are stored with GitHub and deleted ' +
        'automatically after 30 days. Data that has been deleted can therefore remain in a ' +
        'backup until that backup has been deleted.',
    )
    expect(privacy).toContain('GitHub lagrar de krypterade säkerhetskopiorna.')
    expect(privacy).toContain('GitHub stores the encrypted backups.')
    expect(privacy).not.toContain('rullande lagringstid')
    expect(privacy).not.toContain('rolling retention period')
  })

  it('states the rate-limit records, their two days and how each table is cleaned', async () => {
    expect(definition('create_booking_with_limits')).toContain(
      'insert into public.booking_attempts (ip_hash) values (p_ip_hash);',
    )
    expect(deciding('job', 'booking-attempt-cleanup')).toContain(
      "cron.schedule('booking-attempt-cleanup', '23 * * * *', 'delete from public.booking_attempts where created_at < pg_catalog.now() - interval ''2 days''')",
    )
    expect(definition('consume_public_action_attempt')).toContain(
      "insert into public.public_action_attempts (action, ip_hash, phone_hash) values (p_action, p_ip_hash, p_phone_hash); delete from public.public_action_attempts where created_at < pg_catalog.now() - interval '2 days';",
    )
    expect(migrationsWhere((sql) => sql.includes('public_action_attempts'))).toEqual([BASELINE])
    expect(source(`${MIGRATIONS}/${BASELINE}`)).not.toMatch(
      /cron\.schedule\([^;]*public_action_attempts/,
    )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'För att begränsa antalet försök sparar webbplatsen också en saltad hash av din IP-adress ' +
        'när du bokar, skickar ett omdöme eller begär en länk till Mina bokningar eller en ' +
        'koppling mellan e-postadresser. För omdömen sparas dessutom en saltad hash av ' +
        'telefonnumret, och för begäran om länk eller koppling en saltad hash av ' +
        'e-postadressen. Posterna raderas när de är äldre än två dygn: för bokningar en gång i ' +
        'timmen, för övriga i samband med nästa sådana förfrågan som godkänns.',
    )
    expect(privacy).toContain(
      'To limit the number of attempts, the website also stores a salted hash of your IP ' +
        'address when you book, submit a review, or request a My appointments link or a ' +
        'connection between email addresses. For reviews a salted hash of the phone number is ' +
        'stored as well, and for link or connection requests a salted hash of the email ' +
        'address. These records are deleted once they are older than two days: for bookings ' +
        'once an hour, for the others when the next such request is accepted.',
    )
  })

  it('states what Cloudflare counts for each client and how long it keeps the count', async () => {
    expect(source('wrangler.jsonc').match(/"simple": \{[^}]*\}/g)).toEqual([
      '"simple": { "limit": 60, "period": 60 }',
    ])
    expect(GATEWAY_RATE_LIMIT_PERIOD_SECONDS).toBe(60)
    // Only /api/customer-bookings is counted; the booking submission on /api/bookings is not.
    const routes = source('supabase/worker/index.ts')
    expect(routes).toContain(
      "if (url.pathname === '/api/customer-bookings') return customerGateway(request, env)",
    )
    expect(routes).toContain(
      "if (url.pathname === '/api/bookings') return customerGateway(request, env, 'submit-booking')",
    )
    // The limiter is defined once and asked once, for that endpoint alone.
    const gateway = source('supabase/worker/customerGateway.ts')
    expect(gateway.split('withinRateLimit(')).toHaveLength(3)
    expect(gateway).toContain("endpoint === 'public-booking-actions' && !(await withinRateLimit(")
    expect(BOOKING_ACTIONS).toEqual([
      'request_access',
      'exchange_access',
      'list',
      'cancel',
      'review',
      'forget_device',
      'request_link',
      'confirm_link',
    ])
    // This limiter refuses every request, so the Worker answers before it would call Supabase.
    const counted: string[] = []
    const limiter: GatewayRateLimit = {
      async limit({ key }) {
        counted.push(key)
        return { success: false }
      },
    }
    const env = {
      SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_ANON_KEY: 'fixture-anon-key',
      CUSTOMER_GATEWAY_SECRET: 'secret'.repeat(8),
      GATEWAY_RATE_LIMIT: limiter,
    }
    for (const [action, ip] of [
      ['list', '2001:db8:85a3:8d3:1319:8a2e:370:7348'],
      ['list', '2001:db8:85a3:8d3::1'],
      ['cancel', '203.0.113.10'],
    ] as const) {
      const refused = await customerGateway(
        new Request('https://salon.example.test/api/customer-bookings', {
          method: 'POST',
          headers: {
            Origin: 'https://salon.example.test',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': ip,
          },
          body: JSON.stringify({ action }),
        }),
        env,
      )
      expect(refused.status).toBe(429)
      expect(refused.headers.get('Retry-After')).toBe('60')
    }
    expect(counted).toEqual([
      'list:2001:db8:85a3:8d3::/64',
      'list:2001:db8:85a3:8d3::/64',
      'cancel:203.0.113.10',
    ])
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'förfrågan som godkänns. Cloudflare räknar också de förfrågningar som webbläsaren skickar ' +
        'för Mina bokningar, för enhetsåtkomsten och för att skicka ett omdöme, per IP-adress ' +
        '(för en IPv6-adress det /64-nät den ingår i) och typ av förfrågan. Räkningen finns hos ' +
        'Cloudflare i 60 sekunder och sparas inte av webbplatsen. Blir förfrågningarna för många ' +
        'nekas de en kort stund. </p>',
    )
    expect(privacy).toContain(
      'the next such request is accepted. Cloudflare also counts the requests your browser ' +
        'sends for My appointments, for device access and to submit a review, by IP address ' +
        '(for an IPv6 address, the /64 network it belongs to) and type of request. The count is ' +
        'kept by Cloudflare for 60 seconds and is not stored by the website. If there are too ' +
        'many requests, they are refused for a short while. </p>',
    )
  })

  it('states that a review is public, what it shows and how it is taken down', async () => {
    const create = definition('create_review_for_browser')
    expect(create).toContain(
      "v_display := v_first || case when v_second <> '' then ' ' || pg_catalog.left(v_second, 1) || '.' else '' end;",
    )
    expect(create).toContain(
      'insert into public.reviews (name, rating, text, booking_id, published) values (v_display, p_rating::smallint, p_text, v_booking_id, true)',
    )
    expect(deciding('policy', 'reviews_select_published')).toContain(
      'CREATE POLICY "reviews_select_published" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (("published" = true));',
    )
    expect(deciding('constraint', 'reviews_booking_id_fkey')).toContain(
      'ALTER TABLE ONLY "public"."reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;',
    )
    expect(definition('admin_set_review_published')).toContain(
      'update public.reviews r set published = p_published where r.id = p_id;',
    )
    expect(definition('admin_delete_review')).toContain(
      'delete from public.reviews r where r.id = p_id;',
    )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'Lämnar du ett omdöme visas det öppet på webbplatsen med ditt betyg, din text och namnet ' +
        'från bokningen, förkortat till det första namnet och första bokstaven i nästa (till ' +
        'exempel Anna S.). Telefonnumret du anger används för att kontrollera omdömet mot ' +
        'bokningen och visas inte. Omdömet finns kvar även när bokningen har raderats. ' +
        'Salongens ägare kan dölja ett omdöme, som då sparas men inte längre visas på ' +
        'webbplatsen, eller ta bort det. Vill du att ditt omdöme tas bort, kontakta salongen ' +
        'via <a href="/contact">kontaktsidan</a>.',
    )
    expect(privacy).toContain(
      'If you leave a review, it is shown openly on the website with your rating, your text ' +
        'and the name from the booking, shortened to the first name and the first letter of ' +
        'the next (for example Anna S.). The phone number you enter is used to check the review ' +
        'against the booking and is not shown. The review remains even after the booking has ' +
        'been deleted. The salon owner can hide a review, which is then stored but no longer ' +
        'shown on the website, or remove it. If you want your review removed, contact the salon ' +
        'through the <a href="/contact?lang=en">contact page</a>.',
    )
    // Submitting publishes; only the owner deletes, and no customer action removes a review.
    expect(BOOKING_ACTIONS.filter((action) => action.includes('review'))).toEqual(['review'])
    expect(privacy).toContain(
      'Omdömen publiceras med ditt samtycke, som du lämnar när du skickar omdömet. Du kan när ' +
        'som helst återkalla samtycket genom att kontakta salongen, och då tar vi bort omdömet. ' +
        'Ett omdöme sparas tills salongens ägare tar bort det.',
    )
    expect(privacy).toContain(
      'Reviews are published with your consent, which you give when you submit the review. You ' +
        'can withdraw your consent at any time by contacting the salon, and we will then remove ' +
        'the review. A review is kept until the salon owner removes it.',
    )
  })

  it('states the details a booking needs and the processors that receive them', async () => {
    const booking = {
      barberId: 'b',
      serviceId: 's',
      startAt: '2026-11-13T09:00:00+01:00',
      phone: '0701234567',
      email: 'kund@example.com',
      lang: 'sv',
      customerName: 'Ada',
    }
    expect(submitBooking.safeParse({ booking }).success).toBe(true)
    for (const field of ['customerName', 'phone', 'email'] as const)
      expect(submitBooking.safeParse({ booking: { ...booking, [field]: '' } }).success, field).toBe(
        false,
      )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'Du behöver lämna namn, telefonnummer och e-postadress för att kunna boka. Utan dem kan vi ' +
        'inte ta emot bokningen eller skicka bekräftelsen.',
    )
    expect(privacy).toContain(
      'You need to give your name, phone number and email address to book. Without them we ' +
        'cannot accept the booking or send the confirmation.',
    )
    expect(privacy).toContain(
      'Supabase, Cloudflare, Resend och GitHub behandlar uppgifter för salongens räkning som ' +
        'personuppgiftsbiträden. Några av dem kan behandla uppgifter i USA.',
    )
    expect(privacy).toContain(
      "Supabase, Cloudflare, Resend and GitHub process data on the salon's behalf as " +
        'processors. Some of them may process data in the United States.',
    )
    expect(privacy).toContain('Du kan få en kopia av skyddsåtgärderna genom att kontakta salongen.')
    expect(privacy).toContain('You can get a copy of the safeguards by contacting the salon.')
    expect(privacy).not.toContain(
      'Kontakta salongen för information om tillämpliga överföringsskydd',
    )
    expect(privacy).not.toContain('Ask the salon about applicable transfer safeguards')
  })

  it('states the e-mail the booked barber receives', async () => {
    const sender = source('supabase/functions/send-confirmation/index.ts')
    expect(sender).toContain(
      "booking_confirmed: { customer: 'customer_confirmation', barber: 'barber_confirmation' },",
    )
    expect(sender).toContain(
      "booking_cancelled: { customer: 'customer_cancellation', barber: 'barber_cancellation' },",
    )
    expect(sender).toContain("booking_reminder: { customer: 'customer_reminder', barber: null },")
    const rows = /function barberRows\(.*?\n}\n/s.exec(
      readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8'),
    )?.[0]
    if (rows === undefined) throw new Error('send-confirmation has no barberRows')
    expect(rows).toContain('const contact = [booking.phone, booking.email]')
    expect([...rows.matchAll(/label: '([^']+)'/g)].map((match) => match[1])).toEqual([
      'Datum',
      'Tid',
      'Kund',
      'Behandling',
      'Längd',
      'Pris',
      'Kontakt',
    ])
    // A barber gets the e-mail only through a staff account with the barber role.
    expect(sender).toContain("client.rpc('booking_confirmation_details', { p_id: id })")
    expect(definition('booking_confirmation_details')).toContain(
      "'barber_email', ( select u.email from public.profiles p join auth.users u on u.id = p.id where p.role = 'barber' and p.barber_id = b.barber_id order by p.created_at asc limit 1 ),",
    )
    const privacy = await servedPrivacyPolicy()
    expect(privacy).toContain(
      'Har barberaren du bokar hos ett eget barberarkonto på webbplatsen får barberaren ett ' +
        'mejl när bokningen görs eller avbokas, med ditt namn, ditt telefonnummer och din ' +
        'e-postadress samt datum, tid, behandling, längd och pris.',
    )
    expect(privacy).toContain(
      'If the barber you book with has a barber account of their own on the website, the ' +
        'barber receives an email when the booking is made or cancelled, with your name, your ' +
        'phone number and your email address, and the date, time, service, duration and price.',
    )
  })

  it('names every cookie and storage key by the name the code gives it', async () => {
    const day = 24 * 60 * 60
    const consent = source('modules/public-web/src/site/storageConsent.ts')
    expect(consent).toContain("const STORAGE_PREFERENCES_COOKIE = 'bladeblend_storage_preferences'")
    expect(consent).toContain(`Max-Age=${365 * day};`)
    expect(customerCookieHeader(CUSTOMER_SESSION_COOKIE, 'token')).toContain(`Max-Age=${30 * day};`)
    // The server ends sessions after 30 days whatever the browser keeps; two functions make them.
    const session = 'insert into public.customer_booking_access_sessions'
    const lifetime = `${session} (phone, email, token_hash, expires_at) values (v_phone, v_email, p_session_hash, pg_catalog.now() + interval '30 days');`
    expect(definition('establish_customer_booking_session')).toContain(lifetime)
    expect(definition('exchange_customer_booking_access')).toContain(lifetime)
    expect(migrationsWhere((sql) => sql.includes(session))).toEqual([BASELINE])
    expect(statements(BASELINE).split(session)).toHaveLength(3)
    expect(deciding('table', 'customer_booking_receipts')).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."customer_booking_receipts" ( "token_hash" "text" NOT NULL, "created_at" timestamp with time zone DEFAULT "now"() NOT NULL, "expires_at" timestamp with time zone DEFAULT ("now"() + \'30 days\'::interval) NOT NULL,',
    )
    expect(source('supabase/functions/submit-booking/index.ts')).toContain(
      `receipt.data.max_age <= ${30 * day}`,
    )
    expect(source('modules/staff-admin/src/adminClient.ts')).toContain(
      "const ADMIN_STORAGE_KEY = 'knc-admin-auth'",
    )
    expect(source('modules/public-web/src/onboarding/trigger.ts')).toContain(
      "export const HOME_SCREEN_GUIDE_KEY = 'bladeblend_home_screen_guide'",
    )
    // The names are long words without a break point; the rule lets them wrap on a narrow screen.
    expect(source('public/privacy.html')).toContain(
      'code { padding: 0.1em 0.35em; border-radius: 5px; background: var(--bb-surface); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; overflow-wrap: anywhere; }',
    )
    const privacy = await servedPrivacyPolicy()
    // Once in each language section.
    for (const name of [
      'bladeblend_storage_preferences',
      CUSTOMER_SESSION_COOKIE,
      CUSTOMER_RECEIPT_COOKIE,
      'knc-admin-auth',
      'bladeblend_home_screen_guide',
    ])
      expect(privacy.split(`<code>${name}</code>`), name).toHaveLength(3)
    expect(privacy).toContain(
      'Ditt lagringsval sparas i upp till ett år i cookien ' +
        '<code>bladeblend_storage_preferences</code>.',
    )
    expect(privacy).toContain(
      'Your storage choice is remembered for up to one year in the cookie ' +
        '<code>bladeblend_storage_preferences</code>.',
    )
    expect(privacy).toContain(
      `en säker HttpOnly-cookie, <code>${CUSTOMER_RECEIPT_COOKIE}</code>, som ger åtkomst till ` +
        'nya bokningar du gör här. Den innehåller inga kontaktuppgifter och gäller i högst 30 dagar.',
    )
    expect(privacy).toContain(
      `a secure HttpOnly cookie, <code>${CUSTOMER_RECEIPT_COOKIE}</code>, gives this device ` +
        'access to new bookings created here for up to 30 days.',
    )
    expect(privacy).toContain(
      `nödvändig HttpOnly-sessioncookie, <code>${CUSTOMER_SESSION_COOKIE}</code>, i högst 30 dagar.`,
    )
    expect(privacy).toContain(
      'necessary HttpOnly session for up to 30 days, in the cookie ' +
        `<code>${CUSTOMER_SESSION_COOKIE}</code>.`,
    )
    // The guide's note is neither customer data nor an access credential.
    expect(privacy).toContain(
      'kan fyllas i vid nästa bokning. Har du godkänt valfri lagring sparas också en notering i ' +
        'webbläsarens localStorage, under namnet <code>bladeblend_home_screen_guide</code>, om att ' +
        'guiden för att lägga till webbplatsen på hemskärmen har visats, så att den inte visas igen. ' +
        'När du återkallar valet tas enhetsåtkomsten, förifyllningen och noteringen bort, medan ' +
        'bokningarna finns kvar.',
    )
    expect(privacy).toContain(
      'may prefill your next booking. If you have accepted optional storage, a note is also kept ' +
        "in the browser's localStorage, under the name <code>bladeblend_home_screen_guide</code>, " +
        'that the guide for adding the website to the Home Screen has been shown, so that it is ' +
        'not shown again. Withdrawal removes device access, the prefill and the note while ' +
        'preserving your bookings.',
    )
    expect(privacy).toContain(
      'Inga kunduppgifter eller kunders åtkomstbevis sparas i localStorage eller sessionStorage',
    )
    expect(privacy).toContain(
      'No customer contact data or customer access credentials are stored in localStorage or ' +
        'sessionStorage',
    )
    expect(privacy).toContain(
      'inloggningen sparas i localStorage eller sessionStorage under namnet ' +
        '<code>knc-admin-auth</code>',
    )
    expect(privacy).toContain(
      'the sign-in is stored in localStorage or sessionStorage under the name ' +
        '<code>knc-admin-auth</code>',
    )
  })
})

// No business is read here, so the shipped file is the text a visitor gets.
describe('public terms page', () => {
  it('sends the reader to the contact page, in each language to that language', () => {
    const terms = source('public/terms.html')
    expect(terms).toContain('<a href="/contact">Aktuella kontaktuppgifter på kontaktsidan</a>')
    expect(terms).toContain(
      'Current contact details are on the <a href="/contact?lang=en">contact page</a>.',
    )
    expect(terms).not.toContain('Aktuella kontaktuppgifter på startsidan')
  })

  it('carries the date of its last change in both languages', () => {
    const terms = source('public/terms.html')
    expect(terms).toContain('· Uppdaterad 11 november 2026</p>')
    expect(terms).toContain('Updated 11 November 2026. </p>')
    expect(terms).not.toContain('10 november 2026')
    expect(terms).not.toContain('10 November 2026')
    expect(terms).not.toContain('13 september 2026')
  })

  it('points the withdrawal form at the business details above it in each language', () => {
    const terms = source('public/terms.html')
    const at = [
      '<div id="legal-business-details-sv"></div>',
      'Till: salongen, på adressen och e-postadressen som står överst på sidan.',
      '<section lang="en"> <h2>Booking terms in English</h2> <div id="legal-business-details-en"></div>',
      'To: the salon, at the address and email stated at the start of the English terms.',
    ].map((text) => terms.indexOf(text))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // Only the line under the page heading comes before the Swedish details.
    expect(terms.slice(0, at[0]).match(/<(?:h2|p|div)\b/g)).toEqual(['<p'])
  })

  it('gives the English section the statements the Swedish text makes', () => {
    const terms = source('public/terms.html')
    for (const [swedish, english] of [
      [
        'Priset som visas är totalpriset i svenska kronor. Du betalar i salongen efter ' +
          'behandlingen. Vi tar emot kort, Swish och kontanter. Webbplatsen tar inte emot betalning.',
        'The price shown is the total price in Swedish kronor. You pay at the salon after your ' +
          'treatment. We accept card, Swish and cash. The website does not take payment.',
      ],
      ['Bokningen kan göras på svenska eller engelska.', 'You can book in Swedish or English.'],
      [
        'kan barberaren begära betalning för den bokade tiden, högst priset för den bokade ' +
          'behandlingen. Det avgörs i varje enskilt fall',
        'the barber may ask you to pay for the booked time, at most the price of the booked ' +
          'treatment. This is decided case by case',
      ],
      [
        'Ingen betalning begärs om du har ångrat bokningen med din ångerrätt.',
        'No payment is requested if you have withdrawn from the booking under your right of withdrawal.',
      ],
      ['<h2>Ångerrätt</h2>', '<h3>Right of withdrawal</h3>'],
      [
        'rätt att ångra bokningen inom 14 dagar från den dag du bokade.',
        'the right to withdraw from the booking within 14 days of the day you booked.',
      ],
      [
        'Avbokning under Mina bokningar går fram till tidsgränsen ovan; därefter kontaktar du salongen.',
        'Cancellation in My appointments is possible until the deadline above; after that, contact the salon.',
      ],
      [
        'När behandlingen har utförts kan du inte längre ångra bokningen.',
        'Once the treatment has been carried out, you can no longer withdraw.',
      ],
      ['<h3>Ångerblankett</h3>', '<h4>Withdrawal form</h4>'],
      [
        'Jag meddelar härmed att jag frånträder mitt avtal om följande tjänst:',
        'I hereby give notice that I withdraw from my contract for the following service:',
      ],
      [
        'Kontakta salongen inom skälig tid efter att du har märkt felet.',
        'Contact the salon within a reasonable time after you notice the problem.',
      ],
      [
        'Allmänna reklamationsnämnden (ARN), Box 174, 101 23 Stockholm, www.arn.se.',
        'National Board for Consumer Disputes (ARN), Box 174, 101 23 Stockholm, Sweden, www.arn.se.',
      ],
      [
        'En avbokning är klar när du får bekräftelse på att den genomförts.',
        'A cancellation is complete when you receive confirmation that it has been carried out.',
      ],
      [
        'Vid ändring av behandling eller tid, kontakta salongen eller avboka och boka på nytt.',
        'To change the service or time you can also cancel and book again.',
      ],
      [
        'Kontakta salongen om du inte kan öppna länken eller är osäker på bokningens status.',
        'Also contact the salon if you cannot open the link or are unsure of the status of your booking.',
      ],
      [
        'Beskriv vad som hänt och vilken bokning det gäller.',
        'Describe what happened and which booking it concerns.',
      ],
    ] as const) {
      expect(terms).toContain(swedish)
      expect(terms).toContain(english)
    }
    expect(terms).not.toContain('betalningsfrågor hanteras med salongen')
    expect(terms).not.toContain('payment questions are handled with the salon')
  })
})
