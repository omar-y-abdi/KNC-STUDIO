// Storage listing (checklist item 14b, migration 20261110120500_storage_public_listing).
//
// `gallery` and `barber-photos` are public buckets: an object is served to anyone who has its URL.
// Until that migration two row-level-security policies also let anyone holding the anon key list
// every object of both buckets. The policies are gone. This suite proves on the real Storage API:
//   (a) the public URL of an object in each bucket still answers 200 with the stored bytes, with no
//       credential at all, and
//   (b) neither the anon key nor a signed-in owner session gets a single row when listing a bucket.
// The service role lists the same folder and finds the object, so an empty listing for the client
// roles is a refusal and not a wrong folder name. A listing call that fails is never counted as a
// refusal: it fails the test.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  adminBackendReady,
  readAdminStackEnv,
  signedInClient,
  type AdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'

const BUCKETS = ['gallery', 'barber-photos'] as const
type Bucket = (typeof BUCKETS)[number]

/** Both buckets accept only `image/webp` up to 512 kB; this is a valid 1x1 lossless WebP. */
const WEBP_1X1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
const FOLDER = 'it-public-read'
const LOCAL_HOSTS = ['localhost', '127.0.0.1']

describe.skipIf(!adminBackendReady())('public Storage buckets (integration)', () => {
  let env: AdminStackEnv
  let service: SupabaseClient
  let anon: SupabaseClient
  let owner: SupabaseClient
  const fileNames = new Map<Bucket, string>()

  function fileNameIn(bucket: Bucket): string {
    const name = fileNames.get(bucket)
    if (name === undefined) throw new Error(`No object was uploaded to ${bucket}`)
    return name
  }

  /**
   * Names a client sees when it lists `prefix` of `bucket`.
   *
   * The Storage API answers a listing with 200 and the rows `storage.search` returns under the
   * caller's database role (supabase/storage: `routes/object/listObjects.ts`, `database/pg.ts`).
   * Row-level security hides rows from that query and raises nothing, so a role with no SELECT
   * policy gets an empty array and no error. Any error therefore means the call itself failed
   * (Storage down, wrong bucket name, bad key) and must not pass as "lists nothing": it throws.
   */
  async function listedNames(
    client: SupabaseClient,
    bucket: Bucket,
    prefix: string,
  ): Promise<readonly string[]> {
    const listed = await client.storage.from(bucket).list(prefix)
    if (listed.error !== null)
      throw new Error(`Listing ${bucket}/${prefix} failed: ${listed.error.message}`)
    return listed.data.map((entry) => entry.name)
  }

  beforeAll(async () => {
    const configured = readAdminStackEnv()
    if (
      configured === null ||
      !LOCAL_HOSTS.includes(new URL(configured.url).hostname) ||
      !LOCAL_HOSTS.includes(new URL(configured.dbUrl).hostname)
    )
      throw new Error(
        'The Storage integration suite writes objects; it runs against a local stack only.',
      )

    env = configured
    service = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } })
    anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } })
    owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)

    for (const bucket of BUCKETS) {
      const name = `${crypto.randomUUID()}.webp`
      const stored = await service.storage
        .from(bucket)
        .upload(`${FOLDER}/${name}`, WEBP_1X1, { contentType: 'image/webp' })
      if (stored.error !== null)
        throw new Error(`Upload to ${bucket} failed: ${stored.error.message}`)
      fileNames.set(bucket, name)
    }
  })

  afterAll(async () => {
    for (const [bucket, name] of fileNames) {
      const path = `${FOLDER}/${name}`
      const removed = await service.storage.from(bucket).remove([path])
      expect(removed.error).toBeNull()
      // The upload trigger registered the object in the media library; take that row out again.
      await withClient(env.dbUrl, (client) =>
        client.query('delete from public.cms_assets where bucket = $1 and path = $2', [
          bucket,
          path,
        ]),
      )
    }
  })

  it.each(BUCKETS)('serves an object of %s by its public URL, no credential', async (bucket) => {
    const path = `${FOLDER}/${fileNameIn(bucket)}`
    const url = anon.storage.from(bucket).getPublicUrl(path).data.publicUrl
    expect(url).toBe(`${env.url}/storage/v1/object/public/${bucket}/${path}`)

    const response = await fetch(url)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(WEBP_1X1)).toBe(true)
  })

  it.each(BUCKETS)('shows the uploaded object of %s to the service role', async (bucket) => {
    expect(await listedNames(service, bucket, FOLDER)).toContain(fileNameIn(bucket))
    expect(await listedNames(service, bucket, '')).toContain(FOLDER)
  })

  it.each(BUCKETS)('lists nothing of %s to the anon key', async (bucket) => {
    expect(await listedNames(anon, bucket, FOLDER)).toEqual([])
    expect(await listedNames(anon, bucket, '')).toEqual([])
  })

  it.each(BUCKETS)('lists nothing of %s to a signed-in owner session', async (bucket) => {
    expect(await listedNames(owner, bucket, FOLDER)).toEqual([])
    expect(await listedNames(owner, bucket, '')).toEqual([])
  })
})
