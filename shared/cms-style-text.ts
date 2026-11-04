/** Neutralize HTML raw-text boundaries in CSS that is about to be embedded in a `<style>` element.
 * Inside a CSS string or comment `<\/` is identical to `</`, and valid CSS carries no `</` anywhere
 * else, so the sheet renders unchanged while the HTML parser can no longer see a closing tag. The
 * Worker applies this to the owner CSS it inlines into a served page. */
export const inertStyleText = (css: string): string => css.replaceAll('</', '<\\/')
