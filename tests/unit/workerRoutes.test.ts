import { describe, expect, it } from 'vitest'
import worker, { isPrivatePath, isSpaPath } from '../../src/worker'

const assetBodies: Readonly<Record<string, string>> = {
  '/index.html': '<main>homepage</main>',
  '/privacy.html': '<main>privacy</main>',
  '/google-calendar.html': '<main>calendar</main>',
  '/assets/app.js': 'console.log("app")',
}

function createEnv() {
  const requestedPaths: string[] = []
  return {
    requestedPaths,
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        requestedPaths.push(url.pathname)
        const body = assetBodies[url.pathname]
        return body === undefined
          ? new Response('Not found', { status: 404 })
          : new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } })
      },
    },
  }
}

describe('Worker route policy', () => {
  it('recognizes only protected SPA paths as private', () => {
    expect(isPrivatePath('/admin')).toBe(true)
    expect(isPrivatePath('/admin/settings')).toBe(true)
    expect(isPrivatePath('/login/')).toBe(true)
    expect(isPrivatePath('/auth/confirm')).toBe(true)
    expect(isPrivatePath('/administrator')).toBe(false)
    expect(isSpaPath('/')).toBe(true)
    expect(isSpaPath('/not-a-route')).toBe(false)
  })

  it('redirects www requests to the canonical apex without losing query parameters', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://www.bladeblendstudio.se/login?next=%2Fadmin'),
      env,
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('Location')).toBe('https://bladeblendstudio.se/login?next=%2Fadmin')
    expect(env.requestedPaths).toEqual([])
  })

  it('serves protected SPA routes with noindex headers', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/admin/settings'),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await response.text()).toBe('<main>homepage</main>')
    expect(env.requestedPaths).toEqual(['/admin/settings', '/index.html'])
  })

  it('returns a genuine noindex 404 for unknown paths', async () => {
    const env = createEnv()
    const response = await worker.fetch(new Request('https://bladeblendstudio.se/not-a-route'), env)

    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(env.requestedPaths).toEqual(['/not-a-route'])
  })

  it('serves clean static URLs and redirects their HTML filenames', async () => {
    const env = createEnv()
    const cleanResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/privacy'),
      env,
    )
    const filenameResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/privacy.html?lang=sv'),
      env,
    )

    expect(cleanResponse.status).toBe(200)
    expect(await cleanResponse.text()).toBe('<main>privacy</main>')
    expect(filenameResponse.status).toBe(308)
    expect(filenameResponse.headers.get('Location')).toBe(
      'https://bladeblendstudio.se/privacy?lang=sv',
    )
  })

  it('keeps Google verification copy reachable but out of search indexes', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/google-calendar'),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})
