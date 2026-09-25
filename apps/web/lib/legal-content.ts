import {
  DECAY,
  HANDLE_RENAME_COOLDOWN_DAYS,
  MIN_MEMBER_AGE,
  NEARBY_RADIUS_KM,
  REACTION_AUTHOR_MIN_SCORE,
  SCORE_MAX,
  SCORE_MIN,
} from '@athanor/core';
import { t, type Locale, type MessageKey } from '@athanor/i18n';

/**
 * Long-form legal copy lives here as per-locale content (not in the @athanor/i18n
 * UI catalog, which is for short interface strings). Scope: `privacy` is the ONE policy for
 * both the app and this site (#774) — the app links it from Settings, sign-up and the Circle
 * screen, and it is the URL in the Play Console. `terms` covers the app and this site (#777).
 * `deleteAccount` is about the app account (#767). `childSafety` is the page Play's Child
 * Safety Standards declaration links to (#779).
 *
 * i18n-ignore-file — this module IS the translation source for these documents: every
 * export is a `Record<Locale, …>`, so IT/EN parity is enforced by the type, not by the
 * catalog. Rule 5's gate widened to object-literal copy in #433 and would otherwise report
 * every heading and paragraph here as untranslated.
 */
export type LegalLink = { label: string; href: string };
/**
 * `id` is the section's anchor (`/child-safety#contact`), the same in both locales so a link to
 * it survives a language switch. `links` render after the body as real links — a URL or an
 * address typed into a paragraph would render as text nobody can follow.
 */
export type LegalSection = { heading: string; body: string[]; id?: string; links?: LegalLink[] };
export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  reviewNote: string;
};

const CONTROLLER = 'Anecoica Studio UG (haftungsbeschränkt)';
const EMAIL = 'info@anecoica.net';

const tIt = (key: MessageKey) => t(key, 'it');
const tEn = (key: MessageKey) => t(key, 'en');

/**
 * The score engine's own numbers, as the policy states them. Read from `@athanor/core` rather
 * than copied (rule 10: they are server-tunable), so retuning the engine cannot leave the published
 * explanation of the score describing the old one. `legal-content.constants.test.ts` pins it.
 */
const DECAY_IDLE_DAYS = DECAY.IDLE_DAYS_BEFORE;
const DECAY_WEEKLY_PCT = Math.round((1 - DECAY.WEEKLY_FACTOR) * 100);
const DECAY_FLOOR_PCT = Math.round(DECAY.PEAK_FLOOR_RATIO * 100);

/**
 * What the erasure cascade deletes beyond the in-app deferral line, and what it keeps. Written
 * once and used by BOTH /delete-account and the privacy policy's retention section, so the two
 * pages cannot describe the cascade in different words. Bounded by the cascade as built — see
 * the `deleteAccount` docblock for what each sentence rests on.
 */
const ERASURE_DELETES: Record<Locale, string[]> = {
  it: [
    "Con il profilo eliminiamo anche i tuoi contenuti, le foto e i video che hai caricato e la tua pagina pubblica su questo sito. Se eri nella lista d'attesa, togliamo anche il tuo indirizzo email.",
    'Gli eventi che hai organizzato vengono nascosti e non portano più il tuo nome. Restano solo per non cancellare con loro i biglietti e le iscrizioni delle altre persone.',
  ],
  en: [
    'Along with your profile we delete your content, the photos and videos you uploaded, and your public page on this site. If you were on the waitlist, we remove your email address from it too.',
    "Events you organized are hidden and no longer carry your name. They remain only so that other people's tickets and sign-ups are not deleted with them.",
  ],
};

const ERASURE_KEEPS: Record<Locale, string[]> = {
  it: [
    'I pagamenti — biglietti degli eventi, abbonamenti Circle, contributi al fondo — sono registrazioni contabili: le teniamo per dieci anni per i nostri obblighi contabili e fiscali. Le conserviamo senza il tuo nome e senza i tuoi contatti: restano solo i dati del pagamento e i suoi identificativi presso Stripe. Passati i dieci anni le eliminiamo.',
    'Se hai fatto un pagamento, anche Stripe, che li gestisce, conserva i dati con cui hai pagato, compreso il tuo indirizzo email: eliminare il tuo account Athanor non li cancella.',
    'Conserviamo anche il registro delle notifiche di pagamento che Stripe ci invia: ci serve a non registrare mai due volte lo stesso pagamento. Ne togliamo i tuoi dati identificativi, tranne che dalle notifiche di rimborso o di contestazione di un contributo al fondo arrivate prima della cancellazione.',
  ],
  en: [
    "Payments — event tickets, Circle subscriptions, fund contributions — are accounting records: we keep them for ten years for our accounting and tax obligations. We keep them without your name or contact details: only the payment's own details and its identifiers at Stripe remain. After ten years we delete them.",
    'If you made a payment, Stripe, which handles them, also keeps the details you paid with, including your email address: deleting your Athanor account does not remove them.',
    'We also keep the log of payment notifications Stripe sends us: it is how we make sure no payment is ever recorded twice. We remove your identifying details from it, except from refund or dispute notifications about a fund contribution that arrived before the deletion.',
  ],
};

/**
 * /privacy — one policy for the app and this site (#774). The app part says only what the tree
 * does; the PR for #774 carries a claim-by-claim source table. Labels a person has to find in
 * the app are read from the UI catalog, the minimum age from `MIN_MEMBER_AGE`, and the erasure
 * sentences are /delete-account's own (`ERASURE_DELETES` / `ERASURE_KEEPS`), so neither page can
 * drift from the other. The fund is OFF on production (#249): contribution records are described
 * as what we keep when it is open, never as a live feature.
 */
export const privacy: Record<Locale, LegalDoc> = {
  it: {
    title: 'Informativa sulla privacy',
    updated: 'Settembre 2026',
    intro: `Questa informativa spiega come ${CONTROLLER} tratta i dati personali di chi usa l'app ${tIt('store.name')} e di chi visita questo sito. Prima trovi cosa riguarda l'app, poi cosa riguarda solo il sito; le ultime sezioni — a chi arrivano i dati, su quali basi, per quanto tempo, l'età minima e i tuoi diritti — valgono per entrambi. Non vendiamo i tuoi dati e non li usiamo per la pubblicità.`,
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
        heading: "Nell'app: il tuo account",
        body: [
          "Per iscriverti ti chiediamo un indirizzo email e una password, oppure puoi accedere con Google o con Apple. Google ci passa indirizzo email, nome e foto del tuo account. Apple ci passa il tuo indirizzo email, oppure, se scegli di nasconderlo, un indirizzo di inoltro creato da Apple che gira i messaggi alla tua casella, e il nome solo al primo accesso. Il nome diventa quello che mostri, e puoi cambiarlo nel profilo; la foto non la usiamo. La password non la conserviamo in chiaro: il servizio di accesso ne tiene solo un'impronta crittografica (hash), da cui non si può risalire alla password.",
          `Se ti iscrivi con l'email ti chiediamo il nome da mostrare; in ogni caso ti chiediamo la data di nascita. La tua @handle, il nome con cui compari, la scegli tu dopo l'iscrizione: non la ricaviamo dal tuo indirizzo email. Puoi cambiarla dal profilo una volta ogni ${HANDLE_RENAME_COOLDOWN_DAYS} giorni; il nome di prima torna subito libero, e i link al tuo profilo che lo contengono non portano più a te: se qualcun altro lo sceglie, porteranno alla sua pagina. La pagina già pronta e l'immagine di anteprima che accompagnava quei link possono restare per un breve periodo nella cache della rete: quando cambi nome le togliamo.`,
          "La data di nascita serve a verificare che tu abbia l'età minima e a calcolare il tuo segno zodiacale. La data la vedi solo tu; chi vede il segno lo scegli tu, come per le altre parti del profilo.",
          'Conserviamo anche la lingua che usi e, se ti ha invitato qualcuno, il collegamento con quella persona.',
        ],
      },
      {
        heading: "Nell'app: il profilo e chi lo vede",
        body: [
          `Nel profilo puoi aggiungere una bio, la tua missione, la professione, le competenze, la città, le parole che ti descrivono, ciò che cerchi e il tuo sogno con le sue tappe. Per ciascuna di queste parti, e per il tuo segno zodiacale, scegli tu «${tIt('profile.visibility.label')}»: «${tIt('visibility.public')}», «${tIt('visibility.members')}» o «${tIt('visibility.private')}». Se non scegli, vale «${tIt('visibility.members')}». Ciò che imposti su «${tIt('visibility.private')}» lo vedi solo tu.`,
          `Nome, foto e @handle li vedono tutte le persone iscritte. Per questi scegli tra «${tIt('visibility.public')}» e «${tIt('visibility.members')}», e all'inizio è «${tIt('visibility.members')}»: non hai una pagina pubblica. In passato all'inizio era «${tIt('visibility.public')}»: chi si è iscritto allora lo mantiene finché non lo cambia. Con «${tIt('visibility.public')}» hai una pagina pubblica su questo sito, visibile a chiunque e ai motori di ricerca, con @handle, nome e foto, con il tuo segno zodiacale se l'hai reso visibile a «${tIt('visibility.public')}», e con il tuo sogno e le sue tappe se li hai resi visibili a «${tIt('visibility.public')}». Il link alla pagina porta con sé un'immagine di anteprima con nome, foto, @handle e, se è visibile a «${tIt('visibility.public')}», il tuo sogno. Quando cambi chi vede la pagina, il sogno o il segno, togliamo la pagina e l'immagine dalla cache della rete, dove possono restare per un breve periodo; fino alla versione successiva del sito, il link mostra l'anteprima generale di ${tIt('store.name')} al posto della tua.`,
          'Il tuo punteggio Aura e le stelle che hai ottenuto sono pubblici. Le altre persone iscritte vedono anche il dettaglio del punteggio per tipo di azione, il massimo che hai raggiunto e la data della tua ultima azione che conta, se hai verificato la tua identità e quanti eventi e aiuti hai completato.',
          "A quali eventi partecipi, anche con un biglietto, lo vedono solo chi organizza l'evento e le altre persone che vi partecipano. Tutte le altre persone iscritte vedono solo quante persone partecipano.",
        ],
      },
      {
        heading: "Nell'app: ciò che condividi",
        body: [
          `Post, commenti, storie, i Momenti del tuo percorso e progetti li vedono le altre persone iscritte. Chi hai bloccato non vede i tuoi post, commenti, storie e Momenti, e tu non vedi i suoi. Le storie restano visibili 24 ore, a meno che tu non scelga «${tIt('story.own.pin')}».`,
          "Le reazioni che lasci non sono visibili agli altri: chi ha scritto il post ne vede solo il numero. Le offerte di aiuto e l'aiuto sulle tappe li vedono solo le persone coinvolte.",
          'Gli eventi che organizzi sono pubblici: ognuno ha una pagina su questo sito, con titolo, descrizione, luogo, data e prezzo, e come organizzatore compare la tua @handle se la tua pagina pubblica è attiva.',
          "Foto, video e note vocali sono conservati in archivi privati e si aprono solo con collegamenti temporanei, tranne la foto del profilo nell'immagine di anteprima della tua pagina pubblica. Dalle foto togliamo i metadati, come il punto in cui sono state scattate; da video e note vocali li togliamo sul server, e nei rari casi in cui non ci riusciamo il file resta com'è.",
        ],
      },
      {
        heading: "Nell'app: i messaggi",
        body: [
          'I messaggi sono sempre tra due persone e li conserviamo sui nostri server, per consegnarli e per mostrarti la conversazione. Viaggiano su connessioni cifrate, ma non sono cifrati end-to-end. Dal pannello di moderazione il team può leggere solo i messaggi che qualcuno ha segnalato.',
          "Se hai le notifiche attive, l'avviso di un nuovo messaggio mostra la @handle di chi ti scrive e l'inizio del testo, e passa dai servizi di notifica di Expo, Apple e Google.",
          "Se una delle due persone elimina il proprio account, la conversazione viene cancellata per entrambe; le foto inviate dall'altra persona restano nei nostri archivi, non visibili a nessuno, finché anche lei non elimina l'account.",
        ],
      },
      {
        heading: "Nell'app: la posizione",
        body: [
          `L'app usa la posizione del telefono solo se l'interruttore «${tIt('gdpr.location.label')}» in «${tIt('settings.trust.title')}» è acceso e se glielo permetti anche nelle impostazioni del telefono, e solo mentre la stai usando: mai in background. L'interruttore è acceso finché non lo spegni; spento, l'app non legge mai la posizione del telefono. Chiede al telefono la posizione meno precisa che offre, e su Android ha solo il permesso per la posizione approssimativa. Prima che la posizione lasci il telefono la arrotondiamo a una griglia di riquadri di circa 2–3 chilometri di lato. Il nome della città lo chiede al servizio di localizzazione del telefono, di Apple o di Google, partendo dalla posizione arrotondata.`,
          `In «${tIt('live.tab.vicino')}» la usiamo, arrotondata, per trovare gli eventi nel raggio di ${NEARBY_RADIUS_KM} chilometri: arriva ai nostri server per la ricerca, ma non la salviamo.`,
          "Per creare un evento dal vivo scrivi il luogo e la città: per trovarli li mandiamo al servizio di localizzazione del telefono, di Apple o di Google, e il punto che ci restituisce lo arrotondiamo alla stessa griglia. Al posto del luogo, se l'interruttore è acceso, puoi scegliere la tua posizione, arrotondata allo stesso modo. Il punto resta salvato con l'evento e indica una zona di qualche chilometro, non un indirizzo. Può leggerlo solo chi ha un account Athanor, e nell'app si vede come distanza dall'evento; la pagina pubblica dell'evento non lo mostra.",
          'La città del tuo profilo invece la scrivi tu. Quando vuoi puoi spegnere l’interruttore, oppure negare o revocare il permesso dalle impostazioni del telefono: in entrambi i casi non vedi gli eventi vicini, e un evento dal vivo lo crei solo dal luogo che scrivi (su Android, per cercarlo serve comunque il permesso del telefono, ma la tua posizione non viene letta). Non tracciamo i tuoi spostamenti.',
        ],
      },
      {
        heading: `Nell'app: Aura e ${tIt('momenti.title')}`,
        body: [
          `L'Aura è il tuo punteggio di reputazione, da ${SCORE_MIN} a ${SCORE_MAX}. Lo calcola un programma sui nostri server, solo a partire da ciò che fai nell'app: verificare la tua identità, partecipare a eventi o organizzarli, completare le tappe del tuo sogno (le segni tu), aiutare altre persone con le loro, le conversazioni in chat in cui scrivete entrambi e che arrivano ad almeno dieci messaggi, e le stelle che altre persone accendono sui tuoi post. Alcune azioni hanno un limite per periodo, gli scambi ripetuti con la stessa persona valgono via via meno, e una stella conta solo se chi la accende ha più di ${REACTION_AUTHOR_MIN_SCORE} punti di Aura. Se per più di ${DECAY_IDLE_DAYS} giorni non ricevi punti, il punteggio cala del ${DECAY_WEEKLY_PCT}% a settimana, mai sotto il ${DECAY_FLOOR_PCT}% del massimo che hai raggiunto.`,
          "L'abbonamento Circle e i contributi al fondo non danno punti: l'Aura non si compra. Se il team di moderazione, decidendo su una segnalazione contro di te, sceglie una penalità, l'Aura scende. L'Aura compare sul tuo profilo, decide se le stelle che accendi contano, e chi ha Circle può usarla per filtrare la ricerca delle persone.",
          `Ogni notte un programma propone a chi ha un sogno attivo fino a tre persone con cui parlare: sono i ${tIt('momenti.title')}. Confronta le parole che vi descrivono, ciò che cercate, le competenze, le professioni, la vicinanza delle vostre città e gli eventi a cui avete partecipato entrambi; se non trova affinità, può proporti chi ha un sogno nuovo. A chi riceve la proposta mostriamo il perché, per esempio un evento in comune. Lo stesso confronto sceglie fino a tre persone per «${tIt('momenti.suggestionsTitle')}».`,
          `Ciò che imposti su «${tIt('visibility.private')}» non lo usiamo mai per proporti ad altre persone e non lo mostriamo a nessuno; lo usiamo solo per scegliere chi proporre a te. Non proponiamo tra loro persone che si sono bloccate, e se imposti il tuo sogno su «${tIt('visibility.private')}» non ti proponiamo a nessuno.`,
          `Né l'Aura né i ${tIt('momenti.title')} prendono da soli decisioni che hanno effetti giuridici su di te o che ti toccano in modo simile: avvisi, sospensioni ed esclusioni le decide sempre una persona del team di moderazione.`,
        ],
      },
      {
        heading: "Nell'app: segnalazioni e blocchi",
        body: [
          "Puoi segnalare una persona, un post, un messaggio o un comportamento. Della segnalazione conserviamo chi l'ha fatta, cosa riguarda, il motivo e la nota facoltativa. Oltre a te, può leggerla solo il team di moderazione, e chi viene segnalato non sa chi l'ha fatta.",
          `Se una segnalazione riguarda materiale che appare come abuso sessuale su minori, quel materiale lo segnaliamo alle autorità competenti, come spiega la pagina «${tIt('legal.childSafety')}» di questo sito.`,
          "Quando il team decide su una segnalazione — un avviso, una penalità sull'Aura, una sospensione o un'esclusione — la decisione resta in un registro, con chi l'ha presa e perché.",
          'Puoi bloccare chi vuoi. Da quel momento non vedete più a vicenda profili, post, commenti, storie, Momenti e messaggi; eventi e progetti restano visibili. Nella tua lista dei bloccati continui a vedere nome e foto di chi hai bloccato, e quella lista la vedi solo tu.',
        ],
      },
      {
        heading: "Nell'app: pagamenti e verifica dell'identità",
        body: [
          'I pagamenti li gestisce Stripe, sulle sue pagine: i dati della tua carta non passano mai da noi. Insieme a ogni pagamento passiamo a Stripe un nostro codice che lo collega al tuo account.',
          "Per un biglietto conserviamo l'evento, lo stato del pagamento, i suoi identificativi presso Stripe e il codice del tuo QR; a Stripe passiamo l'evento e il prezzo, e i dati di pagamento, email compresa, li inserisci tu sulla sua pagina. Per l'abbonamento Circle passiamo a Stripe il tuo indirizzo email, e conserviamo lo stato dell'abbonamento e i suoi identificativi. Quando il fondo è aperto, di ogni contributo conserviamo l'importo e i suoi identificativi presso Stripe: gli altri vedono solo il totale raccolto e quante persone hanno contribuito, mai il tuo contributo.",
          "Stripe ci manda una notifica per ogni pagamento, abbonamento, verifica dell'identità e aggiornamento del conto di pagamento, e noi la conserviamo: ci serve a non registrare mai due volte la stessa operazione. Può contenere il tuo nome, la tua email e il tuo indirizzo di fatturazione e, per un conto di pagamento, il titolare e la banca del conto.",
          "Per alcune funzioni, come vendere biglietti, ti chiediamo di verificare la tua identità. Il documento lo raccoglie e lo controlla Stripe sulla sua pagina: a noi arriva l'esito e, se non va a buon fine, il motivo indicato da Stripe. Per ricevere i soldi dei biglietti apri poi un conto di pagamento presso Stripe: gli passiamo il tuo indirizzo email, e i dati che servono per pagarti, come il conto bancario, li inserisci tu sulla sua pagina.",
        ],
      },
      {
        heading: "Nell'app: notifiche",
        body: [
          "Se permetti le notifiche, salviamo l'identificativo che Expo assegna al tuo telefono per riceverle, il tipo di sistema (iOS o Android) e il codice della sua versione. Le notifiche partono tramite Expo, che le consegna tramite Apple o Google; il testo può contenere la @handle di chi ha fatto qualcosa, il titolo di un evento e, per i messaggi, l'inizio del testo.",
          `Scegli quali ricevere in «${tIt('settings.notif.title')}», oppure spegnile dalle impostazioni del telefono. Le notifiche che vedi dentro l'app restano nella tua casella finché hai l'account.`,
        ],
      },
      {
        heading: "Nell'app: diagnostica",
        body: [
          `Se accendi «${tIt('gdpr.consent.diagnostics')}» (in «${tIt('settings.trust.title')}», sezione «${tIt('gdpr.consent.section')}»), l'app manda a Sentry un rapporto quando va in errore e un breve segnale a ogni apertura; Sentry li conserva nell'Unione Europea, in Germania. Contengono l'errore, il modello e il sistema del telefono, la versione dell'app, gli ultimi passaggi fatti nell'app e un codice casuale legato all'installazione, non al tuo account. Non vi aggiungiamo il tuo nome, la tua email né i tuoi contenuti.`,
          'È spenta finché non la accendi, e puoi spegnerla quando vuoi: da quel momento non parte più nulla.',
        ],
      },
      {
        heading: "Nell'app: sul tuo telefono",
        body: [
          "L'app non contiene strumenti di analisi, di pubblicità o di tracciamento di terzi, e non usa identificativi pubblicitari.",
          "Sul telefono teniamo la tua sessione, cifrata, e una copia dei dati già caricati, per aprire l'app più in fretta: la copia la cancelliamo quando esci dall'account, mentre le immagini già viste possono restare nella cache del telefono. Se aggiungi un evento al calendario, l'app lo scrive nel calendario del telefono; i tuoi appuntamenti non li salviamo e non li mandiamo a nessuno. Quando cerca aggiornamenti, l'app contatta i server di Expo.",
        ],
      },
      {
        heading: 'Sul sito: log tecnici e lista d’attesa',
        body: [
          'Il sito non richiede un account e non profila chi lo visita. Log tecnici: per servire le pagine, il nostro fornitore di hosting (Cloudflare) registra dati tecnici minimi — ad esempio gli header inviati dal browser, l’indirizzo IP e la data e ora della richiesta. La base giuridica è il legittimo interesse a far funzionare il sito e a mantenerlo sicuro; questi dati non vengono usati per profilarti.',
          'Lista d’attesa. Se compili il modulo di iscrizione, trattiamo l’indirizzo email che inserisci (insieme alla lingua scelta e alla provenienza dal sito) al solo scopo di avvisarti quando Athanor sarà disponibile. La base giuridica è il tuo consenso. L’indirizzo è conservato su Supabase (Unione Europea, Francoforte). Non ti inviamo alcun messaggio al momento dell’iscrizione. Non lo usiamo per altre comunicazioni di marketing oltre all’avviso di lancio e non lo cediamo né vendiamo a terzi. Lo cancelliamo al più tardi dopo circa 18 mesi, oppure prima se crei un account o ci chiedi di rimuoverlo.',
          'Per limitare le iscrizioni automatiche contiamo quante ne arrivano da ogni indirizzo IP: dell’indirizzo non salviamo il valore, ma solo un’impronta (hash) legata a una finestra di dieci minuti, che poi eliminiamo.',
        ],
      },
      {
        heading: 'Sul sito: cookie e statistiche',
        body: [
          'Usiamo un solo cookie funzionale, `athanor_locale`, che ricorda la lingua scelta (italiano o inglese). Non serve a profilare e non viene condiviso con terzi. Il sito ricorda inoltre, nel tuo browser, che hai chiuso l’avviso sui cookie.',
          'Per capire come viene usato il sito usiamo statistiche aggregate e senza cookie (Cloudflare Web Analytics): non identificano la singola persona e non tracciano la navigazione tra siti diversi.',
        ],
      },
      {
        heading: 'A chi arrivano i tuoi dati',
        body: [
          `Alle altre persone, come descritto sopra e secondo le scelte che fai. Per il resto, solo ai fornitori che ci servono per far funzionare ${tIt('store.name')}, ciascuno per ciò che gli serve.`,
          "Supabase ospita il database, l'accesso, i file e le funzioni server dell'app, e invia le email di accesso, come quella per reimpostare la password. I dati sono nell'Unione Europea, a Francoforte.",
          'Cloudflare serve questo sito dalla sua rete globale: ogni richiesta è gestita dal nodo più vicino a chi visita, che può trovarsi fuori dall’Unione Europea. Riguarda il caricamento delle pagine, il beacon di statistiche (che raggiunge Cloudflare, Inc. indipendentemente dal nodo che ha servito la pagina), l’invio del modulo della lista d’attesa, e le pagine pubbliche di profili, sogni ed eventi, la cui versione già composta resta per un breve periodo nella cache della rete.',
          'Stripe gestisce pagamenti, abbonamenti, verifica dell’identità e conti per ricevere i pagamenti, come descritto sopra.',
          'Expo inoltra le notifiche push e distribuisce gli aggiornamenti dell’app. Apple e Google consegnano le notifiche ai telefoni e danno il nome della città a partire dalla posizione; Google e Apple, se li scegli, gestiscono anche l’accesso con il tuo account Google o Apple.',
          'Sentry riceve i rapporti di errore, solo se accendi la diagnostica, e li conserva nell’Unione Europea.',
          `Alla polizia e alle linee di segnalazione nazionali, il materiale che appare come abuso sessuale su minori, come spiega la pagina «${tIt('legal.childSafety')}» di questo sito.`,
          `Alcuni di questi fornitori hanno sede negli Stati Uniti o possono trattare dati fuori dall’Unione Europea. In quei casi il trasferimento si fonda sulle clausole contrattuali tipo approvate dalla Commissione europea, incluse nei loro accordi sul trattamento dei dati (per Cloudflare: cloudflare.com/cloudflare-customer-dpa), o sull’adesione al Data Privacy Framework UE-USA, come per Cloudflare. Puoi chiederne copia scrivendo a ${EMAIL}.`,
        ],
      },
      {
        heading: 'Basi giuridiche',
        body: [
          `Trattiamo i dati dell'app per darti il servizio che chiedi iscrivendoti — account, profilo, contenuti, messaggi, eventi, biglietti, Circle, Aura e ${tIt('momenti.title')}: la base giuridica è il contratto tra te e noi. Senza questi dati l'app non può funzionare.`,
          'Diagnostica e notifiche push si basano sul tuo consenso, che puoi ritirare quando vuoi; il ritiro non tocca ciò che è avvenuto prima. Anche la lista d’attesa del sito si basa sul tuo consenso.',
          `Segnalazioni, blocchi, moderazione e protezione dagli abusi, come i log tecnici e il cookie della lingua sul sito, si basano sul nostro legittimo interesse a tenere ${tIt('store.name')} sicuro e funzionante. Puoi opporti in qualsiasi momento scrivendoci.`,
          'Conserviamo i pagamenti per i nostri obblighi contabili e fiscali.',
        ],
      },
      {
        heading: 'Per quanto tempo li conserviamo',
        body: [
          "Teniamo i dati del tuo account finché hai l'account. Quando togli qualcosa che hai pubblicato non lo vedono più gli altri, e lo cancelliamo del tutto quando elimini l'account.",
          tIt('account.delete.deferred'),
          ...ERASURE_DELETES.it,
          ...ERASURE_KEEPS.it,
          'Le segnalazioni che riguardano te o i tuoi contenuti, con le decisioni prese, restano anche dopo; le cancelliamo quando chi le ha fatte elimina il proprio account. Quelle che hai fatto tu le cancelliamo con il tuo account.',
          `L'archivio che prepariamo con «${tIt('settings.export.title')}» lo conserviamo 7 giorni, per tutto il tempo in cui vale il collegamento per scaricarlo; poi lo cancelliamo, e puoi chiederne uno nuovo quando vuoi. Se elimini l'account prima di averlo scaricato, l'archivio viene cancellato insieme all'account.`,
        ],
      },
      {
        heading: 'Età minima',
        body: [
          `${tIt('store.name')} è per chi ha almeno ${MIN_MEMBER_AGE} anni. All'iscrizione ti chiediamo la data di nascita e non accettiamo chi non ha ancora quell'età. Se pensi che si sia iscritta una persona più giovane, scrivici a ${EMAIL}.`,
        ],
      },
      {
        heading: 'I tuoi diritti',
        body: [
          `In base al GDPR puoi chiedere in qualsiasi momento l’accesso, la rettifica, la cancellazione, la limitazione e la portabilità dei dati che ti riguardano, opporti al trattamento e revocare un consenso che ci hai dato. La revoca non pregiudica i trattamenti svolti prima. Per esercitare questi diritti scrivi a ${EMAIL}.`,
          `Molte cose le fai da te nell'app: correggi il profilo e scegli chi vede cosa; in «${tIt('settings.title')}», sezione «${tIt('settings.section.privacy')}», trovi «${tIt('settings.export.title')}» per avere una copia dei tuoi dati ed «${tIt('account.delete.row')}» per chiedere la cancellazione. L'archivio contiene i dati del tuo account, compresa l'email, ciò che hai scritto e pubblicato, e i file di foto, video e note vocali che hai caricato tu. Contiene anche le tue conversazioni per intero, con i messaggi che hai ricevuto: l'altra persona compare solo con la sua @handle, e delle foto che ti ha inviato trovi il nome del file, non la foto, perché sono dati suoi. Come eliminare l'account anche senza l'app lo trovi nella pagina «${tIt('account.delete.title')}» di questo sito.`,
          'Hai inoltre il diritto di presentare un reclamo a un’autorità di controllo. Per il nostro titolare l’autorità competente è il Garante di Berlino (Berliner Beauftragte für Datenschutz und Informationsfreiheit), ma puoi rivolgerti anche all’autorità del tuo Paese di residenza — in Italia, il Garante per la protezione dei dati personali.',
        ],
      },
    ],
    reviewNote:
      'La ragione sociale completa e i dati di registrazione sono nell’impressum su anecoica.net.',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'September 2026',
    intro: `This policy explains how ${CONTROLLER} handles the personal data of people who use the ${tEn('store.name')} app and of people who visit this site. First comes what concerns the app, then what concerns only the site; the last sections — who receives the data, on what legal basis, for how long, the minimum age and your rights — apply to both. We do not sell your data and we do not use it for advertising.`,
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
        heading: 'In the app: your account',
        body: [
          "To join, we ask for an email address and a password, or you can sign in with Google or with Apple. Google passes us your Google account's email address, name and photo. Apple passes us your email address, or, if you choose to hide it, a relay address Apple creates that forwards messages to your inbox, and your name on the first sign-in only. The name becomes the one you show, and you can change it in your profile; the photo we do not use. We never store your password in plain text: the sign-in service keeps only a one-way cryptographic fingerprint of it (a hash), from which the password cannot be recovered.",
          `If you sign up with email we ask for the name you want to show; either way we ask for your date of birth. You choose your @handle, the name you appear under, after signing up: we do not derive it from your email address. You can change it from your profile once every ${HANDLE_RENAME_COOLDOWN_DAYS} days; the old name becomes free at once, and links to your profile that use it no longer lead to you: if someone else takes it, they will lead to their page. The page already rendered and the preview image that went with those links may stay in the network's cache for a short time: when you change the name, we remove them.`,
          'Your date of birth is used to check that you meet the minimum age and to work out your zodiac sign. Only you see the date; you choose who sees the sign, as with the other parts of your profile.',
          'We also keep the language you use and, if someone invited you, the link to that person.',
        ],
      },
      {
        heading: 'In the app: your profile and who sees it',
        body: [
          `In your profile you can add a bio, your mission, your profession, your skills, your city, the words that describe you, what you are looking for, and your dream with its milestones. For each of these, and for your zodiac sign, you choose “${tEn('profile.visibility.label')}”: “${tEn('visibility.public')}”, “${tEn('visibility.members')}” or “${tEn('visibility.private')}”. If you don't choose, “${tEn('visibility.members')}” applies. What you set to “${tEn('visibility.private')}” is seen by you alone.`,
          `Your name, photo and @handle are seen by every member. For these you choose between “${tEn('visibility.public')}” and “${tEn('visibility.members')}”, and it starts as “${tEn('visibility.members')}”: you have no public page. It used to start as “${tEn('visibility.public')}”: members who joined then keep it until they change it. With “${tEn('visibility.public')}” you have a public page on this site, visible to anyone and to search engines, with your @handle, name and photo, with your zodiac sign if you made it visible to “${tEn('visibility.public')}”, and with your dream and its milestones if you made them visible to “${tEn('visibility.public')}”. A link to the page carries a preview image with your name, photo, @handle and, if it is visible to “${tEn('visibility.public')}”, your dream. When you change who sees the page, the dream or the sign, we remove the page and the image from the network's cache, where they may stay for a short time; until the next version of the site, the link shows the general ${tEn('store.name')} preview instead of yours.`,
          'Your Aura score and the stars you have earned are public. Other members can also see the score’s breakdown by kind of action, the highest it has reached and the date of your last action that counted, whether you have verified your identity, and how many events and helps you have completed.',
          "Which events you are attending, including with a ticket, is seen only by the event's organiser and the other people attending it. Every other member sees only how many people are attending.",
        ],
      },
      {
        heading: 'In the app: what you share',
        body: [
          `Posts, comments, stories, the Moments of your journey and projects are seen by other members. People you have blocked do not see your posts, comments, stories and Moments, and you do not see theirs. Stories stay visible for 24 hours unless you choose “${tEn('story.own.pin')}”.`,
          'The reactions you leave are not visible to others: the author of a post sees only how many there are. Help offers and help with milestones are seen only by the people involved.',
          'Events you organize are public: each has a page on this site with its title, description, place, date and price, and your @handle appears as organizer if your public page is on.',
          "Photos, videos and voice notes are kept in private storage and open only through temporary links, except your profile photo in your public page's preview image. We remove the metadata from photos, such as where they were taken; from videos and voice notes we remove it on the server, and in the rare cases where that fails the file stays as it was.",
        ],
      },
      {
        heading: 'In the app: messages',
        body: [
          'Messages are always between two people, and we keep them on our servers to deliver them and to show you the conversation. They travel over encrypted connections, but they are not end-to-end encrypted. From the moderation panel the team can read only messages that someone has reported.',
          'If you have notifications on, the alert for a new message shows the @handle of the person writing and the start of the text, and it passes through the notification services of Expo, Apple and Google.',
          'If either person deletes their account, the conversation is deleted for both; the photos the other person sent stay in our storage, visible to no one, until they delete their account too.',
        ],
      },
      {
        heading: 'In the app: location',
        body: [
          `The app uses your phone's location only if the “${tEn('gdpr.location.label')}” switch in “${tEn('settings.trust.title')}” is on and you also allow it in your phone's settings, and only while you are using the app: never in the background. The switch is on until you turn it off; when it is off, the app never reads your phone's location. It asks the phone for the least precise position it offers, and on Android it holds only the approximate-location permission. Before the position leaves your phone we round it to a grid of cells roughly 2–3 kilometres on a side. The name of the city comes from your phone's location service, Apple's or Google's, working from the rounded position.`,
          `In “${tEn('live.tab.vicino')}” we use it, rounded, to find events within ${NEARBY_RADIUS_KM} kilometres: it reaches our servers for the search, but we do not store it.`,
          "To create an in-person event you type the venue and the city: to find them we send them to your phone's location service, Apple's or Google's, and round the point it returns to the same grid. Instead of the venue, if the switch is on, you can choose your own location, rounded the same way. The point is stored with the event and marks an area a few kilometres across, not an address. Only people with an Athanor account can read it, and in the app it shows as a distance from the event; the event's public page does not show it.",
          "The city on your profile, instead, is one you type. At any time you can turn the switch off, or refuse or withdraw the permission in your phone's settings: either way you will not see nearby events, and you can create an in-person event only from the venue you type (on Android, finding the venue still needs the phone's permission, but your position is not read). We do not track your movements.",
        ],
      },
      {
        heading: `In the app: Aura and ${tEn('momenti.title')}`,
        body: [
          `Aura is your reputation score, from ${SCORE_MIN} to ${SCORE_MAX}. A program on our servers calculates it only from what you do in the app: verifying your identity, attending or organizing events, completing your dream's milestones (you mark them done yourself), helping other people with theirs, chat conversations in which you both write and that reach at least ten messages, and the stars other people light on your posts. Some actions have a limit per period, repeated exchanges with the same person are worth less and less, and a star counts only if the person lighting it has more than ${REACTION_AUTHOR_MIN_SCORE} Aura. If you receive no points for more than ${DECAY_IDLE_DAYS} days, the score drops by ${DECAY_WEEKLY_PCT}% a week, never below ${DECAY_FLOOR_PCT}% of the highest it has reached.`,
          'A Circle subscription and fund contributions earn no points: Aura cannot be bought. If the moderation team, deciding on a report against you, chooses a penalty, your Aura goes down. Aura appears on your profile, decides whether the stars you light count, and Circle members can use it to filter people search.',
          `Every night a program suggests, to people with an active dream, up to three people to talk to: these are ${tEn('momenti.title')}. It compares the words that describe you both, what you are looking for, skills, professions, how close your cities are and the events you both attended; when it finds no affinity, it may suggest someone with a new dream. We show the person receiving the suggestion why, for example an event in common. The same comparison picks up to three people for “${tEn('momenti.suggestionsTitle')}”.`,
          `Anything you set to “${tEn('visibility.private')}” is never used to suggest you to others and never shown to anyone; we use it only to choose whom to suggest to you. We never suggest people who have blocked each other, and if you set your dream to “${tEn('visibility.private')}” we suggest you to no one.`,
          `Neither Aura nor ${tEn('momenti.title')} takes, on its own, decisions that have legal effects on you or affect you in a similar way: warnings, suspensions and bans are always decided by a person on the moderation team.`,
        ],
      },
      {
        heading: 'In the app: reports and blocks',
        body: [
          'You can report a person, a post, a message or a behavior. For each report we keep who made it, what it concerns, the reason and the optional note. Apart from you, only the moderation team reads it, and the person reported is not told who reported them.',
          `If a report concerns what appears to be child sexual abuse material, we report that material to the competent authorities, as this site's “${tEn('legal.childSafety')}” page explains.`,
          'When the team decides on a report — a warning, an Aura penalty, a suspension or a ban — the decision is kept in a log, with who took it and why.',
          "You can block anyone. From then on you no longer see each other's profiles, posts, comments, stories, Moments and messages; events and projects stay visible. Your list of blocked people keeps showing you their names and photos, and only you see that list.",
        ],
      },
      {
        heading: 'In the app: payments and identity verification',
        body: [
          'Payments are handled by Stripe, on its own pages: your card details never pass through us. With every payment we pass Stripe a code of ours that links it to your account.',
          'For a ticket we keep the event, the payment status, its identifiers at Stripe and your QR code; we pass Stripe the event and the price, and you enter your payment details, email included, on its page. For a Circle subscription we pass Stripe your email address, and we keep the subscription status and its identifiers. When the fund is open, for each contribution we keep the amount and its identifiers at Stripe: others see only the total raised and how many people contributed, never your contribution.',
          'Stripe sends us a notification for every payment, subscription change, identity check and payout-account update, and we keep it: it is how we make sure nothing is recorded twice. It may contain your name, your email and your billing address and, for a payout account, the account holder and bank.',
          'For some features, such as selling tickets, we ask you to verify your identity. Stripe collects and checks the document on its own page: we receive the result and, if it fails, the reason Stripe gives. To receive ticket money you then open a payout account with Stripe: we pass it your email address, and you enter the details needed to pay you, such as your bank account, on its page.',
        ],
      },
      {
        heading: 'In the app: notifications',
        body: [
          'If you allow notifications, we store the identifier Expo assigns to your phone to receive them, the kind of system (iOS or Android) and its build code. Notifications are sent through Expo, which delivers them through Apple or Google; the text may include the @handle of whoever did something, an event title and, for messages, the start of the text.',
          `Choose which ones you receive in “${tEn('settings.notif.title')}”, or turn them off in your phone's settings. The notifications you see inside the app stay in your inbox as long as you have the account.`,
        ],
      },
      {
        heading: 'In the app: diagnostics',
        body: [
          `If you turn on “${tEn('gdpr.consent.diagnostics')}” (in “${tEn('settings.trust.title')}”, section “${tEn('gdpr.consent.section')}”), the app sends Sentry a report when it hits an error and a short signal each time it opens; Sentry keeps them in the European Union, in Germany. They contain the error, your phone's model and system, the app version, the last steps taken in the app and a random code tied to the installation, not to your account. We do not add your name, your email or your content.`,
          'It is off until you turn it on, and you can turn it off at any time: from then on nothing more is sent.',
        ],
      },
      {
        heading: 'In the app: on your phone',
        body: [
          'The app contains no third-party analytics, advertising or tracking tools, and uses no advertising identifiers.',
          "On your phone we keep your session, encrypted, and a copy of data already loaded so the app opens faster: we delete that copy when you sign out, while images you have already seen may stay in the phone's cache. If you add an event to your calendar, the app writes it into your phone's calendar; we do not store your appointments or send them to anyone. When it checks for updates, the app contacts Expo's servers.",
        ],
      },
      {
        heading: 'On the site: technical logs and waitlist',
        body: [
          'The site requires no account and does not profile visitors. Technical logs: to serve the pages, our hosting provider (Cloudflare) records minimal technical data — such as the headers your browser sends, your IP address and the time of the request. The legal basis is our legitimate interest in operating and securing the site; this data is not used to profile you.',
          'Waitlist. If you submit the sign-up form, we process the email address you enter (along with your chosen language and the fact you came from the site) for the sole purpose of letting you know when Athanor is available. The legal basis is your consent. The address is stored on Supabase (European Union, Frankfurt). We send you no message when you sign up. We do not use it for any marketing beyond the launch notice, and we do not share or sell it. We delete it after roughly 18 months at the latest, or sooner if you create an account or ask us to remove it.',
          'To limit automated sign-ups we count how many arrive from each IP address: we do not store the address itself, only a fingerprint of it (a hash) tied to a ten-minute window, which we then delete.',
        ],
      },
      {
        heading: 'On the site: cookies and statistics',
        body: [
          'We use a single functional cookie, `athanor_locale`, which remembers your chosen language (Italian or English). It is not used for profiling and is not shared with third parties. The site also remembers, in your browser, that you closed the cookie notice.',
          'To understand how the site is used we rely on aggregated, cookieless statistics (Cloudflare Web Analytics): they do not identify individuals and do not track browsing across other sites.',
        ],
      },
      {
        heading: 'Who receives your data',
        body: [
          `Other people, as described above and according to the choices you make. Beyond that, only the providers we need to run ${tEn('store.name')}, each for what it needs.`,
          'Supabase hosts the app’s database, sign-in, files and server functions, and sends sign-in emails such as the one to reset your password. The data is in the European Union, in Frankfurt.',
          'Cloudflare serves this site from its global network: each request is handled by the node closest to the visitor, which may sit outside the European Union. This covers page loads, the analytics beacon (which reaches Cloudflare, Inc. regardless of which node served the page), waitlist form submissions, and the public pages of profiles, dreams and events, whose rendered version stays briefly in the network’s cache.',
          'Stripe handles payments, subscriptions, identity verification and payout accounts, as described above.',
          'Expo relays push notifications and delivers app updates. Apple and Google deliver notifications to phones and turn a location into a city name; Google and Apple, if you choose them, also handle sign-in with your Google or Apple account.',
          'Sentry receives error reports, only if you turn diagnostics on, and keeps them in the European Union.',
          `The police and national hotlines receive what appears to be child sexual abuse material, as this site's “${tEn('legal.childSafety')}” page explains.`,
          `Some of these providers are based in the United States or may process data outside the European Union. In those cases the transfer relies on the standard contractual clauses approved by the European Commission and incorporated in their data processing agreements (for Cloudflare: cloudflare.com/cloudflare-customer-dpa), or on their certification under the EU–US Data Privacy Framework, as for Cloudflare. You can request a copy by writing to ${EMAIL}.`,
        ],
      },
      {
        heading: 'Legal bases',
        body: [
          `We process app data to give you the service you ask for when you join — account, profile, content, messages, events, tickets, Circle, Aura and ${tEn('momenti.title')}: the legal basis is the contract between you and us. Without this data the app cannot work.`,
          "Diagnostics and push notifications rest on your consent, which you can withdraw at any time; withdrawal does not affect what happened before. The site's waitlist rests on your consent too.",
          `Reports, blocks, moderation and protection against abuse, like the site's technical logs and language cookie, rest on our legitimate interest in keeping ${tEn('store.name')} safe and working. You can object at any time by writing to us.`,
          'We keep payments for our accounting and tax obligations.',
        ],
      },
      {
        heading: 'How long we keep it',
        body: [
          'We keep your account data as long as you have the account. When you remove something you published, others no longer see it, and we delete it for good when you delete your account.',
          tEn('account.delete.deferred'),
          ...ERASURE_DELETES.en,
          ...ERASURE_KEEPS.en,
          'Reports concerning you or your content, with the decisions taken on them, remain afterwards; we delete them when the person who made them deletes their own account. Reports you made are deleted with your account.',
          `The archive we prepare with “${tEn('settings.export.title')}” is kept for 7 days, as long as the link to download it works; then we delete it, and you can ask for a new one whenever you like. If you delete your account before downloading it, the archive is deleted along with your account.`,
        ],
      },
      {
        heading: 'Minimum age',
        body: [
          `${tEn('store.name')} is for people aged ${MIN_MEMBER_AGE} and over. When you join we ask for your date of birth and do not accept anyone younger. If you think someone younger has joined, write to us at ${EMAIL}.`,
        ],
      },
      {
        heading: 'Your rights',
        body: [
          `Under the GDPR you can at any time request access to, rectification, erasure, restriction and portability of your data, object to its processing, and withdraw any consent you gave us. Withdrawal does not affect processing carried out beforehand. To exercise these rights, write to ${EMAIL}.`,
          `You can do much of this yourself in the app: edit your profile and choose who sees what; in “${tEn('settings.title')}”, section “${tEn('settings.section.privacy')}”, you will find “${tEn('settings.export.title')}” to get a copy of your data and “${tEn('account.delete.row')}” to request deletion. The archive contains your account data, including your email, what you wrote and published, and the photo, video and voice-note files you uploaded yourself. It also contains your conversations in full, including the messages you received: the other person appears only by their @handle, and for photos they sent you, you get the file name rather than the photo, because those are their data. How to delete your account without the app is on this site's “${tEn('account.delete.title')}” page.`,
          'You also have the right to lodge a complaint with a supervisory authority. For our controller the competent one is the Berlin authority (Berliner Beauftragte für Datenschutz und Informationsfreiheit), but you may also contact the authority in your country of residence.',
        ],
      },
    ],
    reviewNote:
      'Our full legal name and registration details are in the impressum at anecoica.net.',
  },
};

/**
 * /terms — the terms of the app AND this site (#777). Sign-up, Settings and the Circle screen link
 * here, and the sign-up notice asks people to accept them — on the sign-in screen too, because a
 * first Google sign-in there creates an account. Every clause is bounded by what the product does,
 * and the PR for #777 carries the source of each:
 * - The provider and the address are /privacy's, and `EMAIL` is the one address: never the app's
 *   support mailbox. The minimum age is `MIN_MEMBER_AGE`, the labels are the catalog's, and each
 *   link to another legal page carries `?lang=` because a section link is a full page load.
 * - What is not allowed: harassment, spam, impersonation and the three ethical rules (aggressive
 *   selling, guaranteed income, MLM) are `REPORT_CATEGORIES` and PRD §4.13; the rest is the floor
 *   Google Play's UGC policy asks terms to define. Child sexual abuse is /child-safety's, linked
 *   rather than restated.
 * - Moderation is `resolve_report` v5's warn | penalty | suspend | ban, taken by a person (#106).
 *   Both enforcement halves apply to a suspension as to a ban: RLS closes writing and
 *   `moderation-enforce` closes sign-in (a GoTrue ban until the date, so it lifts itself). A ban
 *   also hides the profile, posts and stories, deleting nothing (#314). Removal is an operator
 *   action by hand until the panel has one (#788), as /child-safety says.
 * - Tickets are the only rail whose terms are stated here: Stripe Checkout
 *   (`create-ticket-checkout`), the organiser paid net of `events.fee_pct` as the composer makes
 *   them accept (`event.create.settlement.ack`). Circle checkout is closed on production
 *   (`circle_checkout_enabled` absent) and the fund is off (`fund_surfaces_enabled`,
 *   `contributions_enabled`), so both are named only to say they buy no Aura (rule 1). Opening
 *   either needs no code: its terms have to land here first.
 * - **Since #806 tickets are closed on production too** (`paid_events_enabled` absent), so at the
 *   first release NOTHING is on sale. The «Eventi a pagamento» section is left as written — it
 *   describes a feature («alcuni eventi hanno un biglietto a pagamento»), not a claim that any
 *   exists today, and production holds zero paid events — but a reader should know the sentence
 *   describes a rail that is switched off until §4.2 step 8. Whether the section should say so
 *   while it is closed is a counsel question (#711, #250), not one to answer by editing public
 *   legal copy from a feature branch.
 * - It states no refund, withdrawal-right, arbitration, VAT or seller-of-record regime. Refunds are
 *   issued by hand in the Stripe Dashboard, never by code, and the rest is with counsel (#711, #250).
 *
 * COUNSEL HAS NOT REVIEWED THESE TERMS. Until #777 the page said so in its `reviewNote` («Bozza —
 * da rivedere con un legale»), which `legal-doc.tsx` renders publicly, on the document members
 * accept at sign-up. Marco ruled (2026-09-19) that the reminder lives here and in the PR's
 * "For counsel" list, not on the page; `reviewNote` carries /privacy's impressum line instead.
 */
export const terms: Record<Locale, LegalDoc> = {
  it: {
    title: 'Termini di servizio',
    updated: 'Settembre 2026',
    intro: `Questi termini valgono per l'app ${tIt('store.name')} e per questo sito. Creando un account, o usando l'app o il sito, li accetti.`,
    sections: [
      {
        id: 'provider',
        heading: `Chi offre ${tIt('store.name')}`,
        body: [
          `L'app ${tIt('store.name')} e questo sito li offre ${CONTROLLER}, Thaerstrasse 17, 12049 Berlino, Germania.`,
        ],
      },
      {
        id: 'account',
        heading: 'Il tuo account',
        body: [
          `${tIt('store.name')} è per chi ha almeno ${MIN_MEMBER_AGE} anni. All'iscrizione ti chiediamo la data di nascita e non accettiamo chi non ha ancora quell'età.`,
          `Puoi eliminare l'account quando vuoi, dall'app o scrivendoci. Come fare, cosa eliminiamo e cosa conserviamo lo trovi nella pagina «${tIt('account.delete.title')}».`,
          "Come trattiamo i tuoi dati lo spiega l'informativa sulla privacy.",
        ],
        links: [
          { label: tIt('account.delete.title'), href: '/delete-account?lang=it' },
          { label: tIt('settings.legal.privacy'), href: '/privacy?lang=it' },
        ],
      },
      {
        id: 'content',
        heading: 'Ciò che pubblichi',
        body: [
          'Ciò che pubblichi — il profilo, il tuo sogno, post, commenti, storie, messaggi, eventi e progetti — resta tuo.',
          `Ci dai il permesso di conservarlo e di mostrarlo — alle persone che possono vederlo secondo le tue scelte, e su questo sito ciò che è pubblico — solo per far funzionare ${tIt('store.name')}. Non lo vendiamo e non lo usiamo per la pubblicità.`,
          "Quando togli qualcosa che hai pubblicato non lo vedono più gli altri, e lo cancelliamo del tutto quando elimini l'account.",
        ],
      },
      {
        id: 'rules',
        heading: 'Cosa non è ammesso',
        body: [
          `Su ${tIt('store.name')} non tolleriamo contenuti offensivi né chi abusa degli altri. Nell'app — messaggi compresi — e su questo sito non sono ammessi:`,
          'Molestie, minacce, insulti e offese.',
          "Incitamento all'odio o alla violenza.",
          'Vendite aggressive, promesse di guadagno garantito e reclutamento multilivello.',
          'Spam o contenuti ingannevoli.',
          "Fingersi un'altra persona.",
          'Contenuti sessualmente espliciti.',
          "Contenuti illegali, o che violano i diritti di altri, come il diritto d'autore o la riservatezza.",
          "Tentativi di compromettere la sicurezza o il funzionamento dell'app o del sito.",
          `Ogni forma di abuso o sfruttamento sessuale di minori è vietata: cosa vietiamo e cosa facciamo lo trovi nella pagina «${tIt('legal.childSafety')}».`,
        ],
        links: [{ label: tIt('legal.childSafety'), href: '/child-safety?lang=it' }],
      },
      {
        id: 'moderation',
        heading: 'Segnalazioni e moderazione',
        body: [
          'Puoi segnalare una persona, un post, un messaggio o un comportamento, e puoi bloccare chi vuoi.',
          'Le decisioni su una segnalazione le prende sempre una persona del team di moderazione, mai un programma. Se la segnalazione è fondata, il team può mandarti un avviso, togliere punti alla tua Aura, sospendere il tuo account per un periodo o escluderti in modo definitivo, e può rimuovere il contenuto.',
          "Durante una sospensione non puoi accedere, scrivere né partecipare; finisce da sola, alla data stabilita. Con l'esclusione non puoi più accedere, e il tuo profilo, i tuoi post e le tue storie non li vede più nessuno, tranne il team di moderazione.",
        ],
      },
      {
        id: 'aura',
        heading: "L'Aura",
        body: [
          "L'Aura è il tuo punteggio di reputazione: la calcola un programma sui nostri server, solo a partire da ciò che fai nell'app. Come, lo spiega l'informativa sulla privacy.",
          "L'abbonamento Circle e i contributi al fondo non danno punti: l'Aura non si compra.",
        ],
      },
      {
        id: 'payments',
        heading: 'Eventi a pagamento',
        body: [
          "Alcuni eventi hanno un biglietto a pagamento. Lo paghi su una pagina di Stripe, che gestisce il pagamento: i dati della tua carta non passano da noi. Vedi il prezzo prima di pagare, e il biglietto, con il suo codice QR, lo trovi poi nell'app.",
          `Per vendere biglietti devi verificare la tua identità e collegare un conto presso Stripe su cui ricevere i pagamenti. Ricevi il prezzo del biglietto meno la percentuale che trattiene ${tIt('store.name')}, che vedi e accetti quando crei l'evento; Stripe ti versa la tua parte secondo il calendario del tuo conto.`,
        ],
      },
      {
        id: 'ip',
        heading: 'Proprietà intellettuale',
        body: [
          `Il marchio ${tIt('store.name')}, i testi, la grafica e il logo dell'app e di questo sito sono di ${CONTROLLER}, tranne ciò che pubblicano le persone iscritte. Non possono essere riprodotti senza autorizzazione.`,
        ],
      },
      {
        id: 'liability',
        heading: 'Limitazione di responsabilità',
        body: [
          `I contenuti sono forniti “così come sono”, senza garanzie. ${CONTROLLER} non risponde di eventuali interruzioni del servizio o imprecisioni dei contenuti.`,
        ],
      },
      {
        id: 'contact',
        heading: 'Legge applicabile e contatti',
        body: [`Si applica la legge dell’Unione Europea. Per domande scrivi a ${EMAIL}.`],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
    ],
    reviewNote:
      'La ragione sociale completa e i dati di registrazione sono nell’impressum su anecoica.net.',
  },
  en: {
    title: 'Terms of Service',
    updated: 'September 2026',
    intro: `These terms apply to the ${tEn('store.name')} app and to this site. By creating an account, or by using the app or the site, you accept them.`,
    sections: [
      {
        id: 'provider',
        heading: `Who provides ${tEn('store.name')}`,
        body: [
          `The ${tEn('store.name')} app and this site are provided by ${CONTROLLER}, Thaerstrasse 17, 12049 Berlin, Germany.`,
        ],
      },
      {
        id: 'account',
        heading: 'Your account',
        body: [
          `${tEn('store.name')} is for people aged ${MIN_MEMBER_AGE} and over. When you join we ask for your date of birth and do not accept anyone younger.`,
          `You can delete your account at any time, from the app or by writing to us. How to do it, what we delete and what we keep are on the “${tEn('account.delete.title')}” page.`,
          'How we handle your data is explained in the privacy policy.',
        ],
        links: [
          { label: tEn('account.delete.title'), href: '/delete-account?lang=en' },
          { label: tEn('settings.legal.privacy'), href: '/privacy?lang=en' },
        ],
      },
      {
        id: 'content',
        heading: 'What you post',
        body: [
          'What you post — your profile, your dream, posts, comments, stories, messages, events and projects — stays yours.',
          `You give us permission to store it and to show it — to the people who can see it under your choices, and on this site whatever is public — only to run ${tEn('store.name')}. We do not sell it and we do not use it for advertising.`,
          'When you remove something you published, others no longer see it, and we delete it for good when you delete your account.',
        ],
      },
      {
        id: 'rules',
        heading: 'What is not allowed',
        body: [
          `${tEn('store.name')} has no tolerance for offensive content or for people who abuse others. In the app — messages included — and on this site, the following are not allowed:`,
          'Harassment, threats, insults and abuse.',
          'Incitement to hatred or violence.',
          'Aggressive selling, promises of guaranteed income and multi-level recruiting.',
          'Spam or misleading content.',
          'Impersonating someone else.',
          'Sexually explicit content.',
          "Illegal content, or content that infringes other people's rights, such as copyright or privacy.",
          'Attempts to compromise the security or the working of the app or the site.',
          `Any form of child sexual abuse or exploitation is prohibited: what we prohibit and what we do is on the “${tEn('legal.childSafety')}” page.`,
        ],
        links: [{ label: tEn('legal.childSafety'), href: '/child-safety?lang=en' }],
      },
      {
        id: 'moderation',
        heading: 'Reports and moderation',
        body: [
          'You can report a person, a post, a message or a behavior, and you can block anyone.',
          'Decisions on a report are always taken by a person on the moderation team, never by a program. If a report is upheld, the team can send you a warning, take points off your Aura, suspend your account for a period or ban you for good, and it can remove the content.',
          'During a suspension you cannot sign in, write or take part; it ends by itself on the set date. With a ban you can no longer sign in, and your profile, posts and stories are hidden from everyone but the moderation team.',
        ],
      },
      {
        id: 'aura',
        heading: 'Aura',
        body: [
          'Aura is your reputation score: a program on our servers calculates it only from what you do in the app. How it does so is explained in the privacy policy.',
          'A Circle subscription and fund contributions earn no points: Aura cannot be bought.',
        ],
      },
      {
        id: 'payments',
        heading: 'Paid events',
        body: [
          'Some events have a paid ticket. You pay on a Stripe page, and Stripe handles the payment: your card details never pass through us. You see the price before you pay, and your ticket, with its QR code, then appears in the app.',
          `To sell tickets you need to verify your identity and connect an account with Stripe to receive payments. You receive the ticket price minus the percentage ${tEn('store.name')} keeps, which you see and accept when you create the event; Stripe pays out your share on your account's schedule.`,
        ],
      },
      {
        id: 'ip',
        heading: 'Intellectual property',
        body: [
          `The ${tEn('store.name')} name, and the text, graphics and logo of the app and this site, belong to ${CONTROLLER}, except what members post. They may not be reproduced without permission.`,
        ],
      },
      {
        id: 'liability',
        heading: 'Limitation of liability',
        body: [
          `Content is provided “as is”, without warranty. ${CONTROLLER} is not liable for service interruptions or inaccuracies in the content.`,
        ],
      },
      {
        id: 'contact',
        heading: 'Governing law and contact',
        body: [`European Union law applies. For questions, write to ${EMAIL}.`],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
    ],
    reviewNote:
      'Our full legal name and registration details are in the impressum at anecoica.net.',
  },
};

/**
 * /delete-account — the URL Google Play's Data safety form asks for (#767): how to request
 * deletion of the app account with or without the app, and what is deleted and kept.
 *
 * Every label a person has to find in the app is read from the UI catalog, not copied, so a
 * renamed row renames the step that points at it. The two paragraphs the in-app screen shows
 * (`account.delete.body`, `account.delete.deferred`) are quoted verbatim, so this page and that
 * screen cannot promise different things. What the rest may claim is bounded by the erasure cascade as built: `erasure-job`
 * cancels the Circle subscription, pseudonymises the payment rows (#107) that the reaper drops
 * after ten years (#715), redacts the webhook ledger with NO retention window and one accepted hole — a fund
 * contribution's refund or dispute already in the ledger at erasure (#725, `20260912070533`), and disowns and hides the member's events rather than deleting them
 * (`gdpr_release_profile_references`). It never deletes or redacts the Stripe Customer: the one
 * create-circle-checkout makes with the member's email outlives the account, and the page says so.
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
          `Prima di eliminare puoi scaricare una copia dei tuoi dati: nella sezione «${tIt('settings.section.privacy')}» delle impostazioni trovi «${tIt('settings.export.title')}». Scaricala prima di chiedere la cancellazione: mentre l'archivio è in preparazione l'app ti chiede di aspettare, e un archivio non ancora scaricato viene cancellato insieme all'account.`,
          `1. Apri la scheda «${tIt('tabs.profile')}» e tocca la piccola ruota delle impostazioni («${tIt('settings.title')}»).`,
          `2. Nella sezione «${tIt('settings.section.privacy')}» tocca «${tIt('account.delete.row')}».`,
          `3. Scrivi ${tIt('account.delete.confirmWord')} nel campo di conferma (${tEn('account.delete.confirmWord')}, se usi l'app in inglese) e tocca «${tIt('account.delete.cta')}».`,
          tIt('account.delete.body'),
        ],
      },
      {
        heading: "Senza l'app",
        body: [
          `Non serve reinstallare l'app. Scrivi a ${EMAIL} dall'indirizzo email con cui accedi ad ${tIt('store.name')} e chiedi di eliminare il tuo account.`,
          `Se accedi con Apple e hai scelto di nascondere la tua email, scrivici da qualsiasi indirizzo e dicci la tua @handle: mandiamo un codice all'indirizzo di inoltro, che Apple gira alla tua casella, e registriamo la richiesta quando ci rispondi con quel codice.`,
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
        body: [tIt('account.delete.deferred'), ...ERASURE_DELETES.it],
      },
      {
        heading: 'Cosa conserviamo',
        body: ERASURE_KEEPS.it,
      },
    ],
    reviewNote: `Questa pagina riguarda il tuo account nell'app ${tIt('store.name')}. Come trattiamo i tuoi dati, nell'app e su questo sito, lo trovi nell'informativa sulla privacy.`,
  },
  en: {
    title: tEn('account.delete.title'),
    updated: 'September 2026',
    intro: `You can ask at any time for your ${tEn('store.name')} account and the data linked to it to be deleted. This page tells you how to do it, from the app or without it, what we delete and what we keep. ${tEn('store.name')} is an app by ${CONTROLLER}.`,
    sections: [
      {
        heading: 'From the app',
        body: [
          `Before you delete, you can download a copy of your data: the “${tEn('settings.section.privacy')}” section of your settings has “${tEn('settings.export.title')}”. Download it before you request deletion: while the archive is being prepared the app asks you to wait, and an archive you haven't downloaded yet is deleted along with your account.`,
          `1. Open the “${tEn('tabs.profile')}” tab and tap the small settings wheel (“${tEn('settings.title')}”).`,
          `2. In the “${tEn('settings.section.privacy')}” section, tap “${tEn('account.delete.row')}”.`,
          `3. Type ${tEn('account.delete.confirmWord')} in the confirmation field (${tIt('account.delete.confirmWord')} if you use the app in Italian) and tap “${tEn('account.delete.cta')}”.`,
          tEn('account.delete.body'),
        ],
      },
      {
        heading: 'Without the app',
        body: [
          `You don't need to reinstall the app. Write to ${EMAIL} from the email address you use to sign in to ${tEn('store.name')} and ask us to delete your account.`,
          `If you sign in with Apple and chose to hide your email, write to us from any address and tell us your @handle: we send a code to your relay address, which Apple forwards to your inbox, and we record the request when you reply with that code.`,
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
        body: [tEn('account.delete.deferred'), ...ERASURE_DELETES.en],
      },
      {
        heading: 'What we keep',
        body: ERASURE_KEEPS.en,
      },
    ],
    reviewNote: `This page is about your account in the ${tEn('store.name')} app. How we handle your data, in the app and on this site, is in the privacy policy.`,
  },
};

/**
 * The national hotlines Marco ruled on #779 (2026-09-19), police first. Each href is the page the
 * hotline serves TODAY, not the one in the ruling: three of those six had moved — jugendschutz.net's
 * `/en/hotline/` answers 200 with its homepage, eco's form now sits under `topics/policy-law/`, and
 * INHOPE's `/EN/our-members` redirects to the homepage, which is where its per-country list lives.
 * The PR for #779 records each status. Same URLs in both locales: none of them has an Italian and an
 * English version at different addresses.
 */
const HOTLINES: Record<Locale, LegalLink[]> = {
  it: [
    { label: 'Germania — jugendschutz.net', href: 'https://www.jugendschutz.net/en/make-a-report' },
    { label: 'Germania — FSM', href: 'https://www.fsm.de/en/fsm/hotline/' },
    {
      label: 'Germania — eco',
      href: 'https://international.eco.de/topics/policy-law/eco-complaints-office/report-a-complaint/',
    },
    {
      label: 'Italia — Telefono Azzurro, «Clicca e segnala»',
      href: 'https://www.azzurro.it/clicca-e-segnala/',
    },
    { label: 'Italia — Save the Children, «Stop-it»', href: 'https://stop-it.savethechildren.it/' },
    {
      label: 'Altri Paesi — INHOPE, dove trovi la linea di segnalazione del tuo Paese',
      href: 'https://inhope.org/',
    },
  ],
  en: [
    { label: 'Germany — jugendschutz.net', href: 'https://www.jugendschutz.net/en/make-a-report' },
    { label: 'Germany — FSM', href: 'https://www.fsm.de/en/fsm/hotline/' },
    {
      label: 'Germany — eco',
      href: 'https://international.eco.de/topics/policy-law/eco-complaints-office/report-a-complaint/',
    },
    {
      label: 'Italy — Telefono Azzurro, “Clicca e segnala”',
      href: 'https://www.azzurro.it/clicca-e-segnala/',
    },
    { label: 'Italy — Save the Children, “Stop-it”', href: 'https://stop-it.savethechildren.it/' },
    {
      label: 'Other countries — INHOPE, where you find the hotline for your country',
      href: 'https://inhope.org/',
    },
  ],
};

/**
 * /child-safety — the page Google Play's Child Safety Standards declaration links to (#779): the
 * published standards against child sexual abuse and exploitation, the in-app way to report, how
 * a report is acted on, and the named point of contact. Play reads it for the app or developer
 * name as the listing shows it, so it names both.
 *
 * Every sentence is bounded by what the product and the team do, and the PR for #779 carries the
 * source of each:
 * - The report paths are the app's own, labels read from the catalog: ⋯ → «Segnala» on a profile
 *   (`user/[id].tsx`), «Segnala» in a post's header (`post/[id].tsx`), ⋯ → «Segnala» in a chat
 *   and a long press on a RECEIVED message (`chat.tsx` — own messages carry no report), and
 *   «Segnala un comportamento» in Settings. The reason is `child_safety` (#788), read from the
 *   catalog, and the admin queue triages it first (`getReportQueue`).
 * - A ban lands on a person, message or post report's subject, and on a behaviour report that
 *   names someone (`resolve_report` v6, #788); it hides the profile, posts and stories (#314).
 *   «We remove it» is `admin_takedown` (#788): a soft delete of the post, comment or message that
 *   also stops its image being served. A behaviour report naming nobody and an email report still
 *   reach the author through a person report (RELEASE-RUNBOOK §7.8).
 * - The 24-hour review and the police-then-hotlines order are Marco's rulings on #779.
 * - It claims no scanning, no hash matching, no age verification (the birth date is
 *   self-declared) and no copy kept as evidence: none of them exists.
 */
export const childSafety: Record<Locale, LegalDoc> = {
  it: {
    title: 'Standard per la tutela dei minori',
    updated: 'Settembre 2026',
    intro: `${tIt('store.name')} è un'app di ${CONTROLLER}. Su ${tIt('store.name')} l'abuso e lo sfruttamento sessuale di minori non sono ammessi in nessuna forma. Qui trovi cosa vietiamo, come segnalarlo e cosa facciamo quando riceviamo una segnalazione.`,
    sections: [
      {
        id: 'prohibited',
        heading: 'Cosa vietiamo',
        body: [
          'È vietato ogni contenuto o comportamento che abusa sessualmente di un minore, lo sfrutta o lo mette in pericolo. In particolare:',
          "Materiale di abuso sessuale su minori: foto, video, disegni o immagini generate al computer o con l'intelligenza artificiale che ritraggono un minore in atti sessuali o in modo sessualizzato.",
          'Adescamento: avvicinare un minore, anche solo con messaggi, per sfruttarlo sessualmente.',
          'Estorsione sessuale (sextortion): minacciare un minore di diffondere sue immagini intime, o spingerlo a mandarle.',
          'Commenti, messaggi o immagini che sessualizzano un minore.',
          'Offrire, chiedere o scambiare questo materiale, o link che portano ad esso.',
          `Il divieto vale in ogni parte di ${tIt('store.name')}, messaggi compresi.`,
        ],
      },
      {
        id: 'age',
        heading: `${tIt('store.name')} è per adulti`,
        body: [
          `${tIt('store.name')} è per chi ha almeno ${MIN_MEMBER_AGE} anni. All'iscrizione ti chiediamo la data di nascita e non accettiamo chi non ha ancora quell'età.`,
          `Se pensi che nell'app ci sia una persona più giovane, segnalala o scrivici a ${EMAIL}.`,
        ],
      },
      {
        id: 'report',
        heading: "Come segnalare nell'app",
        body: [
          `Su un profilo tocca ⋯ e poi «${tIt('report.title')}». In un post tocca «${tIt('report.title')}» in alto. In una chat tocca ⋯ e poi «${tIt('chat.report')}»; per un messaggio che hai ricevuto, tienilo premuto e scegli «${tIt('chat.message.report')}».`,
          `Per tutto il resto apri la scheda «${tIt('tabs.profile')}», tocca la ruota delle impostazioni e, nella sezione «${tIt('settings.section.privacy')}», tocca «${tIt('report.behavior.row')}».`,
          `Come motivo scegli «${tIt('report.reason.child_safety')}» e tocca «${tIt('report.cta')}»: queste segnalazioni le esaminiamo per prime. Chi viene segnalato non sa chi l'ha segnalato.`,
          'Non salvare, non inoltrare e non fotografare il materiale, nemmeno per mostrarcelo.',
        ],
      },
      {
        id: 'contact',
        heading: 'Il nostro referente',
        body: [
          `Per la tutela dei minori il nostro referente è Marco Accardi, all'indirizzo ${EMAIL}. Puoi scrivere anche se non hai un account.`,
          'Descrivi dove hai visto il contenuto — la @handle, il post o la chat — senza allegarlo.',
        ],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
      {
        id: 'action',
        heading: 'Cosa facciamo',
        body: [
          'Una segnalazione di materiale di abuso sessuale su minori la esaminiamo con priorità, entro 24 ore.',
          `Se la segnalazione è fondata, rimuoviamo il contenuto da ${tIt('store.name')} ed escludiamo chi l'ha pubblicato o inviato, o chi ha tenuto quel comportamento: non può più accedere, e il suo profilo, i suoi post e le sue storie non li vede più nessuno, tranne il team di moderazione.`,
          'Ciò che appare come materiale di abuso sessuale su minori lo segnaliamo alle autorità competenti: alla polizia e alle linee di segnalazione nazionali elencate qui sotto.',
        ],
      },
      {
        id: 'authorities',
        heading: 'Segnalare alle autorità',
        body: [
          "Se un minore è in pericolo, chiama subito la polizia: nell'Unione Europea il numero di emergenza è il 112.",
          `Puoi segnalare materiale di abuso sessuale su minori trovato online, su ${tIt('store.name')} o altrove, alle linee di segnalazione nazionali della rete INHOPE:`,
        ],
        links: HOTLINES.it,
      },
    ],
    reviewNote: `Questi standard valgono per l'app ${tIt('store.name')} e per questo sito. Come trattiamo i dati di una segnalazione lo trovi nell'informativa sulla privacy.`,
  },
  en: {
    title: 'Child safety standards',
    updated: 'September 2026',
    intro: `${tEn('store.name')} is an app by ${CONTROLLER}. On ${tEn('store.name')}, child sexual abuse and exploitation are not allowed in any form. This page sets out what we prohibit, how to report it and what we do when a report reaches us.`,
    sections: [
      {
        id: 'prohibited',
        heading: 'What we prohibit',
        body: [
          'Any content or behavior that sexually abuses, exploits or endangers a child is prohibited. In particular:',
          'Child sexual abuse material: photos, videos, drawings, or computer- or AI-generated images that show a child in sexual acts or in a sexualized way.',
          'Grooming: approaching a child, even by messages alone, in order to exploit them sexually.',
          "Sextortion: threatening to spread a child's intimate images, or pushing a child to send them.",
          'Comments, messages or images that sexualize a child.',
          'Offering, requesting or exchanging such material, or links that lead to it.',
          `The prohibition covers every part of ${tEn('store.name')}, messages included.`,
        ],
      },
      {
        id: 'age',
        heading: `${tEn('store.name')} is for adults`,
        body: [
          `${tEn('store.name')} is for people aged ${MIN_MEMBER_AGE} and over. When you join we ask for your date of birth and do not accept anyone younger.`,
          `If you think someone younger is using the app, report them or write to us at ${EMAIL}.`,
        ],
      },
      {
        id: 'report',
        heading: 'How to report in the app',
        body: [
          `On a profile, tap ⋯ and then “${tEn('report.title')}”. On a post, tap “${tEn('report.title')}” at the top. In a chat, tap ⋯ and then “${tEn('chat.report')}”; for a message you received, press and hold it and choose “${tEn('chat.message.report')}”.`,
          `For anything else, open the “${tEn('tabs.profile')}” tab, tap the settings wheel and, in the “${tEn('settings.section.privacy')}” section, tap “${tEn('report.behavior.row')}”.`,
          `As the reason, choose “${tEn('report.reason.child_safety')}” and tap “${tEn('report.cta')}”: we review these reports first. The person reported is not told who reported them.`,
          'Do not save, forward or screenshot the material, not even to show it to us.',
        ],
      },
      {
        id: 'contact',
        heading: 'Point of contact',
        body: [
          `Our point of contact for child safety is Marco Accardi, at ${EMAIL}. You can write even if you have no account.`,
          'Describe where you saw the content — the @handle, the post or the chat — without attaching it.',
        ],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
      {
        id: 'action',
        heading: 'What we do',
        body: [
          'A report of child sexual abuse material is reviewed with priority, within 24 hours.',
          `If the report is upheld, we remove the content from ${tEn('store.name')} and ban whoever posted or sent it, or behaved that way: they can no longer sign in, and their profile, posts and stories are hidden from everyone but the moderation team.`,
          'Anything that appears to be child sexual abuse material is reported to the competent authorities: to the police and to the national hotlines listed below.',
        ],
      },
      {
        id: 'authorities',
        heading: 'Reporting to the authorities',
        body: [
          'If a child is in danger, call the police straight away: in the European Union the emergency number is 112.',
          `You can report child sexual abuse material found online, on ${tEn('store.name')} or anywhere else, to the national hotlines of the INHOPE network:`,
        ],
        links: HOTLINES.en,
      },
    ],
    reviewNote: `These standards apply to the ${tEn('store.name')} app and to this site. How we handle the data in a report is in the privacy policy.`,
  },
};

/**
 * /support — the Support URL App Store Connect and Play Console ask for on the app's listing
 * page. There is no in-app help centre yet: `settings.help.title` opens a `mailto:` draft to
 * the app's own support mailbox (`SUPPORT_EMAIL`, `apps/native/src/lib/links.ts`). This page
 * deliberately uses `EMAIL`, the controller address every other legal page here publishes —
 * not the app mailbox — because it is reachable without the app installed, by a store
 * reviewer or a prospective member who has neither yet, and because `legal-content.test.ts`
 * pins the controller address as the one way in on these pages (see the `terms`/`privacy`
 * describe blocks). Safety reports point at /child-safety rather than repeating it, so the
 * two pages cannot describe the report flow differently.
 */
export const support: Record<Locale, LegalDoc> = {
  it: {
    title: 'Supporto',
    updated: 'Settembre 2026',
    intro: `Hai un problema con ${tIt('store.name')}, l'app di ${CONTROLLER}, o una domanda su come funziona? Ecco come raggiungerci.`,
    sections: [
      {
        id: 'contact',
        heading: 'Scrivici',
        body: [
          `Scrivi a ${EMAIL}: rispondiamo di persona, non con un modulo automatico. Raccontaci cosa è successo — la schermata dove ti trovavi, cosa ti aspettavi — così troviamo la causa più in fretta.`,
          `Se hai già l'app, trovi la stessa scrittura pronta in «${tIt('tabs.profile')}» → ruota delle impostazioni → «${tIt('settings.section.support')}» → «${tIt('settings.help.title')}»: parte già con l'oggetto compilato.`,
        ],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
      {
        id: 'report',
        heading: 'Segnalare un contenuto o un comportamento',
        body: [
          `Per un profilo, un post o una chat che violano le regole di ${tIt('store.name')}, usa «${tIt('report.title')}» direttamente su quel contenuto: la segnalazione arriva al nostro team di moderazione, e chi viene segnalato non sa chi l'ha fatto.`,
          "Per l'abuso o lo sfruttamento di un minore, la pagina dedicata spiega cosa vietiamo e come intervengono le autorità.",
        ],
        links: [{ label: tIt('legal.childSafety'), href: '/child-safety?lang=it' }],
      },
      {
        id: 'account',
        heading: 'Account e dati',
        body: [
          `Per eliminare il tuo account puoi farlo direttamente dall'app, oppure scriverci a ${EMAIL}: l'informativa sulla privacy spiega cosa conserviamo e per quanto.`,
        ],
        links: [{ label: tIt('settings.legal.privacy'), href: '/privacy?lang=it' }],
      },
    ],
    reviewNote: `Rispondiamo entro qualche giorno lavorativo. Per una segnalazione urgente che riguarda un minore, vedi la pagina sulla tutela dei minori.`,
  },
  en: {
    title: 'Support',
    updated: 'September 2026',
    intro: `Having trouble with ${tEn('store.name')}, the app made by ${CONTROLLER}, or a question about how it works? Here's how to reach us.`,
    sections: [
      {
        id: 'contact',
        heading: 'Write to us',
        body: [
          `Write to ${EMAIL}: a person answers, not a form. Tell us what happened — the screen you were on, what you expected — so we find the cause faster.`,
          `If you already have the app, the same draft is one tap away: "${tEn('tabs.profile')}" → the settings wheel → "${tEn('settings.section.support')}" → "${tEn('settings.help.title')}" — it opens with the subject already filled in.`,
        ],
        links: [{ label: EMAIL, href: `mailto:${EMAIL}` }],
      },
      {
        id: 'report',
        heading: 'Report content or behavior',
        body: [
          `For a profile, post or chat that breaks ${tEn('store.name')}'s rules, use "${tEn('report.title')}" right on that content: the report reaches our moderation team, and the person reported is not told who reported them.`,
          'For the abuse or exploitation of a child, the dedicated page explains what we prohibit and how the authorities get involved.',
        ],
        links: [{ label: tEn('legal.childSafety'), href: '/child-safety?lang=en' }],
      },
      {
        id: 'account',
        heading: 'Account and data',
        body: [
          `You can delete your account directly from the app, or write to us at ${EMAIL}: the privacy policy explains what we keep and for how long.`,
        ],
        links: [{ label: tEn('settings.legal.privacy'), href: '/privacy?lang=en' }],
      },
    ],
    reviewNote: `We reply within a few business days. For an urgent report involving a child, see the child safety page.`,
  },
};
