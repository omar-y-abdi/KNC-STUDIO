// Tutorial progress of the signed-in staff account through its two own-row RPCs. Every failure is
// `TOUR_PROGRESS_FAILED`: the tutorial fails soft, so the UI treats all failures alike.

import { getAdminClient } from '../adminClient'
import { ownStaffTourProgressRows, parseWith } from '../adminSchemas'
import { FRESH_PROGRESS, TOUR_IDS, type TourProgress } from '../tour/tourModel'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

export interface TourProgressPort {
  readonly read: () => Promise<AdminResult<TourProgress>>
  readonly write: (progress: TourProgress) => Promise<AdminResult<void>>
}

export const TOUR_PROGRESS_FAILED: AdminResult<never> = err(
  'network',
  'Tutorialen kunde inte läsas eller sparas.',
)

async function readTourProgress(): Promise<AdminResult<TourProgress>> {
  try {
    const { data, error } = await getAdminClient().rpc('own_staff_tour_progress')
    if (error !== null) return TOUR_PROGRESS_FAILED
    const parsed = parseWith(ownStaffTourProgressRows, data)
    if (!parsed.ok) return TOUR_PROGRESS_FAILED
    const row = parsed.value[0]
    if (row === undefined) return ok(FRESH_PROGRESS)
    return ok({
      seen: new Set(TOUR_IDS.filter((id) => row.seen.includes(id))),
      removed: row.removed,
    })
  } catch {
    return TOUR_PROGRESS_FAILED
  }
}

async function writeTourProgress(progress: TourProgress): Promise<AdminResult<void>> {
  try {
    const { error } = await getAdminClient().rpc('set_own_staff_tour_progress', {
      p_seen: TOUR_IDS.filter((id) => progress.seen.has(id)),
      p_removed: progress.removed,
    })
    return error === null ? ok(undefined) : TOUR_PROGRESS_FAILED
  } catch {
    return TOUR_PROGRESS_FAILED
  }
}

export const tourProgressPort: TourProgressPort = {
  read: readTourProgress,
  write: writeTourProgress,
}
