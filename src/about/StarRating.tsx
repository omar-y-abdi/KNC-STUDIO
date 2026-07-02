// Star rating widgets — a read-only display (for published reviews) and a keyboard-operable
// selector (for the review form). The selector is a WAI-ARIA radiogroup: arrow keys move the
// selection, Home/End jump to 1/5, and each star is a focusable radio with an accessible name.

import type { JSX } from 'preact'
import { useRef } from 'preact/hooks'
import type { Palette } from '../booking/bookingStyles'
import type { Rating } from './reviews/domain'
import { RATINGS } from './reviews/domain'

/** A single star glyph (filled or outline), drawn with `currentColor`. */
function Star(props: { filled: boolean; size: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size}
      height={props.size}
      fill={props.filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={1.5}
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.9l-5.8 3.05 1.1-6.45-4.7-4.6 6.5-.95z" />
    </svg>
  )
}

export interface StarDisplayProps {
  readonly rating: Rating
  readonly c: Palette
  /** Pre-formatted accessible label, e.g. "Rating: 4 of 5". */
  readonly label: string
}

/** Read-only star row for a published review. */
export function StarDisplay(props: StarDisplayProps): JSX.Element {
  return (
    <span
      role="img"
      aria-label={props.label}
      style={{ display: 'inline-flex', gap: '2px', color: props.c.text }}
    >
      {RATINGS.map((n) => (
        <Star key={n} filled={n <= props.rating} size={15} />
      ))}
    </span>
  )
}

export interface StarRatingProps {
  readonly value: Rating | null
  readonly onChange: (r: Rating) => void
  readonly c: Palette
  /** `aria-label` for the radiogroup as a whole. */
  readonly groupLabel: string
  /** Builds a star's accessible name from its value (e.g. "{n} stars" → "4 stars"). */
  readonly starLabel: (n: Rating) => string
  /** Set true after a failed submit to tint unset stars with the error colour. */
  readonly invalid?: boolean
  readonly errorColor: string
}

/**
 * Keyboard-operable star selector (radiogroup). Roving focus: the selected star (or the first when
 * none is selected) is in the tab order; arrows/Home/End move and select.
 */
export function StarRating(props: StarRatingProps): JSX.Element {
  const current = props.value
  // Star button refs (keyed by Rating) so arrow-key changes can move focus to the new radio — the
  // WAI-ARIA radiogroup pattern: focus tracks the checked option, not the originally-focused star.
  const starRefs = useRef<Partial<Record<Rating, HTMLButtonElement>>>({})
  const move = (n: Rating): void => {
    props.onChange(n)
    starRefs.current[n]?.focus()
  }

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    const cur = current ?? 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(Math.min(5, cur + 1) as Rating)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(Math.max(1, cur - 1) as Rating)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(5)
    }
  }

  const baseColor = props.invalid && current === null ? props.errorColor : props.c.text

  return (
    <div
      role="radiogroup"
      aria-label={props.groupLabel}
      onKeyDown={onKeyDown}
      style={{ display: 'inline-flex', gap: '4px', color: baseColor }}
    >
      {RATINGS.map((n) => {
        const selected = current !== null && n <= current
        // Roving tabindex: the checked star (or star 1 when none is set) is the single tab stop.
        const isTabStop = current === null ? n === 1 : n === current
        const starStyle: JSX.CSSProperties = {
          border: 'none',
          background: 'transparent',
          padding: '2px',
          margin: 0,
          cursor: 'pointer',
          color: selected ? props.c.text : props.invalid && current === null ? props.errorColor : props.c.text,
          opacity: selected ? 1 : 0.32,
          lineHeight: 0,
          borderRadius: '6px',
        }
        return (
          <button
            key={n}
            ref={(el) => {
              if (el) starRefs.current[n] = el
            }}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={props.starLabel(n)}
            tabIndex={isTabStop ? 0 : -1}
            onClick={() => move(n)}
            style={starStyle}
          >
            <Star filled={selected} size={26} />
          </button>
        )
      })}
    </div>
  )
}
