// Public-site DB ports ↔ live stack (ADMIN_SPEC §5 / §7). Drives the REAL public adapters
// (`supabaseBarbersAdapter`, `supabaseAboutContentAdapter`, `supabaseGalleryAdapter`, and the
// `available_slots` path of `supabaseBookingAdapter`) through the ANON RLS path — exactly how the
// browser reads them — and proves an owner's admin edits surface on the public side:
//   * BarbersPort returns the seeded ACTIVE roster, ordered; reflects an admin ADD and a HIDE.
//   * AboutContentPort returns the seeded `about_content`; reflects an owner EDIT (per language).
//   * GalleryPort returns rows with resolved public Storage URLs; empty when there are none.
//   * availability reflects a SCHEDULE (off-day ⇒ whole grid taken) AND a confirmed booking.
//
// Privileged setup/teardown uses the superuser (DB_URL) ONLY to write what RLS forbids anon (insert a
// barber, edit about_content, set schedules, insert a booking) and to clean up — the SAME plumbing
// the admin suite uses. The adapters themselves always go through the anon client.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { supabaseBarbersAdapter } from '../../src/booking/adapters/supabaseBarbers'
import { supabaseAboutContentAdapter } from '../../src/about/content/supabaseAboutContent'
import { supabaseGalleryAdapter } from '../../src/about/gallery/supabaseGallery'
import { supabaseBookingAdapter } from '../../src/booking/adapters/supabaseBooking'
import { asBarberId } from '../../src/booking/domain'
import {
  adminBackendReady,
  insertBookingRaw,
  readAdminStackEnv,
  restoreSeedState,
} from './_adminHelpers'
import type { AdminStackEnv } from './_adminHelpers'

/** The three seeded barbers (ADMIN_SPEC §1.2 seed). */
const SEED_IDS = ['hassan', 'victor', 'salman']

/**
 * Run a parameterized superuser statement (the only credential that may write these tables). This is
 * a `pg` query — NOT `child_process.exec`; the SQL is always a static literal and every dynamic value
 * is bound through a `$n` placeholder (no string interpolation), so there is no injection surface.
 */
async function runSql(env: AdminStackEnv, sql: string, params: readonly unknown[]): Promise<void> {
  const client = new Client({ connectionString: env.dbUrl })
  await client.connect()
  try {
    await client.query(sql, params)
  } finally {
    await client.end()
  }
}

/** Read one about_content cell via the superuser (to restore it after an edit). */
async function readAboutValue(
  env: AdminStackEnv,
  key: string,
  lang: string,
): Promise<string | null> {
  const client = new Client({ connectionString: env.dbUrl })
  await client.connect()
  try {
    const res = await client.query<{ value: string }>(
      'select value from public.about_content where key = $1 and lang = $2',
      [key, lang],
    )
    return res.rows[0]?.value ?? null
  } finally {
    await client.end()
  }
}

describe.skipIf(!adminBackendReady())('public-site DB ports (integration)', () => {
  beforeAll(() => {
    // Guarded by skipIf, but assert presence so a misconfigured run fails loudly, not silently.
    expect(readAdminStackEnv()).not.toBeNull()
  })

  // --- BarbersPort -------------------------------------------------------------------------------

  describe('BarbersPort.listActive', () => {
    const ADDED_ID = 'it-public-temp'

    afterEach(async () => {
      const env = readAdminStackEnv()
      if (!env) return
      // Remove any barber this block added + un-hide the seeded ones it may have toggled.
      await runSql(env, 'delete from public.barbers where id = $1', [ADDED_ID])
      await runSql(env, 'update public.barbers set active = true where id = any($1)', [SEED_IDS])
    })

    it('returns the seeded ACTIVE roster, ordered by sort_order', async () => {
      const roster = await supabaseBarbersAdapter.listActive()
      const ids = roster.map((r) => r.barber.id)
      // The three seeded barbers are all present and active.
      for (const id of SEED_IDS) expect(ids).toContain(asBarberId(id))
      // Each entry carries the About copy that rides along on the row (role/bio per language).
      const hassan = roster.find((r) => r.barber.id === asBarberId('hassan'))
      expect(hassan?.copy).not.toBeNull()
      expect(hassan?.copy?.bioSv.length ?? 0).toBeGreaterThan(0)
      expect(hassan?.copy?.bioEn.length ?? 0).toBeGreaterThan(0)
    })

    it('reflects an admin ADD (a new active barber appears)', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return

      await runSql(
        env,
        `insert into public.barbers (id, name, ig, role_sv, role_en, bio_sv, bio_en, active, sort_order)
         values ($1, 'IT Temp', 'it_temp', 'Barberare', 'Barber', 'sv bio', 'en bio', true, 99)`,
        [ADDED_ID],
      )

      const roster = await supabaseBarbersAdapter.listActive()
      const ids = roster.map((r) => r.barber.id)
      expect(ids).toContain(asBarberId(ADDED_ID))
      const added = roster.find((r) => r.barber.id === asBarberId(ADDED_ID))
      expect(added?.barber.name).toBe('IT Temp')
      // sort_order 99 ⇒ it sorts AFTER the seeded barbers (sort_order 0..n).
      expect(ids[ids.length - 1]).toBe(asBarberId(ADDED_ID))
    })

    it('reflects an admin HIDE (active=false drops a barber from the public roster)', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return

      await runSql(env, 'update public.barbers set active = false where id = $1', ['salman'])
      const roster = await supabaseBarbersAdapter.listActive()
      const ids = roster.map((r) => r.barber.id)
      expect(ids).not.toContain(asBarberId('salman'))
      // The others remain.
      expect(ids).toContain(asBarberId('hassan'))
      expect(ids).toContain(asBarberId('victor'))
    })
  })

  // --- AboutContentPort --------------------------------------------------------------------------

  describe('AboutContentPort.overlay', () => {
    it('returns the seeded about_content for a language (the 7 editable keys)', async () => {
      const overlay = await supabaseAboutContentAdapter.overlay('sv')
      // The seed populates every key; the overlay should carry them all.
      expect(typeof overlay.eyebrow).toBe('string')
      expect(typeof overlay.heading).toBe('string')
      expect(typeof overlay.intro).toBe('string')
      expect((overlay.intro ?? '').length).toBeGreaterThan(0)
    })

    it('reflects an owner EDIT of a cell (per language)', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return

      const original = await readAboutValue(env, 'heading', 'en')
      const edited = `IT edited heading ${Date.now()}`
      try {
        await runSql(
          env,
          `insert into public.about_content (key, lang, value) values ('heading', 'en', $1)
           on conflict (key, lang) do update set value = excluded.value`,
          [edited],
        )
        const overlay = await supabaseAboutContentAdapter.overlay('en')
        expect(overlay.heading).toBe(edited)
        // The sv overlay is unaffected by an en edit.
        const sv = await supabaseAboutContentAdapter.overlay('sv')
        expect(sv.heading).not.toBe(edited)
      } finally {
        // Restore the original value so the suite stays idempotent.
        if (original !== null) {
          await runSql(
            env,
            `insert into public.about_content (key, lang, value) values ('heading', 'en', $1)
             on conflict (key, lang) do update set value = excluded.value`,
            [original],
          )
        }
      }
    })
  })

  // --- GalleryPort -------------------------------------------------------------------------------

  describe('GalleryPort.list', () => {
    afterEach(async () => {
      const env = readAdminStackEnv()
      if (env) await runSql(env, 'delete from public.gallery_images', [])
    })

    it('returns an empty list when there are no rows (⇒ placeholder fallback)', async () => {
      const env = readAdminStackEnv()
      if (env) await runSql(env, 'delete from public.gallery_images', [])
      const salon = await supabaseGalleryAdapter.list('salon')
      expect(salon).toEqual([])
    })

    it('returns rows for a kind with resolved public Storage URLs, ordered', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return

      await runSql(
        env,
        `insert into public.gallery_images (kind, storage_path, alt, sort_order) values
           ('salon', 'salon/it-a.jpg', 'A', 1),
           ('salon', 'salon/it-b.jpg', 'B', 0),
           ('cuts',  'cuts/it-c.jpg',  'C', 0)`,
        [],
      )

      const salon = await supabaseGalleryAdapter.list('salon')
      expect(salon.length).toBe(2)
      // Ordered by sort_order ⇒ B (0) before A (1).
      expect(salon[0]?.alt).toBe('B')
      expect(salon[1]?.alt).toBe('A')
      // Public URL points at the gallery bucket + the row's path.
      expect(salon[0]?.url).toContain('/storage/v1/object/public/gallery/salon/it-b.jpg')

      const cuts = await supabaseGalleryAdapter.list('cuts')
      expect(cuts.length).toBe(1)
      expect(cuts[0]?.alt).toBe('C')
    })
  })

  // --- availability (available_slots) ------------------------------------------------------------

  describe('availability via available_slots', () => {
    afterEach(async () => {
      const env = readAdminStackEnv()
      if (env) await restoreSeedState(env)
    })

    it('a working day with no bookings has the full packed grid AVAILABLE', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return
      await restoreSeedState(env) // ensure Mon–Sat 09–18 seed

      // 2040-03-14 is a Wednesday (working under the seed). No bookings ⇒ the full 15-min-grid packed
      // set is available: a 45-min service fits at every quarter-hour from 09:00 whose window ends by
      // 18:00 (last start 17:15 → 17:15 + 45 = 18:00), i.e. 09:00, 09:15, …, 17:15 (34 starts).
      const available = await supabaseBookingAdapter.availability({
        barberId: asBarberId('hassan'),
        dateIso: '2040-03-14',
        durationMin: 45,
      })
      expect(available).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
        '11:45',
        '12:00',
        '12:15',
        '12:30',
        '12:45',
        '13:00',
        '13:15',
        '13:30',
        '13:45',
        '14:00',
        '14:15',
        '14:30',
        '14:45',
        '15:00',
        '15:15',
        '15:30',
        '15:45',
        '16:00',
        '16:15',
        '16:30',
        '16:45',
        '17:00',
        '17:15',
      ])
    })

    it('reflects a confirmed booking (the booked slot drops out of the available set)', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return
      await restoreSeedState(env)

      const dateIso = '2040-03-14'
      const time = '13:30'
      const [y, m, d] = dateIso.split('-').map(Number)
      const [hh, mm] = time.split(':').map(Number)
      const start = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)
      await insertBookingRaw(env, 'hassan', start, 45)

      const available = await supabaseBookingAdapter.availability({
        barberId: asBarberId('hassan'),
        dateIso,
        durationMin: 45,
      })
      expect(available).not.toContain(time)
    })

    it('an OFF day (no working schedule) ⇒ no times are available', async () => {
      const env = readAdminStackEnv()
      expect(env).not.toBeNull()
      if (!env) return
      await restoreSeedState(env)

      // Make Wednesday (weekday 3) non-working for hassan, then query that day.
      await runSql(
        env,
        'update public.barber_schedules set working = false where barber_id = $1 and weekday = 3',
        ['hassan'],
      )
      const available = await supabaseBookingAdapter.availability({
        barberId: asBarberId('hassan'),
        dateIso: '2040-03-14', // a Wednesday
        durationMin: 45,
      })
      // available_slots returns nothing on a non-working day ⇒ the available set is empty.
      expect(available).toEqual([])
    })
  })

  afterAll(async () => {
    const env = readAdminStackEnv()
    if (env) await restoreSeedState(env)
  })
})
