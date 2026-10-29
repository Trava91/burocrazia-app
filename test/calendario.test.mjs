// calendario.test.mjs — test della logica pura di calendario.js.
//
// Valori attesi presi da turni.py / agenda.py (repo scadenzario) e da un conto
// indipendente con le regole di ricostruisci_turni.py + scheda colleghi, così
// questo file verifica che il porting JS resti FEDELE al contratto.
//
// Come lanciarlo:  node test/calendario.test.mjs

import { readFileSync } from "node:fs";
import * as c from "../js/calendario.js";

let pass = 0, fail = 0;
function eq(name, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}\n   atteso: ${e}\n   avuto:  ${g}`); }
}

// turni.json reale (senza eccezioni: verifica il solo ciclo)
const base = JSON.parse(readFileSync(new URL("../../scadenzario/turni.json", import.meta.url), "utf8"));
const turni = JSON.parse(JSON.stringify(base));
for (const p of Object.values(turni.persone)) p.eccezioni = {};

// --- date ---
eq("weekday 2026-10-14 = mercoledì", c.weekday("2026-10-14"), 2);
eq("addDays attraversa il mese", c.addDays("2026-10-31", 1), "2026-11-01");
eq("griglia ottobre 2026 parte lun 28/09", c.grigliaMese(2026, 10)[0], "2026-09-28");
eq("griglia ottobre 2026 finisce dom 08/11", c.grigliaMese(2026, 10)[41], "2026-11-08");

// --- ciclo Nicolò = ricostruisci_turni.py (M M M L P P P L L, ancora 1/7/2026) ---
const CICLO = ["M", "M", "M", "L", "P", "P", "P", "L", "L"];
let ok = true;
for (let g = "2026-01-01"; g <= "2027-12-31"; g = c.addDays(g, 1)) {
  const atteso = CICLO[((c.diffDays(g, "2026-07-01") % 9) + 9) % 9];
  if (c.turniDelGiorno(turni, "nicolo", g)[0].tipo !== atteso) { ok = false; break; }
}
eq("ciclo Nicolò 2026-2027 = ricostruisci_turni.py", ok, true);
eq("19/10/2026 nel ciclo = M", c.turniDelGiorno(turni, "nicolo", "2026-10-19")[0].tipo, "M");
eq("06/11/2026 nel ciclo = M", c.turniDelGiorno(turni, "nicolo", "2026-11-06")[0].tipo, "M");
eq("descrizione 14/10/2026", c.descriviGiorno(turni, "nicolo", "2026-10-14"), "Pome 16-24");

// --- ciclo Valentina (a settimane, all'indietro, domenica riposo) ---
eq("Valentina 12/10 = notti", c.turniDelGiorno(turni, "valentina", "2026-10-12")[0].tipo, "V0");
eq("Valentina 18/10 = riposo", c.turniDelGiorno(turni, "valentina", "2026-10-18")[0].tipo, "R");
eq("Valentina 19/10 = sera", c.turniDelGiorno(turni, "valentina", "2026-10-19")[0].tipo, "V18");
eq("Valentina 26/10 = pome", c.turniDelGiorno(turni, "valentina", "2026-10-26")[0].tipo, "V12");
eq("Valentina 02/11 = matt", c.turniDelGiorno(turni, "valentina", "2026-11-02")[0].tipo, "V6");
eq("Valentina 09/11 = notti", c.turniDelGiorno(turni, "valentina", "2026-11-09")[0].tipo, "V0");

// --- eccezioni ---
let pers = c.setTurno(turni.persone, "nicolo", "2026-10-19", [{ tipo: "G" }]);
pers = c.setTurno(pers, "nicolo", "2026-11-06", [{ tipo: "M" }, { tipo: "N" }]);
const t2 = { persone: pers };
eq("eccezione 19/10 = G", c.turniDelGiorno(t2, "nicolo", "2026-10-19").map((v) => v.tipo), ["G"]);
eq("due turni 06/11", c.descriviGiorno(t2, "nicolo", "2026-11-06"), "Matt 6-14 + Notte 22-6");
eq("setTurno uguale al ciclo toglie l'eccezione",
  c.setTurno(pers, "nicolo", "2026-10-19", [{ tipo: "M" }]).nicolo.eccezioni["2026-10-19"], undefined);
eq("torna al ciclo (null)", c.setTurno(pers, "nicolo", "2026-11-06", null).nicolo.eccezioni["2026-11-06"], undefined);
eq("giorno a metà", c.descriviGiorno({ persone: c.setTurno(turni.persone, "nicolo", "2026-10-14",
  [{ tipo: "P", ore: 6 }, { tipo: "P104", ore: 2 }]) }, "nicolo", "2026-10-14"), "Pome 6 h + 104 2 h");

// periodo di ferie: solo i giorni di lavoro, i riposi restano riposi
const per = c.modifichePeriodo(turni, "nicolo", "2026-10-12", "2026-10-18", "F");
eq("ferie 12-18/10 saltano i Liberi (15, 16)", Object.keys(per),
  ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-17", "2026-10-18"]);

// --- festività ---
eq("Pasqua 2026", c.pasqua(2026), "2026-04-05");
eq("Pasqua 2027", c.pasqua(2027), "2027-03-28");
eq("Pasqua 2030", c.pasqua(2030), "2030-04-21");
eq("Pasquetta 2027", c.nomeFestivita("2027-03-29"), "Pasquetta");
eq("Ognissanti", c.nomeFestivita("2026-11-01"), "Ognissanti");
eq("giorno normale", c.nomeFestivita("2026-10-14"), null);
eq("San Francesco dal 2026 (legge 151/2025)", [c.nomeFestivita("2026-10-04"), c.nomeFestivita("2025-10-04")], ["San Francesco", null]);

// --- conflitti (calco di turni.conflitto) ---
eq("visita 16:45 di Pome = conflitto", c.conflitto(turni, { data: "2026-10-14", ora: "16:45" }), "P");
eq("visita 11:00 di Pome = libero", c.conflitto(turni, { data: "2026-10-14", ora: "11:00" }), null);
eq("visita 16:45 di Matt = libero", c.conflitto(turni, { data: "2026-10-08", ora: "16:45" }), null);
eq("visita 07:00 di Matt = conflitto", c.conflitto(turni, { data: "2026-10-08", ora: "07:00" }), "M");
eq("tutto il giorno = mai conflitto", c.conflitto(turni, { data: "2026-10-14", ora: null }), null);
eq("03:00 dopo una Notte = conflitto", c.conflitto(t2, { data: "2026-11-07", ora: "03:00" }), "N");
eq("23:00 di Pome = conflitto", c.conflitto(turni, { data: "2026-10-14", ora: "23:00" }), "P");
eq("00:30 dopo un Pome = libero", c.conflitto(turni, { data: "2026-10-15", ora: "00:30" }), null);

// --- appuntamenti ---
const app = c.newAppuntamento({ titolo: "Visita medica", data: "2026-10-15", ora: "16:45" }, []);
eq("nuovo appuntamento: id e avviso default", [app.id, app.avviso_min, app.fonte], ["visita-medica", 60, "app"]);
eq("id duplicato → -2", c.newAppuntamento({ titolo: "Visita medica", data: "2026-10-16" }, [app]).id, "visita-medica-2");
eq("tutto il giorno: niente avviso", c.newAppuntamento({ titolo: "Pisa", data: "2026-10-18", avviso_min: 60 }, []).avviso_min, null);
eq("avviso 16:45 − 60' → 15:30", c.momentoAvviso(app), { data: "2026-10-15", ora: "15:30" });
eq("avviso 11:00 − 120' → 09:00", c.momentoAvviso({ data: "2026-10-15", ora: "11:00", avviso_min: 120 }), { data: "2026-10-15", ora: "09:00" });
eq("avviso 00:30 − 60' → giorno prima 23:30", c.momentoAvviso({ data: "2026-10-15", ora: "00:30", avviso_min: 60 }), { data: "2026-10-14", ora: "23:30" });
eq("ordine: tutto il giorno prima",
  c.appuntamentiDelGiorno([{ data: "x", ora: "09:00", titolo: "b" }, { data: "x", ora: null, titolo: "a" }], "x").map((a) => a.titolo),
  ["a", "b"]);

// --- di chi è (app di Valentina) ---
eq("default chi = nicolo", [app.chi, c.diChi({})], ["nicolo", "nicolo"]);
eq("chiavi come agenda.nuovo (Python)", Object.keys(app).join(","),
  "id,titolo,chi,data,ora,fine,luogo,note,documento,avviso_min,notificato,fonte,rifinito");
const lista = [{ titolo: "mio", chi: "nicolo" }, { titolo: "suo", chi: "valentina" }, { titolo: "noi", chi: "entrambi" }, { titolo: "vecchio" }];
eq("Nicolò vede suoi + coppia", lista.filter((a) => c.visibile(a, "nicolo")).map((a) => a.titolo), ["mio", "noi", "vecchio"]);
eq("Valentina vede suoi + coppia", lista.filter((a) => c.visibile(a, "valentina")).map((a) => a.titolo), ["suo", "noi"]);
// 14/10/2026: Nicolò Pome 16-24, Valentina Notte 0-6
eq("conflitto suo alle 3:00 (sua notte)", c.conflittoApp(turni, { data: "2026-10-14", ora: "03:00", chi: "valentina" }), { pid: "valentina", tipo: "V0" });
eq("conflitto mio alle 3:00 = nessuno", c.conflittoApp(turni, { data: "2026-10-14", ora: "03:00", chi: "nicolo" }), null);
eq("di coppia alle 17:00 → il mio Pome", c.conflittoApp(turni, { data: "2026-10-14", ora: "17:00", chi: "entrambi" }), { pid: "nicolo", tipo: "P" });
eq("riepilogo Valentina: solo impegni suoi e di coppia",
  c.riepilogoMese(turni, "valentina", 2026, 10, { agenda: [{ data: "2026-10-20", titolo: "mio" }, { data: "2026-10-21", titolo: "noi", chi: "entrambi" }] })
    .impegni.map((x) => x.testo), ["noi"]);

// --- casella ---
const idxApp = c.indiceAppuntamenti([{ data: "2026-10-14", ora: "16:45", titolo: "Visita" }]);
const cas = c.contenutoCasella({ turni, pid: "nicolo", iso: "2026-10-14", idxApp, idxScad: new Map() });
eq("casella: testo + conflitto", [cas.testo, cas.conflitto, cas.bande[0].nome], ["16:45 Visita", true, "Pome"]);

// --- riepilogo (conto indipendente con le regole della scheda) ---
function busta(r) { return Object.fromEntries(r.busta.map((x) => [x.codice + " " + x.voce, x.valore])); }
const set = c.riepilogoMese(turni, "nicolo", 2026, 9);
eq("settembre: conteggi", set.conteggi.map((x) => [x.codice, x.giorni]), [["M", 11], ["P", 9], ["L", 10]]);
eq("settembre: notte/domenica/turno/buoni", [busta(set)["43VI Ore di notte"], busta(set)["51T Ore di domenica"],
  busta(set)["44E Giorni a turno"], busta(set)["412 Buoni pasto"]], [18, 24, 20, 20]);
eq("settembre: monte ore", set.monteOre, { monte: 176, coperte: 160, diff: -16 });
const ott = c.riepilogoMese(turni, "nicolo", 2026, 10);
eq("ottobre: notte/domenica/turno", [busta(ott)["43VI Ore di notte"], busta(ott)["51T Ore di domenica"], busta(ott)["44E Giorni a turno"]], [20, 16, 21]);
eq("ottobre: 4/10 Pome di San Francesco = festa lavorata", busta(ott)["S50I/S60I Feste lavorate"], 8);
// il 4/10 di San Francesco lavorato è straordinario: non copre il monte (come ricostruisci_turni.py e INAZ)
eq("ottobre: monte ore", ott.monteOre, { monte: 176, coperte: 160, diff: -16 });
const nov = c.riepilogoMese(turni, "nicolo", 2026, 11);
eq("novembre: 1/11 Pome di festa → FL, niente notte", [busta(nov)["43VI Ore di notte"], busta(nov)["S50I/S60I Feste lavorate"], busta(nov)["51T Ore di domenica"]], [18, 8, 32]);
// San Martino (11/11, mercoledì) è festa in azienda: copre 8 h come le feste infrasettimanali
eq("novembre: monte ore (San Martino copre 8 h)", nov.monteOre, { monte: 168, coperte: 152, diff: -16 });
eq("San Martino non è tra le feste nazionali", c.nomeFestivita("2026-11-11"), null);
// regola HR (28/10/2026): la notte conta nel giorno in cui inizia → dom→lun 8 h di 51T, sab→dom 0
const notti = { persone: c.applicaTurni(turni.persone, "nicolo", { "2026-11-07": [{ tipo: "N" }], "2026-11-29": [{ tipo: "N" }] }) };
eq("Notte di sab 7/11 = 0 h di domenica, Notte di dom 29/11 = 8 h",
  busta(c.riepilogoMese(notti, "nicolo", 2026, 11))["51T Ore di domenica"], 40);
const ferie = { persone: c.applicaTurni(turni.persone, "nicolo", per) };
const ottF = c.riepilogoMese(ferie, "nicolo", 2026, 10);
eq("ferie 5 giorni = 40 h in 9FFI", busta(ottF)["9FFI Ferie"], 40);
const val = c.riepilogoMese(turni, "valentina", 2026, 10);
eq("Valentina: niente voci da busta", [val.busta, val.monteOre], [null, null]);
eq("Valentina ottobre: ore lavorate (27 gg × 6)", val.oreLavorate, 162);

// --- sequenza dalle impostazioni ---
eq("parseSequenza", c.parseSequenza("M M M L P P P L L", turni.persone.nicolo.tipi).length, 9);
let err = null;
try { c.parseSequenza("M X", turni.persone.nicolo.tipi); } catch (e) { err = e.message; }
eq("parseSequenza codice ignoto", err, "Codici sconosciuti: X");

console.log(`\n${pass} ok, ${fail} falliti`);
if (fail) process.exit(1);
