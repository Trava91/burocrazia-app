// store.js — stato in memoria dei 5 file (3 liste + turni + agenda) e
// coreografia letture/scritture.
//
// Tutte le mutazioni passano da `mutate`: applicazione OPTIMISTIC (la UI cambia
// subito), poi commit su GitHub IN FILA per file (due tocchi veloci non si
// pestano lo sha); su conflitto col cron (sha stale) ri-legge, riapplica la
// modifica PER ID/DATA e riprova; quando la fila si svuota la vista torna
// all'ultimo stato confermato dal server (= rollback di ciò che è fallito).

import { GitHubApi, ApiError } from "./api.js";
import * as model from "./model.js";
import * as cal from "./calendario.js";

const LS = {
  token: "buro.token",
  owner: "buro.owner",
  repo: "buro.repo",
  bot: "buro.bot",
  snapshot: "buro.snapshot",
  lastSync: "buro.lastSync",
};

const DEFAULTS = { owner: "Trava91", repo: "scadenzario", bot: "cluadetrascrizione_bot" };

// I file e la chiave dei dati dentro ciascun JSON (per turni è un oggetto).
const FILES = {
  scadenze: { path: "scadenzario.json", key: "scadenze" },
  appunti: { path: "memoria.json", key: "appunti" },
  spesa: { path: "lista-spesa.json", key: "voci" },
  turni: { path: "turni.json", key: "persone" },
  agenda: { path: "agenda.json", key: "appuntamenti" },
};
// File del calendario: se mancano (404) l'app parte lo stesso, senza calendario.
const OPTIONAL = new Set(["turni", "agenda"]);
const EMPTY = { agenda: { appuntamenti: [] } };

const clone = (o) => JSON.parse(JSON.stringify(o));
const vuoto = () => Object.fromEntries(Object.keys(FILES).map((k) => [k, null]));

export class Store {
  constructor() {
    this.data = vuoto();     // vista (comprende le modifiche non ancora confermate)
    this.server = vuoto();   // ultimo stato confermato da GitHub
    this.sha = vuoto();
    this._pending = {};      // scritture in fila per file
    this._chain = {};
    this.offline = false;
    this.lastSync = localStorage.getItem(LS.lastSync) || null;
    this._onChange = null;
    this._buildApi();
  }

  // --- config / token ------------------------------------------------------
  _buildApi() {
    this.token = localStorage.getItem(LS.token) || "";
    this.owner = localStorage.getItem(LS.owner) || DEFAULTS.owner;
    this.repo = localStorage.getItem(LS.repo) || DEFAULTS.repo;
    this.bot = localStorage.getItem(LS.bot) || DEFAULTS.bot;
    this.api = new GitHubApi({ owner: this.owner, repo: this.repo, token: this.token });
  }

  hasToken() { return Boolean(this.token); }

  saveConfig({ token, owner, repo, bot }) {
    if (token !== undefined) localStorage.setItem(LS.token, token);
    if (owner !== undefined) localStorage.setItem(LS.owner, owner || DEFAULTS.owner);
    if (repo !== undefined) localStorage.setItem(LS.repo, repo || DEFAULTS.repo);
    if (bot !== undefined) localStorage.setItem(LS.bot, bot || "");
    this._buildApi();
  }

  setBot(bot) { localStorage.setItem(LS.bot, bot || ""); this.bot = bot || ""; }

  removeToken() {
    localStorage.removeItem(LS.token);
    localStorage.removeItem(LS.snapshot);
    localStorage.removeItem(LS.lastSync);
    this._buildApi();
    this.data = vuoto();
    this.server = vuoto();
  }

  onChange(cb) { this._onChange = cb; }
  _emit() { if (this._onChange) this._onChange(); }

  // --- caricamento ---------------------------------------------------------
  async load() {
    try {
      const names = Object.keys(FILES);
      const res = await Promise.all(names.map((n) =>
        this.api.getFile(FILES[n].path).catch((e) => {
          if (OPTIONAL.has(n) && e instanceof ApiError && e.kind === "notfound") return { data: null, sha: null };
          throw e;
        })));
      names.forEach((n, i) => {
        this.data[n] = res[i].data;
        this.server[n] = res[i].data;
        this.sha[n] = res[i].sha;
      });
      this.offline = false;
      this._markSync();
      this._saveSnapshot();
      this._emit();
      return true;
    } catch (e) {
      // Offline o rete assente → prova lo snapshot locale (sola lettura).
      if (e instanceof ApiError && e.kind === "network" && this._loadSnapshot()) {
        this.offline = true;
        this._emit();
        return true;
      }
      throw e;
    }
  }

  _markSync() {
    this.lastSync = new Date().toISOString();
    localStorage.setItem(LS.lastSync, this.lastSync);
  }

  _saveSnapshot() {
    try {
      localStorage.setItem(LS.snapshot, JSON.stringify({ data: this.data, at: this.lastSync }));
    } catch { /* quota piena: lo snapshot offline è best-effort */ }
  }

  _loadSnapshot() {
    const raw = localStorage.getItem(LS.snapshot);
    if (!raw) return false;
    try {
      const snap = JSON.parse(raw);
      this.data = { ...vuoto(), ...snap.data };  // snapshot vecchi: senza turni/agenda
      this.server = { ...this.data };
      this.lastSync = snap.at || this.lastSync;
      return Boolean(this.data?.scadenze);
    } catch { return false; }
  }

  // --- viste (pure, derivate dallo stato) ----------------------------------
  list(file) { return this.data[file]?.[FILES[file].key] || []; }

  scadenzeView(includeTutte = false) {
    return model.scadenzeView(this.list("scadenze"), model.todayYMD(), includeTutte);
  }
  appuntiAttivi() {
    return this.list("appunti")
      .filter((a) => a.stato === "attivo")
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  }
  spesaDaComprare() {
    return this.list("spesa").filter((v) => v.stato === "da-comprare");
  }
  findScadenza(id) { return this.list("scadenze").find((x) => x.id === id); }

  // --- motore di mutazione (optimistic + fila + conflitto + rollback) ------
  // `fn` riceve il valore della chiave (array o oggetto) e ritorna quello nuovo.
  // Deve lavorare per id/data, non per indice: in caso di conflitto viene
  // riapplicata sui dati freschi del server.
  mutate(file, fn, commitMsg) {
    if (this.offline) {
      return Promise.reject(new ApiError("Sei offline: riprova quando torni online.", { kind: "network" }));
    }
    const { path, key } = FILES[file];
    const base = () => clone(this.server[file] ?? EMPTY[file] ?? null);
    if (!base()) return Promise.reject(new ApiError(`${path} non c'è nel repo.`, { kind: "notfound" }));

    // optimistic: applica sulla vista attuale e mostra subito
    const view = clone(this.data[file] ?? base());
    view[key] = fn(view[key]);
    this.data[file] = view;
    this._emit();
    this._pending[file] = (this._pending[file] || 0) + 1;

    const run = async () => {
      try {
        let sha = this.sha[file];
        for (let attempt = 1; ; attempt++) {
          const next = base();
          next[key] = fn(next[key]);
          try {
            this.sha[file] = await this.api.putFile(path, next, sha, commitMsg);
            this.server[file] = next;
            this._markSync();
            return true;
          } catch (e) {
            if (e instanceof ApiError && e.conflict && attempt < 3) {
              // sha stale (il cron ha scritto): ri-leggi e riapplica per id/data
              const fresh = await this.api.getFile(path);
              this.server[file] = fresh.data;
              this.sha[file] = sha = fresh.sha;
              continue;
            }
            throw e;
          }
        }
      } finally {
        this._pending[file] -= 1;
        if (this._pending[file] === 0) {
          // fila vuota: la vista torna allo stato confermato (merge col cron,
          // e rollback automatico di ciò che non è andato a buon fine)
          this.data[file] = this.server[file];
          this._saveSnapshot();
          this._emit();
        }
      }
    };
    const p = (this._chain[file] || Promise.resolve()).then(run);
    this._chain[file] = p.catch(() => {});
    return p;
  }

  // --- operazioni scadenze -------------------------------------------------
  completaScadenza(id) {
    const it = this.findScadenza(id);
    const titolo = it ? it.titolo : id;
    return this.mutate("scadenze", (arr) => {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return arr; // sparita (es. tolta dal cron): no-op
      const res = model.completeScadenza(arr[idx]);
      if (res.action === "remove") return arr.filter((x) => x.id !== id);
      const copy = arr.slice();
      copy[idx] = res.item;
      return copy;
    }, `app: completa ${titolo}`);
  }

  eliminaScadenza(id) {
    const it = this.findScadenza(id);
    const titolo = it ? it.titolo : id;
    return this.mutate("scadenze",
      (arr) => arr.filter((x) => x.id !== id),
      `app: elimina scadenza ${titolo}`);
  }

  modificaScadenza(id, campi) {
    return this.mutate("scadenze", (arr) => arr.map((x) => {
      if (x.id !== id) return x;
      // Traduce i nomi del form nei campi del JSON; azzera `notificato` quando
      // cambia data o ora, così l'avviso puntuale può ri-scattare.
      const patch = {};
      if ("titolo" in campi) patch.titolo = String(campi.titolo).trim();
      if ("categoria" in campi) patch.categoria = campi.categoria;
      if ("priorita" in campi) patch.priorita = campi.priorita;
      if ("ricorrenza" in campi) patch.ricorrenza = campi.ricorrenza || null;
      if ("scadenza" in campi) { patch.scadenza = campi.scadenza || null; patch.notificato = null; }
      if ("preavviso" in campi) patch.preavviso_giorni = model.preavvisoGiorni(campi.preavviso, x.preavviso_giorni ?? 30);
      if ("orario" in campi) { patch.orario_notifica = campi.orario || null; patch.notificato = null; }
      return { ...x, ...patch };
    }), `app: modifica scadenza ${id}`);
  }

  aggiungiScadenza(campi) {
    return this.mutate("scadenze",
      (arr) => [...arr, model.newScadenza(campi, arr)],
      `app: nuova scadenza ${campi.titolo}`);
  }

  // --- operazioni appunti --------------------------------------------------
  aggiungiAppunto(testo) {
    return this.mutate("appunti",
      (arr) => [...arr, model.newAppunto(testo, arr)],
      `app: nuovo appunto`);
  }

  modificaAppunto(id, testo) {
    return this.mutate("appunti",
      (arr) => arr.map((a) => (a.id === id ? { ...a, testo: testo.trim() } : a)),
      `app: modifica appunto ${id}`);
  }

  eliminaAppunto(id) {
    // "chiudi" del Python = elimina del tutto (nessuna traccia).
    return this.mutate("appunti",
      (arr) => arr.filter((a) => a.id !== id),
      `app: chiudi appunto ${id}`);
  }

  // --- operazioni spesa ----------------------------------------------------
  aggiungiSpesa(testo) {
    return this.mutate("spesa",
      (arr) => [...arr, model.newSpesa(testo, arr)],
      `app: nuova voce spesa`);
  }

  // comprata = elimina (delete-on-done, come lista_spesa.fatto)
  comprata(id) {
    return this.mutate("spesa",
      (arr) => arr.filter((v) => v.id !== id),
      `app: comprata ${id}`);
  }

  eliminaSpesa(id) {
    return this.mutate("spesa",
      (arr) => arr.filter((v) => v.id !== id),
      `app: elimina voce spesa ${id}`);
  }

  // --- calendario: viste ---------------------------------------------------
  get turni() { return this.data.turni; }
  appuntamenti() { return this.list("agenda"); }
  findAppuntamento(id) { return this.appuntamenti().find((a) => a.id === id); }

  // --- calendario: turni ---------------------------------------------------
  // voci = [{tipo, ore?}] oppure null = torna al ciclo
  setTurno(pid, iso, voci) {
    const cosa = voci ? voci.map((v) => v.tipo + (v.ore ? ` ${v.ore}h` : "")).join("+") : "ciclo";
    return this.mutate("turni", (persone) => cal.setTurno(persone, pid, iso, voci),
      `app: turno ${pid} ${iso} ${cosa}`);
  }

  // blocco del pennello: { iso: voci | null }
  applicaTurni(pid, modifiche) {
    const n = Object.keys(modifiche).length;
    return this.mutate("turni", (persone) => cal.applicaTurni(persone, pid, modifiche),
      `app: turni ${pid} (${n} giorni)`);
  }

  modificaCiclo(pid, { sequenza, ancora, orari }) {
    return this.mutate("turni", (persone) => {
      const out = clone(persone);
      const p = out[pid];
      if (!p) return out;
      if (sequenza) p.ciclo.sequenza = sequenza;
      if (ancora) p.ciclo.ancora = ancora;
      for (const [cod, o] of Object.entries(orari || {})) {
        if (p.tipi[cod] && o.inizio && o.fine) { p.tipi[cod].inizio = o.inizio; p.tipi[cod].fine = o.fine; }
      }
      return out;
    }, `app: ciclo turni ${pid}`);
  }

  // --- calendario: appuntamenti --------------------------------------------
  aggiungiAppuntamento(campi) {
    return this.mutate("agenda",
      (arr) => [...(arr || []), cal.newAppuntamento(campi, arr || [])],
      `app: nuovo appuntamento ${campi.titolo}`);
  }

  modificaAppuntamento(id, campi) {
    return this.mutate("agenda", (arr) => (arr || []).map((a) => {
      if (a.id !== id) return a;
      const x = { ...a, ...campi, titolo: String(campi.titolo ?? a.titolo).trim() };
      if (!x.ora) { x.ora = null; x.avviso_min = null; x.fine = null; }
      // cambiano data/ora/avviso → l'avviso puntuale può ri-scattare
      if (x.data !== a.data || x.ora !== a.ora || x.avviso_min !== a.avviso_min) x.notificato = null;
      return x;
    }), `app: modifica appuntamento ${id}`);
  }

  eliminaAppuntamento(id) {
    return this.mutate("agenda", (arr) => (arr || []).filter((a) => a.id !== id),
      `app: elimina appuntamento ${id}`);
  }

  // --- deep-link Telegram --------------------------------------------------
  telegramUrl() { return this.bot ? `https://t.me/${this.bot}` : null; }
}
