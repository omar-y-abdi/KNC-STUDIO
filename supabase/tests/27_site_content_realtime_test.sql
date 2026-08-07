begin;

select plan(1);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'site_content'
  ),
  'site_content publishes owner edits to public pages'
);

select * from finish();
rollback;
