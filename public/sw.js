const CACHE_NAME = "fundflow-offline-v1";

// Nothing is precached. `CACHE_NAME` is a constant, so the activate handler's
// cleanup below (which only deletes caches whose name differs) never fires for
// this cache — anything stored here outlives every later deployment. That is
// harmless for the hashed /_next assets cached on demand in `fetch`, because a
// content-addressed URL only ever maps to one body. It was not harmless for
// HTML: a precached document kept pointing at the hashed chunks of the build
// that cached it, the next deploy deleted those chunks from the CDN, and the
// app then rendered completely unstyled until the user cleared their cache.
self.addEventListener("install", (event) => {
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

  // Navigations: network only. There is no cached shell to fall back to, so
  // offline navigation surfaces the browser's own error rather than a stale
  // document from an older build.
  if (event.request.mode === "navigate") return;

  if (!CACHEABLE_DESTINATIONS.has(event.request.destination)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only store successes. `cache.put` happily accepts a 404, which would
        // pin the failure for a URL that a later deploy may serve correctly.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Web push: payloads carry title/body only (no PII, no amounts unless the
// notification itself includes them). Tapping opens the notification feed.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "FundFlow", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "FundFlow", {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/notifications") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/notifications");
    }),
  );
});
