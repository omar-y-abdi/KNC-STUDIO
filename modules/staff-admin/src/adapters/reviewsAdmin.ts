// Review moderation adapter (owner only): list every review in pages, hide, publish, delete one.
// SQLSTATE 42501 is `forbidden`, HTTP 401 is `auth`; answers are Zod-parsed, nothing throws.

import { getAdminClient } from '../adminClient'
import {
  adminReviewPage,
  parseWith,
  reviewModerationResponse,
  type AdminReviewRow,
} from '../adminSchemas'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

export interface AdminReview {
  readonly id: string
  /** The database timestamp verbatim: it is also the paging cursor, so never round it. */
  readonly createdAt: string
  readonly name: string
  readonly rating: number
  readonly text: string
  readonly published: boolean
}

/** Where the next page starts: just after this entry in newest-first order. */
export interface ReviewCursor {
  readonly before: string
  readonly beforeId: string
}

export interface AdminReviewPage {
  readonly entries: readonly AdminReview[]
  readonly hasMore: boolean
}

const READ_ERROR = 'Kunde inte läsa recensionerna.'
const VISIBILITY_ERROR = 'Kunde inte ändra om recensionen visas.'
const DELETE_ERROR = 'Kunde inte ta bort recensionen.'
const FORBIDDEN = 'Endast ägaren kan hantera recensioner.'
const SESSION_EXPIRED = 'Din session har gått ut. Logga in igen.'
const PAGE_SIZE = 50

/** No valid session: PostgREST answers 401, also for the anonymous role (refused with 42501). */
const sessionEnded = (status: number): boolean => status === 401

function toReview(row: AdminReviewRow): AdminReview {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    rating: row.rating,
    text: row.text,
    published: row.published,
  }
}

export async function listReviews(
  cursor: ReviewCursor | null,
): Promise<AdminResult<AdminReviewPage>> {
  try {
    const { data, error, status } = await getAdminClient().rpc('admin_list_reviews', {
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: PAGE_SIZE,
    })
    if (sessionEnded(status)) return err('auth', SESSION_EXPIRED)
    if (error?.code === '42501') return err('forbidden', FORBIDDEN)
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(adminReviewPage, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok({ entries: parsed.value.entries.map(toReview), hasMore: parsed.value.has_more })
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Hide, publish and delete answer alike; `failure` is the message that names the attempt. */
async function moderate(
  rpc: 'admin_set_review_published' | 'admin_delete_review',
  args: Readonly<Record<string, unknown>>,
  failure: string,
): Promise<AdminResult<void>> {
  try {
    const { data, error, status } = await getAdminClient().rpc(rpc, args)
    if (sessionEnded(status)) return err('auth', SESSION_EXPIRED)
    if (error?.code === '42501') return err('forbidden', FORBIDDEN)
    if (error !== null || data === null) return err('network', failure)
    const parsed = parseWith(reviewModerationResponse, data)
    if (!parsed.ok) return err('malformed', failure)
    if (parsed.value.ok) return ok(undefined)
    switch (parsed.value.error) {
      case 'invalid':
        return err('validation', failure)
      case 'not_found':
        return err('not_found', 'Recensionen finns inte längre.')
    }
  } catch {
    return err('network', failure)
  }
}

/** Hide (`false`) or publish again (`true`). Setting the state a review already has succeeds. */
export function setReviewPublished(id: string, published: boolean): Promise<AdminResult<void>> {
  return moderate(
    'admin_set_review_published',
    { p_id: id, p_published: published },
    VISIBILITY_ERROR,
  )
}

/** Its booking is untouched and, while it exists, can be reviewed again. */
export function deleteReview(id: string): Promise<AdminResult<void>> {
  return moderate('admin_delete_review', { p_id: id }, DELETE_ERROR)
}
