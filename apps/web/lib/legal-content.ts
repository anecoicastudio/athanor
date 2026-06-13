import type { Locale } from '@auria/i18n';

/**
 * Long-form legal copy lives here as per-locale content (not in the @auria/i18n
 * UI catalog, which is for short interface strings). TEMPLATE TEXT — review with
 * counsel and replace the controller name / contact email before launch.
 */
export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  reviewNote: string;
};

const CONTROLLER = 'Anecoica Studio';
const EMAIL = 'privacy@auria.app';

export const privacy: Record<Locale, LegalDoc> = {
  it: {
    title: 'Informativa sulla privacy',
    updated: 'Giugno 2026',
    intro: `Questa pagina spiega come ${CONTROLLER} tratta i dati di chi visita il sito di presentazione di Auria. Il sito è una vetrina: non richiede registrazione e non raccoglie dati di profilazione.`,
    sections: [
      {
        heading: 'Titolare del trattamento',
        body: [
          `${CONTROLLER}, con sede nell'Unione Europea, è il titolare del trattamento. Per qualsiasi richiesta puoi scrivere a ${EMAIL}.`,
        ],
      },
      {
        heading: 'Dati che raccogliamo',
        body: [
          'Il sito non chiede né conserva dati personali identificativi. Non ci sono moduli, account o login in questa fase.',
          'Vengono trattati solo i dati tecnici minimi necessari a servire le pagine (ad esempio gli header inviati dal browser), nei log del provider di hosting.',
        ],
      },
      {
        heading: 'Cookie',
        body: [
          'Usiamo un solo cookie funzionale, `auria_locale`, che ricorda la lingua scelta (italiano o inglese). Non serve a profilare e non viene condiviso con terzi.',
        ],
      },
      {
        heading: 'Analisi del traffico',
        body: [
          'Per capire come viene usato il sito usiamo statistiche aggregate e senza cookie (Vercel Analytics e Speed Insights): non identificano la singola persona e non tracciano la navigazione tra siti diversi.',
        ],
      },
      {
        heading: 'I tuoi diritti',
        body: [
          'In base al GDPR puoi chiedere accesso, rettifica, cancellazione o limitazione dei dati che ti riguardano e opporti al trattamento. Per esercitare questi diritti scrivi a ' +
            EMAIL +
            '.',
        ],
      },
    ],
    reviewNote:
      'Bozza — da rivedere con un legale e completare con i dati societari prima del lancio.',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'June 2026',
    intro: `This page explains how ${CONTROLLER} handles the data of visitors to the Auria presentation site. The site is a showcase: it requires no sign-up and collects no profiling data.`,
    sections: [
      {
        heading: 'Data controller',
        body: [
          `${CONTROLLER}, based in the European Union, is the data controller. For any request you can write to ${EMAIL}.`,
        ],
      },
      {
        heading: 'Data we collect',
        body: [
          'The site neither asks for nor stores identifying personal data. There are no forms, accounts or logins at this stage.',
          'Only the minimal technical data needed to serve the pages (such as the headers your browser sends) is processed, in the hosting provider’s logs.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'We use a single functional cookie, `auria_locale`, which remembers your chosen language (Italian or English). It is not used for profiling and is not shared with third parties.',
        ],
      },
      {
        heading: 'Traffic analytics',
        body: [
          'To understand how the site is used we rely on aggregated, cookieless statistics (Vercel Analytics and Speed Insights): they do not identify individuals and do not track browsing across other sites.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'Under the GDPR you can request access, rectification, erasure or restriction of your data and object to its processing. To exercise these rights, write to ' +
            EMAIL +
            '.',
        ],
      },
    ],
    reviewNote: 'Draft — review with counsel and complete with company details before launch.',
  },
};

export const terms: Record<Locale, LegalDoc> = {
  it: {
    title: 'Termini di servizio',
    updated: 'Giugno 2026',
    intro: `Usando il sito di presentazione di Auria accetti questi termini. Il sito è offerto da ${CONTROLLER} a scopo informativo.`,
    sections: [
      {
        heading: 'Oggetto',
        body: [
          'Il sito presenta il progetto Auria. L’app non è ancora pubblicata: i riferimenti agli store sono indicativi e potranno cambiare.',
        ],
      },
      {
        heading: 'Uso del sito',
        body: [
          'Puoi consultare liberamente i contenuti. Non è consentito usare il sito in modo illecito o tentare di comprometterne la sicurezza o la disponibilità.',
        ],
      },
      {
        heading: 'Proprietà intellettuale',
        body: [
          `Il marchio Auria, i testi, la grafica e il logo sono di ${CONTROLLER}. Non possono essere riprodotti senza autorizzazione.`,
        ],
      },
      {
        heading: 'Limitazione di responsabilità',
        body: [
          `I contenuti sono forniti “così come sono”, senza garanzie. ${CONTROLLER} non risponde di eventuali interruzioni del servizio o imprecisioni dei contenuti.`,
        ],
      },
      {
        heading: 'Legge applicabile e contatti',
        body: [`Si applica la legge dell’Unione Europea. Per domande scrivi a ${EMAIL}.`],
      },
    ],
    reviewNote: 'Bozza — da rivedere con un legale prima del lancio.',
  },
  en: {
    title: 'Terms of Service',
    updated: 'June 2026',
    intro: `By using the Auria presentation site you accept these terms. The site is provided by ${CONTROLLER} for informational purposes.`,
    sections: [
      {
        heading: 'Purpose',
        body: [
          'The site presents the Auria project. The app is not yet published: store references are indicative and may change.',
        ],
      },
      {
        heading: 'Use of the site',
        body: [
          'You may browse the content freely. You may not use the site unlawfully or attempt to compromise its security or availability.',
        ],
      },
      {
        heading: 'Intellectual property',
        body: [
          `The Auria name, text, graphics and logo belong to ${CONTROLLER}. They may not be reproduced without permission.`,
        ],
      },
      {
        heading: 'Limitation of liability',
        body: [
          `Content is provided “as is”, without warranty. ${CONTROLLER} is not liable for service interruptions or inaccuracies in the content.`,
        ],
      },
      {
        heading: 'Governing law and contact',
        body: [`European Union law applies. For questions, write to ${EMAIL}.`],
      },
    ],
    reviewNote: 'Draft — review with counsel before launch.',
  },
};
