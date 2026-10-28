import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'
import { CmsValidationError, emptyDocument, validateDocument } from '../../shared/cms'
import { cmsApi } from '../../src/admin/cms/api'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))
beforeEach(() => invoke.mockReset())

it.each([409, 422])('retains HTTP %s and the server explanation', async (status) => {
  const response = new Response(JSON.stringify({ message: 'Server explanation' }), { status })
  const error = new FunctionsHttpError(response)
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.validate(emptyDocument())).rejects.toMatchObject({
    message: 'Server explanation',
    context: { status },
  })
  expect(response.bodyUsed).toBe(false)
})

it('retains the HTTP error when the response is not JSON', async () => {
  const error = new FunctionsHttpError(new Response('Unavailable', { status: 503 }))
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
})

it('does not turn a network failure into a revision conflict', async () => {
  const error = new Error('Network unavailable')
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
})

const httpError = (status: number, body: unknown): FunctionsHttpError =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }))

it.each([
  [
    546,
    { code: 'WORKER_LIMIT', message: 'Function failed due to not having enough compute resources' },
    'Servern hann inte klart. Försök igen; utkastet finns kvar.',
  ],
  [
    401,
    { error: 'unauthorized', requestId: 'r' },
    'Du har loggats ut. Logga in igen; utkastet finns kvar lokalt.',
  ],
  [
    401,
    { code: 401, message: 'Invalid JWT' },
    'Du har loggats ut. Logga in igen; utkastet finns kvar lokalt.',
  ],
  [
    403,
    { error: 'forbidden', requestId: 'r' },
    'Kontot saknar behörighet att ändra webbplatsen. Utkastet finns kvar lokalt.',
  ],
  [
    503,
    { error: 'not_configured', requestId: 'r' },
    'Servern svarade med fel 503. Försök igen; utkastet finns kvar.',
  ],
])('explains HTTP %s to the owner in Swedish', async (status, body, message) => {
  const error = httpError(status, body)
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
  expect(error).toMatchObject({ message, context: { status } })
})

it('keeps a Swedish explanation from the CMS functions for a forbidden request', async () => {
  const message = 'Filbiblioteket kräver ett aktivt ägarkonto och den aktuella CMS-migrationen.'
  invoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'forbidden', message }) })
  await expect(cmsApi.state()).rejects.toMatchObject({ message, context: { status: 403 } })
})

it('explains an unreachable server in Swedish', async () => {
  const error = new FunctionsFetchError(new TypeError('Failed to fetch'))
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
  expect(error.message).toBe(
    'Servern kunde inte nås. Kontrollera anslutningen och försök igen; utkastet finns kvar.',
  )
})

// cms-studio answers a CmsValidationError with HTTP 422 and the validator's message.
const rejection = (settings: Record<string, string>): string => {
  const document = emptyDocument()
  document.settings = settings
  try {
    validateDocument(document)
  } catch (error) {
    if (error instanceof CmsValidationError) return error.message
    throw error
  }
  throw new Error('The document was expected to be invalid')
}

it.each([
  ['business_name', '', 'Ange 1–160 tecken.'],
  [
    'business_legal_name',
    'Salong\nAB',
    'Ange ett juridiskt namn på högst 160 tecken utan radbrytningar.',
  ],
  [
    'business_org_number',
    '12345',
    'Ange organisationsnumret med tio siffror, till exempel 556677-8899.',
  ],
  ['business_email', 'salong', 'Ange en giltig e-postadress.'],
  ['business_phone_display', '0'.repeat(81), 'Ange högst 80 tecken.'],
  ['business_phone_tel', '12', 'Ange telefonlänken med 3–20 siffror, gärna med +46 först.'],
  ['business_postal_code', '123', 'Ange postnumret med fem siffror.'],
  ['business_maps_href', 'http://karta', 'Ange kartlänken som en https://-adress utan mellanslag.'],
  ['seo_title_sv', '', 'Ange 1–120 tecken.'],
  ['seo_description_sv', '', 'Ange 1–500 tecken.'],
  ['business_city', 'x'.repeat(501), 'Ange högst 500 tecken.'],
])('shows the owner a Swedish validation message for %s', async (key, value, message) => {
  const body = { error: 'invalid_content', message: rejection({ [key]: value }) }
  invoke.mockResolvedValue({ data: null, error: httpError(422, body) })
  await expect(cmsApi.validate(emptyDocument())).rejects.toMatchObject({
    message: `settings.${key}: ${message}`,
    context: { status: 422 },
  })
})
