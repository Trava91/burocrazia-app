# Contesto — App burocrazia (PWA cruscotto)

## Cos'è

`03-burocrazia/app/` è una **PWA** (web app installabile sul telefono) che gestisce le
tre liste burocrazia — **scadenze, appunti, spesa** — e il **calendario** (turni +
appuntamenti), parlando **direttamente** con l'API GitHub del repo `Trava91/scadenzario`,
la stessa fonte di verità usata da Telegram e dalla skill `/burocrazia`. Niente backend,
niente build: solo HTML/CSS/JS statici serviti da **GitHub Pages**, più chiamate all'API
GitHub dal browser.

## Calendario (dal 14/10/2026)

Prima scheda e schermata d'apertura. Copia lo stile di **Shifter** solo qui (il resto
dell'app resta salvia su crema): casella colorata per turno, testo del primo impegno,
oggi cerchiato in rosso, bordo spesso sul mese, sotto-schede MESE · ANNO · RIEPILOGO.
- **Dati:** `turni.json` (ciclo + eccezioni per persona) e `agenda.json` (appuntamenti),
  oltre alle scadenze. Logica pura in `js/calendario.js` (porting di `turni.py`/`agenda.py`),
  DOM e gesti in `js/cal-ui.js`.
- **Selettore persona:** Nicolò / Valentina / Insieme. Appuntamenti e scadenze sono di
  Nicolò: nella vista di Valentina si vedono solo i suoi turni.
- **Modifica:** tocco sul giorno = dettaglio (chip turno, secondo turno, ore per il giorno a
  metà, torna al ciclo, appuntamenti, scadenze). Matita = **pennello** (con *Periodo*: ferie &
  co. saltano i riposi del ciclo); si salva in un solo commit. Cicli e orari nelle Impostazioni.
- **Riepilogo:** conteggi per tipo, ore contro monte ore (lun-ven × 8), **voci da busta paga**
  con le regole della scheda colleghi (`01-lavoro/buste-paga/controllo/scheda-colleghi/`), impegni del mese.
- **Anteprima senza token:** da `03-burocrazia/` lancia `python -m http.server 8765` e apri
  `http://localhost:8765/app/test/preview.html` (dati locali, finto GitHub in memoria;
  `?prova=1` collauda lo store, `?immagine=1` mostra l'immagine da condividere).
- **Profilo Valentina (dal 15/10/2026):** stessa app, profilo salvato nel telefono
  (`buro.profilo`). Solo schede **Calendario** e **Spesa**, si installa come "Calendario"
  (`manifest-vale.webmanifest`, scelto da uno script in `<head>`). Nella vista **Insieme** i
  turni grandi sono di chi usa l'app e quelli dell'altro stanno nella fascia sotto. Delle
  scadenze vede solo quelle **Casa / coppia**, in sola lettura (dal 30/10/2026). I commit dal
  suo telefono hanno l'etichetta `app-vale:`.
- **Vista Insieme leggibile (dal 30/10/2026, richiesta di Valentina):** nei giorni con impegni
  la casella mostra i titoli (fino a 3, poi "+N") e i due turni scendono in strisce sottili in
  fondo; sotto griglia e legenda c'è l'elenco **Impegni del mese** giorno per giorno (turni di
  tutti e due, ora, di chi, luogo, note per intero). Tocco su un impegno = modifica, sul giorno
  = dettaglio. Le viste singole sono quelle di prima. Anteprima con `?demo=1&persona=insieme`.
  **Per ora solo nell'app di Nicolò** (la prova prima di darla a Valentina): nuova vista e
  scadenze di coppia per lei si accendono aggiungendo `"valentina"` a `INSIEME_NUOVA` in
  `js/cal-ui.js` (e bump del SW).
- **Stesso token** (scelta di Nicolò): il link d'installazione lo genera la sua app
  (Impostazioni → "📲 Invita Valentina": `?profilo=valentina&setup=<token>`), quindi il
  token non passa da nessun'altra parte. Limite accettato: il token apre tutto il repo,
  e se lei perde il telefono si revoca e si fermano entrambe le app.
- **Appuntamenti "di chi"** (`chi`: nicolo / valentina / entrambi): ognuno vede i propri e
  quelli di coppia; Insieme li mostra tutti. Il ⚠ guarda il turno di chi ci va
  (di coppia = di tutti e due). Avvisi Telegram per lei: da decidere dopo la prova.

È un **repo Git separato e pubblico** (`Trava91/burocrazia-app`): il sorgente non
contiene segreti (il PAT lo inserisce l'utente a runtime, resta in `localStorage`).

## Ruolo vs Telegram (divisione netta)

- **App = cruscotto.** Gestione *strutturata e istantanea*: vedere le liste, completare
  con uno swipe, aggiungere con un calendario. Scrive subito su GitHub, **salta il cron
  orario** (niente latenza ≤1h).
- **Telegram = cassetta postale + campanello.** Cattura *grezza* — **vocali e foto**
  (le elabora il PC con whisper/visione) — e **avvisi push** (solo Telegram può "suonare"
  il telefono senza un server). La tab "Invia" dell'app è minimale: solo deep-link al bot.

L'app tiene **solo il PAT GitHub**, non il token Telegram (un segreto in meno sul telefono).

## Regola d'oro: lo schema JSON è il CONTRATTO

L'app replica in JavaScript (`js/model.js`) **solo le mutazioni strutturate** dei motori
Python (`scadenzario.py`, `memoria.py`, `lista_spesa.py`, `cloud_inbox.py`): avanzamento
delle ricorrenze, slug degli id, formato giorni, schema completo delle voci. Il parser di
linguaggio naturale, la trascrizione e la visione **restano** su Telegram/PC.

> **Se cambia un campo dei JSON, va aggiornato su ENTRAMBI i lati**: i motori Python
> *e* `js/model.js` (scadenze, appunti, spesa) o `js/calendario.js` (`turni.json`,
> `agenda.json`). Lo schema condiviso è ciò che tiene insieme i due front-end.
> `scadenzario/test_calendario.py` confronta Python e JS su turni, festività e conflitti.

## Conflitti di scrittura (app ↔ cron)

App e cron toccano gli stessi JSON. La Contents API richiede lo `sha` corrente:
se è cambiato → HTTP 409. `js/store.js` fa **lock ottimistico**: ri-legge, **riapplica la
modifica per `id`/data** (non per indice) e riprova (max 3). Le scritture sullo stesso
file vanno **in fila** (due tocchi veloci non si pestano lo sha); quando la fila si
svuota la vista torna all'ultimo stato confermato dal server (= rollback di ciò che è
fallito). Per un utente singolo i conflitti sono rari. La skill `/burocrazia`, dal canto
suo, fa **sempre `git pull`** prima di lavorare.

## Stato

- **2026-06-27:** scritta in locale (scaffold, client API, model, store, UI, onboarding,
  PWA/offline, test). Logica pura cross-validata contro i motori Python.
- **Da fare (lo fa Nicolò):** creare il repo pubblico `burocrazia-app`, abilitare Pages,
  creare il PAT, push, installare sul telefono e provare. Vedi [`README.md`](README.md).

## Limiti noti (per onestà)

- **Niente push dall'app**: gli avvisi restano a Telegram (una PWA notifica solo con un
  server che spinge → fuori dal "zero server").
- **Scritture offline non supportate in v1**: offline si legge (snapshot in `localStorage`),
  non si scrive. Coda offline → eventuale Fase 2.
- **Cattura vocali/foto**: non avviene nell'app (richiede whisper/visione sul PC) — si fa
  su Telegram via deep-link.
