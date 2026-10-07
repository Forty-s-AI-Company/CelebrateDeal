/* Cache only generic public assets; authenticated content stays network-only. */
const CACHE="celebratedeal-portal-public-v1";
const PUBLIC_ASSETS=["/portal/offline.html","/portal/manifest.webmanifest","/portal/icon-192.png","/portal/icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("celebratedeal-portal-public-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(PUBLIC_ASSETS.includes(url.pathname)&&!url.search&&!request.headers.has("rsc")){event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)).then(cached=>cached||fetch(request)));return;}
 // API/RSC/POST requests never get an offline success response or a queue.
 if(request.mode==="navigate"&&request.destination==="document"&&url.pathname.startsWith("/portal/")){event.respondWith(fetch(request).catch(async()=>{const response=await (await caches.open(CACHE)).match("/portal/offline.html");return new Response(response?await response.text():"Offline",{status:503,headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store"}});}));}
});
