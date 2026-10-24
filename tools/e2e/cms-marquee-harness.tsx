import { render } from 'preact'
import { AboutSection } from '../../src/about/AboutSection'
import { GalleryMarquee } from '../../src/about/GalleryMarquee'
import type { GalleryPhoto } from '../../src/about/gallery/port'
import type { ReviewsPort } from '../../src/about/reviews/port'
import type { BarbersPort } from '../../src/booking/barbersPort'
import { palette } from '../../src/booking/bookingStyles'
import { asBarberId } from '../../src/booking/domain'

// The real marquee components outside the Studio, so specs measure their actual motion geometry.

const photos: readonly GalleryPhoto[] = [1, 2, 3].map((number) => ({
  id: `gallery-fixture-${number}`,
  url: '/og-image.png',
  alt: `Gallery fixture ${number}`,
}))

const barbers = (count: number): BarbersPort => ({
  listActive: async () =>
    ['A', 'B', 'C', 'D'].slice(0, count).map((id) => ({
      barber: { id: asBarberId(`barber-${id}`), name: `Barber ${id}`, ig: id.toLowerCase() },
      copy: null,
      photoUrl: null,
    })),
})

const reviews: ReviewsPort = {
  list: async () => [],
  submit: async () => ({
    ok: false,
    error: { kind: 'submit', message: 'Unexpected fixture write' },
  }),
}

function host(): HTMLElement {
  const element = document.createElement('div')
  document.body.replaceChildren(element)
  return element
}

/** Three photos in a container the spec resizes without resizing the window. */
export function mountGallery(width: number): void {
  const container = host()
  container.id = 'gallery-host'
  container.style.width = `${width}px`
  render(<GalleryMarquee photos={photos} alt="Gallery fixture" c={palette(false)} />, container)
}

/** The mobile About section with 1-4 barbers; `css` plays the owner's stored card styles. */
export function mountBarberStrip(css: string, count = 4): void {
  if (count < 1 || count > 4) throw new Error(`The fixture has 1-4 barbers, not ${count}`)
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  render(
    <AboutSection
      mode="light"
      lang="sv"
      mobile
      port={reviews}
      barbersPort={barbers(count)}
      aboutContentPort={{ overlay: async () => ({}) }}
      galleryPort={{ list: async () => [] }}
      challengeEnabled={false}
    />,
    host(),
  )
}
