import { describe, expect, it } from 'vitest'
import { emptyDocument, mediaUrl, type CmsPage } from '../../shared/cms'
import { resourceUsage } from '../../shared/cms-resources'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}
const image = { bucket: 'cms-library' as const, path: 'images/salon.webp' }
const url = mediaUrl(image, policy.storageOrigin)

function documentWith(html: string, path = '/') {
  const document = emptyDocument()
  const page: CmsPage = {
    id: '10000000-0000-4000-8000-000000000001',
    path,
    kind: 'page',
    name: { sv: 'Hem', en: 'Home' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    inMenu: true,
    content: {
      sv: { html, css: { light: '', dark: '' } },
      en: { html: '<main></main>', css: { light: '', dark: '' } },
    },
  }
  document.presentation.pages.push(page)
  return document
}

describe('resource usage in the real-site editor', () => {
  it('finds a referenced image in a populated native page without changing the draft', () => {
    const document = documentWith(
      `<main data-knc-native="1">${'x'.repeat(160_000)}<img src="${url}" alt="Salong"></main>`,
    )
    const before = structuredClone(document)
    expect(resourceUsage(document, image, policy)).toEqual(['/ · sv/light', '/ · sv/dark'])
    expect(document).toEqual(before)
  })

  it('reports CSS-only references in the correct language and theme', () => {
    const document = documentWith('<main></main>', '/galleri')
    document.presentation.pages[0]!.content.en.css.dark = `.hero{background-image:url("${url}")}`
    expect(resourceUsage(document, image, policy)).toEqual(['/galleri · en/dark'])
  })

  it('keeps native route restrictions, ordinary size limits and unsafe URL checks', () => {
    expect(() =>
      resourceUsage(documentWith('<main data-knc-native="1"></main>', '/custom'), image, policy),
    ).toThrow('Native presentation is restricted')
    expect(() =>
      resourceUsage(documentWith(`<main>${'x'.repeat(160_000)}</main>`, '/custom'), image, policy),
    ).toThrow('Page exceeds its size limit')
    expect(() =>
      resourceUsage(
        documentWith('<main data-knc-native="1"><img src="javascript:alert(1)"></main>'),
        image,
        policy,
      ),
    ).toThrow()
  })
})
