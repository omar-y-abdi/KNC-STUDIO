interface RetentionService {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export async function retainCmsObject(
  service: RetentionService,
  bucket: string,
  path: string,
): Promise<boolean> {
  const result = await service.rpc('internal_cms_media_retained', {
    p_bucket: bucket,
    p_path: path,
  })
  // Every lookup error fails closed, a missing function included: an unanswered retention check
  // must never be read as "not retained", because the caller deletes unretained bytes.
  if (result.error) throw new Error('CMS media retention lookup failed')
  if (typeof result.data !== 'boolean') throw new Error('Invalid CMS media retention response')
  return result.data
}
