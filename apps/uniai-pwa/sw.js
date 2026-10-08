/* uniAI PWA — offline shell cache (UI only; chat needs network). */
const CACHE = 'uniai-shell-v16'
const ASSETS = [
  './',
  './index.html',
  './fonts.css',
  './styles.css',
  './plans.js',
  './office-hub.js',
  './app.js',
  './manifest.webmanifest',
  './fonts/inter-latin-400.woff2',
  './fonts/inter-latin-500.woff2',
  './fonts/inter-latin-600.woff2',
  './fonts/inter-latin-700.woff2',
  './fonts/inter-latin-ext-400.woff2',
  './fonts/inter-latin-ext-500.woff2',
  './fonts/inter-latin-ext-600.woff2',
  './fonts/inter-latin-ext-700.woff2',
  './fonts/be-vietnam-pro-vietnamese-400.woff2',
  './fonts/be-vietnam-pro-vietnamese-500.woff2',
  './fonts/be-vietnam-pro-vietnamese-600.woff2',
  './fonts/be-vietnam-pro-vietnamese-700.woff2',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

/** Shell UI must prefer network so light/dark CSS updates are not stuck behind cache-first. */
function isShellUi(url) {
  const path = url.pathname
  return (
    path.endsWith('/styles.css') ||
    path.endsWith('/fonts.css') ||
    path.endsWith('/app.js') ||
    path.endsWith('/sw.js') ||
    path.endsWith('/') ||
    path.endsWith('/index.html') ||
    path.endsWith('/index') ||
    path.endsWith('/manifest.webmanifest')
  )
}

function isFontAsset(url) {
  return url.pathname.includes('/fonts/') && url.pathname.endsWith('.woff2')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (isShellUi(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req).then((cached) => cached || Response.error())),
    )
    return
  }

  if (isFontAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
      }),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
