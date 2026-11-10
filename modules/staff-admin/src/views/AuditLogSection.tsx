// The admin log in Settings (owner only). Nothing here calls the backend until `AuditLogList`
// mounts: the log is read when the owner opens the section, never when Settings opens.

import type { JSX, RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import { listAuditLog, type AuditLogEntry } from '../adapters/auditLogAdmin'
import { adminText } from '../adminStrings'
import { orderedAdminOperation } from '../orderedOperations'
import type { AdminError } from '../types'
import { useBarbers } from '../useBarbers'
import { auditLine } from './auditLogEntries'
import {
  controlMark,
  focusAfterMore,
  moveOwnerListFocus,
  rowMark,
  type FocusTarget,
  type MoveOwnerListFocus,
} from './ownerListFocus'
import { appendPage, instantLabel, ownerListErrorText, type KeysetList } from './ownerLists'
import type { AdminStylesBundle } from './viewTypes'

const defaultPort = { list: listAuditLog }
export type AuditLogPort = typeof defaultPort

export interface AuditLogSectionProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly headingStyle: JSX.CSSProperties
  readonly port?: AuditLogPort
  readonly moveFocus?: MoveOwnerListFocus
}

const RESOURCE = 'audit:log'
const LIST_ID = 'settings-audit-list'

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: AdminError }
  | {
      readonly state: 'ready'
      readonly list: KeysetList<AuditLogEntry>
      readonly more: 'idle' | 'loading'
    }

export function AuditLogSection(props: AuditLogSectionProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [open, setOpen] = useState(false)
  const section = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  return (
    <section ref={section} aria-labelledby="settings-audit-heading">
      <h3 id="settings-audit-heading" style={props.headingStyle}>
        {t.auditTitle}
      </h3>
      <p style={{ ...s.mutedText, margin: '0 0 16px', lineHeight: 1.5 }}>{t.auditLead}</p>
      <button
        ref={toggle}
        type="button"
        style={s.ghostBtn}
        aria-expanded={open}
        aria-controls={LIST_ID}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? t.auditClose : t.auditOpen}
      </button>
      <div id={LIST_ID}>
        {open ? (
          <AuditLogList
            lang={props.lang}
            s={s}
            port={props.port ?? defaultPort}
            section={section}
            toggle={toggle}
            moveFocus={props.moveFocus ?? moveOwnerListFocus}
          />
        ) : null}
      </div>
    </section>
  )
}

interface AuditLogListProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly port: AuditLogPort
  readonly section: RefObject<HTMLElement>
  readonly toggle: RefObject<HTMLElement>
  readonly moveFocus: MoveOwnerListFocus
}

function AuditLogList(props: AuditLogListProps): JSX.Element {
  const { s, lang, port } = props
  const t = adminText(lang)
  const { barbers } = useBarbers()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [reload, setReload] = useState(0)
  const [moreError, setMoreError] = useState<AdminError | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusTarget | null>(null)
  // Bumped on each new reading and on close: an answer from an earlier reading is dropped.
  const generation = useRef(0)
  /** Set while a further page is read, so a second press starts nothing. */
  const readingMore = useRef<number | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    generation.current += 1
    const mine = generation.current
    setLoaded({ state: 'loading' })
    void orderedAdminOperation(RESOURCE, () => port.list(null)).then((result) => {
      if (generation.current !== mine) return
      setLoaded(
        result.ok
          ? { state: 'ready', list: appendPage([], result.value), more: 'idle' }
          : { state: 'error', error: result.error },
      )
    })
    return () => {
      generation.current += 1
    }
  }, [port, reload])

  // After the render that shows an answer: the button the owner pressed may be gone by then.
  useEffect(() => {
    if (focusRequest === null) return
    props.moveFocus(focusRequest, {
      section: props.section.current,
      toggle: props.toggle.current,
      list: list.current,
    })
  }, [focusRequest])

  const loadMore = async (): Promise<void> => {
    if (readingMore.current === generation.current || loaded.state !== 'ready') return
    const cursor = loaded.list.next
    if (cursor === null) return
    const mine = generation.current
    const entries = loaded.list.entries
    readingMore.current = mine
    setMoreError(null)
    setLoaded({ ...loaded, more: 'loading' })
    const result = await orderedAdminOperation(RESOURCE, () => port.list(cursor))
    if (readingMore.current === mine) readingMore.current = null
    if (generation.current !== mine) return
    setMoreError(result.ok ? null : result.error)
    setLoaded(
      result.ok
        ? { state: 'ready', list: appendPage(entries, result.value), more: 'idle' }
        : { ...loaded, more: 'idle' },
    )
    setFocusRequest(focusAfterMore(result.ok ? result.value.entries : [], entries, !result.ok))
  }

  const retry = (): void => {
    setReload((count) => count + 1)
    // The button that was pressed leaves with the failure it stood beside.
    setFocusRequest({ place: 'list' })
  }

  const row = (entry: AuditLogEntry): JSX.Element => {
    const line = auditLine(entry, barbers, t)
    return (
      <li
        key={entry.id}
        {...rowMark(entry.id)}
        tabIndex={-1}
        style={{ border: s.card.border, borderRadius: '12px', padding: '11px 13px' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, overflowWrap: 'anywhere' }}>
            {line.who}
          </span>
          <span style={{ fontSize: '14px', overflowWrap: 'anywhere' }}>{line.what}</span>
        </div>
        <div style={{ ...s.mutedText, marginTop: '2px' }}>
          {instantLabel(lang, entry.createdAt)}
        </div>
        {line.columns !== null ? (
          <div style={{ marginTop: '6px', fontSize: '13px', overflowWrap: 'anywhere' }}>
            {line.columns}
          </div>
        ) : null}
        <div style={{ ...s.mutedText, marginTop: '2px', overflowWrap: 'anywhere' }}>
          {line.target}
        </div>
      </li>
    )
  }

  return (
    <div ref={list} tabIndex={-1} style={{ marginTop: '16px' }}>
      <p style={{ ...s.mutedText, margin: '0 0 8px', lineHeight: 1.5 }}>{t.auditRetention}</p>
      <div aria-live="polite" style={{ minHeight: '18px', marginBottom: '8px' }}>
        {moreError !== null ? (
          <span style={s.errorText}>{ownerListErrorText(moreError, t.auditLoadError, t)}</span>
        ) : null}
      </div>

      {loaded.state === 'loading' ? (
        <div role="status" style={s.emptyState}>
          {t.auditLoading}
        </div>
      ) : null}
      {loaded.state === 'error' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span role="alert" style={s.errorText}>
            {ownerListErrorText(loaded.error, t.auditLoadError, t)}
          </span>
          <button type="button" style={s.ghostBtn} onClick={retry}>
            {t.ownerListRetry}
          </button>
        </div>
      ) : null}
      {loaded.state === 'ready' && loaded.list.entries.length === 0 && loaded.list.next === null ? (
        <div style={s.emptyState}>{t.auditEmpty}</div>
      ) : null}
      {loaded.state === 'ready' && loaded.list.entries.length > 0 ? (
        <ul
          role="list"
          aria-label={t.auditListLabel}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {loaded.list.entries.map(row)}
        </ul>
      ) : null}
      {loaded.state === 'ready' && loaded.list.next !== null ? (
        <button
          type="button"
          {...controlMark('more')}
          style={{
            ...s.ghostBtn,
            marginTop: '12px',
            opacity: loaded.more === 'loading' ? 0.6 : 1,
            cursor: loaded.more === 'loading' ? 'default' : 'pointer',
          }}
          disabled={loaded.more === 'loading'}
          onClick={() => void loadMore()}
        >
          {loaded.more === 'loading' ? t.ownerListLoadingMore : t.ownerListLoadMore}
        </button>
      ) : null}
    </div>
  )
}
