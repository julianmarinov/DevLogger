const CACHE_NAME = "devlog-shell-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./site.webmanifest",
  "./sw.js",
  "./icons/icon.svg",
  "./src/app.js",
  "./src/date.js",
  "./src/fs.js",
  "./src/markdown.js",
  "./src/zip.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }

          return null;
        }),
      ),
    ),
  );
  self.clients.claim();
});

// Network first so updates reach users immediately; the cache is only an offline fallback.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }

        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
  );
});
