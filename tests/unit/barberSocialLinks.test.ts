import { describe, expect, it, vi } from 'vitest'
import { h, isValidElement, type ComponentChild, type VNode } from 'preact'
import { barberSocialLinks, socialText } from '../../src/about/barberSocialLinks'

vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: 'focus' }))

const anchors = (children: ComponentChild[]) =>
  children.filter(
    (
      child,
    ): child is VNode<{
      href: string
      tabIndex?: number
      rel: string
      onClick: (event: { stopPropagation: () => void }) => void
    }> => isValidElement(child) && child.type === 'a',
  )
const textOf = (node: ComponentChild): string => {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf(node.props.children as ComponentChild)
  return typeof node === 'string' ? node : ''
}

describe('barber social profile links', () => {
  it('links multiple Instagram handles and explicit TikTok labels without changing the copy', () => {
    const copy = '@vicbarbergbg | Instagram: @bnbstudio. TikTok: @bnbstudio_gbg'
    const result = socialText(copy, 'instagram')
    expect(textOf(result)).toBe(copy)
    expect(anchors(result).map((node) => node.props.href)).toEqual([
      'https://www.instagram.com/vicbarbergbg/',
      'https://www.instagram.com/bnbstudio/',
      'https://www.tiktok.com/@bnbstudio_gbg',
    ])
  })

  it('recognizes mixed-case labels and dotted handles in biographies', () => {
    const copy = 'Frisör. TikTok: @amads.barbaire, IG @amad_barbaire'
    expect(anchors(socialText(copy)).map((node) => node.props.href)).toEqual([
      'https://www.tiktok.com/@amads.barbaire',
      'https://www.instagram.com/amad_barbaire/',
    ])
  })

  it('leaves unlabeled handles, emails and markup as text and never makes an arbitrary URL', () => {
    const copy = 'Contact @unknown or user@example.com; javascript:alert(1) <script>bad()</script>'
    expect(socialText(copy)).toEqual([copy])
    expect(anchors(socialText('Instagram @safe<script>', undefined))[0]?.props.href).toBe(
      'https://www.instagram.com/safe/',
    )
  })

  it('links projected owner text, keeps hidden links out of Tab order, and stops card toggles', () => {
    const result = barberSocialLinks(
      h('span', { 'data-barber-social': 'instagram', 'aria-hidden': true }, '@', 'owner.edit'),
    )
    expect(textOf(result)).toBe('@owner.edit')
    const link = anchors(result.props.children as ComponentChild[])[0]
    expect(link?.props.href).toBe('https://www.instagram.com/owner.edit/')
    expect(link?.props.tabIndex).toBe(-1)
    expect(link?.props.rel).toBe('noopener noreferrer')
    const stopPropagation = vi.fn()
    link?.props.onClick({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
  })
})
