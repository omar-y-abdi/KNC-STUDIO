interface RetentionService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export async function retainCmsObject(service: RetentionService, bucket: string, path: string): Promise<boolean> {
  const result = await service.rpc('internal_cms_media_retained', { p_bucket: bucket, p_path: path })
  if (result.error) {
    // Functions deployed before the additive migration must still perform legacy cleanup.
    if (result.error.code === 'PGRST202' || result.error.code === '42883') return false
    throw new Error('CMS media retention lookup failed')
  }
  if (typeof result.data !== 'boolean') throw new Error('Invalid CMS media retention response')
  return result.data
}
