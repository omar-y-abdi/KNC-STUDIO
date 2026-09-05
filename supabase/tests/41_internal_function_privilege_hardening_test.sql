begin;
select plan(15);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.admin_cancel_booking(uuid)', 'execute'),
  'anon cannot execute the authenticated admin cancellation RPC'
);
select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.admin_cancel_booking(uuid)', 'execute'),
  'authenticated staff retain the owner/barber-gated cancellation RPC'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.mark_booking_reminder_delivered(uuid)', 'execute'),
  'anon cannot suppress a booking reminder'
);
select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.mark_booking_reminder_delivered(uuid)', 'execute'),
  'authenticated users cannot suppress a booking reminder directly'
);
select ok(
  pg_catalog.has_function_privilege('service_role', 'public.mark_booking_reminder_delivered(uuid)', 'execute'),
  'service role retains the narrow reminder completion RPC'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.queue_due_booking_reminders()', 'execute'),
  'anon cannot invoke the reminder dispatcher'
);
select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.queue_due_booking_reminders()', 'execute'),
  'authenticated users cannot invoke the reminder dispatcher'
);
select ok(
  not pg_catalog.has_function_privilege('service_role', 'public.queue_due_booking_reminders()', 'execute'),
  'service role cannot bypass the cron-owned reminder dispatcher'
);

select ok(
  not pg_catalog.has_function_privilege('anon', 'public.queue_booking_reminder_after_insert()', 'execute'),
  'anon cannot invoke the reminder trigger function'
);
select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.queue_booking_reminder_after_insert()', 'execute'),
  'authenticated users cannot invoke the reminder trigger function'
);
select ok(
  not pg_catalog.has_function_privilege('service_role', 'public.queue_booking_reminder_after_insert()', 'execute'),
  'service role cannot invoke the reminder trigger function'
);

select ok(
  pg_catalog.to_regprocedure('public.queue_booking_confirmation()') is null,
  'the legacy booking email trigger function is retired'
);

select case
  when pg_catalog.to_regprocedure('public.rls_auto_enable()') is null
    then skip('rls_auto_enable() exists only on hosted Supabase')
  else ok(
    not pg_catalog.has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'),
    'anon cannot invoke the platform RLS event-trigger function'
  )
end;
select case
  when pg_catalog.to_regprocedure('public.rls_auto_enable()') is null
    then skip('rls_auto_enable() exists only on hosted Supabase')
  else ok(
    not pg_catalog.has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'),
    'authenticated users cannot invoke the platform RLS event-trigger function'
  )
end;
select case
  when pg_catalog.to_regprocedure('public.rls_auto_enable()') is null
    then skip('rls_auto_enable() exists only on hosted Supabase')
  else ok(
    not pg_catalog.has_function_privilege('service_role', 'public.rls_auto_enable()', 'execute'),
    'service role cannot invoke the platform RLS event-trigger function'
  )
end;

select * from finish();
rollback;
