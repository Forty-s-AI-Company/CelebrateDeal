const CACHE_NAME = "celebrate-deal-v1";
const APP_SHELL = ["/offline.html", "/manifest.json", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    // 登入頁面與學員資料一律 network-first，離線時只顯示無個資的固定頁面。
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
    return;
  }
  const cacheable = ["style", "script", "image", "font"].includes(event.request.destination);
  if (!cacheable) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (response.ok && !/private|no-store/iu.test(cacheControl)) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  const title = typeof data.title === "string" ? data.title : "CelebrateDeal";
  const options = {
    body: typeof data.body === "string" ? data.body : "您有一則新的課程通知",
    icon: typeof data.icon === "string" ? data.icon : "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    data: { url: typeof data.url === "string" ? data.url : "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/dashboard";
  try {
    const candidate = new URL(typeof event.notification.data?.url === "string" ? event.notification.data.url : target, self.location.origin);
    if (candidate.origin === self.location.origin) target = `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {}
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    return existing ? existing.focus().then(() => existing.navigate(target)) : self.clients.openWindow(target);
  }));
});
