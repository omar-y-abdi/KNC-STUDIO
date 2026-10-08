import { test as base } from './fixtures.mjs'
import { customerStackFixture } from './customer-stack.mjs'

export const test = base.extend({
  customerStack: [customerStackFixture, { timeout: 600_000 }],
  // This dependency orders teardown: close browser contexts before restoring DB fixtures.
  customerContexts: async ({ browser, customerStack }, use) => {
    if (!customerStack.origin.startsWith('https://127.0.0.1:'))
      throw new Error('Customer fixture requires local HTTPS')
    const contexts = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      contexts.push(context)
      return context
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})
