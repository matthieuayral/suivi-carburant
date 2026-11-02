const C="carburant-v6";
const FILES=["./","./index.html","./app.js","./crop.js","./config.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
// cache:"reload" / "no-cache" : contourne le cache HTTP du navigateur (GitHub Pages = 10 min) pour toujours récupérer la dernière version
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:"reload"})))))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const same=new URL(e.request.url).origin===self.location.origin;
  e.respondWith(fetch(same?new Request(e.request,{cache:"no-cache"}):e.request).then(r=>{if(same&&r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;}).catch(()=>caches.match(e.request)));
});
