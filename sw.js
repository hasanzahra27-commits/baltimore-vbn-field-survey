// Offline support: the app shell is cached so the tool opens with no signal.
// Files are refreshed from the network whenever there is signal, so VERSION
// only needs bumping if the SHELL list itself changes.
const VERSION = "vbn-v1.0.0";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/config.js",
  "js/checklist.js",
  "js/db.js",
  "js/csv.js",
  "js/sync.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "data/properties.csv",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so phones always get the latest app and property list when
// they have signal; after a short wait (or with no signal) use the cached copy.
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // uploads go straight to the network
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* offline: fall through to cache */ }
  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || network;
}
