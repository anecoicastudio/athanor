import type { Locale } from '@athanor/i18n';

/**
 * Long-form legal copy lives here as per-locale content (not in the @athanor/i18n
 * UI catalog, which is for short interface strings). Scope: the Athanor presentation
 * site only — the mobile app ships its own, broader policy at store submission.
 */
export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  reviewNote: string;
};

const CONTROLLER = 'Anecoica Studio UG (haftungsbeschränkt)';
const EMAIL = 'info@anecoica.net';

export const privacy: Record<Locale, LegalDoc> = {
  it: {
    title: 'Informativa sulla privacy',
    updated: 'Agosto 2026',
    intro: `Questa informativa spiega come ${CONTROLLER} tratta i dati di chi visita il sito di presentazione di Athanor. Il sito non richiede la creazione di un account e non profila chi lo visita: puoi iscriverti alla lista d'attesa, e vengono conservati log tecnici minimi. Il sito mostra anche le pagine di profilo pubblico delle persone iscritte ad Athanor, ma solo nella parte che hanno scelto di rendere pubblica: quei dati appartengono all'app e sono descritti nella sua informativa, non in questa. Riguarda solo questo sito; l'app Athanor avrà una propria informativa al momento della pubblicazione sugli store.`,
    sections: [
      {
        heading: 'Titolare del trattamento',
        body: [
          `Il titolare del trattamento è ${CONTROLLER}, Thaerstrasse 17, 12049 Berlino, Germania.`,
          'Iscritta al Registro delle imprese (Handelsregister) con il numero HRB 242211 B presso il tribunale di Charlottenburg (Amtsgericht Charlottenburg). Rappresentante legale: Alessandro De Angelis.',
          `Per qualsiasi richiesta relativa ai tuoi dati puoi scrivere a ${EMAIL}.`,
        ],
      },
      {
        heading: 'Dati che raccogliamo',
        body: [
          'Log tecnici. Per servire le pagine, il nostro fornitore di hosting (Cloudflare) registra dati tecnici minimi — ad esempio gli header inviati dal browser, l’indirizzo IP e la data e ora della richiesta. La base giuridica è il legittimo interesse a far funzionare il sito e a mantenerlo sicuro; questi dati non vengono usati per profilarti.',
          'Lista d’attesa. Se compili il modulo di iscrizione, trattiamo l’indirizzo email che inserisci (insieme alla lingua scelta e alla provenienza dal sito) al solo scopo di avvisarti quando Athanor sarà disponibile. La base giuridica è il tuo consenso. L’indirizzo è conservato su Supabase (Unione Europea, Francoforte). Non ti inviamo alcun messaggio al momento dell’iscrizione. Non lo usiamo per altre comunicazioni di marketing oltre all’avviso di lancio e non lo cediamo né vendiamo a terzi. Lo cancelliamo al più tardi dopo circa 18 mesi, oppure prima se crei un account o ci chiedi di rimuoverlo.',
        ],
      },
      {
        heading: 'Cookie',
        body: [
          'Usiamo un solo cookie funzionale, `athanor_locale`, che ricorda la lingua scelta (italiano o inglese). Non serve a profilare e non viene condiviso con terzi.',
        ],
      },
      {
        heading: 'Analisi del traffico',
        body: [
          'Per capire come viene usato il sito usiamo statistiche aggregate e senza cookie (Cloudflare Web Analytics): non identificano la singola persona e non tracciano la navigazione tra siti diversi.',
        ],
      },
      {
        heading: 'Dove vengono trattati i dati',
        body: [
          'Il sito è servito dalla rete globale di Cloudflare: ogni richiesta è gestita dal nodo più vicino a chi visita, che può trovarsi fuori dall’Unione Europea. Riguarda il caricamento delle pagine, il beacon di statistiche (che raggiunge Cloudflare, Inc. indipendentemente dal nodo che ha servito la pagina), l’invio del modulo della lista d’attesa, e le pagine di profilo pubblico, la cui versione già composta resta per un breve periodo nella cache della rete.',
          'Gli indirizzi email della lista d’attesa sono conservati nell’Unione Europea (Supabase, Francoforte).',
          `Quando un trattamento avviene fuori dall’Unione Europea, il trasferimento si fonda sulle clausole contrattuali tipo approvate dalla Commissione europea, incluse nell’accordo sul trattamento dei dati di Cloudflare (cloudflare.com/cloudflare-customer-dpa). Cloudflare aderisce inoltre al Data Privacy Framework UE-USA. Puoi chiederne copia scrivendo a ${EMAIL}.`,
        ],
      },
      {
        heading: 'I tuoi diritti',
        body: [
          `In base al GDPR puoi chiedere in qualsiasi momento l’accesso, la rettifica, la cancellazione, la limitazione e la portabilità dei dati che ti riguardano, opporti al trattamento e revocare il consenso alla lista d’attesa. La revoca non pregiudica i trattamenti svolti prima. Per esercitare questi diritti scrivi a ${EMAIL}.`,
          'Hai inoltre il diritto di presentare un reclamo a un’autorità di controllo. Per il nostro titolare l’autorità competente è il Garante di Berlino (Berliner Beauftragte für Datenschutz und Informationsfreiheit), ma puoi rivolgerti anche all’autorità del tuo Paese di residenza — in Italia, il Garante per la protezione dei dati personali.',
        ],
      },
    ],
    reviewNote:
      'La ragione sociale completa e i dati di registrazione sono nell’impressum su anecoica.net.',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'August 2026',
    intro: `This policy explains how ${CONTROLLER} handles the data of visitors to the Athanor presentation site. The site requires no account and does not profile visitors: you can join the waitlist, and minimal technical logs are kept. The site also shows public profile pages for people who have joined Athanor, but only the part they chose to make public: that data belongs to the app and is described in the app's policy, not this one. It covers this site only; the Athanor app will have its own policy when it is published on the app stores.`,
    sections: [
      {
        heading: 'Data controller',
        body: [
          `The data controller is ${CONTROLLER}, Thaerstrasse 17, 12049 Berlin, Germany.`,
          'Registered in the commercial register (Handelsregister) under number HRB 242211 B at the Charlottenburg local court (Amtsgericht Charlottenburg). Managing director: Alessandro De Angelis.',
          `For any request about your data you can write to ${EMAIL}.`,
        ],
      },
      {
        heading: 'Data we collect',
        body: [
          'Technical logs. To serve the pages, our hosting provider (Cloudflare) records minimal technical data — such as the headers your browser sends, your IP address and the time of the request. The legal basis is our legitimate interest in operating and securing the site; this data is not used to profile you.',
          'Waitlist. If you submit the sign-up form, we process the email address you enter (along with your chosen language and the fact you came from the site) for the sole purpose of letting you know when Athanor is available. The legal basis is your consent. The address is stored on Supabase (European Union, Frankfurt). We send you no message when you sign up. We do not use it for any marketing beyond the launch notice, and we do not share or sell it. We delete it after roughly 18 months at the latest, or sooner if you create an account or ask us to remove it.',
        ],
      },
      {
        heading: 'Cookies',
        body: [
          'We use a single functional cookie, `athanor_locale`, which remembers your chosen language (Italian or English). It is not used for profiling and is not shared with third parties.',
        ],
      },
      {
        heading: 'Traffic analytics',
        body: [
          'To understand how the site is used we rely on aggregated, cookieless statistics (Cloudflare Web Analytics): they do not identify individuals and do not track browsing across other sites.',
        ],
      },
      {
        heading: 'Where your data is processed',
        body: [
          'The site is served from Cloudflare’s global network: each request is handled by the node closest to the visitor, which may sit outside the European Union. This covers page loads, the analytics beacon (which reaches Cloudflare, Inc. regardless of which node served the page), waitlist form submissions, and public profile pages, whose rendered version stays briefly in the network’s cache.',
          'Waitlist email addresses are stored in the European Union (Supabase, Frankfurt).',
          `Where processing happens outside the European Union, the transfer relies on the standard contractual clauses approved by the European Commission and incorporated in Cloudflare’s data processing addendum (cloudflare.com/cloudflare-customer-dpa). Cloudflare is additionally certified under the EU–US Data Privacy Framework. You can request a copy by writing to ${EMAIL}.`,
        ],
      },
      {
        heading: 'Your rights',
        body: [
          `Under the GDPR you can at any time request access to, rectification, erasure, restriction and portability of your data, object to its processing, and withdraw your consent to the waitlist. Withdrawal does not affect processing carried out beforehand. To exercise these rights, write to ${EMAIL}.`,
          'You also have the right to lodge a complaint with a supervisory authority. For our controller the competent one is the Berlin authority (Berliner Beauftragte für Datenschutz und Informationsfreiheit), but you may also contact the authority in your country of residence.',
        ],
      },
    ],
    reviewNote:
      'Our full legal name and registration details are in the impressum at anecoica.net.',
  },
};

export const terms: Record<Locale, LegalDoc> = {
  it: {
    title: 'Termini di servizio',
    updated: 'Giugno 2026',
    intro: `Usando il sito di presentazione di Athanor accetti questi termini. Il sito è offerto da ${CONTROLLER} a scopo informativo.`,
    sections: [
      {
        heading: 'Oggetto',
        body: [
          'Il sito presenta il progetto Athanor. L’app non è ancora pubblicata: i riferimenti agli store sono indicativi e potranno cambiare.',
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
          `Il marchio Athanor, i testi, la grafica e il logo sono di ${CONTROLLER}. Non possono essere riprodotti senza autorizzazione.`,
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
    intro: `By using the Athanor presentation site you accept these terms. The site is provided by ${CONTROLLER} for informational purposes.`,
    sections: [
      {
        heading: 'Purpose',
        body: [
          'The site presents the Athanor project. The app is not yet published: store references are indicative and may change.',
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
          `The Athanor name, text, graphics and logo belong to ${CONTROLLER}. They may not be reproduced without permission.`,
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
