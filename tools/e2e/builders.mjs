import { emptyDocument } from '../../shared/cms.ts'

/**
 * @param {Partial<import('../../shared/cms.ts').CmsDocument>} [overrides]
 * @returns {import('../../shared/cms.ts').CmsDocument}
 */
export function documentFixture(overrides = {}) {
  return { ...emptyDocument(), ...globalThis.structuredClone(overrides) }
}

/**
 * A registered cms_assets row, including nullable database columns.
 * @param {Partial<import('../../shared/cms.ts').CmsAsset>} [overrides]
 * @returns {import('../../shared/cms.ts').CmsAsset}
 */
export function assetFixture(overrides = {}) {
  return {
    id: '28000000-0000-4000-8000-000000000001',
    bucket: 'cms-library',
    path: 'images/fixture.webp',
    name: 'Fixture image',
    alt: '',
    mime: 'image/webp',
    width: 800,
    height: 800,
    bytes: 200,
    archived: false,
    trashed_at: null,
    version: 0,
    ...globalThis.structuredClone(overrides),
  }
}

/**
 * @typedef {import('../../shared/cms.ts').CmsBarber & {
 *   active?: boolean, photo_path?: string | null
 * }} BarberRow
 * @param {Partial<BarberRow>} [overrides]
 * @returns {BarberRow}
 */
export function barberFixture(overrides = {}) {
  return {
    id: 'fixture-barber',
    name: 'Fixture barber',
    ig: 'fixture',
    role_sv: 'Frisör',
    role_en: 'Barber',
    bio_sv: 'Presentation',
    bio_en: 'Presentation',
    sort_order: 0,
    ...globalThis.structuredClone(overrides),
  }
}
