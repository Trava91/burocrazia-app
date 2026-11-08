// sw.js — service worker: cache dell'app shell (lettura offline dell'interfaccia).
//
// I DATI (le 3 liste + turni, agenda e conti) NON passano da qui: arrivano da api.github.com
// (cross-origin, autenticati) e lo store li mette in cache nel localStorage
// (snapshot) per la lettura offline. Qui si cache-a solo lo "shell" statico.
// Le scritture offline non sono supportate in v1.

const CACHE = "buro-v21"; // bump a ogni deploy per invalidare lo shell

// GitHub Pages dice ai browser di tenere ogni file 10 minuti (max-age=600): senza
// "no-cache" un deploy poteva non vedersi, o vedersi a metà (file vecchi e nuovi
// mischiati), per 10 minuti. Con "no-cache" ogni file si ricontrolla col server
// (se non è cambiato risponde 304, costa pochissimo).
// (Per l'apertura della pagina i reindirizzamenti restano al browser: redirect "manual".)
const fresco = (req) => (req.mode === "navigate"
  ? new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
  : new Request(req, { cache: "no-cache" }));

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "manifest-vale.webmanifest",
  "css/styles.css",
  "js/main.js",
  "js/ui.js",
  "js/store.js",
  "js/api.js",
  "js/model.js",
  "js/calendario.js",
  "js/cal-ui.js",
  "js/conti.js",
  "js/conti-ui.js",
  "js/notifiche.js",
  "icons/icon.svg",
  "icons/icon-vale.svg",
  "icons/notifica.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Notifiche dei Conti: le manda il workflow notifica-conti.yml (vedi js/notifiche.js).
self.addEventListener("push", (event) => {
  const { titolo, testo } = event.data.json();
  event.waitUntil(self.registration.showNotification(titolo, { body: testo, icon: "icons/notifica.png" }));
});

// Tocco sulla notifica: porta alla scheda Conti, nell'app già aperta se c'è.
// Il filtro sullo scope serve perché sulla stessa origine c'è anche il Jukebox.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((finestre) => {
      const app = finestre.find((c) => c.url.startsWith(self.registration.scope));
      if (!app) return self.clients.openWindow(`${self.registration.scope}?tab=conti`);
      app.postMessage({ apri: "conti" });
      return app.focus();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // scritture: solo rete
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // api.github.com: passa alla rete

  // App shell: NETWORK-FIRST, ricontrollato col server (vedi `fresco`). Online →
  // sempre l'ultima versione (e aggiorna la cache); offline → fallback alla cache
  // (o allo shell per la navigazione).
  event.respondWith(
    fetch(fresco(req))
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("index.html")))
  );
});
