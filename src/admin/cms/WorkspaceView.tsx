import type { ComponentChildren, JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

const views: Record<string, { title: string; description: string }> = {
  resources: {
    title: 'Bilder & typsnitt',
    description: 'Dina filer, samlade på ett ställe. Välj en resurs för att se var den används.',
  },
  history: {
    title: 'Webbplatsens historik',
    description:
      'Varje publicering finns kvar. Återställ en version till utkast och granska före publicering.',
  },
  business: {
    title: 'Företag & sökresultat',
    description: 'Uppgifter som används på webbplatsen och i dina mejl.',
  },
  email: {
    title: 'Mejl från din salong',
    description: 'Redigera text och utseende. Förhandsvisningen använder samma mall som utskicken.',
  },
}

/** Workspace destinations preserve the mounted editor and its selection/scroll state. */
export function CmsWorkspaceView({
  kind,
  children,
  onClose,
}: {
  kind: string
  children: ComponentChildren
  onClose: () => void
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  const view = views[kind] ?? { title: 'Din webbplats', description: '' }
  useLayoutEffect(() => {
    const opener = document.activeElement
    heading.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [kind])
  return (
    <section
      class={`cms-workspace-view cms-workspace-${kind}`}
      aria-label={view.title}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !(event.target as Element).closest('dialog')
        ) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header class="cms-workspace-heading">
        <div>
          <span class="cms-eyebrow">
            Din webbplats /{' '}
            {kind === 'resources'
              ? 'Resurser'
              : kind === 'history'
                ? 'Historik'
                : kind === 'email'
                  ? 'Mejl'
                  : 'Inställningar'}
          </span>
          <h1 ref={heading} tabIndex={-1}>
            {view.title}
          </h1>
          <p>{view.description}</p>
        </div>
        <button type="button" onClick={onClose}>
          Tillbaka till sidan <span aria-hidden="true">↗</span>
        </button>
      </header>
      <div class="cms-workspace-content">{children}</div>
    </section>
  )
}
