-- CMS publication in one pass and 30-day revision retention (OPS-3 steps 2-3, owner decision 24).
--
-- OPS-3: internal_cms_publish checked the request and then called internal_cms_publish_unchecked,
-- which validated, locked, looked up the replay and built the head document a second time. They are
-- one function now: the head document is built once before the writes and once after them. The
-- signature, the grants and the returned state (revision, fingerprint, request identity, document)
-- are unchanged, so cms-studio calls it exactly as before.
--
-- Decision 24: a daily pg_cron job deletes CMS revisions older than 30 days, never the head or the
-- newest revision, and nothing at all while the head spells a storage path encoded. The head is
-- cms_site.revision, which is also the published revision. Deleting a revision cascades only to
-- its cms_revision_media rows; no trigger runs on delete and nothing is queued for Storage. A file
-- that only pruned revisions referenced loses that retention: an unregistered legacy file becomes an
-- orphan for the daily reconciler, a library asset becomes deletable by the owner. Restore points
-- older than 30 days disappear, and replaying the request of a pruned revision meets the stale-base
-- check.
--
-- Deploy: cms-studio needs no change. A publication that started under the old wrapper while this
-- migration commits cannot reach the dropped unchecked writer; the studio shows its temporary error,
-- keeps the draft, and the owner's next publication succeeds.
begin;

-- Body from 20261024043000_cms_conflicts_and_archived_media.sql (internal_cms_publish_unchecked).
-- Changed: the archived-media rule of the former wrapper runs right after the stale-base check.
-- Validation still runs before the lock, so a document that is both malformed and stale gets 22023
-- where the former wrapper answered PT409. The owner is checked once, before the lock; B2 also
-- re-checked it after the lock.
create or replace function public.internal_cms_publish(p_actor uuid,p_document jsonb,p_base_revision bigint,p_base_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_head bigint; v_before jsonb; v_after jsonb; v_previous public.cms_revisions%rowtype; row_data jsonb; pair record; cell record; v_current_ids text[]; v_new_ids text[];
begin
 perform public.internal_cms_assert_owner(p_actor);
 if p_request_id is null or p_base_revision is null or p_base_revision<0 or p_base_fingerprint is null or p_base_fingerprint !~ '^[0-9a-f]{32}$'
   or p_document is null or p_document->>'schema' is distinct from '1' or jsonb_typeof(p_document->'barbers') is distinct from 'array'
   or jsonb_typeof(p_document->'settings') is distinct from 'object'
   or jsonb_typeof(p_document->'presentation') is distinct from 'object' or octet_length(p_document::text)>3145728 then
   raise exception 'Invalid CMS publication' using errcode='22023';
 end if;
 if (p_document->'settings') ? 'cancellation_policy_hours'
   or exists(
     select 1
     from jsonb_array_elements(p_document->'barbers') as item(value)
     where item.value ? 'active'
   ) then
   raise exception 'Operational booking rules are not CMS content' using errcode='22023';
 end if;
 -- One consistent snapshot, including edits made by existing non-CMS management tools.
 lock table public.barbers,public.site_content,public.about_content,public.site_settings,public.barber_photos,public.gallery_images,public.email_templates,public.cms_email_designs,public.cms_assets in share row exclusive mode;
 select revision into v_head from public.cms_site where id for update;
 -- An exact replay returns the committed revision even if its media was archived since.
 select * into v_previous from public.cms_revisions where request_id=p_request_id;
 if found then
   if v_previous.actor_id is distinct from p_actor or v_previous.request_fingerprint is distinct from md5(p_document::text) then
     raise exception 'Request identity was reused with different content' using errcode='22023';
   end if;
   return jsonb_build_object('revision',v_previous.revision,'fingerprint',v_previous.fingerprint,'requestId',p_request_id,'document',v_previous.document);
 end if;
 v_before := public.internal_cms_document();
 if v_head<>p_base_revision or md5(v_before::text)<>p_base_fingerprint then
   raise sqlstate 'PT409' using message='CMS content changed; review the newer revision before publishing';
 end if;
 perform public.internal_cms_assert_media_publishable(p_document,v_before);
 select array_agg(id order by id) into v_current_ids from public.barbers;
 select array_agg(value->>'id' order by value->>'id') into v_new_ids from jsonb_array_elements(p_document->'barbers');
 if v_current_ids is distinct from v_new_ids then raise sqlstate 'PT409' using message='Staff membership changed; reload before publishing'; end if;
 insert into public.cms_revisions(revision,actor_id,document,fingerprint,summary)
 values(v_head,p_actor,v_before,md5(v_before::text),'Initial CMS snapshot') on conflict(revision) do nothing;

 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.site_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'site') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'site') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.site_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.site_content.value is distinct from excluded.value;
   end loop;
 end loop;
 -- Delete only translations explicitly absent from the validated complete draft.
 -- Preserve unchanged rows; this also respects Supabase's safe-update protection.
 delete from public.about_content existing
 where not exists (
   select 1 from jsonb_each(p_document->'about') as entries(key,langs)
   cross join lateral jsonb_each_text(entries.langs) as translations(lang,value)
   where entries.key=existing.key and translations.lang=existing.lang
 );
 for pair in select * from jsonb_each(p_document->'about') loop
   for cell in select * from jsonb_each_text(pair.value) loop
     insert into public.about_content(key,lang,value) values(pair.key,cell.key,cell.value)
     on conflict(key,lang) do update set value=excluded.value
     where public.about_content.value is distinct from excluded.value;
   end loop;
 end loop;
 delete from public.site_settings where key in (select key from jsonb_each(v_before->'settings')) and not p_document->'settings' ? key;
 for pair in select * from jsonb_each_text(p_document->'settings') loop
   insert into public.site_settings(key,value) values(pair.key,pair.value) on conflict(key) do update set value=excluded.value,updated_at=now();
 end loop;
 for row_data in select value from jsonb_array_elements(p_document->'barbers') loop
   update public.barbers set name=row_data->>'name',ig=row_data->>'ig',role_sv=row_data->>'role_sv',role_en=row_data->>'role_en',bio_sv=row_data->>'bio_sv',bio_en=row_data->>'bio_en',sort_order=(row_data->>'sort_order')::integer where id=row_data->>'id';
 end loop;
 delete from public.barber_photos where not p_document->'photos' ? barber_id;
 for pair in select * from jsonb_each_text(p_document->'photos') loop
   insert into public.barber_photos(barber_id,storage_path) values(pair.key,pair.value) on conflict(barber_id) do update set storage_path=excluded.storage_path,updated_at=now();
 end loop;
 delete from public.gallery_images where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_document->'gallery'));
 for row_data in select value from jsonb_array_elements(p_document->'gallery') loop
   insert into public.gallery_images(id,kind,storage_path,alt,sort_order) values((row_data->>'id')::uuid,row_data->>'kind',row_data->>'storage_path',row_data->>'alt',(row_data->>'sort_order')::integer)
   on conflict(id) do update set kind=excluded.kind,storage_path=excluded.storage_path,alt=excluded.alt,sort_order=excluded.sort_order;
 end loop;
 delete from public.email_templates t where not exists(select 1 from jsonb_array_elements(p_document->'emails') e where e->>'template'=t.template and e->>'lang'=t.lang);
 for row_data in select value from jsonb_array_elements(p_document->'emails') loop
   insert into public.email_templates(template,lang,subject,preheader,title,intro,section_title,note,cta_label,contact_lead)
   values(row_data->>'template',row_data->>'lang',row_data->>'subject',row_data->>'preheader',row_data->>'title',row_data->>'intro',row_data->>'section_title',row_data->>'note',row_data->>'cta_label',row_data->>'contact_lead')
   on conflict(template,lang) do update set subject=excluded.subject,preheader=excluded.preheader,title=excluded.title,intro=excluded.intro,section_title=excluded.section_title,note=excluded.note,cta_label=excluded.cta_label,contact_lead=excluded.contact_lead,updated_at=now();
   if row_data->'design'='null'::jsonb then delete from public.cms_email_designs where template=row_data->>'template' and lang=row_data->>'lang';
   else insert into public.cms_email_designs(template,lang,design) values(row_data->>'template',row_data->>'lang',row_data->'design') on conflict(template,lang) do update set design=excluded.design; end if;
 end loop;
 update public.cms_site set revision=v_head+1,presentation=p_document->'presentation',updated_at=now() where id;
 v_after := public.internal_cms_document();
 insert into public.cms_revisions(revision,actor_id,request_id,request_fingerprint,document,fingerprint,summary)
 values(v_head+1,p_actor,p_request_id,md5(p_document::text),v_after,md5(v_after::text),'Published website and email content');
 return jsonb_build_object('revision',v_head+1,'fingerprint',md5(v_after::text),'requestId',p_request_id,'document',v_after);
end $$;
revoke all on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
from public,anon,authenticated;
grant execute on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid)
to service_role;

comment on function public.internal_cms_publish(uuid,jsonb,bigint,text,uuid) is
'Publishes a validated CMS document while serializing asset lifecycle changes. Archived media may stay on structured keys the authoritative head already uses and in markup when the head references the asset anywhere; any other placement requires an active asset.';

drop function public.internal_cms_publish_unchecked(uuid,jsonb,bigint,text,uuid);

-- Owner decision 24. A request identity replays its revision only inside the 30-day window; a
-- trashed asset that only pruned revisions referenced becomes deletable. A publication can install
-- a head that spells a storage path encoded, because the placement filter does not see every such
-- spelling. So the prune first takes the table locks internal_cms_publish takes, in the same order
-- and mode: no publication can change the head between the guard and the delete, and the two
-- cannot deadlock. A publication waits for the prune, which takes milliseconds at 03:37 UTC.
create function public.prune_cms_revisions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pruned integer;
begin
  lock table public.barbers,public.site_content,public.about_content,public.site_settings,public.barber_photos,public.gallery_images,public.email_templates,public.cms_email_designs,public.cms_assets in share row exclusive mode;
  -- internal_cms_media_retained finds a path only as a raw substring of a revision. A candidate runs
  -- from a storage prefix in the head's JSON text to the next quote (the escaped \" included) or
  -- angle bracket, so neither filename punctuation nor a raw space ends it. While a candidate holds
  -- a percent-encoding, any other JSON escape (a backslash, a tab, a newline) or an HTML character
  -- reference other than &quot;, or the head spells the end of the prefix (/object/publi) any other
  -- way than raw, the head may spell a path, bucket included, that the browser decodes; an older
  -- revision may hold the only raw copy that keeps the file, so nothing is pruned. A head that
  -- quotes a storage URL with &apos;, or encodes a query string after it, keeps every revision too.
  -- Not detected: an encoding earlier in the prefix, such as stor%61ge. No editor or tool writes
  -- one. The placement filter does not recognise such a URL either, so a publication is not refused
  -- for it; the residual is accepted.
  if exists (
    select 1
    from public.cms_site s
    join public.cms_revisions head on head.revision = s.revision
    where s.id and (
      head.document::text ~ '/object/publi(?!c/)'
      or exists (
        select 1
        from regexp_matches(head.document::text,
          '/storage/v1/object/public/(([^"<>\\]|\\[^"])*)', 'g') as candidate(parts)
        where candidate.parts[1] ~ '%[0-9A-Fa-f]{2}|\\[^"]|&(?!quot;)'
      )
    )
  ) then
    raise warning 'CMS revisions not pruned: the head spells a storage path encoded';
    return 0;
  end if;
  with pruned as (
    delete from public.cms_revisions r
    where r.created_at < pg_catalog.now() - interval '30 days'
      and r.revision <> (select s.revision from public.cms_site s where s.id)
      and r.revision <> (select max(newest.revision) from public.cms_revisions newest)
    returning 1
  )
  select count(*)::integer into v_pruned from pruned;
  return v_pruned;
end;
$$;
revoke all on function public.prune_cms_revisions() from public,anon,authenticated,service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cms-revision-prune') then
    perform cron.unschedule('cms-revision-prune');
  end if;
end;
$$;

select cron.schedule(
  'cms-revision-prune',
  '37 3 * * *',
  'select public.prune_cms_revisions()'
);

commit;
