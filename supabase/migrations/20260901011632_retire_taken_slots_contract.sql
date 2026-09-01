-- `available_slots` is the sole availability read authority. The old range helper has no current
-- repository caller or live dependent object, so retire its exact public signature. RESTRICT keeps
-- an unexpected future dependency visible as a migration failure instead of silently cascading.
drop function public.taken_slots(
  text,
  timestamp with time zone,
  timestamp with time zone
) restrict;
