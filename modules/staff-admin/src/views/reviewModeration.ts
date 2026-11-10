// Pure decisions of the review moderation list in Settings: which actions a row offers, what the
// list holds after an action was answered, what the status line says and how a row's buttons are
// named. No effects: the section owns the state and makes the calls.

import type { Lang } from '@bladeblend/public-web/localization'
import type { AdminReview } from '../adapters/reviewsAdmin'
import type { AdminStrings } from '../adminStrings'
import type { AdminResult } from '../types'
import { fillSlot, instantLabel, type OwnerListErrorText } from './ownerLists'
import type { StatusMessage } from './viewTypes'

export type ReviewAction = 'hide' | 'publish' | 'delete'

/** The visibility action a row offers: a published review can be hidden, a hidden one published. */
export function visibilityAction(review: AdminReview): 'hide' | 'publish' {
  return review.published ? 'hide' : 'publish'
}

/**
 * The rows after `action` on the review `id` was answered.
 *   - done: the row shows the new state (hidden, published) or is gone (deleted)
 *   - the review no longer exists: the row is gone, as it is in the database
 *   - any other failure: the same rows, untouched
 */
export function entriesAfterReviewAction(
  entries: readonly AdminReview[],
  id: string,
  action: ReviewAction,
  result: AdminResult<void>,
): readonly AdminReview[] {
  if (!result.ok) {
    return result.error.kind === 'not_found' ? entries.filter((entry) => entry.id !== id) : entries
  }
  switch (action) {
    case 'hide':
    case 'publish':
      return entries.map((entry) =>
        entry.id === id ? { ...entry, published: action === 'publish' } : entry,
      )
    case 'delete':
      return entries.filter((entry) => entry.id !== id)
  }
}

/**
 * Whether the answer says what became of the action. An answer that never arrived or cannot be read
 * does not: the database may have applied the action all the same, and only the list itself says
 * what the row is now. Every other answer is definite: done, gone, or refused before any change.
 */
export function reviewOutcomeIsKnown(result: AdminResult<void>): boolean {
  if (result.ok) return true
  switch (result.error.kind) {
    case 'not_found':
    case 'forbidden':
    case 'auth':
    case 'validation':
      return true
    case 'network':
    case 'malformed':
    case 'challenge':
      return false
  }
}

export type ReviewMessageText = OwnerListErrorText &
  Pick<
    AdminStrings,
    | 'reviewsHiddenOk'
    | 'reviewsPublishedOk'
    | 'reviewsDeletedOk'
    | 'reviewsGone'
    | 'reviewsInvalid'
    | 'reviewsOutcomeUnknownReloaded'
    | 'reviewsOutcomeUnknown'
  >

/**
 * The status line after `action` was answered. Every failure has a sentence that is true for each
 * of the three actions. `listReadAgain` matters only for an outcome that is not known
 * (`reviewOutcomeIsKnown`): whether the list could be read again afterwards.
 */
export function reviewActionMessage(
  action: ReviewAction,
  result: AdminResult<void>,
  listReadAgain: boolean,
  t: ReviewMessageText,
): StatusMessage {
  if (!result.ok) {
    switch (result.error.kind) {
      case 'not_found':
        return { kind: 'err', text: t.reviewsGone }
      case 'forbidden':
        return { kind: 'err', text: t.ownerListForbidden }
      case 'auth':
        return { kind: 'err', text: t.ownerListSessionExpired }
      case 'validation':
        return { kind: 'err', text: t.reviewsInvalid }
      case 'network':
      case 'malformed':
      case 'challenge':
        return {
          kind: 'err',
          text: listReadAgain ? t.reviewsOutcomeUnknownReloaded : t.reviewsOutcomeUnknown,
        }
    }
  }
  switch (action) {
    case 'hide':
      return { kind: 'ok', text: t.reviewsHiddenOk }
    case 'publish':
      return { kind: 'ok', text: t.reviewsPublishedOk }
    case 'delete':
      return { kind: 'ok', text: t.reviewsDeletedOk }
  }
}

/** How much of a customer's name the delete question shows before it is cut with "…". */
const QUESTION_NAME_LENGTH = 40

// The direction marks are written by their code points: in the source they would be invisible.
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068)
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069)

/** One of the four isolate marks, U+2066 to U+2069. */
function isIsolateMark(character: string): boolean {
  const point = character.codePointAt(0)
  return point !== undefined && point >= 0x2066 && point <= 0x2069
}

/**
 * A customer-chosen name set inside a sentence of ours: between FIRST STRONG ISOLATE (U+2068) and
 * POP DIRECTIONAL ISOLATE (U+2069), so that a direction mark in the name (U+202E, say) cannot
 * reorder the words around it. Isolate marks of the name's own are dropped: one of them would end
 * ours early, or leave it open.
 */
export function isolatedName(name: string): string {
  const own = Array.from(name).filter((character) => !isIsolateMark(character))
  return `${FIRST_STRONG_ISOLATE}${own.join('')}${POP_DIRECTIONAL_ISOLATE}`
}

/**
 * The name as the delete question shows it: no longer than `QUESTION_NAME_LENGTH` characters, cut
 * with "…", and isolated. A name of eighty unbroken characters would not fit the question's card.
 */
export function questionName(name: string): string {
  const characters = Array.from(name)
  return isolatedName(
    characters.length > QUESTION_NAME_LENGTH
      ? `${characters.slice(0, QUESTION_NAME_LENGTH).join('')}…`
      : name,
  )
}

/**
 * The body of the delete question for `review`. The name is taken literally, also when it holds
 * the slot.
 */
export function reviewDeleteQuestion(
  review: AdminReview,
  t: Pick<AdminStrings, 'reviewsDeleteBody'>,
): string {
  return fillSlot(t.reviewsDeleteBody, '{name}', questionName(review.name))
}

export type ReviewActionNameText = Pick<
  AdminStrings,
  'reviewsHideAria' | 'reviewsPublishAria' | 'reviewsDeleteAria'
>

/** The accessible name of a row's button: the action, whose review it is and when it was written. */
export function reviewActionName(
  action: ReviewAction,
  review: AdminReview,
  lang: Lang,
  t: ReviewActionNameText,
): string {
  const template = {
    hide: t.reviewsHideAria,
    publish: t.reviewsPublishAria,
    delete: t.reviewsDeleteAria,
  }[action]
  // The date first: it can hold no slot, and a customer's name is free text.
  return fillSlot(
    fillSlot(template, '{date}', instantLabel(lang, review.createdAt)),
    '{name}',
    isolatedName(review.name),
  )
}

/** Five stars, the first `rating` of them filled. A rating outside 0..5 is clamped. */
export function ratingStars(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.trunc(rating)))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}
