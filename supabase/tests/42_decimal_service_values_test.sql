-- pgTAP — decimal service prices and numeric duration input contract.
-- The service price is exact database data: it may contain up to two decimal places, while the
-- admin boundary accepts a numeric duration and stores the already-rounded whole-minute value.

begin;
select plan(11);

select is(
  (select data_type
     from information_schema.columns
    where table_schema = 'public' and table_name = 'services' and column_name = 'price'),
  'numeric',
  'services.price preserves decimal SEK values'
);
select is(
  (select data_type
     from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'price'),
  'numeric',
  'bookings.price preserves decimal SEK values'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.admin_create_booking(text,timestamp with time zone,integer,text,numeric,text,text)'
  ) is not null,
  'manual booking RPC accepts the numeric price contract'
);
select ok(
  pg_catalog.to_regprocedure(
    'public.admin_create_booking(text,timestamp with time zone,integer,text,integer,text,text)'
  ) is null,
  'manual booking RPC integer price signature is retired'
);

select lives_ok(
  $$
    insert into public.services
      (id, barber_id, name, price, duration_min, active, sort_order)
    values
      ('42000000-0000-4000-8000-000000000001', 'hassan', 'Decimal service', 199.99, 45, true, 99)
  $$,
  'a two-decimal service price is accepted'
);
select is(
  (select price::text from public.services where id = '42000000-0000-4000-8000-000000000001'),
  '199.99',
  'the exact decimal service price is stored'
);
select throws_ok(
  $$
    insert into public.services
      (barber_id, name, price, duration_min)
    values ('hassan', 'Too precise', 199.999, 45)
  $$,
  '23514', null,
  'prices with more than two decimal places are rejected'
);
select throws_ok(
  $$
    insert into public.services
      (barber_id, name, price, duration_min)
    values ('hassan', 'Too expensive', 100000.01, 45)
  $$,
  '23514', null,
  'prices above the commercial ceiling are rejected'
);

select is(
  (public.create_booking(
    'hassan',
    '42000000-0000-4000-8000-000000000001',
    '2099-04-08 07:00:00+00',
    '0704200001',
    'decimal@example.test',
    'sv',
    'Decimal Customer'
  )->>'ok'),
  'true',
  'server-authoritative booking accepts the decimal service'
);
select is(
  (select price::text from public.bookings where phone = '0704200001'),
  '199.99',
  'server-authoritative booking preserves the decimal price'
);
select is(
  (
    select item->'price'
    from pg_catalog.jsonb_array_elements(public.public_booking_catalog()->'services') as item
    where item->>'id' = '42000000-0000-4000-8000-000000000001'
  ),
  '199.99'::jsonb,
  'the public catalog wire payload preserves the decimal price'
);

select * from finish();
rollback;
