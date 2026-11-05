import type { JSX } from 'preact'
import { useEffect } from 'preact/hooks'

/** Client navigation/dev equivalent of the Worker's real HTTP 404 document. */
export function NotFound(): JSX.Element {
  useEffect(() => {
    document.title = 'Sidan finns inte — Blade & Blend Studio'
    document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow')
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        'Sidan kunde inte hittas. Gå till startsidan för att boka eller kontakta salongen.',
      )
  }, [])
  return (
    <main class="bb-status">
      <p class="bb-muted">404</p>
      <h1>Sidan finns inte</h1>
      <p class="bb-muted">Adressen kan vara felstavad eller sidan kan ha flyttats.</p>
      <a class="bb-btn" href="/">
        Till startsidan och bokningen
      </a>
    </main>
  )
}
