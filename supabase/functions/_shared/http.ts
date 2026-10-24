import { z } from 'zod'

/** The admin panel is another origin than the functions it invokes; webhooks and gateways need none. */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

export function json(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** `json` for functions the browser calls directly. */
export function corsJson(body: unknown, status = 200): Response {
  return json(body, status, corsHeaders)
}

/** Every identity the functions accept is a database-generated UUID. */
export const uuid = z.string().uuid()

export type Parsed<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly detail: string }

/** Unknown keys outrank field errors: the caller speaks another contract. */
export function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): Parsed<z.output<S>> {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const issues = result.error.issues
  const issue = issues.find((candidate) => candidate.code === 'unrecognized_keys') ?? issues[0]
  return { ok: false, detail: issue?.message ?? 'invalid payload' }
}
