/* Claudio service worker — deliberately minimal.
 *  - cache-first: app icon, manifest, brand logos, Google Fonts (CSS + font files)
 *  - network-first for navigations, falling back to the cached app shell ("/") when offline
 *  - never touches /api or /ws (live trading data must never be served stale)
 */
const VERSION = "claudio-v8";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;
const PRECACHE = [
  "/",
  "/favicon.ico",
  "/claudio/face-128.webp",
  "/claudio/favicon-32.png",
  "/claudio/favicon-64.png",
  "/claudio/icon-192.png",
  "/claudio/icon-512.png",
  "/claudio/icon-maskable-512.png",
  "/claudio/apple-touch-icon.png",
  "/claudio/avatar-96.webp",
  "/claudio/avatar-256.webp",
  "/claudio/portrait-full.webp",
  "/claudio/tiktok-logo.png",
  "/claudio/x-logo-white.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.add(new Request("/", { cache: "reload" })).catch(() => undefined);
      const stat = await caches.open(STATIC_CACHE);
      await stat.addAll(PRECACHE.filter((p) => p !== "/")).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => undefined);
      }
      await self.clients.claim();
    })(),
  );
});

function isStatic(url) {
  if (url.origin === self.location.origin) {
    return (
      url.pathname.startsWith("/claudio/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/favicon.ico" ||
      url.pathname.startsWith("/brand/") ||
      /\.(woff2?|ttf|otf)$/.test(url.pathname)
    );
  }
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache live data or the socket.
  if (url.origin === self.location.origin && (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws"))) return;
  if (req.headers.get("upgrade") === "websocket") return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          const res = preload || (await fetch(req));
          // Only the HTML app shell is kept for offline use: /llms.txt and the .md twins are navigations too.
          const html = (res && res.headers.get("content-type")) || "";
          if (res && res.ok && url.origin === self.location.origin && html.includes("text/html")) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/", copy)).catch(() => undefined);
          }
          return res;
        } catch {
          const cached = (await caches.match("/", { cacheName: SHELL_CACHE })) || (await caches.match("/"));
          return (
            cached ||
            new Response(
              "<!doctype html><meta name=viewport content='width=device-width'><title>Claudio</title>" +
                "<body style='background:#0b1120;color:#fff;font:14px system-ui;display:grid;place-items:center;min-height:100vh;margin:0'>" +
                "<div style='text-align:center'><b style='font:56px Georgia,serif;letter-spacing:.06em'>CLAUDIO</b><p style='letter-spacing:.2em'>YOU ARE OFFLINE</p></div>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }
      })(),
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => undefined);
          return res;
        } catch {
          return hit || Response.error();
        }
      })(),
    );
  }
  // Everything else (hashed JS/CSS bundles, images): default browser handling.
});
