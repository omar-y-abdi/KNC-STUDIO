// Leveransstatus through its real adapters on both engines: every delivery RPC is answered here
// from rows the test controls, the way the database answers it. A held call reads its rows when it
// arrives and answers once released, so a read can carry rows a later action already changed.
import assert from 'node:assert/strict'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { routeApi } from './route-api.mjs'
import { documentFixture } from './builders.mjs'
import { nativeBackend } from './cms-backend.mjs'

const baseUrl = harnessOrigin.replace(/\/$/, '')
const BACKEND = 'https://admin-harness.invalid'
const RPC = '/rest/v1/rpc/'
const NOT_FOUND = 'Mejlet finns inte längre bland misslyckade leveranser.'
const LOADING_FAILED = 'Hämtar misslyckade mejl …'
const FAILED_TRANSIENT = 'Misslyckat: Tillfälligt fel hos mejltjänsten eller anslutningen'

test.use({ viewport: { width: 1280, height: 900 } })

function deferred() {
  let release = () => undefined
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

// Wait for a painted turn after fixture promises resolve, including passive UI effects.
async function afterPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )
}

const JOB_ID = '67000000-0000-4000-8000-0000000000c1'
const job = {
  id: JOB_ID,
  booking_id: '67000000-0000-4000-8000-0000000000c2',
  event: 'booking_confirmed',
  attempt_count: 5,
  last_error_code: 'send_failed_permanent',
  failed_at: '2096-01-03T09:00:00.000001+00:00',
  sent_kinds: ['barber'],
  customer_name: 'Retry Kund',
  customer_email: 'retry@example.invalid',
  customer_phone: null,
  booking_start_at: '2096-01-04T09:00:00+00:00',
  barber_name: 'Hassan',
  barber_email: 'hassan@example.invalid',
}
const JOB_ROW = 'Retry Kund · Bokningsbekräftelse'

const LOG_ID = '67000000-0000-4000-8000-0000000000d1'
const copyHtml = (body) =>
  `<!doctype html><html><head><title>Kopia</title></head><body><p id="stored-copy">${body}</p></body></html>`
/** One email_send_log row as stored, without its dedupe key. */
function logRow({ recipient, subject, body }) {
  return {
    id: LOG_ID,
    created_at: '2096-01-03T10:00:00.000003+00:00',
    last_attempt_at: '2096-01-03T10:00:00.000003+00:00',
    kind: 'barber_confirmation',
    recipient,
    subject,
    status: 'failed',
    error_code: 'send_failed_transient',
    booking_id: null,
    attempt_count: 1,
    html: copyHtml(body),
    text_body: body,
  }
}

async function deliveryBackend(page, { jobs = [], log = [], logErrors = 0, rpcOnly = false }) {
  const rows = { jobs: jobs.map((row) => ({ ...row, status: 'failed' })), log: [...log] }
  const holds = new Map()
  const unexpected = []
  let logReads = 0
  await routeApi(page, [
    [
      rpcOnly ? `${BACKEND}/rest/v1/rpc/admin_*` : `${BACKEND}/**`,
      async (route, headers) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const reply = (value, status = 200) =>
          route.fulfill({ status, headers, body: JSON.stringify(value) })
        if (!path.startsWith(RPC)) return reply({ message: 'not routed' }, 404)
        const name = path.slice(RPC.length)
        const held = holds.get(name)?.shift()
        const answer = async (value, status) => {
          if (held !== undefined) {
            held.seen.release()
            await held.gate.promise
          }
          await reply(value, status)
          held?.answered.release()
        }
        const id = () => request.postDataJSON()?.p_id
        switch (name) {
          case 'admin_list_failed_booking_email_deliveries':
            return answer(
              rows.jobs
                .filter((row) => row.status === 'failed')
                .map((row) => ({ ...row, status: undefined })),
            )
          case 'admin_list_email_send_log': {
            logReads += 1
            if (logReads <= logErrors)
              return answer({ code: 'XX000', message: 'fixture read error' }, 500)
            const entries = rows.log.map((row) => ({
              ...row,
              html: undefined,
              text_body: undefined,
            }))
            return answer({ entries, has_more: false })
          }
          case 'admin_get_email_send_log_entry': {
            const row = rows.log.find((candidate) => candidate.id === id())
            return answer(row === undefined ? null : { ...row })
          }
          case 'admin_retry_failed_booking_email_delivery':
          case 'admin_discard_failed_booking_email_delivery': {
            if (held !== undefined) {
              held.seen.release()
              await held.gate.promise
            }
            // Like the SQL guard: only a job that is still failed changes, at the action's commit.
            const target = rows.jobs.find((row) => row.id === id() && row.status === 'failed')
            if (target !== undefined)
              target.status =
                name === 'admin_retry_failed_booking_email_delivery' ? 'pending' : 'skipped'
            await reply({ ok: target !== undefined })
            held?.answered.release()
            return
          }
          default:
            unexpected.push(name)
            return reply({ message: 'unexpected RPC in delivery spec' }, 500)
        }
      },
    ],
  ])
  return {
    unexpected,
    /** Holds the next call of `name` until released. */
    hold(name) {
      const call = { seen: deferred(), gate: deferred(), answered: deferred() }
      holds.set(name, [...(holds.get(name) ?? []), call])
      return {
        seen: call.seen.promise,
        release: call.gate.release,
        answered: call.answered.promise,
      }
    },
    jobStatus: () => rows.jobs.find((row) => row.id === JOB_ID)?.status,
    setJobStatus(status) {
      const target = rows.jobs.find((row) => row.id === JOB_ID)
      if (target !== undefined) target.status = status
    },
    /** A later attempt under the same dedupe key delivered the message, as internal_record_email_send records it. */
    deliver(change) {
      const index = rows.log.findIndex((row) => row.id === LOG_ID)
      const row = rows.log[index]
      rows.log[index] = {
        ...row,
        ...change,
        status: 'sent',
        error_code: null,
        attempt_count: row.attempt_count + 1,
        last_attempt_at: '2096-01-03T10:05:00.000004+00:00',
      }
    },
  }
}

/** The production view with its default port: the real adapters and the real admin client. */
async function mountDeliveryStatus(page) {
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { DeliveryStatus } = await import('/modules/studio/src/DeliveryStatus.tsx')
    const target = globalThis.document.querySelector('#root')
    render(null, target)
    render(h(DeliveryStatus, {}), target)
  })
}

const failedSection = (page) =>
  page.locator('section[aria-labelledby="cms-delivery-failed-heading"]')
const failedList = (page) =>
  page.getByRole('list', { name: 'Misslyckade bokningsmejl', exact: true })
const logReload = (page) =>
  page
    .locator('section[aria-labelledby="cms-delivery-log-heading"]')
    .getByRole('alert')
    .getByRole('button', { name: 'Försök igen', exact: true })
const NO_FAILED = 'Inga misslyckade bokningsmejl.'

async function failedRows(page) {
  return failedSection(page).locator('li strong').allTextContents()
}

async function notices(page) {
  return page.locator('.cms-delivery-status > .cms-notice span').allTextContents()
}

test('Studio email navigation mounts delivery status and restores templates and page', async ({
  page,
  context,
}) => {
  const cms = await nativeBackend(context, documentFixture())
  const delivery = await deliveryBackend(page, { jobs: [job], rpcOnly: true })
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () => {
    ;(await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness()
  })
  await page.locator('.cms-canvas-shell').waitFor()
  await page.getByRole('button', { name: 'Mejl', exact: true }).click()
  const workspace = page.getByRole('region', { name: 'Mejl från din salong', exact: true })
  await workspace.getByRole('button', { name: 'Leveransstatus', exact: true }).click()
  await failedList(page).getByText(JOB_ROW, { exact: true }).waitFor()
  assert.equal(await workspace.locator('.cms-delivery-status').count(), 1)
  await workspace.getByRole('button', { name: 'Mallar', exact: true }).click()
  await workspace.locator('.cms-delivery-status').waitFor({ state: 'detached' })
  await workspace.getByRole('button', { name: 'Leveransstatus', exact: true }).click()
  await failedList(page).getByText(JOB_ROW, { exact: true }).waitFor()
  await workspace.getByRole('button', { name: 'Tillbaka till sidan', exact: true }).click()
  await workspace.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.cms-canvas-shell').getAttribute('inert'), null)
  assert.deepEqual(delivery.unexpected, [])
  assert.equal(cms.writes.length, 0, 'Viewing delivery status must not publish CMS content')
})

// A failed-list read that started before a retry finished must not bring the retried job back,
// whether the retry succeeded or found the job already handled elsewhere. `reload` presses the mail
// log's Försök igen while the retry is in flight; `ready` acts on a loaded list.
for (const [scenario, action, timing, outcome] of [
  ['retry during reload', 'retry', 'reload', 'ok'],
  ['retry not found during reload', 'retry', 'reload', 'not-found'],
  ['retry not found', 'retry', 'ready', 'not-found'],
  ['discard not found', 'discard', 'ready', 'not-found'],
])
  test(`delivery failed list ${scenario}`, async ({ page }) => {
    page.setDefaultTimeout(10000)
    const backend = await deliveryBackend(page, { jobs: [job], logErrors: Infinity })
    await mountDeliveryStatus(page)
    const failed = failedList(page)
    await failed.getByText(JOB_ROW, { exact: true }).waitFor()
    await logReload(page).waitFor()

    const rpc =
      action === 'retry'
        ? 'admin_retry_failed_booking_email_delivery'
        : 'admin_discard_failed_booking_email_delivery'
    const mutation = backend.hold(rpc)
    if (action === 'retry')
      await failed.getByRole('button', { name: 'Försök igen', exact: true }).click()
    else {
      await failed.getByRole('button', { name: 'Markera hanterad', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Markera mejlet som hanterat?', exact: true })
        .getByRole('button', { name: 'Markera hanterad', exact: true })
        .click()
    }
    await mutation.seen

    let staleRead
    if (timing === 'reload') {
      staleRead = backend.hold('admin_list_failed_booking_email_deliveries')
      await logReload(page).click()
      // The reloaded read captures the job while it is still failed.
      await staleRead.seen
      await page.getByText(LOADING_FAILED, { exact: true }).waitFor()
    }
    // Not found: another session settled the job before this action committed.
    if (outcome === 'not-found') backend.setJobStatus(action === 'retry' ? 'pending' : 'skipped')
    mutation.release()
    await mutation.answered
    await afterPaint(page)
    if (staleRead !== undefined) {
      staleRead.release()
      await staleRead.answered
    }
    // The list has settled, loaded with or without the job; then observe one more painted turn.
    await failedSection(page)
      .getByText(/^(Inga misslyckade bokningsmejl\.|Retry Kund · Bokningsbekräftelse)$/)
      .first()
      .waitFor()
    await page.getByText(LOADING_FAILED, { exact: true }).waitFor({ state: 'detached' })
    await afterPaint(page)

    const shown = { rows: await failedRows(page), notices: await notices(page) }
    assert.deepEqual(
      shown,
      { rows: [], notices: outcome === 'ok' ? [] : [NOT_FOUND] },
      `the ${action === 'retry' ? 'retried' : 'handled'} job is listed as failed again: ${JSON.stringify(shown)}`,
    )
    assert.equal(backend.jobStatus(), action === 'retry' ? 'pending' : 'skipped')
    await failedSection(page).getByText(NO_FAILED, { exact: true }).waitFor()

    if (timing === 'reload') {
      // A read that starts after the retry finished is current: a job that failed again is listed.
      backend.setJobStatus('failed')
      await logReload(page).click()
      await failed.getByText(JOB_ROW, { exact: true }).waitFor()
    }
    assert.deepEqual(backend.unexpected, [])
  })

// What the open copy dialog shows: its title, envelope (time normalized), stored copy, text part and
// loading status.
async function copyView(page) {
  return page.locator('dialog.cms-dialog').evaluateAll((dialogs) =>
    dialogs.map((dialog) => ({
      title: dialog.querySelector('header strong')?.textContent ?? null,
      envelope:
        dialog
          .querySelector('.cms-delivery-envelope')
          ?.textContent?.replace(/ · .+ · /, ' · <tid> · ') ?? null,
      copy:
        dialog
          .querySelector('iframe')
          ?.getAttribute('srcdoc')
          ?.match(/<p id="stored-copy">([^<]*)<\/p>/)?.[1] ?? null,
      text: dialog.querySelector('pre')?.textContent ?? null,
      loading: dialog.querySelector('[role="status"]')?.textContent ?? null,
    })),
  )
}

const coherent = ({ subject, recipient, outcome, body }) => ({
  title: subject,
  envelope: `Till ${recipient} · <tid> · ${outcome}`,
  copy: body,
  text: body,
  loading: null,
})

// A failed message that a later attempt delivered under the same dedupe key, opened from the list
// read before that attempt. The dialog must show one row: recipient, subject, status and body from
// the same read. `late` answers the closed first opening with the older row after (`late`) or before
// (`late pending`) the reopened copy.
for (const [scenario, before, after] of [
  [
    'recipient and copy change',
    { recipient: 'former@example.invalid', subject: 'OLD failed', body: 'Old recipient copy' },
    { recipient: 'new@example.invalid', subject: 'NEW accepted', body: 'New recipient copy' },
  ],
  [
    'status only',
    { recipient: 'kund@example.invalid', subject: 'Ny bokning', body: 'En ny tid är bokad' },
    { recipient: 'kund@example.invalid', subject: 'Ny bokning', body: 'En ny tid är bokad' },
  ],
  [
    'late',
    { recipient: 'former@example.invalid', subject: 'OLD failed', body: 'Old recipient copy' },
    { recipient: 'new@example.invalid', subject: 'NEW accepted', body: 'New recipient copy' },
  ],
  [
    'late pending',
    { recipient: 'former@example.invalid', subject: 'OLD failed', body: 'Old recipient copy' },
    { recipient: 'new@example.invalid', subject: 'NEW accepted', body: 'New recipient copy' },
  ],
])
  test(`delivery copy snapshot ${scenario}`, async ({ page }) => {
    page.setDefaultTimeout(10000)
    const backend = await deliveryBackend(page, { log: [logRow(before)] })
    await mountDeliveryStatus(page)
    const show = page.getByRole('button', {
      name: `Visa ${before.subject} till ${before.recipient}`,
      exact: true,
    })
    await show.waitFor()
    const dialog = page.locator('dialog.cms-dialog')
    const close = async () => {
      await dialog.getByRole('button', { name: 'Stäng panel', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
    }
    const late = scenario.startsWith('late')

    const first = late ? backend.hold('admin_get_email_send_log_entry') : undefined
    await show.click()
    if (first !== undefined) {
      await first.seen
      await dialog.getByText('Hämtar mejlet …', { exact: true }).waitFor()
    } else {
      await dialog
        .frameLocator('iframe.cms-delivery-frame')
        .getByText(before.body, { exact: true })
        .waitFor()
      // Control: read before the retry, the dialog is the failed row.
      assert.deepEqual(
        await copyView(page),
        [coherent({ ...before, outcome: FAILED_TRANSIENT })],
        'the first opening shows the failed row',
      )
    }
    await close()

    backend.deliver({
      recipient: after.recipient,
      subject: after.subject,
      html: copyHtml(after.body),
      text_body: after.body,
    })
    const second =
      scenario === 'late pending' ? backend.hold('admin_get_email_send_log_entry') : undefined
    await show.click()
    if (second !== undefined) {
      await second.seen
      first?.release()
      await first?.answered
      // Observe a painted turn after the closed opening's answer settled.
      await afterPaint(page)
      const pending = (await copyView(page)).map(({ copy, text, loading }) => ({
        copy,
        text,
        loading,
      }))
      assert.deepEqual(
        pending,
        [{ copy: null, text: null, loading: 'Hämtar mejlet …' }],
        `the closed opening's older copy replaced the loading reopened copy: ${JSON.stringify(pending)}`,
      )
      second.release()
    }
    await dialog
      .frameLocator('iframe.cms-delivery-frame')
      .getByText(after.body, { exact: true })
      .waitFor()
    if (scenario === 'late') {
      first?.release()
      await first?.answered
      // Observe a painted turn after the closed opening's answer settled.
      await afterPaint(page)
    }

    const shown = await copyView(page)
    assert.deepEqual(
      shown,
      [coherent({ ...after, outcome: 'Skickat' })],
      `the copy dialog mixes the list's older row with the delivered copy: ${JSON.stringify(shown)}`,
    )
    assert.deepEqual(backend.unexpected, [])
  })
