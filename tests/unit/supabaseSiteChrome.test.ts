import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  contentResult: { data: null, error: { message: 'offline' } } as {
    data: readonly unknown[] | null
    error: unknown
  },
  discoveryResult: { data: null, error: null } as { data: unknown; error: unknown },
  changeHandlers: [] as (() => void)[],
  removeChannel: vi.fn(),
}))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => {
    const channel = {
      on: vi.fn((_event: string, _filter: unknown, handler: () => void) => {
        state.changeHandlers.push(handler)
        return channel
      }),
      subscribe: vi.fn(() => channel),
    }
    return {
      from: () => ({ select: () => ({ eq: async () => state.contentResult }) }),
      rpc: async () => state.discoveryResult,
      channel: () => channel,
      removeChannel: state.removeChannel,
    }
  },
}))

import { supabaseSiteChromeAdapter } from '../../src/site/adapters/supabaseSiteChrome'

describe('Supabase site chrome resolution', () => {
  beforeEach(() => {
    state.contentResult = { data: null, error: { message: 'offline' } }
    state.discoveryResult = { data: null, error: null }
    state.changeHandlers = []
    state.removeChannel.mockReset()
  })

  it('keeps Worker metadata authoritative when either backend response is unavailable', async () => {
    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toBeNull()

    state.contentResult = { data: [], error: null }
    state.discoveryResult = { data: { malformed: true }, error: null }
    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toBeNull()
  })

  it('does not publish an unresolved realtime reload', async () => {
    const onChange = vi.fn()
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', onChange)
    expect(state.changeHandlers.length).toBeGreaterThan(0)

    state.changeHandlers[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()

    unsubscribe?.()
    expect(state.removeChannel).toHaveBeenCalledOnce()
  })
})
