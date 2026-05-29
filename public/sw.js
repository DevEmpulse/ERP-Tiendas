const CACHE_NAME = "erp-tiendas-v1";
const STATIC_CACHE_NAME = "erp-tiendas-static-v1";

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  "/",
  "/login",
  "/offline",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/apple-touch-icon.png",
];

// Routes that should NEVER be cached (auth, API, Supabase)
const NETWORK_ONLY_PATTERNS = [
  /\/api\//,
  /supabase\.co/,
  /\/auth\//,
  /_next\/data\//,
];

// Static assets to cache (cache-first)
const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\/icon-/,
  /\/apple-touch-icon/,
  /\/favicon/,
  /\.png$/,
  /\.svg$/,
  /\.ico$/,
  /\.woff2?$/,
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {
        // Ignore failures for pre-caching (e.g. /offline page may not exist yet)
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(
            (name) =>
              name !== CACHE_NAME && name !== STATIC_CACHE_NAME
          )
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and non-http(s) requests
  if (!url.protocol.startsWith("http")) return;

  // Network-only for auth and API routes
  if (NETWORK_ONLY_PATTERNS.some((pattern) => pattern.test(url.href))) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for static assets
  if (CACHE_FIRST_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML pages (with offline fallback)
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match("/offline") || new Response(
              `<!DOCTYPE html>
              <html lang="es">
                <head>
                  <meta charset="UTF-8" />
                  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                  <title>Sin conexión — ERP Tiendas</title>
                  <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                      background: #0f0a1e;
                      color: #e2e8f0;
                      min-height: 100vh;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      text-align: center;
                      padding: 2rem;
                    }
                    .container { max-width: 400px; }
                    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
                    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; color: #f8fafc; }
                    p { color: #94a3b8; line-height: 1.6; margin-bottom: 1.5rem; }
                    button {
                      background: #4f46e5;
                      color: white;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 0.5rem;
                      font-size: 1rem;
                      cursor: pointer;
                      font-weight: 600;
                    }
                    button:hover { background: #4338ca; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="icon">📶</div>
                    <h1>Sin conexión a internet</h1>
                    <p>No se puede cargar esta página. Por favor, verifica tu conexión y vuelve a intentarlo.</p>
                    <button onclick="window.location.reload()">Reintentar</button>
                  </div>
                </body>
              </html>`,
              { headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
          });
        })
    );
    return;
  }

  // Default: stale-while-revalidate for everything else
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

// ─── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "ERP Tiendas", body: event.data.text() };
  }

  const options = {
    body: data.body,
    icon: "/icon-192x192.png",
    badge: "/favicon-32x32.png",
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/",
      dateOfArrival: Date.now(),
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "ERP Tiendas", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const existingClient = clientList.find(
          (client) => client.url === targetUrl && "focus" in client
        );
        if (existingClient) return existingClient.focus();
        return clients.openWindow(targetUrl);
      })
  );
});

// ─── Message Handler ─────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
