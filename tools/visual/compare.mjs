// Visual-regression gate. Compares CANDIDATE screenshots against BASELINE
// pixel-for-pixel. Fails (exit 1) if any view exceeds THRESHOLD mismatch ratio.
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'

const BASELINE = process.env.BASELINE ?? './tools/visual/baseline'
const CANDIDATE = process.env.CANDIDATE ?? '/tmp/shots'
const DIFF = process.env.DIFF ?? '/tmp/diff'
const THRESHOLD = Number(process.env.THRESHOLD ?? '0.001') // max share of mismatched pixels
mkdirSync(DIFF, { recursive: true })

let failed = 0
const files = readdirSync(BASELINE).filter((f) => f.endsWith('.png'))
if (files.length === 0) {
  console.error('No baseline images found in', BASELINE)
  process.exit(1)
}

for (const file of files) {
  const a = PNG.sync.read(readFileSync(`${BASELINE}/${file}`))
  let b
  try {
    b = PNG.sync.read(readFileSync(`${CANDIDATE}/${file}`))
  } catch {
    console.error(`FAIL ${file}  (candidate missing)`)
    failed++
    continue
  }
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`FAIL ${file}  dim ${a.width}x${a.height} vs ${b.width}x${b.height}`)
    failed++
    continue
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const mismatch = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
  const ratio = mismatch / (a.width * a.height)
  const ok = ratio <= THRESHOLD
  if (!ok) {
    writeFileSync(`${DIFF}/${file}`, PNG.sync.write(diff))
    failed++
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${file}  mismatch=${mismatch} (${(ratio * 100).toFixed(3)}%)`,
  )
}

if (failed > 0) {
  console.error(`\n${failed} view(s) failed — diffs in ${DIFF}`)
  process.exitCode = 1
} else {
  console.log('\nALL VIEWS PASS')
}
