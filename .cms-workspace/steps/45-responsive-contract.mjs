import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'tests/unit/cmsModel.test.ts')
  let source = readFileSync(path, 'utf8')
  const before = "expect(presentationCss(p)).toContain('@media(max-width:767px)')"
  if (!source.includes(before)) throw new Error('Missing original CMS responsive assertion')
  source = "import { MOBILE_MQ } from '../../src/app/shared'\n" + source.replace(before, "expect(presentationCss(p)).toContain(`@media${MOBILE_MQ.replaceAll(' ', '')}`)")
  writeFileSync(path, source)
}
