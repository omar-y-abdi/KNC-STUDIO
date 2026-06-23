-- pgTAP — RLS as the `anon` role. Source: BACKEND_SPEC.md §6 (RLS).
-- anon = the browser's public key. It must NOT touch bookings directly, and must read ONLY
-- published reviews. permission-denied = SQLSTATE 42501.

begin;
select plan(9);

-- RLS is actually enabled on both tables.
select is(
  (select relrowsecurity from pg_class where oid = 'public.bookings'::regclass),
  true, 'RLS enabled on bookings'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.reviews'::regclass),
  true, 'RLS enabled on reviews'
);

-- Seed (as the owner, before dropping to anon): one published + one unpublished review, and one
-- booking, so we can prove anon's visibility boundaries.
insert into public.reviews (name, rating, text, published) values ('Visible',5,'syns',true);
insert into public.reviews (name, rating, text, published) values ('Hidden', 1,'döljs',false);
insert into public.bookings
  (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
   customer_name, method, phone, email, lang)
  values ('hassan','h','Hår',350,45,'2099-04-01 09:00+00','2099-04-01 09:45+00',
          'Secret Kund','sms','0709998877',null,'sv');

-- ---- drop to anon ---------------------------------------------------------------------------
set local role anon;

-- bookings: every direct operation is denied (revoked grants + no policy).
select throws_ok(
  $$select count(*) from public.bookings$$,
  '42501', null, 'anon cannot SELECT bookings'
);
select throws_ok(
  $$insert into public.bookings
      (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
       customer_name, method, phone, email, lang)
    values ('hassan','h','Hår',350,45,'2099-05-01 09:00+00','2099-05-01 09:45+00',
            'Hack','sms','0701234567',null,'sv')$$,
  '42501', null, 'anon cannot INSERT bookings'
);
select throws_ok(
  $$update public.bookings set status = 'cancelled', cancelled_at = now()$$,
  '42501', null, 'anon cannot UPDATE bookings'
);
select throws_ok(
  $$delete from public.bookings$$,
  '42501', null, 'anon cannot DELETE bookings'
);

-- reviews: anon may SELECT, but the policy hides unpublished rows. Scope to the two rows THIS
-- test inserted (seed-independent): anon sees the published 'Visible' but NOT the unpublished
-- 'Hidden'.
select is(
  (select count(*)::int from public.reviews where name in ('Visible','Hidden')),
  1, 'anon sees ONLY the published review of the two inserted (Hidden is filtered out)'
);
select is(
  (select string_agg(name, ',') from public.reviews where name in ('Visible','Hidden')),
  'Visible', 'the one review anon sees is the published ''Visible'' row'
);

-- reviews: anon cannot write directly (no insert grant) -> denied.
select throws_ok(
  $$insert into public.reviews (name, rating, text) values ('Sneaky',5,'x')$$,
  '42501', null, 'anon cannot INSERT reviews directly'
);

reset role;

select * from finish();
rollback;
