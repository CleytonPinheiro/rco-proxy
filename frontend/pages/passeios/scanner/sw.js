/* EduSync Scanner — Service Worker (offline-first) */
const CACHE_NAME = 'edusync-scanner-v1';
const PRECACHE = [
    '/pages/passeios/scanner/',
    '/pages/passeios/scanner/index.html',
    '/pages/passeios/scanner/scanner.css',
    '/pages/passeios/scanner/scanner.js',
    '/shared/css/theme.css',
    '/shared/js/theme.js',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    /* API POST (scan): network-first; on failure let the JS offline queue handle it */
    if (url.pathname.startsWith('/api/')) {
        e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ erro: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        })));
        return;
    }

    /* Static assets: cache-first */
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
            if (res.ok && e.request.method === 'GET') {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            }
            return res;
        }))
    );
});
