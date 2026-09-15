import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  const read = path => readFileSync(resolve(root, path), 'utf8')
  const write = (path, value) => writeFileSync(resolve(root, path), value)
  const edit = (path, before, after) => { const value=read(path); if (!value.includes(before)) throw new Error(`Missing preview anchor ${path}: ${before}`); write(path,value.replace(before,after)) }
  const mobile = 'src/app/MobileSite.tsx'
  edit(mobile, 'export interface MobileSiteProps {', "export interface MobileSiteProps {\n  readonly previewPorts?: import('./DesktopSite').DesktopSitePreviewPorts")
  const source = read(mobile), tree = ts.createSourceFile(mobile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = []
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(tree) === 'LazyBookingFlow') edits.push([node.tagName.end, ` {...(props.previewPorts === undefined ? {} : { port: props.previewPorts.booking, barbersPort: props.previewPorts.barbers, servicesPort: props.previewPorts.services })}`])
      if (node.tagName.getText(tree) === 'AboutSection') edits.push([node.tagName.end, ` {...(props.previewPorts === undefined ? {} : { port: props.previewPorts.reviews, barbersPort: props.previewPorts.barbers, aboutContentPort: props.previewPorts.aboutContent, galleryPort: props.previewPorts.gallery, challengeEnabled: false })}`])
    }
    ts.forEachChild(node,visit)
  }
  visit(tree)
  if (edits.length !== 2) throw new Error('Expected both mobile read-only seams')
  let result = source
  for (const [position,value] of edits.sort((a,b)=>b[0]-a[0])) result=result.slice(0,position)+value+result.slice(position)
  write(mobile,result)
  const editor = 'src/admin/cms/AuthoredEditor.tsx'
  edit(editor, 'mode: CmsMode; width: number; locked: boolean', 'mode: CmsMode; width: number; zoom: number; locked: boolean')
  edit(editor, "const applying = useRef(false)", "const appliedMode = useRef(props.mode)\n  const applying = useRef(false)")
  edit(editor, 'if (key === emitted.current) return', 'if (key === emitted.current && appliedMode.current === props.mode) return')
  edit(editor, 'emitted.current = key\n', 'emitted.current = key; appliedMode.current = props.mode\n')
  edit(editor, "widthMedia: '767px'", "widthMedia: '768px'")
  edit(editor, "useEffect(() => { const gjs = editor.current; if (gjs) gjs.setDevice(props.width <= 767 ? 'Mobile' : 'Desktop') }, [props.width])", "useEffect(() => {\n    const gjs = editor.current\n    if (!gjs) return\n    const name = props.width <= 768 ? 'Mobile' : 'Desktop'\n    gjs.DeviceManager.get(name)?.set('width', `${props.width}px`)\n    gjs.setDevice(name)\n    gjs.Canvas.setZoom(props.zoom)\n  }, [props.width, props.zoom])")
  edit('src/admin/cms/Studio.tsx', 'variant={variant} mode={mode} width={width}', 'variant={variant} mode={mode} width={width} zoom={zoom}')
  edit('src/cms/Regions.tsx', "import { CmsMarkup } from './Markup'", "import { lazy, Suspense } from 'preact/compat'\nconst CmsMarkup = lazy(() => import('./Markup').then(module => ({ default: module.CmsMarkup })))")
  edit('src/cms/Regions.tsx', '<CmsMarkup html={variant.html} css={variant.css[mode]} label={name} />', '<Suspense fallback={<p role="status">Läser innehåll…</p>}><CmsMarkup html={variant.html} css={variant.css[mode]} label={name} /></Suspense>')
}
