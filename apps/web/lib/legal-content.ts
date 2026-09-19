import { t, type Locale, type MessageKey } from '@athanor/i18n';

/**
 * Long-form legal copy lives here as per-locale content (not in the @athanor/i18n
 * UI catalog, which is for short interface strings). Scope of `privacy` and `terms`: the
 * Athanor presentation site only — the mobile app ships its own, broader policy at store
 * submission. `deleteAccount` is the exception: it is about the APP account (#767).
 *
 * i18n-ignore-file — this module IS the translation source for these documents: every
 * export is a `Record<Locale, …>`, so IT/EN parity is enforced by the type, not by the
 * catalog. Rule 5's gate widened to object-literal copy in #433 and would otherwise report
 * every heading and paragraph here as untranslated.
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

const tIt = (key: MessageKey) => t(key, 'it');
const tEn = (key: MessageKey) => t(key, 'en');

/**
 * /delete-account — the URL Google Play's Data safety form asks for (#767): how to request
 * deletion of the app account with or without the app, and what is deleted and kept.
 *
 * Every label a person has to find in the app is read from the UI catalog, not copied, so a
 * renamed row renames the step that points at it. The deferral paragraph is
 * `account.delete.deferred` verbatim, so this page and the in-app screen cannot promise different
 * things. What the rest may claim is bounded by the erasure cascade as built: `erasure-job`
 * cancels the Circle subscription, pseudonymises the payment rows (#107) that the reaper drops
 * after ten years (#715), redacts the webhook ledger with NO retention window and one accepted hole — a fund
 * contribution's refund or dispute already in the ledger at erasure (#725, `20260912070533`), and disowns and hides the member's events rather than deleting them
 * (`gdpr_release_profile_references`).
 */
export const deleteAccount: Record<Locale, LegalDoc> = {
  it: {
    title: tIt('account.delete.title'),
    updated: 'Settembre 2026',
    intro: `Puoi chiedere in qualsiasi momento di eliminare il tuo account ${tIt('store.name')} e i dati collegati. Qui trovi come farlo, dall'app o senza, cosa eliminiamo e cosa conserviamo. ${tIt('store.name')} è un'app di ${CONTROLLER}.`,
    sections: [
      {
        heading: "Dall'app",
        body: [
          `1. Apri la scheda «${tIt('tabs.profile')}» e tocca l'icona «${tIt('settings.title')}».`,
          `2. Nella sezione «${tIt('settings.section.privacy')}» tocca «${tIt('account.delete.row')}».`,
          `3. Scrivi ${tIt('account.delete.confirmWord')} nel campo di conferma (${tEn('account.delete.confirmWord')}, se usi l'app in inglese) e tocca «${tIt('account.delete.cta')}».`,
          "Appena confermi chiudiamo la tua sessione su ogni dispositivo, blocchiamo l'accesso e registriamo la richiesta. Da lì non si torna indietro.",
        ],
      },
      {
        heading: "Senza l'app",
        body: [
          `Non serve reinstallare l'app. Scrivi a ${EMAIL} dall'indirizzo email con cui accedi ad ${tIt('store.name')} e chiedi di eliminare il tuo account.`,
          "Verifichiamo che la richiesta venga da te e la registriamo al posto tuo: da quel momento l'accesso è bloccato e vale tutto ciò che trovi qui sotto. Ti rispondiamo entro un mese, come prevede il GDPR.",
        ],
      },
      {
        heading: 'Il tuo abbonamento Circle',
        body: [
          'Se hai un abbonamento Circle attivo non devi disdirlo prima: lo annulliamo noi quando eseguiamo la cancellazione, e da quel momento non ti addebitiamo più nulla.',
        ],
      },
      {
        heading: 'Cosa eliminiamo',
        body: [
          tIt('account.delete.deferred'),
          "Con il profilo eliminiamo anche i tuoi contenuti, le foto e i video che hai caricato e la tua pagina pubblica su questo sito. Se eri nella lista d'attesa, togliamo anche il tuo indirizzo email.",
          'Gli eventi che hai organizzato vengono nascosti e non portano più il tuo nome. Restano solo per non cancellare con loro i biglietti e le iscrizioni delle altre persone.',
        ],
      },
      {
        heading: 'Cosa conserviamo',
        body: [
          'I pagamenti — biglietti degli eventi, abbonamenti Circle, contributi al fondo — sono registrazioni contabili, e la legge ci obbliga a tenerle per dieci anni. Le conserviamo senza il tuo nome e senza i tuoi contatti: restano solo i dati del pagamento e i suoi identificativi presso Stripe. Passati i dieci anni le eliminiamo.',
          'Conserviamo anche il registro delle notifiche di pagamento che Stripe ci invia: ci serve a non registrare mai due volte lo stesso pagamento. Ne togliamo i tuoi dati identificativi, tranne che dalle notifiche di rimborso o di contestazione di un contributo al fondo arrivate prima della cancellazione.',
        ],
      },
    ],
    reviewNote: `Questa pagina riguarda il tuo account nell'app ${tIt('store.name')}. Per i dati di chi visita questo sito vale l'informativa sulla privacy.`,
  },
  en: {
    title: tEn('account.delete.title'),
    updated: 'September 2026',
    intro: `You can ask at any time for your ${tEn('store.name')} account and the data linked to it to be deleted. This page tells you how to do it, from the app or without it, what we delete and what we keep. ${tEn('store.name')} is an app by ${CONTROLLER}.`,
    sections: [
      {
        heading: 'From the app',
        body: [
          `1. Open the “${tEn('tabs.profile')}” tab and tap the “${tEn('settings.title')}” icon.`,
          `2. In the “${tEn('settings.section.privacy')}” section, tap “${tEn('account.delete.row')}”.`,
          `3. Type ${tEn('account.delete.confirmWord')} in the confirmation field (${tIt('account.delete.confirmWord')} if you use the app in Italian) and tap “${tEn('account.delete.cta')}”.`,
          'As soon as you confirm, we close your session on every device, block sign-in and record the request. There is no going back from there.',
        ],
      },
      {
        heading: 'Without the app',
        body: [
          `You don't need to reinstall the app. Write to ${EMAIL} from the email address you use to sign in to ${tEn('store.name')} and ask us to delete your account.`,
          'We check that the request comes from you and record it on your behalf: from then on sign-in is blocked and everything below applies. We reply within one month, as the GDPR requires.',
        ],
      },
      {
        heading: 'Your Circle subscription',
        body: [
          "If you have an active Circle subscription, you don't need to cancel it first: we cancel it when we carry out the deletion, and from then on we charge you nothing more.",
        ],
      },
      {
        heading: 'What we delete',
        body: [
          tEn('account.delete.deferred'),
          'Along with your profile we delete your content, the photos and videos you uploaded, and your public page on this site. If you were on the waitlist, we remove your email address from it too.',
          "Events you organized are hidden and no longer carry your name. They remain only so that other people's tickets and sign-ups are not deleted with them.",
        ],
      },
      {
        heading: 'What we keep',
        body: [
          "Payments — event tickets, Circle subscriptions, fund contributions — are accounting records, and the law requires us to keep them for ten years. We keep them without your name or contact details: only the payment's own details and its identifiers at Stripe remain. After ten years we delete them.",
          'We also keep the log of payment notifications Stripe sends us: it is how we make sure no payment is ever recorded twice. We remove your identifying details from it, except from refund or dispute notifications about a fund contribution that arrived before the deletion.',
        ],
      },
    ],
    reviewNote: `This page is about your account in the ${tEn('store.name')} app. For the data of people who visit this site, see the privacy policy.`,
  },
};
