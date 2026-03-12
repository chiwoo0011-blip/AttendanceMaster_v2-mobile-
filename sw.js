const CACHE_NAME = 'attendance-v6';
const ASSETS = [
    './',
    './index.html',
    './worker.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// 설치 시 리소스 저장 (이 로직이 있어야 설치 버튼이 뜹니다)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// 실행 시 네트워크 우선 전략
self.addEventListener('fetch', (event) => {
    // HTML 파일: 쿼리 파라미터(?t=xxx) 제거하여 캐시 키 통일
    const url = new URL(event.request.url);
    const isHTML = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';
    const cacheKey = isHTML ? new Request(url.origin + url.pathname) : event.request;

    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(cacheKey);
        })
    );
});
