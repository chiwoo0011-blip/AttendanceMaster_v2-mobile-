// Service Worker for PWA - Network First, Cache Fallback
const CACHE_NAME = 'attendance-app-v6';
const urlsToCache = [
    '/worker.html',
    '/app.js',
    '/style.css',
    'https://unpkg.com/lucide@latest',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

// Fetch event - 항상 네트워크 우선, 실패 시에만 캐시
self.addEventListener('fetch', (event) => {
    // HTML 파일: 쿼리 파라미터(?t=xxx) 제거하여 캐시 키 통일
    const url = new URL(event.request.url);
    const isHTML = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';
    const cacheKey = isHTML ? new Request(url.origin + url.pathname) : event.request;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 네트워크 성공 → 캐시 업데이트 후 반환
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(cacheKey, clone);
                });
                return response;
            })
            .catch(() => {
                // 네트워크 실패 (오프라인) → 캐시에서 반환
                return caches.match(cacheKey);
            })
    );
});

// Activate event - 이전 캐시 모두 삭제
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});
