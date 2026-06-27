# Burocrazia — PWA cruscotto

App mobile installabile (PWA) che gestisce le **tre liste burocrazia** — scadenze,
appunti, spesa — parlando **direttamente** con l'API GitHub del repo
`Trava91/scadenzario` (la stessa fonte di verità di Telegram). Zero server, zero
build, costo zero: solo file statici su GitHub Pages + API GitHub.

Ruolo nel sistema (vedi [`../PIANO-sistema-burocrazia.md`](../PIANO-sistema-burocrazia.md), Fase 7):

- **App = cruscotto.** Gestisci in fretta ciò che è già in lista (vedi, spunta con
  swipe, aggiungi con il calendario). Azioni **istantanee**, senza passare dal cron orario.
- **Telegram = cassetta postale + campanello.** Ci butti **vocali e foto** (le elabora
  il PC con whisper/visione) e ti manda gli **avvisi push**. L'app non lo sostituisce.

## Struttura

```
app/
├── index.html              pagina unica (3 tab + onboarding + impostazioni)
├── manifest.webmanifest    manifest PWA
├── sw.js                   service worker (app shell offline)
├── css/styles.css          stile mobile-first, tema chiaro/scuro automatico
├── js/
│   ├── api.js              client GitHub Contents API (base64+sha, retry-on-409)
│   ├── model.js            porting JS delle mutazioni (CONTRATTO con i motori Python)
│   ├── store.js            stato + optimistic update + gestione conflitti + rollback
│   ├── ui.js               render liste, tab, swipe, form, toast
│   └── main.js             onboarding token, primo load, impostazioni, SW
├── icons/icon.svg          icona maskable
└── test/model.test.mjs     test della logica pura
```

## Dev locale

Il service worker richiede `localhost` o HTTPS (non `file://`). Con Python (già presente):

```bash
cd 03-burocrazia/app
python -m http.server 8000
```

Apri `http://localhost:8000`. Al primo avvio incolla un **PAT** (vedi sotto): per i
test **usa un repo/branch di prova** o dati fittizi, non i dati reali, finché non sei pronto.

### Test della logica

Verifica il porting JS delle regole di mutazione (date ricorrenti, slug, schema voci):

```bash
node test/model.test.mjs          # se hai Node
```

Senza Node: apri una pagina con `<script type="module" src="test/model.test.mjs">`
e leggi la console. I valori attesi sono presi dai motori Python reali (today = 2026-06-27).

## Token (PAT) — creazione e revoca

L'app ha bisogno di un **fine-grained Personal Access Token** per leggere/scrivere i
3 JSON. Si inserisce **a runtime** (resta in `localStorage` su quel telefono): **mai**
nel codice, mai nel repo.

**Crearlo** — <https://github.com/settings/personal-access-tokens/new>:

1. **Repository access** → *Only select repositories* → `Trava91/scadenzario`.
2. **Permissions** → *Repository permissions* → **Contents: Read and write**
   (lascia tutto il resto su *No access*).
3. **Expiration** → metti una scadenza (es. 90 giorni); te lo richiederà quando scade.
4. Genera, copia il token (`github_pat_…`), incollalo nell'onboarding dell'app.

**Revocarlo** (telefono perso, o per igiene periodica) — stessa pagina dei token →
seleziona il token → *Revoke*. Da aggiungere alla routine "telefono smarrito".

> Sicurezza: dati a bassa sensibilità (titoli/date, niente CF o documenti); il rischio
> reale è l'accesso fisico al telefono sbloccato (stessa classe di Telegram, già
> installato). La mitigazione chiave è la **revoca** del token.

## Deploy su GitHub Pages

Il sorgente **non contiene segreti**, quindi sta in un repo **pubblico** (Pages gratis).

1. Crea il repo pubblico `Trava91/burocrazia-app` e collega questa cartella
   (`03-burocrazia/app/`) come suo repo Git (è separato da `scadenzario`).
2. `git push` su `main`.
3. **Settings → Pages** → *Deploy from a branch* → `main` / `root` → Save.
4. URL: `https://trava91.github.io/burocrazia-app/`.
5. Sul telefono apri l'URL → **Aggiungi a Home** → incolla il PAT.

Aggiornamenti: `git push` → Pages rideploya. Per invalidare la cache dell'app shell,
**bump** `CACHE = "buro-vN"` in [`sw.js`](sw.js).

## Schema dati (contratto condiviso Python ↔ JS)

L'app **non** definisce uno schema proprio: scrive negli stessi 3 JSON dei motori Python.
Lo schema è documentato in testa a ciascun file nel repo `scadenzario`:

| File | Array | Campi (sintesi) |
|---|---|---|
| `scadenzario.json` | `scadenze` | `id, titolo, categoria, scadenza, ricorrenza, preavviso_giorni, stato, priorita, note, documento, azione` (+ `orario_notifica`/`notificato` per i promemoria a orario) |
| `memoria.json` | `appunti` | `id, testo, data, tag, fonte, stato, rifinito` |
| `lista-spesa.json` | `voci` | `id, testo, data, fonte, stato` |

Le regole di mutazione (avanzamento ricorrenze, slug, `complete`) sono replicate in
[`js/model.js`](js/model.js). **Se cambia un campo, aggiornare ENTRAMBI i lati**
(motori Python e `model.js`). Vedi [`contesto.md`](contesto.md).
