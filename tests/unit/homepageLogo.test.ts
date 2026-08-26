import { describe, expect, it } from 'vitest'
import { homepageLogoFilter } from '../../src/site/HomepageLogo'

describe('homepage logo presentation', () => {
  it('applies monochrome treatment to both uploaded and shipped vector render paths', () => {
    expect(homepageLogoFilter('monochrome')).toBe('grayscale(1) contrast(1.12)')
    expect(homepageLogoFilter('classic')).toBeUndefined()
  })
})
