// Leveransstatus (Studio → Mejl): failed booking emails that need the owner, then every email the
// app logged attempting to send. Rows older than 30 days are purged daily. A booking with an
// unresolved delivery cannot be deleted, purged or removed with its barber until delivery finishes
// or the owner marks it handled here.
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { EmailSendKind, EmailSendOutcome } from '../../../shared/email-send-log'
import {
  discardFailedBookingEmailDelivery,
  getEmailSendLogCopy,
  listEmailSendLog,
  listFailedBookingEmailDeliveries,
  retryFailedBookingEmailDelivery,
  type EmailSendLogCopy,
  type EmailSendLogCursor,
  type EmailSendLogEntry,
  type FailedBookingEmailDelivery,
} from '../adapters/emailDeliveryAdmin'
import { CmsModal } from './Modal'

const defaultPort = {
  listFailed: listFailedBookingEmailDeliveries,
  retry: retryFailedBookingEmailDelivery,
  discard: discardFailedBookingEmailDelivery,
  listLog: listEmailSendLog,
  readCopy: getEmailSendLogCopy,
}
export type DeliveryStatusPort = typeof defaultPort

type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly message: string }

interface LogState {
  readonly entries: readonly EmailSendLogEntry[]
  readonly next: EmailSendLogCursor | null
  readonly more: 'idle' | 'loading'
}

type Busy = { readonly id: string; readonly action: 'retry' | 'discard' } | null

const KIND_LABEL: Readonly<Record<EmailSendKind, string>> = {
  customer_confirmation: 'Bokningsbekräftelse till kund',
  barber_confirmation: 'Ny bokning till barberare',
  customer_cancellation: 'Avbokning till kund',
  barber_cancellation: 'Avbokning till barberare',
  customer_reminder: 'Påminnelse till kund',
  customer_booking_access: 'Länk till Mina bokningar',
  customer_email_link: 'Koppla mejladresser',
  auth_recovery: 'Återställ lösenord',
  auth_email_change: 'Byte av e-postadress',
  auth_invite: 'Inbjudan till barberare',
}

const EVENT_LABEL: Readonly<Record<FailedBookingEmailDelivery['event'], string>> = {
  booking_confirmed: 'Bokningsbekräftelse',
  booking_cancelled: 'Avbokning',
}

const REASON: Readonly<Record<NonNullable<FailedBookingEmailDelivery['errorCode']>, string>> = {
  send_failed_transient: 'Tillfälligt fel hos mejltjänsten eller anslutningen',
  send_failed_permanent: 'Mejltjänsten avvisade mejlet, till exempel en ogiltig adress',
  send_failed: 'Mejlet kunde inte skickas',
  not_configured: 'Mejltjänsten är inte konfigurerad',
  message_build_failed: 'Mejlet kunde inte skapas',
}

const STOCKHOLM_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function stockholmTime(iso: string): string {
  return STOCKHOLM_TIME.format(new Date(iso))
}

function failureReason(code: FailedBookingEmailDelivery['errorCode']): string {
  return code === null ? 'Okänd orsak' : REASON[code]
}

function outcomeLabel(outcome: EmailSendOutcome): string {
  return outcome.status === 'sent' ? 'Skickat' : `Misslyckat: ${REASON[outcome.errorCode]}`
}

/** Addresses the delivery still owes this email; a reached recipient is not listed. */
function owedRecipients(delivery: FailedBookingEmailDelivery): string {
  const owed = [
    delivery.sentKinds.includes('customer') || delivery.customerEmail === null
      ? null
      : `${delivery.customerEmail} (kund)`,
    delivery.sentKinds.includes('barber') || delivery.barberEmail === null
      ? null
      : `${delivery.barberEmail} (barberare)`,
  ].filter((recipient): recipient is string => recipient !== null)
  if (owed.length > 0) return owed.join(', ')
  return delivery.customerEmail === null && delivery.barberEmail === null
    ? 'Ingen mejladress'
    : 'Alla mottagare har fått mejlet'
}

/**
 * The stored copy runs with no scripts and no origin. Opening links in a new window, which the
 * sandbox forbids, keeps a click on a link (or on the hidden-link placeholder) from replacing it.
 */
function inertCopy(html: string): string {
  const base = '<base target="_blank">'
  return html.includes('<head>') ? html.replace('<head>', `<head>${base}`) : `${base}${html}`
}

export function DeliveryStatus({ port = defaultPort }: { port?: DeliveryStatusPort }): JSX.Element {
  const [failed, setFailed] = useState<Loaded<readonly FailedBookingEmailDelivery[]>>({
    state: 'loading',
  })
  const [log, setLog] = useState<Loaded<LogState>>({ state: 'loading' })
  const [busy, setBusy] = useState<Busy>(null)
  const [discardTarget, setDiscardTarget] = useState<FailedBookingEmailDelivery | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{
    readonly entry: EmailSendLogEntry
    readonly copy: Loaded<EmailSendLogCopy>
  } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setFailed({ state: 'loading' })
    setLog({ state: 'loading' })
    void port.listFailed().then((result) => {
      if (!active) return
      setFailed(
        result.ok
          ? { state: 'ready', value: result.value }
          : { state: 'error', message: result.error.message },
      )
    })
    void port.listLog(null).then((result) => {
      if (!active) return
      setLog(
        result.ok
          ? { state: 'ready', value: { ...result.value, more: 'idle' } }
          : { state: 'error', message: result.error.message },
      )
    })
    return () => {
      active = false
    }
  }, [port, reload])

  const resolve = async (
    delivery: FailedBookingEmailDelivery,
    action: 'retry' | 'discard',
  ): Promise<void> => {
    setBusy({ id: delivery.id, action })
    setNotice(null)
    const result =
      action === 'retry' ? await port.retry(delivery.id) : await port.discard(delivery.id)
    setBusy(null)
    setDiscardTarget(null)
    if (!result.ok) {
      setNotice(result.error.message)
      return
    }
    setFailed((previous) =>
      previous.state === 'ready'
        ? { state: 'ready', value: previous.value.filter((entry) => entry.id !== delivery.id) }
        : previous,
    )
  }

  const loadMore = async (current: LogState): Promise<void> => {
    if (current.next === null) return
    setLog({ state: 'ready', value: { ...current, more: 'loading' } })
    const result = await port.listLog(current.next)
    if (!result.ok) {
      setLog({ state: 'ready', value: { ...current, more: 'idle' } })
      setNotice(result.error.message)
      return
    }
    setLog({
      state: 'ready',
      value: {
        entries: [...current.entries, ...result.value.entries],
        next: result.value.next,
        more: 'idle',
      },
    })
  }

  const openCopy = async (entry: EmailSendLogEntry): Promise<void> => {
    setViewing({ entry, copy: { state: 'loading' } })
    const result = await port.readCopy(entry.id)
    setViewing((current) =>
      current?.entry.id !== entry.id
        ? current
        : {
            entry,
            copy: result.ok
              ? { state: 'ready', value: result.value }
              : { state: 'error', message: result.error.message },
          },
    )
  }

  return (
    <div class="cms-delivery-status">
      {notice !== null && (
        <p class="cms-notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            Stäng
          </button>
        </p>
      )}
      <section class="cms-delivery-section" aria-labelledby="cms-delivery-failed-heading">
        <h2 id="cms-delivery-failed-heading">Misslyckade bokningsmejl</h2>
        <p>
          Mejl stoppas efter fem tillfälliga fel eller direkt vid permanenta fel. Bokningen kan inte
          raderas förrän leveransen har slutförts eller markerats som hanterad.
        </p>
        {failed.state === 'loading' && <p role="status">Hämtar misslyckade mejl …</p>}
        {failed.state === 'error' && (
          <p class="cms-notice" role="alert">
            <span>{failed.message}</span>
            <button type="button" onClick={() => setReload((count) => count + 1)}>
              Försök igen
            </button>
          </p>
        )}
        {failed.state === 'ready' && failed.value.length === 0 && (
          <p role="status">Inga misslyckade bokningsmejl.</p>
        )}
        {failed.state === 'ready' && failed.value.length > 0 && (
          <ul class="cms-delivery-list" aria-label="Misslyckade bokningsmejl">
            {failed.value.map((delivery) => (
              <li class="cms-delivery-row" key={delivery.id}>
                <span>
                  <strong>
                    {delivery.customerName} · {EVENT_LABEL[delivery.event]}
                  </strong>
                  <small>
                    Bokad tid {stockholmTime(delivery.bookingStartAt)} hos {delivery.barberName}
                  </small>
                  <small>Mottagare: {owedRecipients(delivery)}</small>
                  {delivery.customerPhone !== null && (
                    <small>Kundens telefon: {delivery.customerPhone}</small>
                  )}
                  <small>
                    {failureReason(delivery.errorCode)} · {delivery.attemptCount} försök
                  </small>
                </span>
                <div class="cms-delivery-actions">
                  <button
                    type="button"
                    class="cms-primary"
                    disabled={busy !== null}
                    onClick={() => void resolve(delivery, 'retry')}
                  >
                    {busy?.id === delivery.id && busy.action === 'retry'
                      ? 'Försöker …'
                      : 'Försök igen'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setDiscardTarget(delivery)}
                  >
                    Markera hanterad
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="cms-delivery-section" aria-labelledby="cms-delivery-log-heading">
        <h2 id="cms-delivery-log-heading">Mejllogg</h2>
        <p>
          Appens loggade sändningsförsök. Mejl som skickas direkt av kontotjänsten eller inte kunde
          loggas saknas här. Skickat betyder att mejltjänsten har tagit emot mejlet. Poster äldre än
          30 dagar rensas dagligen. Länkar som ger inloggning eller tillgång sparas aldrig och visas
          som [dold länk].
        </p>
        {log.state === 'loading' && <p role="status">Hämtar mejllogg …</p>}
        {log.state === 'error' && (
          <p class="cms-notice" role="alert">
            <span>{log.message}</span>
            <button type="button" onClick={() => setReload((count) => count + 1)}>
              Försök igen
            </button>
          </p>
        )}
        {log.state === 'ready' && log.value.entries.length === 0 && (
          <p role="status">Inga loggade sändningsförsök.</p>
        )}
        {log.state === 'ready' && log.value.entries.length > 0 && (
          <ul class="cms-delivery-list" aria-label="Mejllogg">
            {log.value.entries.map((entry) => (
              <li class="cms-delivery-row" key={entry.id}>
                <span>
                  <strong>{entry.subject}</strong>
                  <small>
                    {stockholmTime(entry.createdAt)} · {KIND_LABEL[entry.kind]}
                  </small>
                  <small>Till {entry.recipient}</small>
                  <small
                    class={
                      entry.outcome.status === 'sent' ? 'cms-delivery-sent' : 'cms-delivery-failed'
                    }
                  >
                    {outcomeLabel(entry.outcome)}
                  </small>
                </span>
                <div class="cms-delivery-actions">
                  <button
                    type="button"
                    aria-label={`Visa ${entry.subject} till ${entry.recipient}`}
                    onClick={() => void openCopy(entry)}
                  >
                    Visa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {log.state === 'ready' && log.value.next !== null && (
          <button
            type="button"
            class="cms-delivery-more"
            disabled={log.value.more === 'loading'}
            onClick={() => void loadMore(log.value)}
          >
            {log.value.more === 'loading' ? 'Hämtar …' : 'Visa fler'}
          </button>
        )}
      </section>
      {discardTarget !== null && (
        <CmsModal
          title="Markera mejlet som hanterat?"
          onClose={() => {
            if (busy === null) setDiscardTarget(null)
          }}
          footer={
            <>
              <button type="button" disabled={busy !== null} onClick={() => setDiscardTarget(null)}>
                Avbryt
              </button>
              <button
                type="button"
                class="cms-primary"
                disabled={busy !== null}
                onClick={() => void resolve(discardTarget, 'discard')}
              >
                {busy === null ? 'Markera hanterad' : 'Markerar …'}
              </button>
            </>
          }
        >
          <p>
            {EVENT_LABEL[discardTarget.event]} till {discardTarget.customerName} (
            {stockholmTime(discardTarget.bookingStartAt)}) skickas inte igen. Den här leveransen
            blockerar därefter inte radering av bokningen.
          </p>
        </CmsModal>
      )}
      {viewing !== null && (
        <CmsModal wide title={viewing.entry.subject} onClose={() => setViewing(null)}>
          <p class="cms-delivery-envelope">
            Till {viewing.entry.recipient} · {stockholmTime(viewing.entry.createdAt)} ·{' '}
            {outcomeLabel(viewing.entry.outcome)}
          </p>
          {viewing.copy.state === 'loading' && <p role="status">Hämtar mejlet …</p>}
          {viewing.copy.state === 'error' && (
            <p class="cms-notice" role="alert">
              <span>{viewing.copy.message}</span>
            </p>
          )}
          {viewing.copy.state === 'ready' && (
            <>
              <iframe
                class="cms-delivery-frame"
                title={`Kopia av ${viewing.entry.subject}`}
                sandbox=""
                srcDoc={inertCopy(viewing.copy.value.html)}
              />
              <details class="cms-delivery-text">
                <summary>Textversion</summary>
                <pre>{viewing.copy.value.text}</pre>
              </details>
            </>
          )}
        </CmsModal>
      )}
    </div>
  )
}
