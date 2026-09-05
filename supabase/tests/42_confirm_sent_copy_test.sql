begin;
select plan(4);

select is(
  (select value from public.site_content where key = 'confirmSent' and lang = 'sv'),
  'En bokningsbekräftelse har skickats till {email}. Hantera bokningen via en säker länk under "Mina bokningar".',
  'Swedish confirmation copy uses the email secure-link flow'
);
select is(
  (select value from public.site_content where key = 'confirmSent' and lang = 'en'),
  'A booking confirmation has been sent to {email}. Manage the booking with a secure link under "My appointments".',
  'English confirmation copy uses the email secure-link flow'
);
select is(
  (select count(*)::int from public.site_content where key = 'confirmSent'),
  2,
  'confirmation copy remains exactly bilingual'
);
select is(
  (select count(*)::int
   from public.site_content
   where key = 'confirmSent'
     and value in (
       'En bokningsbekräftelse har skickats till {email}. Bokningen finns även under "Mina bokningar" via ditt telefonnummer.',
       'A booking confirmation has been sent to {email}. You can also find the booking under "My appointments" using your phone number.'
     )),
  0,
  'known phone-lookup defaults are absent after the forward migration'
);

select * from finish();
rollback;
