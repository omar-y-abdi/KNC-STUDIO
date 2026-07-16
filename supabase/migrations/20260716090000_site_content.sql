-- site_content + site_settings — owner-editable HOMEPAGE text + per-section font-size presets
-- (Task 2 §2). Same posture as about_content: anon reads (the public site needs it), owner writes.
--
-- site_content: the editable homepage strings (kicker, opening hours, address) — bilingual (key,lang).
-- Mirrors about_content exactly, but a SEPARATE table so about_content's closed key-enum is untouched.
--
-- site_settings: non-localized settings (key,value) — currently the two font-size presets
-- ('homepage_scale', 'about_scale'), each a bounded token the client clamps to a gentle multiplier.

-- =============================================================================================
-- site_content — bilingual editable homepage copy.
-- =============================================================================================
create table public.site_content (
  key        text not null,
  lang       text not null check (lang in ('sv', 'en')),
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (key, lang),
  constraint site_content_key_len   check (char_length(key) between 1 and 40),
  constraint site_content_value_len check (char_length(value) <= 400)
);

alter table public.site_content enable row level security;
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

create policy site_content_select_all on public.site_content
  for select to anon, authenticated using (true);
create policy site_content_insert_owner on public.site_content
  for insert to authenticated with check (public.is_owner());
create policy site_content_update_owner on public.site_content
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy site_content_delete_owner on public.site_content
  for delete to authenticated using (public.is_owner());

-- =============================================================================================
-- site_settings — non-localized key/value settings (font-size presets, …).
-- =============================================================================================
create table public.site_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  constraint site_settings_key_len   check (char_length(key) between 1 and 40),
  constraint site_settings_value_len check (char_length(value) <= 40)
);

alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

create policy site_settings_select_all on public.site_settings
  for select to anon, authenticated using (true);
create policy site_settings_insert_owner on public.site_settings
  for insert to authenticated with check (public.is_owner());
create policy site_settings_update_owner on public.site_settings
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy site_settings_delete_owner on public.site_settings
  for delete to authenticated using (public.is_owner());

-- No seed: both tables start EMPTY, and the public site falls back to its i18n defaults + the 'md'
-- (1.0×) font scale — so the live site is byte-identical until the owner edits something.
