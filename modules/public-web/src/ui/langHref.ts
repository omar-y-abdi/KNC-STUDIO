import type { Lang } from '../i18n/index'

export function langHref(path: string, lang: Lang): string {
  return lang === 'en' ? `${path}?lang=en` : path
}
