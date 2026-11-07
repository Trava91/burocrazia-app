// main.js — wiring: onboarding token, primo load, impostazioni, service worker.

import { Store, PROFILI } from "./store.js";
import { GitHubApi } from "./api.js";
import { UI, showToast, TAB_INVIA } from "./ui.js";
import { CalendarUI } from "./cal-ui.js";
import { ContiUI } from "./conti-ui.js";
import * as notifiche from "./notifiche.js";

const APP_VERSION = "1.4.0";
const PAT_URL = "https://github.com/settings/personal-access-tokens/new";

const $ = (s) => document.querySelector(s);

const store = new Store();
const ui = new UI(store);
const calUI = new CalendarUI(store, ui);
ui.cal = calUI;
const contiUI = new ContiUI(store, ui);
ui.conti = contiUI;
store.onChange(() => ui.renderAll());

// --- schermate -------------------------------------------------------------
function show(screen) {
  $("#onboarding").hidden = screen !== "onboarding";
  $("#app").hidden = screen !== "app";
  $("#settings").hidden = screen !== "settings";
}

function setFeedback(msg, cls = "") {
  const el = $("#onb-feedback");
  el.textContent = msg;
  el.className = "feedback" + (cls ? " " + cls : "");
}

// --- onboarding ------------------------------------------------------------
function fillOnboarding() {
  $("#onb-token").value = store.token || "";
  $("#onb-owner").value = store.owner || "";
  $("#onb-repo").value = store.repo || "";
  $("#onb-bot").value = store.bot || "";
  $("#onb-repo-label").textContent = store.repo || "scadenzario";
  $("#onb-pat-link").href = PAT_URL;
  setFeedback("");
}

async function onOnboardingSubmit(e) {
  e.preventDefault();
  const token = $("#onb-token").value.trim();
  const owner = $("#onb-owner").value.trim() || "Trava91";
  const repo = $("#onb-repo").value.trim() || "scadenzario";
  const bot = $("#onb-bot").value.trim();
  if (!token) { setFeedback("Inserisci il token.", "err"); return; }

  $("#onb-submit").disabled = true;
  setFeedback("Verifico il token…");
  try {
    const api = new GitHubApi({ owner, repo, token });
    await api.verify("scadenzario.json"); // prova di lettura
  } catch (err) {
    setFeedback(err?.message || "Verifica fallita.", "err");
    $("#onb-submit").disabled = false;
    return;
  }
  store.saveConfig({ token, owner, repo, bot });
  setFeedback("Token valido ✓", "ok");
  $("#onb-submit").disabled = false;
  await bootApp();
}

// --- app -------------------------------------------------------------------
let ultimoCaricamento = 0;

async function bootApp() {
  show("app");
  ui.refreshInviaLinks();
  $("#spinner").hidden = false;
  ultimoCaricamento = Date.now();
  try {
    await store.load();
    notifiche.controlla(store)
      .then((stato) => { contiUI.notifiche = stato; contiUI.render(); })
      .catch(() => { /* senza rete riprova al prossimo avvio */ });
  } catch (err) {
    showToast(err?.message || "Caricamento fallito.", "err");
    // token non valido → torna all'onboarding così può correggerlo
    if (err?.kind === "auth") { fillOnboarding(); show("onboarding"); }
  } finally {
    $("#spinner").hidden = true;
  }
}

// App riaperta dal telefono (era in background): ricarica i dati, al massimo
// ogni 30 secondi. Prima i dati si leggevano solo all'avvio, quindi le spese
// segnate dall'altro telefono non si vedevano fino a una chiusura completa.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !store.hasToken() || $("#app").hidden) return;
  if (Date.now() - ultimoCaricamento < 30000) return;
  ultimoCaricamento = Date.now();
  store.ricarica().catch(() => { /* resta la vista di prima; il pulsante Riprova è nei Conti */ });
  // il browser cerca versioni nuove dell'app solo all'apertura: qui anche alla ripresa
  navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
});

// Tocco su una notifica dei Conti con l'app già aperta (vedi sw.js).
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.apri !== "conti" || !store.hasToken()) return;
  ui.switchTab("conti");
  ultimoCaricamento = Date.now();
  store.ricarica().catch(() => {});
});

// --- impostazioni ----------------------------------------------------------
function openSettings() {
  $("#set-repo").textContent = `${store.owner}/${store.repo}`;
  $("#set-profilo").value = store.profilo;
  const nico = store.profilo === "nicolo";
  $("#set-invito-box").hidden = !nico;
  $("#set-bot-box").hidden = !nico || !TAB_INVIA; // il bot serve solo alla scheda Invia
  $("#set-version").textContent = APP_VERSION;
  $("#set-bot").value = store.bot || "";
  const ls = store.lastSync
    ? new Date(store.lastSync).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "—";
  $("#set-lastsync").textContent = store.offline ? `${ls} (offline)` : ls;
  calUI.renderImpostazioni($("#set-turni"));
  show("settings");
}

function wireSettings() {
  $("#btn-settings").addEventListener("click", openSettings);
  $("#settings-back").addEventListener("click", () => show("app"));

  $("#set-save-bot").addEventListener("click", () => {
    store.setBot($("#set-bot").value.trim());
    ui.refreshInviaLinks();
    showToast("Bot salvato.", "ok");
  });

  $("#set-change-token").addEventListener("click", () => { fillOnboarding(); show("onboarding"); });

  // profilo dell'app (Nicolò = tutto; Valentina = calendario + spesa)
  $("#set-profilo").addEventListener("change", (e) => {
    store.setProfilo(e.target.value);
    location.reload();
  });

  // link d'installazione per Valentina: costruito qui dal token già salvato
  $("#set-invito").addEventListener("click", async () => {
    const url = store.linkInvito("valentina");
    const testo = "Ecco la tua app con calendario e spesa: aprila in Chrome e poi \"Aggiungi a schermata Home\". Dopo averla aperta cancella questo messaggio (contiene la chiave d'accesso).";
    try {
      if (navigator.share) { await navigator.share({ title: "Calendario e spesa", text: testo, url }); return; }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copiato: mandalo a Valentina.", "ok");
    } catch {
      prompt("Copia il link e mandalo a Valentina:", url);
    }
  });

  $("#set-remove-token").addEventListener("click", () => {
    store.removeToken();
    showToast("Token rimosso.", "ok");
    fillOnboarding();
    show("onboarding");
  });
}

// --- service worker --------------------------------------------------------
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  // file:// non supporta i SW: registra solo su http(s) (localhost/Pages).
  if (location.protocol === "file:") return;
  // Versione nuova pubblicata: quando il suo service worker prende il controllo,
  // ricarica una volta, così si vede subito. Non al primo avvio (prima non c'era un
  // service worker) e non con un form aperto (si perderebbe quello che stai scrivendo).
  const avevaSW = Boolean(navigator.serviceWorker.controller);
  let ricaricata = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!avevaSW || ricaricata || ui.sheetKind) return;
    ricaricata = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* non bloccante */ });
  });
}

// --- bootstrap da link (?setup=TOKEN) ---------------------------------------
// Evita di dover copiare/incollare il token a mano: aprendo un link con
// ?setup=<token> l'app lo verifica e lo salva da sola. Il token va tolto
// dall'URL SUBITO (prima di qualunque await) per non lasciarlo nella barra
// indirizzi/cronologia del browser più del necessario.
function bootstrapFromUrl() {
  const params = new URLSearchParams(location.search);
  const profilo = params.get("profilo");
  if (PROFILI[profilo]) store.setProfilo(profilo); // (lo salva già lo script in <head>)
  const token = params.get("setup");
  if (!token) {
    const daNotifica = params.get("tab") === "conti"; // app aperta toccando una notifica
    if (daNotifica) ui.switchTab("conti");
    if (profilo || daNotifica) history.replaceState(null, "", location.pathname);
    return false;
  }
  history.replaceState(null, "", location.pathname);
  fillOnboarding();
  show("onboarding");
  $("#onb-token").value = token;
  $("#onboarding-form").requestSubmit();
  return true;
}

// --- avvio -----------------------------------------------------------------
function main() {
  $("#onboarding-form").addEventListener("submit", onOnboardingSubmit);
  wireSettings();
  calUI.init();
  contiUI.init();
  ui.init();
  registerSW();

  if (bootstrapFromUrl()) return;

  if (store.hasToken()) {
    bootApp();
  } else {
    fillOnboarding();
    show("onboarding");
  }
}

main();
