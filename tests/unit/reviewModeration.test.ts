import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AdminReview } from '../../modules/staff-admin/src/adapters/reviewsAdmin'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import type { AdminError, AdminResult } from '../../modules/staff-admin/src/types'
import {
  entriesAfterReviewAction,
  isolatedName,
  questionName,
  ratingStars,
  reviewActionMessage,
  reviewActionName,
  reviewDeleteQuestion,
  reviewOutcomeIsKnown,
  visibilityAction,
} from '../../modules/staff-admin/src/views/reviewModeration'

const LANGS = ['sv', 'en'] as const
const ACTIONS = ['hide', 'publish', 'delete'] as const

// Direction marks, by their code points: written out they would be invisible here.
/** FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE. */
const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
/** RIGHT-TO-LEFT OVERRIDE: reverses the text after it. */
const RLO = String.fromCodePoint(0x202e)

const review = (id: string, published: boolean, name = 'Anna S.'): AdminReview => ({
  id,
  createdAt: '2026-11-10T13:05:00.654321+00:00',
  name,
  rating: 4,
  text: 'Bra klippning.',
  published,
})

const done: AdminResult<void> = { ok: true, value: undefined }
const failed = (kind: AdminError['kind']): AdminResult<void> => ({
  ok: false,
  error: { kind, message: 'adapter text' },
})

describe('review row action', () => {
  it('offers hiding for a published review and publishing for a hidden one', () => {
    expect(visibilityAction(review('a', true))).toBe('hide')
    expect(visibilityAction(review('a', false))).toBe('publish')
  })
})

describe('review rows after an action', () => {
  const rows = [review('a', true), review('b', false), review('c', true)]

  it('shows a hidden review as hidden and leaves the other rows alone', () => {
    expect(entriesAfterReviewAction(rows, 'a', 'hide', done)).toEqual([
      review('a', false),
      review('b', false),
      review('c', true),
    ])
  })

  it('shows a review that was published again as published', () => {
    expect(entriesAfterReviewAction(rows, 'b', 'publish', done)).toEqual([
      review('a', true),
      review('b', true),
      review('c', true),
    ])
  })

  it('removes a deleted review and keeps the order of the rest', () => {
    expect(entriesAfterReviewAction(rows, 'b', 'delete', done)).toEqual([
      review('a', true),
      review('c', true),
    ])
  })

  it.each(['hide', 'publish', 'delete'] as const)(
    'leaves every row as it was when %s failed',
    (action) => {
      for (const kind of ['forbidden', 'auth', 'validation', 'network', 'malformed'] as const) {
        // The same array: the view has nothing to render anew.
        expect(entriesAfterReviewAction(rows, 'a', action, failed(kind))).toBe(rows)
      }
    },
  )

  it.each(['hide', 'publish', 'delete'] as const)(
    'removes the row when %s found the review gone, as it is in the database',
    (action) => {
      expect(entriesAfterReviewAction(rows, 'a', action, failed('not_found'))).toEqual([
        review('b', false),
        review('c', true),
      ])
    },
  )

  it('does not change the rows it was given', () => {
    const before = structuredClone(rows)
    entriesAfterReviewAction(rows, 'a', 'hide', done)
    entriesAfterReviewAction(rows, 'a', 'delete', done)
    expect(rows).toEqual(before)
  })

  it('changes nothing for an id the list does not hold', () => {
    expect(entriesAfterReviewAction(rows, 'z', 'hide', done)).toEqual(rows)
    expect(entriesAfterReviewAction(rows, 'z', 'delete', done)).toEqual(rows)
  })
})

describe.each(LANGS)('review status line (%s)', (lang) => {
  const t = adminText(lang)

  it('confirms each action in its own words', () => {
    for (const listReadAgain of [true, false]) {
      expect(reviewActionMessage('hide', done, listReadAgain, t)).toEqual({
        kind: 'ok',
        text: t.reviewsHiddenOk,
      })
      expect(reviewActionMessage('publish', done, listReadAgain, t)).toEqual({
        kind: 'ok',
        text: t.reviewsPublishedOk,
      })
      expect(reviewActionMessage('delete', done, listReadAgain, t)).toEqual({
        kind: 'ok',
        text: t.reviewsDeletedOk,
      })
    }
    expect(new Set([t.reviewsHiddenOk, t.reviewsPublishedOk, t.reviewsDeletedOk]).size).toBe(3)
  })

  it.each(ACTIONS)('says why a %s was refused, each refusal in its own sentence', (action) => {
    const refusals = [
      ['forbidden', t.ownerListForbidden],
      ['auth', t.ownerListSessionExpired],
      ['not_found', t.reviewsGone],
      ['validation', t.reviewsInvalid],
    ] as const
    for (const [kind, text] of refusals) {
      // A refusal is a definite answer: whether a list was read again changes nothing.
      expect(reviewActionMessage(action, failed(kind), true, t)).toEqual({ kind: 'err', text })
      expect(reviewActionMessage(action, failed(kind), false, t)).toEqual({ kind: 'err', text })
    }
  })

  it.each(ACTIONS)(
    'says the outcome of a %s is not known when its answer never came or cannot be read',
    (action) => {
      for (const kind of ['network', 'malformed', 'challenge'] as const) {
        expect(reviewActionMessage(action, failed(kind), true, t)).toEqual({
          kind: 'err',
          text: t.reviewsOutcomeUnknownReloaded,
        })
        expect(reviewActionMessage(action, failed(kind), false, t)).toEqual({
          kind: 'err',
          text: t.reviewsOutcomeUnknown,
        })
      }
    },
  )

  it('has a sentence of its own for every failure', () => {
    const sentences = [
      t.ownerListForbidden,
      t.ownerListSessionExpired,
      t.reviewsGone,
      t.reviewsInvalid,
      t.reviewsOutcomeUnknownReloaded,
      t.reviewsOutcomeUnknown,
    ]
    expect(new Set(sentences).size).toBe(sentences.length)
    for (const sentence of sentences) expect(sentence.trim()).not.toBe('')
  })

  it('names no action in a sentence that follows all three', () => {
    const actionWords =
      lang === 'sv'
        ? ['uppdatera', 'dölj', 'dold', 'publicer', 'visa', 'ta bort', 'borttag', 'radera']
        : ['update', 'hide', 'hidden', 'publish', 'show', 'delete', 'remove']
    for (const sentence of [
      t.reviewsInvalid,
      t.reviewsOutcomeUnknownReloaded,
      t.reviewsOutcomeUnknown,
      t.reviewsGone,
    ]) {
      for (const word of actionWords) expect(sentence.toLowerCase(), sentence).not.toContain(word)
    }
  })

  it('asks for another try only where the list was not read again', () => {
    const again = lang === 'sv' ? 'försök igen' : 'try again'
    // A refused request is refused again; a list that was read again shows what is true now.
    expect(t.reviewsInvalid.toLowerCase()).not.toContain(again)
    expect(t.reviewsOutcomeUnknownReloaded.toLowerCase()).not.toContain(again)
  })

  it('never shows the adapter’s own text', () => {
    const kinds = [
      'forbidden',
      'auth',
      'not_found',
      'validation',
      'network',
      'malformed',
      'challenge',
    ] as const
    for (const kind of kinds) {
      expect(reviewActionMessage('hide', failed(kind), true, t).text).not.toContain('adapter text')
      expect(reviewActionMessage('hide', failed(kind), false, t).text).not.toContain('adapter text')
    }
  })
})

describe('review action outcome', () => {
  it('is known when the action was done, found the review gone or was refused', () => {
    expect(reviewOutcomeIsKnown(done)).toBe(true)
    for (const kind of ['not_found', 'forbidden', 'auth', 'validation'] as const) {
      expect(reviewOutcomeIsKnown(failed(kind)), kind).toBe(true)
    }
  })

  it('is not known when the answer never came or cannot be read', () => {
    for (const kind of ['network', 'malformed', 'challenge'] as const) {
      expect(reviewOutcomeIsKnown(failed(kind)), kind).toBe(false)
    }
  })
})

describe('review button names', () => {
  const sv = adminText('sv')
  const en = adminText('en')
  const anna = review('a', true)

  it('names the action, whose review it is and when it was written', () => {
    expect(reviewActionName('hide', anna, 'sv', sv)).toBe(
      `Dölj recensionen från ${FSI}Anna S.${PDI}, 10 november 2026, 14:05`,
    )
    expect(reviewActionName('publish', anna, 'sv', sv)).toBe(
      `Publicera igen: recensionen från ${FSI}Anna S.${PDI}, 10 november 2026, 14:05`,
    )
    expect(reviewActionName('delete', anna, 'sv', sv)).toBe(
      `Ta bort recensionen från ${FSI}Anna S.${PDI}, 10 november 2026, 14:05`,
    )
    expect(reviewActionName('hide', anna, 'en', en)).toBe(
      `Hide the review from ${FSI}Anna S.${PDI}, 10 November 2026, 14:05`,
    )
    expect(reviewActionName('publish', anna, 'en', en)).toBe(
      `Publish again: the review from ${FSI}Anna S.${PDI}, 10 November 2026, 14:05`,
    )
    expect(reviewActionName('delete', anna, 'en', en)).toBe(
      `Delete the review from ${FSI}Anna S.${PDI}, 10 November 2026, 14:05`,
    )
  })

  it('keeps a direction mark in the name from reaching the words after it', () => {
    const name = reviewActionName('delete', review('a', true, `${RLO}Anna`), 'sv', sv)
    expect(name).toBe(`Ta bort recensionen från ${FSI}${RLO}Anna${PDI}, 10 november 2026, 14:05`)
  })

  it.each([
    ['sv', sv],
    ['en', en],
  ] as const)('starts each name with the text the button shows (%s)', (lang, t) => {
    expect(reviewActionName('hide', anna, lang, t).startsWith(t.reviewsHide)).toBe(true)
    expect(reviewActionName('publish', anna, lang, t).startsWith(t.reviewsPublish)).toBe(true)
    expect(reviewActionName('delete', anna, lang, t).startsWith(t.reviewsDelete)).toBe(true)
  })

  it('tells two reviews of one customer apart by their time', () => {
    const later = { ...anna, id: 'b', createdAt: '2026-11-10T15:30:00+00:00' }
    expect(reviewActionName('delete', anna, 'sv', sv)).not.toBe(
      reviewActionName('delete', later, 'sv', sv),
    )
  })

  it('takes a customer’s name literally, also when it looks like a slot or a pattern', () => {
    expect(reviewActionName('hide', review('a', true, '{date} $& {name}'), 'sv', sv)).toBe(
      `Dölj recensionen från ${FSI}{date} $& {name}${PDI}, 10 november 2026, 14:05`,
    )
  })
})

describe('customer name inside a sentence of the panel', () => {
  it('sets the name between the two isolates', () => {
    expect(isolatedName('Anna S.')).toBe(`${FSI}Anna S.${PDI}`)
    expect(isolatedName('')).toBe(`${FSI}${PDI}`)
  })

  it('keeps a direction override inside the isolates', () => {
    expect(isolatedName(`${RLO}Anna`)).toBe(`${FSI}${RLO}Anna${PDI}`)
  })

  it('drops isolate marks of the name’s own, which would end ours early or leave it open', () => {
    const marks = [0x2066, 0x2067, 0x2068, 0x2069].map((point) => String.fromCodePoint(point))
    const name = `A${marks[3]}n${marks[0]}n${marks[1]}a${marks[2]}`

    expect(isolatedName(name)).toBe(`${FSI}Anna${PDI}`)
    // U+2065 and U+206A border the four isolates but are not isolates: they stay.
    const neighbours = `${String.fromCodePoint(0x2065)}${String.fromCodePoint(0x206a)}`
    expect(isolatedName(neighbours)).toBe(`${FSI}${neighbours}${PDI}`)
  })

  it('shows a name of forty characters whole and cuts a longer one with an ellipsis', () => {
    const forty = 'a'.repeat(40)
    expect(questionName(forty)).toBe(`${FSI}${forty}${PDI}`)
    expect(questionName(`${forty}b`)).toBe(`${FSI}${forty}…${PDI}`)
    // Eighty unbroken characters: forty of them, the ellipsis and the two isolates are left.
    expect(Array.from(questionName('W'.repeat(80)))).toHaveLength(43)
  })

  it('counts characters, not halves of them, when it cuts', () => {
    // Each of these is one character and two UTF-16 units.
    expect(questionName('😀'.repeat(41))).toBe(`${FSI}${'😀'.repeat(40)}…${PDI}`)
  })

  it('cuts first and isolates what is left, so that the closing isolate is never cut off', () => {
    const long = `${RLO}${'a'.repeat(60)}`
    const shown = questionName(long)
    expect(shown.startsWith(`${FSI}${RLO}`)).toBe(true)
    expect(shown.endsWith(`…${PDI}`)).toBe(true)
  })
})

describe.each(LANGS)('review delete question (%s)', (lang) => {
  const t = adminText(lang)
  const [before = '', after = ''] = t.reviewsDeleteBody.split('{name}')

  it('has the name once, with words on both sides of it', () => {
    expect(t.reviewsDeleteBody.split('{name}')).toHaveLength(2)
    expect(before.trim()).not.toBe('')
    expect(after.trim()).not.toBe('')
  })

  it('asks about the review by the customer’s name, isolated', () => {
    expect(reviewDeleteQuestion(review('a', true), t)).toBe(`${before}${FSI}Anna S.${PDI}${after}`)
  })

  it('cuts a name that would not fit the question', () => {
    const question = reviewDeleteQuestion(review('a', true, 'W'.repeat(80)), t)
    expect(question).toBe(`${before}${FSI}${'W'.repeat(40)}…${PDI}${after}`)
  })

  it('keeps a direction override in the name from reordering the sentence', () => {
    const question = reviewDeleteQuestion(review('a', true, `${RLO}Anna`), t)
    expect(question).toBe(`${before}${FSI}${RLO}Anna${PDI}${after}`)
  })

  it('takes a name literally when it is the slot itself or a replacement pattern', () => {
    expect(reviewDeleteQuestion(review('a', true, '{name}'), t)).toBe(
      `${before}${FSI}{name}${PDI}${after}`,
    )
    expect(reviewDeleteQuestion(review('a', true, '$& $1 $$'), t)).toBe(
      `${before}${FSI}$& $1 $$${PDI}${after}`,
    )
  })
})

// A booking takes one review and is removed after twelve months while its review stays, so each
// sentence holds only with its condition.
describe.each([
  ['sv', 'om bokningen finns kvar', 'inte skriva en ny recension', 'sedan skriva en ny recension'],
  ['en', 'if the booking still exists', 'cannot write a new review', 'can then write a new review'],
] as const)('review help and delete sentences (%s)', (lang, condition, blocked, allowed) => {
  const t = adminText(lang)

  it('says a hidden review blocks a new one only while the booking exists', () => {
    const help = t.reviewsHideHelp.toLowerCase()
    expect(help).toContain(condition)
    expect(help).toContain(blocked)
    expect(help).not.toContain(allowed)
  })

  it('says a deleted review allows a new one only while the booking exists', () => {
    const body = t.reviewsDeleteBody.toLowerCase()
    expect(body).toContain(condition)
    expect(body).toContain(allowed)
    expect(body).not.toContain(blocked)
  })

  it('states the condition before what follows from it', () => {
    const help = t.reviewsHideHelp.toLowerCase()
    const body = t.reviewsDeleteBody.toLowerCase()
    expect(help.indexOf(condition)).toBeLessThan(help.indexOf(blocked))
    expect(body.indexOf(condition)).toBeLessThan(body.indexOf(allowed))
  })
})

describe('one review for each booking, and a review that outlives its booking', () => {
  const sql = readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
    .join('\n')

  it('holds in the database, which is what the two sentences rest on', () => {
    // A kept review, hidden or not, blocks a new one.
    expect(sql).toMatch(/ADD CONSTRAINT "reviews_one_per_booking" UNIQUE \("booking_id"\)/)
    expect(sql).toMatch(
      /ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY \("booking_id"\) REFERENCES "public"\."bookings"\("id"\) ON DELETE SET NULL/,
    )
  })
})

describe('rating stars', () => {
  it('fills as many of five stars as the rating', () => {
    expect(ratingStars(1)).toBe('★☆☆☆☆')
    expect(ratingStars(4)).toBe('★★★★☆')
    expect(ratingStars(5)).toBe('★★★★★')
  })

  it('always shows five stars, whatever number arrives', () => {
    expect(ratingStars(0)).toBe('☆☆☆☆☆')
    expect(ratingStars(-3)).toBe('☆☆☆☆☆')
    expect(ratingStars(9)).toBe('★★★★★')
    expect(ratingStars(3.9)).toBe('★★★☆☆')
  })
})
