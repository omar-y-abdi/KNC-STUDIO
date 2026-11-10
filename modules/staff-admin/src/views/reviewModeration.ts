// Pure decisions of the Settings review moderation list; the section owns the state and the calls.

import type { Lang } from '@bladeblend/public-web/localization'
import type { AdminReview } from '../adapters/reviewsAdmin'
import type { AdminStrings } from '../adminStrings'
import type { AdminResult } from '../types'
import { fillSlot, instantLabel, type OwnerListErrorText } from './ownerLists'
import type { StatusMessage } from './viewTypes'

export type ReviewAction = 'hide' | 'publish' | 'delete'

export function visibilityAction(review: AdminReview): 'hide' | 'publish' {
  return review.published ? 'hide' : 'publish'
}

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

/** An answer that never arrived or cannot be read says nothing: the database may have applied the
 * action all the same. */
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

/** `listReadAgain` matters only for an unknown outcome (`reviewOutcomeIsKnown`). */
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

const QUESTION_NAME_LENGTH = 40

// The direction marks are written by their code points: in the source they would be invisible.
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068)
const POP_DIRECTIONAL_ISOLATE = String.fromCodePoint(0x2069)

function isIsolateMark(character: string): boolean {
  const point = character.codePointAt(0)
  return point !== undefined && point >= 0x2066 && point <= 0x2069
}

/** Isolated so a direction mark in the name (U+202E, say) cannot reorder the sentence around it.
 * The name's own isolate marks are dropped: one would end ours early, or leave it open. */
export function isolatedName(name: string): string {
  const own = Array.from(name).filter((character) => !isIsolateMark(character))
  return `${FIRST_STRONG_ISOLATE}${own.join('')}${POP_DIRECTIONAL_ISOLATE}`
}

/** Cut, because a long unbroken name would not fit the question's card. */
export function questionName(name: string): string {
  const characters = Array.from(name)
  return isolatedName(
    characters.length > QUESTION_NAME_LENGTH
      ? `${characters.slice(0, QUESTION_NAME_LENGTH).join('')}…`
      : name,
  )
}

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

export function ratingStars(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.trunc(rating)))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}
