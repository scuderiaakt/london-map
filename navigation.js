/* v1.5B: incremental adapter for the existing v1.5A route planner.
   No Supabase dependency. Provider results remain in memory only. */
(function() {
  'use strict';
  const C=window.NavigationCore, $=id=>document.getElementById(id);
  const modeNames={drive:'Car',transit:'Public transport',walk:'Walk',taxi:'Taxi',air:'Air + ground (estimate)'};
  const S={active:false,generation:0,watch:null,timer:null,low:false,data:false,follow:true,rotate:true,fix:null,previous:null,along:null,off:0,lastReroute:0,rerouting:false,lastPaint:0,marker:null,drag:null,wake:null};
  let requestGeneration=0;
  const text=html=>{const d=document.createElement('div');d.innerHTML=String(html||'');return d.textContent||'';};
  const fmtM=n=>n<1000?`${Math.round(n)} m`:`${(n/1000).toFixed(1)} km`;
  const fmtT=n=>`${Math.max(1,Math.ceil(n/60))} min`;
  const status=message=>{$('nav2-status').textContent=message;};
  const selected=()=>v14eNavigation.candidates[v14eNavigation.selectedIndex];
  const realMode=c=>c?.nav2Mode||c?.fastestMode||v14eNavigation.mode;
  const canGo=c=>!!(c&&!c.estimated&&c.route&&c.path?.length>1);
  function timeout(p,ms=20000) {let t;return Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error('Routing timed out')),ms);})]).finally(()=>clearTimeout(t));}
  function readPreferences(){try{const p=JSON.parse(localStorage.getItem('everythingApp.navigation.settings.v1')||'{}');S.low=!!p.low;S.data=!!p.data;}catch{}}
  readPreferences();
  $('navigation-sheet').insertAdjacentHTML('beforeend',`<div class="nav2-options"><label><input id="nav2-low" type="checkbox"> Low battery</label><label><input id="nav2-data" type="checkbox"> Data saver</label></div><div class="nav2-actions"><button id="nav2-go" class="nav2-primary" disabled>Go →</button><button id="nav2-compare">Compare modes</button><button id="nav2-save">Save journey notes</button></div><p class="nav2-note">Go follows your location while this page is open. ETA is an estimate. Data saver limits route requests and map movement; map tiles can still use data.</p><div id="nav2-provider" class="nav2-attribution"></div>`);
  $('app').insertAdjacentHTML('beforeend',`<section id="nav2-live" class="nav2-panel hidden" aria-label="Live navigation"><div class="nav2-kicker">OUR CITIES · ON YOUR WAY</div><h2 id="nav2-destination"></h2><div id="nav2-love" class="nav2-love hidden"><span>♥</span> İyi Yolculuklar Aşkım ❤️</div><p id="nav2-status" role="status">Waiting for your location…</p><h3 id="nav2-instruction"></h3><div class="nav2-stats"><div id="nav2-distance"></div><div id="nav2-time"></div></div><div class="nav2-controls"><button id="nav2-follow">Recenter</button><button id="nav2-heading" aria-pressed="true">Heading up</button><button id="nav2-reroute">Reroute</button><button id="nav2-stop">End</button></div><p id="nav2-compass" class="nav2-note"></p><details><summary>Journey steps & options</summary><div class="nav2-options"><label><input id="nav2-live-low" type="checkbox"> Low battery</label><label><input id="nav2-live-data" type="checkbox"> Data saver</label></div><ol id="nav2-steps"></ol><p class="nav2-note">Keep this page open. GPS may be unavailable underground. No reliable locked-screen guidance or full offline routing. Transit ETA does not account for missed connections.</p><div id="nav2-live-provider" class="nav2-attribution"></div></details></section><button id="nav2-packs-open" class="nav2-packs-button">Journey packs</button><section id="nav2-packs" class="nav2-panel hidden" aria-label="Saved journey packs"><div class="nav2-kicker">OUR CITIES · SAVED FOR LATER</div><h2>Journey packs</h2><button id="nav2-packs-close">Close</button><p class="nav2-note">Personal notes are saved on this browser only, separately for each welcome profile. No map tiles, Google directions, live times or full offline routing. Export a pack to keep a backup. Anyone using this browser profile may be able to read it.</p><label>Journey title<input id="nav2-pack-title" maxlength="160" placeholder="Our journey home"></label><label>Your saved information<textarea id="nav2-pack-notes" maxlength="12000" placeholder="Write your meeting point, packing reminders, ticket notes or a personal message…"></textarea></label><button id="nav2-pack-create">Save pack on this device</button><div id="nav2-pack-status" role="status"></div><div id="nav2-pack-list"></div></section>`);
  const legacyCalculate=v14eCalculateNavigation;
  $('navigation-mode-grid').insertAdjacentHTML('afterend',`<div id="nav2-custom" class="hidden"><p class="nav2-note">Custom car journey preferences (provider support varies).</p><div class="nav2-options"><label><input id="nav2-avoid-tolls" type="checkbox"> Avoid tolls</label><label><input id="nav2-avoid-highways" type="checkbox"> Avoid motorways</label></div><div class="nav2-actions"><button id="nav2-custom-plan">Calculate custom car route</button><button id="nav2-custom-hand">Build route by hand</button></div><p class="nav2-note">Hand-built transport lines remain available in the original editor; they are not verified turn-by-turn directions.</p></div>`);
  $('nav2-custom-plan').onclick=()=>calculate('custom-drive');
  $('nav2-custom-hand').onclick=()=>legacyCalculate('custom');
  $('navigation-sheet').insertAdjacentHTML('beforeend','<div class="nav2-actions"><button id="nav2-more">More route alternatives</button><button id="nav2-taxi-ranks">Nearby taxi ranks</button></div><p class="nav2-note">More alternatives uses the original planner’s road and transit preferences and makes extra requests. Taxi ranks need a connection.</p>');
  $('nav2-more').onclick=async()=>{
    const mode=v14eNavigation.mode;
    if(S.data){$('navigation-status').textContent='Turn off Data saver to request more alternatives.';return;}
    if(!['drive','taxi','transit','walk'].includes(mode)||!C.point(v14eNavigation.origin)||!C.point(v14eNavigation.destination)){$('navigation-status').textContent='Choose Car, Taxi, Public transport or Walk first.';return;}
    const id=++requestGeneration;v14eNavigation.candidates=[];selection();$('navigation-status').textContent='Checking additional route preferences…';
    try{const list=await timeout(v15fixBuildCandidatesBase(mode));if(id!==requestGeneration)return;v14eNavigation.candidates=list.map(c=>({...c,nav2Mode:mode}));v14eNavigation.selectedIndex=0;renderCandidates();$('navigation-status').textContent=list.length?`${list.length} alternatives returned.`:'No additional routes returned.';}
    catch{if(id===requestGeneration)$('navigation-status').textContent='Additional routes unavailable. Choose a mode to try again.';}
  };
  $('nav2-taxi-ranks').onclick=()=>{if(!navigator.onLine||S.data){$('navigation-status').textContent='Taxi ranks need a connection and Data saver turned off.';return;}if(!C.point(v14eNavigation.origin))return;v14eTaxiRanks();};
  function prefs(){
    for(const id of ['nav2-low','nav2-live-low'])$(id).checked=S.low;
    for(const id of ['nav2-data','nav2-live-data'])$(id).checked=S.data;
    document.body.classList.toggle('nav2-low',S.low);
    try{localStorage.setItem('everythingApp.navigation.settings.v1',JSON.stringify({low:S.low,data:S.data}));}catch{}
  }
  for(const id of ['nav2-low','nav2-live-low','nav2-data','nav2-live-data'])$(id).onchange=e=>{S[id.endsWith('low')?'low':'data']=e.target.checked;prefs();if(S.active){watch();releaseWake();if(!S.low)wake();}};
  prefs();
  function provider(c,node){
    node.replaceChildren();if(!c?.route)return;
    const label=document.createElement('div');label.textContent='Google Maps';label.translate=false;node.append(label);
    const copy=document.createElement('div');copy.textContent=text(c.route.copyrights);node.append(copy);
    const seen=new Set();for(const leg of c.route.legs||[])for(const step of leg.steps||[])for(const agency of step.transit?.line?.agencies||[]){
      if(seen.has(agency.name))continue;seen.add(agency.name);const a=document.createElement('a');a.textContent=agency.name||'Transit agency';
      try{const u=new URL(agency.url);if(u.protocol==='https:'||u.protocol==='http:'){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}}catch{}
      node.append(a,document.createTextNode(' '));
    }
    for(const warning of c.route.warnings||[]){const p=document.createElement('p');p.textContent=text(warning);node.append(p);}
  }
  function selection(){const c=selected();$('nav2-go').disabled=!canGo(c);provider(c,$('nav2-provider'));}
  const drawBase=v14eDrawCandidate;
  v14eDrawCandidate=function(i){drawBase(i);selection();};
  const endpointBase=v15SetEndpoint;
  v15SetEndpoint=function(...args){requestGeneration++;endpointBase(...args);selection();};
  const openBase=v14eOpenNavigation;
  v14eOpenNavigation=function(...args){requestGeneration++;if(S.active)stop();openBase(...args);selection();};
  const closeBase=v14eCloseNavigation;
  v14eCloseNavigation=function(...args){requestGeneration++;return closeBase(...args);};
  // Each request owns endpoint snapshots. Late responses cannot replace a newer plan.
  async function route(mode,origin,destination,alternatives=true,custom={}){
    const {DirectionsService}=await google.maps.importLibrary('routes');
    const travelMode={drive:'DRIVING',taxi:'DRIVING',walk:'WALKING',transit:'TRANSIT'}[mode];
    if(!travelMode)throw new Error('Unsupported mode');
    const req={origin:C.point(origin),destination:C.point(destination),travelMode,provideRouteAlternatives:alternatives&&!S.data};
    if(mode==='drive'||mode==='taxi'){req.drivingOptions={departureTime:new Date(),trafficModel:'bestguess'};Object.assign(req,custom);}
    if(mode==='transit')req.transitOptions={departureTime:new Date()};
    const response=await timeout(new DirectionsService().route(req));
    return (response.routes||[]).map(r=>({...v14eCandidateFromRoute(r,modeNames[mode]),nav2Mode:mode,fastestMode:mode,nav2Options:{...custom}}));
  }
  async function calculate(mode){
    $('nav2-custom').classList.toggle('hidden',!['custom','custom-drive'].includes(mode));
    if(mode==='custom'){requestGeneration++;v14eNavigation.candidates=[];selection();$('navigation-results').replaceChildren();v14eClearNavPolylines();$('navigation-status').textContent='Choose custom car preferences or build a route by hand.';return;}
    const id=++requestGeneration,origin=C.point(v14eNavigation.origin),destination=C.point(v14eNavigation.destination);
    if(!origin||!destination){$('navigation-status').textContent='Choose both route endpoints first.';return;}
    v14eNavigation.candidates=[];selection();v14eClearNavPolylines();v14eNavigation.mode=mode==='compare'?'fastest':mode==='custom-drive'?'drive':mode;
    document.querySelectorAll('[data-nav-mode]').forEach(b=>b.classList.toggle('active',b.dataset.navMode===v14eNavigation.mode));
    $('navigation-results').replaceChildren();$('navigation-taxi-ranks').classList.add('hidden');
    if(!navigator.onLine){$('navigation-status').textContent='Offline. Open Journey packs for your saved notes. New routes need a connection.';return;}
    $('navigation-status').textContent='Finding routes…';
    try{
      let candidates=[],failures=[];
      if(mode==='fastest'||mode==='compare'){
        const modes=['drive','transit','walk'];
        const results=await Promise.allSettled(modes.map(m=>route(m,origin,destination,false)));
        results.forEach((r,i)=>{if(r.status==='fulfilled'&&r.value.length)candidates.push(...r.value);else failures.push(modeNames[modes[i]]);});
        const car=candidates.filter(c=>c.nav2Mode==='drive');
        candidates.push(...car.map(c=>({...c,nav2Mode:'taxi',fastestMode:'taxi',source:'Same road journey as car; pickup wait and fare unknown'})));
        if(id!==requestGeneration)return;
        if(!S.data&&C.distance(origin,destination)>180000){try{candidates.push(...await timeout(v15fixAirCandidates()));}catch{failures.push('Air estimate');}}
        candidates.sort((a,b)=>a.duration-b.duration);
      }else candidates=await route(mode==='custom-drive'?'drive':mode,origin,destination,true,mode==='custom-drive'?{avoidTolls:$('nav2-avoid-tolls').checked,avoidHighways:$('nav2-avoid-highways').checked}:{});
      if(id!==requestGeneration)return;
      v14eNavigation.candidates=candidates;v14eNavigation.selectedIndex=0;
      $('navigation-status').textContent=candidates.length?`${candidates.length} options. ${mode==='fastest'||mode==='compare'?'Compared returned journeys; taxi excludes pickup wait. Air options, if shown, are estimates without checked schedules. ':''}${mode==='taxi'?'Taxi road duration only; no booking, pickup wait or verified fare. ':''}${failures.length?'Unavailable: '+failures.join(', ')+'.':''}`:'No route returned for these endpoints and this mode.';
      renderCandidates();
    }catch(err){if(id!==requestGeneration)return;$('navigation-status').textContent=`Routing unavailable (${String(err.code||err.message||'provider error').slice(0,160)}). Check connection, Google Directions access, key restrictions and billing. You can still use Custom routes and Journey packs.`;}
  }
  v14eCalculateNavigation=calculate;
  function renderCandidates(){
    const node=$('navigation-results');node.replaceChildren();
    v14eNavigation.candidates.forEach((c,i)=>{
      const button=document.createElement('button');button.className='navigation-result';button.dataset.navRoute=i;
      const main=document.createElement('span');main.className='navigation-result-main';
      const title=document.createElement('b');title.textContent=`${i===0?'Fastest returned · ':''}${modeNames[realMode(c)]||'Route'} · ${c.summary||c.source}`;
      const sub=document.createElement('small');sub.textContent=realMode(c)==='transit'?`${c.transfers} transfers · ${fmtM(c.walk)} walking`:realMode(c)==='taxi'?'Car travel time; pickup wait and fare unknown':c.source;
      main.append(title,sub);const time=document.createElement('span');time.className='navigation-result-time';time.textContent=`${fmtT(c.duration)} · ${fmtM(c.distance)}`;
      button.append(main,time);button.onclick=()=>v14eDrawCandidate(i);node.append(button);
    });
    if(selected())v14eDrawCandidate(0);selection();
  }
  $('nav2-compare').onclick=()=>calculate('compare');
  // Keep the original hand-built route editor available; custom lines are not turn-by-turn routes.
  $('nav2-go').onclick=start;
  function stepsFor(c){
    const out=[];
    function visit(s){
      if(!s.transit&&s.steps?.length){s.steps.forEach(visit);return;}
      const transit=s.transit;
      let instruction=text(s.instructions)||s.maneuver||'Continue';
      if(transit)instruction=`${transit.line?.short_name||transit.line?.name||'Transit'}: ${transit.departure_stop?.name||'Board'} → ${transit.arrival_stop?.name||'Alight'}${transit.departure_time?.text?' · departs '+transit.departure_time.text:''}`;
      out.push({instruction,end:C.point(s.end_location),distance:Number(s.distance?.value)||0});
    }
    for(const l of c.route.legs||[])for(const s of l.steps||[])visit(s);
    return out;
  }
  function setupCandidate(c){
    S.candidate=c;S.path=c.path.map(C.point).filter(Boolean);S.cumulative=C.measure(S.path);S.length=S.cumulative.at(-1)||0;S.along=null;S.off=0;S.steps=stepsFor(c);S.stepIndex=0;
    let cursor=0;
    for(const s of S.steps){
      const offset=S.path.findIndex((_,i)=>S.cumulative[i]>=cursor);
      const tail=S.path.slice(Math.max(0,offset-1));const base=S.cumulative[Math.max(0,offset-1)]||0;
      const projected=s.end?C.project(s.end,tail,C.measure(tail)):null;
      s.endAlong=projected?Math.max(cursor,projected.along+base):cursor;cursor=s.endAlong;
    }
    const list=$('nav2-steps');list.replaceChildren();S.steps.forEach(s=>{const li=document.createElement('li');li.textContent=`${s.instruction} · ${fmtM(s.distance)}`;list.append(li);});
    provider(c,$('nav2-live-provider'));paint();
  }
  async function start(){
    const c=selected();if(!canGo(c))return;
    if(!navigator.geolocation){showToast('Live location is not supported. You can still review the route.');return;}
    if(S.active)stop();S.active=true;S.arrived=false;S.generation++;S.follow=true;S.fix=null;S.previous=null;S.lastPaint=0;S.lastReroute=0;S.rerouting=false;S.savedFocus=document.activeElement;
    if(typeof userLocationWatchId!=='undefined'&&userLocationWatchId!==null){navigator.geolocation.clearWatch(userLocationWatchId);userLocationWatchId=null;followUserLocation=false;updateLocationButton();}
    S.origin={...v14eNavigation.origin};S.destination={...v14eNavigation.destination};
    S.camera={center:map.getCenter(),zoom:map.getZoom(),heading:map.getHeading?.()||0,tilt:map.getTilt?.()||0};
    setupCandidate(c);$('navigation-sheet').classList.add('hidden');$('nav2-live').classList.remove('hidden');document.body.classList.add('nav2-active');
    S.inert=[];for(const child of $('app').children)if(!['map','nav2-live'].includes(child.id)){S.inert.push([child,child.inert]);child.inert=true;}
    $('nav2-destination').textContent=S.destination.name||'Your destination';status('Waiting for a fresh GPS location…');$('nav2-stop').focus();
    const romantic=localStorage.getItem(V14D_PROFILE_STORAGE)==='ela';$('nav2-love').classList.toggle('hidden',!romantic);
    clearTimeout(S.loveTimer);S.loveTimer=setTimeout(()=>$('nav2-love').classList.add('hidden'),4500);
    S.drag=map.addListener('dragstart',()=>{S.follow=false;status('Map browsing · press Recenter to follow again.');});
    S.marker=new google.maps.Marker({map,title:'Your current position',zIndex:2000,icon:{path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:5,fillColor:'#a9e7d3',fillOpacity:1,strokeColor:'#102b28',strokeWeight:2}});
    watch();S.timer=setInterval(()=>{if(S.active&&S.fix&&Date.now()-S.fix.time>20000){status('GPS signal lost or stale · progress paused.');$('nav2-time').textContent='ETA paused';}},5000);wake();
  }
  function watch(){
    if(S.watch!==null)navigator.geolocation.clearWatch(S.watch);S.watch=null;
    if(!S.active||S.arrived||document.hidden)return;
    const generation=S.generation,watchGeneration=S.watchGeneration=(S.watchGeneration||0)+1;
    S.watch=navigator.geolocation.watchPosition(p=>{if(S.active&&generation===S.generation&&watchGeneration===S.watchGeneration)position(p);},e=>{if(!S.active||generation!==S.generation||watchGeneration!==S.watchGeneration)return;status(e.code===1?'Location permission denied. Allow location in browser settings, then press Recenter.':e.code===2?'GPS unavailable. You can review steps; try outdoors.':'Location timed out. Waiting for the next fix…');$('nav2-time').textContent='ETA paused';},{enableHighAccuracy:!S.low,maximumAge:S.low?10000:2000,timeout:20000});
  }
  function position(p){
    const fix={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,time:p.timestamp||Date.now()};
    if(!C.point(fix)||Date.now()-fix.time>20000||!Number.isFinite(fix.accuracy))return;
    if(S.fix&&fix.time<=S.fix.time)return;
    S.fix=fix;
    if(fix.accuracy>80){status(`GPS accuracy ±${Math.round(fix.accuracy)} m · waiting for a better fix.`);$('nav2-time').textContent='ETA paused';return;}
    if(Date.now()-S.lastPaint<(S.low?6000:S.data?4000:1000))return;S.lastPaint=Date.now();
    const snapped=C.project(fix,S.path,S.cumulative,S.along);
    if(!snapped)return;
    S.off=C.offRoute(fix,snapped.gap,S.off);
    if(snapped.gap<=Math.max(45,fix.accuracy*2))S.along=snapped.along;
    let heading=Number.isFinite(p.coords.heading)&&p.coords.speed>0.7?p.coords.heading:null;
    if(heading===null&&S.previous&&C.distance(S.previous,fix)>Math.max(8,fix.accuracy))heading=C.bearing(S.previous,fix);
    if(heading!==null){S.heading=heading;S.marker?.setIcon({path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:5,rotation:heading,fillColor:'#a9e7d3',fillOpacity:1,strokeColor:'#102b28',strokeWeight:2});}
    S.marker?.setPosition(fix);if(S.follow){map.panTo(fix);if(map.getZoom()<16)map.setZoom(16);if(S.rotate&&!S.low&&!S.data&&heading!==null&&map.getRenderingType?.()==='VECTOR'){map.setHeading(heading);map.setTilt(0);}}
    if(!S.previous||C.distance(S.previous,fix)>Math.max(8,fix.accuracy))S.previous=fix;
    $('nav2-compass').textContent=`${heading===null?'Direction needs movement':Math.round(heading)+'° travel direction'} · ${map.getRenderingType?.()==='VECTOR'?'Heading-up available':'North-up map; direction arrow available'} · GPS ±${Math.round(fix.accuracy)} m`;
    status(!navigator.onLine?'Offline · following the loaded route only; no rerouting.':S.off?'Away from route · checking your position…':S.follow?'Following your location':'Map browsing · Recenter to follow');
    if(S.off>=3){if(realMode(S.candidate)==='transit')status('Away from planned transit route. Reroute manually to check connections.');else if(S.data)status('Away from route. Data saver: press Reroute when needed.');else reroute();}
    paint();
    const near=C.distance(fix,S.path.at(-1))<30&&fix.accuracy<=35;
    if(near&&S.along!==null&&S.length-S.along<70){S.arrived=true;S.generation++;status('You are near your destination ♥');$('nav2-distance').textContent='Arrived';$('nav2-time').textContent='Journey complete';finishTracking();}
  }
  function paint(){
    const r=C.remaining(S.candidate.duration,S.candidate.distance,S.along||0,S.length);
    $('nav2-distance').innerHTML=`${fmtM(r.distance)}<small>remaining · estimated</small>`;
    const eta=new Date(Date.now()+r.seconds*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    $('nav2-time').innerHTML=S.along===null?`${fmtT(r.seconds)}<small>planned duration · awaiting GPS</small>`:`${fmtT(r.seconds)}<small>ETA ≈ ${eta}${realMode(S.candidate)==='transit'?' · schedule may change':''}</small>`;
    const i=S.steps.findIndex(s=>s.endAlong>(S.along||0)+10);S.stepIndex=i<0?Math.max(0,S.steps.length-1):i;
    const step=S.steps[S.stepIndex];$('nav2-instruction').textContent=step?`${step.instruction}${S.along!==null?' · '+fmtM(Math.max(0,step.endAlong-S.along))+' to step end':''}`:'Follow the highlighted route';
    Array.from($('nav2-steps').children).forEach((li,i)=>{if(i===S.stepIndex)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
  }
  async function reroute(manual=false){
    if(!S.active||S.arrived||S.rerouting)return;
    if(!navigator.onLine){status('Rerouting needs an internet connection.');return;}
    if(!S.fix||Date.now()-S.fix.time>20000||S.fix.accuracy>60){status('Rerouting needs a fresh, accurate GPS fix.');return;}
    if(!manual&&(S.data||Date.now()-S.lastReroute<(S.low?120000:45000)))return;
    S.lastReroute=Date.now();S.rerouting=true;const generation=S.generation;status('Updating your route…');
    try{
      const list=await route(realMode(S.candidate),S.fix,S.destination,false,S.candidate.nav2Options||{});
      if(!S.active||generation!==S.generation)return;
      if(!list.length)throw new Error('No route found');
      v14eNavigation.candidates=list;v14eNavigation.mode=realMode(S.candidate);v14eNavigation.selectedIndex=0;v14eDrawCandidate(0);setupCandidate(list[0]);status('Route updated. Waiting for the next location fix.');
    }catch(e){if(S.active&&generation===S.generation)status('Could not reroute. Previous route retained; check your connection or choose another journey.');}
    finally{if(generation===S.generation)S.rerouting=false;}
  }
  async function wake(){if(S.low||!S.active||S.arrived||document.hidden)return;const generation=S.generation;try{const lock=await navigator.wakeLock?.request('screen');if(!S.active||S.arrived||generation!==S.generation||S.low||document.hidden)await lock?.release();else S.wake=lock;}catch{}}
  function releaseWake(){S.wake?.release().catch(()=>{});S.wake=null;}
  function finishTracking(){if(S.watch!==null)navigator.geolocation.clearWatch(S.watch);S.watch=null;clearInterval(S.timer);S.timer=null;releaseWake();}
  function stop(){if(!S.active)return;S.active=false;S.generation++;finishTracking();clearTimeout(S.loveTimer);S.drag?.remove();S.marker?.setMap(null);S.marker=null;S.drag=null;S.rerouting=false;
    document.body.classList.remove('nav2-active');$('nav2-live').classList.add('hidden');for(const [element,inert] of S.inert||[])element.inert=inert;S.inert=[];
    if(S.camera){map.setCenter(S.camera.center);map.setZoom(S.camera.zoom);map.setHeading?.(S.camera.heading);map.setTilt?.(S.camera.tilt);}
    $('navigation-sheet').classList.remove('hidden');S.savedFocus?.focus();
  }
  $('nav2-stop').onclick=stop;$('nav2-follow').onclick=()=>{S.follow=true;if(S.fix)map.panTo(S.fix);watch();};$('nav2-reroute').onclick=()=>reroute(true);
  $('nav2-heading').onclick=()=>{S.rotate=!S.rotate;$('nav2-heading').textContent=S.rotate?'Heading up':'North up';$('nav2-heading').setAttribute('aria-pressed',String(S.rotate));if(!S.rotate)map.setHeading?.(0);};
  document.addEventListener('visibilitychange',()=>{if(!S.active||S.arrived)return;if(document.hidden){S.generation++;finishTracking();}else{S.fix=null;S.lastPaint=0;status('Resuming · waiting for fresh GPS.');watch();S.timer=setInterval(()=>{if(S.fix&&Date.now()-S.fix.time>20000){status('GPS stale · progress paused.');$('nav2-time').textContent='ETA paused';}},5000);S.rerouting=false;wake();}});
  window.addEventListener('pagehide',()=>{S.generation++;finishTracking();});
  window.addEventListener('offline',()=>{if(S.active)status('Offline · loaded guidance only. Rerouting and new maps need internet.');});
  window.addEventListener('online',()=>{if(S.active)status('Connection restored. Press Reroute if needed.');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(S.active)stop();else $('nav2-packs').classList.add('hidden');}});
  // Offline packs deliberately contain user-authored text only, not cached provider results.
  const packKey=()=>`everythingApp.journeyPacks.v1.${localStorage.getItem(V14D_PROFILE_STORAGE)==='ela'?'ela':'kagan'}`;
  function packs(){try{const p=JSON.parse(localStorage.getItem(packKey())||'[]');return Array.isArray(p)?p.filter(x=>x&&typeof x.title==='string'&&typeof x.notes==='string').slice(0,30):[];}catch{return [];}}
  function savePacks(p){try{localStorage.setItem(packKey(),JSON.stringify(p));return true;}catch{$('nav2-pack-status').textContent='Storage unavailable or full. Export existing packs before freeing space.';return false;}}
  function openPacks(){S.packFocus=document.activeElement;$('nav2-packs').classList.remove('hidden');renderPacks();$('nav2-pack-title').focus();}
  function renderPacks(){const list=$('nav2-pack-list');list.replaceChildren();for(const p of packs()){
    const box=document.createElement('article');box.className='nav2-pack';const h=document.createElement('h3');h.textContent=p.title;const date=document.createElement('p');date.className='nav2-note';date.textContent=`Saved ${new Date(p.created).toLocaleString()} · personal notes`;const notes=document.createElement('pre');notes.textContent=p.notes;
    const download=document.createElement('button');download.textContent='Export';download.dataset.packAction='export';download.onclick=()=>{const blob=new Blob([`${p.title}\nSaved ${p.created}\n\n${p.notes}\n\nPersonal journey notes — no offline routing.\n`],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='our-cities-journey.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const remove=document.createElement('button');remove.textContent='Remove';remove.dataset.packAction='remove';remove.onclick=()=>{const old=packs();if(savePacks(old.filter(x=>x.id!==p.id))){renderPacks();const undo=document.createElement('button');undo.textContent='Undo removal';undo.onclick=()=>{if(savePacks(old)){renderPacks();undo.remove();}};$('nav2-pack-list').prepend(undo);}};
    box.append(h,date,notes,download,remove);list.append(box);
  }if(!list.children.length)list.textContent='No journey packs saved for this profile yet.';}
  $('nav2-packs-open').onclick=openPacks;$('nav2-save').onclick=openPacks;$('nav2-packs-close').onclick=()=>{$('nav2-packs').classList.add('hidden');S.packFocus?.focus();};
  $('nav2-pack-create').onclick=()=>{const title=$('nav2-pack-title').value.trim(),notes=$('nav2-pack-notes').value.trim();if(!title||!notes){$('nav2-pack-status').textContent='Add a title and your journey notes first.';return;}const old=packs();if(old.length>=30){$('nav2-pack-status').textContent='30 packs saved. Export and remove a pack before adding another.';return;}if(savePacks([{id:crypto.randomUUID(),title,notes,created:new Date().toISOString()},...old])){$('nav2-pack-status').textContent='Saved on this device. Open Journey packs even without a map connection.';$('nav2-pack-title').value='';$('nav2-pack-notes').value='';renderPacks();}};
  // Correct the legacy geolocation shape without changing existing location controls.
  const defaultOrigin=v14eDefaultOrigin;
  v14eDefaultOrigin=function(){const c=lastUserPosition?.coords;return c&&Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)?{lat:c.latitude,lng:c.longitude,name:'Current location'}:defaultOrigin();};
  // Own the asynchronous origin update so a late GPS response cannot replace a new plan.
  $('navigation-use-location')?.addEventListener('click',async event=>{
    event.stopImmediatePropagation();const id=++requestGeneration;v14eNavigation.candidates=[];selection();
    $('navigation-status').textContent='Finding your location…';
    try{const p=await getCurrentPositionOnce();if(id!==requestGeneration)return;v15SetEndpoint('origin',{lat:p.coords.latitude,lng:p.coords.longitude,name:'Current location'});}
    catch(e){if(id===requestGeneration)$('navigation-status').textContent='Could not get your location. Allow location permission, or select a From endpoint.';}
  },true);
  $('navigation-destination-centre')?.addEventListener('click',event=>{event.stopImmediatePropagation();const p=C.point(map.getCenter());if(p)v15SetEndpoint('destination',{...p,name:'Map centre'});},true);
  for(const id of ['navigation-origin-input','navigation-destination-input'])$(id)?.addEventListener('input',()=>{requestGeneration++;v14eNavigation.candidates=[];selection();$('navigation-results').replaceChildren();});
  console.info('Navigation 2.0 v1.5B loaded');
})();
