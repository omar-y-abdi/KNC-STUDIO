// Admin integration — the OWNER role (ADMIN_SPEC §7). Signs the shared admin client in as the
// seeded owner and drives the REAL admin adapters end to end:
//   * manage barbers: create, edit, toggle active (and the new row is readable).
//   * edit about_content (upsert a cell, read it back).
//   * gallery: upload an image to Storage + insert its row, then delete (row + object) — proving the
//     owner-only Storage write policy and the row<->object lifecycle.
//   * cancel ANY barber's booking via admin_cancel_booking.
//   * available_slots reflects a schedule edit AND a time-off block (the public availability the
//     booking flow consumes).
//
// Browser path: anon key + signInWithPassword, so RLS sees role='owner'. Mutations to the shared
// seeded tables are restored after each test (and created barbers/gallery objects are cleaned up).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getAdminClient } from '../../src/admin/adminClient'
import {
  createBarber,
  listBarbers,
  setBarberActive,
  updateBarber,
} from '../../src/admin/adapters/barbersAdmin'
import { listAbout, saveAbout } from '../../src/admin/adapters/aboutAdmin'
import { deleteImage, listGallery, uploadImage } from '../../src/admin/adapters/galleryAdmin'
import {
  removeBarberPhoto,
  uploadBarberPhoto,
} from '../../src/admin/adapters/barberPhotoAdmin'
import { availableSlotsFor, readWeek, saveWeek } from '../../src/admin/adapters/schedulesAdmin'
import { addTimeOff } from '../../src/admin/adapters/timeOffAdmin'
import { cancelBooking } from '../../src/admin/adapters/bookingsAdmin'
import { setDayHours } from '../../src/admin/time'
import { Client } from 'pg'
import {
  OTHER_BARBER_ID,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  adminBackendReady,
  bookingStatusRaw,
  insertBookingRaw,
  readAdminStackEnv,
  restoreSeedState,
} from './_adminHelpers'

/** A tiny valid 1x1 PNG (transparent), enough for a real Storage upload + public URL fetch. */
const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII='

function pngFile(name: string): File {
  const bin = atob(PNG_1x1_BASE64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'image/png' })
}

/** Delete a barber row directly (superuser) — for cleaning up a created test barber. */
async function deleteBarberRaw(dbUrl: string, id: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('delete from public.barbers where id = $1', [id])
  } finally {
    await client.end()
  }
}

const TEST_BARBER_ID = 'it-temp-barber'

describe.skipIf(!adminBackendReady())('admin adapters — owner role (integration)', () => {
  beforeAll(async () => {
    const { error } = await getAdminClient().auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    })
    if (error !== null) throw new Error(`owner sign-in failed: ${error.message}`)
  })

  afterAll(async () => {
    await getAdminClient().auth.signOut()
  })

  beforeEach(async () => {
    const env = readAdminStackEnv()
    if (env) {
      await restoreSeedState(env)
      await deleteBarberRaw(env.dbUrl, TEST_BARBER_ID)
    }
  })

  afterEach(async () => {
    const env = readAdminStackEnv()
    if (env) {
      await restoreSeedState(env)
      await deleteBarberRaw(env.dbUrl, TEST_BARBER_ID)
    }
  })

  it('creates, edits and toggles a barber', async () => {
    const created = await createBarber({
      id: TEST_BARBER_ID,
      name: 'Temp',
      ig: 'temp_ig',
      roleSv: 'Barberare',
      roleEn: 'Barber',
      bioSv: 'Bio sv',
      bioEn: 'Bio en',
      sortOrder: 99,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.id).toBe(TEST_BARBER_ID)
    expect(created.value.active).toBe(true)

    // Edit name + ig.
    const edited = await updateBarber(TEST_BARBER_ID, {
      name: 'Temp Renamed',
      ig: 'temp_ig2',
      roleSv: 'Mästarbarberare',
      roleEn: 'Master barber',
      bioSv: 'Bio sv 2',
      bioEn: 'Bio en 2',
      active: true,
      sortOrder: 50,
    })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.value.name).toBe('Temp Renamed')

    // Toggle inactive, then confirm the owner still sees it (owner sees inactive too).
    const toggled = await setBarberActive(TEST_BARBER_ID, false)
    expect(toggled.ok).toBe(true)

    const list = await listBarbers()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const found = list.value.find((b) => b.id === TEST_BARBER_ID)
    expect(found).toBeDefined()
    expect(found?.active).toBe(false)
  })

  it('edits about_content (upsert + read back)', async () => {
    const marker = `IT intro ${Date.now()}`
    const saved = await saveAbout('intro', 'sv', marker)
    expect(saved.ok).toBe(true)

    const all = await listAbout()
    expect(all.ok).toBe(true)
    if (!all.ok) return
    const cell = all.value.find((r) => r.key === 'intro' && r.lang === 'sv')
    expect(cell?.value).toBe(marker)
  })

  it('uploads and deletes a gallery image (Storage write + row lifecycle)', async () => {
    const alt = `IT salon ${Date.now()}`
    const uploaded = await uploadImage('salon', pngFile('it.png'), alt, 0)
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    expect(uploaded.value.kind).toBe('salon')
    expect(uploaded.value.url).toContain('/storage/v1/object/public/gallery/')

    // The public URL actually serves the object (public-read bucket).
    const head = await fetch(uploaded.value.url, { method: 'GET' })
    expect(head.ok).toBe(true)

    // It appears in the listing.
    const listed = await listGallery('salon')
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.some((i) => i.id === uploaded.value.id)).toBe(true)

    // Delete removes the row AND the object.
    const removed = await deleteImage(uploaded.value)
    expect(removed.ok).toBe(true)
    const after = await listGallery('salon')
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.value.some((i) => i.id === uploaded.value.id)).toBe(false)
    // The object 404s after delete.
    const gone = await fetch(uploaded.value.url, { method: 'GET' })
    expect(gone.ok).toBe(false)
  })

  it('uploads a barber profile as a valid public WebP and removes it', async () => {
    const uploaded = await uploadBarberPhoto(OTHER_BARBER_ID, pngFile('it-profile.png'))
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return

    try {
      expect(uploaded.value.url).toContain('/storage/v1/object/public/barber-photos/')

      const response = await fetch(uploaded.value.url)
      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('image/webp')
      const bytes = new Uint8Array(await response.arrayBuffer())
      expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
      expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WEBP')
    } finally {
      const removed = await removeBarberPhoto(OTHER_BARBER_ID, uploaded.value.storagePath)
      expect(removed.ok).toBe(true)
    }
  })

  it('cancels ANY barber’s booking', async () => {
    const env = readAdminStackEnv()
    if (env === null) return
    const id = await insertBookingRaw(env, OTHER_BARBER_ID, new Date(2030, 10, 3, 9, 0), 45)
    const result = await cancelBooking(id)
    expect(result.ok).toBe(true)
    expect(await bookingStatusRaw(env, id)).toBe('cancelled')
  })

  it('available_slots reflects a schedule edit', async () => {
    // 2030-08-12 is a Monday. Default week: Monday works 09:00–18:00 -> all 12 slots fit a 45-min cut.
    const date = '2030-08-12'

    const before = await availableSlotsFor(OTHER_BARBER_ID, date, 45)
    expect(before.ok).toBe(true)
    if (!before.ok) return
    expect(before.value).toContain('09:00')
    expect(before.value).toContain('17:15')

    // Shrink Monday to 12:00–15:00; now only the slots inside that window remain.
    const week = await readWeek(OTHER_BARBER_ID)
    expect(week.ok).toBe(true)
    if (!week.ok) return
    const edited = setDayHours(week.value, 1, 720, 900) // 12:00–15:00
    const saved = await saveWeek(OTHER_BARBER_ID, edited)
    expect(saved.kind).toBe('ok')

    const after = await availableSlotsFor(OTHER_BARBER_ID, date, 45)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.value).not.toContain('09:00')
    expect(after.value).not.toContain('17:15')
    expect(after.value).toContain('12:00')
    // 14:15 + 45min = 15:00 == end -> fits; 15:00 start would end 15:45 > 15:00 -> excluded.
    expect(after.value).toContain('14:15')
    expect(after.value).not.toContain('15:00')
  })

  it('available_slots is empty on a time-off day', async () => {
    const date = '2030-08-19' // Monday (working by default)
    const block = await addTimeOff(OTHER_BARBER_ID, date, date, 'IT off')
    expect(block.kind).toBe('ok')

    const slots = await availableSlotsFor(OTHER_BARBER_ID, date, 45)
    expect(slots.ok).toBe(true)
    if (!slots.ok) return
    expect(slots.value.length).toBe(0)
  })
})
