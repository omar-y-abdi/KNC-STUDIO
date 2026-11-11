// The Profil tab's details form and work grid without effects.

import type { AdminStrings } from '../adminStrings'
import type { BarberProfileDetails, BarberWorkPhoto, ProfileSaveFailure } from '../types'

export const NAME_MAX = 60
/** 30 characters and one leading `@`, which the save drops. */
export const HANDLE_MAX = 31
export const BIO_MAX = 600

export function isDirty(loaded: BarberProfileDetails, current: BarberProfileDetails): boolean {
  return (
    loaded.name !== current.name ||
    loaded.ig !== current.ig ||
    loaded.tiktok !== current.tiktok ||
    loaded.bioSv !== current.bioSv ||
    loaded.bioEn !== current.bioEn
  )
}

export function saveFailureString(failure: ProfileSaveFailure): keyof AdminStrings {
  switch (failure) {
    case 'invalid_name':
      return 'profileNameInvalid'
    case 'invalid_handle':
      return 'profileHandleInvalid'
    case 'invalid_bio':
      return 'profileBioInvalid'
    case 'forbidden':
      return 'profileForbidden'
    case 'failed':
      return 'scheduleGridSaveError'
  }
}

export function bioCounter(bio: string): string {
  return `${bio.length} / ${BIO_MAX}`
}

export function workUploadingLabel(template: string, current: number, total: number): string {
  return template.replace('{current}', String(current)).replace('{total}', String(total))
}

/** A finished upload goes first, as the read lists newest first. */
export function withUploaded(
  work: readonly BarberWorkPhoto[],
  photo: BarberWorkPhoto,
): readonly BarberWorkPhoto[] {
  return [photo, ...work]
}

export function withoutWork(
  work: readonly BarberWorkPhoto[],
  id: string,
): readonly BarberWorkPhoto[] {
  return work.filter((photo) => photo.id !== id)
}

export function withHidden(
  work: readonly BarberWorkPhoto[],
  id: string,
  hidden: boolean,
): readonly BarberWorkPhoto[] {
  return work.map((photo) => (photo.id === id ? { ...photo, hidden } : photo))
}

/** Where focus goes once `id` is removed: the next picture, else the previous one, else null. */
export function focusAfterRemoval(work: readonly BarberWorkPhoto[], id: string): string | null {
  const index = work.findIndex((photo) => photo.id === id)
  if (index === -1) return null
  return work[index + 1]?.id ?? work[index - 1]?.id ?? null
}
