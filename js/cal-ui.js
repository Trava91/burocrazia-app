// cal-ui.js — scheda Calendario "come Shifter": mese, anno, riepilogo,
// dettaglio del giorno, pennello dei turni, form appuntamento, condivisione.
// Solo DOM e gesti: la logica sta in calendario.js, i dati nello store.

import * as cal from "./calendario.js";
import { CATEGORIE } from "./model.js";
import { showToast } from "./ui.js";

const $ = (sel) => document.querySelector(sel);
const LS_PERSONA = "buro.cal.persona";
// Vista Insieme nuova (il mese a righe, scadenze di coppia a Valentina):
// per ora solo nell'app di Nicolò, che la prova prima di darla a lei.
const INSIEME_NUOVA = ["nicolo"];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* best-effort */ } };

/** Sfondo di una fascia: più chiaro se nel giorno c'è un impegno (come Shifter). */
function bandStyle(b, chiaro) {
  const ink = b.testo || "#2b2b2b";
  const bg = chiaro
    ? `background:${b.colore};background:color-mix(in srgb, ${b.colore} 45%, #fff)`
    : `background:${b.colore}`;
  return `${bg};color:${ink}`;
}

const AVVISI = [
  ["", "Nessun avviso"], ["0", "All'ora"], ["30", "30 min prima"],
  ["60", "1 ora prima"], ["120", "2 ore prima"], ["1440", "Il giorno prima"],
];

export class CalendarUI {
  constructor(store, ui) {
    this.store = store;
    this.ui = ui;
    const t = cal.todayIso();
    this.y = Number(t.slice(0, 4));
    this.m = Number(t.slice(5, 7));
    this.view = "mese";
    this.persona = lsGet(LS_PERSONA) || store.profilo;
    this.selected = t;
    this.brush = null;          // { pid, tipo, periodo, start, pending: {iso: voci|null} }
    this._swipeAt = 0;
    this._dayOpen = null;       // iso del dettaglio aperto
  }

  // --- dati comodi ------------------------------------------------------------
  get turni() { return this.store.turni; }
  persone() { return Object.keys(this.turni?.persone || {}); }
  /** chi usa l'app (profilo) e l'altra persona: nella vista Insieme i turni
   *  di chi usa l'app sono grandi, quelli dell'altro nella fascia sotto */
  get io() { return this.store.profilo; }
  get altro() { return this.persone().find((p) => p !== this.io) || null; }
  get nuova() { return INSIEME_NUOVA.includes(this.io); }
  /** persona mostrata in grande (nella vista Insieme: chi usa l'app) */
  pidVista() { return this.persona === "insieme" ? this.io : this.persona; }
  /** persona su cui si scrive (nella vista Insieme: chi usa l'app) */
  pidScrittura() { return this.pidVista(); }
  nome(pid) { return this.turni?.persone?.[pid]?.nome || pid; }
  /** appuntamenti della vista: di quella persona + di coppia; Insieme = tutti */
  appVista() {
    const all = this.store.appuntamenti();
    return this.persona === "insieme" ? all : all.filter((a) => cal.visibile(a, this.persona));
  }
  /** le scadenze sono la burocrazia di Nicolò: tutte nella sua app (nelle sue viste);
   *  nell'app di Valentina solo quelle di casa/coppia, in sola lettura */
  scadVista() {
    if (this.io !== "nicolo") {
      return this.nuova ? this.store.list("scadenze").filter((s) => s.categoria === "casa-coppia") : [];
    }
    if (this.persona === "valentina") return [];
    return this.store.list("scadenze");
  }
  /** "sei di Pome 16-24" / "Valentina è di Notte 0-6" */
  _testoConflitto(cf, data) {
    const turno = cal.descriviGiorno(this.turni, cf.pid, data);
    return cf.pid === this.io ? `sei di ${turno}` : `${this.nome(cf.pid)} è di ${turno}`;
  }
  /** turni da mostrare: con le pennellate non ancora salvate */
  turniVista() {
    const t = this.turni;
    if (!t || !this.brush || !Object.keys(this.brush.pending).length) return t;
    return { ...t, persone: cal.applicaTurni(t.persone, this.brush.pid, this.brush.pending) };
  }

  // --- wiring -------------------------------------------------------------------
  init() {
    $("#cal-persona").addEventListener("change", (e) => {
      this.persona = e.target.value;
      lsSet(LS_PERSONA, this.persona);
      if (this.brush) this.stopBrush();
      this.render();
    });
    document.querySelectorAll(".cal-subtabs button").forEach((b) =>
      b.addEventListener("click", () => { this.view = b.dataset.view; this.render(); }));
    $("#cal-pennello").addEventListener("click", () => (this.brush ? this.stopBrush() : this.startBrush()));
    $("#cal-share").addEventListener("click", () => this.condividi());

    const body = $("#cal-body");
    body.addEventListener("click", (e) => this._onBodyClick(e));
    // swipe orizzontale = mese (o anno) precedente/successivo
    let sx = 0, sy = 0, down = false;
    body.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; down = true; });
    body.addEventListener("pointerup", (e) => {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this._swipeAt = Date.now();
        this.sposta(dx < 0 ? 1 : -1);
      }
    });
    body.addEventListener("pointercancel", () => { down = false; });
  }

  sposta(delta) {
    if (this.view === "anno") this.y += delta;
    else {
      const t = this.y * 12 + (this.m - 1) + delta;
      this.y = Math.floor(t / 12);
      this.m = (t % 12) + 1;
    }
    this.render();
  }

  oggi() {
    const t = cal.todayIso();
    this.y = Number(t.slice(0, 4));
    this.m = Number(t.slice(5, 7));
    this.render();
  }

  _onBodyClick(e) {
    if (Date.now() - this._swipeAt < 350) return; // era uno swipe, non un tocco
    // vista a righe: tocco su un impegno = modifica (col pennello invece si dipinge la riga)
    const app = !this.brush && e.target.closest("[data-app]");
    if (app) { this.apriFormAppuntamento(this.store.findAppuntamento(app.dataset.app), app.dataset.day); return; }
    const sc = !this.brush && e.target.closest("[data-scad]");
    if (sc) { const it = this.store.findScadenza(sc.dataset.scad); if (it) this.ui.openScadenzaForm(it); return; }
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      const v = nav.dataset.nav;
      if (v === "oggi") this.oggi(); else this.sposta(Number(v));
      return;
    }
    const ym = e.target.closest("[data-ym]");
    if (ym) { this.m = Number(ym.dataset.ym); this.view = "mese"; this.render(); return; }
    const imp = e.target.closest("[data-imp]");
    if (imp) { this.apriDettaglio(imp.dataset.imp); return; }
    const cell = e.target.closest("[data-iso]");
    if (!cell) return;
    const iso = cell.dataset.iso;
    if (this.brush) { this.pennella(iso); return; }
    this.selected = iso;
    this.apriDettaglio(iso);
  }

  // --- render -----------------------------------------------------------------
  render() {
    const sel = $("#cal-persona");
    if (!sel) return;
    // selettore persona (come il menu "Senza Nome" di Shifter)
    const ids = this.persone().sort((a, b) => (a === this.io ? -1 : b === this.io ? 1 : 0));
    if (ids.length && !ids.includes(this.persona) && this.persona !== "insieme") this.persona = ids[0];
    const opts = ids.map((id) => [id, this.turni.persone[id].nome || id]);
    if (ids.length > 1) opts.push(["insieme", "Insieme"]);
    sel.innerHTML = opts.map(([v, n]) =>
      `<option value="${v}"${v === this.persona ? " selected" : ""}>${esc(n)}</option>`).join("");

    const nomeMese = cal.MESI[this.m - 1].toUpperCase();
    document.querySelectorAll(".cal-subtabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === this.view);
      if (b.dataset.view === "mese") b.textContent = nomeMese;
      if (b.dataset.view === "anno") b.textContent = String(this.y);
    });
    $("#cal-pennello").classList.toggle("on", Boolean(this.brush));
    this._renderBrushBar();

    const body = $("#cal-body");
    if (!this.store.data.scadenze) { body.innerHTML = ""; return; } // dati non ancora caricati
    if (!this.turni) {
      body.innerHTML = `<p class="empty">Manca <code>turni.json</code> nel repo: il calendario si attiva quando c'è.</p>`;
      return;
    }
    if (this.view === "anno") body.innerHTML = this._htmlAnno();
    else if (this.view === "riepilogo") body.innerHTML = this._htmlRiepilogo();
    else body.innerHTML = this._htmlMese();
    // dettaglio del giorno aperto: si aggiorna coi dati nuovi
    if (this._dayOpen && this.ui.sheetKind === "giorno") this.apriDettaglio(this._dayOpen, true);
  }

  _head(titolo) {
    return `<div class="cal-head">
      <button class="cal-arrow" data-nav="-1" aria-label="Precedente">‹</button>
      <h2 data-nav="oggi" title="Torna a oggi">${esc(titolo)}</h2>
      <button class="cal-arrow" data-nav="1" aria-label="Successivo">›</button>
    </div>`;
  }

  _htmlMese() {
    if (this.persona === "insieme" && this.nuova) return this._htmlRighe();
    const turni = this.turniVista();
    const griglia = cal.grigliaMese(this.y, this.m);
    const idxApp = cal.indiceAppuntamenti(this.appVista());
    const idxScad = cal.indiceScadenze(this.scadVista());
    const oggi = cal.todayIso();
    const inMese = (i) => i >= 0 && i < 42 && Number(griglia[i].slice(5, 7)) === this.m;
    const insieme = this.persona === "insieme";
    const pid = this.pidVista();
    const altro = this.altro;
    const start = this.brush?.start;

    let h = this._head(`${cal.MESI[this.m - 1].toUpperCase()} ${this.y}`);
    h += `<div class="cal-dow">${cal.GIORNI_BREVI.map((g) => `<span>${g}</span>`).join("")}</div>`;
    h += `<div class="cal-grid${insieme ? " insieme" : ""}">`;
    griglia.forEach((iso, i) => {
      const c = cal.contenutoCasella({ turni, pid, iso, idxApp, idxScad });
      const row = Math.floor(i / 7), col = i % 7;
      const cls = ["cc"];
      if (inMese(i)) {
        cls.push("in");
        if (row === 0 || !inMese(i - 7)) cls.push("bt");
        if (row === 5 || !inMese(i + 7)) cls.push("bb");
        if (col === 0 || !inMese(i - 1)) cls.push("bl");
        if (col === 6 || !inMese(i + 1)) cls.push("br");
      } else cls.push("out");
      if (iso === oggi) cls.push("today");
      if (c.festivo) cls.push("fest");
      if (iso === start) cls.push("start");
      const chiaro = Boolean(c.testo) && !insieme;

      let bande = c.bande.map((b) =>
        `<span class="cc-band" style="${bandStyle(b, chiaro)}">${!c.testo || insieme ? `<span class="cc-bname">${esc(b.nome)}</span>` : ""}</span>`).join("");
      if (insieme && altro) {
        const v = cal.contenutoCasella({ turni, pid: altro, iso, idxApp: null, idxScad: null });
        bande += `<span class="cc-band cc-band-v">${v.bande.map((b) =>
          `<span style="${bandStyle(b, false)}"><span class="cc-bname">${esc(b.nome)}</span></span>`).join("")}</span>`;
      }
      const ico = `${c.nApp ? "✉" : ""}${c.nScad ? "📌" : ""}${c.conflitto ? "⚠" : ""}`;
      const extra = c.nApp + c.nScad > 1 ? ` +${c.nApp + c.nScad - 1}` : "";
      h += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}" aria-label="${esc(this._ariaGiorno(iso, c))}">
        <span class="cc-bands">${bande}</span>
        ${ico ? `<span class="cc-ico">${ico}</span>` : ""}
        <span class="cc-num">${Number(iso.slice(8))}</span>
        ${c.testo && !insieme ? `<span class="cc-txt">${esc(c.testo)}${extra}</span>` : ""}
      </button>`;
    });
    h += `</div>`;
    h += this._htmlLegenda(turni, pid);
    return h;
  }

  /** Vista Insieme (nuova): il mese a righe, un giorno per riga con i turni di
   *  tutti e due affiancati e gli impegni per intero, note comprese. */
  _htmlRighe() {
    const turni = this.turniVista();
    const idxApp = cal.indiceAppuntamenti(this.appVista());
    const idxScad = cal.indiceScadenze(this.scadVista());
    const oggi = cal.todayIso();
    const io = this.io, altro = this.altro;
    const modScad = io === "nicolo";
    const start = this.brush?.start;
    const colonna = (pid, iso) => `<span class="rg-t">${cal.turniDelGiorno(turni, pid, iso).map((v) => {
      const t = cal.tipoDef(turni, pid, v.tipo);
      return `<span style="background:${t.colore};color:${t.testo || "#2b2b2b"}">${esc(t.nome || v.tipo)}</span>`;
    }).join("")}</span>`;
    const nota = (n) => (n ? `<span class="rg-note">${esc(n)}</span>` : "");

    let h = this._head(`${cal.MESI[this.m - 1].toUpperCase()} ${this.y}`);
    h += `<div class="rg-cols"><span></span><span>Tu</span><span>${altro ? esc(this.nome(altro)) : ""}</span><span>Impegni</span></div>`;
    for (const iso of cal.grigliaMese(this.y, this.m).filter((d) => Number(d.slice(5, 7)) === this.m)) {
      const wd = cal.weekday(iso);
      const fest = cal.nomeFestivita(iso);
      const cls = ["rg"];
      if (wd === 0 && Number(iso.slice(8)) > 1) cls.push("lun");   // riga spessa tra le settimane
      if (iso === oggi) cls.push("today");
      if (fest) cls.push("fest");
      if (iso === start) cls.push("start");
      let imp = fest ? `<span class="rg-fest">🎉 ${esc(fest)}</span>` : "";
      for (const a of idxApp.get(iso) || []) {
        const cf = cal.conflittoApp(turni, a);
        const chi = cal.diChi(a);
        const diChi = chi === "entrambi" ? " 💑" : chi !== io ? ` <small>· ${esc(this.nome(chi))}</small>` : "";
        imp += `<span class="rg-it" data-app="${esc(a.id)}" data-day="${iso}">${a.ora ? `<b class="rg-ora">${esc(a.ora)}</b>` : ""}<b>${esc(a.titolo)}</b>${diChi}${a.luogo ? ` <small>· ${esc(a.luogo)}</small>` : ""}${cf ? `<span class="warn"> ⚠ ${esc(this._testoConflitto(cf, iso))}</span>` : ""}${nota(a.note)}</span>`;
      }
      for (const s of idxScad.get(iso) || []) {
        imp += `<span class="rg-it"${modScad ? ` data-scad="${esc(s.id)}"` : ""}>📌 <b>${esc(s.titolo)}</b> <small>· ${esc(CATEGORIE[s.categoria] || s.categoria)}</small>${nota(s.note)}</span>`;
      }
      h += `<div class="${cls.join(" ")}" data-iso="${iso}">
        <span class="rg-d"><b>${Number(iso.slice(8))}</b><small>${cal.GIORNI_BREVI[wd]}</small></span>
        ${colonna(io, iso)}${altro ? colonna(altro, iso) : "<span></span>"}
        <span class="rg-imp">${imp}</span></div>`;
    }
    return h;
  }

  _ariaGiorno(iso, c) {
    const parti = [`${Number(iso.slice(8))} ${cal.MESI[Number(iso.slice(5, 7)) - 1]}`, c.bande.map((b) => b.nome).join(" e ")];
    if (c.testo) parti.push(c.testo);
    if (c.festivo) parti.push(c.festivo);
    return parti.join(", ");
  }

  _htmlLegenda(turni, pid) {
    const tipi = turni?.persone?.[pid]?.tipi || {};
    return `<div class="cal-legend">${Object.values(tipi).map((t) =>
      `<span><i style="background:${t.colore}"></i>${esc(t.nome)}</span>`).join("")}
      <span class="muted">✉ appuntamento · 📌 scadenza · ⚠ durante il turno</span></div>`;
  }

  _htmlAnno() {
    const turni = this.turniVista();
    const pid = this.pidVista();
    const oggi = cal.todayIso();
    let h = this._head(String(this.y));
    h += `<div class="year-grid">`;
    for (let m = 1; m <= 12; m++) {
      const g = cal.grigliaMese(this.y, m);
      const corrente = oggi.slice(0, 7) === `${this.y}-${String(m).padStart(2, "0")}`;
      h += `<button type="button" class="ym${corrente ? " now" : ""}" data-ym="${m}">
        <span class="ym-name">${cal.MESI[m - 1].toUpperCase()}</span><span class="ym-grid">`;
      for (const iso of g) {
        if (Number(iso.slice(5, 7)) !== m) { h += `<i class="ym-out"></i>`; continue; }
        const v = cal.turniDelGiorno(turni, pid, iso)[0];
        const col = v ? cal.tipoDef(turni, pid, v.tipo).colore : "transparent";
        h += `<i style="background:${col}" class="${iso === oggi ? "ym-today" : ""}${cal.nomeFestivita(iso) ? " ym-fest" : ""}">${Number(iso.slice(8))}</i>`;
      }
      h += `</span></button>`;
    }
    return h + `</div>` + this._htmlLegenda(turni, pid);
  }

  _htmlRiepilogo() {
    const pid = this.pidVista();
    const turni = this.turniVista();
    const r = cal.riepilogoMese(turni, pid, this.y, this.m, {
      agenda: this.store.appuntamenti(), scadenze: pid === "nicolo" ? this.scadVista() : [],
    });
    const nome = turni.persone[pid]?.nome || pid;
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));
    let h = this._head(`${cal.MESI[this.m - 1].toUpperCase()} ${this.y}`);
    h += `<p class="riep-chi">${esc(nome)}${this.persona === "insieme" ? " (nella vista Insieme il riepilogo è il tuo)" : ""}</p>`;

    h += `<section class="riep-card"><h3>Giorni per tipo</h3><table class="riep">`;
    for (const x of r.conteggi) {
      h += `<tr><td><i class="dot" style="background:${x.colore}"></i>${esc(x.nome)}</td><td>${x.giorni} gg</td><td>${x.ore ? fmt(x.ore) + " h" : ""}</td></tr>`;
    }
    h += `<tr class="tot"><td>Ore lavorate</td><td></td><td>${fmt(r.oreLavorate)} h</td></tr></table></section>`;

    if (r.monteOre) {
      const d = r.monteOre.diff;
      h += `<section class="riep-card"><h3>Ore e monte ore</h3><table class="riep">
        <tr><td>Monte ore (lun-ven × 8)</td><td>${fmt(r.monteOre.monte)} h</td></tr>
        <tr><td>Coperte (turni + assenze + festività)</td><td>${fmt(r.monteOre.coperte)} h</td></tr>
        <tr class="tot ${d < 0 ? "neg" : ""}"><td>${d < 0 ? "Da recuperare" : d > 0 ? "In più" : "Pari"}</td><td>${d ? fmt(Math.abs(d)) + " h" : "—"}</td></tr>
      </table><p class="riep-note">Quello che i turni non coprono diventa recupero (in INAZ: FLEX_8-17), altrimenti ferie, banca ore o 104.</p></section>`;
    }
    if (r.busta) {
      h += `<section class="riep-card"><h3>Voci da busta paga</h3>
        <p class="riep-note">Da confrontare con la busta del mese <b>dopo</b> (paga differita). Regole della scheda colleghi.</p>
        <table class="riep busta"><tr><th>Voce</th><th>Codice</th><th>Attesi</th></tr>`;
      for (const x of r.busta) {
        h += `<tr${x.valore ? "" : ' class="zero"'}><td>${esc(x.voce)}</td><td><code>${esc(x.codice)}</code></td><td>${fmt(x.valore)} ${x.unita}</td></tr>`;
      }
      h += `</table></section>`;
    }
    h += `<section class="riep-card"><h3>Impegni del mese</h3>`;
    if (!r.impegni.length) h += `<p class="riep-note">Nessun impegno.</p>`;
    else {
      h += `<ul class="riep-imp">`;
      for (const x of r.impegni) {
        const g = Number(x.data.slice(8));
        h += `<li data-imp="${x.data}"><b>${g}</b> ${x.tipo === "app" ? "✉" : "📌"} ${x.ora ? esc(x.ora) + " " : ""}${esc(x.testo)}</li>`;
      }
      h += `</ul>`;
    }
    return h + `</section>`;
  }

  // --- pennello (come la matita di Shifter) --------------------------------------
  startBrush() {
    if (!this.turni) return;
    if (this.view !== "mese") this.view = "mese";
    const pid = this.pidScrittura();
    const primo = Object.keys(this.turni.persone[pid].tipi)[0];
    this.brush = { pid, tipo: primo, periodo: false, start: null, pending: {} };
    this.render();
  }

  stopBrush() {
    this.brush = null;
    this.render();
  }

  pennella(iso) {
    const b = this.brush;
    const codice = b.tipo === "__ciclo" ? null : b.tipo;
    if (b.periodo) {
      if (!b.start) { b.start = iso; this.render(); return; }
      const mod = cal.modifichePeriodo(this.turniVista(), b.pid, b.start, iso, codice);
      Object.assign(b.pending, mod);
      b.start = null;
    } else {
      b.pending[iso] = codice === null ? null : [{ tipo: codice }];
    }
    this.render();
  }

  async salvaBrush() {
    const b = this.brush;
    if (!b || !Object.keys(b.pending).length) { this.stopBrush(); return; }
    const pending = b.pending;
    this.brush = null;
    this.render();
    await this.ui.run(this.store.applicaTurni(b.pid, pending));
  }

  _renderBrushBar() {
    const bar = $("#cal-brush");
    if (!this.brush) { bar.hidden = true; bar.innerHTML = ""; return; }
    const b = this.brush;
    const p = this.turni.persone[b.pid];
    const n = Object.keys(b.pending).length;
    bar.hidden = false;
    bar.innerHTML = `
      <div class="brush-top"><b>Pennello · ${esc(p.nome)}</b>
        <label class="brush-per"><input type="checkbox" id="brush-periodo"${b.periodo ? " checked" : ""}> Periodo</label></div>
      <div class="chips">${Object.entries(p.tipi).map(([cod, t]) =>
        `<button type="button" class="chip${b.tipo === cod ? " on" : ""}" data-brush="${esc(cod)}" style="background:${t.colore};color:${t.testo || "#2b2b2b"}">${esc(t.nome)}</button>`).join("")}
        <button type="button" class="chip chip-ciclo${b.tipo === "__ciclo" ? " on" : ""}" data-brush="__ciclo">↺ Ciclo</button></div>
      <p class="brush-hint">${b.periodo
        ? (b.start ? `Inizio: ${Number(b.start.slice(8))}/${Number(b.start.slice(5, 7))} — tocca l'ultimo giorno.` : "Tocca il primo giorno del periodo, poi l'ultimo. Ferie & co. saltano i riposi.")
        : "Tocca i giorni da dipingere."}</p>
      <div class="brush-act"><button type="button" class="btn-secondary" id="brush-annulla">Annulla</button>
        <button type="button" class="btn-primary" id="brush-salva">Salva${n ? ` (${n})` : ""}</button></div>`;
    bar.querySelectorAll("[data-brush]").forEach((el) =>
      el.addEventListener("click", () => { b.tipo = el.dataset.brush; this._renderBrushBar(); }));
    bar.querySelector("#brush-periodo").addEventListener("change", (e) => {
      b.periodo = e.target.checked; b.start = null; this.render();
    });
    bar.querySelector("#brush-annulla").addEventListener("click", () => this.stopBrush());
    bar.querySelector("#brush-salva").addEventListener("click", () => this.salvaBrush());
  }

  // --- dettaglio del giorno ------------------------------------------------------
  apriDettaglio(iso, refresh = false) {
    const turni = this.turni;
    if (!turni) return;
    this._dayOpen = iso;
    const wd = cal.weekday(iso);
    const titolo = `${cal.GIORNI[wd]} ${Number(iso.slice(8))} ${cal.MESI[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
    const pids = this.persona === "insieme" ? [this.io, this.altro].filter(Boolean) : [this.persona];
    const fest = cal.nomeFestivita(iso);
    const apps = cal.appuntamentiDelGiorno(this.appVista(), iso);
    const scad = cal.indiceScadenze(this.scadVista()).get(iso) || [];

    let h = fest ? `<p class="day-fest">🎉 ${esc(fest)}</p>` : "";
    for (const pid of pids) {
      const p = turni.persone[pid];
      const voci = cal.turniDelGiorno(turni, pid, iso);
      const eccezione = voci.length && !voci[0].ciclo;
      const ciclo = cal.tipoDef(turni, pid, cal.turnoCiclo(p, iso)).nome;
      const attivi = new Set(voci.map((v) => v.tipo));
      h += `<section class="day-sec" data-pid="${pid}">
        <h3>Turno${pids.length > 1 || pid !== this.io ? ` · ${esc(p.nome)}` : ""}${eccezione ? ` <small>(nel ciclo: ${esc(ciclo)})</small>` : ""}</h3>
        <div class="chips">${Object.entries(p.tipi).map(([cod, t]) =>
          `<button type="button" class="chip${attivi.has(cod) ? " on" : ""}" data-chip="${esc(cod)}" style="background:${t.colore};color:${t.testo || "#2b2b2b"}">${esc(t.nome)}</button>`).join("")}</div>
        <label class="day-check"><input type="checkbox" data-secondo> il prossimo tocco aggiunge un secondo turno</label>
        <div class="day-voci">${voci.map((v, i) => {
          const t = cal.tipoDef(turni, pid, v.tipo);
          return `<label class="voce">${esc(cal.descriviVoce(turni, pid, v))}
            <span>ore <input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-ore="${i}" value="${v.ore ?? ""}" placeholder="${t.ore ?? 0}"></span></label>`;
        }).join("")}</div>
        ${eccezione ? `<button type="button" class="btn-link" data-ciclo>↺ Torna al ciclo (${esc(ciclo)})</button>` : ""}
      </section>`;
    }

    h += `<section class="day-sec"><h3>Appuntamenti</h3>`;
    if (!apps.length) h += `<p class="muted small">Nessuno.</p>`;
    for (const a of apps) {
      const cf = cal.conflittoApp(turni, a);
      const chi = cal.diChi(a);
      const diChi = chi === "entrambi" ? " 💑" : chi !== this.io ? ` <small>· di ${esc(this.nome(chi))}</small>` : "";
      h += `<button type="button" class="day-item" data-app="${esc(a.id)}">
        <span class="day-time">${a.ora ? esc(a.ora) : "tutto il giorno"}</span>
        <span class="day-what">${esc(a.titolo)}${diChi}${a.luogo ? ` <small>· ${esc(a.luogo)}</small>` : ""}${cf ? `<span class="warn"> ⚠ ${esc(this._testoConflitto(cf, iso))}</span>` : ""}</span></button>`;
    }
    // le scadenze si modificano solo dall'app di Nicolò (Valentina vede quelle di coppia)
    const conScad = this.io === "nicolo";
    if (conScad || scad.length) h += `</section><section class="day-sec"><h3>Scadenze</h3>`;
    if (conScad && !scad.length) h += `<p class="muted small">Nessuna.</p>`;
    for (const s of scad) {
      const apri = conScad ? `button type="button" data-scad="${esc(s.id)}"` : "div";
      h += `<${apri} class="day-item">
        <span class="day-time">📌${s.orario_notifica ? " " + esc(s.orario_notifica) : ""}</span>
        <span class="day-what">${esc(s.titolo)} <small>· ${esc(CATEGORIE[s.categoria] || s.categoria)}</small></span></${conScad ? "button" : "div"}>`;
    }
    h += `</section><div class="day-actions">
      <button type="button" class="btn-secondary" data-new-app>＋ Appuntamento</button>
      ${conScad ? `<button type="button" class="btn-secondary" data-new-scad>＋ Scadenza</button>` : ""}</div>`;

    const form = this.ui.openCustomSheet(titolo, h, { keep: refresh });
    this._wireDettaglio(form, iso);
  }

  _wireDettaglio(form, iso) {
    form.querySelectorAll(".day-sec[data-pid]").forEach((sec) => {
      const pid = sec.dataset.pid;
      const voci = () => cal.turniDelGiorno(this.turni, pid, iso).map(({ tipo, ore }) => (ore !== undefined ? { tipo, ore } : { tipo }));
      sec.querySelectorAll("[data-chip]").forEach((chip) => chip.addEventListener("click", () => {
        const cod = chip.dataset.chip;
        let v = voci();
        const secondo = sec.querySelector("[data-secondo]").checked;
        if (secondo) {
          v = v.some((x) => x.tipo === cod) ? v.filter((x) => x.tipo !== cod) : [...v, { tipo: cod }].slice(-2);
        } else v = [{ tipo: cod }];
        this.ui.run(this.store.setTurno(pid, iso, v.length ? v : null));
      }));
      sec.querySelectorAll("[data-ore]").forEach((inp) => inp.addEventListener("change", () => {
        const v = voci();
        const i = Number(inp.dataset.ore);
        if (!v[i]) return;
        if (inp.value === "") delete v[i].ore; else v[i].ore = Number(inp.value);
        this.ui.run(this.store.setTurno(pid, iso, v));
      }));
      sec.querySelector("[data-ciclo]")?.addEventListener("click", () =>
        this.ui.run(this.store.setTurno(pid, iso, null)));
    });
    form.querySelectorAll("[data-app]").forEach((el) => el.addEventListener("click", () =>
      this.apriFormAppuntamento(this.store.findAppuntamento(el.dataset.app), iso)));
    form.querySelectorAll("[data-scad]").forEach((el) => el.addEventListener("click", () => {
      const it = this.store.findScadenza(el.dataset.scad);
      this._dayOpen = null;
      if (it) this.ui.openScadenzaForm(it);
    }));
    form.querySelector("[data-new-app]").addEventListener("click", () => this.apriFormAppuntamento(null, iso));
    form.querySelector("[data-new-scad]")?.addEventListener("click", () => {
      this._dayOpen = null;
      this.ui.openScadenzaForm(null, { scadenza: iso });
    });
  }

  // --- form appuntamento -------------------------------------------------------
  apriFormAppuntamento(app = null, iso = this.selected) {
    this._dayOpen = null;
    const edit = Boolean(app);
    const avviso = app ? (app.avviso_min ?? "") : String(cal.AVVISO_DEFAULT_MIN);
    const html = `
      <label>Titolo<input name="titolo" type="text" required value="${esc(app?.titolo || "")}" placeholder="es. Visita medica"></label>
      <div class="row-2">
        <label>Data<input name="data" type="date" required value="${esc(app?.data || iso)}"></label>
        <label>Ora<input name="ora" type="time" value="${esc(app?.ora || "")}"></label>
      </div>
      <div class="row-2">
        <label>Fine<input name="fine" type="time" value="${esc(app?.fine || "")}"></label>
        <label>Avviso<select name="avviso">${AVVISI.map(([v, n]) =>
          `<option value="${v}"${String(avviso) === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      <label>Di chi è<select name="chi">${cal.CHI.map((c) =>
        `<option value="${c}"${(app ? cal.diChi(app) : this.io) === c ? " selected" : ""}>${c === "entrambi" ? "Di entrambi 💑" : esc(this.nome(c))}</option>`).join("")}</select></label>
      <label>Luogo<input name="luogo" type="text" value="${esc(app?.luogo || "")}"></label>
      <label>Note<textarea name="note">${esc(app?.note || "")}</textarea></label>
      <p class="form-hint warn" id="app-warn" hidden></p>
      <p class="form-hint">Senza <b>ora</b> vale per tutto il giorno (niente avviso puntuale: te lo ricorda il riepilogo delle 21 della sera prima). L'avviso parte a passi di 30 minuti, mai in ritardo.</p>
      ${edit ? `<button type="button" class="btn-danger" id="app-del">Elimina appuntamento</button>` : ""}`;
    this.ui.openSheet(edit ? "Modifica appuntamento" : "Nuovo appuntamento", html, (d) => {
      const campi = {
        titolo: (d.titolo || "").trim(),
        data: d.data,
        ora: d.ora || null,
        fine: d.ora && d.fine ? d.fine : null,
        luogo: (d.luogo || "").trim() || null,
        note: (d.note || "").trim(),
        avviso_min: d.ora && d.avviso !== "" ? Number(d.avviso) : null,
        chi: d.chi,
      };
      if (!campi.titolo || !campi.data) return;
      this.selected = campi.data;
      if (edit) this.ui.run(this.store.modificaAppuntamento(app.id, campi));
      else this.ui.run(this.store.aggiungiAppuntamento(campi));
    });
    const form = $("#sheet-form");
    const warn = () => {
      const el = form.querySelector("#app-warn");
      const data = form.elements.data.value, ora = form.elements.ora.value, chi = form.elements.chi.value;
      const cf = this.turni && data ? cal.conflittoApp(this.turni, { data, ora, chi }) : null;
      el.hidden = !cf;
      if (cf) el.textContent = `⚠ Quel giorno ${this._testoConflitto(cf, data)}: l'appuntamento cade durante il turno.`;
    };
    form.elements.data.addEventListener("input", warn);
    form.elements.ora.addEventListener("input", warn);
    form.elements.chi.addEventListener("change", warn);
    warn();
    form.querySelector("#app-del")?.addEventListener("click", () => {
      this.ui.closeSheet();
      this.ui.run(this.store.eliminaAppuntamento(app.id));
    });
  }

  // --- impostazioni: cicli dei turni -----------------------------------------
  renderImpostazioni(box) {
    if (!box) return;
    const t = this.turni;
    if (!t) { box.innerHTML = `<p class="muted small">turni.json non trovato.</p>`; return; }
    box.innerHTML = Object.entries(t.persone).map(([pid, p]) => `
      <form class="set-ciclo" data-pid="${pid}">
        <h3>${esc(p.nome)}</h3>
        <label>Sequenza del ciclo (codici separati da spazi)
          <input name="sequenza" type="text" value="${esc(p.ciclo.sequenza.join(" "))}"></label>
        <p class="form-hint">Codici: ${Object.entries(p.tipi).map(([c, x]) => `<b>${esc(c)}</b> ${esc(x.nome)}`).join(" · ")}</p>
        <label>Primo giorno della sequenza<input name="ancora" type="date" value="${esc(p.ciclo.ancora)}"></label>
        ${Object.entries(p.tipi).filter(([, x]) => x.categoria === "turno").map(([c, x]) => `
          <div class="row-2 orari"><span class="orari-nome">${esc(x.nome)}</span>
            <input name="ini_${esc(c)}" type="time" value="${esc(x.inizio)}" aria-label="Inizio ${esc(x.nome)}">
            <input name="fin_${esc(c)}" type="time" value="${esc(x.fine === "24:00" ? "00:00" : x.fine)}" aria-label="Fine ${esc(x.nome)}"></div>`).join("")}
        <button type="submit" class="btn-secondary">Salva turni di ${esc(p.nome)}</button>
      </form>`).join("");
    box.querySelectorAll(".set-ciclo").forEach((f) => f.addEventListener("submit", (e) => {
      e.preventDefault();
      const pid = f.dataset.pid;
      const p = this.turni.persone[pid];
      let sequenza;
      try { sequenza = cal.parseSequenza(f.elements.sequenza.value, p.tipi); }
      catch (err) { showToast(err.message, "err"); return; }
      const orari = {};
      for (const [c, x] of Object.entries(p.tipi)) {
        if (x.categoria !== "turno") continue;
        const fin = f.elements[`fin_${c}`].value;
        orari[c] = { inizio: f.elements[`ini_${c}`].value, fine: fin === "00:00" ? "24:00" : fin };
      }
      this.ui.run(this.store.modificaCiclo(pid, { sequenza, ancora: f.elements.ancora.value, orari })
        .then(() => showToast("Turni salvati.", "ok")));
    }));
  }

  // --- condividi il mese come immagine -----------------------------------------
  async condividi() {
    if (!this.turni) return;
    const canvas = this._disegnaMese();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) { showToast("Immagine non riuscita.", "err"); return; }
    const nome = `calendario-${this.y}-${String(this.m).padStart(2, "0")}.png`;
    const file = new File([blob], nome, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${cal.MESI[this.m - 1]} ${this.y}` });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return; // l'utente ha chiuso il menu
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast("Immagine scaricata.", "ok");
  }

  _disegnaMese() {
    const turni = this.turni;
    const insieme = this.persona === "insieme";
    const pid = this.pidVista();
    const altro = this.altro;
    const griglia = cal.grigliaMese(this.y, this.m);
    const idxApp = cal.indiceAppuntamenti(this.appVista());
    const idxScad = cal.indiceScadenze(this.scadVista());
    const W = 1080, PAD = 24, CW = (W - PAD * 2) / 7, CH = 168, TOP = 190;
    const tipi = Object.values(turni.persone[pid].tipi);
    const H = TOP + CH * 6 + 150;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const font = (px, w = 400) => `${w} ${px}px "Segoe UI", Roboto, system-ui, sans-serif`;
    g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, W, H);

    g.fillStyle = "#222"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = font(54, 700);
    g.fillText(`${cal.MESI[this.m - 1].toUpperCase()} ${this.y}`, W / 2, 62);
    g.font = font(30, 600); g.fillStyle = "#555";
    const chi = insieme ? [pid, altro].filter(Boolean).map((x) => this.nome(x)).join(" + ") : this.nome(pid);
    g.fillText(chi, W / 2, 112);
    g.font = font(28, 700); g.fillStyle = "#4a5563";
    cal.GIORNI_BREVI.forEach((d, i) => g.fillText(d, PAD + CW * i + CW / 2, TOP - 30));

    const wrap = (txt, maxW, maxL) => {
      const words = String(txt).split(/\s+/); const lines = []; let cur = "";
      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        if (g.measureText(t).width <= maxW) cur = t;
        else { if (cur) lines.push(cur); cur = w; }
        if (lines.length === maxL) break;
      }
      if (lines.length < maxL && cur) lines.push(cur);
      return lines.slice(0, maxL);
    };
    const inMese = (i) => i >= 0 && i < 42 && Number(griglia[i].slice(5, 7)) === this.m;
    griglia.forEach((iso, i) => {
      const x = PAD + CW * (i % 7), y = TOP + CH * Math.floor(i / 7);
      const c = cal.contenutoCasella({ turni, pid, iso, idxApp, idxScad });
      g.globalAlpha = inMese(i) ? 1 : 0.35;
      const bande = [...c.bande];
      let hN = CH;
      if (insieme && altro) hN = CH * 0.64;
      bande.forEach((b, k) => {
        const bh = hN / bande.length;
        g.fillStyle = b.colore;
        g.fillRect(x + 1, y + 1 + bh * k, CW - 2, bh - (k === bande.length - 1 ? 2 : 0));
        if (!c.testo || insieme) {
          g.fillStyle = b.testo || "#2b2b2b"; g.font = font(26, 500); g.textAlign = "center";
          wrap(b.nome, CW - 12, 1).forEach((l) => g.fillText(l, x + CW / 2, y + bh * k + bh / 2 + 8));
        }
      });
      if (insieme && altro) {
        const v = cal.turniDelGiorno(turni, altro, iso)[0];
        const t = cal.tipoDef(turni, altro, v.tipo);
        g.fillStyle = t.colore; g.fillRect(x + 1, y + hN, CW - 2, CH - hN - 1);
        g.fillStyle = "#2b2b2b"; g.font = font(22, 500); g.textAlign = "center";
        g.fillText(t.nome, x + CW / 2, y + hN + (CH - hN) / 2);
      }
      if (c.testo && !insieme) {
        g.fillStyle = "#1f1f1f"; g.font = font(24, 500); g.textAlign = "center";
        wrap(c.testo, CW - 14, 4).forEach((l, k) => g.fillText(l, x + CW / 2, y + 62 + k * 28));
      }
      g.textAlign = "right"; g.font = font(30, 600);
      g.fillStyle = c.festivo ? "#d32f2f" : "#2b2b2b";
      g.fillText(String(Number(iso.slice(8))), x + CW - 10, y + 24);
      if (c.nApp || c.nScad || c.conflitto) {
        g.textAlign = "left"; g.font = font(22);
        g.fillText(`${c.nApp ? "✉" : ""}${c.nScad ? "📌" : ""}${c.conflitto ? "⚠" : ""}`, x + 8, y + 24);
      }
      g.globalAlpha = 1;
      if (inMese(i)) {
        g.strokeStyle = "#111"; g.lineWidth = 6; g.beginPath();
        const row = Math.floor(i / 7), col = i % 7;
        if (row === 0 || !inMese(i - 7)) { g.moveTo(x, y); g.lineTo(x + CW, y); }
        if (row === 5 || !inMese(i + 7)) { g.moveTo(x, y + CH); g.lineTo(x + CW, y + CH); }
        if (col === 0 || !inMese(i - 1)) { g.moveTo(x, y); g.lineTo(x, y + CH); }
        if (col === 6 || !inMese(i + 1)) { g.moveTo(x + CW, y); g.lineTo(x + CW, y + CH); }
        g.stroke();
      }
    });
    // legenda
    let lx = PAD, ly = TOP + CH * 6 + 50;
    g.textAlign = "left"; g.font = font(24);
    for (const t of tipi) {
      const w = g.measureText(t.nome).width + 56;
      if (lx + w > W - PAD) { lx = PAD; ly += 44; }
      g.fillStyle = t.colore; g.fillRect(lx, ly - 14, 28, 28);
      g.fillStyle = "#333"; g.fillText(t.nome, lx + 36, ly);
      lx += w;
    }
    return cv;
  }
}
