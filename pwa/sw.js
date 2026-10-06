'use strict';
const CACHE='conecta-tv-web-1.8.9';
const SHELL=['/','/library.js','/personal.js','/playback.js','/hls.min.js','/pwa/install.js','/manifest.webmanifest','/pwa/icon-180.png','/pwa/icon-192.png','/pwa/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('streamtv-web-')||k.startsWith('conecta-tv-web-'))&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Cache only the application shell. Never save video, API responses, searches or provider pages.
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search||!SHELL.includes(url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>{const saved=await caches.match(event.request);return saved||new Response('Sem conexão. Abra o Conecta TV novamente quando houver internet.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}));
});
