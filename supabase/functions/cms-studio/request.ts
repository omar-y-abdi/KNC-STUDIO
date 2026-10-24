import { z } from 'zod'
import { uuid } from '../_shared/http.ts'

/** Reports `message` for any value `schema` rejects, so one message covers a whole group of fields. */
function reported<T>(schema: z.ZodType<T>, message: string) {
  return z.custom<T>((value) => schema.safeParse(value).success, { message })
}

const UNSUPPORTED = 'request: Unsupported field'
const COPY_INVALID = 'asset: Välj en registrerad bild och en giltig destination.'
const FINGERPRINT = z.string().regex(/^[0-9a-f]{32}$/)

const integer = (field: string) =>
  reported(z.number().int().nonnegative().safe(), `${field}: Expected a positive integer`)
const strict = <S extends z.ZodRawShape>(shape: S, message = UNSUPPORTED) =>
  z.object(shape).strict(message)

export const requestSchema = z.discriminatedUnion(
  'operation',
  [
    strict({ operation: z.literal('state') }),
    strict({ operation: z.literal('history'), before: integer('before').nullish() }),
    strict({ operation: z.literal('revision'), revision: integer('revision') }),
    strict(
      {
        operation: z.literal('asset_copy'),
        id: reported(uuid, COPY_INVALID),
        version: reported(z.number().int().nonnegative().safe(), COPY_INVALID),
        purpose: reported(z.enum(['salon', 'cuts', 'logo', 'profile']), COPY_INVALID),
        barberId: z.unknown(),
      },
      COPY_INVALID,
    ),
    strict({
      operation: z.literal('asset_usage'),
      id: reported(uuid, 'asset: Invalid asset identity'),
    }),
    strict({
      operation: z.literal('asset_lifecycle'),
      id: reported(uuid, 'asset: Invalid asset lifecycle action'),
      action: reported(
        z.enum(['archive', 'restore', 'trash', 'delete']),
        'asset: Invalid asset lifecycle action',
      ),
      version: integer('version'),
    }),
    strict({
      operation: z.literal('asset'),
      id: reported(uuid, 'asset: Invalid asset metadata'),
      name: reported(
        z.string().refine((name) => name.trim() !== '' && name.length <= 160),
        'asset: Invalid asset metadata',
      ),
      alt: reported(z.string().max(2000), 'asset: Invalid asset metadata'),
      archived: reported(z.boolean(), 'asset: Invalid asset metadata'),
      version: integer('version'),
    }),
    strict({ operation: z.literal('validate'), document: z.unknown() }),
    strict({
      operation: z.literal('publish'),
      document: z.unknown(),
      baseFingerprint: reported(FINGERPRINT, 'publication: Invalid publication identity'),
      requestId: reported(uuid, 'publication: Invalid publication identity'),
      baseRevision: integer('baseRevision'),
    }),
  ],
  { errorMap: () => ({ message: 'operation: Unknown operation' }) },
)

export type CmsRequest = z.output<typeof requestSchema>
export type CopyRequest = Extract<CmsRequest, { readonly operation: 'asset_copy' }>
