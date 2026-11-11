// Review moderation in Settings (owner only). Nothing here calls the backend until
// `ReviewModerationList` mounts: the list is read when the owner opens the section.

import type { JSX, RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import {
  deleteReview,
  listReviews,
  setReviewPublished,
  type AdminReview,
} from '../adapters/reviewsAdmin'
import { adminText } from '../adminStrings'
import { INVISIBLE } from '../adminStyles'
import { ConfirmDialog } from '../ConfirmDialog'
import { orderedAdminOperation } from '../orderedOperations'
import type { AdminError } from '../types'
import {
  controlMark,
  focusAfterMore,
  focusAfterRowAction,
  moveOwnerListFocus,
  rowMark,
  type FocusTarget,
  type MoveOwnerListFocus,
} from './ownerListFocus'
import {
  appendPage,
  fillSlot,
  instantLabel,
  ownerListErrorText,
  type KeysetList,
} from './ownerLists'
import {
  entriesAfterReviewAction,
  ratingStars,
  reviewActionMessage,
  reviewActionName,
  reviewDeleteQuestion,
  reviewOutcomeIsKnown,
  visibilityAction,
  type ReviewAction,
} from './reviewModeration'
import type { AdminStylesBundle, StatusMessage } from './viewTypes'

const defaultPort = { list: listReviews, setPublished: setReviewPublished, remove: deleteReview }
export type ReviewModerationPort = typeof defaultPort

export interface ReviewModerationSectionProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly headingStyle: JSX.CSSProperties
  readonly port?: ReviewModerationPort
  readonly moveFocus?: MoveOwnerListFocus
}

/** Ordered: a reopened list reads after a write still running. */
const RESOURCE = 'reviews:moderation'
const LIST_ID = 'settings-reviews-list'
const HIDE_HELP_ID = 'settings-reviews-hide-help'

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: AdminError }
  | {
      readonly state: 'ready'
      readonly list: KeysetList<AdminReview>
      readonly more: 'idle' | 'loading'
    }

export function ReviewModerationSection(props: ReviewModerationSectionProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [open, setOpen] = useState(false)
  const section = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  return (
    <section ref={section} aria-labelledby="settings-reviews-heading">
      <h3 id="settings-reviews-heading" style={props.headingStyle}>
        {t.reviewsTitle}
      </h3>
      <p style={{ ...s.mutedText, margin: '0 0 16px', lineHeight: 1.5 }}>{t.reviewsLead}</p>
      <button
        ref={toggle}
        type="button"
        style={s.ghostBtn}
        aria-expanded={open}
        aria-controls={LIST_ID}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? t.reviewsClose : t.reviewsOpen}
      </button>
      <div id={LIST_ID}>
        {open ? (
          <ReviewModerationList
            dark={props.dark}
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

interface ReviewModerationListProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly port: ReviewModerationPort
  readonly section: RefObject<HTMLElement>
  readonly toggle: RefObject<HTMLElement>
  readonly moveFocus: MoveOwnerListFocus
}

function ReviewModerationList(props: ReviewModerationListProps): JSX.Element {
  const { s, lang, port } = props
  const t = adminText(lang)
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [reload, setReload] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminReview | null>(null)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusTarget | null>(null)
  // Bumped on each new reading and on close: an answer from an earlier reading is dropped.
  const generation = useRef(0)
  /** Set until an action is answered, so a second press starts nothing. */
  const acting = useRef(false)
  /** Set while a further page is read, so a second press starts nothing. */
  const readingMore = useRef<number | null>(null)
  /** The rows as they were last rendered, for deciding where the focus goes. */
  const shown = useRef<readonly AdminReview[]>([])
  shown.current = loaded.state === 'ready' ? loaded.list.entries : []
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

  // After the render that shows an answer: the pressed control may be gone or disabled, and a
  // closing dialog has already tried to hand the focus back to it.
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
    readingMore.current = mine
    setMessage(null)
    setLoaded((current) => (current.state === 'ready' ? { ...current, more: 'loading' } : current))
    const result = await orderedAdminOperation(RESOURCE, () => port.list(cursor))
    if (readingMore.current === mine) readingMore.current = null
    if (generation.current !== mine) return
    if (!result.ok) {
      setMessage({ kind: 'err', text: ownerListErrorText(result.error, t.reviewsLoadError, t) })
    }
    // Applied to the list as it is now: an action answered meanwhile keeps its effect.
    setLoaded((current) =>
      current.state !== 'ready'
        ? current
        : result.ok
          ? { state: 'ready', list: appendPage(current.list.entries, result.value), more: 'idle' }
          : { ...current, more: 'idle' },
    )
    setFocusRequest(
      focusAfterMore(result.ok ? result.value.entries : [], shown.current, !result.ok),
    )
  }

  const run = async (review: AdminReview, action: ReviewAction): Promise<void> => {
    if (acting.current) return
    acting.current = true
    const mine = generation.current
    const before = shown.current
    setBusyId(review.id)
    setMessage(null)
    const result = await orderedAdminOperation(RESOURCE, () =>
      action === 'delete'
        ? port.remove(review.id)
        : port.setPublished(review.id, action === 'publish'),
    )
    // An unknown outcome: read the list again from its first page, unless that list is gone by now.
    const fresh =
      generation.current !== mine || reviewOutcomeIsKnown(result)
        ? null
        : await orderedAdminOperation(RESOURCE, () => port.list(null))
    acting.current = false
    if (generation.current !== mine) return
    const control = action === 'delete' ? 'delete' : 'visibility'
    setBusyId(null)
    setPendingDelete(null)
    setMessage(reviewActionMessage(action, result, fresh?.ok === true, t))
    if (fresh === null) {
      setLoaded((current) =>
        current.state !== 'ready'
          ? current
          : {
              ...current,
              list: {
                ...current.list,
                entries: entriesAfterReviewAction(current.list.entries, review.id, action, result),
              },
            },
      )
      setFocusRequest(
        focusAfterRowAction(
          before,
          entriesAfterReviewAction(shown.current, review.id, action, result),
          review.id,
          control,
        ),
      )
      return
    }
    // The list starts over: a further page that is still being read belongs to the old one.
    generation.current += 1
    setLoaded(
      fresh.ok
        ? { state: 'ready', list: appendPage([], fresh.value), more: 'idle' }
        : { state: 'error', error: fresh.error },
    )
    setFocusRequest(
      focusAfterRowAction(before, fresh.ok ? fresh.value.entries : null, review.id, control),
    )
  }

  const retry = (): void => {
    setReload((count) => count + 1)
    // The button that was pressed leaves with the failure it stood beside.
    setFocusRequest({ place: 'list' })
  }

  const busy = busyId !== null
  const rowButton = (danger: boolean): JSX.CSSProperties => ({
    ...(danger ? s.dangerBtn : s.ghostBtn),
    padding: '7px 13px',
    fontSize: '13px',
    opacity: busy ? 0.6 : 1,
    cursor: busy ? 'default' : 'pointer',
  })

  const row = (review: AdminReview): JSX.Element => {
    const visibility = visibilityAction(review)
    return (
      <li
        key={review.id}
        {...rowMark(review.id)}
        style={{ border: s.card.border, borderRadius: '12px', padding: '11px 13px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, overflowWrap: 'anywhere' }}>
            {review.name}
          </span>
          <span
            role="img"
            aria-label={fillSlot(t.reviewsRating, '{rating}', String(review.rating))}
            style={{ fontSize: '13px', letterSpacing: '1px' }}
          >
            {ratingStars(review.rating)}
          </span>
          <span style={s.pill}>
            {review.published ? t.reviewsStatusPublished : t.reviewsStatusHidden}
          </span>
        </div>
        <div style={{ ...s.mutedText, marginTop: '2px' }}>
          {instantLabel(lang, review.createdAt)}
        </div>
        <p
          style={{
            margin: '8px 0 10px',
            fontSize: '14px',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {review.text}
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            {...controlMark('visibility')}
            style={rowButton(false)}
            aria-label={reviewActionName(visibility, review, lang, t)}
            aria-describedby={visibility === 'hide' ? HIDE_HELP_ID : undefined}
            disabled={busy}
            onClick={() => void run(review, visibility)}
          >
            {visibility === 'hide' ? t.reviewsHide : t.reviewsPublish}
          </button>
          <button
            type="button"
            {...controlMark('delete')}
            style={rowButton(true)}
            aria-label={reviewActionName('delete', review, lang, t)}
            disabled={busy}
            onClick={() => setPendingDelete(review)}
          >
            {t.reviewsDelete}
          </button>
        </div>
      </li>
    )
  }

  return (
    <div ref={list} tabIndex={-1} style={{ marginTop: '16px' }}>
      <p id={HIDE_HELP_ID} style={{ ...s.mutedText, margin: '0 0 8px', lineHeight: 1.5 }}>
        {t.reviewsHideHelp}
      </p>
      <div aria-live="polite" style={{ minHeight: '18px', marginBottom: '8px' }}>
        {message !== null ? (
          <span style={message.kind === 'ok' ? s.successText : s.errorText}>{message.text}</span>
        ) : null}
      </div>

      {loaded.state === 'loading' ? (
        <div role="status" style={{ ...s.emptyState, ...INVISIBLE }}>
          {t.reviewsLoading}
        </div>
      ) : null}
      {loaded.state === 'error' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span role="alert" style={s.errorText}>
            {ownerListErrorText(loaded.error, t.reviewsLoadError, t)}
          </span>
          <button type="button" style={s.ghostBtn} onClick={retry}>
            {t.ownerListRetry}
          </button>
        </div>
      ) : null}
      {loaded.state === 'ready' && loaded.list.entries.length === 0 && loaded.list.next === null ? (
        <div style={s.emptyState}>{t.reviewsEmpty}</div>
      ) : null}
      {loaded.state === 'ready' && loaded.list.entries.length > 0 ? (
        <ul
          role="list"
          aria-label={t.reviewsListLabel}
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

      {pendingDelete !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.reviewsDeleteTitle}
          body={reviewDeleteQuestion(pendingDelete, t)}
          confirmLabel={t.reviewsDeleteConfirm}
          cancelLabel={t.reviewsDeleteCancel}
          danger
          busy={busy}
          onConfirm={() => void run(pendingDelete, 'delete')}
          onClose={() => {
            if (!busy) setPendingDelete(null)
          }}
        />
      ) : null}
    </div>
  )
}
