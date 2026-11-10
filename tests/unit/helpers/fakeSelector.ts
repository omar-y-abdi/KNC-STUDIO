// The selectors the app's DOM code asks, applied to the tests' stand-ins: lists of compounds of
// tag, `.class`, `[name]`, `[name="value"]`, `:disabled`, `:not(...)`. Anything else throws.

export interface SelectorSubject {
  /** The element's tag name, in lower case. */
  readonly tag: string
  readonly attributes: ReadonlyMap<string, string>
}

type Test = (subject: SelectorSubject) => boolean

/** The elements `disabled` disables. */
const FORM_CONTROLS: ReadonlySet<string> = new Set(['button', 'input', 'select', 'textarea'])

function unknown(selector: string): never {
  throw new Error(`The fake does not know the selector ${selector}`)
}

/** The members of a selector list: split at the commas outside brackets and parentheses. */
function members(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index++) {
    const char = list[index]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, index))
      start = index + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map((part) => part.trim())
}

/** The index of the parenthesis that closes the one opened just before `from`. */
function closing(compound: string, from: number): number {
  let depth = 1
  for (let index = from; index < compound.length; index++) {
    if (compound[index] === '(') depth++
    else if (compound[index] === ')' && --depth === 0) return index
  }
  return unknown(compound)
}

interface AttributePart {
  /** How much of the selector the part takes. */
  readonly length: number
  readonly name: string
  /** Undefined for `[name]`: any value. */
  readonly value: string | undefined
}

/** The `[name]` or `[name="value"]` that `rest` begins with. */
function attributePart(rest: string): AttributePart | null {
  const present = /^\[([\w-]+)\]/.exec(rest)
  if (present !== null)
    return { length: present[0].length, name: present[1] ?? '', value: undefined }
  const equal = /^\[([\w-]+)="([^"]*)"\]/.exec(rest)
  return equal === null
    ? null
    : { length: equal[0].length, name: equal[1] ?? '', value: equal[2] ?? '' }
}

function compoundTests(compound: string): Test[] {
  if (compound === '') unknown(compound)
  const tests: Test[] = []
  let rest = compound
  while (rest !== '') {
    const tag = rest === compound ? /^[a-z][a-z0-9]*/i.exec(rest) : null
    const className = /^\.([\w-]+)/.exec(rest)
    const attribute = attributePart(rest)
    if (tag !== null) {
      const name = tag[0].toLowerCase()
      tests.push((subject) => subject.tag === name)
      rest = rest.slice(tag[0].length)
    } else if (className !== null) {
      const name = className[1] ?? ''
      tests.push((subject) => (subject.attributes.get('class') ?? '').split(/\s+/).includes(name))
      rest = rest.slice(className[0].length)
    } else if (attribute !== null) {
      const { name, value } = attribute
      tests.push((subject) =>
        value === undefined ? subject.attributes.has(name) : subject.attributes.get(name) === value,
      )
      rest = rest.slice(attribute.length)
    } else if (rest.startsWith(':disabled')) {
      tests.push((subject) => FORM_CONTROLS.has(subject.tag) && subject.attributes.has('disabled'))
      rest = rest.slice(':disabled'.length)
    } else if (rest.startsWith(':not(')) {
      const end = closing(rest, ':not('.length)
      const inner = listTest(rest.slice(':not('.length, end))
      tests.push((subject) => !inner(subject))
      rest = rest.slice(end + 1)
    } else unknown(compound)
  }
  return tests
}

function listTest(list: string): Test {
  const compounds = members(list).map(compoundTests)
  return (subject) => compounds.some((tests) => tests.every((test) => test(subject)))
}

/** Whether `subject` matches the selector list `selector`, as `Element.matches` answers. */
export function matchesSelector(subject: SelectorSubject, selector: string): boolean {
  return listTest(selector)(subject)
}
