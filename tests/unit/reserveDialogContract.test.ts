import type { VNode } from 'preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReserveDialog, type ReserveDialogProps } from '../../src/admin/ReserveDialog'
import { adminText } from '../../src/i18n/adminStrings'

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }))
vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (!(index in state.values))
      state.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = typeof next === 'function' ? next(state.values[index]) : next
      },
    ]
  },
}))
vi.mock('../../src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))

function elements(node: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as VNode<Record<string, unknown>>
  return [vnode, ...elements(vnode.props.children)]
}

function dialog(services: ReserveDialogProps['services'] = []) {
  const onSubmit = vi.fn()
  const render = () => {
    state.cursor = 0
    return elements(
      ReserveDialog({
        dark: false,
        lang: 'sv',
        timeLabel: 'Monday 12:00',
        services,
        busy: false,
        serverError: null,
        onSubmit,
        onClose: vi.fn(),
      }),
    )
  }
  const price = () => {
    const input = render().find(
      (node) => node.type === 'input' && node.props.inputMode === 'decimal',
    )
    if (!input) throw new Error('Missing reservation price input')
    return input
  }
  const edit = (value: string) => {
    const onInput = price().props.onInput as (event: unknown) => void
    onInput({ currentTarget: { value } })
  }
  const submit = () => {
    const button = render()
      .filter((node) => node.type === 'button')
      .at(-1)
    if (!button) throw new Error('Missing reservation submit button')
    ;(button.props.onClick as () => void)()
  }
  return { render, price, edit, submit, onSubmit }
}

describe('manual reservation prices', () => {
  beforeEach(() => {
    state.values = []
    state.cursor = 0
  })

  it.each(['abc', '-1', '1.234', 'Infinity'])(
    'blocks %s before calling the parent and shows the localized price error',
    (value) => {
      const ui = dialog()
      ui.edit(value)
      ui.submit()
      expect(ui.onSubmit).not.toHaveBeenCalled()
      expect(ui.price().props['aria-invalid']).toBe(true)
      expect(JSON.stringify(ui.render())).toContain(adminText('sv').reserveErrPrice)
    },
  )

  it.each([
    ['', 0],
    ['0', 0],
    ['125.50', 125.5],
  ])('submits valid price %j as %s', (value, expected) => {
    const ui = dialog()
    ui.edit(String(value))
    ui.submit()
    expect(ui.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ price: expected, durationMin: 45 }),
    )
    expect(ui.price().props['aria-invalid']).toBe(false)
  })

  it('clears an invalid price after a valid edit or a service selection and submits the selected service', () => {
    const ui = dialog([
      { id: 'cut', name: 'Cut', price: 300, durationMin: 30 },
      { id: 'beard', name: 'Beard', price: 150.5, durationMin: 15 },
    ])
    ui.edit('invalid')
    ui.submit()
    ui.edit('123.45')
    expect(ui.price().props['aria-invalid']).toBe(false)
    ui.edit('invalid')
    ui.submit()
    const select = ui.render().find((node) => node.type === 'select')
    if (!select) throw new Error('Missing reservation service selector')
    ;(select.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'beard' } })
    expect(ui.price().props.value).toBe('150.5')
    expect(ui.price().props['aria-invalid']).toBe(false)
    ui.submit()
    expect(ui.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ price: 150.5, durationMin: 15, serviceName: 'Beard' }),
    )
  })
})
