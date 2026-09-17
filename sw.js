/* Same-origin app shell only. Never cache authentication, routes or map tiles. */
const CACHE_NAME='everything-app-shell-v1.5B-'+encodeURIComponent(new URL(self.registration.scope).pathname);
const ASSETS=['./index.html','./app.js?v=1.5B','./accounts.js?v=1.5B','./styles.css?v=1.5B','./navigation.js?v=1.5B','./navigation-core.js?v=1.5B','./navigation.css?v=1.5B','./manifest.webmanifest','./icon.svg'];
const URLS=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  const shell=request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html');
  if(!shell&&!URLS.has(url.href))return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(shell?new URL('index.html',scope).href:request,copy)).catch(()=>{}));}
    return response;
  }).catch(async()=>{const cache=await caches.open(CACHE_NAME);return await cache.match(shell?new URL('index.html',scope).href:request)||Response.error();}));
});
