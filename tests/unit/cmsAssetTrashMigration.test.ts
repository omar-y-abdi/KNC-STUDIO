import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  'supabase/migrations/20260918003000_cms_asset_trash_lifecycle.sql',
  'utf8',
)

describe('CMS asset trash lifecycle migration', () => {
  it('requires current references to be clear before trash and all retained references before delete', () => {
    expect(sql).toContain("p_action='trash' and v_current>0")
    expect(sql).toContain("p_action='delete' and (v_asset.trashed_at is null or v_current>0 or v_history>0)")
    expect(sql).toContain('internal_cms_asset_delete_finalize')
    expect(sql).toContain('internal_cms_asset_delete_abort')
  })

  it('keeps lifecycle RPCs service-only behind the cms-studio owner boundary', () => {
    expect(sql).toContain(
      'revoke all on function public.internal_cms_asset_transition(uuid,uuid,integer,text) from public,anon,authenticated',
    )
    expect(sql).toContain(
      'grant execute on function public.internal_cms_asset_transition(uuid,uuid,integer,text) to service_role',
    )
  })
})
