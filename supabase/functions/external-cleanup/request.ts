import { z } from 'zod'
import { uuid } from '../_shared/http.ts'

/** `queue_due_external_actions` sends exactly these two keys. */
export const requestSchema = z
  .object({ action_id: uuid, dispatch_token: uuid })
  .strict()
  .transform((row) => ({ actionId: row.action_id, dispatchToken: row.dispatch_token }))
