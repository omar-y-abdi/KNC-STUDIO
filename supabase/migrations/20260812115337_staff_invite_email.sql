alter table public.email_templates
drop constraint email_templates_template_check;

alter table public.email_templates
add constraint email_templates_template_check check (template in (
  'customer_confirmation',
  'barber_confirmation',
  'customer_cancellation',
  'barber_cancellation',
  'customer_reminder',
  'auth_recovery',
  'auth_email_change',
  'auth_invite'
));

insert into public.email_templates (
  template, lang, subject, preheader, title, intro, section_title, note, cta_label, contact_lead
) values
  (
    'auth_invite', 'sv', 'Din inbjudan till Blade & Blend Studio',
    'Skapa ditt personliga lösenord och aktivera kontot.', 'Välkommen till teamet',
    'Du har blivit inbjuden till barberarpanelen hos Blade & Blend Studio.',
    null, 'Länken gäller i 60 minuter och kan bara användas en gång.',
    'Skapa mitt lösenord', 'Behöver du hjälp? Kontakta oss på'
  ),
  (
    'auth_invite', 'en', 'Your invitation to Blade & Blend Studio',
    'Create your personal password and activate the account.', 'Welcome to the team',
    'You have been invited to the barber panel at Blade & Blend Studio.',
    null, 'The link is valid for 60 minutes and can only be used once.',
    'Create my password', 'Need help? Call us on'
  );
