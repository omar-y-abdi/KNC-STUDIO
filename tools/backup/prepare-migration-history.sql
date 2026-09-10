-- NEW, DISPOSABLE RESTORE TARGET ONLY. Run in the same transaction as history_schema.sql
-- and history_data.sql. The archived source schema, not this tool or the target CLI version,
-- defines migration columns, constraints, and optional seed history.
drop schema if exists supabase_migrations cascade;
