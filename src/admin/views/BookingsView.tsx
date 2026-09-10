// Bookings view. Renders the RLS-readable bookings in THREE sections — Kommande (upcoming confirmed),
// Avbokade (cancelled, any time) and Tidigare (past confirmed) — and, within the active section, one
// horizontally-scrollable tab per ISO week. Sectioning + week bucketing is the pure `partitionSections`
// (Europe/Stockholm wall-clock weeks); this component only renders it and owns the data effects.
//
// Cancel: only Kommande rows are cancellable (confirm dialog -> admin_cancel_booking RPC); the flip is
// applied optimistically (status -> cancelled), so the memoized partition re-runs and the row moves
// Kommande -> Avbokade without a refetch.
//
// Clear history: in Avbokade + Tidigare ONLY (never Kommande — the RPC refuses live upcoming rows and
// the UI fails closed), each row carries a checkbox; "Markera veckan"/"Markera alla" bulk-select the
// active week / whole section; "Radera markerade" deletes the selection via admin_delete_bookings.
// Selection is an immutable Set<string> scoped to the active section (cleared when the section changes).
//
// Global purge (OWNER "Alla bokningar" only): "Töm all historik" opens the type-to-confirm dialog and
// calls admin_purge_history. After any successful delete/purge the list is reloaded, so the sections
// recompute from fresh data.

import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { formatWhenLabel } from '../../booking/calendar'
import { palette } from '../../booking/bookingStyles'
import { defaultClock } from '../../config'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import {
  cancelBooking,
  deleteBookings,
  listBookings,
  purgeHistory,
} from '../adapters/bookingsAdmin'
import { useNarrow } from '../chrome'
import { ConfirmDialog } from '../ConfirmDialog'
import { TypeToConfirmDialog } from '../TypeToConfirmDialog'
import { isoWeek, weekLabel } from '../weekOfYear'
import { partitionSections } from './bookingsSections'
import type { BookingSection, SectionedBookings, WeekGroup } from './bookingsSections'
import type { AdminBarber, AdminBarberId, AdminBooking, AdminStylesBundle } from './viewTypes'
import { CalendarConnectButton } from '../calendar/CalendarConnectButton'

export interface BookingsViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  /** Which barber's bookings to show; ignored when `allBarbers` is true. */
  readonly barberId: AdminBarberId | null
  /** Owner-only: show every barber's bookings (the "Alla bokningar" tab). */
  readonly allBarbers: boolean
  /** Roster, to resolve a booking's barber id -> name (owner "all" view). */
  readonly barbers: readonly AdminBarber[]
  /** Heading shown above the tables (e.g. "Mina bokningar" / "Alla bokningar"). */
  readonly heading: string
  readonly lead: string
  /** Show the barber's own "Koppla kalender" panel — barber view only, NEVER the owner (an owner
   *  cannot consent for a barber's Google account). */
  readonly showCalendarConnect?: boolean
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly bookings: readonly AdminBooking[] }

interface Notice {
  readonly kind: 'ok' | 'err'
  readonly text: string
}

/** The three sections in render order (Kommande first — a barber's most frequent need). */
const SECTION_ORDER: readonly BookingSection[] = ['kommande', 'avbokade', 'tidigare']

/** A stable empty result for the not-ready states (partitionSections is only run on ready data). */
const EMPTY_SECTIONS: SectionedBookings = { kommande: [], avbokade: [], tidigare: [] }

/** The composite `(isoWeekYear, isoWeek)` key that identifies one week tab within a section. */
function weekKey(group: WeekGroup): string {
  return `${group.isoWeekYear}-${group.isoWeek}`
}

export function BookingsView(props: BookingsViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const narrow = useNarrow()
  const c = palette(props.dark)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [loadedGeneration, setLoadedGeneration] = useState<number | null>(null)
  const [activeSection, setActiveSection] = useState<BookingSection>('kommande')
  // Which week tab is active WITHIN the current section; null resolves to the section's first group.
  const [activeWeekKey, setActiveWeekKey] = useState<string | null>(null)
  // Selected booking ids for history-clearing — immutable, scoped to the active section.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  // Cancel flow (Kommande only).
  const [pendingCancel, setPendingCancel] = useState<AdminBooking | null>(null)
  const [busy, setBusy] = useState(false)
  // "Radera markerade" flow — its own busy flag so a delete in flight is never confused with a cancel.
  const [clearOpen, setClearOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  // Owner-only global purge flow.
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const targetKey = props.allBarbers ? 'all:*' : `barber:${props.barberId ?? ''}`
  const targetScope = useRef({ key: targetKey, generation: 0 })
  if (targetScope.current.key !== targetKey) {
    targetScope.current = {
      key: targetKey,
      generation: targetScope.current.generation + 1,
    }
  }

  /** Fetch the current target's bookings into a `Load` (owner=all, barber=own; a barber with no id
   *  and not in "all" mode has nothing to show). Shared by the target-change effect and post-mutation
   *  reload; the effect adds the unmount/target-change race guard. */
  const fetchLoad = async (): Promise<Load> => {
    if (!props.allBarbers && props.barberId === null) return { kind: 'ready', bookings: [] }
    const target = props.allBarbers ? undefined : (props.barberId ?? undefined)
    const result = await listBookings(target)
    return result.ok
      ? { kind: 'ready', bookings: result.value }
      : { kind: 'error', message: result.error.message }
  }

  /** Re-fetch and replace the list (no loading flicker) after a successful delete/purge. */
  const reload = async (expectedGeneration = targetScope.current.generation): Promise<void> => {
    const next = await fetchLoad()
    if (targetScope.current.generation === expectedGeneration) setLoad(next)
  }

  // Reload whenever the target (barber / all) changes; also reset transient UI so nothing leaks across
  // targets. The initial mount counts as a target change.
  useEffect(() => {
    let active = true
    const targetGeneration = targetScope.current.generation
    setLoad({ kind: 'loading' })
    setLoadedGeneration(null)
    setNotice(null)
    setSelected(new Set())
    setActiveSection('kommande')
    setActiveWeekKey(null)
    setPendingCancel(null)
    setBusy(false)
    setClearOpen(false)
    setClearBusy(false)
    setPurgeOpen(false)
    setPurgeBusy(false)
    void (async () => {
      const next = await fetchLoad()
      if (active) {
        setLoad(next)
        setLoadedGeneration(targetGeneration)
      }
    })()
    return () => {
      active = false
    }
  }, [props.barberId, props.allBarbers])

  // The injectable clock (same "today" source as the schedule views + deterministic screenshots).
  const nowInstant = defaultClock()
  const nowMs = nowInstant.getTime()
  // The ISO week-numbering year of "now" (Stockholm wall-clock) — so week labels only append the year
  // for cross-year weeks. Derived the same way the partitioner derives a booking's week.
  const wallNow = stockholmWallClockDate(nowInstant)
  const currentIsoWeekYear = isoWeek(
    wallNow.getFullYear(),
    wallNow.getMonth() + 1,
    wallNow.getDate(),
  ).isoWeekYear

  const visibleLoad: Load =
    loadedGeneration === targetScope.current.generation ? load : { kind: 'loading' }
  const sections = useMemo<SectionedBookings>(
    () =>
      visibleLoad.kind === 'ready'
        ? partitionSections(visibleLoad.bookings, nowMs)
        : EMPTY_SECTIONS,
    [visibleLoad, nowMs],
  )

  const activeGroups = sections[activeSection]
  // Resolve the active week: the tab whose key matches, else the first group (soonest for Kommande /
  // most-recent for Avbokade+Tidigare), else null when the section is empty.
  const activeGroup: WeekGroup | null =
    activeGroups.find((g) => weekKey(g) === activeWeekKey) ?? activeGroups[0] ?? null

  // Selection/clear is ONLY for the two history sections — NEVER Kommande (fail closed). Cancel is the
  // mirror: ONLY Kommande.
  const selectable = activeSection !== 'kommande'
  const cancellable = activeSection === 'kommande'

  const sectionLabel = (sec: BookingSection): string =>
    sec === 'kommande'
      ? t.bookingsUpcoming
      : sec === 'avbokade'
        ? t.bookingsSectionCancelled
        : t.bookingsPast

  const emptyText =
    activeSection === 'kommande'
      ? t.bookingsEmptyUpcoming
      : activeSection === 'avbokade'
        ? t.bookingsEmptyCancelled
        : t.bookingsEmptyPast

  const barberName = (id: AdminBarberId): string =>
    props.barbers.find((b) => b.id === id)?.name ?? id

  // --- Selection helpers (immutable: every change builds a fresh Set) ------------------------------

  const sectionIds = (): readonly string[] =>
    activeGroups.flatMap((g) => g.bookings.map((b) => b.id))

  const weekAllSelected =
    activeGroup !== null &&
    activeGroup.bookings.length > 0 &&
    activeGroup.bookings.every((b) => selected.has(b.id))

  const sectionAllSelected =
    selectable && activeGroups.length > 0 && sectionIds().every((id) => selected.has(id))

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleWeek = (group: WeekGroup): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      const all = group.bookings.every((b) => next.has(b.id))
      for (const b of group.bookings) {
        if (all) next.delete(b.id)
        else next.add(b.id)
      }
      return next
    })
  }

  const toggleSection = (): void => {
    const ids = sectionIds()
    setSelected((prev) => {
      const all = ids.length > 0 && ids.every((id) => prev.has(id))
      return all ? new Set() : new Set(ids)
    })
  }

  // --- Section switching (selection is section-scoped: cleared on change) --------------------------

  const selectSection = (next: BookingSection): void => {
    setActiveSection(next)
    setActiveWeekKey(null)
    setSelected(new Set())
    setNotice(null)
  }

  // --- Mutations ----------------------------------------------------------------------------------

  const doCancel = async (): Promise<void> => {
    const target = pendingCancel
    if (target === null) return
    const expectedGeneration = targetScope.current.generation
    setBusy(true)
    const result = await cancelBooking(target.id)
    if (targetScope.current.generation !== expectedGeneration) return
    setBusy(false)
    setPendingCancel(null)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setNotice({ kind: 'ok', text: t.bookingsCancelledOk })
    // Reflect the cancellation locally (status -> cancelled); the partition memo re-runs and moves the
    // row Kommande -> Avbokade without a refetch.
    setLoad((prev) =>
      prev.kind === 'ready'
        ? {
            kind: 'ready',
            bookings: prev.bookings.map((b) =>
              b.id === target.id ? { ...b, status: 'cancelled' } : b,
            ),
          }
        : prev,
    )
  }

  const doClearSelected = async (): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) {
      setClearOpen(false)
      return
    }
    const expectedGeneration = targetScope.current.generation
    setClearBusy(true)
    const result = await deleteBookings(ids)
    if (targetScope.current.generation !== expectedGeneration) return
    setClearBusy(false)
    setClearOpen(false)
    if (!result.ok) {
      // Keep the selection so the operator can retry; surface the localized error.
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setSelected(new Set())
    setNotice({ kind: 'ok', text: t.bookingsClearedOk })
    await reload(expectedGeneration)
  }

  const doPurge = async (): Promise<void> => {
    const expectedGeneration = targetScope.current.generation
    setPurgeBusy(true)
    const result = await purgeHistory()
    if (targetScope.current.generation !== expectedGeneration) return
    setPurgeBusy(false)
    setPurgeOpen(false)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setSelected(new Set())
    setNotice({ kind: 'ok', text: t.bookingsPurgedOk })
    await reload(expectedGeneration)
  }

  // --- Rendering ----------------------------------------------------------------------------------

  const tabStyle = (active: boolean): JSX.CSSProperties => ({
    border: 'none',
    borderRadius: '9px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: 'none',
    background: active ? c.subtle : 'transparent',
    color: c.text,
    opacity: active ? 1 : 0.72,
  })

  const rowCheckbox = (b: AdminBooking): JSX.Element => (
    <input
      type="checkbox"
      checked={selected.has(b.id)}
      onChange={() => toggleOne(b.id)}
      aria-label={b.customerName}
      style={{ width: '17px', height: '17px', flex: 'none', cursor: 'pointer' }}
    />
  )

  // Mobile: stacked cards — a select checkbox (history sections) + time first, then customer, service,
  // a tap-to-call contact, and the cancel action (Kommande only). No side-scrolling table on a phone.
  const renderCards = (rows: readonly AdminBooking[]): JSX.Element => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rows.map((b) => {
        const cancelled = b.status === 'cancelled'
        return (
          <div
            key={b.id}
            style={{
              border: '0.5px solid ' + c.line,
              borderRadius: '12px',
              background: c.card,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              opacity: cancelled ? 0.55 : 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                {selectable ? rowCheckbox(b) : null}
                <span style={{ fontSize: '14px', fontWeight: 700 }}>
                  {formatWhenLabel(lang, stockholmWallClockDate(b.startAt))}
                </span>
              </div>
              <span
                style={{
                  ...s.pill,
                  flex: 'none',
                  color: cancelled ? s.errorText.color : undefined,
                }}
              >
                {cancelled ? t.bookingsStatusCancelled : t.bookingsStatusConfirmed}
              </span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600 }}>
              {b.customerName}
              {props.allBarbers ? (
                <span style={s.mutedText}>
                  {' '}
                  · {t.bookingsAtBarber} {barberName(b.barberId)}
                </span>
              ) : null}
            </div>
            <div style={{ ...s.mutedText, fontSize: '13px' }}>
              {b.serviceName} · {b.durationMin} min · {b.price} kr
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                marginTop: '3px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
                {b.phone !== null ? (
                  <a
                    href={`tel:${b.phone}`}
                    style={{
                      ...s.ghostBtn,
                      padding: '7px 13px',
                      fontSize: '13px',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <img
                      src="/icons/phone.svg"
                      alt=""
                      style={{ width: '13px', height: '13px', filter: c.iconF, opacity: 0.7 }}
                    />
                    {b.phone}
                  </a>
                ) : null}
                {b.email !== null ? (
                  <a
                    href={`mailto:${b.email}`}
                    style={{ ...s.mutedText, color: c.text, overflowWrap: 'anywhere' }}
                  >
                    {b.email}
                  </a>
                ) : null}
                {b.phone === null && b.email === null ? <span style={s.mutedText}>—</span> : null}
              </div>
              {cancelled || !cancellable ? null : (
                <button
                  type="button"
                  style={{ ...s.dangerBtn, padding: '7px 13px', fontSize: '13px' }}
                  onClick={() => setPendingCancel(b)}
                >
                  {t.bookingsCancelAction}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  const renderTable = (rows: readonly AdminBooking[]): JSX.Element => {
    if (narrow) return renderCards(rows)
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={s.table}>
          <thead>
            <tr>
              {selectable ? <th style={{ ...s.th, width: '1%' }} /> : null}
              <th style={s.th}>{t.bookingsColTime}</th>
              {props.allBarbers ? <th style={s.th}>{t.bookingsColBarber}</th> : null}
              <th style={s.th}>{t.bookingsColCustomer}</th>
              <th style={s.th}>{t.bookingsColService}</th>
              <th style={s.th}>{t.bookingsColContact}</th>
              <th style={s.th}>{t.bookingsColStatus}</th>
              <th style={{ ...s.th, textAlign: 'right' }}>{t.bookingsColAction}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const cancelled = b.status === 'cancelled'
              return (
                <tr key={b.id}>
                  {selectable ? <td style={s.td}>{rowCheckbox(b)}</td> : null}
                  {/* Salon wall-clock, not the browser's tz — an admin abroad must see salon times. */}
                  <td style={s.td}>{formatWhenLabel(lang, stockholmWallClockDate(b.startAt))}</td>
                  {props.allBarbers ? <td style={s.td}>{barberName(b.barberId)}</td> : null}
                  <td style={s.td}>{b.customerName}</td>
                  <td style={s.td}>
                    {b.serviceName}
                    <span style={s.mutedText}> · {b.durationMin} min</span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {b.phone !== null ? (
                        <a href={`tel:${b.phone}`} style={{ color: 'inherit' }}>
                          {b.phone}
                        </a>
                      ) : null}
                      {b.email !== null ? (
                        <a href={`mailto:${b.email}`} style={{ color: 'inherit' }}>
                          {b.email}
                        </a>
                      ) : null}
                      {b.phone === null && b.email === null ? '—' : null}
                    </div>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.pill, color: cancelled ? s.errorText.color : undefined }}>
                      {cancelled ? t.bookingsStatusCancelled : t.bookingsStatusConfirmed}
                    </span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    {cancelled || !cancellable ? (
                      <span style={s.mutedText}>—</span>
                    ) : (
                      <button type="button" style={s.dangerBtn} onClick={() => setPendingCancel(b)}>
                        {t.bookingsCancelAction}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <section style={s.card} aria-labelledby="bookings-heading">
        <h2 id="bookings-heading" style={s.sectionTitle}>
          {props.heading}
        </h2>
        <p style={s.sectionLead}>{props.lead}</p>

        {props.showCalendarConnect === true ? (
          <CalendarConnectButton s={s} dark={props.dark} lang={lang} />
        ) : null}

        <div aria-live="polite" style={{ minHeight: '18px', margin: '8px 0 4px' }}>
          {notice !== null ? (
            <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
          ) : null}
        </div>

        {visibleLoad.kind === 'loading' ? (
          <div style={s.emptyState}>{t.bookingsLoading}</div>
        ) : visibleLoad.kind === 'error' ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{visibleLoad.message}</div>
        ) : (
          <>
            {/* Section switcher (mirrors the shell's nav: aria-current + subtle active bg) + owner purge. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
                marginTop: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {SECTION_ORDER.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    aria-current={sec === activeSection ? 'page' : undefined}
                    onClick={() => selectSection(sec)}
                    style={tabStyle(sec === activeSection)}
                  >
                    {sectionLabel(sec)}
                  </button>
                ))}
              </div>
              {props.allBarbers ? (
                <button
                  type="button"
                  style={s.dangerBtn}
                  onClick={() => {
                    setPurgeOpen(true)
                    setNotice(null)
                  }}
                >
                  {t.bookingsPurgeAll}
                </button>
              ) : null}
            </div>

            {activeGroup === null ? (
              <div style={s.emptyState}>{emptyText}</div>
            ) : (
              <>
                {/* Week tabs — horizontally scrollable so ~50 weeks scroll instead of wrapping. */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                    gap: '6px',
                    padding: '4px 0',
                    margin: '12px 0 4px',
                  }}
                >
                  {activeGroups.map((g) => {
                    const key = weekKey(g)
                    const isActive = key === weekKey(activeGroup)
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setActiveWeekKey(key)}
                        style={tabStyle(isActive)}
                      >
                        {weekLabel(g, currentIsoWeekYear, lang)}
                      </button>
                    )
                  })}
                </div>

                {/* Bulk-select controls — history sections only. */}
                {selectable ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'wrap',
                      margin: '8px 0',
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={weekAllSelected}
                      style={{
                        ...s.ghostBtn,
                        padding: '7px 12px',
                        fontSize: '13px',
                        background: weekAllSelected ? c.subtle : 'transparent',
                      }}
                      onClick={() => toggleWeek(activeGroup)}
                    >
                      {t.bookingsSelectWeek}
                    </button>
                    <button
                      type="button"
                      aria-pressed={sectionAllSelected}
                      style={{
                        ...s.ghostBtn,
                        padding: '7px 12px',
                        fontSize: '13px',
                        background: sectionAllSelected ? c.subtle : 'transparent',
                      }}
                      onClick={toggleSection}
                    >
                      {t.bookingsSelectAll}
                    </button>
                  </div>
                ) : null}

                {renderTable(activeGroup.bookings)}

                {/* Action bar — appears only with a non-empty selection (history sections only). */}
                {selectable && selected.size > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginTop: '14px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button type="button" style={s.dangerBtn} onClick={() => setClearOpen(true)}>
                      {t.bookingsClearSelected} ({selected.size})
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </section>

      {visibleLoad.kind === 'ready' && pendingCancel !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.bookingsCancelDialogTitle}
          body={`${pendingCancel.customerName} · ${formatWhenLabel(lang, stockholmWallClockDate(pendingCancel.startAt))}${t.bookingsCancelDialogBodySuffix}`}
          confirmLabel={t.bookingsCancelDialogConfirm}
          cancelLabel={t.bookingsCancelDialogKeep}
          danger
          busy={busy}
          onConfirm={() => void doCancel()}
          onClose={() => {
            if (!busy) setPendingCancel(null)
          }}
        />
      ) : null}

      {visibleLoad.kind === 'ready' && clearOpen ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.bookingsClearTitle}
          body={t.bookingsClearBody}
          confirmLabel={t.bookingsClearConfirm}
          cancelLabel={t.bookingsClearCancel}
          danger
          busy={clearBusy}
          onConfirm={() => void doClearSelected()}
          onClose={() => {
            if (!clearBusy) setClearOpen(false)
          }}
        />
      ) : null}

      {visibleLoad.kind === 'ready' && purgeOpen ? (
        <TypeToConfirmDialog
          dark={props.dark}
          title={t.bookingsPurgeTitle}
          body={t.bookingsPurgeBody}
          token={t.bookingsPurgeToken}
          confirmLabel={t.bookingsPurgeConfirm}
          cancelLabel={t.bookingsPurgeCancel}
          busy={purgeBusy}
          onConfirm={() => void doPurge()}
          onClose={() => {
            if (!purgeBusy) setPurgeOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
