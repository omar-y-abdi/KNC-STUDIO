// Service ordering integration — two authenticated clients exercise the real RPC boundary at the
// same time. The assertions read back through the local superuser only to verify the invariant;
// production code never has this credential.

import { describe, expect, it } from 'vitest'
import {
  signedInClient,
  BARBER_LINK_ID,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  adminBackendReady,
  readAdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'

describe.skipIf(!adminBackendReady())('service ordering RPC (integration)', () => {
  it('serializes concurrent appends and reorders without gaps or duplicate positions', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const first = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
    const second = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const names = [`Ordering A ${suffix}`, `Ordering B ${suffix}`]
    const createdIds: string[] = []

    try {
      const beforeCreate = await readPositions(env.dbUrl, BARBER_LINK_ID)
      const created = await Promise.all(
        names.map((name, index) =>
          (index === 0 ? first : second).rpc('admin_create_service', {
            p_barber_id: BARBER_LINK_ID,
            p_name: name,
            p_price: 100 + index,
            p_duration_min: 45,
            p_active: true,
            p_available_weekdays: [0, 1, 2, 3, 4, 5, 6],
          }),
        ),
      )

      for (const response of created) {
        const id = response.data?.row?.id
        if (typeof id !== 'string') throw new Error('Concurrent service creation returned no id')
        createdIds.push(id)
      }
      expect(created.every(({ error, data }) => error === null && data?.ok === true)).toBe(true)

      const afterCreate = await readRows(env.dbUrl, names)
      expect(afterCreate.map((row) => row.sort_order)).toEqual([
        beforeCreate.length,
        beforeCreate.length + 1,
      ])
      expect(afterCreate.map((row) => row.id)).toEqual(expect.arrayContaining(createdIds))
      expect(await readPositions(env.dbUrl, BARBER_LINK_ID)).toEqual(
        Array.from({ length: beforeCreate.length + 2 }, (_, index) => index),
      )

      const firstId = createdIds[0]
      if (firstId === undefined) throw new Error('Concurrent service creation returned no first id')

      const reordered = await Promise.all(
        createdIds.map((id, index) =>
          (index === 0 ? first : second).rpc('admin_reorder_service', {
            p_barber_id: BARBER_LINK_ID,
            p_service_id: id,
            p_direction: -1,
          }),
        ),
      )
      expect(reordered.every(({ error, data }) => error === null && data?.ok === true)).toBe(true)
      expect(await readPositions(env.dbUrl, BARBER_LINK_ID)).toEqual(
        Array.from({ length: beforeCreate.length + 2 }, (_, index) => index),
      )

      const beforeInvalid = await readRows(env.dbUrl, names)
      const invalid = await first.rpc('admin_reorder_service', {
        p_barber_id: BARBER_LINK_ID,
        p_service_id: firstId,
        p_direction: 0,
      })
      expect(invalid.error).toBeNull()
      expect(invalid.data).toMatchObject({ ok: false, error: 'invalid' })
      expect(await readRows(env.dbUrl, names)).toEqual(beforeInvalid)
    } finally {
      for (const id of createdIds) {
        await first.rpc('admin_delete_service', { p_id: id })
      }
    }
  })
})

interface ServicePosition {
  readonly id: string
  readonly sort_order: number
}

async function readRows(
  dbUrl: string,
  names: readonly string[],
): Promise<readonly ServicePosition[]> {
  return withClient(dbUrl, async (client) => {
    const result = await client.query<ServicePosition>(
      `select id::text, sort_order
         from public.services
        where barber_id = $1 and name = any($2::text[])
        order by sort_order`,
      [BARBER_LINK_ID, names],
    )
    return result.rows
  })
}

async function readPositions(dbUrl: string, barberId: string): Promise<readonly number[]> {
  return withClient(dbUrl, async (client) => {
    const result = await client.query<{ sort_order: number }>(
      'select sort_order from public.services where barber_id = $1 order by sort_order',
      [barberId],
    )
    return result.rows.map((row) => row.sort_order)
  })
}
