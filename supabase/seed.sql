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
