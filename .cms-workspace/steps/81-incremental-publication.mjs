import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const path = resolve(root, 'supabase/migrations/20260915030000_unified_cms.sql')
  let source = readFileSync(path, 'utf8')
  for (const [table, group] of [['site_content', 'site'], ['about_content', 'about']]) {
    const before = ` delete from public.${table};
 for pair in select * from jsonb_each(p_document->'${group}') loop
   for cell in select * from jsonb_each_text(pair.value) loop insert into public.${table}(key,lang,value) values(pair.key,cell.key,cell.value); end loop;
 end loop;`
    const after = ` -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.${table} existing
 where not exists (
   select 1 from jsonb_each(p_document->'${group}') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'${group}') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.${table}(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.${table}.value is distinct from excluded.value;
   end loop;
 end loop;`
    if (!source.includes(before)) throw new Error(`Missing reproduced blanket publication operation: ${table}`)
    source = source.replace(before, after)
  }
  writeFileSync(path, source)
}
