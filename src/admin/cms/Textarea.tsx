import type { JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/** Long copy grows inside its panel, then scrolls without stretching the workspace. */
export function CmsTextarea(props: JSX.IntrinsicElements['textarea']): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(280, Math.max(80, field.scrollHeight + 2))}px`
  }, [props.value])
  return (
    <textarea {...props} ref={ref} class="cms-textarea resize-none" style={{ resize: 'none' }} />
  )
}
