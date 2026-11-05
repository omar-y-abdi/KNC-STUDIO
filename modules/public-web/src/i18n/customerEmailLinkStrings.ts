import type { Lang } from './index'

const SV = {
  manage: 'Hantera mejladresser',
  addresses: 'Dina kopplade mejladresser',
  email: 'Mejladress att koppla',
  request: 'Skicka verifieringsmejl',
  busy: 'Vänta…',
  explanation:
    'Alla tidigare och kommande bokningar för båda mejladresserna, inklusive redan kopplade adresser, samlas i samma profil. Varje kopplad adress får tillgång till hela historiken. Du behöver bekräfta färska verifieringsmejl till båda adresserna.',
  queued:
    'Vi skickar verifieringsmejl till båda adresserna. Öppna varje mejl i den här webbläsaren och bekräfta kopplingen.',
  alreadyLinked: 'Mejladresserna är redan kopplade.',
  confirmTitle: 'Bekräfta mejlkoppling',
  session: 'Du använder mejladressen:',
  confirm: 'Bekräfta kopplingen',
  waiting:
    'Denna mejladress är bekräftad. Öppna verifieringsmejlet till den andra adressen i samma webbläsare och bekräfta också.',
  linked: 'Mejladresserna och deras bokningshistorik är nu kopplade.',
  refresh: 'Uppdatera bokningar',
  accessDenied:
    'Öppna först Mina bokningar-länken för mejladressen du använde när du startade kopplingen. Öppna sedan verifieringsmejlet igen i samma webbläsare.',
  invalid: 'Länken har gått ut eller kan inte användas. Starta en ny koppling från Mina bokningar.',
  rateLimited: 'För många försök. Vänta en stund innan du försöker igen.',
  system: 'Kunde inte slutföra åtgärden. Försök igen.',
  invalidEmail: 'Ange en giltig mejladress.',
}

const EN: Readonly<Record<keyof typeof SV, string>> = {
  manage: 'Manage email addresses',
  addresses: 'Your linked email addresses',
  email: 'Email address to link',
  request: 'Send verification emails',
  busy: 'Please wait…',
  explanation:
    'All past and future bookings for both email addresses, including addresses already linked to them, will share one profile. Each linked address will have access to the full history. You must confirm fresh verification emails sent to both addresses.',
  queued:
    'We are sending verification emails to both addresses. Open each email in this browser and confirm the link.',
  alreadyLinked: 'The email addresses are already linked.',
  confirmTitle: 'Confirm email link',
  session: 'You are using this email address:',
  confirm: 'Confirm the link',
  waiting:
    'This email address is confirmed. Open the verification email sent to the other address in the same browser and confirm it too.',
  linked: 'The email addresses and their booking history are now linked.',
  refresh: 'Refresh bookings',
  accessDenied:
    'First open the My bookings link for the email address you used to start the link. Then reopen the verification email in the same browser.',
  invalid: 'This link has expired or cannot be used. Start a new link from My bookings.',
  rateLimited: 'Too many attempts. Please wait before trying again.',
  system: 'Could not complete the action. Please try again.',
  invalidEmail: 'Enter a valid email address.',
}

export function customerEmailLinkStrings(lang: Lang): typeof EN {
  return lang === 'sv' ? SV : EN
}
