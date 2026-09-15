import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('native CMS preview boundaries', () => {
  const mobile = readFileSync('src/app/MobileSite.tsx', 'utf8')
  const root = readFileSync('src/app/Root.tsx', 'utf8')
  it('passes explicit read-only booking ports to the mobile booking surface', () => {
    expect(mobile).toContain('previewPorts?:')
    expect(mobile).toContain('props.previewPorts.booking')
    expect(mobile).toContain('props.previewPorts.services')
    expect(mobile).toContain('props.previewPorts.barbers')
  })
  it('uses the preview gallery and review ports without loading a live challenge', () => {
    expect(mobile).toContain('props.previewPorts.reviews')
    expect(mobile).toContain('props.previewPorts.aboutContent')
    expect(mobile).toContain('props.previewPorts.gallery')
    expect(mobile).toContain('challengeEnabled: false')
  })
  it('loads the same-origin preview shell directly instead of mounting a second admin session gate', () => {
    expect(root).toContain("const CmsPreviewEntry = lazy(() => import('../admin/cms/Preview'))")
    const preview = root.indexOf('<Route path="/admin/cms/preview">')
    const admin = root.indexOf('<Route path="/admin">')
    expect(preview).toBeGreaterThan(0)
    expect(preview).toBeLessThan(admin)
  })
})

describe('authored canvas mode synchronization', () => {
  const editor = readFileSync('src/admin/cms/AuthoredEditor.tsx', 'utf8')
  it('does not skip applying a new theme just because the document is unchanged', () => {
    expect(editor).toContain('appliedMode.current === props.mode')
    expect(editor).toContain('appliedMode.current = props.mode')
  })
  it('never dereferences a missing GrapesJS frame while its cross-browser canvas is starting', () => {
    expect(editor).toContain('const hardenFrame = (): void =>')
    expect(editor).toContain("querySelector<HTMLIFrameElement>('iframe.gjs-frame')")
    expect(editor).toContain("frame?.setAttribute('sandbox', 'allow-same-origin')")
    expect(editor).not.toContain("getFrameEl().setAttribute('sandbox'")
  })
})
