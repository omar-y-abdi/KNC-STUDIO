import { Component, type ComponentChildren, type JSX } from 'preact'
import { Suspense } from 'preact/compat'

interface LazyLoadBoundaryProps {
  readonly children: ComponentChildren
  readonly error: ComponentChildren
}

interface LazyLoadBoundaryState {
  readonly failed: boolean
}

export class LazyLoadBoundary extends Component<LazyLoadBoundaryProps, LazyLoadBoundaryState> {
  override state: LazyLoadBoundaryState = { failed: false }

  static override getDerivedStateFromError(): LazyLoadBoundaryState {
    return { failed: true }
  }

  override render(): ComponentChildren {
    return this.state.failed ? this.props.error : this.props.children
  }
}

export interface LazySurfaceProps {
  readonly children: ComponentChildren
  readonly loadingLabel: string
  readonly errorLabel: string
  readonly retryLabel: string
  readonly overlay?: boolean
  readonly minHeight?: string
}

function frameStyle(overlay: boolean, minHeight: string): JSX.CSSProperties {
  const base: JSX.CSSProperties = {
    minHeight,
    padding: '24px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    textAlign: 'center',
    fontFamily: 'inherit',
    fontSize: '14px',
  }
  return overlay
    ? {
        ...base,
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(10,10,12,.42)',
        color: '#fff',
      }
    : base
}

function LoadingMessage(props: {
  readonly label: string
  readonly overlay: boolean
  readonly minHeight: string
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={frameStyle(props.overlay, props.minHeight)}
    >
      {props.label}
    </div>
  )
}

function ErrorMessage(props: {
  readonly label: string
  readonly retryLabel: string
  readonly overlay: boolean
  readonly minHeight: string
}): JSX.Element {
  return (
    <div role="alert" style={frameStyle(props.overlay, props.minHeight)}>
      <span>{props.label}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: '1px solid currentColor',
          borderRadius: '999px',
          padding: '8px 14px',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        {props.retryLabel}
      </button>
    </div>
  )
}

export function LazySurface(props: LazySurfaceProps): JSX.Element {
  const overlay = props.overlay ?? false
  const minHeight = props.minHeight ?? (overlay ? '100vh' : '180px')
  return (
    <LazyLoadBoundary
      error={
        <ErrorMessage
          label={props.errorLabel}
          retryLabel={props.retryLabel}
          overlay={overlay}
          minHeight={minHeight}
        />
      }
    >
      <Suspense
        fallback={
          <LoadingMessage label={props.loadingLabel} overlay={overlay} minHeight={minHeight} />
        }
      >
        {props.children}
      </Suspense>
    </LazyLoadBoundary>
  )
}
