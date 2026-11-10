import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261105182545_baseline.sql', 'utf8')
const TRANSITION =
  'FUNCTION "public"."internal_cms_asset_transition"("p_actor" "uuid", "p_id" "uuid", "p_version" integer, "p_action" "text")'

describe('CMS asset trash lifecycle', () => {
  it('requires current references to be clear before trash and all retained references before delete', () => {
    expect(sql).toContain("p_action='trash' and v_current>0")
    expect(sql).toContain(
      "p_action='delete' and (v_asset.trashed_at is null or v_current>0 or v_history>0)",
    )
    expect(sql).toContain('internal_cms_asset_delete_finalize')
    expect(sql).toContain('internal_cms_asset_delete_abort')
  })

  it('keeps lifecycle RPCs service-only behind the cms-studio owner boundary', () => {
    expect(sql).toContain(`REVOKE ALL ON ${TRANSITION} FROM PUBLIC;`)
    expect(
      sql.split('\n').filter((line) => line.startsWith(`GRANT ALL ON ${TRANSITION} TO `)),
    ).toEqual([`GRANT ALL ON ${TRANSITION} TO "service_role";`])
  })
})
