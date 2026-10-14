// calendario.js — logica PURA del calendario (turni, festività, conflitti,
// appuntamenti, riepilogo del mese). Niente DOM qui: il rendering sta in cal-ui.js.
//
// Porting di turni.py e agenda.py (repo scadenzario): lo schema di turni.json
// e agenda.json è il CONTRATTO tra i due lati. Se cambia un campo, aggiornare
// entrambi (vedi contesto.md dell'app).
//
// Le date viaggiano come stringhe ISO "YYYY-MM-DD"; i conti si fanno in giorni
// UTC, così niente sorprese da fuso orario o ora legale.

import { slugAppunto, effectiveDate, toISODate, todayYMD } from "./model.js";

// --- date ------------------------------------------------------------------
const MS_DAY = 86400000;

export function isoToDays(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
}
export function daysToIso(n) {
  const dt = new Date(n * MS_DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
export const addDays = (iso, n) => daysToIso(isoToDays(iso) + n);
export const diffDays = (a, b) => isoToDays(a) - isoToDays(b);
/** 0 = lunedì … 6 = domenica */
export function weekday(iso) {
  return (new Date(isoToDays(iso) * MS_DAY).getUTCDay() + 6) % 7;
}
export function todayIso(now = new Date()) {
  return toISODate(todayYMD(now));
}
export const isoOf = (y, m, d) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
export const GIORNI_BREVI = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];

function minuti(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "06:00" → "6", "16:45" → "16:45", "24:00" → "24" (come turni.fmt_ora_breve) */
export function oraBreve(hhmm) {
  const [h, m] = hhmm.split(":");
  return m === "00" ? String(Number(h)) : `${Number(h)}:${m}`;
}

// --- turni: ciclo + eccezioni (calco di turni.py) ---------------------------
export function turnoCiclo(persona, iso) {
  const seq = persona.ciclo.sequenza;
  const diff = diffDays(iso, persona.ciclo.ancora);
  return seq[((diff % seq.length) + seq.length) % seq.length];
}

/** [{tipo, ore?, ciclo}] del giorno: l'eccezione se c'è, altrimenti il ciclo. */
export function turniDelGiorno(turni, pid, iso) {
  const p = turni?.persone?.[pid];
  if (!p) return [];
  const ecc = p.eccezioni?.[iso];
  if (ecc && ecc.length) return ecc.map((v) => ({ ...v, ciclo: false }));
  return [{ tipo: turnoCiclo(p, iso), ciclo: true }];
}

export function tipoDef(turni, pid, codice) {
  return turni?.persone?.[pid]?.tipi?.[codice]
    || { nome: codice, categoria: "riposo", ore: 0, colore: "#E0E0E0" };
}

export function oreVoce(turni, pid, voce) {
  const t = tipoDef(turni, pid, voce.tipo);
  return voce.ore !== undefined && voce.ore !== null ? Number(voce.ore) : (t.ore || 0);
}

export function descriviVoce(turni, pid, voce) {
  const t = tipoDef(turni, pid, voce.tipo);
  let s = t.nome || voce.tipo;
  const ore = voce.ore !== undefined && voce.ore !== null;
  if (t.categoria === "turno" && t.inizio && t.fine) {
    s += ore ? ` ${voce.ore} h` : ` ${oraBreve(t.inizio)}-${oraBreve(t.fine)}`;
  } else if (ore && t.categoria === "assenza") {
    s += ` ${voce.ore} h`;
  }
  return s;
}

export function descriviGiorno(turni, pid, iso) {
  return turniDelGiorno(turni, pid, iso).map((v) => descriviVoce(turni, pid, v)).join(" + ");
}

// --- festività nazionali (calco di turni.festivita) -------------------------
export function pasqua(anno) {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return isoOf(anno, mese, giorno);
}

const FESTE_FISSE = [
  [1, 1, "Capodanno"], [1, 6, "Epifania"], [4, 25, "Liberazione"],
  [5, 1, "Festa del lavoro"], [6, 2, "Festa della Repubblica"],
  [8, 15, "Ferragosto"], [11, 1, "Ognissanti"], [12, 8, "Immacolata"],
  [12, 25, "Natale"], [12, 26, "Santo Stefano"],
];
const _festeCache = new Map();
/** Map iso → nome della festività, per un anno. */
export function festivita(anno) {
  if (_festeCache.has(anno)) return _festeCache.get(anno);
  const out = new Map(FESTE_FISSE.map(([m, d, n]) => [isoOf(anno, m, d), n]));
  const p = pasqua(anno);
  out.set(p, "Pasqua");
  out.set(addDays(p, 1), "Pasquetta");
  _festeCache.set(anno, out);
  return out;
}
export function nomeFestivita(iso) {
  return festivita(Number(iso.slice(0, 4))).get(iso) || null;
}

// --- orari di lavoro e conflitti -------------------------------------------
/** [{ini, fin, tipo}] in minuti dalla mezzanotte del giorno, compresa la coda
 *  della Notte del giorno prima (calco di turni.intervalli_lavoro). */
export function intervalliLavoro(turni, pid, iso) {
  const out = [];
  for (const [offset, g] of [[0, iso], [-1440, addDays(iso, -1)]]) {
    for (const v of turniDelGiorno(turni, pid, g)) {
      const t = tipoDef(turni, pid, v.tipo);
      if (t.categoria !== "turno" || !t.inizio || !t.fine) continue;
      let ini = minuti(t.inizio), fin = minuti(t.fine);
      if (fin <= ini) fin += 1440;
      if (v.ore !== undefined && v.ore !== null) fin = ini + Math.round(Number(v.ore) * 60);
      ini += offset; fin += offset;
      if (fin > 0) out.push({ ini: offset ? Math.max(ini, 0) : ini, fin, tipo: v.tipo });
    }
  }
  return out;
}

/** Codice del turno in cui cade l'appuntamento (solo quelli con ora), o null. */
export function conflitto(turni, app, pid = "nicolo") {
  if (!app?.ora || !app?.data || !turni?.persone?.[pid]) return null;
  const t = minuti(app.ora);
  for (const iv of intervalliLavoro(turni, pid, app.data)) {
    if (iv.ini <= t && t < iv.fin) return iv.tipo;
  }
  return null;
}

// --- appuntamenti (calco di agenda.py) -------------------------------------
export const AVVISO_DEFAULT_MIN = 60;

export function appuntamentiDelGiorno(items, iso) {
  return (items || [])
    .filter((a) => a.data === iso)
    .sort((a, b) => (a.ora ? 1 : 0) - (b.ora ? 1 : 0) || (a.ora || "").localeCompare(b.ora || ""));
}

/** Indice iso → [appuntamenti] per un render veloce del mese. */
export function indiceAppuntamenti(items) {
  const m = new Map();
  for (const a of items || []) {
    if (!a.data) continue;
    if (!m.has(a.data)) m.set(a.data, []);
    m.get(a.data).push(a);
  }
  for (const [k, v] of m) m.set(k, appuntamentiDelGiorno(v, k));
  return m;
}

/** Indice iso → [scadenze attive] alla loro data effettiva (le ricorrenti
 *  alla prossima occorrenza, come nella lista Scadenze). */
export function indiceScadenze(items, today = todayYMD()) {
  const m = new Map();
  for (const it of items || []) {
    if (it.stato === "fatta") continue;
    const eff = effectiveDate(it, today);
    if (!eff) continue;
    const iso = toISODate(eff);
    if (!m.has(iso)) m.set(iso, []);
    m.get(iso).push(it);
  }
  return m;
}

export function etichettaAppuntamento(a) {
  return a.ora ? `${a.ora} ${a.titolo}` : a.titolo;
}

/** Nuovo appuntamento con lo schema completo (stessi id di agenda._new_id). */
export function newAppuntamento({ titolo, data, ora, fine, luogo, note, avviso_min }, items) {
  const ids = new Set((items || []).map((a) => a.id));
  const base = slugAppunto(titolo);
  let id = base, n = 2;
  while (ids.has(id)) { id = `${base}-${n}`; n++; }
  const conOra = Boolean(ora);
  let avviso = avviso_min === undefined ? (conOra ? AVVISO_DEFAULT_MIN : null) : avviso_min;
  if (!conOra) avviso = null;
  return {
    id,
    titolo: titolo.trim(),
    data,
    ora: ora || null,
    fine: fine || null,
    luogo: luogo || null,
    note: note || "",
    documento: null,
    avviso_min: avviso,
    notificato: null,
    fonte: "app",
    rifinito: true,
  };
}

/** Momento dell'avviso (Date) arrotondato in giù a 30 min, come agenda.momento_avviso. */
export function momentoAvviso(a, cadenza = 30) {
  if (!a?.ora || !a?.data || a.avviso_min === null || a.avviso_min === undefined) return null;
  const tot = minuti(a.ora) - Number(a.avviso_min);
  const giorno = addDays(a.data, Math.floor(tot / 1440));
  const m = ((tot % 1440) + 1440) % 1440;
  const f = Math.floor(m / cadenza) * cadenza;
  return { data: giorno, ora: `${String(Math.floor(f / 60)).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}` };
}

// --- mutazioni pure dei turni ----------------------------------------------
// Lavorano su `persone` (la chiave di turni.json) e ne ritornano una copia.
function clonePersone(persone) { return JSON.parse(JSON.stringify(persone)); }

/** voci = [{tipo, ore?}] oppure null = torna al ciclo. Se le voci coincidono
 *  col ciclo l'eccezione viene tolta (niente eccezioni inutili). */
export function setTurno(persone, pid, iso, voci) {
  const out = clonePersone(persone);
  const p = out[pid];
  if (!p) return out;
  p.eccezioni = p.eccezioni || {};
  const pulite = (voci || []).map((v) => {
    const x = { tipo: v.tipo };
    if (v.ore !== undefined && v.ore !== null && v.ore !== "") x.ore = Number(v.ore);
    return x;
  });
  const uguale = pulite.length === 1 && pulite[0].ore === undefined && pulite[0].tipo === turnoCiclo(p, iso);
  if (!pulite.length || uguale) delete p.eccezioni[iso];
  else p.eccezioni[iso] = pulite;
  return out;
}

/** Applica un blocco di modifiche { iso: voci | null } (pennello). */
export function applicaTurni(persone, pid, modifiche) {
  let out = persone;
  for (const [iso, voci] of Object.entries(modifiche)) out = setTurno(out, pid, iso, voci);
  return out;
}

/** Periodo da `da` ad `a` (inclusi). Con un tipo di assenza (ferie, 104…) tocca
 *  solo i giorni in cui si lavora: i riposi del ciclo restano riposi. */
export function modifichePeriodo(turni, pid, da, a, codice) {
  const [ini, fin] = da <= a ? [da, a] : [a, da];
  const cat = tipoDef(turni, pid, codice).categoria;
  const mod = {};
  for (let g = ini; g <= fin; g = addDays(g, 1)) {
    if (cat === "assenza") {
      const lavora = turniDelGiorno(turni, pid, g)
        .some((v) => tipoDef(turni, pid, v.tipo).categoria === "turno");
      if (!lavora) continue;
    }
    mod[g] = codice === null ? null : [{ tipo: codice }];
  }
  return mod;
}

// --- griglia del mese ------------------------------------------------------
/** 42 giorni (6 settimane) da lunedì, come Shifter: con i giorni dei mesi vicini. */
export function grigliaMese(y, m) {
  const primo = isoOf(y, m, 1);
  const start = addDays(primo, -weekday(primo));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Contenuto di una casella "come Shifter": fasce di colore dei turni, testo
 *  del primo impegno (o il nome del turno), icone. */
export function contenutoCasella({ turni, pid, iso, idxApp, idxScad, conflittoPid = "nicolo" }) {
  const voci = turniDelGiorno(turni, pid, iso);
  const bande = voci.map((v) => {
    const t = tipoDef(turni, pid, v.tipo);
    return { tipo: v.tipo, nome: t.nome || v.tipo, colore: t.colore || "#E0E0E0", testo: t.testo || null, ciclo: v.ciclo };
  });
  const apps = idxApp?.get(iso) || [];
  const scad = idxScad?.get(iso) || [];
  let testo = null;
  if (apps.length) testo = etichettaAppuntamento(apps[0]);
  else if (scad.length) testo = scad[0].titolo;
  const conflitti = apps.filter((a) => conflitto(turni, a, conflittoPid));
  return {
    bande,
    testo,
    nApp: apps.length,
    nScad: scad.length,
    conflitto: conflitti.length > 0,
    festivo: nomeFestivita(iso),
  };
}

// --- riepilogo del mese ------------------------------------------------------
// Regole della scheda "Controllo busta paga – turni laboratorio"
// (01-lavoro/buste-paga/scheda-colleghi) e di ricostruisci_turni.py.
export const REGOLE = {
  "laboratorio-kastamonu": {
    giorniTurno: ["M", "P", "N"],      // 44E: la G non conta
    domenicale: ["M", "P"],           // 51T: ogni M o P di domenica
    assenze: [                        // ore di assenza → voce in busta
      { tipo: "F", voce: "Ferie", codice: "9FFI" },
      { tipo: "B", voce: "Banca ore", codice: "9BBI" },
      { tipo: "P104", voce: "Permessi 104", codice: "8O0I" },
      { tipo: "ROL", voce: "ROL", codice: "—" },
      { tipo: "MAL", voce: "Malattia", codice: "—" },
    ],
  },
};

/** Ore di un intervallo [ini, fin] (minuti) che cadono tra le 22 e le 6. */
function oreNotturne(ini, fin) {
  let tot = 0;
  for (const [a, b] of [[-120, 360], [1320, 1800], [2760, 3240]]) {
    tot += Math.max(0, Math.min(fin, b) - Math.max(ini, a));
  }
  return tot / 60;
}

export function riepilogoMese(turni, pid, y, m, { agenda = [], scadenze = [], today = todayYMD() } = {}) {
  const p = turni?.persone?.[pid];
  if (!p) return null;
  const regole = REGOLE[p.regole] || null;
  const conteggi = new Map(Object.keys(p.tipi).map((k) => [k, { giorni: 0, ore: 0 }]));
  let oreLavorate = 0, monte = 0, coperte = 0;
  const b = { buoni: 0, notte: 0, domenica: 0, giorniTurno: 0, festeLavorate: 0, assenze: {} };

  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = isoOf(y, m, d);
    const wd = weekday(iso);
    const festa = Boolean(nomeFestivita(iso));
    let lavorateGiorno = 0, assenzeGiorno = 0, aTurno = false;
    for (const v of turniDelGiorno(turni, pid, iso)) {
      const t = tipoDef(turni, pid, v.tipo);
      const ore = oreVoce(turni, pid, v);
      const c = conteggi.get(v.tipo) || { giorni: 0, ore: 0 };
      c.giorni += 1; c.ore += ore; conteggi.set(v.tipo, c);
      if (t.categoria === "turno") {
        lavorateGiorno += ore;
        if (regole) {
          if (regole.giorniTurno.includes(v.tipo)) aTurno = true;
          if (wd === 6 && regole.domenicale.includes(v.tipo)) b.domenica += ore;
          if (!festa && t.inizio) {
            const ini = minuti(t.inizio);
            b.notte += oreNotturne(ini, ini + ore * 60);
          }
        }
      } else if (t.categoria === "assenza") {
        assenzeGiorno += ore;
        b.assenze[v.tipo] = (b.assenze[v.tipo] || 0) + ore;
      }
    }
    oreLavorate += lavorateGiorno;
    if (regole) {
      if (lavorateGiorno >= 6) b.buoni += 1;
      if (aTurno) b.giorniTurno += 1;
      if (festa) b.festeLavorate += lavorateGiorno;
      if (wd < 5) monte += 8;
      // festività infrasettimanale = 8 h coperte; le ore lavorate di festa sono
      // straordinario e non coprono il monte (come ricostruisci_turni.py)
      if (festa) { if (wd < 5) coperte += 8; } else coperte += lavorateGiorno + assenzeGiorno;
    }
  }

  const listaConteggi = [...conteggi.entries()]
    .filter(([, c]) => c.giorni > 0)
    .map(([codice, c]) => {
      const t = tipoDef(turni, pid, codice);
      return { codice, nome: t.nome, colore: t.colore, testo: t.testo || null, giorni: c.giorni, ore: c.ore };
    });

  // impegni del mese: appuntamenti + scadenze, in ordine di data
  const pref = `${y}-${String(m).padStart(2, "0")}-`;
  const impegni = [];
  for (const a of agenda || []) {
    if (a.data?.startsWith(pref)) impegni.push({ data: a.data, ora: a.ora || "", tipo: "app", testo: a.titolo, id: a.id });
  }
  for (const [iso, list] of indiceScadenze(scadenze, today)) {
    if (!iso.startsWith(pref)) continue;
    for (const s of list) impegni.push({ data: iso, ora: s.orario_notifica || "", tipo: "scad", testo: s.titolo, id: s.id });
  }
  impegni.sort((a, b2) => a.data.localeCompare(b2.data) || a.ora.localeCompare(b2.ora));

  let busta = null, monteOre = null;
  if (regole) {
    busta = [
      { voce: "Buoni pasto", codice: "412", valore: b.buoni, unita: "gg" },
      { voce: "Ore di notte", codice: "43VI", valore: b.notte, unita: "h" },
      { voce: "Ore di domenica", codice: "51T", valore: b.domenica, unita: "h" },
      { voce: "Giorni a turno", codice: "44E", valore: b.giorniTurno, unita: "gg" },
      ...regole.assenze.map((x) => ({ voce: x.voce, codice: x.codice, valore: b.assenze[x.tipo] || 0, unita: "h" })),
      { voce: "Feste lavorate", codice: "S50I/S60I", valore: b.festeLavorate, unita: "h" },
    ];
    monteOre = { monte, coperte, diff: coperte - monte };
  }
  return { conteggi: listaConteggi, oreLavorate, monteOre, busta, impegni };
}

// --- ciclo dalle impostazioni ----------------------------------------------
/** "M M M L P P P L L" → ["M",…]; errore parlante se un codice non esiste. */
export function parseSequenza(testo, tipi) {
  const seq = String(testo || "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!seq.length) throw new Error("La sequenza è vuota.");
  const ignoti = seq.filter((c) => !tipi[c]);
  if (ignoti.length) throw new Error(`Codici sconosciuti: ${[...new Set(ignoti)].join(", ")}`);
  return seq;
}
