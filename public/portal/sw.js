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

/** Provider content is plain text. A notification cannot choose an external
 * origin, an authenticated API, or a token-bearing URL to open on a click. */
function notificationPath(value){
 if(typeof value!=="string"||value.length>512)return "/portal/";
 // Domain producers use opaque ASCII IDs and public live slugs. An encoded
 // separator/name, dot segment, query or API endpoint is never a click target.
 const page=/^\/portal\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/(?:notifications|learn\/[A-Za-z0-9_-]{1,128}(?:\/certificate|\/community\/(?!data$)[A-Za-z0-9_-]{1,128})?))?$/u;
 const publicLive=/^\/live\/[A-Za-z0-9_-]{1,128}$/u;
 return page.test(value)||publicLive.test(value)?value:"/portal/";
}
self.addEventListener("push",event=>{
 let payload;
 try{payload=event.data?.json();}catch{payload=null;}
 const valid=payload&&typeof payload==="object"&&typeof payload.title==="string"&&payload.title.trim().length>0&&payload.title.length<=200&&typeof payload.body==="string"&&payload.body.length<=2000;
 // Malformed messages still satisfy userVisibleOnly with generic content.
 const title=valid?payload.title:"學員通知";
 const options={body:valid?payload.body:"請登入學員中心查看最新消息。",icon:"/portal/icon-192.png",data:{path:notificationPath(valid?payload.path:null)}};
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(notificationPath(event.notification.data?.path),self.location.origin).href;
 // Only an explicit notification click navigates; push reception never does.
 event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async clients=>{
  const existing=clients.find(client=>client.url===target&&typeof client.focus==="function");
  if(existing)return existing.focus();
  return self.clients.openWindow(target);
 }));
});
