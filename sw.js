/* Everything App 1.5A: prefer current code, use last-known shell only when offline.
   Only same-origin static assets are cached. Authentication and live map data are never cached. */
const CACHE_NAME = 'everything-app-shell-v1.5A';
const ASSETS = ['./','./index.html','./app.js?v=1.5A','./accounts.js?v=1.5A','./styles.css?v=1.5A','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('everything-app-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return; // never intercept Supabase, Google, routing or TfL.
  if(!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode!=='navigate' && !/\.(?:js|css|html|png|webmanifest)$/.test(url.pathname))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});}
    return response;
  }).catch(async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    if(request.mode==='navigate')return caches.match('./index.html');
    return Response.error();
  }));
});
