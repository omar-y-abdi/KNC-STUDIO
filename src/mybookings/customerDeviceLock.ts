/** Serialize receipt creation across tabs, including the first response that sets its cookie. */
export async function withCustomerDeviceLock<T>(
  operation: (locked: boolean) => Promise<T>,
): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks === undefined) return operation(false)
  let started = false
  try {
    return await locks.request('bladeblend-customer-device', () => {
      started = true
      return operation(true)
    })
  } catch (error) {
    // A denied lock can fall back before submission; never repeat an operation that already ran.
    if (!started) return operation(false)
    throw error
  }
}
