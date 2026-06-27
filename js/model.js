// model.js — porting JS della logica di MUTAZIONE strutturata dei tre JSON.
//
// Calco fedele dei motori Python (scadenzario.py, memoria.py, lista_spesa.py,
// cloud_inbox.py). Lo schema dei 3 JSON è il CONTRATTO condiviso Python↔JS:
// se cambia un campo qui, va cambiato anche lì (vedi contesto.md dell'app).
//
// Niente parser di linguaggio naturale: quello resta su Telegram/PC. Qui solo
// le regole deterministiche: date ricorrenti, slug, formato giorni, schema voci.

// --- costanti (identiche a scadenzario.py) ---------------------------------
export const CATEGORIE = {
  "personale": "Personale",
  "casa-coppia": "Casa / coppia",
  "nonni": "Nonni",
  "tasse": "Tasse",
};
export const RICORRENZA_MESI = {
  "mensile": 1, "trimestrale": 3, "semestrale": 6,
  "annuale": 12, "biennale": 24,
};
export const PRIORITA_EMOJI = { "alta": "🔴", "media": "🟡", "bassa": "⚪" };

// --- date: rappresentate come {y, m, d} interi, niente fusi orari -----------
function floorDiv(a, b) { return Math.floor(a / b); }
function mod(a, b) { return ((a % b) + b) % b; }

export function parseISODate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function daysInMonth(y, m1) {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate(); // m1 = 1..12
}

export function toISODate({ y, m, d }) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// add_months: avanza di n mesi clampando il giorno all'ultimo del mese.
export function addMonths(ymd, n) {
  const t = ymd.m - 1 + n;        // mese 0-based dal punto di partenza
  const y = ymd.y + floorDiv(t, 12);
  const m = mod(t, 12) + 1;       // di nuovo 1-based
  const d = Math.min(ymd.d, daysInMonth(y, m));
  return { y, m, d };
}

function cmpYMD(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

function diffDays(a, b) {
  const ms = Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
  return Math.round(ms / 86400000);
}

export function todayYMD(now = new Date()) {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

// effective_date: se la scadenza è passata ed è ricorrente, avanza alla prossima
// occorrenza futura. Identico a scadenzario.effective_date.
export function effectiveDate(item, today) {
  const d = parseISODate(item.scadenza);
  if (!d) return null;
  const step = RICORRENZA_MESI[item.ricorrenza];
  if (step) {
    let cur = d;
    while (cmpYMD(cur, today) < 0) cur = addMonths(cur, step);
    return cur;
  }
  return d;
}

// fmt_giorni
export function fmtGiorni(g) {
  if (g === null || g === undefined) return "data da definire";
  if (g < 0) return `SCADUTA da ${-g} gg`;
  if (g === 0) return "OGGI";
  return `tra ${g} gg`;
}

// _recurring_far: ricorrente oltre il suo preavviso → nascosta dalla vista di default.
function recurringFar(item, giorni) {
  return Boolean(item.ricorrenza) && giorni !== null && giorni > (item.preavviso_giorni ?? 30);
}

// Arricchisce una voce con { _eff, _giorni } per ordinamento/render.
export function enrichScadenza(item, today) {
  const eff = effectiveDate(item, today);
  const giorni = eff ? diffDays(eff, today) : null;
  return { ...item, _eff: eff, _giorni: giorni };
}

// Vista scadenze per l'app: attive (stato != "fatta"), ordinate per giorni
// (le senza data in fondo). Di default nasconde le ricorrenti-lontane; con
// `includeRicorrentiLontane` le mostra tutte (= tutte_attive del Python).
export function scadenzeView(items, today, includeRicorrentiLontane = false) {
  const out = [];
  for (const it of items) {
    if (it.stato === "fatta") continue;
    const x = enrichScadenza(it, today);
    if (!includeRicorrentiLontane && recurringFar(x, x._giorni)) continue;
    out.push(x);
  }
  out.sort((a, b) => {
    const an = a._giorni === null, bn = b._giorni === null;
    if (an !== bn) return an ? 1 : -1;            // senza data in fondo
    if (an && bn) return 0;
    return a._giorni - b._giorni;                 // più imminente prima
  });
  return out;
}

// --- slug ------------------------------------------------------------------
// _norm Python: NFKD + togli non-ASCII (decompone gli accenti e li scarta) + lower.
function norm(s) {
  return s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase();
}

// slug per le SCADENZE — calco di cloud_inbox.slug (fallback "voce").
export function slugScadenza(s) {
  const cleaned = s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const out = cleaned.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return out || "voce";
}

// slug per APPUNTI/SPESA — calco di memoria._slug (max 40 char, fallback "appunto").
export function slugAppunto(s) {
  let out = norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  out = out.slice(0, 40).replace(/-+$/g, "");
  return out || "appunto";
}

// dedup -2, -3 … su un insieme di id esistenti (calco di _new_id / add_appunto).
function uniqueId(base, existingIds) {
  let sid = base, n = 2;
  while (existingIds.has(sid)) { sid = `${base}-${n}`; n++; }
  return sid;
}

// --- costruzione voci (schema completo) ------------------------------------
// preavviso: stringa/numero giorni (default 30). orario: "HH:MM" o vuoto/null.
export function preavvisoGiorni(v, fallback = 30) {
  const s = (v ?? "").toString().trim();
  const n = parseInt(s, 10);
  return s !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function newScadenza({ titolo, scadenza, categoria, ricorrenza, priorita, orario, preavviso }, items) {
  const ids = new Set(items.map((x) => x.id));
  const id = uniqueId(slugScadenza(titolo), ids);
  const cat = CATEGORIE[categoria] ? categoria : "personale";
  return {
    id,
    titolo: titolo.trim(),
    categoria: cat,
    scadenza: scadenza || null,
    ricorrenza: RICORRENZA_MESI[ricorrenza] ? ricorrenza : null,
    preavviso_giorni: preavvisoGiorni(preavviso),
    stato: "attiva",
    priorita: PRIORITA_EMOJI[priorita] ? priorita : "media",
    note: "Aggiunta da app.",
    documento: null,
    azione: "",
    orario_notifica: orario || null,
    notificato: null,
  };
}

export function newAppunto(testo, appunti) {
  const ids = new Set(appunti.map((a) => a.id));
  const id = uniqueId(slugAppunto(testo), ids);
  return {
    id,
    testo: testo.trim(),
    data: new Date().toISOString(),
    tag: [],
    fonte: "app",
    stato: "attivo",
    rifinito: false, // il PC lo rifinirà (tag/dedup), come le note da Telegram
  };
}

export function newSpesa(testo, voci) {
  const ids = new Set(voci.map((v) => v.id));
  const id = uniqueId(slugAppunto(testo), ids);
  return {
    id,
    testo: testo.trim(),
    data: new Date().toISOString(),
    fonte: "app",
    stato: "da-comprare",
  };
}

// --- completamento scadenza (la regola chiave) -----------------------------
// Replica esatta di cloud_inbox.complete_scadenza:
//   ricorrente → avanza `scadenza` di RICORRENZA_MESI, `notificato=null`, RESTA;
//   una-tantum → da rimuovere.
// Ritorna { action: "update" | "remove", item }. Non muta l'originale.
export function completeScadenza(item, today = todayYMD()) {
  if (item.ricorrenza) {
    const eff = effectiveDate(item, today);
    const step = RICORRENZA_MESI[item.ricorrenza];
    const prossima = (eff && step) ? addMonths(eff, step) : eff;
    const updated = { ...item };
    if (prossima) updated.scadenza = toISODate(prossima);
    updated.notificato = null;
    return { action: "update", item: updated };
  }
  return { action: "remove", item };
}
