-- Seed — the 3 placeholder reviews, copied VERBATIM from src/about/reviews/adapters/mockReviews.ts
-- (Johan A. 5, Emir K. 5, Daniel M. 4). published = true so anon sees them via reviews_select_published.
-- Loaded by `supabase db reset` per config.toml [db.seed].sql_paths.

insert into public.reviews (name, rating, text, published) values
  (
    'Johan A.',
    5,
    'Bästa fadern jag fått i Göteborg. Lugn lokal, ingen stress och resultatet sitter perfekt. Återkommer varje gång.',
    true
  ),
  (
    'Emir K.',
    5,
    'Skägget har aldrig sett bättre ut. Kunnig barberare som lyssnar på vad man vill ha. Rekommenderas starkt.',
    true
  ),
  (
    'Daniel M.',
    4,
    'Riktigt bra klippning och trevligt bemötande. Lite väntetid men helt klart värt det.',
    true
  );

-- =============================================================================================
-- Admin foundation seeds (ADMIN_SPEC.md). Barbers, their default weekly schedules, and the
-- bilingual About copy. NOTE: no `profiles`/auth users are seeded here — those are created by the
-- owner in the Auth dashboard and linked via the admin UI (and by the pgTAP/integration setup).
-- =============================================================================================

-- The three barbers (roster from src/booking/barbers.ts + bios/roles from src/i18n). active=true,
-- sort_order 0/1/2. ON CONFLICT keeps the seed idempotent across `db reset`.
insert into public.barbers (id, name, ig, role_sv, role_en, bio_sv, bio_en, active, sort_order) values
  (
    'hassan', 'Hassan', 'freebandzcuts', 'Barberare', 'Barber',
    'Specialist på skinfades och precisa kanter. Hassan har saxen i handen sedan tonåren och gör jobbet med is i magen.',
    'Specialist in skin fades and precise lines. Hassan has had the scissors in hand since his teens and works with a steady calm.',
    true, 0
  ),
  (
    'victor', 'Victor', 'vic.barber1', 'Barberare', 'Barber',
    'Klassiska klippningar med modern touch. Victor lyssnar in vad du vill ha och levererar varje gång — skägg är hans signatur.',
    'Classic cuts with a modern touch. Victor listens to what you want and delivers every time — beards are his signature.',
    true, 1
  ),
  (
    'salman', 'Salman', 'frescobarbiere', 'Barberare', 'Barber',
    'Texturerat hår och rena övergångar. Salman tar gärna den extra minuten för att detaljen ska bli helt rätt.',
    'Textured hair and clean transitions. Salman happily takes the extra minute to get the detail exactly right.',
    true, 2
  )
on conflict (id) do nothing;

-- Default weekly schedule for every barber: working Mon–Sat (weekday 1..6) 09:00–18:00
-- (start_min 540, end_min 1080); Sunday (weekday 0) not working. generate_series builds all 7
-- weekdays per barber; `working` is true only for 1..6.
insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
select b.id, wd.weekday, (wd.weekday between 1 and 6), 540, 1080
from public.barbers b
cross join generate_series(0, 6) as wd(weekday)
on conflict (barber_id, weekday) do nothing;

-- About copy (bilingual) from src/i18n aboutSv/aboutEn. The 7 editable keys × {sv,en}.
insert into public.about_content (key, lang, value) values
  ('eyebrow',       'sv', 'OM OSS'),
  ('eyebrow',       'en', 'ABOUT'),
  ('heading',       'sv', 'Hantverk, inte bara en klippning'),
  ('heading',       'en', 'Craft, not just a haircut'),
  ('intro',         'sv', 'KNC Studio är en barbershop på Geijersgatan i Göteborg. Vi tar oss tid med varje besök — ren fade, skarpa kanter och ett skägg som sitter. Lugn lokal, bra musik och barberare som kan sitt yrke.'),
  ('intro',         'en', 'KNC Studio is a barbershop on Geijersgatan in Gothenburg. We take our time with every visit — clean fades, sharp lines and a beard that sits right. Calm room, good music and barbers who know their trade.'),
  ('galleryTitle',  'sv', 'I salongen'),
  ('galleryTitle',  'en', 'Inside the shop'),
  ('cutsTitle',     'sv', 'Jobb vi gjort'),
  ('cutsTitle',     'en', 'Work we’ve done'),
  ('stylistsTitle', 'sv', 'Barberarna'),
  ('stylistsTitle', 'en', 'The barbers'),
  ('reviewsTitle',  'sv', 'Omdömen'),
  ('reviewsTitle',  'en', 'Reviews')
on conflict (key, lang) do nothing;
