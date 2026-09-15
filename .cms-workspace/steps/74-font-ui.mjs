import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path,before,after) => { const file=resolve(root,path),value=readFileSync(file,'utf8'); if (!value.includes(before)) throw new Error(`Missing font UI anchor ${path}: ${before}`); writeFileSync(file,value.replace(before,after)) }
  const prepend = (path,source) => { const file=resolve(root,path); writeFileSync(file,source+readFileSync(file,'utf8')) }
  prepend('src/cms/context.tsx', "import { fontFaceCss } from '../../shared/cms-fonts'\n")
  edit('src/cms/context.tsx', 'const rules = [presentationCss(presentation)]', "const rules = [fontFaceCss(presentation, SUPABASE_URL ?? 'https://unconfigured.invalid'), presentationCss(presentation)]")
  prepend('src/cms/PublicPage.tsx', "import { fontFaceCss } from '../../shared/cms-fonts'\nimport { SUPABASE_URL } from '../backend/config'\n")
  edit('src/cms/PublicPage.tsx', '<CmsMarkup html={content.html}', "<style>{fontFaceCss(value.presentation, SUPABASE_URL ?? 'https://unconfigured.invalid')}</style><CmsMarkup html={content.html}")
  prepend('src/cms/publicWorker.ts', "import { fontFaceCss } from '../../shared/cms-fonts'\n")
  edit('src/cms/publicWorker.ts', '  const body = renderCmsPage(await shell.text(), page, url, siteOrigin)', "  const base = await shell.text()\n    const faces = fontFaceCss(value?.presentation ?? { fonts: {} } as CmsPresentation, env.SUPABASE_URL ?? siteOrigin)\n    const body = renderCmsPage(base.replace('</head>', `<style>${faces}</style></head>`), page, url, siteOrigin)")
  const assets='src/admin/cms/Assets.tsx'
  edit(assets, 'onAssets, choose, replace, purpose', 'onAssets, choose, replace, onFont, purpose')
  edit(assets, 'replace?: (asset: CmsAsset) => void;', 'replace?: (asset: CmsAsset) => void; onFont?: (asset: CmsAsset) => void;')
  edit(assets, '<h4>Användning i utkastet</h4>', `{onFont && asset.mime === 'font/woff2' && <button type="button" disabled={busy || asset.archived} onClick={() => onFont(asset)}>Använd typsnittet på sidan</button>}<h4>Användning i utkastet</h4>`)
  edit('src/admin/cms/Studio.tsx', "<AssetLibrary assets={studio.assets} document={document} onAssets={studio.setAssets} replace=", "<AssetLibrary assets={studio.assets} document={document} onAssets={studio.setAssets} onFont={asset => { studio.edit(value => { value.presentation.fonts ??= {}; value.presentation.fonts[asset.id] = { ref: { bucket: asset.bucket, path: asset.path }, name: asset.name }; value.presentation.themes[mode].fontFamily = `CMSFont-${asset.id}` }); switchTarget('theme'); studio.setNotice('Typsnittet är valt i utkastet. Publicera för att använda det på hemsidan.') }} replace=")
  const inspector='src/admin/cms/Inspector.tsx'
  prepend(inspector, "import { fontOptions } from '../../../shared/cms-fonts'\n")
  edit(inspector, 'options={[["", "Original"], ["Inter Variable, sans-serif", "Inter"], ["Arial, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["system-ui, sans-serif", "System"]]}', 'options={fontOptions(document.presentation)}')
  edit(inspector, '<Select label="Textjustering"', '<Select label="Typsnitt" value={values.fontFamily ?? \'\'} options={fontOptions(document.presentation)} onChange={value => set(\'fontFamily\', value)} /><Select label="Textjustering"')
  const authored='src/admin/cms/AuthoredEditor.tsx'
  prepend(authored, "import { fontFaceCss, fontOptions } from '../../../shared/cms-fonts'\nimport type { CmsPresentation } from '../../../shared/cms'\n")
  edit(authored, 'identity: string; variant: PageVariant;', 'identity: string; presentation: CmsPresentation; variant: PageVariant;')
  edit(authored, '  useEffect(() => {\n    if (!host.current)', `  const fontCss = fontFaceCss(props.presentation, SUPABASE_URL ?? 'https://unconfigured.invalid')
  const applyFonts = (): void => {
    const document = editor.current?.Canvas.getDocument()
    if (!document?.head) return
    let style = document.head.querySelector<HTMLStyleElement>('style[data-cms-fonts]')
    if (!style) { style = document.createElement('style'); style.dataset['cmsFonts'] = ''; document.head.appendChild(style) }
    style.textContent = fontFaceCss(current.current.presentation, SUPABASE_URL ?? 'https://unconfigured.invalid')
  }
  useEffect(applyFonts, [fontCss])
  useEffect(() => {
    if (!host.current)`)
  edit(authored, 'gjs.on(\'canvas:frame:load\', () => {', "gjs.on('canvas:frame:load', () => {\n      applyFonts()")
  edit(authored, '<div class="cms-authored-toolbar">', `<div class="cms-authored-toolbar"><label>Tilldela typsnitt <select aria-label="Tilldela typsnitt" value="" onChange={event => { const component = editor.current?.getSelected(); if (!component) { props.onError('Välj ett textlager först.'); return }; const value = event.currentTarget.value; if (value) component.addStyle({ 'font-family': value }); else component.removeStyle('font-family') }}>{fontOptions(props.presentation).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>`)
  edit('src/admin/cms/Studio.tsx', 'variant={variant} mode={mode}', 'variant={variant} presentation={document.presentation} mode={mode}')
}
