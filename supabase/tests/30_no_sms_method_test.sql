begin;
select plan(5);

select is(
  (select count(*) from public.bookings where method = 'sms'),
  0::bigint,
  'legacy sms rows are normalized'
);

select ok(
  pg_catalog.pg_get_constraintdef(
    (select oid from pg_catalog.pg_constraint where conname = 'bookings_method_valid')
  ) not like '%sms%',
  'booking method constraint contains no SMS value'
);

select ok(
  pg_catalog.pg_get_constraintdef(
    (select oid from pg_catalog.pg_constraint where conname = 'bookings_method_valid')
  ) like '%phone%',
  'booking method constraint allows phone reservations'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.admin_create_booking(text,timestamptz,integer,text,numeric,text,text)'::regprocedure
  ) not like '%''sms''%',
  'manual booking RPC contains no SMS method'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.admin_create_booking(text,timestamptz,integer,text,numeric,text,text)'::regprocedure
  ) like '%''phone''%',
  'manual booking RPC stores phone reservations as phone'
);

select * from finish();
rollback;
