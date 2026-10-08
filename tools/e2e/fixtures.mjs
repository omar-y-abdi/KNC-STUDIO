import { test as base } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { sourceIdentity } from '../ci/build-artifact.mjs'

// Browser/page/context lifetime, tracing and failure screenshots belong to Playwright.
// Product fixtures still own the controllable backend and race gates.
export const test = base.extend({
  newContext: async ({ browser }, use) => {
    const contexts = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      contexts.push(context)
      return context
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
  evidenceDir: async ({ baseURL, browserName }, use, info) => {
    const directory = info.outputPath('evidence')
    await mkdir(directory, { recursive: true })
    await writeFile(
      `${directory}/source.json`,
      JSON.stringify(
        {
          ...sourceIdentity(),
          browserName,
          baseURL,
          title: info.titlePath,
        },
        null,
        2,
      ),
    )
    await use(directory)
  },
})
export { expect, devices } from '@playwright/test'
