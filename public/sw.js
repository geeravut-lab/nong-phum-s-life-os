// Minimal service worker — improves Chrome installability for Life OS PWA
self.addEventListener("install", (event) => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", () => {
  /* network-only; no offline cache required for install prompt */
});
