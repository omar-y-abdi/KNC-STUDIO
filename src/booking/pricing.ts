// Pure pricing: weekday -> service groups. Numbers, ids and group composition mirror the
// original mock's price list. No effects.

import type { BookingStrings } from '../i18n/index'
import type { ServiceGroup } from './domain'

/**
 * Service groups available for the given date, in the given language.
 * Branches on `date.getDay()`:
 *  - Wed–Sat (3..6): full men's menu (+ student discount on Wed, day 3)
 *  - Mon/Tue (1,2): reduced men's menu
 *  - kids group always appended
 */
export function pricing(date: Date, t: BookingStrings): readonly ServiceGroup[] {
  const d = date.getDay()
  const groups: ServiceGroup[] = []
  if (d >= 3 && d <= 6) {
    groups.push({
      title: t.grpWedSat,
      note: '',
      items: [
        { id: 'hs', name: t.sHairBeard, price: 450, dur: 60 },
        { id: 'h', name: t.sHair, price: 350, dur: 45 },
        { id: 'b', name: t.sBeard, price: 200, dur: 30 },
      ],
    })
    if (d === 3) {
      groups.push({
        title: t.grpStudent,
        note: t.noteStudent,
        items: [{ id: 'stu', name: t.sHairStudent, price: 300, dur: 45 }],
      })
    }
  } else if (d === 1 || d === 2) {
    groups.push({
      title: t.grpMonTue,
      note: '',
      items: [
        { id: 'hs2', name: t.sHairBeard, price: 400, dur: 60 },
        { id: 'h2', name: t.sHair, price: 320, dur: 45 },
      ],
    })
  }
  groups.push({
    title: t.grpKids,
    note: '',
    items: [{ id: 'kid', name: t.sKids, price: 289, dur: 45 }],
  })
  return groups
}
