// main.js — wiring: onboarding token, primo load, impostazioni, service worker.

import { Store } from "./store.js";
import { GitHubApi } from "./api.js";
import { UI, showToast } from "./ui.js";

const APP_VERSION = "1.0.0";
const PAT_URL = "https://github.com/settings/personal-access-tokens/new";

const $ = (s) => document.querySelector(s);

const store = new Store();
const ui = new UI(store);
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
async function bootApp() {
  show("app");
  ui.refreshInviaLinks();
  $("#spinner").hidden = false;
  try {
    await store.load();
  } catch (err) {
    showToast(err?.message || "Caricamento fallito.", "err");
    // token non valido → torna all'onboarding così può correggerlo
    if (err?.kind === "auth") { fillOnboarding(); show("onboarding"); }
  } finally {
    $("#spinner").hidden = true;
  }
}

// --- impostazioni ----------------------------------------------------------
function openSettings() {
  $("#set-repo").textContent = `${store.owner}/${store.repo}`;
  $("#set-version").textContent = APP_VERSION;
  $("#set-bot").value = store.bot || "";
  const ls = store.lastSync
    ? new Date(store.lastSync).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "—";
  $("#set-lastsync").textContent = store.offline ? `${ls} (offline)` : ls;
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* non bloccante */ });
  });
}

// --- avvio -----------------------------------------------------------------
function main() {
  $("#onboarding-form").addEventListener("submit", onOnboardingSubmit);
  wireSettings();
  ui.init();
  registerSW();

  if (store.hasToken()) {
    bootApp();
  } else {
    fillOnboarding();
    show("onboarding");
  }
}

main();
