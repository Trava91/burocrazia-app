// conti-ui.js — scheda 💶 Conti (lo Splitwise di casa): saldo tra Nicolò e
// Valentina, movimenti del mese, riepilogo per categoria, form di inserimento.
// La logica pura (importi, saldo, categoria dal titolo) sta in conti.js.

import * as conti from "./conti.js";
import * as notifiche from "./notifiche.js";
import { MESI, GIORNI } from "./calendario.js";
import { showToast } from "./ui.js";

const $ = (sel) => document.querySelector(sel);
const SENZA = { nome: "Da classificare", emoji: "❔" };
const fmt = conti.fmtEuro;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const nSpese = (n) => `${n} ${n === 1 ? "spesa" : "spese"}`;

export class ContiUI {
  constructor(store, ui) {
    this.store = store;
    this.ui = ui;
    const t = conti.oggiIso();
    this.y = Number(t.slice(0, 4));
    this.m = Number(t.slice(5, 7));
    this.view = "movimenti";   // "movimenti" | "riepilogo"
    this.filtro = null;        // categoria scelta dal riepilogo ("" = da classificare)
    this.notifiche = "no";     // stato delle notifiche su questo telefono (vedi notifiche.js)
  }

  // --- dati comodi ------------------------------------------------------------
  get io() { return this.store.profilo; }
  get altro() { return conti.altro(this.io); }
  get diz() { return this.store.dizConti(); }
  get mese() { return `${this.y}-${String(this.m).padStart(2, "0")}`; }
  nome(pid) { return conti.PERSONE[pid] || pid; }
  cat(id) { return this.diz?.categorie?.[id] || null; }
  /** storico per indovinare la categoria, senza il movimento che si sta modificando */
  _storico(mov) { return this.store.movimenti().filter((x) => !mov || x.id !== mov.id); }

  // --- wiring -------------------------------------------------------------------
  init() {
    document.querySelectorAll(".conti-subtabs button").forEach((b) =>
      b.addEventListener("click", () => { this.view = b.dataset.view; this.render(); }));
    $("#conti-body").addEventListener("click", (e) => this._onClick(e));
    $("#conti-notifiche").addEventListener("click", (e) => {
      if (e.target.closest("[data-attiva]")) this.attivaNotifiche();
    });
    $("#conti-saldo").addEventListener("click", (e) => {
      if (e.target.closest("[data-salda]")) this.salda();
      if (e.target.closest("[data-ricarica]")) this.ui.run(this.store.ricarica());
    });
  }

  _onClick(e) {
    const nav = e.target.closest("[data-cnav]");
    if (nav) {
      const v = nav.dataset.cnav;
      if (v === "oggi") {
        const t = conti.oggiIso();
        this.y = Number(t.slice(0, 4)); this.m = Number(t.slice(5, 7));
      } else {
        const k = this.y * 12 + (this.m - 1) + Number(v);
        this.y = Math.floor(k / 12); this.m = (k % 12) + 1;
      }
      this.render();
      return;
    }
    // riga del riepilogo → i movimenti di quella categoria
    const f = e.target.closest("[data-filtro]");
    if (f) { this.filtro = f.dataset.filtro; this.view = "movimenti"; this.render(); return; }
    if (e.target.closest("[data-togli-filtro]")) { this.filtro = null; this.render(); }
  }

  // --- render -----------------------------------------------------------------
  render() {
    const body = $("#conti-body");
    if (!body) return;
    document.querySelectorAll(".conti-subtabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === this.view));
    if (!this.store.data.scadenze) { body.innerHTML = ""; $("#conti-saldo").innerHTML = ""; return; } // non ancora caricati
    this._renderNotifiche();
    this._renderSaldo();
    if (this.view === "riepilogo") body.innerHTML = this._htmlRiepilogo();
    else this._renderMovimenti(body);
  }

  _renderNotifiche() {
    $("#conti-notifiche").innerHTML = this.notifiche !== "da-attivare" ? "" : `<div class="saldo-card">
        <div><div class="saldo-lbl">🔔 Notifiche</div><div class="saldo-note">Ti avviso quando ${esc(this.nome(this.altro))} aggiunge, cambia o elimina una spesa.</div></div>
        <button type="button" class="btn-salda" data-attiva>Attiva</button>
      </div>`;
  }

  async attivaNotifiche() {
    try {
      this.notifiche = await notifiche.attiva(this.store);
      if (this.notifiche === "attive") showToast("Notifiche attive.", "ok");
      if (this.notifiche === "bloccate") showToast("Notifiche bloccate: riattivale dalle impostazioni del telefono.", "err");
    } catch (err) {
      showToast(err?.message || "Non sono riuscito ad attivare le notifiche.", "err");
    }
    this.render();
  }

  _renderSaldo() {
    // conti.json non arrivato (rete instabile, copia offline vecchia): mai dire "pari" a vuoto
    if (!this.store.data.conti) {
      $("#conti-saldo").innerHTML = `<div class="saldo-card">
          <div><div class="saldo-lbl">Conti non caricati</div><div class="saldo-note">${this.store.offline ? "Sei offline." : "Non sono arrivati da GitHub."}</div></div>
          <button type="button" class="btn-salda" data-ricarica>Riprova</button>
        </div>`;
      return;
    }
    const s = conti.saldo(this.store.movimenti(), this.io);
    const altro = this.nome(this.altro);
    const [cls, testo] = s > 0 ? ["pos", `${altro} ti deve`] : s < 0 ? ["neg", `Devi a ${altro}`] : ["pari", "Siete pari"];
    $("#conti-saldo").innerHTML = `<div class="saldo-card ${cls}">
        <div><div class="saldo-lbl">${esc(testo)}</div><div class="saldo-val">${s ? fmt(Math.abs(s)) : "✓"}</div></div>
        ${s ? `<button type="button" class="btn-salda" data-salda>Salda</button>` : ""}
      </div>`;
  }

  _head() {
    return `<div class="cal-head conti-head">
      <button class="cal-arrow" data-cnav="-1" aria-label="Mese precedente">‹</button>
      <h2 data-cnav="oggi" title="Torna a questo mese">${MESI[this.m - 1]} ${this.y}</h2>
      <button class="cal-arrow" data-cnav="1" aria-label="Mese successivo">›</button>
    </div>`;
  }

  _fmtGiorno(iso) {
    const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
    return `${GIORNI[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESI[d.getMonth()]}`;
  }

  _renderMovimenti(body) {
    let lista = this.store.movimenti().filter((m) => String(m.data || "").startsWith(this.mese));
    if (this.filtro !== null) {
      lista = lista.filter((m) => (this.filtro === "" ? !this.cat(m.categoria) : m.categoria === this.filtro));
    }
    lista.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.creata || "").localeCompare(a.creata || ""));
    let h = this._head();
    if (this.filtro !== null) {
      const c = this.cat(this.filtro) || SENZA;
      h += `<div class="conti-filtro"><button type="button" data-togli-filtro aria-label="Togli il filtro">${c.emoji} ${esc(c.nome)} ✕</button></div>`;
    }
    body.innerHTML = h + `<ul class="list conti-list"></ul>`;
    const ul = body.querySelector(".conti-list");
    if (!lista.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = this.filtro !== null ? "Niente in questa categoria." : "Nessuna spesa in questo mese. Aggiungila col +.";
      ul.appendChild(li);
      return;
    }
    let giorno = null;
    for (const m of lista) {
      if (m.data !== giorno) {
        giorno = m.data;
        const li = document.createElement("li");
        li.className = "conti-day";
        li.textContent = this._fmtGiorno(giorno);
        ul.appendChild(li);
      }
      ul.appendChild(this._riga(m));
    }
  }

  _riga(m) {
    const c = this.cat(m.categoria) || SENZA;
    const io = this.io;
    const eff = conti.effetto(m, io);
    let sub;
    if (m.apertura) {
      sub = "Riportato da Splitwise";
    } else if (c.trasferimento) {
      sub = m.pagato_da === io ? `Hai dato a ${this.nome(this.altro)}` : `${this.nome(m.pagato_da)} ti ha dato`;
    } else {
      const chi = m.pagato_da === io ? "Pagata da te" : `Pagata da ${this.nome(m.pagato_da)}`;
      const dichi = conti.diChi(m);
      const di = dichi === "meta" ? "a metà"
        : dichi === io ? "tutta tua"
        : dichi === m.pagato_da ? "tutta sua" : `tutta di ${this.nome(dichi)}`;
      sub = `${chi} · ${di}`;
    }
    const spiega = eff > 0 ? `${this.nome(this.altro)} ti deve ${fmt(eff)}`
      : eff < 0 ? `devi ${fmt(-eff)} a ${this.nome(this.altro)}` : "non sposta il saldo";
    const effHtml = eff
      ? `<div class="conti-eff ${eff > 0 ? "pos" : "neg"}" aria-label="${esc(spiega)}">${eff > 0 ? "+" : "−"}${fmt(Math.abs(eff)).replace(" €", "")}</div>`
      : `<div class="conti-eff zero" aria-label="${esc(spiega)}">—</div>`;
    const content = `
      <span class="conti-cat" aria-hidden="true">${c.emoji}</span>
      <div class="row-text">
        <div class="row-title">${esc(m.titolo)}</div>
        <div class="row-sub">${esc(sub)}</div>
      </div>
      <div class="conti-amt" title="${esc(spiega)}">
        <div class="conti-tot">${fmt(m.importo_cent)}</div>
        ${effHtml}
      </div>`;
    const li = this.ui._buildRow({
      id: m.id,
      content,
      primary: null,
      secondary: [
        { cls: "act-edit", label: "✏️", run: () => this.apriForm(m) },
        { cls: "act-del", label: "🗑️", run: () => this.elimina(m.id) },
      ],
    });
    // tocco sulla riga = modifica (non dopo uno swipe, non se c'era una riga aperta)
    const fg = li.querySelector(".row-fg");
    let sx = 0, sy = 0, mosso = false, aperta = false;
    fg.addEventListener("pointerdown", (e) => {
      sx = e.clientX; sy = e.clientY; mosso = false; aperta = Boolean(this.ui.openRow);
    }, { capture: true });
    fg.addEventListener("pointermove", (e) => {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) mosso = true;
    });
    fg.addEventListener("click", () => { if (!mosso && !aperta) this.apriForm(m); });
    return li;
  }

  _htmlRiepilogo() {
    const r = conti.riepilogo(this.store.movimenti(), this.mese, this.io, this.diz);
    let h = this._head();
    h += `<div class="kpi-row">
        <div class="kpi"><div class="kpi-lbl">Spese del mese</div><div class="kpi-val">${fmt(r.totale)}</div><div class="kpi-sub">${nSpese(r.n)}</div></div>
        <div class="kpi"><div class="kpi-lbl">La tua parte</div><div class="kpi-val">${fmt(r.mia)}</div><div class="kpi-sub">&nbsp;</div></div>
      </div>`;
    if (r.n) {
      const max = Math.max(...r.categorie.map((x) => x.totale));
      h += `<section class="riep-card"><h3>Per categoria</h3><ul class="cbar-list">`;
      for (const x of r.categorie) {
        const c = this.cat(x.categoria) || SENZA;
        const w = Math.max(1, Math.round((x.totale / max) * 100));
        const dett = `${nSpese(x.n)} · tua parte ${fmt(x.mia)}`;
        h += `<li><button type="button" class="cbar${x.categoria ? "" : " senza"}" data-filtro="${esc(x.categoria ?? "")}"
            aria-label="${esc(c.nome)}: ${fmt(x.totale)}, ${dett}. Tocca per vedere le spese">
          <span class="cbar-top"><span class="cbar-nome">${c.emoji} ${esc(c.nome)}</span><span class="cbar-val">${fmt(x.totale)}</span></span>
          <span class="cbar-track"><span class="cbar-fill" style="width:${w}%"></span></span>
          <span class="cbar-sub">${dett}</span>
        </button></li>`;
      }
      h += `</ul>`;
      if (r.da_classificare) {
        h += `<p class="riep-note">❔ ${nSpese(r.da_classificare)} senza categoria: le classifica il PC al prossimo giro di <b>/burocrazia</b>, oppure toccale e sceglila tu.</p>`;
      }
      h += `<p class="riep-note">Tocca una categoria per vederne le spese.</p></section>`;
    } else {
      h += `<p class="empty">Nessuna spesa in questo mese.</p>`;
    }
    if (r.soldi_dati || r.soldi_ricevuti) {
      h += `<section class="riep-card"><h3>Soldi tra voi</h3><table class="riep">
          <tr><td>Hai dato a ${esc(this.nome(this.altro))}</td><td>${fmt(r.soldi_dati)}</td></tr>
          <tr><td>${esc(this.nome(this.altro))} ti ha dato</td><td>${fmt(r.soldi_ricevuti)}</td></tr>
        </table><p class="riep-note">Prestiti, rimborsi e saldi: contano per il saldo, non tra le spese.</p></section>`;
    }
    return h;
  }

  // --- form ------------------------------------------------------------------
  /** mov = movimento da modificare; preset = valori iniziali di uno nuovo (es. Salda).
   *  I soldi passati tra voi (Salda, prestiti) hanno il form ridotto: chi dà i soldi a chi. */
  apriForm(mov = null, preset = {}, titoloSheet = null) {
    const edit = Boolean(mov);
    const v = mov || preset;
    const io = this.io, altro = this.altro;
    const soldi = Boolean(this.cat(v.categoria)?.trasferimento) && (edit || Boolean(titoloSheet));
    const pagato = v.pagato_da || io;
    const quota = v.divisione ? conti.diChi({ pagato_da: pagato, divisione: v.divisione }) : "meta";
    const catSel = mov ? (mov.categoria_auto ? "" : mov.categoria || "") : preset.categoria || "";
    const importo = v.importo_cent ? (v.importo_cent / 100).toFixed(2).replace(".", ",") : "";
    const cats = Object.entries(this.diz?.categorie || {});
    const opzQuota = [["meta", "A metà"], [io, "Tutta mia"], [altro, `Tutta di ${this.nome(altro)}`]];
    const html = `
      <label>Importo<input name="importo" class="in-importo" type="text" inputmode="decimal" autocomplete="off" required placeholder="0,00" value="${esc(importo)}"></label>
      <label>Titolo<input name="titolo" type="text" autocomplete="off" required placeholder="es. Spesa Coop" value="${esc(v.titolo || "")}"></label>
      <p class="form-hint conti-guess" id="conti-guess" hidden></p>
      <div class="field"><span class="field-cap">${soldi ? "Chi dà i soldi" : "Chi ha pagato"}</span>
        <div class="seg seg-full">${[io, altro].map((p) =>
          `<input type="radio" id="cp-${p}" name="pagato_da" value="${p}"${p === pagato ? " checked" : ""}><label for="cp-${p}">${p === io ? "Io" : esc(this.nome(p))}</label>`).join("")}
        </div></div>
      ${soldi ? `<input type="hidden" name="divisione" value="${esc(v.divisione || "tutto")}">` : `
      <div class="field"><span class="field-cap">Di chi è la spesa</span>
        <div class="seg seg-full seg-3">${opzQuota.map(([val, lbl]) =>
          `<input type="radio" id="cq-${val}" name="quota" value="${val}"${val === quota ? " checked" : ""}><label for="cq-${val}">${esc(lbl)}</label>`).join("")}
        </div>
        <p class="form-hint" id="conti-quota" hidden></p></div>`}
      <div class="row-2">
        <label>Data<input name="data" type="date" required value="${esc(v.data || conti.oggiIso())}"></label>
        <label>Categoria<select name="categoria"><option value="">Automatica</option>${cats.map(([k, c]) =>
          `<option value="${esc(k)}"${k === catSel ? " selected" : ""}>${c.emoji} ${esc(c.nome)}</option>`).join("")}</select></label>
      </div>
      <p class="form-hint">${soldi
        ? "Registralo quando i soldi sono passati davvero (bonifico, contanti, Revolut). Per un saldo parziale cambia l'importo."
        : "Con <b>Automatica</b> la categoria arriva dal titolo; se non la riconosce la sceglie il PC al prossimo giro di /burocrazia."}</p>
      ${edit ? `<button type="button" class="btn-danger" id="conti-del">Elimina</button>` : ""}`;

    const titolo0 = titoloSheet || (soldi ? "Soldi tra voi" : edit ? "Modifica spesa" : "Nuova spesa");
    this.ui.openSheet(titolo0, html, (d) => {
      const importo_cent = conti.parseImporto(d.importo);
      const titolo = (d.titolo || "").trim();
      if (!importo_cent || !titolo) return;
      let categoria = d.categoria || null, categoria_auto = false;
      if (!categoria) {
        const g = conti.indovina(titolo, this._storico(mov), this.diz);
        categoria = g ? g.categoria : null;
        categoria_auto = Boolean(g);
      }
      const divisione = soldi ? d.divisione : conti.divisioneDa(d.quota, d.pagato_da);
      const campi = { titolo, importo_cent, pagato_da: d.pagato_da, divisione, data: d.data, categoria, categoria_auto };
      this.y = Number(d.data.slice(0, 4)); this.m = Number(d.data.slice(5, 7)); // mostra il mese della spesa
      if (titoloSheet) this._confermaSalda(campi); // titoloSheet ce l'ha solo Salda
      else if (edit) this.ui.run(this.store.modificaMovimento(mov.id, campi));
      else this.ui.run(this.store.aggiungiMovimento(campi));
    });

    const form = $("#sheet-form");
    const inImporto = form.elements.importo;
    const aggiorna = () => {
      inImporto.setCustomValidity(!inImporto.value || conti.parseImporto(inImporto.value) ? "" : "Importo non valido (es. 12,50)");
      // chi deve cosa, in parole (la combinazione "chi ha pagato" + "di chi è")
      const qh = form.querySelector("#conti-quota");
      if (qh) {
        const pag = form.elements.pagato_da.value, q = form.elements.quota.value;
        qh.hidden = q === "meta";
        if (q === pag) qh.textContent = "Non sposta il saldo: resta solo nei conti del mese.";
        else if (q === io) qh.textContent = `Devi tutto a ${this.nome(altro)}.`;
        else qh.textContent = `${this.nome(altro)} ti deve tutto.`;
      }
      const hint = form.querySelector("#conti-guess");
      const titolo = form.elements.titolo.value.trim();
      hint.hidden = Boolean(form.elements.categoria.value) || !titolo;
      if (hint.hidden) return;
      const g = conti.indovina(titolo, this._storico(mov), this.diz);
      const c = g && this.cat(g.categoria);
      hint.textContent = c ? `Categoria: ${c.emoji} ${c.nome}` : "Categoria: ❔ la sceglie il PC";
    };
    form.addEventListener("input", aggiorna);
    form.addEventListener("change", aggiorna);
    aggiorna();
    form.querySelector("#conti-del")?.addEventListener("click", () => {
      this.ui.closeSheet();
      this.elimina(mov.id);
    });
  }

  /** Salda: un movimento di "soldi tra voi" che azzera il saldo (chi deve dà i soldi). */
  salda() {
    const s = conti.saldo(this.store.movimenti(), this.io);
    if (!s) return;
    this.apriForm(null, {
      titolo: "Saldo",
      importo_cent: Math.abs(s),
      pagato_da: s < 0 ? this.io : this.altro,
      divisione: "tutto",
      categoria: conti.categoriaSoldi(this.diz),
      data: conti.oggiIso(),
    }, "Salda il conto");
  }

  /** Ultimo passo di Salda: il movimento si scrive solo dopo il sì. */
  _confermaSalda(campi) {
    const importo = fmt(campi.importo_cent);
    const frase = campi.pagato_da === this.io
      ? `Dai ${importo} a ${this.nome(this.altro)}.`
      : `${this.nome(campi.pagato_da)} ti dà ${importo}.`;
    const box = this.ui.openCustomSheet("Confermi il saldo?", `
      <p class="conti-conferma">${esc(frase)}</p>
      <button type="button" class="btn-primary" data-si>Sì, salda</button>
      <button type="button" class="btn-secondary" data-no>Annulla</button>`);
    this.ui.sheetKind = "form"; // così un ricaricamento dei dati non la sostituisce col giorno del calendario
    box.querySelector("[data-si]").addEventListener("click", () => {
      this.ui.closeSheet();
      this.ui.run(this.store.aggiungiMovimento(campi));
    });
    box.querySelector("[data-no]").addEventListener("click", () => this.ui.closeSheet());
  }

  /** Elimina con 4 secondi per annullare (sono soldi: meglio un ripensamento). */
  elimina(id) {
    const li = document.querySelector(`#conti-body li.row[data-id="${CSS.escape(id)}"]`);
    let annullato = false;
    if (li) {
      li.classList.add("removing");
      li.style.maxHeight = li.offsetHeight + "px";
      requestAnimationFrame(() => { li.style.maxHeight = "0px"; li.style.opacity = "0"; });
    }
    const timer = setTimeout(() => { if (!annullato) this.ui.run(this.store.eliminaMovimento(id)); }, 4000);
    showToast("Spesa eliminata", "ok", {
      actionLabel: "Annulla",
      duration: 4000,
      onAction: () => { annullato = true; clearTimeout(timer); this.render(); },
    });
  }
}
