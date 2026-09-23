import { Component, type ComponentChildren } from 'preact'

interface Props {
  children: ComponentChildren
  contextKey: string
}
interface State {
  failure: string | null
}

/** The canvas owns third-party parsing and DOM effects. A failed page must not
 * unmount the owner's draft, page navigation or backup/export controls. */
export class CmsEditorBoundary extends Component<Props, State> {
  override state: State = { failure: null }

  static override getDerivedStateFromError(error: unknown): State {
    return { failure: error instanceof Error ? error.message : 'Okänt renderingsfel' }
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failure !== null && previous.contextKey !== this.props.contextKey)
      this.setState({ failure: null })
  }

  override render(): ComponentChildren {
    if (this.state.failure === null) return this.props.children
    return (
      <div class="cms-loading" role="alert">
        <h2>Sidan kunde inte öppnas i editorn</h2>
        <p>
          Ditt utkast finns kvar. Välj en annan sida eller exportera en kopia under Utkast &amp;
          backup.
        </p>
        <details>
          <summary>Teknisk felinformation</summary>
          <p>{this.state.failure}</p>
        </details>
        <button type="button" onClick={() => this.setState({ failure: null })}>
          Försök igen
        </button>
      </div>
    )
  }
}
