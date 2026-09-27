begin;
select plan(2);
select ok(has_column_privilege('service_role','public.barbers','id','select'),'Upload and reuse gateways can verify profile ownership by barber ID');
set local role service_role;
select lives_ok($$select id from public.barbers where id='hassan'$$,'The real gateway query is authorized');
reset role;
select * from finish();
rollback;
