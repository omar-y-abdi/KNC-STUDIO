-- Owner-editable business identity and runtime SEO. `site_settings` already has public-read and
-- owner-only write RLS, so this migration only expands the value capacity, seeds shipped fallbacks,
-- and streams edits to open public pages.

alter table public.site_settings drop constraint if exists site_settings_value_len;
alter table public.site_settings
  add constraint site_settings_value_len check (char_length(value) <= 500);

insert into public.site_settings (key, value)
values
  ('business_name', 'Blade & Blend Studio'),
  ('business_email', 'booking@mail.bladeblendstudio.se'),
  ('business_phone_display', '079‑304 36 71'),
  ('business_phone_tel', '0793043671'),
  ('business_street', 'Geijersgatan 10'),
  ('business_postal_code', '411 34'),
  ('business_city', 'Göteborg'),
  ('business_maps_href', 'https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg'),
  ('cancellation_policy_hours', '24'),
  ('seo_title_sv', 'Blade & Blend Studio – Barbershop i Göteborg | Boka tid online'),
  ('seo_description_sv', 'Blade & Blend Studio – barbershop på Geijersgatan 10 i Göteborg. Boka tid online hos Hassan, Victor eller Salman. Öppet mån–lör 09–18, klippning från 200 kr.'),
  ('seo_title_en', 'Blade & Blend Studio – Barbershop in Gothenburg | Book online'),
  ('seo_description_en', 'Blade & Blend Studio – barbershop at Geijersgatan 10 in Gothenburg. Book online with Hassan, Victor or Salman. Open Monday to Saturday 09:00–18:00, cuts from 200 kr.')
on conflict (key) do nothing;

alter publication supabase_realtime add table public.site_settings;
