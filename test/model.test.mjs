// model.test.mjs — test della logica pura di model.js.
//
// Valori attesi presi dai motori Python reali (scadenzario.py / memoria.py /
// cloud_inbox.py) con today = 2026-06-27, così questo file verifica che il
// porting JS resti FEDELE al contratto.
//
// Come lanciarlo:
//   - Node:    node test/model.test.mjs
//   - Browser: <script type="module" src="test/model.test.mjs"></script> e leggi la console.

import * as m from "../js/model.js";

const TODAY = { y: 2026, m: 6, d: 27 };
let pass = 0, fail = 0;

function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}\n   atteso: ${e}\n   avuto:  ${g}`); }
}

// --- addMonths (clamping al fine mese) ---
eq("addMonths 2026-01-31 +1", m.toISODate(m.addMonths({ y: 2026, m: 1, d: 31 }, 1)), "2026-02-28");
eq("addMonths 2026-06-30 +12", m.toISODate(m.addMonths({ y: 2026, m: 6, d: 30 }, 12)), "2027-06-30");
eq("addMonths 2024-02-29 +12", m.toISODate(m.addMonths({ y: 2024, m: 2, d: 29 }, 12)), "2025-02-28");
eq("addMonths 2026-12-15 +3", m.toISODate(m.addMonths({ y: 2026, m: 12, d: 15 }, 3)), "2027-03-15");

// --- effectiveDate ---
eq("effDate ricorrente passata avanza",
  m.toISODate(m.effectiveDate({ scadenza: "2024-06-30", ricorrenza: "annuale" }, TODAY)), "2026-06-30");
eq("effDate una-tantum passata non avanza",
  m.toISODate(m.effectiveDate({ scadenza: "2020-01-01", ricorrenza: null }, TODAY)), "2020-01-01");
eq("effDate mensile",
  m.toISODate(m.effectiveDate({ scadenza: "2026-07-01", ricorrenza: "mensile" }, TODAY)), "2026-07-01");
eq("effDate senza data", m.effectiveDate({ scadenza: null }, TODAY), null);

// --- fmtGiorni ---
eq("fmt -3", m.fmtGiorni(-3), "SCADUTA da 3 gg");
eq("fmt 0", m.fmtGiorni(0), "OGGI");
eq("fmt 5", m.fmtGiorni(5), "tra 5 gg");
eq("fmt null", m.fmtGiorni(null), "data da definire");

// --- slug ---
eq("slugScadenza accenti/punteggiatura", m.slugScadenza("Bollo àuto 2026!"), "bollo-auto-2026");
eq("slugScadenza fallback", m.slugScadenza("!!!"), "voce");
eq("slugAppunto accenti", m.slugAppunto("Bollo àuto 2026!"), "bollo-auto-2026");
eq("slugAppunto troncamento 40",
  m.slugAppunto("Questa è una nota molto molto lunga che supera i quaranta caratteri di sicuro"),
  "questa-e-una-nota-molto-molto-lunga-che");
eq("slugAppunto fallback", m.slugAppunto("###"), "appunto");

// --- completeScadenza (la regola chiave) ---
const bollo = {
  id: "bollo-auto-fiesta", titolo: "Bollo auto Ford Fiesta", categoria: "personale",
  scadenza: "2027-06-30", ricorrenza: "annuale", preavviso_giorni: 30, stato: "attiva",
  priorita: "media", note: "x", documento: null, azione: "y",
};
const rc = m.completeScadenza(bollo, TODAY);
eq("complete ricorrente: action", rc.action, "update");
eq("complete ricorrente: scadenza avanzata", rc.item.scadenza, "2028-06-30");
eq("complete ricorrente: notificato null", rc.item.notificato, null);
eq("complete una-tantum: action",
  m.completeScadenza({ id: "x", titolo: "T", ricorrenza: null, scadenza: "2026-08-31", stato: "attiva" }, TODAY).action,
  "remove");

// --- newScadenza: schema completo + dedup id ---
const items = [{ id: "bollo-auto-fiesta" }];
const nv = m.newScadenza({ titolo: "Bollo auto Ford Fiesta", scadenza: "2027-01-01", categoria: "tasse", ricorrenza: "annuale", priorita: "alta" }, items);
eq("newScadenza dedup id", nv.id, "bollo-auto-fiesta-2");
eq("newScadenza schema chiavi",
  Object.keys(nv).join(","),
  "id,titolo,categoria,scadenza,ricorrenza,preavviso_giorni,stato,priorita,note,documento,azione");
eq("newScadenza default preavviso", nv.preavviso_giorni, 30);
eq("newScadenza categoria valida", nv.categoria, "tasse");
eq("newScadenza categoria fallback",
  m.newScadenza({ titolo: "z", categoria: "inesistente" }, []).categoria, "personale");

// --- newAppunto / newSpesa ---
const ap = m.newAppunto("Comprare sassi", []);
eq("newAppunto fonte app", ap.fonte, "app");
eq("newAppunto rifinito false", ap.rifinito, false);
eq("newAppunto stato attivo", ap.stato, "attivo");
const sp = m.newSpesa("latte", []);
eq("newSpesa stato da-comprare", sp.stato, "da-comprare");
eq("newSpesa fonte app", sp.fonte, "app");

// --- scadenzeView: gating ricorrenti lontane ---
const view = [
  { id: "rev", titolo: "Revisione", categoria: "personale", scadenza: "2027-05-31", ricorrenza: "biennale", preavviso_giorni: 60, stato: "attiva", priorita: "media" },
  { id: "cie", titolo: "CIE", categoria: "personale", scadenza: "2035-05-01", ricorrenza: null, preavviso_giorni: 60, stato: "attiva", priorita: "bassa" },
  { id: "fatta", titolo: "X", categoria: "personale", scadenza: "2026-07-01", ricorrenza: null, stato: "fatta", priorita: "media" },
];
eq("view default nasconde ricorrente-lontana", m.scadenzeView(view, TODAY, false).map((x) => x.id), ["cie"]);
eq("view tutte mostra anche ricorrente-lontana", m.scadenzeView(view, TODAY, true).map((x) => x.id).sort(), ["cie", "rev"]);

// --- esito ---
console.log(`\n${pass} PASS, ${fail} FAIL`);
if (typeof process !== "undefined" && fail > 0) process.exit(1);
