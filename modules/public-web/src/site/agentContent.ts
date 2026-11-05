import { formatBusinessAddress, type BusinessSettings } from './business'

export type InformationPage = '/' | '/about' | '/contact'
interface Section {
  readonly heading: string
  readonly content: string
}
interface PageCopy {
  readonly title: string
  readonly intro: string
  readonly sections: readonly Section[]
}
const SITE_URL = 'https://bladeblendstudio.se'
const LINKS = [
  ['Boka tid', '/booking'],
  ['Om salongen', '/about'],
  ['Kontakt', '/contact'],
  ['Integritetspolicy', '/privacy'],
  ['Bokningsvillkor', '/terms'],
] as const

function pageCopy(business: BusinessSettings, path: InformationPage): PageCopy {
  const name = business.name
  const address = formatBusinessAddress(business)
  const city = business.city
  if (path === '/about')
    return {
      title: 'Om ' + name + ' – barbershop i ' + city,
      intro:
        name +
        ' är en barbershop och frisörsalong på ' +
        address +
        '. Här kan du läsa om salongen, hitta besöksadressen och se hur du bokar en tid. Den officiella webbplatsen samlar informationen så att den är tillgänglig även innan den interaktiva bokningen har laddats.',
      sections: [
        {
          heading: 'Salongen och barberarna',
          content:
            'Salongen tar emot kunder som vill boka klippning eller andra tillgängliga barberarbehandlingar. Vilka barberare och behandlingar som erbjuds för tillfället framgår av den aktuella bokningen. Uppgifterna där uppdateras separat från den här introduktionen.',
        },
        {
          heading: 'Så bokar du ett besök',
          content:
            'På bokningssidan väljer du barberare, behandling, datum och en ledig tid. Där visas också aktuella priser och tillgänglighet. Du får information om bokningen via de kontaktuppgifter du anger. För en befintlig bokning använder du Mina bokningar.',
        },
        {
          heading: 'Adress och kontakt',
          content:
            'Du hittar ' +
            name +
            ' på ' +
            address +
            ', Sverige. Besök kontaktsidan för telefon och e-post samt praktisk information. Läs integritetspolicyn för att förstå hur personuppgifter vid bokning hanteras och bokningsvillkoren för information om avbokning.',
        },
      ],
    }
  if (path === '/contact')
    return {
      title: 'Kontakta ' + name,
      intro:
        'Kontakta ' +
        name +
        ', en barbershop och frisörsalong i ' +
        city +
        '. Du hittar salongen på ' +
        address +
        '. Den här sidan samlar de officiella kontaktvägarna och hjälper dig att hitta rätt information före och efter ett besök.',
      sections: [
        {
          heading: 'Besök och vägbeskrivning',
          content:
            'Besöksadressen är ' +
            address +
            ', Sverige. Kontrollera adressen och planera din resa innan besöket. Om du behöver fråga om vägen eller har särskilda önskemål inför din tid kan du kontakta salongen via kontaktuppgifterna nedan.',
        },
        {
          heading: 'Bokning och frågor',
          content:
            'Välj barberare, behandling, datum och ledig tid via den officiella bokningen på webbplatsen. Aktuella behandlingar, priser och tider visas i bokningsflödet. Om du behöver hjälp med en befintlig bokning kan du använda Mina bokningar eller kontakta salongen.',
        },
        {
          heading: 'Information om ditt besök',
          content:
            'Läs bokningsvillkoren innan du bokar för information om avbokning. Integritetspolicyn beskriver vilka kontakt- och bokningsuppgifter som används. Personalens administrationssidor är privata och är inte en kontaktväg för besökare.',
        },
      ],
    }
  return {
    title: name + ' – barbershop i ' + city,
    intro:
      name +
      ' är en barbershop och frisörsalong på ' +
      address +
      ', Sverige. På salongens officiella webbplats kan du läsa om verksamheten och boka en behandling online. Informationen finns också i den ursprungliga HTML-koden så att besökare och söktjänster kan hitta den utan att köra JavaScript.',
    sections: [
      {
        heading: 'Klippning och barberarbehandlingar',
        content:
          'Hos ' +
          name +
          ' kan du hitta tillgängliga frisör- och barberartider. Välj önskad barberare och behandling i bokningsflödet. Där presenteras de aktuella alternativen och priserna, i stället för att visa gamla eller uppskattade uppgifter här på startsidan.',
      },
      {
        heading: 'Boka tid online',
        content:
          'Öppna bokningen för att välja barberare, datum och en ledig tid. Slutför sedan bokningen i det interaktiva formuläret. Om du redan har en bokning finns Mina bokningar för att hantera den. Webbsidan erbjuder information på svenska och engelska.',
      },
      {
        heading: 'Hitta till salongen',
        content:
          'Salongens besöksadress är ' +
          address +
          '. Kontaktsidan samlar officiella kontaktvägar och praktisk information. Läs mer om ' +
          name +
          ' på Om oss-sidan, och se integritetspolicyn samt bokningsvillkoren innan du lämnar personuppgifter vid bokning.',
      },
    ],
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
export function escapeMarkdown(text: string): string {
  const special = '[]<>*_#|' + String.fromCharCode(96)
  return [...text.replace(/[\r\n\t]+/g, ' ')]
    .map((char) => (char === '\\' || special.includes(char) ? '\\' + char : char))
    .join('')
}

export function renderPublicFallback(business: BusinessSettings, path: InformationPage): string {
  const page = pageCopy(business, path)
  const body = page.sections
    .map(
      (section) =>
        '<section><h2>' +
        escapeHtml(section.heading) +
        '</h2><p>' +
        escapeHtml(section.content) +
        '</p></section>',
    )
    .join('')
  const links = LINKS.map(
    ([label, path]) =>
      '<a href="' + path + '" style="display:inline-block;margin-right:1rem">' + label + '</a>',
  ).join('')
  return (
    '<main aria-labelledby="public-intro-heading" style="max-width:48rem;margin:3rem auto;padding:1.5rem;font-family:system-ui,sans-serif;line-height:1.65;color:inherit">' +
    '<h1 id="public-intro-heading">' +
    escapeHtml(page.title) +
    '</h1><p>' +
    escapeHtml(page.intro) +
    '</p>' +
    body +
    '<nav aria-label="Salongens sidor"><h2>Mer information</h2>' +
    links +
    '</nav>' +
    '<noscript><p>Aktivera JavaScript för att välja en ledig tid och boka online.</p></noscript></main>'
  )
}

export function renderPublicMarkdown(business: BusinessSettings, path: InformationPage): string {
  const page = pageCopy(business, path)
  return [
    '# ' + escapeMarkdown(page.title),
    '',
    escapeMarkdown(page.intro),
    '',
    ...page.sections.flatMap(({ heading, content }) => [
      '## ' + escapeMarkdown(heading),
      '',
      escapeMarkdown(content),
      '',
    ]),
    '## Officiella länkar',
    '',
    ...LINKS.map(([label, path]) => '- [' + label + '](' + SITE_URL + path + ')'),
    '',
    '- E-post: ' + escapeMarkdown(business.email),
    ...(business.phoneDisplay ? ['- Telefon: ' + escapeMarkdown(business.phoneDisplay)] : []),
    '',
  ].join('\n')
}
