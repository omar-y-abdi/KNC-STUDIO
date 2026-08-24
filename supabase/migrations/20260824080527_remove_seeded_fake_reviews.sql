-- Forward-only and intentionally irreversible: remove only the three testimonial records formerly
-- introduced by supabase/seed.sql. These rows
-- have no booking proof and must not remain visible as customer reviews. This data migration is
-- deliberately narrow: genuine reviews, including any with a matching rating, are untouched.

delete from public.reviews
where published is true
  and booking_id is null
  and (name, rating, text) in (
    (
      'Johan A.',
      5,
      'Bästa fadern jag fått i Göteborg. Lugn lokal, ingen stress och resultatet sitter perfekt. Återkommer varje gång.'
    ),
    (
      'Emir K.',
      5,
      'Skägget har aldrig sett bättre ut. Kunnig barberare som lyssnar på vad man vill ha. Rekommenderas starkt.'
    ),
    (
      'Daniel M.',
      4,
      'Riktigt bra klippning och trevligt bemötande. Lite väntetid men helt klart värt det.'
    )
  );
