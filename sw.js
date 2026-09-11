const C="carburant-v2";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["./","./index.html","./app.js","./config.js","./manifest.webmanifest"]))) });
self.addEventListener("activate",e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener("fetch",e=>{if(e.request.method==="GET")e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))) });