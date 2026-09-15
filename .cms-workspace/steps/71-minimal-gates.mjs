import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path, before, after) => {
    const file = resolve(root, path), source = readFileSync(file, 'utf8')
    if (!source.includes(before)) throw new Error(`Missing verified gate anchor ${path}: ${before}`)
    writeFileSync(file, source.replace(before, after))
  }
  edit('supabase/migrations/20260915030000_unified_cms.sql', 'grant all on public.cms_site, public.cms_email_designs, public.cms_revisions, public.cms_assets to service_role;', 'grant select, insert, update, delete on public.cms_site, public.cms_email_designs, public.cms_revisions, public.cms_assets to service_role;')
  edit('supabase/tests/50_unified_cms_test.sql', 'select no_plan();', `select no_plan();
-- A clean installation may intentionally contain no CMS overrides yet.
insert into public.site_content(key,lang,value) values
 ('kicker','sv','Ursprunglig text'),('kicker','en','Original text'),
 ('hours','sv','Öppet enligt bokning'),('hours','en','Open by appointment')
on conflict(key,lang) do update set value=excluded.value;`)
  edit('src/app/MobileSite.tsx', "readonly previewPorts?: import('./DesktopSite').DesktopSitePreviewPorts", 'readonly previewPorts?: DesktopSitePreviewPorts')
  edit('src/app/MobileSite.tsx', "import type { JSX } from 'preact'", "import type { DesktopSitePreviewPorts } from './DesktopSite'\nimport type { JSX } from 'preact'")
}
