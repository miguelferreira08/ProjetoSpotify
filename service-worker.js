const CACHE_NAME = "redbeat-app-v24";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css?v=24",
    "./app.js?v=24",
    "./auth.js",
    "./config.js",
    "./firebase.js",
    "./media.js",
    "./storage.js",
    "./scrollbar.js",
    "./utils.js",
    "./pwa.js",
    "./manifest.webmanifest",
    "./favicon.svg?v=24",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png",
    "./assets/genres/eletronica.png",
    "./assets/genres/rock.png",
    "./assets/genres/funk.png",
    "./assets/genres/pagode.png",
    "./assets/genres/sertanejo.png",
    "./assets/genres/trap.png",
    "./assets/genres/pop.png",
    "./assets/genres/regional.png",
    "./assets/genres/reggae.png",
    "./assets/genres/jazz.png",
    "./assets/genres/hiphop.png",
    "./assets/genres/outros.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((name) => name.startsWith("redbeat-app-") && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Firebase e outros módulos externos continuam usando a rede normalmente.
    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => response)
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    event.respondWith(
        caches.match(request)
            .then((cached) => {
                if (cached) {
                    return cached;
                }

                return fetch(request).then((response) => {
                    if (!response || response.status !== 200 || response.type !== "basic") {
                        return response;
                    }

                    const copy = response.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(request, copy))
                        .catch(console.warn);

                    return response;
                });
            })
    );
});
