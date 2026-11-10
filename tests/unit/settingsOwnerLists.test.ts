import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { palette } from '../../modules/public-web/src/booking/bookingStyles'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import { buildAdminStyles } from '../../modules/staff-admin/src/adminStyles'
import { ConfirmDialog } from '../../modules/staff-admin/src/ConfirmDialog'
import { invalidateAdminOperations } from '../../modules/staff-admin/src/orderedOperations'
import { err, ok } from '../../modules/staff-admin/src/types'
import { AuditLogSection } from '../../modules/staff-admin/src/views/AuditLogSection'
import { controlMark, rowMark } from '../../modules/staff-admin/src/views/ownerListFocus'
import { ReviewModerationSection } from '../../modules/staff-admin/src/views/ReviewModerationSection'
import { SettingsView } from '../../modules/staff-admin/src/views/SettingsView'
import {
  commit,
  hooks,
  mount,
  nodes,
  render as renderWithHooks,
  reset,
  type RenderedNode,
} from './helpers/fakeHooks'

const api = vi.hoisted(() => ({
  listReviews: vi.fn(),
  setReviewPublished: vi.fn(),
  deleteReview: vi.fn(),
  listAuditLog: vi.fn(),
  listSettings: vi.fn(),
  saveSetting: vi.fn(),
  /** The sections only say where the focus goes; nothing here has a page. */
  moveFocus: vi.fn(),
}))

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../modules/staff-admin/src/adminClient', () => {
  const noBackend = (): never => {
    throw new Error('This test reaches no backend')
  }
  return {
    getAdminClient: noBackend,
    getAdminAuthClient: noBackend,
    createAdminAuthOperationClient: noBackend,
    clearStoredAdminSession: noBackend,
  }
})
vi.mock('../../modules/staff-admin/src/adapters/reviewsAdmin', () => ({
  listReviews: api.listReviews,
  setReviewPublished: api.setReviewPublished,
  deleteReview: api.deleteReview,
}))
vi.mock('../../modules/staff-admin/src/adapters/auditLogAdmin', () => ({
  listAuditLog: api.listAuditLog,
}))
vi.mock('../../modules/staff-admin/src/useBarbers', () => ({
  useBarbers: () => ({
    barbers: [{ id: 'hassan', name: 'Hassan' }],
    loading: false,
    error: null,
    reload: async () => undefined,
  }),
}))

const s = buildAdminStyles(palette(false), false)
const sv = adminText('sv')
const en = adminText('en')

// The isolates around a name, by code point: written out they would be invisible here.
const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)

const anna = {
  id: 'r1',
  createdAt: '2026-11-10T13:05:00.654321+00:00',
  name: 'Anna S.',
  rating: 4,
  text: 'Bra klippning.',
  published: true,
}
const bo = {
  id: 'r2',
  createdAt: '2026-11-09T08:00:00.123456+00:00',
  name: 'Bo K.',
  rating: 2,
  text: 'Lång väntan.',
  published: false,
}
const carl = {
  id: 'r3',
  createdAt: '2026-11-08T08:00:00.123456+00:00',
  name: 'Carl L.',
  rating: 5,
  text: 'Toppen.',
  published: true,
}
const annaHidden = { ...anna, published: false }

const page = (entries: readonly unknown[], hasMore = false) => ok({ entries, hasMore })
const NO_ROWS = page([])
const DONE = ok(undefined)

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const unanswered: (() => void)[] = []

/** An answer the test gives when it chooses, or `atTheEnd` after the test: the sections queue
 *  their requests, so one left open would hold up the next test's. */
function held(atTheEnd: unknown) {
  let give: (answer: unknown) => void = () => undefined
  const promise = new Promise<unknown>((resolve) => {
    give = resolve
  })
  unanswered.push(() => give(atTheEnd))
  return { promise, answer: (value: unknown): void => give(value) }
}

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value !== 'object' || value === null || !('props' in value)) return ''
  const props = value.props
  return typeof props === 'object' && props !== null && 'children' in props
    ? textOf(props.children)
    : ''
}

function expand(node: RenderedNode): RenderedNode[] {
  const component = node.type
  if (typeof component !== 'function') throw new Error('Not a component node')
  return nodes(component(node.props))
}

function press(node: RenderedNode | undefined, handler = 'onClick'): void {
  const action = node?.props[handler]
  if (typeof action !== 'function') throw new Error(`Nothing to press: no ${handler}`)
  action()
}

const buttons = (tree: readonly RenderedNode[]): RenderedNode[] =>
  tree.filter((node) => node.type === 'button')
const button = (tree: readonly RenderedNode[], label: string): RenderedNode | undefined =>
  buttons(tree).find((node) => textOf(node) === label)
const rows = (tree: readonly RenderedNode[]): RenderedNode[] =>
  tree.filter((node) => node.type === 'li')
const statusLine = (tree: readonly RenderedNode[]): string =>
  textOf(tree.find((node) => node.props['aria-live'] === 'polite'))
const alertText = (tree: readonly RenderedNode[]): string =>
  textOf(tree.find((node) => node.props['role'] === 'alert'))
const dialog = (tree: readonly RenderedNode[]): RenderedNode | undefined =>
  tree.find((node) => node.type === ConfirmDialog)
const rowButtons = (tree: readonly RenderedNode[], index: number): RenderedNode[] =>
  buttons(nodes(rows(tree)[index]))

const focusTarget = (): unknown => api.moveFocus.mock.calls.at(-1)?.[0]
const onRow = (id: string, control: 'first' | 'visibility' | 'delete') => ({
  place: 'row',
  id,
  control,
})

function sectionUi(section: () => unknown) {
  /** Renders, then runs the effects, as the renderer does after each render. */
  const render = () => {
    const outer = nodes(renderWithHooks(section))
    const list = outer.find((node) => typeof node.type === 'function')
    const inner = list === undefined ? [] : expand(list)
    commit()
    return { outer, inner }
  }
  const toggle = (label: string) => {
    press(button(render().outer, label))
    return render()
  }
  const open = async (label: string) => {
    toggle(label)
    await flush()
    return render()
  }
  return { render, toggle, open }
}

const reviewsUi = (lang: 'sv' | 'en' = 'sv') =>
  sectionUi(() =>
    ReviewModerationSection({ dark: false, lang, s, headingStyle: {}, moveFocus: api.moveFocus }),
  )
const auditUi = (lang: 'sv' | 'en' = 'sv') =>
  sectionUi(() => AuditLogSection({ lang, s, headingStyle: {}, moveFocus: api.moveFocus }))

beforeEach(() => {
  reset()
  for (const mock of Object.values(api)) mock.mockReset()
})
afterEach(async () => {
  for (const answer of unanswered.splice(0)) answer()
  await flush()
})

describe('Settings as the owner opens it', () => {
  const settings = (role: 'owner' | 'barber') =>
    nodes(
      renderWithHooks(() =>
        SettingsView({
          dark: false,
          lang: 'sv',
          s,
          profile: {
            userId: 'user-1',
            email: 'staff@example.test',
            role,
            barberId: role === 'owner' ? null : 'hassan',
          },
          port: { list: api.listSettings, save: api.saveSetting },
        }),
      ),
    )

  it('places both sections after everything else and reads neither list', async () => {
    api.listSettings.mockResolvedValue(ok(new Map()))

    const tree = settings('owner')
    mount()
    await flush()

    const cancelForm = tree.findIndex(
      (node) => node.type === 'form' && node.props['aria-labelledby'] === 'settings-cancel-heading',
    )
    const reviews = tree.findIndex((node) => node.type === ReviewModerationSection)
    const audit = tree.findIndex((node) => node.type === AuditLogSection)
    expect(cancelForm).toBeGreaterThan(-1)
    expect(reviews).toBeGreaterThan(cancelForm)
    expect(audit).toBeGreaterThan(reviews)
    // Nothing that was in Settings before comes after the first new section.
    expect(
      tree.slice(reviews).filter((node) => ['form', 'input', 'h3'].includes(String(node.type))),
    ).toEqual([])
    expect(api.listSettings).toHaveBeenCalledOnce()
    expect(api.listReviews).not.toHaveBeenCalled()
    expect(api.listAuditLog).not.toHaveBeenCalled()
  })

  it('shows neither section to a barber', () => {
    const tree = settings('barber')

    expect(tree.some((node) => node.type === ReviewModerationSection)).toBe(false)
    expect(tree.some((node) => node.type === AuditLogSection)).toBe(false)
  })
})

describe('review moderation section', () => {
  it('reads nothing while it is closed', async () => {
    const view = reviewsUi().render()
    await flush()

    const toggle = button(view.outer, sv.reviewsOpen)
    expect(toggle?.props['aria-expanded']).toBe(false)
    expect(view.outer.some((node) => node.props['id'] === toggle?.props['aria-controls'])).toBe(
      true,
    )
    expect(view.inner).toEqual([])
    expect(api.listReviews).not.toHaveBeenCalled()
  })

  it('reads the first page when it is opened and shows every review with its state', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    const ui = reviewsUi()

    const view = await ui.open(sv.reviewsOpen)

    expect(api.listReviews.mock.calls).toEqual([[null]])
    expect(button(view.outer, sv.reviewsClose)?.props['aria-expanded']).toBe(true)
    expect(textOf(view.inner)).toContain(sv.reviewsHideHelp)
    const list = view.inner.find((node) => node.type === 'ul')
    expect(list?.props).toMatchObject({ role: 'list', 'aria-label': sv.reviewsListLabel })
    const [first, second] = rows(view.inner)
    expect(rows(view.inner)).toHaveLength(2)
    expect(textOf(first)).toBe(
      'Anna S.★★★★☆Publicerad10 november 2026, 14:05Bra klippning.DöljTa bort',
    )
    expect(textOf(second)).toBe(
      'Bo K.★★☆☆☆Dold9 november 2026, 09:00Lång väntan.Publicera igenTa bort',
    )
    const stars = nodes(first).find((node) => node.props['role'] === 'img')
    expect(stars?.props['aria-label']).toBe('Betyg 4 av 5')
    const [hide, remove] = buttons(nodes(first))
    expect(hide?.props['aria-label']).toBe(
      `Dölj recensionen från ${FSI}Anna S.${PDI}, 10 november 2026, 14:05`,
    )
    expect(remove?.props['aria-label']).toBe(
      `Ta bort recensionen från ${FSI}Anna S.${PDI}, 10 november 2026, 14:05`,
    )
    const help = view.inner.find((node) => node.props['id'] === hide?.props['aria-describedby'])
    expect(textOf(help)).toBe(sv.reviewsHideHelp)
    expect(buttons(nodes(second))[0]?.props['aria-describedby']).toBeUndefined()
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(api.moveFocus).not.toHaveBeenCalled()
  })

  it('marks what the focus can be sent to: the list, each row and each of its buttons', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo], true))

    const view = await reviewsUi().open(sv.reviewsOpen)

    // The list takes the focus when no row can, and is no Tab stop.
    expect(view.inner[0]?.props['tabIndex']).toBe(-1)
    const [first, second] = rows(view.inner)
    expect(first?.props).toMatchObject(rowMark('r1'))
    expect(second?.props).toMatchObject(rowMark('r2'))
    const [hide, remove] = buttons(nodes(first))
    expect(hide?.props).toMatchObject(controlMark('visibility'))
    expect(remove?.props).toMatchObject(controlMark('delete'))
    expect(button(view.inner, sv.ownerListLoadMore)?.props).toMatchObject(controlMark('more'))
  })

  it('shows a hidden review as hidden without reading the list again', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    const write = held(DONE)
    api.setReviewPublished.mockReturnValue(write.promise)
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[0])
    await flush()

    expect(api.setReviewPublished.mock.calls).toEqual([['r1', false]])
    expect(buttons(ui.render().inner).map((node) => node.props['disabled'])).toEqual([
      true,
      true,
      true,
      true,
    ])

    write.answer(DONE)
    await flush()
    // The focus is moved after the render that shows the answer, not before.
    expect(api.moveFocus).not.toHaveBeenCalled()
    const view = ui.render()

    expect(textOf(rows(view.inner)[0])).toBe(
      'Anna S.★★★★☆Dold10 november 2026, 14:05Bra klippning.Publicera igenTa bort',
    )
    expect(statusLine(view.inner)).toBe(sv.reviewsHiddenOk)
    expect(buttons(view.inner).map((node) => node.props['disabled'])).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(api.listReviews).toHaveBeenCalledOnce()
    expect(api.moveFocus).toHaveBeenCalledOnce()
    expect(focusTarget()).toEqual(onRow('r1', 'visibility'))
    ui.render()
    expect(api.moveFocus).toHaveBeenCalledOnce()
  })

  it('publishes a hidden review again', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    api.setReviewPublished.mockResolvedValue(DONE)
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 1)[0])
    await flush()
    const view = ui.render()

    expect(api.setReviewPublished.mock.calls).toEqual([['r2', true]])
    expect(textOf(rows(view.inner)[1])).toBe(
      'Bo K.★★☆☆☆Publicerad9 november 2026, 09:00Lång väntan.DöljTa bort',
    )
    expect(statusLine(view.inner)).toBe(sv.reviewsPublishedOk)
    expect(focusTarget()).toEqual(onRow('r2', 'visibility'))
  })

  it.each([
    ['forbidden', sv.ownerListForbidden],
    ['auth', sv.ownerListSessionExpired],
    ['validation', sv.reviewsInvalid],
  ] as const)(
    'leaves the row as it was, says why and reads nothing again when a hide is refused (%s)',
    async (kind, sentence) => {
      api.listReviews.mockResolvedValue(page([anna, bo]))
      api.setReviewPublished.mockResolvedValue(err(kind, 'adapter text'))
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      const before = textOf(rows(opened.inner)[0])

      press(rowButtons(opened.inner, 0)[0])
      await flush()
      const view = ui.render()

      expect(textOf(rows(view.inner)[0])).toBe(before)
      expect(rows(view.inner)).toHaveLength(2)
      expect(statusLine(view.inner)).toBe(sentence)
      expect(buttons(view.inner).every((node) => node.props['disabled'] === false)).toBe(true)
      // A refusal is a definite answer: the list is as it was.
      expect(api.listReviews).toHaveBeenCalledOnce()
      expect(focusTarget()).toEqual(onRow('r1', 'visibility'))
    },
  )

  it('starts one action when a button is pressed twice before the list has rendered again', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    api.setReviewPublished.mockResolvedValue(DONE)
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    // Both presses, and one on another row, reach the buttons of the same render.
    press(rowButtons(opened.inner, 0)[0])
    press(rowButtons(opened.inner, 0)[0])
    press(rowButtons(opened.inner, 1)[0])
    await flush()

    expect(api.setReviewPublished.mock.calls).toEqual([['r1', false]])
    press(rowButtons(ui.render().inner, 1)[0])
    await flush()
    expect(api.setReviewPublished.mock.calls).toEqual([
      ['r1', false],
      ['r2', true],
    ])
  })

  it('asks before deleting, says what deleting means and removes the row once it is done', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    const write = held(DONE)
    api.deleteReview.mockReturnValue(write.promise)
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[1])
    const asking = dialog(ui.render().inner)

    expect(api.deleteReview).not.toHaveBeenCalled()
    const [beforeName = '', afterName = ''] = sv.reviewsDeleteBody.split('{name}')
    expect(asking?.props).toMatchObject({
      title: 'Ta bort recensionen?',
      body: `${beforeName}${FSI}Anna S.${PDI}${afterName}`,
      confirmLabel: 'Ta bort',
      cancelLabel: 'Avbryt',
      danger: true,
      busy: false,
    })

    // Confirmed twice before the question has rendered again: one delete.
    press(asking, 'onConfirm')
    press(asking, 'onConfirm')
    await flush()
    const deleting = dialog(ui.render().inner)

    expect(api.deleteReview.mock.calls).toEqual([['r1']])
    expect(deleting?.props['busy']).toBe(true)
    press(deleting, 'onClose')
    expect(dialog(ui.render().inner)).toBeDefined()

    write.answer(DONE)
    await flush()
    const view = ui.render()

    expect(rows(view.inner).map(textOf)).toEqual([
      'Bo K.★★☆☆☆Dold9 november 2026, 09:00Lång väntan.Publicera igenTa bort',
    ])
    expect(dialog(view.inner)).toBeUndefined()
    expect(statusLine(view.inner)).toBe(sv.reviewsDeletedOk)
    expect(api.listReviews).toHaveBeenCalledOnce()
    expect(focusTarget()).toEqual(onRow('r2', 'first'))
  })

  it('goes to the row before, and to the section’s own button, as the last rows are deleted', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    api.deleteReview.mockResolvedValue(DONE)
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 1)[1])
    press(dialog(ui.render().inner), 'onConfirm')
    await flush()
    const one = ui.render()

    expect(focusTarget()).toEqual(onRow('r1', 'first'))

    press(rowButtons(one.inner, 0)[1])
    press(dialog(ui.render().inner), 'onConfirm')
    await flush()
    const none = ui.render()

    expect(rows(none.inner)).toEqual([])
    expect(focusTarget()).toEqual({ place: 'toggle' })
  })

  it('closes the question and keeps the row when a delete is refused', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    api.deleteReview.mockResolvedValue(err('forbidden', 'adapter text'))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[1])
    press(dialog(ui.render().inner), 'onConfirm')
    await flush()
    const view = ui.render()

    expect(dialog(view.inner)).toBeUndefined()
    expect(rows(view.inner)).toHaveLength(2)
    expect(statusLine(view.inner)).toBe(sv.ownerListForbidden)
    expect(buttons(view.inner).every((node) => node.props['disabled'] === false)).toBe(true)
    expect(focusTarget()).toEqual(onRow('r1', 'delete'))
  })

  it('deletes nothing when the owner closes the question', async () => {
    api.listReviews.mockResolvedValue(page([anna]))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[1])
    press(dialog(ui.render().inner), 'onClose')
    const view = ui.render()

    expect(dialog(view.inner)).toBeUndefined()
    expect(rows(view.inner)).toHaveLength(1)
    expect(api.deleteReview).not.toHaveBeenCalled()
    // The question itself hands the focus back to the button that opened it.
    expect(api.moveFocus).not.toHaveBeenCalled()
  })

  it('removes a row whose review is already gone and keeps the others', async () => {
    api.listReviews.mockResolvedValue(page([anna, bo]))
    api.setReviewPublished.mockResolvedValue(err('not_found', 'adapter text'))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[0])
    await flush()
    const view = ui.render()

    expect(rows(view.inner)).toHaveLength(1)
    expect(textOf(rows(view.inner)[0])).toContain('Bo K.')
    expect(statusLine(view.inner)).toBe(sv.reviewsGone)
    expect(api.listReviews).toHaveBeenCalledOnce()
    expect(focusTarget()).toEqual(onRow('r2', 'first'))
  })

  // No answer, or one that cannot be read: the database may have applied the action all the same.
  describe.each(['network', 'malformed', 'challenge'] as const)(
    'when the outcome of an action is not known (%s)',
    (kind) => {
      it('reads the list again from its first page and says both', async () => {
        const again = held(NO_ROWS)
        api.listReviews.mockResolvedValueOnce(page([anna, bo])).mockReturnValueOnce(again.promise)
        api.setReviewPublished.mockResolvedValue(err(kind, 'adapter text'))
        const ui = reviewsUi()
        const opened = await ui.open(sv.reviewsOpen)

        press(rowButtons(opened.inner, 0)[0])
        await flush()

        expect(api.listReviews.mock.calls).toEqual([[null], [null]])
        const reading = ui.render()
        expect(buttons(reading.inner).every((node) => node.props['disabled'] === true)).toBe(true)
        expect(statusLine(reading.inner)).toBe('')

        // The database had applied the hide.
        again.answer(page([annaHidden, bo]))
        await flush()
        const view = ui.render()

        expect(rows(view.inner).map(textOf)).toEqual([
          'Anna S.★★★★☆Dold10 november 2026, 14:05Bra klippning.Publicera igenTa bort',
          'Bo K.★★☆☆☆Dold9 november 2026, 09:00Lång väntan.Publicera igenTa bort',
        ])
        expect(statusLine(view.inner)).toBe(sv.reviewsOutcomeUnknownReloaded)
        expect(buttons(view.inner).every((node) => node.props['disabled'] === false)).toBe(true)
        expect(focusTarget()).toEqual(onRow('r1', 'visibility'))
      })

      it('shows a deleted row as gone when the list that was read again no longer holds it', async () => {
        api.listReviews.mockResolvedValueOnce(page([anna, bo])).mockResolvedValueOnce(page([bo]))
        api.deleteReview.mockResolvedValue(err(kind, 'adapter text'))
        const ui = reviewsUi()
        const opened = await ui.open(sv.reviewsOpen)

        press(rowButtons(opened.inner, 0)[1])
        press(dialog(ui.render().inner), 'onConfirm')
        await flush()
        const view = ui.render()

        expect(api.deleteReview).toHaveBeenCalledOnce()
        expect(dialog(view.inner)).toBeUndefined()
        expect(rows(view.inner).map(textOf)).toEqual([
          'Bo K.★★☆☆☆Dold9 november 2026, 09:00Lång väntan.Publicera igenTa bort',
        ])
        expect(statusLine(view.inner)).toBe(sv.reviewsOutcomeUnknownReloaded)
        expect(focusTarget()).toEqual(onRow('r2', 'first'))
      })

      it('says the list cannot be read and offers to try again when that read fails too', async () => {
        api.listReviews
          .mockResolvedValueOnce(page([anna, bo]))
          .mockResolvedValueOnce(err('network', 'adapter text'))
          .mockResolvedValueOnce(page([annaHidden, bo]))
        api.setReviewPublished.mockResolvedValue(err(kind, 'adapter text'))
        const ui = reviewsUi()
        const opened = await ui.open(sv.reviewsOpen)

        press(rowButtons(opened.inner, 0)[0])
        await flush()
        const failed = ui.render()

        // No row is shown in a state that may be untrue.
        expect(rows(failed.inner)).toEqual([])
        expect(statusLine(failed.inner)).toBe(sv.reviewsOutcomeUnknown)
        expect(alertText(failed.inner)).toBe(sv.reviewsLoadError)
        expect(focusTarget()).toEqual({ place: 'list' })

        press(button(failed.inner, sv.ownerListRetry))
        ui.render()
        await flush()
        const view = ui.render()

        expect(api.listReviews.mock.calls).toEqual([[null], [null], [null]])
        expect(rows(view.inner)).toHaveLength(2)
        expect(textOf(rows(view.inner)[0])).toContain('Dold')
      })
    },
  )

  it('drops a further page of the old list that answers after the list was read again', async () => {
    const again = held(NO_ROWS)
    api.listReviews
      .mockResolvedValueOnce(page([anna], true))
      .mockReturnValueOnce(again.promise)
      .mockResolvedValueOnce(page([carl]))
    api.setReviewPublished.mockResolvedValue(err('network', 'adapter text'))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(rowButtons(opened.inner, 0)[0])
    await flush()
    // "Show more" of the list that is about to be replaced, pressed while it is read again.
    press(button(ui.render().inner, sv.ownerListLoadMore))
    again.answer(page([bo]))
    await flush()
    const view = ui.render()

    // The page after the old cursor belongs to the old list: the new one ends where it says.
    expect(rows(view.inner).map(textOf)).toEqual([expect.stringContaining('Bo K.')])
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(focusTarget()).toEqual(onRow('r2', 'first'))
  })

  it('offers more only while more exist and continues from the page that was read', async () => {
    api.listReviews.mockResolvedValueOnce(page([anna], true)).mockResolvedValueOnce(page([bo]))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(api.listReviews.mock.calls).toEqual([
      [null],
      [{ before: '2026-11-10T13:05:00.654321+00:00', beforeId: 'r1' }],
    ])
    expect(rows(view.inner).map(textOf)).toEqual([
      expect.stringContaining('Anna S.'),
      expect.stringContaining('Bo K.'),
    ])
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(focusTarget()).toEqual(onRow('r2', 'first'))
  })

  it('reads one further page when "show more" is pressed twice before it has rendered again', async () => {
    api.listReviews
      .mockResolvedValueOnce(page([anna], true))
      .mockResolvedValueOnce(page([bo], true))
      .mockResolvedValueOnce(page([carl]))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(api.listReviews).toHaveBeenCalledTimes(2)
    expect(rows(view.inner)).toHaveLength(2)
    press(button(view.inner, sv.ownerListLoadMore))
    await flush()
    expect(api.listReviews.mock.calls[2]).toEqual([
      { before: '2026-11-09T08:00:00.123456+00:00', beforeId: 'r2' },
    ])
    expect(rows(ui.render().inner)).toHaveLength(3)
  })

  it('keeps what it shows when a further page cannot be read', async () => {
    api.listReviews
      .mockResolvedValueOnce(page([anna], true))
      .mockResolvedValueOnce(err('network', 'adapter text'))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(rows(view.inner)).toHaveLength(1)
    expect(statusLine(view.inner)).toBe(sv.reviewsLoadError)
    expect(button(view.inner, sv.ownerListLoadMore)?.props['disabled']).toBe(false)
    expect(focusTarget()).toEqual({ place: 'more' })
  })

  it('goes to the last row when a further page holds nothing and ends the list', async () => {
    api.listReviews.mockResolvedValueOnce(page([anna, bo], true)).mockResolvedValueOnce(page([]))
    const ui = reviewsUi()
    const opened = await ui.open(sv.reviewsOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(focusTarget()).toEqual(onRow('r2', 'first'))
  })

  it('says so when there are no reviews', async () => {
    api.listReviews.mockResolvedValue(page([]))

    const view = await reviewsUi().open(sv.reviewsOpen)

    expect(textOf(view.inner)).toContain(sv.reviewsEmpty)
    expect(view.inner.some((node) => node.type === 'ul')).toBe(false)
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
  })

  it.each([
    ['forbidden', sv.ownerListForbidden],
    ['auth', sv.ownerListSessionExpired],
    ['network', sv.reviewsLoadError],
  ] as const)(
    'says why the list cannot be read (%s) and reads it again when asked to',
    async (kind, sentence) => {
      api.listReviews
        .mockResolvedValueOnce(err(kind, 'adapter text'))
        .mockResolvedValueOnce(page([anna]))
      const ui = reviewsUi()

      const view = await ui.open(sv.reviewsOpen)

      expect(alertText(view.inner)).toBe(sentence)
      expect(textOf(view.inner)).not.toContain('adapter text')
      expect(rows(view.inner)).toEqual([])
      ui.render()
      await flush()
      expect(api.listReviews).toHaveBeenCalledOnce()

      press(button(view.inner, sv.ownerListRetry))
      // The render after the press starts the read; the one after that shows it.
      ui.render()
      const reading = ui.render()

      expect(button(reading.inner, sv.ownerListRetry)).toBeUndefined()
      expect(focusTarget()).toEqual({ place: 'list' })

      await flush()
      const read = ui.render()

      expect(api.listReviews.mock.calls).toEqual([[null], [null]])
      expect(rows(read.inner)).toHaveLength(1)
      expect(alertText(read.inner)).toBe('')
    },
  )

  it('says the session has ended when it ends while the list is read', async () => {
    const read = held(NO_ROWS)
    api.listReviews.mockReturnValue(read.promise)
    const ui = reviewsUi()
    ui.toggle(sv.reviewsOpen)
    await flush()

    invalidateAdminOperations()
    read.answer(page([anna]))
    await flush()
    const view = ui.render()

    expect(rows(view.inner)).toEqual([])
    expect(alertText(view.inner)).toBe(sv.ownerListSessionExpired)
  })

  it('reads nothing more once it is closed again', async () => {
    api.listReviews.mockResolvedValue(page([anna]))
    const ui = reviewsUi()
    await ui.open(sv.reviewsOpen)

    const view = ui.toggle(sv.reviewsClose)
    await flush()

    expect(button(view.outer, sv.reviewsOpen)?.props['aria-expanded']).toBe(false)
    expect(view.inner).toEqual([])
    expect(api.listReviews).toHaveBeenCalledOnce()
  })

  // A closed list's pending answers must not reach a later list.
  describe('once it is closed', () => {
    it('ignores the first page when it arrives', async () => {
      const read = held(NO_ROWS)
      api.listReviews.mockReturnValue(read.promise)
      const ui = reviewsUi()
      ui.toggle(sv.reviewsOpen)
      await flush()
      ui.toggle(sv.reviewsClose)
      const before = structuredClone(hooks.values)

      read.answer(page([anna]))
      await flush()

      expect(hooks.values).toEqual(before)
    })

    it('ignores a further page when it arrives', async () => {
      const more = held(NO_ROWS)
      api.listReviews.mockResolvedValueOnce(page([anna], true)).mockReturnValueOnce(more.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(button(opened.inner, sv.ownerListLoadMore))
      await flush()
      ui.toggle(sv.reviewsClose)
      const before = structuredClone(hooks.values)

      more.answer(page([bo]))
      await flush()

      expect(hooks.values).toEqual(before)
      expect(api.moveFocus).not.toHaveBeenCalled()
    })

    it.each([
      ['done', DONE],
      ['refused', err('forbidden', 'adapter text')],
      ['gone', err('not_found', 'adapter text')],
    ])('ignores the answer of an action that is %s', async (_, answer) => {
      const write = held(DONE)
      api.listReviews.mockResolvedValue(page([anna, bo]))
      api.setReviewPublished.mockReturnValue(write.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(rowButtons(opened.inner, 0)[0])
      await flush()
      ui.toggle(sv.reviewsClose)
      const before = structuredClone(hooks.values)

      write.answer(answer)
      await flush()

      expect(hooks.values).toEqual(before)
      expect(api.moveFocus).not.toHaveBeenCalled()
    })

    it('reads no list again for an action whose outcome is not known', async () => {
      const write = held(DONE)
      api.listReviews.mockResolvedValue(page([anna, bo]))
      api.setReviewPublished.mockReturnValue(write.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(rowButtons(opened.inner, 0)[0])
      await flush()
      ui.toggle(sv.reviewsClose)
      const before = structuredClone(hooks.values)

      write.answer(err('network', 'adapter text'))
      await flush()

      // There is no list left to show what the row is now.
      expect(api.listReviews).toHaveBeenCalledOnce()
      expect(hooks.values).toEqual(before)
    })

    it('shows only its own read when it is opened again while the first is still under way', async () => {
      const first = held(NO_ROWS)
      const second = held(NO_ROWS)
      api.listReviews.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      const ui = reviewsUi()
      ui.toggle(sv.reviewsOpen)
      await flush()
      ui.toggle(sv.reviewsClose)
      ui.toggle(sv.reviewsOpen)

      first.answer(page([anna]))
      await flush()
      const waiting = ui.render()

      expect(rows(waiting.inner)).toEqual([])
      expect(textOf(waiting.inner.find((node) => node.props['role'] === 'status'))).toBe(
        sv.reviewsLoading,
      )

      second.answer(page([bo]))
      await flush()

      expect(rows(ui.render().inner).map(textOf)).toEqual([expect.stringContaining('Bo K.')])
    })
  })

  // A list never shows data older than a write still running when it read.
  describe('order of its reads and writes', () => {
    it('reads a list that is opened again only after a write that is still running', async () => {
      const write = held(DONE)
      api.listReviews
        .mockResolvedValueOnce(page([anna, bo]))
        .mockResolvedValueOnce(page([annaHidden, bo]))
      api.setReviewPublished.mockReturnValue(write.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(rowButtons(opened.inner, 0)[0])
      await flush()

      ui.toggle(sv.reviewsClose)
      ui.toggle(sv.reviewsOpen)
      await flush()

      expect(api.listReviews).toHaveBeenCalledOnce()

      write.answer(DONE)
      await flush()

      expect(api.listReviews.mock.calls).toEqual([[null], [null]])
      expect(textOf(rows(ui.render().inner)[0])).toContain('Dold')
    })

    it('reads a further page only after a write that is still running, and keeps what the write did', async () => {
      const write = held(DONE)
      api.listReviews.mockResolvedValueOnce(page([anna], true)).mockResolvedValueOnce(page([bo]))
      api.setReviewPublished.mockReturnValue(write.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(rowButtons(opened.inner, 0)[0])
      await flush()

      press(button(opened.inner, sv.ownerListLoadMore))
      await flush()

      expect(api.listReviews).toHaveBeenCalledOnce()

      write.answer(DONE)
      await flush()
      const view = ui.render()

      expect(api.listReviews).toHaveBeenCalledTimes(2)
      expect(rows(view.inner).map(textOf)).toEqual([
        'Anna S.★★★★☆Dold10 november 2026, 14:05Bra klippning.Publicera igenTa bort',
        expect.stringContaining('Bo K.'),
      ])
    })

    it('starts an action only after a further page that is still being read', async () => {
      const more = held(NO_ROWS)
      api.listReviews.mockResolvedValueOnce(page([anna], true)).mockReturnValueOnce(more.promise)
      api.setReviewPublished.mockResolvedValue(DONE)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(button(opened.inner, sv.ownerListLoadMore))
      await flush()

      press(rowButtons(opened.inner, 0)[0])
      await flush()

      expect(api.setReviewPublished).not.toHaveBeenCalled()

      more.answer(page([bo]))
      await flush()

      expect(api.setReviewPublished.mock.calls).toEqual([['r1', false]])
    })

    it('reads the list again only after a further page that was asked for before it', async () => {
      const write = held(DONE)
      const more = held(NO_ROWS)
      api.listReviews
        .mockResolvedValueOnce(page([anna], true))
        .mockReturnValueOnce(more.promise)
        .mockResolvedValueOnce(page([annaHidden, bo]))
      api.setReviewPublished.mockReturnValue(write.promise)
      const ui = reviewsUi()
      const opened = await ui.open(sv.reviewsOpen)
      press(rowButtons(opened.inner, 0)[0])
      await flush()
      press(button(opened.inner, sv.ownerListLoadMore))

      // An unreadable write answer: the list is read again, after the page.
      write.answer(err('network', 'adapter text'))
      await flush()

      const cursor = { before: '2026-11-10T13:05:00.654321+00:00', beforeId: 'r1' }
      expect(api.listReviews.mock.calls).toEqual([[null], [cursor]])

      more.answer(page([bo]))
      await flush()
      const view = ui.render()

      expect(api.listReviews.mock.calls).toEqual([[null], [cursor], [null]])
      expect(rows(view.inner)).toHaveLength(2)
      expect(textOf(rows(view.inner)[0])).toContain('Dold')
      expect(statusLine(view.inner)).toBe(sv.reviewsOutcomeUnknownReloaded)
    })
  })

  it('reads in English when the panel does', async () => {
    api.listReviews.mockResolvedValue(page([anna]))

    const view = await reviewsUi('en').open(en.reviewsOpen)

    expect(textOf(view.inner)).toContain(en.reviewsHideHelp)
    expect(textOf(rows(view.inner)[0])).toBe(
      'Anna S.★★★★☆Published10 November 2026, 14:05Bra klippning.HideDelete',
    )
    expect(buttons(nodes(rows(view.inner)[0]))[0]?.props['aria-label']).toBe(
      `Hide the review from ${FSI}Anna S.${PDI}, 10 November 2026, 14:05`,
    )
  })

  it('says in English what is known after an action whose answer never came', async () => {
    api.listReviews.mockResolvedValueOnce(page([anna])).mockResolvedValueOnce(page([annaHidden]))
    api.setReviewPublished.mockResolvedValue(err('network', 'adapter text'))
    const ui = reviewsUi('en')
    const opened = await ui.open(en.reviewsOpen)

    press(rowButtons(opened.inner, 0)[0])
    await flush()

    expect(statusLine(ui.render().inner)).toBe(en.reviewsOutcomeUnknownReloaded)
  })
})

describe('admin log section', () => {
  const update = {
    id: 'a1',
    createdAt: '2026-11-10T13:05:00.654321+00:00',
    actor: { kind: 'owner' },
    change: { action: 'update', changedColumns: ['published'] },
    targetTable: 'reviews',
    targetId: '55555555-5555-4555-8555-555555555551',
  }
  const insert = {
    id: 'a2',
    createdAt: '2026-11-09T08:00:00.123456+00:00',
    actor: { kind: 'barber', barberId: 'hassan' },
    change: { action: 'insert' },
    targetTable: 'barber_time_off',
    targetId: '88888888-8888-4888-8888-888888888881',
  }
  const cursor = { before: '2026-11-10T13:05:00.654321+00:00', beforeId: 'a1' }

  it('reads nothing while it is closed', async () => {
    const view = auditUi().render()
    await flush()

    expect(button(view.outer, sv.auditOpen)?.props['aria-expanded']).toBe(false)
    expect(view.inner).toEqual([])
    expect(api.listAuditLog).not.toHaveBeenCalled()
  })

  it('reads the first page when it is opened and shows who did what to which row', async () => {
    api.listAuditLog.mockResolvedValue(page([update, insert]))

    const view = await auditUi().open(sv.auditOpen)

    expect(api.listAuditLog.mock.calls).toEqual([[null]])
    expect(textOf(view.inner)).toContain(sv.auditRetention)
    const list = view.inner.find((node) => node.type === 'ul')
    expect(list?.props).toMatchObject({ role: 'list', 'aria-label': sv.auditListLabel })
    expect(rows(view.inner).map(textOf)).toEqual([
      'ÄgareÄndrade recension10 november 2026, 14:05Ändrade fält: publishedId: 55555555-5555-4555-8555-555555555551',
      'Barberare HassanSkapade ledighet9 november 2026, 09:00Id: 88888888-8888-4888-8888-888888888881',
    ])
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(api.moveFocus).not.toHaveBeenCalled()
  })

  it('shows an entry whose action and role it has no name for instead of hiding the page', async () => {
    const unknown = {
      ...update,
      id: 'a3',
      actor: { kind: 'unknown', role: 'manager' },
      change: { action: 'unknown', name: 'merge', changedColumns: ['text'] },
    }
    api.listAuditLog.mockResolvedValue(page([unknown, insert]))

    const view = await auditUi().open(sv.auditOpen)

    expect(rows(view.inner).map(textOf)).toEqual([
      'Personal (manager)Okänd åtgärd (merge): recension10 november 2026, 14:05Ändrade fält: textId: 55555555-5555-4555-8555-555555555551',
      'Barberare HassanSkapade ledighet9 november 2026, 09:00Id: 88888888-8888-4888-8888-888888888881',
    ])
  })

  it('marks what the focus can be sent to: the list, each entry and "show more"', async () => {
    api.listAuditLog.mockResolvedValue(page([update, insert], true))

    const view = await auditUi().open(sv.auditOpen)

    expect(view.inner[0]?.props['tabIndex']).toBe(-1)
    // An entry has no button, so it takes the focus itself; it is no stop for the Tab key.
    expect(rows(view.inner).map((row) => row.props['tabIndex'])).toEqual([-1, -1])
    expect(rows(view.inner)[0]?.props).toMatchObject(rowMark('a1'))
    expect(rows(view.inner)[1]?.props).toMatchObject(rowMark('a2'))
    expect(button(view.inner, sv.ownerListLoadMore)?.props).toMatchObject(controlMark('more'))
  })

  it('continues from the last entry and keeps what it shows when that read fails', async () => {
    api.listAuditLog
      .mockResolvedValueOnce(page([update], true))
      .mockResolvedValueOnce(err('network', 'adapter text'))
      .mockResolvedValueOnce(page([insert]))
    const ui = auditUi()
    const opened = await ui.open(sv.auditOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const failed = ui.render()

    expect(rows(failed.inner)).toHaveLength(1)
    expect(statusLine(failed.inner)).toBe(sv.auditLoadError)
    expect(focusTarget()).toEqual({ place: 'more' })

    press(button(failed.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(api.listAuditLog.mock.calls).toEqual([[null], [cursor], [cursor]])
    expect(rows(view.inner)).toHaveLength(2)
    expect(statusLine(view.inner)).toBe('')
    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(focusTarget()).toEqual(onRow('a2', 'first'))
  })

  it('goes to the last entry when a further page holds nothing and ends the log', async () => {
    api.listAuditLog.mockResolvedValueOnce(page([update], true)).mockResolvedValueOnce(page([]))
    const ui = auditUi()
    const opened = await ui.open(sv.auditOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()
    const view = ui.render()

    expect(button(view.inner, sv.ownerListLoadMore)).toBeUndefined()
    expect(focusTarget()).toEqual(onRow('a1', 'first'))
  })

  it('reads one further page when "show more" is pressed twice before it has rendered again', async () => {
    api.listAuditLog
      .mockResolvedValueOnce(page([update], true))
      .mockResolvedValueOnce(page([insert]))
    const ui = auditUi()
    const opened = await ui.open(sv.auditOpen)

    press(button(opened.inner, sv.ownerListLoadMore))
    press(button(opened.inner, sv.ownerListLoadMore))
    await flush()

    expect(api.listAuditLog.mock.calls).toEqual([[null], [cursor]])
    expect(rows(ui.render().inner)).toHaveLength(2)
  })

  it('says so when the log is empty', async () => {
    api.listAuditLog.mockResolvedValueOnce(page([]))

    const empty = await auditUi().open(sv.auditOpen)

    expect(textOf(empty.inner)).toContain(sv.auditEmpty)
    expect(empty.inner.some((node) => node.type === 'ul')).toBe(false)
  })

  it.each([
    ['forbidden', sv.ownerListForbidden],
    ['auth', sv.ownerListSessionExpired],
    ['malformed', sv.auditLoadError],
  ] as const)(
    'says why the log cannot be read (%s) and reads it again when asked to',
    async (kind, sentence) => {
      api.listAuditLog
        .mockResolvedValueOnce(err(kind, 'adapter text'))
        .mockResolvedValueOnce(page([update]))
      const ui = auditUi()

      const refused = await ui.open(sv.auditOpen)

      expect(alertText(refused.inner)).toBe(sentence)
      expect(textOf(refused.inner)).not.toContain('adapter text')
      ui.render()
      await flush()
      expect(api.listAuditLog).toHaveBeenCalledOnce()

      press(button(refused.inner, sv.ownerListRetry))
      // The render after the press starts the read; the one after that shows it.
      ui.render()
      const reading = ui.render()

      expect(button(reading.inner, sv.ownerListRetry)).toBeUndefined()
      expect(focusTarget()).toEqual({ place: 'list' })

      await flush()
      const read = ui.render()

      expect(api.listAuditLog.mock.calls).toEqual([[null], [null]])
      expect(rows(read.inner)).toHaveLength(1)
      expect(alertText(read.inner)).toBe('')
    },
  )

  it('says the session has ended when it ends while the log is read', async () => {
    const read = held(NO_ROWS)
    api.listAuditLog.mockReturnValue(read.promise)
    const ui = auditUi()
    ui.toggle(sv.auditOpen)
    await flush()

    invalidateAdminOperations()
    read.answer(page([update]))
    await flush()
    const view = ui.render()

    expect(rows(view.inner)).toEqual([])
    expect(alertText(view.inner)).toBe(sv.ownerListSessionExpired)
  })

  describe('once it is closed', () => {
    it('ignores the first page when it arrives', async () => {
      const read = held(NO_ROWS)
      api.listAuditLog.mockReturnValue(read.promise)
      const ui = auditUi()
      ui.toggle(sv.auditOpen)
      await flush()
      ui.toggle(sv.auditClose)
      const before = structuredClone(hooks.values)

      read.answer(page([update]))
      await flush()

      expect(hooks.values).toEqual(before)
    })

    it('ignores a further page when it arrives', async () => {
      const more = held(NO_ROWS)
      api.listAuditLog.mockResolvedValueOnce(page([update], true)).mockReturnValueOnce(more.promise)
      const ui = auditUi()
      const opened = await ui.open(sv.auditOpen)
      press(button(opened.inner, sv.ownerListLoadMore))
      await flush()
      ui.toggle(sv.auditClose)
      const before = structuredClone(hooks.values)

      more.answer(page([insert]))
      await flush()

      expect(hooks.values).toEqual(before)
      expect(api.moveFocus).not.toHaveBeenCalled()
    })

    it('reads a log that is opened again only after a further page that is still being read', async () => {
      const more = held(NO_ROWS)
      api.listAuditLog
        .mockResolvedValueOnce(page([update], true))
        .mockReturnValueOnce(more.promise)
        .mockResolvedValueOnce(page([insert]))
      const ui = auditUi()
      const opened = await ui.open(sv.auditOpen)
      press(button(opened.inner, sv.ownerListLoadMore))
      await flush()

      ui.toggle(sv.auditClose)
      ui.toggle(sv.auditOpen)
      await flush()

      expect(api.listAuditLog.mock.calls).toEqual([[null], [cursor]])

      more.answer(page([update]))
      await flush()
      const view = ui.render()

      expect(api.listAuditLog.mock.calls).toEqual([[null], [cursor], [null]])
      expect(rows(view.inner).map(textOf)).toEqual([expect.stringContaining('Barberare Hassan')])
    })
  })

  it('reads in English when the panel does', async () => {
    api.listAuditLog.mockResolvedValue(page([update]))

    const view = await auditUi('en').open(en.auditOpen)

    expect(textOf(view.inner)).toContain(en.auditRetention)
    expect(rows(view.inner).map(textOf)).toEqual([
      'OwnerChanged review10 November 2026, 14:05Changed fields: publishedId: 55555555-5555-4555-8555-555555555551',
    ])
  })
})
