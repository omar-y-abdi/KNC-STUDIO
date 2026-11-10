import { z } from 'zod'
import { uuid } from '../_shared/http.ts'

const address = z.string().transform((value) => value.trim().toLowerCase())

/** The fields read from Auth's Send Email hook payload. Auth sends more and may add others. */
export const requestSchema = z.object({
  user: z.object({ id: uuid, email: address, new_email: address.optional() }),
  email_data: z.object({
    email_action_type: z.string(),
    token_hash: z.string().min(1),
    redirect_to: z.string().catch(''),
  }),
})

export type HookPayload = z.output<typeof requestSchema>
