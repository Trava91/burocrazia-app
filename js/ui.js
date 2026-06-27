// ui.js — render delle liste, tab, gesture swipe, form aggiungi/modifica, toast.
// Tutta la manipolazione DOM vive qui; la logica dati sta in store/model.

import { CATEGORIE, RICORRENZA_MESI, PRIORITA_EMOJI, fmtGiorni, parseISODate } from "./model.js";

const $ = (sel) => document.querySelector(sel);

// Data leggibile in italiano: "domenica 12 luglio 2026". null → testo neutro.
function fmtDataEstesa(iso) {
  const p = parseISODate(iso);
  if (!p) return "Data da definire";
  const d = new Date(p.y, p.m - 1, p.d);
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// --- toast (anche standalone, usato da main.js) -----------------------------
// opts: { actionLabel, onAction, duration }
let toastTimer = null;
export function showToast(msg, type = "", opts = {}) {
  const t = $("#toast");
  clearTimeout(toastTimer);
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  if (opts.actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = opts.actionLabel;
    btn.addEventListener("click", () => {
      t.hidden = true;
      clearTimeout(toastTimer);
      opts.onAction?.();
    });
    t.appendChild(btn);
  }
  t.className = "toast" + (type ? " " + type : "");
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, opts.duration || 3200);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class UI {
  constructor(store) {
    this.store = store;
    this.tab = "scadenze";
    this.includeTutte = false;
    this.openRow = null; // riga con lo swipe aperto (per chiuderla)
  }

  init() {
    // Tab
    document.querySelectorAll(".tab").forEach((btn) =>
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab)));

    // Toggle "tutte"
    $("#toggle-tutte").addEventListener("change", (e) => {
      this.includeTutte = e.target.checked;
      this.renderScadenze();
    });

    // FAB → nuovo (dipende dal tab)
    $("#fab").addEventListener("click", () => {
      if (this.tab === "scadenze") this.openScadenzaForm();
      else if (this.tab === "appunti") this.openAppuntoForm();
      else if (this.tab === "spesa") this.openSpesaForm();
    });

    // Sheet
    $("#sheet-close").addEventListener("click", () => this.closeSheet());
    $("#sheet-backdrop").addEventListener("click", () => this.closeSheet());

    // Tab Invia: deep-link bot
    this.refreshInviaLinks();

    this.renderAll();
  }

  // --- esecuzione operazioni con gestione errori ---------------------------
  async run(promise) {
    try {
      await promise;
    } catch (e) {
      showToast(e?.message || "Operazione non riuscita, riprova.", "err");
    }
  }

  // --- tab -----------------------------------------------------------------
  switchTab(tab) {
    this.tab = tab;
    document.querySelectorAll(".tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === tab));
    for (const name of ["scadenze", "appunti", "spesa", "invia"]) {
      $(`#panel-${name}`).hidden = name !== tab;
    }
    $("#fab").hidden = tab === "invia";
    const titoli = { scadenze: "Scadenze", appunti: "Appunti", spesa: "Spesa", invia: "Invia" };
    $("#header-title").textContent = titoli[tab] || "Burocrazia";
    this.closeOpenRow();
  }

  // --- render --------------------------------------------------------------
  renderAll() {
    this.renderScadenze();
    this.renderAppunti();
    this.renderSpesa();
    this.renderSync();
  }

  renderSync() {
    const s = this.store;
    let txt = "";
    if (s.offline) txt = "offline";
    else if (s.lastSync) {
      const d = new Date(s.lastSync);
      txt = "sync " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    }
    $("#sync-status").textContent = txt;
  }

  renderScadenze() {
    const list = $("#list-scadenze");
    const items = this.store.scadenzeView(this.includeTutte);
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(this._empty("Nessuna scadenza."));
      return;
    }
    for (const it of items) list.appendChild(this._scadenzaRow(it));
  }

  renderAppunti() {
    const list = $("#list-appunti");
    const items = this.store.appuntiAttivi();
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(this._empty("Nessun appunto."));
      return;
    }
    for (const a of items) list.appendChild(this._appuntoRow(a));
  }

  renderSpesa() {
    const list = $("#list-spesa");
    const items = this.store.spesaDaComprare();
    list.innerHTML = "";
    if (!items.length) {
      list.appendChild(this._empty("Lista vuota."));
      return;
    }
    for (const v of items) list.appendChild(this._spesaRow(v));
  }

  _empty(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }

  // --- righe ---------------------------------------------------------------
  _scadenzaRow(it) {
    const prio = PRIORITA_EMOJI[it.priorita] || "";
    const ric = it.ricorrenza ? ` · ${it.ricorrenza}` : "";
    const urgent = it._giorni !== null && it._giorni <= 0;
    const content = `
      <span class="prio">${prio}</span>
      <div class="row-text" data-expand>
        <div class="row-title">${esc(it.titolo)}</div>
        <div class="row-sub${urgent ? " urgent" : ""}">${esc(fmtGiorni(it._giorni))} · ${esc(CATEGORIE[it.categoria] || it.categoria)}${esc(ric)}</div>
        <div class="row-date">📅 ${esc(fmtDataEstesa(it.scadenza))}</div>
      </div>`;
    const row = this._buildRow({
      id: it.id,
      content,
      primary: { cls: "act-done", label: "✓", run: () => this.run(this.store.completaScadenza(it.id)) },
      secondary: [
        { cls: "act-edit", label: "✏️", run: () => this.openScadenzaForm(it) },
        { cls: "act-del", label: "🗑️", run: () => this.run(this.store.eliminaScadenza(it.id)) },
      ],
    });
    // tap sul testo = espandi/contrai (titolo intero + data di scadenza)
    row.querySelector("[data-expand]")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("expanded");
    });
    return row;
  }

  _appuntoRow(a) {
    const content = `
      <div class="row-text">
        <div class="row-title" data-expand>${esc(a.testo)}</div>
      </div>`;
    const row = this._buildRow({
      id: a.id,
      content,
      primary: { cls: "act-done", label: "✓", run: () => this.run(this.store.eliminaAppunto(a.id)) },
      secondary: [
        { cls: "act-edit", label: "✏️", run: () => this.openAppuntoForm(a) },
      ],
    });
    // tap sul testo = espandi/contrai
    row.querySelector("[data-expand]")?.addEventListener("click", (e) => {
      e.currentTarget.classList.toggle("expanded");
    });
    return row;
  }

  _spesaRow(v) {
    const content = `
      <span class="chk" role="checkbox" aria-checked="false" data-check></span>
      <div class="row-text"><div class="row-title">${esc(v.testo)}</div></div>`;
    const row = this._buildRow({
      id: v.id,
      content,
      primary: { cls: "act-done", label: "✓", run: () => this.run(this.store.comprata(v.id)) },
      secondary: [
        { cls: "act-del", label: "🗑️", run: () => this.run(this.store.eliminaSpesa(v.id)) },
      ],
    });
    // checkbox = comprata (rimuove)
    row.querySelector("[data-check]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.run(this.store.comprata(v.id));
    });
    return row;
  }

  // Costruisce una <li> con swipe: destra → primary (azione diretta),
  // sinistra → rivela i secondary (tap esplicito).
  _buildRow({ id, content, primary, secondary = [] }) {
    const li = document.createElement("li");
    li.className = "row";
    li.dataset.id = id;

    const left = document.createElement("div");
    left.className = "row-actions row-actions-left";
    if (primary) {
      const b = document.createElement("button");
      b.className = "act " + primary.cls;
      b.textContent = primary.label;
      b.addEventListener("click", () => primary.run());
      left.appendChild(b);
    }

    const right = document.createElement("div");
    right.className = "row-actions row-actions-right";
    for (const a of secondary) {
      const b = document.createElement("button");
      b.className = "act " + a.cls;
      b.textContent = a.label;
      b.addEventListener("click", () => { this.closeOpenRow(); a.run(); });
      right.appendChild(b);
    }

    const fg = document.createElement("div");
    fg.className = "row-fg animate";
    fg.innerHTML = content;

    li.append(left, right, fg);
    this._wireSwipe(li, fg, { primary, revealWidth: secondary.length * 72 });
    return li;
  }

  // Swipe destra → completa, ma con conferma annullabile (4s) prima di eseguire davvero.
  _confirmComplete(li, fg, primary) {
    let undone = false;
    li.classList.add("removing");
    li.style.maxHeight = li.offsetHeight + "px";
    requestAnimationFrame(() => {
      li.style.maxHeight = "0px";
      li.style.opacity = "0";
    });
    const timer = setTimeout(() => {
      if (!undone) primary.run();
    }, 4000);
    showToast("Completato", "ok", {
      actionLabel: "Annulla",
      duration: 4000,
      onAction: () => {
        undone = true;
        clearTimeout(timer);
        li.style.maxHeight = "";
        li.style.opacity = "";
        li.classList.remove("removing");
        fg.style.transform = "translateX(0)";
      },
    });
  }

  _wireSwipe(li, fg, { primary, revealWidth }) {
    let startX = 0, startY = 0, startTime = 0, dx = 0, dragging = false, decided = false, horizontal = false;
    const TRIGGER = 88;      // soglia distanza per far scattare la primary (swipe destra)
    const FLICK_V = 0.45;    // px/ms: uno swipe veloce apre i secondary anche su poca distanza

    const setX = (x) => { fg.style.transform = `translateX(${x}px)`; };

    const onDown = (e) => {
      // se un'altra riga è aperta, chiudila al primo tocco
      if (this.openRow && this.openRow !== li) this.closeOpenRow();
      startX = e.clientX; startY = e.clientY; startTime = performance.now();
      dx = 0; dragging = true; decided = false; horizontal = false;
      fg.classList.remove("animate");
      fg.classList.add("dragging");
      fg.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        horizontal = Math.abs(mx) > Math.abs(my);
      }
      if (!horizontal) return;
      e.preventDefault();
      // limiti: a sinistra fino a revealWidth, a destra fino a TRIGGER+un po'
      dx = Math.max(-revealWidth - 20, Math.min(primary ? TRIGGER + 30 : 0, mx));
      setX(dx);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      fg.classList.remove("dragging");
      fg.classList.add("animate");
      const dt = Math.max(1, performance.now() - startTime);
      const velocity = dx / dt; // px/ms, negativo = verso sinistra
      if (primary && dx > TRIGGER) {
        // swipe destra completo → chiede conferma annullabile
        setX(0);
        this._confirmComplete(li, fg, primary);
        return;
      }
      const farEnough = revealWidth && dx < -revealWidth / 2;
      const fastFlick = revealWidth && dx < -28 && velocity < -FLICK_V;
      if (farEnough || fastFlick) {
        setX(-revealWidth);             // resta aperta sui secondary finché non tocchi altrove
        this.openRow = li;
      } else {
        setX(0);                        // torna a posto
        if (this.openRow === li) this.openRow = null;
      }
    };

    fg.addEventListener("pointerdown", onDown);
    fg.addEventListener("pointermove", onMove);
    fg.addEventListener("pointerup", onUp);
    fg.addEventListener("pointercancel", onUp);
    // tap sulla riga aperta → chiudila
    fg.addEventListener("click", () => {
      if (this.openRow === li && dx <= -revealWidth / 2) this.closeOpenRow();
    });
  }

  closeOpenRow() {
    if (!this.openRow) return;
    const fg = this.openRow.querySelector(".row-fg");
    if (fg) { fg.classList.add("animate"); fg.style.transform = "translateX(0)"; }
    this.openRow = null;
  }

  // --- form (sheet) --------------------------------------------------------
  openSheet(title, html, onSubmit) {
    $("#sheet-title").textContent = title;
    const form = $("#sheet-form");
    form.innerHTML = html + `<button type="submit" class="btn-primary">Salva</button>`;
    form.onsubmit = (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      this.closeSheet();
      onSubmit(data);
    };
    $("#sheet-backdrop").hidden = false;
    $("#sheet").hidden = false;
    setTimeout(() => form.querySelector("input,textarea,select")?.focus(), 60);
  }

  closeSheet() {
    $("#sheet").hidden = true;
    $("#sheet-backdrop").hidden = true;
  }

  _catOptions(sel) {
    return Object.entries(CATEGORIE).map(([k, v]) =>
      `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
  }
  _ricOptions(sel) {
    const opts = [`<option value=""${!sel ? " selected" : ""}>nessuna</option>`];
    for (const k of Object.keys(RICORRENZA_MESI)) {
      opts.push(`<option value="${k}"${k === sel ? " selected" : ""}>${k}</option>`);
    }
    return opts.join("");
  }
  _prioOptions(sel) {
    return Object.keys(PRIORITA_EMOJI).map((k) =>
      `<option value="${k}"${k === sel ? " selected" : ""}>${PRIORITA_EMOJI[k]} ${k}</option>`).join("");
  }

  openScadenzaForm(item = null) {
    const edit = Boolean(item);
    const html = `
      <label>Titolo<input name="titolo" type="text" required value="${esc(item?.titolo || "")}"></label>
      <label>Scadenza<input name="scadenza" type="date" value="${esc(item?.scadenza || "")}"></label>
      <div class="row-2">
        <label>Categoria<select name="categoria">${this._catOptions(item?.categoria || "personale")}</select></label>
        <label>Priorità<select name="priorita">${this._prioOptions(item?.priorita || "media")}</select></label>
      </div>
      <label>Ricorrenza<select name="ricorrenza">${this._ricOptions(item?.ricorrenza || "")}</select></label>`;
    this.openSheet(edit ? "Modifica scadenza" : "Nuova scadenza", html, (d) => {
      const campi = {
        titolo: d.titolo.trim(),
        scadenza: d.scadenza || null,
        categoria: d.categoria,
        ricorrenza: d.ricorrenza || null,
        priorita: d.priorita,
      };
      if (!campi.titolo) return;
      if (edit) this.run(this.store.modificaScadenza(item.id, campi));
      else this.run(this.store.aggiungiScadenza(campi));
    });
  }

  openAppuntoForm(item = null) {
    const edit = Boolean(item);
    const html = `<label>Testo<textarea name="testo" required>${esc(item?.testo || "")}</textarea></label>`;
    this.openSheet(edit ? "Modifica appunto" : "Nuovo appunto", html, (d) => {
      const testo = (d.testo || "").trim();
      if (!testo) return;
      if (edit) this.run(this.store.modificaAppunto(item.id, testo));
      else this.run(this.store.aggiungiAppunto(testo));
    });
  }

  openSpesaForm() {
    const html = `<label>Voce<input name="testo" type="text" required placeholder="es. latte"></label>`;
    this.openSheet("Nuova voce spesa", html, (d) => {
      const testo = (d.testo || "").trim();
      if (testo) this.run(this.store.aggiungiSpesa(testo));
    });
  }

  // --- tab Invia -----------------------------------------------------------
  refreshInviaLinks() {
    const url = this.store.telegramUrl();
    const voc = $("#btn-vocale"), foto = $("#btn-foto"), nobot = $("#invia-nobot");
    if (url) {
      voc.href = url; foto.href = url;
      voc.target = foto.target = "_blank"; voc.rel = foto.rel = "noopener";
      nobot.hidden = true;
      voc.classList.remove("disabled"); foto.classList.remove("disabled");
    } else {
      voc.removeAttribute("href"); foto.removeAttribute("href");
      nobot.hidden = false;
    }
  }
}
