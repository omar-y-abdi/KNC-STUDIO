create schema if not exists supabase_migrations authorization postgres;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

create table if not exists supabase_migrations.seed_files (
  path text primary key,
  hash text not null
);

truncate table
  supabase_migrations.schema_migrations,
  supabase_migrations.seed_files;
