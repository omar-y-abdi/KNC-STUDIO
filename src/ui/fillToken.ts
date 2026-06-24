// Tiny single-token template fill — replaces the FIRST occurrence of `token` in `template` with
// `value` (no formatting lib). Used for the i18n strings that carry one placeholder (`{n}` rating
// labels, `{method}` confirmation line). Pure + total: a missing token leaves the string unchanged.

/** Replace the first `token` in `template` with `value`. */
export function fillToken(template: string, token: string, value: string): string {
  return template.replace(token, value)
}
