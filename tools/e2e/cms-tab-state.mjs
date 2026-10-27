/* global indexedDB, navigator, sessionStorage */
import { test } from './fixtures.mjs'

// Attaches the studio's backup identity in this page: its tab id, the Web Locks the origin holds
// or waits for, and the tabs IndexedDB keeps drafts for, each with its home and About names. It
// tells a reload that lost its tab id from a draft that was removed or replaced.
export async function attachTabState(page, name) {
  const state = await page.evaluate(async () => {
    const locks = await navigator.locks.query()
    const records = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('knc-cms-drafts', 1)
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const request = opening.result.transaction('records').objectStore('records').getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          opening.result.close()
          resolve(
            request.result.map((record) => {
              const pages = JSON.parse(record.document).presentation.pages
              return {
                tab: record.tab,
                savedAt: record.savedAt,
                home: pages[0]?.name?.sv,
                about: pages.find((page) => page.path === '/about')?.title?.sv,
              }
            }),
          )
        }
      }
    })
    return {
      tab: sessionStorage.getItem('knc-cms-tab'),
      held: (locks.held ?? []).map((lock) => lock.name),
      pending: (locks.pending ?? []).map((lock) => lock.name),
      records,
    }
  })
  await test.info().attach(name, {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  })
}
