import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

export function Field({
  label,
  value,
  onChange,
  multiline = false,
  maxLength = 2000,
  type = 'text',
  hint,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  maxLength?: number
  type?: 'text' | 'email' | 'url' | 'number' | 'color'
  hint?: string | undefined
  disabled?: boolean
}): JSX.Element {
  return (
    <label class="cms-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
          rows={4}
          maxLength={maxLength}
          disabled={disabled}
        />
      ) : (
        <input
          type={type}
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
          maxLength={maxLength}
          disabled={disabled}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label class="cms-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
  wide?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.showModal()
    return () => {
      if (element.open) element.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      class={`cms-modal${wide ? ' cms-modal--wide' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Stäng dialog">
          ×
        </button>
      </header>
      <div class="cms-modal-body">{children}</div>
    </dialog>
  )
}
export function downloadJson(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Notice({
  children,
  error = false,
}: {
  children: ComponentChildren
  error?: boolean
}): JSX.Element {
  return (
    <p
      class={error ? 'cms-notice cms-notice--error' : 'cms-notice'}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}
