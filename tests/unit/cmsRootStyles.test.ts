import { describe, expect, it } from 'vitest'
import { parse, walk } from 'css-tree'
import { bindCmsRootStyles, canonicalizeCmsRootStyles } from '../../src/admin/cms/cmsRootStyles'
import { syncLayout } from '../../src/admin/cms/responsiveStyles'

describe('CMS document root styles', () => {
  it('rewrites only an exact root selector in lists and nested media', () => {
    const css =
      '@media(min-width:769px){#inao,#inao2,#inao:hover,#inao .child,.inao,[data-ref="#inao"]{background-image:url("/mark.svg#inao")}}'
    const persisted = canonicalizeCmsRootStyles(css, 'inao')
    expect(persisted).toContain(
      'html body,#inao2,#inao:hover,#inao .child,.inao,[data-ref="#inao"]',
    )
    const urls: string[] = []
    walk(parse(persisted), {
      visit: 'Url',
      enter(node) {
        urls.push(node.value)
      },
    })
    expect(urls).toEqual(['/mark.svg#inao'])
    expect(canonicalizeCmsRootStyles(persisted, 'inao')).toBe(persisted)
  })

  it('binds the stored body rule to the selectable wrapper without changing other body rules', () => {
    const css =
      '@media(min-width:769px){html body,html body:hover,.preview html body,body{background:#123456}}'
    const bound = bindCmsRootStyles(css, 'inao')
    expect(bound).toContain('#inao,html body:hover,.preview html body,body')
    expect(canonicalizeCmsRootStyles(bound, 'inao')).toContain(
      'html body,html body:hover,.preview html body,body',
    )
    expect(bindCmsRootStyles(bound, 'inao')).toBe(bound)
  })

  it('syncs root geometry across modes while retaining the other mode color', () => {
    const before = bindCmsRootStyles('html body{padding:20px;background:#123456}', 'inao')
    const other = bindCmsRootStyles('html body{padding:20px;background:#abcdef}', 'inao')
    const after = '#inao{padding:30px;background:#654321}'
    const updated = canonicalizeCmsRootStyles(syncLayout(before, after, other), 'inao')
    expect(updated).toContain('html body{background:#abcdef}')
    expect(updated).toContain('html body{padding:30px}')
    expect(updated).not.toContain('#654321')
  })

  it('removes reset root geometry from the other mode', () => {
    const before = bindCmsRootStyles('html body{padding:20px;background:#123456}', 'inao')
    const other = bindCmsRootStyles('html body{padding:20px;background:#abcdef}', 'inao')
    const after = '#inao{background:#654321}'
    const updated = canonicalizeCmsRootStyles(syncLayout(before, after, other), 'inao')
    expect(updated).toContain('html body{background:#abcdef}')
    expect(updated).not.toContain('padding')
  })
})
