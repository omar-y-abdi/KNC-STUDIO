import { describe, expect, it } from 'vitest'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import type { AdminError } from '../../modules/staff-admin/src/types'
import {
  appendPage,
  cursorAfter,
  fillSlot,
  instantLabel,
  ownerListErrorText,
} from '../../modules/staff-admin/src/views/ownerLists'

const LANGS = ['sv', 'en'] as const

const entry = (id: string, createdAt: string) => ({ id, createdAt })
const newest = entry('a', '2026-11-10T13:05:00.654321+00:00')
const middle = entry('b', '2026-11-10T13:05:00.654321+00:00')
const oldest = entry('c', '2026-11-09T08:00:00.123456+00:00')

describe('owner list paging', () => {
  it('continues after the last entry of the page, timestamp verbatim, while more rows exist', () => {
    expect(cursorAfter({ entries: [newest, middle, oldest], hasMore: true })).toEqual({
      before: '2026-11-09T08:00:00.123456+00:00',
      beforeId: 'c',
    })
    // Two entries of one instant: the id is what tells them apart.
    expect(cursorAfter({ entries: [newest, middle], hasMore: true })).toEqual({
      before: '2026-11-10T13:05:00.654321+00:00',
      beforeId: 'b',
    })
  })

  it('ends the list when the server says no more rows exist', () => {
    expect(cursorAfter({ entries: [newest, oldest], hasMore: false })).toBeNull()
    expect(cursorAfter({ entries: [], hasMore: false })).toBeNull()
  })

  it('ends the list when a page claims more rows but holds none to continue from', () => {
    expect(cursorAfter({ entries: [], hasMore: true })).toBeNull()
  })

  it('appends a page after what was read and takes the cursor from that page', () => {
    const first = appendPage([], { entries: [newest, middle], hasMore: true })
    expect(first).toEqual({
      entries: [newest, middle],
      next: { before: middle.createdAt, beforeId: 'b' },
    })

    const second = appendPage(first.entries, { entries: [oldest], hasMore: false })
    expect(second).toEqual({ entries: [newest, middle, oldest], next: null })
  })

  it('keeps the cursor of the page that was read when its last row has left the list', () => {
    // The owner deleted `middle` from the first page before asking for more.
    const afterDelete = [newest]
    const next = appendPage(afterDelete, { entries: [oldest], hasMore: true })
    expect(next).toEqual({
      entries: [newest, oldest],
      next: { before: oldest.createdAt, beforeId: 'c' },
    })
  })

  it('does not change the list it was given', () => {
    const shown = [newest]
    appendPage(shown, { entries: [oldest], hasMore: false })
    expect(shown).toEqual([newest])
  })
})

describe.each(LANGS)('owner list failure text (%s)', (lang) => {
  const t = adminText(lang)
  const error = (kind: AdminError['kind']): AdminError => ({ kind, message: 'adapter text' })

  it('says the action is the owner’s when the database refused the caller', () => {
    expect(ownerListErrorText(error('forbidden'), 'fallback', t)).toBe(t.ownerListForbidden)
  })

  it('says the session has ended when it has', () => {
    expect(ownerListErrorText(error('auth'), 'fallback', t)).toBe(t.ownerListSessionExpired)
  })

  it.each(['not_found', 'validation', 'network', 'malformed', 'challenge'] as const)(
    'says what was attempted for a %s failure, never the adapter’s own text',
    (kind) => {
      expect(ownerListErrorText(error(kind), 'fallback', t)).toBe('fallback')
    },
  )
})

describe('owner list failure text, both languages', () => {
  it('differs between the languages and is never empty', () => {
    const sv = adminText('sv')
    const en = adminText('en')
    for (const key of [
      'ownerListForbidden',
      'ownerListSessionExpired',
      'ownerListLoadMore',
      'ownerListLoadingMore',
      'ownerListRetry',
    ] as const) {
      expect(sv[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
      expect(sv[key], key).not.toBe(en[key])
    }
  })
})

describe('slot filling', () => {
  it('puts the value at the slot', () => {
    expect(fillSlot('Betyg {rating} av 5', '{rating}', '4')).toBe('Betyg 4 av 5')
  })

  it('takes the value literally, also when it holds a replacement pattern', () => {
    expect(fillSlot('Från {name}.', '{name}', '$& $1 $$')).toBe('Från $& $1 $$.')
  })

  it('leaves a template without the slot as it is', () => {
    expect(fillSlot('Ingen plats här', '{name}', 'Anna')).toBe('Ingen plats här')
  })

  it('fills the slot once: where the template names it first', () => {
    expect(fillSlot('{name} och {name}', '{name}', 'Anna')).toBe('Anna och {name}')
  })
})

describe('stored instant label', () => {
  it('reads in salon time with the year, in winter and in summer', () => {
    // 13:05 UTC is 14:05 in Stockholm in November (UTC+1) and 15:05 in July (UTC+2).
    expect(instantLabel('sv', '2026-11-10T13:05:00.654321+00:00')).toBe('10 november 2026, 14:05')
    expect(instantLabel('en', '2026-11-10T13:05:00.654321+00:00')).toBe('10 November 2026, 14:05')
    expect(instantLabel('sv', '2026-07-01T13:05:00+00:00')).toBe('1 juli 2026, 15:05')
  })

  it('names the salon’s day when the instant is the day before in UTC', () => {
    expect(instantLabel('sv', '2026-12-31T23:30:00+00:00')).toBe('1 januari 2027, 00:30')
  })

  it('pads the hour and the minute', () => {
    expect(instantLabel('en', '2026-03-05T06:07:00+00:00')).toBe('5 March 2026, 07:07')
  })

  it('returns text that is no instant as it is', () => {
    expect(instantLabel('sv', 'not a date')).toBe('not a date')
  })
})
