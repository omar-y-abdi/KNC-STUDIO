import { expect, it, vi } from 'vitest'
import { memoizeSourceRead } from '../../src/admin/cms/sourceReadCache'

it('coalesces pending and completed source reads but keeps languages separate', async () => {
  let resolve: (value: string) => void = () => undefined
  const read = vi.fn(
    (lang: string) =>
      new Promise<string>((done) => {
        resolve = done
        void lang
      }),
  )
  const load = memoizeSourceRead(read)
  const first = load('sv')
  expect(load('sv')).toBe(first)
  resolve('Owner copy')
  await expect(first).resolves.toBe('Owner copy')
  expect(load('sv')).toBe(first)
  expect(read).toHaveBeenCalledTimes(1)
  const english = load('en')
  resolve('Owner English copy')
  await expect(english).resolves.toBe('Owner English copy')
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not retain failed reads across retries or leak between capture sessions', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered')
  const load = memoizeSourceRead(read)
  await expect(load()).rejects.toThrow('offline')
  await expect(load()).resolves.toBe('recovered')
  const otherCapture = memoizeSourceRead(read)
  await expect(otherCapture()).resolves.toBe('recovered')
  expect(read).toHaveBeenCalledTimes(3)
})
