// notifiche.js — iscrive questo telefono alle notifiche dei Conti (Web Push).
// L'iscrizione finisce in iscrizioni-push.json; a mandare le notifiche è il workflow
// notifica-conti.yml del repo scadenzario, quindi arrivano anche ad app chiusa.

// Chiave pubblica VAPID: pubblica davvero, la privata è solo un secret su GitHub.
const VAPID_PUBLIC = "BMMYyKPQ0_uTivw2_PYz4mhRBfbcnf-PCnwwoT0dLkkNmfc9mbzgKwPXSsNZa9Y18gBEIt1OAwE9L28jJWCwmy8";

const chiave = () => Uint8Array.from(
  atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const supportate = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Stato di questo telefono: "attive" | "da-attivare" | "bloccate" | "no" (non supportate).
 *  Se è iscritto ma il suo indirizzo non è nel repo (il browser può rinnovarlo), lo rimette. */
export async function controlla(store) {
  if (!supportate()) return "no";
  if (Notification.permission === "denied") return "bloccate";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") return "da-attivare";
  await store.salvaIscrizione(sub.toJSON());
  return "attive";
}

/** Chiede il permesso e iscrive il telefono (va chiamata da un tocco dell'utente). */
export async function attiva(store) {
  const permesso = await Notification.requestPermission();
  if (permesso !== "granted") return permesso === "denied" ? "bloccate" : "da-attivare";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave() });
  await store.salvaIscrizione(sub.toJSON());
  return "attive";
}
