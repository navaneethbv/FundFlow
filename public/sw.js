const CACHE_NAME = "fundflow-offline-v1";
const OFFLINE_URLS = ["/", "/login", "/signup"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

// Only static assets are safe to cache. Document/navigation responses render
// per-user financial data into HTML; caching them would persist that data in
// Cache Storage across logout, readable by a later user of the same browser
// profile. So documents are network-only (with an offline fallback to the
// public shell), and only these asset types are ever written to the cache.
const CACHEABLE_DESTINATIONS = new Set(["style", "script", "font", "image"]);

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Navigations: never cache the (authenticated) HTML. Serve from network and
  // fall back to the cached public shell only when the network is unavailable.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }

  if (!CACHEABLE_DESTINATIONS.has(event.request.destination)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
