# Contesto — App burocrazia (PWA cruscotto)

## Cos'è

`03-burocrazia/app/` è una **PWA** (web app installabile sul telefono) che gestisce le
tre liste burocrazia — **scadenze, appunti, spesa** — parlando **direttamente** con
l'API GitHub del repo `Trava91/scadenzario`, la stessa fonte di verità usata da Telegram
e dalla skill `/burocrazia`. Niente backend, niente build: solo HTML/CSS/JS statici
serviti da **GitHub Pages**, più chiamate all'API GitHub dal browser.

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

> **Se cambia un campo dei 3 JSON, va aggiornato su ENTRAMBI i lati**: i motori Python
> *e* `js/model.js`. Lo schema condiviso è ciò che tiene insieme i due front-end.

## Conflitti di scrittura (app ↔ cron)

App e cron orario toccano gli stessi 3 JSON. La Contents API richiede lo `sha` corrente:
se è cambiato → HTTP 409. `js/store.js` fa **lock ottimistico**: ri-legge, **riapplica la
modifica per `id`** (non per indice) e riprova (max 3). Per un utente singolo i conflitti
sono rari. La skill `/burocrazia`, dal canto suo, fa **sempre `git pull`** prima di lavorare.

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
