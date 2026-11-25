// ?ㅽ봽?쇱씤?먯꽌?????붾㈃???대━?꾨줉 ???뚯씪??罹먯떆?⑸땲??
// AI ?붿껌(api.anthropic.com)怨?SDK(esm.sh)??罹먯떆?섏? ?딄퀬 ??긽 ?ㅽ듃?뚰겕濡?蹂대깄?덈떎.
const CACHE = "pocket-manager-v13";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./store.js",
  "./sms.js",
  "./native.js",
  "./icons.js",
  "./agent.js",
  "./tools.js",
  "./gemini.js",
  "./claude.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // 怨듭쑀濡??대┛ 寃쎌슦(?text=...)?먮룄 ???몄쓣 ?뚮젮以띾땲??
  const key = url.pathname.endsWith("/") ? "./" : event.request;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
        return res;
      })
      .catch(() => caches.match(key).then((r) => r || caches.match("./"))),
  );
});
