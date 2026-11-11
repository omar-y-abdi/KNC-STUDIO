// The Profil tab's pure form and work-grid helpers (profile-spec section 4).

import { describe, expect, it } from 'vitest'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import type {
  BarberProfileDetails,
  BarberWorkPhoto,
  ProfileSaveFailure,
} from '../../modules/staff-admin/src/types'
import {
  bioCounter,
  focusAfterRemoval,
  isDirty,
  saveFailureString,
  withHidden,
  withoutWork,
  withUploaded,
  workUploadingLabel,
} from '../../modules/staff-admin/src/views/profileForm'

const LOADED: BarberProfileDetails = {
  name: 'Hassan',
  ig: 'hassan.cuts',
  tiktok: '',
  bioSv: 'Fade och skägg.',
  bioEn: '',
}

const A: BarberWorkPhoto = { id: 'a', path: 'hassan/a.webp', hidden: false }
const B: BarberWorkPhoto = { id: 'b', path: 'hassan/b.webp', hidden: true }
const C: BarberWorkPhoto = { id: 'c', path: 'hassan/c.webp', hidden: false }
const WORK: readonly BarberWorkPhoto[] = [A, B, C]

describe('isDirty', () => {
  it('is clean while every field equals the loaded value', () => {
    expect(isDirty(LOADED, { ...LOADED })).toBe(false)
  })

  it.each(['name', 'ig', 'tiktok', 'bioSv', 'bioEn'] as const)(
    'is dirty once %s differs',
    (field) => {
      expect(isDirty(LOADED, { ...LOADED, [field]: `${LOADED[field]}x` })).toBe(true)
    },
  )
})

describe('saveFailureString', () => {
  const KEYS = [
    ['invalid_name', 'profileNameInvalid'],
    ['invalid_handle', 'profileHandleInvalid'],
    ['invalid_bio', 'profileBioInvalid'],
    ['forbidden', 'profileForbidden'],
    ['failed', 'scheduleGridSaveError'],
  ] as const satisfies readonly (readonly [ProfileSaveFailure, string])[]

  it.each(KEYS)('words %s with %s', (failure, key) => {
    expect(saveFailureString(failure)).toBe(key)
  })

  it.each([
    ['sv', 'profileNameInvalid', 'Ange ett namn på högst 60 tecken.'],
    ['en', 'profileNameInvalid', 'Enter a name of at most 60 characters.'],
    ['sv', 'profileBioInvalid', 'Texten får vara högst 600 tecken.'],
    ['en', 'profileBioInvalid', 'The text may be at most 600 characters.'],
    ['sv', 'scheduleGridSaveError', 'Kunde inte spara. Försök igen.'],
    ['en', 'scheduleGridSaveError', 'Could not save. Try again.'],
  ] as const)('the %s key %s reads as the spec says', (lang, key, text) => {
    expect(adminText(lang)[key]).toBe(text)
  })
})

describe('bioCounter', () => {
  it.each([
    ['', '0 / 600'],
    ['Fade.', '5 / 600'],
    ['x'.repeat(600), '600 / 600'],
  ])('counts %j as %s', (bio, label) => {
    expect(bioCounter(bio)).toBe(label)
  })
})

describe('workUploadingLabel', () => {
  it.each([
    ['sv', 'Laddar upp 2 av 5 …'],
    ['en', 'Uploading 2 of 5 …'],
  ] as const)('fills the %s template', (lang, label) => {
    expect(workUploadingLabel(adminText(lang).workUploading, 2, 5)).toBe(label)
  })
})

describe('work list', () => {
  it('puts a finished upload first and leaves the list it was given alone', () => {
    const uploaded: BarberWorkPhoto = { id: 'd', path: 'hassan/d.webp', hidden: false }
    expect(withUploaded(WORK, uploaded)).toEqual([uploaded, A, B, C])
    expect(WORK).toEqual([A, B, C])
  })

  it('removes only the named picture', () => {
    expect(withoutWork(WORK, 'b')).toEqual([A, C])
    expect(withoutWork(WORK, 'missing')).toEqual([A, B, C])
  })

  it('hides or shows only the named picture', () => {
    expect(withHidden(WORK, 'a', true)).toEqual([{ ...A, hidden: true }, B, C])
    expect(withHidden(WORK, 'b', false)).toEqual([A, { ...B, hidden: false }, C])
    expect(WORK).toEqual([A, B, C])
  })
})

describe('focusAfterRemoval', () => {
  it.each([
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'b'],
  ])('moves focus from %s to %s', (removed, next) => {
    expect(focusAfterRemoval(WORK, removed)).toBe(next)
  })

  it('has no picture to focus after the last one goes', () => {
    expect(focusAfterRemoval([A], 'a')).toBeNull()
  })

  it('has no picture to focus for an id it does not hold', () => {
    expect(focusAfterRemoval(WORK, 'missing')).toBeNull()
  })
})
