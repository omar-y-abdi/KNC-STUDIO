import { z } from 'zod'

const barberId = z.string().regex(/^[a-z0-9-]{1,32}$/)

const file = z.instanceof(File).refine((candidate) => candidate.size > 0)

/** A form field sent once is its value; one sent twice is a list, which no field accepts. */
export function formFields(form: FormData): Record<string, unknown> {
  const fields = new Map<string, FormDataEntryValue[]>()
  for (const [name, value] of form.entries()) fields.set(name, [...(fields.get(name) ?? []), value])
  return Object.fromEntries(
    [...fields].map(([name, values]) => [name, values.length === 1 ? values[0] : values]),
  )
}

/** The `cms_asset` upload is handled by `cmsUpload.ts` before this schema is consulted. */
export const uploadSchema = z.object({ kind: z.literal('barber_photo'), file, barberId }).strict()

const storagePath = z.string().min(1).max(300)

export const deleteSchema = z
  .object({ action: z.literal('delete'), kind: z.literal('barber_photo'), barberId, storagePath })
  .strict()
  .refine((row) => row.storagePath.startsWith(`${row.barberId}/`))
