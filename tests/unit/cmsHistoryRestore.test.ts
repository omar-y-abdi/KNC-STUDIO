import { describe, expect, it } from 'vitest'
import { emptyDocument, validateDocument, type CmsBarber, type CmsDocument } from '../../shared/cms'
import { restoreRevision } from '../../src/admin/cms/draft'

const barber = (id: string, name: string, sort_order: number): CmsBarber => ({
  id,
  name,
  ig: '',
  role_sv: 'Barberare',
  role_en: 'Barber',
  bio_sv: `${name} sv`,
  bio_en: `${name} en`,
  sort_order,
})

const document = (
  barbers: CmsBarber[],
  photos: Record<string, string>,
  businessName: string,
): CmsDocument => ({
  ...emptyDocument(),
  settings: { business_name: businessName },
  barbers,
  photos,
})

// The database publishes only a document whose barber ids equal the current roster.
describe('history restore after a roster change', () => {
  const current = document(
    [barber('ali', 'Ali nu', 0), barber('cleo', 'Cleo', 1)],
    { ali: 'ali/now.webp', cleo: 'cleo/now.webp' },
    'Salong nu',
  )

  it('restores existing barbers, keeps new ones and drops departed ones', () => {
    const revision = document(
      [barber('ali', 'Ali då', 3), barber('bo', 'Bo', 1)],
      { ali: 'ali/then.webp', bo: 'bo/then.webp' },
      'Salong då',
    )
    const restored = restoreRevision(revision, current)
    expect(restored.reconciled).toBe(true)
    expect(restored.document.barbers).toEqual([
      barber('ali', 'Ali då', 3),
      barber('cleo', 'Cleo', 1),
    ])
    expect(restored.document.photos).toEqual({ ali: 'ali/then.webp', cleo: 'cleo/now.webp' })
    expect(restored.document.settings).toEqual({ business_name: 'Salong då' })
    expect(() => validateDocument(restored.document)).not.toThrow()
  })

  it('keeps the current photo of an existing barber the revision showed without one', () => {
    const revision = document([barber('ali', 'Ali då', 0)], {}, 'Salong då')
    const restored = restoreRevision(revision, current)
    expect(restored.reconciled).toBe(true)
    expect(restored.document.photos).toEqual(current.photos)
    expect(restored.document.barbers.map((item) => item.name)).toEqual(['Ali då', 'Cleo'])
  })

  it('restores the revision unchanged when the roster is the same', () => {
    const revision = document(
      [barber('cleo', 'Cleo då', 1), barber('ali', 'Ali då', 0)],
      { ali: 'ali/then.webp', cleo: 'cleo/then.webp' },
      'Salong då',
    )
    expect(restoreRevision(revision, current)).toEqual({ document: revision, reconciled: false })
  })
})
