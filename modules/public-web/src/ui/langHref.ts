import type { Lang } from '../i18n/index'

/** A site path in the visitor's language: Swedish is the default and carries no query. */
export function langHref(path: string, lang: Lang): string {
  return lang === 'en' ? `${path}?lang=en` : path
}
