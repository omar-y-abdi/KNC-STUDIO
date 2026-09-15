import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function integrate(root) {
  const { parse, serialize, serializeOuter } = await import(pathToFileURL(resolve(root, 'node_modules/parse5/dist/index.js')).href)
  const find = (node, predicate) => predicate(node) ? node : (node.childNodes ?? []).map(child => find(child, predicate)).find(Boolean)
  const clone = node => {
    const result = { ...node, attrs: node.attrs?.map(attr => ({ ...attr })), parentNode: undefined }
    if (node.childNodes) result.childNodes = node.childNodes.map(child => { const copy = clone(child); copy.parentNode = result; return copy })
    return result
  }
  const output = {}
  for (const kind of ['privacy', 'terms']) {
    const document = parse(readFileSync(resolve(root, `public/${kind}.html`), 'utf8'))
    const main = find(document, node => node.tagName === 'main')
    if (!main) throw new Error(`Missing original main in ${kind}`)
    const english = find(main, node => node.tagName === 'section' && node.attrs.some(attr => attr.name === 'lang' && attr.value === 'en'))
    if (!english) throw new Error(`Missing original English section in ${kind}`)
    const sv = clone(main)
    sv.childNodes = sv.childNodes.filter(node => !(node.tagName === 'section' && node.attrs.some(attr => attr.name === 'lang' && attr.value === 'en')) && node.nodeName !== '#comment' && node.tagName !== 'hr')
    sv.attrs.push({ name: 'class', value: 'cms-legal' })
    const en = clone(english)
    en.tagName = 'main'; en.nodeName = 'main'; en.attrs = [{ name: 'class', value: 'cms-legal' }, { name: 'lang', value: 'en' }]
    const heading = find(en, node => node.tagName === 'h2')
    if (!heading) throw new Error(`Missing English heading in ${kind}`)
    heading.tagName = 'h1'; heading.nodeName = 'h1'
    const css = mode => `.cms-legal{max-width:736px;margin:0 auto;padding:48px 24px 80px;background:${mode === 'dark' ? '#0f1115' : '#ffffff'};color:${mode === 'dark' ? '#e9eaee' : '#16181c'};font-family:system-ui,sans-serif;line-height:1.6}h1{font-size:28px;line-height:1.2;margin:0 0 20px}h2{font-size:19px;margin:36px 0 10px}a{color:${mode === 'dark' ? '#33c39a' : '#0a7a5a'}}p,li{overflow-wrap:anywhere}code{font-family:monospace}dt{font-weight:600}dd{margin:0 0 12px}.lang,.updated{opacity:.72;font-size:14px}`
    const styles = { light: css('light'), dark: css('dark') }
    output[kind] = { sv: { html: serializeOuter(sv), css: styles }, en: { html: serializeOuter(en), css: { ...styles } } }
    if (!serialize(main).includes('Mina bokningar') && kind === 'terms') throw new Error('Original legal source was unexpectedly incomplete')
  }
  writeFileSync(resolve(root, 'shared/cms-legal-defaults.ts'), `// Imported from the existing public legal documents; no new legal policy is introduced.\nimport type { CmsLang, PageVariant } from './cms'\nexport const LEGAL_DEFAULTS: Record<'privacy' | 'terms', Record<CmsLang, PageVariant>> = ${JSON.stringify(output, null, 2)}\n`)
}
