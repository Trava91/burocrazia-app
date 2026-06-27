// sw.js — service worker: cache dell'app shell (lettura offline dell'interfaccia).
//
// I DATI (le 3 liste) NON passano da qui: arrivano da api.github.com
// (cross-origin, autenticati) e lo store li mette in cache nel localStorage
// (snapshot) per la lettura offline. Qui si cache-a solo lo "shell" statico.
// Le scritture offline non sono supportate in v1.

const CACHE = "buro-v3"; // bump a ogni deploy per invalidare lo shell

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/main.js",
  "js/ui.js",
  "js/store.js",
  "js/api.js",
  "js/model.js",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // scritture: solo rete
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // api.github.com: passa alla rete

  // App shell: cache-first, con aggiornamento in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached || caches.match("index.html")); // navigazione offline → shell
      return cached || network;
    })
  );
});
