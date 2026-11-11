// A barber's own name, handles, bios and work pictures: the `staff_*` profile functions and the
// `barber_work` kind of upload-image. Anything unexpected is `failed`; nothing throws.

import { getAdminClient } from '../adminClient'
import {
  parseWith,
  staffBarberProfileResponse,
  staffSetBarberWorkPhotoHiddenResponse,
  staffUpdateBarberProfileResponse,
  type BarberProfileFields,
} from '../adminSchemas'
import { orderedAdminOperation } from '../orderedOperations'
import type {
  AdminBarberId,
  BarberProfileDetails,
  BarberSelfProfile,
  BarberWorkPhoto,
  ProfileResult,
  ProfileSaveFailure,
} from '../types'
import { ok } from '../types'
import { removeBarberWork, uploadBarberWork } from './barberPhotoAdmin'

export interface BarberProfilePort {
  readonly read: (
    barberId: AdminBarberId,
  ) => Promise<ProfileResult<BarberSelfProfile, 'forbidden' | 'failed'>>
  readonly save: (
    barberId: AdminBarberId,
    details: BarberProfileDetails,
  ) => Promise<ProfileResult<BarberProfileDetails, ProfileSaveFailure>>
  readonly uploadWork: (
    barberId: AdminBarberId,
    file: File,
  ) => Promise<ProfileResult<BarberWorkPhoto, 'failed'>>
  readonly removeWork: (
    barberId: AdminBarberId,
    path: string,
  ) => Promise<ProfileResult<void, 'failed'>>
  readonly setWorkHidden: (id: string, hidden: boolean) => Promise<ProfileResult<void, 'failed'>>
}

export const PROFILE_FAILED = { ok: false, error: 'failed' } as const

function done<T>(value: T): ProfileResult<T, never> {
  return { ok: true, value }
}

function toDetails(row: BarberProfileFields): BarberProfileDetails {
  return { name: row.name, ig: row.ig, tiktok: row.tiktok, bioSv: row.bio_sv, bioEn: row.bio_en }
}

async function read(
  barberId: AdminBarberId,
): Promise<ProfileResult<BarberSelfProfile, 'forbidden' | 'failed'>> {
  try {
    const { data, error } = await getAdminClient().rpc('staff_barber_profile', {
      p_barber_id: barberId,
    })
    if (error !== null) return PROFILE_FAILED
    const parsed = parseWith(staffBarberProfileResponse, data)
    if (!parsed.ok) return PROFILE_FAILED
    const answer = parsed.value
    if (!answer.ok)
      return answer.error === 'forbidden' ? { ok: false, error: 'forbidden' } : PROFILE_FAILED
    return done({
      details: toDetails(answer.profile),
      work: answer.work.map((photo) => ({ id: photo.id, path: photo.path, hidden: photo.hidden })),
    })
  } catch {
    return PROFILE_FAILED
  }
}

async function save(
  barberId: AdminBarberId,
  details: BarberProfileDetails,
): Promise<ProfileResult<BarberProfileDetails, ProfileSaveFailure>> {
  try {
    const { data, error } = await getAdminClient().rpc('staff_update_barber_profile', {
      p_barber_id: barberId,
      p_name: details.name,
      p_ig: details.ig,
      p_tiktok: details.tiktok,
      p_bio_sv: details.bioSv,
      p_bio_en: details.bioEn,
    })
    if (error !== null) return PROFILE_FAILED
    const parsed = parseWith(staffUpdateBarberProfileResponse, data)
    if (!parsed.ok) return PROFILE_FAILED
    const answer = parsed.value
    if (answer.ok) return done(toDetails(answer.profile))
    return answer.error === 'not_found' ? PROFILE_FAILED : { ok: false, error: answer.error }
  } catch {
    return PROFILE_FAILED
  }
}

async function uploadWork(
  barberId: AdminBarberId,
  file: File,
): Promise<ProfileResult<BarberWorkPhoto, 'failed'>> {
  const result = await uploadBarberWork(barberId, file)
  return result.ok
    ? done({ id: result.value.id, path: result.value.path, hidden: false })
    : PROFILE_FAILED
}

async function removeWork(
  barberId: AdminBarberId,
  path: string,
): Promise<ProfileResult<void, 'failed'>> {
  return (await removeBarberWork(barberId, path)).ok ? done(undefined) : PROFILE_FAILED
}

async function setWorkHidden(id: string, hidden: boolean): Promise<ProfileResult<void, 'failed'>> {
  try {
    const { data, error } = await getAdminClient().rpc('staff_set_barber_work_photo_hidden', {
      p_id: id,
      p_hidden: hidden,
    })
    if (error !== null) return PROFILE_FAILED
    const parsed = parseWith(staffSetBarberWorkPhotoHiddenResponse, data)
    return parsed.ok && parsed.value.ok ? done(undefined) : PROFILE_FAILED
  } catch {
    return PROFILE_FAILED
  }
}

export const barberProfilePort: BarberProfilePort = {
  read,
  save,
  uploadWork,
  removeWork,
  setWorkHidden,
}

/**
 * Runs `operation` after the barber's earlier profile reads and writes, like the photo card's
 * `photo:<id>` queue; a session that ended meanwhile is `failed`.
 */
export function orderedProfileOperation<T, E extends string>(
  barberId: AdminBarberId,
  operation: () => Promise<ProfileResult<T, E>>,
): Promise<ProfileResult<T, E | 'failed'>> {
  return orderedAdminOperation(`profile:${barberId}`, () => operation().then(ok)).then((queued) =>
    queued.ok ? queued.value : PROFILE_FAILED,
  )
}
