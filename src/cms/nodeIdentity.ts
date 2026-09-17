// The component path identifies the template; its existing Preact keys identify repeated items.
export function cmsNodeId(template: string, ...keys: unknown[]): string {
  if (keys.length === 0) return template
  const input = JSON.stringify(keys)
  let hash = 14695981039346656037n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return `${template}:${hash.toString(16)}`
}


export function duplicateCmsNodeIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }
  return [...duplicates]
}
