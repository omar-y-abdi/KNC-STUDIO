import { z } from 'zod'
import { uuid } from '../_shared/http.ts'

const barberId = z.string().regex(/^[a-z0-9-]{1,32}$/)

/** Logo objects are stored as `logo/<uuid>.webp`. */
const logoPath = z
  .string()
  .refine(
    (path) =>
      path.startsWith('logo/') &&
      path.endsWith('.webp') &&
      uuid.safeParse(path.slice(5, -5)).success,
  )

const file = z.instanceof(File).refine((candidate) => candidate.size > 0)

const sortOrder = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(z.number().int().min(-2147483648).max(2147483647))

/** A form field sent once is its value; one sent twice is a list, which no field accepts. */
export function formFields(form: FormData): Record<string, unknown> {
  const fields = new Map<string, FormDataEntryValue[]>()
  for (const [name, value] of form.entries()) fields.set(name, [...(fields.get(name) ?? []), value])
  return Object.fromEntries(
    [...fields].map(([name, values]) => [name, values.length === 1 ? values[0] : values]),
  )
}

/** The `cms_asset` upload is handled by `cmsUpload.ts` before this schema is consulted. */
export const uploadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('gallery'),
      file,
      galleryKind: z.enum(['salon', 'cuts']),
      alt: z
        .string()
        .max(2000)
        .transform((text) => text.trim()),
      sortOrder,
    })
    .strict(),
  z.object({ kind: z.literal('barber_photo'), file, barberId }).strict(),
  z
    .object({
      kind: z.literal('site_logo'),
      file,
      expectedPath: z.union([z.literal(''), logoPath]),
    })
    .strict(),
])

const storagePath = z.string().min(1).max(300)

export const deleteSchema = z
  .discriminatedUnion('kind', [
    z
      .object({ action: z.literal('delete'), kind: z.literal('gallery'), id: uuid, storagePath })
      .strict(),
    z
      .object({
        action: z.literal('delete'),
        kind: z.literal('barber_photo'),
        barberId,
        storagePath,
      })
      .strict(),
    z
      .object({ action: z.literal('delete'), kind: z.literal('site_logo'), storagePath: logoPath })
      .strict(),
  ])
  .refine((row) => row.kind !== 'barber_photo' || row.storagePath.startsWith(`${row.barberId}/`))
