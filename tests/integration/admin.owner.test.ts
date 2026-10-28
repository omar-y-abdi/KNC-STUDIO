// Admin integration — the OWNER role (ADMIN_SPEC §7). Signs the shared admin client in as the
// seeded owner and drives the REAL admin adapters end to end:
//   * manage barbers: create, edit, toggle active (and the new row is readable).
//   * reject direct content writes; publish through CMS while cancellation stays operational.
//   * gallery: upload a CMS asset, publish and remove its placement, retaining registered bytes.
//   * cancel ANY barber's booking via admin_cancel_booking.
//   * available_slots reflects a schedule edit AND a time-off block (the public availability the
//     booking flow consumes).
//
// Browser path: anon key + signInWithPassword, so RLS sees role='owner'. Mutations to the shared
// seeded tables are restored after each test. Registered CMS media stays in the library.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { getAdminClient } from '../../src/admin/adminClient'
import {
  createBarber,
  listBarbers,
  setBarberActive,
  updateBarber,
} from '../../src/admin/adapters/barbersAdmin'
import { removeBarberPhoto, uploadBarberPhoto } from '../../src/admin/adapters/barberPhotoAdmin'
import { availableSlotsFor, readWeek, saveWeek } from '../../src/admin/adapters/schedulesAdmin'
import { addTimeOff } from '../../src/admin/adapters/timeOffAdmin'
import { cancelBooking } from '../../src/admin/adapters/bookingsAdmin'
import { saveSiteSetting } from '../../src/admin/adapters/siteAdmin'
import { setDayHours } from '../../src/admin/time'
import { validateDocument, type CmsDocument, type CmsState } from '../../shared/cms'
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

async function readCmsState(): Promise<CmsState> {
  const result = await getAdminClient().functions.invoke('cms-studio', {
    body: { operation: 'state' },
  })
  expect(result.error).toBeNull()
  const value = result.data as CmsState
  validateDocument(value.document)
  return value
}

async function publishCms(base: CmsState, document: CmsDocument): Promise<void> {
  const result = await getAdminClient().functions.invoke('cms-studio', {
    body: {
      operation: 'publish',
      baseRevision: base.revision,
      baseFingerprint: base.fingerprint,
      requestId: crypto.randomUUID(),
      document,
    },
  })
  const detail =
    result.error instanceof FunctionsHttpError
      ? JSON.stringify({
          status: result.error.context.status,
          body: await result.error.context.clone().json(),
        })
      : result.error?.message
  expect(result.error, detail).toBeNull()
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

  it('requires CMS publication for content and preserves operational cancellation writes', async () => {
    const marker = `IT CMS authority ${Date.now()}`
    const client = getAdminClient()
    const base = await readCmsState()
    const cancellation = await client
      .from('site_settings')
      .select('value')
      .eq('key', 'cancellation_policy_hours')
      .maybeSingle()
    expect(cancellation.error).toBeNull()
    try {
      const siteWrite = await client
        .from('site_content')
        .upsert({ key: 'kicker', lang: 'sv', value: 'Bypass' })
      expect(siteWrite.error?.code).toBe('42501')
      const aboutWrite = await client
        .from('about_content')
        .upsert({ key: 'intro', lang: 'sv', value: 'Bypass' })
      expect(aboutWrite.error?.code).toBe('42501')
      const emailWrite = await client.from('email_templates').upsert({
        template: 'customer_confirmation',
        lang: 'sv',
        subject: 'Bypass',
        preheader: 'Preheader',
        title: 'Title',
        intro: 'Intro',
        note: 'Note',
        cta_label: 'Open',
      })
      expect(emailWrite.error?.code).toBe('42501')
      const settingWrite = await client
        .from('site_settings')
        .upsert({ key: 'business_name', value: 'Bypass' })
      expect(settingWrite.error?.code).toBe('42501')
      const denied = await readCmsState()
      expect(denied.fingerprint).toBe(base.fingerprint)
      expect(denied.revision).toBe(base.revision)

      await expect(saveSiteSetting('cancellation_policy_hours', '48')).resolves.toEqual({
        ok: true,
        value: '48',
      })
      const operational = await readCmsState()
      expect(operational.fingerprint).toBe(base.fingerprint)
      expect(operational.revision).toBe(base.revision)
      expect(operational.document.settings).not.toHaveProperty('cancellation_policy_hours')
      const document = structuredClone(operational.document)
      // Edit an existing override: a newly added key becomes required by complete-document
      // validation and cannot be removed by publishing the original document during cleanup.
      expect(document.site.confirmSent?.sv).toBeTypeOf('string')
      document.site.confirmSent = { ...document.site.confirmSent, sv: marker }
      document.about.intro = { ...document.about.intro, sv: marker }
      document.settings.business_name = marker
      document.emails = document.emails.map((email) =>
        email.template === 'customer_confirmation' && email.lang === 'sv'
          ? { ...email, subject: marker }
          : email,
      )
      await publishCms(operational, document)
      const published = await readCmsState()
      expect(published.revision).toBe(base.revision + 1)
      const site = await client
        .from('site_content')
        .select('value')
        .eq('key', 'confirmSent')
        .eq('lang', 'sv')
        .single()
      const about = await client
        .from('about_content')
        .select('value')
        .eq('key', 'intro')
        .eq('lang', 'sv')
        .single()
      const email = await client
        .from('email_templates')
        .select('subject')
        .eq('template', 'customer_confirmation')
        .eq('lang', 'sv')
        .single()
      const settings = await client
        .from('site_settings')
        .select('key,value')
        .in('key', ['business_name', 'cancellation_policy_hours'])
      expect([site.error, about.error, email.error, settings.error]).toEqual([
        null,
        null,
        null,
        null,
      ])
      expect(site.data?.value).toBe(marker)
      expect(about.data?.value).toBe(marker)
      expect(email.data?.subject).toBe(marker)
      expect(new Map(settings.data?.map((row) => [row.key, row.value]))).toEqual(
        new Map([
          ['business_name', marker],
          ['cancellation_policy_hours', '48'],
        ]),
      )
    } finally {
      const latest = await readCmsState()
      if (latest.fingerprint !== base.fingerprint) {
        await publishCms(latest, base.document)
        expect((await readCmsState()).fingerprint).toBe(base.fingerprint)
      }
      if (cancellation.data) {
        const restored = await saveSiteSetting('cancellation_policy_hours', cancellation.data.value)
        expect(restored.ok).toBe(true)
      } else {
        const removed = await client
          .from('site_settings')
          .delete()
          .eq('key', 'cancellation_policy_hours')
        expect(removed.error).toBeNull()
      }
    }
  })

  it('uploads and removes a gallery placement through CMS while retaining media bytes', async () => {
    const form = new FormData()
    form.set('kind', 'cms_asset')
    form.set('purpose', 'salon')
    form.set('file', pngFile('it.png'))
    const uploadedResponse = await getAdminClient().functions.invoke('upload-image', { body: form })
    expect(uploadedResponse.error).toBeNull()
    const uploaded = uploadedResponse.data as {
      asset: { id: string; bucket: 'gallery'; path: string }
    }
    expect(uploaded.asset.bucket).toBe('gallery')
    expect(uploaded.asset.path).toMatch(/^salon\/[0-9a-f-]+\.webp$/)
    const url = getAdminClient()
      .storage.from(uploaded.asset.bucket)
      .getPublicUrl(uploaded.asset.path).data.publicUrl

    // The public URL actually serves the object (public-read bucket).
    const head = await fetch(url)
    expect(head.ok).toBe(true)

    const galleryIds = async (): Promise<readonly string[]> => {
      const listed = await getAdminClient().from('gallery_images').select('id').eq('kind', 'salon')
      expect(listed.error).toBeNull()
      return (listed.data ?? []).map((row) => row.id)
    }
    const id = crypto.randomUUID()
    const base = await readCmsState()
    expect(base.assets.some((asset) => asset.id === uploaded.asset.id)).toBe(true)
    expect(await galleryIds()).not.toContain(id)
    const document = structuredClone(base.document)
    document.gallery.push({
      id,
      kind: 'salon',
      storage_path: uploaded.asset.path,
      alt: 'IT salon',
      sort_order: document.gallery.length,
    })
    try {
      await publishCms(base, document)
      expect(await galleryIds()).toContain(id)
    } finally {
      const latest = await readCmsState()
      if (latest.document.gallery.some((image) => image.id === id)) {
        const cleaned = structuredClone(latest.document)
        cleaned.gallery = cleaned.gallery.filter((image) => image.id !== id)
        await publishCms(latest, cleaned)
      }
    }
    expect(await galleryIds()).not.toContain(id)
    const retained = await fetch(url)
    expect(retained.ok).toBe(true)
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
