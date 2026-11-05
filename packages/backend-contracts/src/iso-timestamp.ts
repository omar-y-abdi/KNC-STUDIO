// Preserve the established wire language from Zod 3.25.76 datetime({ offset: true }).
// Source: https://github.com/colinhacks/zod/blob/v3.25.76/packages/zod/src/v3/types.ts
// Zod 4 requires seconds and a colon in offsets; existing response contracts accept minute-only
// times and both +0100 / +01:00 offsets. Keep Gregorian leap-day and clock bounds unchanged.
const date = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`
const time = `([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?`
export const ISO_TIMESTAMP = new RegExp(`^${date}T${time}(Z|[+-]\\d{2}:?\\d{2})$`)
