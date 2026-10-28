import { z } from 'zod'

const barberId = z.string().regex(/^[a-z0-9-]{1,32}$/)

export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set_access'), barber_id: barberId, enabled: z.boolean() }).strict(),
  z
    .object({ action: z.literal('delete'), barber_id: barberId, purge_bookings: z.boolean() })
    .strict(),
])
