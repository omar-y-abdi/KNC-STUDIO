-- Replace only the two known phone-lookup defaults written by the earlier booking-email
-- migration. Owner-edited values deliberately do not match these predicates and remain intact.
update public.site_content
set value = case lang
  when 'sv' then
    'En bokningsbekräftelse har skickats till {email}. Hantera bokningen via en säker länk under "Mina bokningar".'
  when 'en' then
    'A booking confirmation has been sent to {email}. Manage the booking with a secure link under "My appointments".'
end
where key = 'confirmSent'
  and (
    (lang = 'sv' and value = 'En bokningsbekräftelse har skickats till {email}. Bokningen finns även under "Mina bokningar" via ditt telefonnummer.')
    or
    (lang = 'en' and value = 'A booking confirmation has been sent to {email}. You can also find the booking under "My appointments" using your phone number.')
  );
