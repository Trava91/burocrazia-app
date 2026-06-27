// store.js — stato in memoria delle 3 liste + coreografia letture/scritture.
//
// Tutte le mutazioni passano da `mutate`: applicazione OPTIMISTIC (la UI cambia
// subito), poi commit su GitHub; su conflitto col cron (sha stale) ri-legge,
// riapplica la modifica PER ID e riprova; al fallimento definitivo fa rollback.

import { GitHubApi, ApiError } from "./api.js";
import * as model from "./model.js";

const LS = {
  token: "buro.token",
  owner: "buro.owner",
  repo: "buro.repo",
  bot: "buro.bot",
  snapshot: "buro.snapshot",
  lastSync: "buro.lastSync",
};

const DEFAULTS = { owner: "Trava91", repo: "scadenzario", bot: "cluadetrascrizione_bot" };

// I tre file e la chiave dell'array dentro ciascun JSON.
const FILES = {
  scadenze: { path: "scadenzario.json", key: "scadenze" },
  appunti: { path: "memoria.json", key: "appunti" },
  spesa: { path: "lista-spesa.json", key: "voci" },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

export class Store {
  constructor() {
    this.data = { scadenze: null, appunti: null, spesa: null };
    this.sha = { scadenze: null, appunti: null, spesa: null };
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
    this.data = { scadenze: null, appunti: null, spesa: null };
  }

  onChange(cb) { this._onChange = cb; }
  _emit() { if (this._onChange) this._onChange(); }

  // --- caricamento ---------------------------------------------------------
  async load() {
    try {
      const [s, a, sp] = await Promise.all([
        this.api.getFile(FILES.scadenze.path),
        this.api.getFile(FILES.appunti.path),
        this.api.getFile(FILES.spesa.path),
      ]);
      this.data = { scadenze: s.data, appunti: a.data, spesa: sp.data };
      this.sha = { scadenze: s.sha, appunti: a.sha, spesa: sp.sha };
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
      this.data = snap.data;
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

  // --- motore di mutazione (optimistic + conflitto + rollback) -------------
  async mutate(file, fn, commitMsg) {
    if (this.offline) {
      throw new ApiError("Sei offline: riprova quando torni online.", { kind: "network" });
    }
    const { path, key } = FILES[file];
    const before = this.data[file];          // per il rollback
    const beforeSha = this.sha[file];

    // optimistic: clona, applica la modifica, mostra subito
    let working = clone(before);
    working[key] = fn(working[key]);
    this.data[file] = working;
    this._emit();

    let sha = beforeSha;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const newSha = await this.api.putFile(path, working, sha, commitMsg);
        this.sha[file] = newSha;
        this._markSync();
        this._saveSnapshot();
        this._emit();
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.conflict && attempt < 3) {
          // sha stale (cron ha scritto): ri-leggi, riapplica PER ID, riprova
          const fresh = await this.api.getFile(path);
          working = clone(fresh.data);
          working[key] = fn(working[key]);
          sha = fresh.sha;
          this.data[file] = working;   // mostra il merge (modifica app + cron)
          this._emit();
          continue;
        }
        // fallimento definitivo → rollback
        this.data[file] = before;
        this.sha[file] = beforeSha;
        this._emit();
        throw e;
      }
    }
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

  // --- deep-link Telegram --------------------------------------------------
  telegramUrl() { return this.bot ? `https://t.me/${this.bot}` : null; }
}
