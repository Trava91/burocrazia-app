// conti.js — logica pura dei conti di coppia (scheda 💶 Conti): importi, saldo,
// quote, categoria indovinata dal titolo, riepilogo del mese.
//
// Porting fedele di scadenzario/conti.py: lo schema di conti.json e
// categorie-conti.json e queste regole sono il CONTRATTO tra i due lati.
// Se cambia qualcosa qui va cambiato anche lì (test_conti.py li confronta).
// Importi sempre in centesimi interi: niente virgola mobile nei conti.

export const PERSONE = { nicolo: "Nicolò", valentina: "Valentina" };
export const DIVISIONI = ["meta", "tutto"];

const has = (o, k) => o != null && k != null && Object.prototype.hasOwnProperty.call(o, k);

// --- importi -----------------------------------------------------------------
/** "12,50" / "12.5" / "1.234,50" / "12 €" → centesimi (intero > 0), altrimenti null.
 *  L'ultimo separatore è quello dei decimali; dal terzo decimale si arrotonda. */
export function parseImporto(s) {
  let t = String(s ?? "").replace(/[\s€]/g, "").replace(/,/g, ".");
  if ((t.match(/\./g) || []).length > 1) {
    const i = t.lastIndexOf(".");
    t = t.slice(0, i).replace(/\./g, "") + "." + t.slice(i + 1);
  }
  const m = /^([0-9]*)(?:\.([0-9]*))?$/.exec(t);
  if (!m || !(m[1] || m[2])) return null;
  const dec = m[2] || "";
  let cent = Number(m[1] || 0) * 100 + Number((dec + "00").slice(0, 2));
  if (dec.length > 2 && dec[2] >= "5") cent += 1;
  return cent > 0 ? cent : null;
}

/** 1234567 → "12.345,67 €" */
export function fmtEuro(cent) {
  const segno = cent < 0 ? "-" : "";
  const a = Math.abs(Math.trunc(cent));
  const e = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${segno}${e},${String(a % 100).padStart(2, "0")} €`;
}

// --- regole del saldo --------------------------------------------------------
export const altro = (pid) => (pid === "nicolo" ? "valentina" : "nicolo");

/** Quanto deve a chi ha pagato l'altra persona: metà (per difetto) o tutto. */
export function debito(m) {
  const a = Math.trunc(m.importo_cent);
  return m.divisione === "tutto" ? a : Math.floor(a / 2);
}

/** La parte della spesa a carico di pid. */
export function quota(m, pid) {
  const d = debito(m);
  return m.pagato_da === pid ? Math.trunc(m.importo_cent) - d : d;
}

/** > 0: l'altra persona deve a pid; < 0: pid deve all'altra. */
export function saldo(movimenti, pid = "nicolo") {
  let tot = 0;
  for (const m of movimenti || []) {
    const d = debito(m);
    tot += m.pagato_da === pid ? d : -d;
  }
  return tot;
}

/** Effetto di un movimento sul saldo di pid (+ = l'altro ti deve di più). */
export function effetto(m, pid) {
  return m.pagato_da === pid ? debito(m) : -debito(m);
}

// --- categorie ---------------------------------------------------------------
/** minuscole, senza accenti, solo lettere e cifre separate da uno spazio */
export function norm(s) {
  return String(s ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function trasferimenti(diz) {
  return new Set(Object.entries(diz?.categorie || {}).filter(([, c]) => c.trasferimento).map(([k]) => k));
}

/** id della categoria "soldi tra voi" (per il pulsante Salda) */
export function categoriaSoldi(diz) {
  return [...trasferimenti(diz)][0] || null;
}

/** Categoria dal titolo. 1) storico: l'ultima spesa con lo stesso titolo già
 *  classificata; 2) parole: una parola del dizionario come inizio di parola del
 *  titolo, vince la più lunga (a pari lunghezza la prima). null = non lo so. */
export function indovina(titolo, movimenti, diz) {
  const t = norm(titolo);
  if (!t) return null;
  const cats = diz?.categorie || {};
  let best = null;
  for (const m of movimenti || []) {
    if (has(cats, m.categoria) && norm(m.titolo) === t) {
      const k = [m.data || "", m.creata || ""];
      if (!best || k[0] > best.k[0] || (k[0] === best.k[0] && k[1] >= best.k[1])) best = { k, cat: m.categoria };
    }
  }
  if (best) return { categoria: best.cat, come: "storico", parola: null };
  const padded = " " + t + " ";
  let trovata = null;
  for (const [parola, cat] of Object.entries(diz?.parole || {})) {
    const p = norm(parola);
    if (p && has(cats, cat) && padded.includes(" " + p) && (!trovata || p.length > trovata.p.length)) {
      trovata = { p, cat };
    }
  }
  return trovata ? { categoria: trovata.cat, come: "parola", parola: trovata.p } : null;
}

/** Spese del mese ("AAAA-MM") per categoria: totale e parte di pid. I soldi
 *  passati tra voi (categoria trasferimento) stanno a parte. */
export function riepilogo(movimenti, mese, pid, diz) {
  const cats = diz?.categorie || {};
  const trasf = trasferimenti(diz);
  const ordine = Object.keys(cats);
  const per = new Map();
  const out = { mese, n: 0, totale: 0, mia: 0, categorie: [], da_classificare: 0, soldi_dati: 0, soldi_ricevuti: 0 };
  for (const m of movimenti || []) {
    if (!String(m.data || "").startsWith(mese)) continue;
    const cat = has(cats, m.categoria) ? m.categoria : null;
    if (trasf.has(cat)) {
      out[m.pagato_da === pid ? "soldi_dati" : "soldi_ricevuti"] += debito(m);
      continue;
    }
    const a = Math.trunc(m.importo_cent), q = quota(m, pid);
    out.n += 1; out.totale += a; out.mia += q;
    if (cat === null) out.da_classificare += 1;
    if (!per.has(cat)) per.set(cat, { categoria: cat, n: 0, totale: 0, mia: 0 });
    const r = per.get(cat);
    r.n += 1; r.totale += a; r.mia += q;
  }
  const idx = (c) => (c === null ? 0 : ordine.indexOf(c));
  out.categorie = [...per.values()].sort((a, b) =>
    (a.categoria === null) - (b.categoria === null) || b.totale - a.totale || idx(a.categoria) - idx(b.categoria));
  return out;
}

// --- nuovi movimenti ---------------------------------------------------------
const p2 = (n) => String(n).padStart(2, "0");
export const oggiIso = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export function nuovoId(now = new Date()) {
  const suf = Math.random().toString(36).slice(2, 5).padEnd(3, "0");
  return `m-${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}-${suf}`;
}

export function nuovoMovimento({ titolo, importo_cent, pagato_da, divisione, data, categoria, categoria_auto }, now = new Date()) {
  return {
    id: nuovoId(now),
    data: data || oggiIso(now),
    titolo: String(titolo || "").trim(),
    importo_cent: Math.trunc(importo_cent),
    pagato_da: has(PERSONE, pagato_da) ? pagato_da : "nicolo",
    divisione: DIVISIONI.includes(divisione) ? divisione : "meta",
    categoria: categoria || null,
    categoria_auto: Boolean(categoria) && Boolean(categoria_auto),
    creata: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    fonte: "app",
  };
}
