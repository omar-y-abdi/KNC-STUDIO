/** Stable, bounded IDs shared by source capture and live rendering. */
export function nativeNodeId(surface: string, path: string): string {
  const identity = `knc-${surface}-${path}`
  if (identity.length <= 120) return identity
  let hash = 14695981039346656037n
  for (const char of identity)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 1099511628211n)
  return `knc-node-${hash.toString(16)}`
}
