begin;
select plan(5);

select is(
  (select count(*) from public.bookings where method = 'sms'),
  0::bigint,
  'legacy sms rows are normalized'
);

select unlike(
  pg_catalog.pg_get_constraintdef(
    (select oid from pg_catalog.pg_constraint where conname = 'bookings_method_valid')
  ),
  '%sms%',
  'booking method constraint contains no SMS value'
);

select like(
  pg_catalog.pg_get_constraintdef(
    (select oid from pg_catalog.pg_constraint where conname = 'bookings_method_valid')
  ),
  '%phone%',
  'booking method constraint allows phone reservations'
);

select unlike(
  pg_catalog.pg_get_functiondef(
    'public.admin_create_booking(text,timestamptz,integer,text,integer,text,text)'::regprocedure
  ),
  '%''sms''%',
  'manual booking RPC contains no SMS method'
);

select like(
  pg_catalog.pg_get_functiondef(
    'public.admin_create_booking(text,timestamptz,integer,text,integer,text,text)'::regprocedure
  ),
  '%''phone''%',
  'manual booking RPC stores phone reservations as phone'
);

select * from finish();
rollback;
