import type { CmsPresentation } from '../../../shared/cms'

type FetchAnswer = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const PAGE_READS = ['public_cms_page_metadata', 'public_cms_page']

/**
 * A fetch mock that also answers the Worker's bounded page reads as the database does, from the
 * publication `answer` serves for public_cms_presentation: public_cms_page_metadata
 * (supabase/migrations/20260921164356_public_cms_page_metadata.sql) and public_cms_page
 * (supabase/migrations/20261104200000_public_cms_page.sql), each null when no page has the path.
 * When the publication read fails or stalls, so does the page read.
 */
export function withPageReads(answer: FetchAnswer): FetchAnswer {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const rpc = url.split('/').at(-1) ?? ''
    if (!PAGE_READS.includes(rpc)) return answer(input, init)
    const publication = await answer(url.replace(/[^/]*$/, 'public_cms_presentation'), init)
    if (!publication.ok) return publication
    const { revision, presentation } = (await publication.json()) as {
      revision: number
      presentation: CmsPresentation
    }
    const { p_path: path, p_lang: lang = 'sv' } = JSON.parse(String(init?.body)) as {
      p_path: string
      p_lang?: 'sv' | 'en'
    }
    const page = presentation.pages.find((item) => item.path === path)
    if (!page) return Response.json(null)
    return Response.json(
      rpc === 'public_cms_page'
        ? { revision, page, themes: presentation.themes, fonts: presentation.fonts ?? null }
        : { revision, title: page.title[lang], description: page.description[lang] },
    )
  }
}
