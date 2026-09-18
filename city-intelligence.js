/* v1.5E — Four-city on-demand intelligence. No account mutation or background tracking. */
(function(){'use strict';
const C=window.CityIntelligenceCore,$=id=>document.getElementById(id);if(!C||!$('app'))return;
const state={open:false,tab:'climate',generation:0,cache:new Map(),markers:[],bikeEnabled:false,holidays:[],city:'',roadItems:[],climateMarkers:[],climateLayer:'',climateOrigin:'',climateGeneration:0,safetyCircle:null,safetyRequest:0,safetyReference:null,safetyCompareCircles:[],safetyPriorityRequest:0};
const panel=document.createElement('section');panel.id='v15e-city-panel';panel.className='v15e-city-panel hidden';panel.setAttribute('aria-label','City Intelligence');panel.innerHTML=`<header class="v15e-header"><div><small>OUR CITIES · SOURCE-AWARE DATA</small><h2 id="v15e-city-title">City Intelligence</h2></div><button id="v15e-close" type="button" aria-label="Close City Intelligence">×</button></header><nav class="v15e-tabs" aria-label="City intelligence categories"><button data-city-tab="climate">Climate</button><button data-city-tab="essentials">Essentials</button><button data-city-tab="safety">Safety intelligence</button><button data-city-tab="driving">Driving</button><button data-city-tab="bikes">Bikes</button><button data-city-tab="alerts">Alerts</button><button data-city-tab="noise">Noise</button><button data-city-tab="holidays">Holidays</button></nav><div id="v15e-city-content" class="v15e-city-content" role="status" aria-live="polite"></div><footer class="v15e-footer">City-wide readings are not street-level measurements. No unverified price, restriction, closure or warning is presented as live.</footer>`;
$('app').append(panel);
const launch=document.createElement('button');launch.id='v15e-city-open';launch.className='v15e-open';launch.type='button';launch.textContent='◈ City Intel';launch.setAttribute('aria-expanded','false');launch.setAttribute('aria-controls','v15e-city-panel');$('app').append(launch);
// Give the two layer strips visible, accessible scroll controls. Keep their original
// buttons and event handlers untouched (including dynamically appended City Intel).
function installLayerStripScroll(selector,label){
 const strip=document.querySelector(selector);if(!strip||strip.closest('.v15e-strip-wrap'))return;
 const wrapper=document.createElement('div');wrapper.className='v15e-strip-wrap';
 const button=(direction,symbol,text)=>{const b=document.createElement('button');b.type='button';b.className='v15e-strip-arrow';b.textContent=symbol;b.setAttribute('aria-label',text);b.title=text;b.addEventListener('click',()=>strip.scrollBy({left:direction*Math.max(120,strip.clientWidth*0.72),behavior:'smooth'}));return b;};
 const prev=button(-1,'‹','Scroll '+label+' left'),next=button(1,'›','Scroll '+label+' right');
 strip.parentNode.insertBefore(wrapper,strip);wrapper.append(prev,strip,next);strip.classList.add('v15e-scroll-strip');strip.setAttribute('tabindex','0');strip.setAttribute('aria-label',label+' — swipe or scroll horizontally');
 const update=()=>{prev.disabled=strip.scrollLeft<=2;next.disabled=strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-2;};
 strip.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update,{passive:true});
 // Desktop vertical mouse wheels can operate the horizontal strip; trackpads and touch
 // preserve native horizontal scrolling. Do not intercept if nothing can scroll.
 strip.addEventListener('wheel',event=>{if(event.ctrlKey||event.shiftKey||Math.abs(event.deltaX)>=Math.abs(event.deltaY)||strip.scrollWidth<=strip.clientWidth+2)return;const delta=event.deltaY;const can=delta>0?strip.scrollLeft+strip.clientWidth<strip.scrollWidth-2:strip.scrollLeft>2;if(can){event.preventDefault();strip.scrollLeft+=delta;}},{passive:false});
 if(typeof ResizeObserver==='function')new ResizeObserver(update).observe(strip);
 requestAnimationFrame(update);return update;
}
installLayerStripScroll('.layer-group[aria-label="Transportation layers"] .layer-toggle-row','Transportation layers');
const updateCityStrip=installLayerStripScroll('.layer-group[aria-label="City information layers"] .layer-toggle-row','City information layers');
const infoRow=$('panel-weather-toggle')?.parentElement;
if(infoRow){const button=document.createElement('button');button.type='button';button.className='panel-layer-toggle v15e-layer-button';button.id='v15e-city-layer';button.innerHTML='<span class="panel-layer-icon">◈</span><span class="panel-layer-label">City Intelligence</span>';infoRow.append(button);button.addEventListener('click',()=>open('climate'));const safetyButton=document.createElement('button');safetyButton.type='button';safetyButton.className='panel-layer-toggle v15e-layer-button';safetyButton.id='v15e-safety-layer';safetyButton.innerHTML='<span class="panel-layer-icon">ⓘ</span><span class="panel-layer-label">Safety Intel</span>';infoRow.append(safetyButton);safetyButton.addEventListener('click',()=>open('safety'));if(updateCityStrip)requestAnimationFrame(updateCityStrip);}
// Rename, but retain the legacy London borough/weather and wind layer wiring.
const weatherLabel=$('panel-weather-toggle')?.querySelector('.panel-layer-label');if(weatherLabel)weatherLabel.textContent='Climate Data';
$('panel-weather-toggle')?.addEventListener('click',e=>{if(cityId()!=='london'){e.preventDefault();e.stopImmediatePropagation();open('climate');}},true);
$('panel-wind-toggle')?.addEventListener('click',e=>{if(cityId()!=='london'){e.preventDefault();e.stopImmediatePropagation();open('climate');}},true);
const create=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
function link(label,url){const a=create('a',label+' ↗','v15e-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function note(parent,msg,kind='muted'){parent.append(create('p',msg,`v15e-note ${kind}`));}
function row(parent,label,value){const r=create('div',undefined,'v15e-data-row');r.append(create('span',label),create('strong',value===undefined||value===null?'Unavailable':value));parent.append(r);}
function section(parent,title){const s=create('section',undefined,'v15e-subsection');s.append(create('h3',title));parent.append(s);return s;}
function cityId(){try{return currentCityId in C.CITIES?currentCityId:'london';}catch{return 'london';}}
function hideMarkers(){state.markers.forEach(m=>m.setMap?.(null));state.markers=[];state.bikeEnabled=false;}
function hideClimate(){state.climateGeneration++;state.climateMarkers.forEach(m=>m.setMap?.(null));state.climateMarkers=[];state.climateLayer='';state.climateOrigin='';}
function hideSafety(){state.safetyRequest++;state.safetyPriorityRequest++;state.safetyReference=null;state.safetyCompareCircles.forEach(c=>c.setMap?.(null));state.safetyCompareCircles=[];if(state.safetyCircle){state.safetyCircle.setMap(null);state.safetyCircle=null;}}
function close(){state.open=false;hideSafety();state.generation++;panel.classList.add('hidden');launch.setAttribute('aria-expanded','false');}
function open(tab='climate'){if(document.body.classList.contains('nav2-active'))return;state.open=true;state.tab=tab;panel.classList.remove('hidden');launch.setAttribute('aria-expanded','true');render();}
function showMessage(msg){const p=$('v15e-city-content');p.replaceChildren();note(p,msg);}
async function fetchJson(url,ms=8500){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}}
async function cached(key,url,ttl=300000){const old=state.cache.get(key);if(old&&Date.now()-old.time<ttl)return old.value;const value=await fetchJson(url);state.cache.set(key,{time:Date.now(),value});return value;}
const fmt=(value,suffix='')=>Number.isFinite(Number(value))&&value!==null&&value!==undefined?Math.round(Number(value))+suffix:'Not available';
function dateLabel(date,zone){try{return new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(date));}catch{return String(date||'unavailable');}}
function clockFromLocalTime(local,zone){if(!local)return 'Unavailable';if(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(local))return local.slice(11,16);return dateLabel(local,zone);}
async function climate(node,id,token){const c=C.city(id);note(node,'Loading city-centre forecast and air-quality models…');
 const forecast=`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code&daily=sunrise,sunset,uv_index_max,precipitation_probability_max&forecast_days=1&timezone=${encodeURIComponent(c.zone)}`;
 const air=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lng}&current=european_aqi,pm2_5,pm10,uv_index,grass_pollen,birch_pollen,olive_pollen&timezone=${encodeURIComponent(c.zone)}`;
 const results=await Promise.allSettled([cached('forecast:'+id,forecast,10*60000),cached('air:'+id,air,15*60000)]);if(token!==state.generation)return;
 node.replaceChildren();const one=results[0].status==='fulfilled'?results[0].value:null,two=results[1].status==='fulfilled'?results[1].value:null;
 const weather=section(node,'Climate Data');if(one?.current){const v=one.current,d=one.daily||{};row(weather,'Temperature',fmt(v.temperature_2m,'°C'));row(weather,'Feels like',fmt(v.apparent_temperature,'°C'));row(weather,'Humidity',fmt(v.relative_humidity_2m,'%'));row(weather,'Wind',fmt(v.wind_speed_10m,' km/h'));row(weather,'Wind from',fmt(v.wind_direction_10m,'°')); row(weather,'Rain probability (today)',fmt(d.precipitation_probability_max?.[0],'%'));row(weather,'Sunrise',clockFromLocalTime(d.sunrise?.[0],c.zone));row(weather,'Sunset',clockFromLocalTime(d.sunset?.[0],c.zone));row(weather,'UV maximum (today)',fmt(d.uv_index_max?.[0]));note(weather,`Forecast/model · location: ${c.name} centre · reported ${v.time||'time unavailable'} (local) · not a district-by-district observation.`);}
 else note(weather,'Forecast unavailable. Check connection or Open-Meteo provider.', 'warn');weather.append(link('Forecast provider','https://open-meteo.com/en/docs'));
 const airBox=section(node,'Air quality · UV · pollen');if(two?.current){const v=two.current;row(airBox,'European AQI',v.european_aqi==null?'Unavailable':`${Math.round(v.european_aqi)} · ${C.aqiLabel(v.european_aqi)}`);row(airBox,'PM2.5',fmt(v.pm2_5,' μg/m³'));row(airBox,'PM10',fmt(v.pm10,' μg/m³'));row(airBox,'UV now',fmt(v.uv_index));for(const name of ['grass_pollen','birch_pollen','olive_pollen'])row(airBox,name.replace('_',' ').replace(/^./,x=>x.toUpperCase()),v[name]==null?'Not covered for this city / season':fmt(v[name],' grains/m³'));note(airBox,`Open-Meteo modelled air quality · ${v.time||'time unavailable'} (local). Pollen only where the provider offers it; not a live street sensor.`);}
 else note(airBox,'Air-quality model unavailable. No AQI, UV or pollen value inferred.', 'warn');airBox.append(link('Air-quality data provider','https://open-meteo.com/en/docs/air-quality-api'));
 const controls=section(node,'Optional climate map layer');note(controls,'Nine sampled forecasts near the CURRENT MAP CENTRE, not exact district conditions. Never a live sensor or street-by-street heatmap. Choose one layer at a time; switching cities clears it.');for(const [type,label] of [['temperature','Temperature sample grid'],['wind','Wind direction & speed grid'],['aqi','City-centre AQI badge']]){const button=create('button',label,'v15e-chip');button.type='button';button.onclick=()=>climateLayer(type,button);controls.append(button);}
 if(state.climateLayer)note(controls,'Active: '+state.climateLayer+'. Layer stays on map when this panel closes; tap its button again to hide.');
}

async function climateLayer(type,button){
 if(state.climateLayer===type){hideClimate();button.textContent='Show '+button.textContent.replace(/^Hide /,'');return;}
 hideClimate();if(!window.google?.maps||typeof map==='undefined'||!map){button.textContent='Map unavailable';return;}
 if(!navigator.onLine){button.textContent='Offline · data unavailable';return;}
 const id=cityId(),c=C.city(id),token=++state.climateGeneration;button.disabled=true;const original=button.textContent;button.textContent='Loading samples…';
 try{
  if(type==='aqi'){
   const air=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lng}&current=european_aqi&timezone=${encodeURIComponent(c.zone)}`;
   const data=await cached('air-marker:'+id,air,10*60000);if(token!==state.climateGeneration||id!==cityId())return;const aqi=C.safeNumber(data?.current?.european_aqi);
   if(aqi===null)throw Error('No AQI result');const pin=new google.maps.Marker({map,position:{lat:c.lat,lng:c.lng},zIndex:110,title:`Modelled EU AQI ${aqi} · ${c.name} centre · ${data.current.time||'time unknown'}`,label:{text:`AQ ${Math.round(aqi)}`,color:'#132f28',fontSize:'12px',fontWeight:'bold'},icon:{path:google.maps.SymbolPath.CIRCLE,scale:22,fillColor:'#b8f4dc',fillOpacity:0.95,strokeColor:'#26473d',strokeWeight:2}});state.climateMarkers=[pin];
  }else{
   const centre=map.getCenter(),lat=typeof centre.lat==='function'?centre.lat():c.lat,lng=typeof centre.lng==='function'?centre.lng():c.lng;
   const spots=[];for(const dl of [-.04,0,.04])for(const dg of [-.055,0,.055])spots.push({lat:lat+dl,lng:lng+dg});
   const url='https://api.open-meteo.com/v1/forecast?latitude='+spots.map(p=>p.lat.toFixed(5)).join(',')+'&longitude='+spots.map(p=>p.lng.toFixed(5)).join(',')+'&current=temperature_2m,wind_speed_10m,wind_direction_10m&timezone='+encodeURIComponent(c.zone);
   const data=await cached('grid:'+id+':'+lat.toFixed(3)+':'+lng.toFixed(3),url,10*60000);if(token!==state.climateGeneration||id!==cityId())return;
   const rows=Array.isArray(data)?data:[data];if(rows.length!==spots.length)throw Error('Provider did not return nine samples');
   state.climateMarkers=rows.map((d,i)=>{const v=d?.current||{},temp=C.safeNumber(v.temperature_2m),wind=C.safeNumber(v.wind_speed_10m),direction=C.safeNumber(v.wind_direction_10m);if(type==='temperature'&&temp===null||type==='wind'&&(wind===null||direction===null))return null;
    const label=type==='temperature'?`${Math.round(temp)}°`:`${Math.round(wind)}↗`;
    return new google.maps.Marker({map,position:spots[i],zIndex:105,title:`Open-Meteo forecast ${dateLabel(v.time,c.zone)} · sampled grid · ${temp===null?'Temp N/A':temp+'°C'} · ${wind===null?'Wind N/A':wind+' km/h'} · wind from ${direction===null?'unknown':direction+'°'}`,label:{text:label,color:'#103229',fontWeight:'bold',fontSize:'11px'},icon:{path:google.maps.SymbolPath.CIRCLE,scale:18,fillColor:type==='temperature'?'#ffd9a4':'#aee3ff',fillOpacity:0.94,strokeColor:'#264253',strokeWeight:2}});
   }).filter(Boolean);
   if(!state.climateMarkers.length)throw Error('No valid sample readings');state.climateOrigin=`${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  state.climateLayer=type;button.textContent='Hide '+original;setTimeout(()=>{if(token===state.climateGeneration)hideClimate();},10*60000);
 }catch(err){if(token===state.climateGeneration){hideClimate();button.textContent='Layer unavailable · retry';console.warn('Climate grid',err);}}
 finally{button.disabled=false;}
}

function essentials(node,id){const c=C.city(id);const s=section(node,'Already in your app');note(s,'Smart Essentials, place search, opening hours and walking directions are preserved. Open the existing Places controls or search for hospitals, pharmacies, toilets, ATMs and supermarkets. No duplicate POI billing or new background searches.');
 for(const kind of ['hospital','pharmacy','public toilet','ATM','supermarket']){const b=create('button','⌕ '+kind,'v15e-chip');b.type='button';b.onclick=()=>{close();const search=$('search-input');if(search){search.value=kind;search.focus();search.dispatchEvent(new Event('input',{bubbles:true}));}else showMessage('Use Places search.');};s.append(b);}
 const safety=section(node,'Safety & recorded incidents');note(safety,'Open Safety Intelligence for source-linked local crime reports, a transparent London neighbourhood comparison index and community policing priorities. No street is guaranteed safe.');const b=create('button','Open Safety Intelligence →','v15e-chip');b.type='button';b.addEventListener('click',()=>{state.tab='safety';render();});safety.append(b);}
// v1.5E.2: Evidence-linked local reports index. Never assign a probability of harm or
// rate a street safe: Police.uk locations are anonymised and the API is monthly.
function safetyData(node,id){
 const c=C.city(id),intro=section(node,'Safety intelligence · published evidence');
 note(intro,'Compare published crime reports, not personal risk. No report can guarantee a walking route is safe; Police.uk positions are anonymised, many incidents go unreported and monthly figures cannot describe conditions right now.','warn');
 row(intro,'City',c.name);
 if(id==='london'){
  row(intro,'Data','Police.uk · approximately 1-mile radius · latest published month');
  intro.append(link('Police.uk map and methodology','https://www.police.uk/pu/about-police.uk-crime-data/'));
  intro.append(link('Met neighbourhood crime dashboard (official area rates)','https://www.met.police.uk/police-forces/metropolitan-police/areas/stats-and-data/stats-and-data/'));
  intro.append(link('Met knife-enabled crime tables (borough figures)','https://www.met.police.uk/police-forces/metropolitan-police/areas/stats-and-data/stats-and-data/met/knife-enabled-crime/'));
  note(intro,'The published broad violence/sexual-offences category is NOT a stabbing count; weapon possession is NOT the same as knife attacks. The Met provides separate knife-crime tables.');
  const summary=section(node,'Current map area · actual published counts');
  note(summary,'Centre the map on an area and request the latest month. Your GPS location is not queried.');
  const load=create('button','Load reports for map centre','v15e-chip');load.type='button';load.onclick=()=>loadSafetyLondon(summary,load);intro.append(load);
  const compare=section(node,'Local reports index · compare two areas');
  note(compare,'Set a reference neighbourhood, then pan the map to another neighbourhood. Both are compared using the SAME month, 1-mile radius and recorded-crime categories. Reference = 100; 150 means 50% more published reports, NOT 50% more chance of being attacked. This is not a London-wide percentile or a street safety rating.');
  const actions=create('div',undefined,'v15e-safety-actions');
  const base=create('button','1 · Set reference here','v15e-chip');base.type='button';
  const candidate=create('button','2 · Compare map centre','v15e-chip');candidate.type='button';candidate.disabled=true;
  const clear=create('button','Clear comparison','v15e-chip');clear.type='button';
  actions.append(base,candidate,clear);compare.append(actions);
  const result=create('div',undefined,'v15e-safety-comparison');compare.append(result);
  note(result,'No reference selected. Pan the map to your first neighbourhood, then click Set reference.');
  base.onclick=()=>loadSafetyReference(result,base,candidate);
  candidate.onclick=()=>compareSafetyArea(result,candidate);
  clear.onclick=()=>{hideSafety();candidate.disabled=true;result.replaceChildren();note(result,'Comparison cleared. No areas are stored after you close Safety Intelligence.');};
  const community=section(node,'What locals and neighbourhood police report');
  note(community,'Find the local policing team and its publicly documented community priorities for the map centre. These are concerns raised by residents/police, not verified current danger on every street.');
  const priorities=create('button','Load local policing priorities','v15e-chip');priorities.type='button';const priorityResults=create('div');community.append(priorities,priorityResults);
  priorities.onclick=()=>loadSafetyPriorities(priorityResults,priorities);
  community.append(link('Police.uk · neighbourhood search','https://www.police.uk/pu/your-area/'));
 }else if(id==='rome'){
  row(intro,'Comparable local reports index','Unavailable — no verified same-scale neighbourhood feed integrated');
  intro.append(link('Roma Capitale published crime statistics (city totals)','https://www.comune.roma.it/web/it/roma-statistica-legalita-e-sicurezza1.page'));
  intro.append(link('Roma Capitale statistical dashboard','https://www.comune.roma.it/web/it/dashboard.page'));
  note(intro,'The latest integrated public material does not locate incidents for individual streets; city-level numbers cannot responsibly rate a neighbourhood.','warn');
 }else{
  row(intro,'Comparable local reports index','Unavailable — no verified district-level comparable feed integrated');
  intro.append(link('Türkiye crime victimisation survey (national, not district data)','https://veriportali.tuik.gov.tr/tr/press/62061'));
  intro.append(link('Emniyet Genel Müdürlüğü · official information','https://www.egm.gov.tr/'));
  note(intro,'National crime-victimisation data do not support street-level claims for '+c.name+'. Anonymous anecdotes, social-media comments and personal Not to Go markers are not converted into numerical risk scores.','warn');
 }
 const context=section(node,'Practical context');
 note(context,'A lower reports index does NOT imply a safe street. Compare sources and the date, use well-used and illuminated routes when practical, and seek a staffed place or contact emergency services if you feel threatened. No automatic rerouting is performed from this index.');
}
function safetyCentre(){const pos=typeof map!=='undefined'&&map?.getCenter?.();if(!pos)return null;const lat=pos.lat(),lng=pos.lng();return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;}
async function safetyFetch(center,date){const key=`police:${center.lat.toFixed(4)}:${center.lng.toFixed(4)}:${date||'latest'}`;const url=`https://data.police.uk/api/crimes-street/all-crime?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}${date?'&date='+encodeURIComponent(date):''}`;const rows=await cached(key,url,20*60000);const summary=C.reportsSummary(rows);if(!summary.month)throw Error('Missing or mixed reference months');if(date&&summary.month!==date)throw Error('Provider returned a different month');return {center,summary,rows};}
function markSafetyArea(center,colour,title){if(!window.google?.maps||typeof map==='undefined'||!map)return;const shape=new google.maps.Circle({map,center,radius:1609.344,strokeColor:colour,strokeOpacity:.97,strokeWeight:3,fillColor:colour,fillOpacity:.09,clickable:false});state.safetyCompareCircles.push(shape);}
function safetyRows(node,s){row(node,'Published month',s.month);row(node,'All reports (including ASB)',String(s.all));row(node,'Crimes (excluding ASB)',String(s.crimes));row(node,'Violence + sexual offences (combined)',String(s.violent));row(node,'Robbery',String(s.robbery));row(node,'Possession of weapons',String(s.weapons));row(node,'Anti-social behaviour',String(s.asb));}
async function loadSafetyLondon(target,button){
 if(cityId()!=='london')return;const token=++state.safetyRequest,renderToken=state.generation;target.replaceChildren();
 if(navigator.onLine===false){note(target,'Offline: published crime reports cannot be refreshed.','warn');return;}
 const center=safetyCentre();if(!center){note(target,'Map location unavailable.','warn');return;}
 button.disabled=true;button.textContent='Loading source data…';note(target,'Requesting latest Police.uk month…');
 try{const info=await safetyFetch(center);if(token!==state.safetyRequest||renderToken!==state.generation||cityId()!=='london')return;
 target.replaceChildren();target.append(create('h3','Published crime reports · map centre'));safetyRows(target,info.summary);
 note(target,'Same 1-mile area around the selected map centre. Locations are anonymised. These are recorded counts, not crime rates, knife attacks or safety guarantees.');target.append(link('Source and methodology','https://data.police.uk/about/'));
 }catch{if(token===state.safetyRequest&&renderToken===state.generation){target.replaceChildren();note(target,'Police.uk data unavailable or invalid. No zero count or index is inferred.','warn');target.append(link('View Police.uk map','https://www.police.uk/pu/your-area/'));}}
 finally{if(token===state.safetyRequest){button.disabled=false;button.textContent='Refresh reports for map centre';}}
}
async function loadSafetyReference(target,button,compareButton){
 const token=++state.safetyRequest,renderToken=state.generation,centre=safetyCentre();
 if(!centre||navigator.onLine===false){target.replaceChildren();note(target,'Online map location required.','warn');return;}
 button.disabled=true;compareButton.disabled=true;target.replaceChildren();note(target,'Fetching reference-month reports…');
 try{const info=await safetyFetch(centre);if(token!==state.safetyRequest||renderToken!==state.generation||cityId()!=='london')return;
  state.safetyReference=info;state.safetyCompareCircles.forEach(c=>c.setMap(null));state.safetyCompareCircles=[];
  target.replaceChildren();target.append(create('h3','Reference · index 100'));
  safetyRows(target,info.summary);markSafetyArea(centre,'#9fb1cf','Reference');
  if(info.summary.crimes>0){compareButton.disabled=false;note(target,'Reference pinned to this map area. Pan to another part of London and compare. Grey circle = reference.');}
  else note(target,'Reference area has zero reported crimes in this month, so a relative index would divide by zero. Select another reference.','warn');
 }catch{if(token===state.safetyRequest&&renderToken===state.generation){state.safetyReference=null;target.replaceChildren();note(target,'Reference data unavailable. Index not calculated.','warn');}}
 finally{if(token===state.safetyRequest)button.disabled=false;}
}
async function compareSafetyArea(target,button){
 const ref=state.safetyReference,centre=safetyCentre();if(!ref||!centre)return;
 if(Math.abs(centre.lat-ref.center.lat)<.002&&Math.abs(centre.lng-ref.center.lng)<.002){note(target,'Move the map to a different area before comparing.','warn');return;}
 const token=++state.safetyRequest,renderToken=state.generation;button.disabled=true;
 const progress=create('p','Comparing the same publication month…','v15e-note');target.append(progress);
 try{const current=await safetyFetch(centre,ref.summary.month);if(token!==state.safetyRequest||renderToken!==state.generation||cityId()!=='london')return;
  const index=C.reportsIndex(ref.summary,current.summary);progress.remove();if(index===null){note(target,'Reference month/count mismatch. Cannot calculate a comparable index.','warn');return;}
  state.safetyCompareCircles.slice(1).forEach(c=>c.setMap(null));state.safetyCompareCircles=state.safetyCompareCircles.slice(0,1);
  const color=index>120?'#ef946d':index<80?'#64b9de':'#f0c86a';markSafetyArea(centre,color,'Comparison');
  const report=section(target,'Compared area · published reports');
  const pill=create('div','Reports index: '+index+' · reference 100','v15e-index');pill.style.borderColor=color;report.append(pill);
  row(report,'Reference crimes',String(ref.summary.crimes));row(report,'Compared-area crimes',String(current.summary.crimes));
  row(report,'Interpretation',index===100?'Same number of published crimes':index>100?`${index-100}% more published crimes in equal-sized search area`:`${100-index}% fewer published crimes in equal-sized search area`);
  safetyRows(report,current.summary);
  note(report,'Index = 100 × compared recorded crimes ÷ reference recorded crimes; excludes ASB. Same month and search radius. This is NOT a personal risk estimate, citywide percentile, precise street heatmap or a prediction about a route. Grey = reference; coloured ring = comparison.');
  report.append(link('Police.uk source & anonymisation','https://data.police.uk/about/'));
 }catch{progress.remove();note(target,'Comparison feed unavailable; previous results have not been treated as current.','warn');}
 finally{if(token===state.safetyRequest)button.disabled=false;}
}
async function loadSafetyPriorities(target,button){
 const centre=safetyCentre(),token=++state.safetyPriorityRequest,renderToken=state.generation;target.replaceChildren();
 if(!centre||navigator.onLine===false){note(target,'Online map location required.','warn');return;}
 button.disabled=true;note(target,'Locating the neighbourhood policing team…');
 try{const q=`${centre.lat.toFixed(5)},${centre.lng.toFixed(5)}`;
 const loc=await cached('police-neighbourhood:'+q,'https://data.police.uk/api/locate-neighbourhood?q='+encodeURIComponent(q),30*60000);
 if(token!==state.safetyPriorityRequest||renderToken!==state.generation||cityId()!=='london')return;
 const force=String(loc?.force||''),id=String(loc?.neighbourhood||'');if(!/^[a-z0-9-]{2,48}$/i.test(force)||!/^[a-z0-9-]{2,60}$/i.test(id))throw Error('No neighbourhood available');
 const priorities=await cached('police-priorities:'+force+':'+id,`https://data.police.uk/api/${encodeURIComponent(force)}/${encodeURIComponent(id)}/priorities`,30*60000);
 if(token!==state.safetyPriorityRequest||renderToken!==state.generation||cityId()!=='london')return;
 target.replaceChildren();row(target,'Reporting police force',force);
 if(!Array.isArray(priorities)||priorities.length===0)note(target,'No published priorities returned. This does not imply there are no local concerns.');
 for(const p of (Array.isArray(priorities)?priorities:[]).slice(0,5)){const card=create('article',undefined,'v15e-event');card.append(create('strong',String(p.issue||'Community priority').trim().slice(0,420)));if(p['issue-date'])note(card,'Issued: '+String(p['issue-date']).slice(0,10));if(p.action)note(card,'Police response: '+String(p.action).trim().slice(0,450));target.append(card);}
 note(target,'Police and resident priorities describe documented concerns and actions, not measured safety or live hazards. Confirm latest details on the police website.');target.append(link('Official neighbourhood source','https://www.police.uk/pu/your-area/'));
 }catch{if(token===state.safetyPriorityRequest&&renderToken===state.generation){target.replaceChildren();note(target,'Neighbourhood priorities unavailable from provider. Consult Police.uk directly.','warn');target.append(link('Police.uk · your area','https://www.police.uk/pu/your-area/'));}}
 finally{if(token===state.safetyPriorityRequest)button.disabled=false;}
}
function driving(node,id){const c=C.city(id),s=section(node,'Driving restrictions, tolls & costs');
 if(id==='london'){row(s,'Congestion Charge','£18/day where applicable (2026)');row(s,'ULEZ','£12.50/day for non-compliant vehicles');note(s,'Neither charge is automatically applied to an arbitrary route. Exact liability depends on street, travel time, vehicle, registration and exemptions. Blackwall/Silvertown tunnel charges may also apply.');}
 else if(id==='rome'){row(s,'City centre','ZTL: permits, hours and street boundaries matter');row(s,'Fascia Verde','Vehicle emissions restrictions may apply');note(s,'A route passing near an Italian ZTL is not proof of access. Confirm official map, current hours and vehicle class. No amount estimated.');}
 else{row(s,'Motorways & bridges','HGS / operator-dependent fees');note(s,'Actual amount requires entrance, exit, direction, vehicle class and the operator. There is no safe generic trip fee. Verify official KGM and concession operator notices.');}
 s.append(link(id==='london'?'TfL check & pay official':id==='rome'?'Roma Mobilità ZTL maps':'KGM toll calculator',c.drive));
 const roads=section(node,'Road closures & construction');note(roads,'Traffic overlay is already present. Verified closure notices are displayed only if the source provides information, otherwise open the official road-status portal. Locations and route effects are not inferred from headlines.');roads.append(link('Official road and construction updates',c.road));if(id==='london')loadRoads(roads,state.generation);
}
async function loadRoads(target,token){const sub=section(target,'TfL published road disruptions');note(sub,'Loading TfL notices…');try{const rows=await cached('tfl-roads','https://api.tfl.gov.uk/Road/all/Disruption',3*60000);if(token!==state.generation)return;sub.replaceChildren(create('h3','TfL published road disruptions'));
 if(!Array.isArray(rows)||!rows.length){note(sub,'No usable disruptions returned. This does not guarantee open roads.');return;}
 const now=Date.now(),active=rows.filter(r=>!r.endDateTime||Date.parse(r.endDateTime)>=now).slice(0,8);for(const r of active){const item=create('article',undefined,'v15e-event');item.append(create('strong',String(r.location||r.category||'Road disruption').slice(0,120)));note(item,String(r.comments||r.description||'See provider for details.').slice(0,320));if(r.startDateTime)note(item,'Reported start: '+new Date(r.startDateTime).toLocaleString());sub.append(item);}note(sub,'TfL listing may not cover all closures; route intersection cannot be verified from text-only records.');}
 catch{if(token===state.generation){sub.replaceChildren(create('h3','TfL published road disruptions'));note(sub,'Live disruption feed unavailable; check the official road page.', 'warn');}}}
async function bikes(node,id,token){const c=C.city(id);const s=section(node,'Shared bikes and e-scooters');note(s,'Live location, dock availability and prices are displayed only when supplied by an operator. Never assume a scooter is available just because it operates in the city.');s.append(link('Official bike / micromobility service',c.bike));
 if(id!=='london'){note(s,`${c.name}: a reliable public real-time vehicle/station feed has not been integrated. Open the operator’s official app/site for availability and rental cost.`, 'warn');return;}
 const live=section(node,'Santander Cycles · nearby docks');note(live,'Fetching TfL station locations…');try{const list=await cached('tfl-bike-points','https://api.tfl.gov.uk/BikePoint',8*60000);if(token!==state.generation)return;const near=C.nearest(Array.isArray(list)?list:[],{lat:c.lat,lng:c.lng},7);live.replaceChildren(create('h3','Santander Cycles · nearby city-centre docks'));if(!near.length){note(live,'Station list empty. Use official provider link.');return;}
 // The bulk BikePoint listing intentionally does not include live occupancy; fetch each individual station.
 const details=await Promise.allSettled(near.slice(0,6).map(b=>fetchJson('https://api.tfl.gov.uk/BikePoint/'+encodeURIComponent(String(b.id)),5500)));if(token!==state.generation)return;
 details.forEach((res,i)=>{const basic=near[i],p=res.status==='fulfilled'?res.value:basic,props=p.additionalProperties||[];const number=k=>{const entry=props.find(x=>x.key===k);return entry&&Number.isFinite(Number(entry.value))?Number(entry.value):null;};const bikes=number('NbBikes'),docks=number('NbEmptyDocks');const card=create('article',undefined,'v15e-event');card.append(create('strong',String(p.commonName||basic.commonName||'Bike dock')));note(card,`Bikes: ${bikes===null?'Unavailable':bikes} · Empty docks: ${docks===null?'Unavailable':docks} · ${res.status==='fulfilled'?'TfL station details':'Station details unavailable'}`);live.append(card);
 if(res.status==='fulfilled'&&window.google?.maps&&typeof map!=='undefined'&&map){const mark=new google.maps.Marker({map:state.bikeEnabled?map:null,position:{lat:Number(p.lat),lng:Number(p.lon)},title:`${p.commonName}: ${bikes===null?'bikes unknown':bikes+' bikes'}, ${docks===null?'docks unknown':docks+' empty docks'}`,icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:'#41cbb1',fillOpacity:1,strokeColor:'#072c2a',strokeWeight:2}});state.markers.push(mark);}}
 );const toggle=create('button',state.bikeEnabled?'Hide bike dock map layer':'Show bike docks on map','v15e-chip');toggle.onclick=()=>{state.bikeEnabled=!state.bikeEnabled;state.markers.forEach(m=>m.setMap(state.bikeEnabled?map:null));toggle.textContent=state.bikeEnabled?'Hide bike dock map layer':'Show bike docks on map';};live.prepend(toggle);note(live,'TfL station details fetched on demand. Counts can change rapidly. Showing docks nearest the city centre, not your GPS position.');}
 catch{if(token===state.generation){live.replaceChildren(create('h3','Santander Cycles'));note(live,'TfL bike feed unavailable; live bike/dock counts are not verified.','warn');}}}
function alerts(node,id){const c=C.city(id),s=section(node,'Official weather & city warnings');note(s,'No official active-alert feed has been verified for all four cities. There is no claim that the absence of alerts below means conditions are safe. Open your city’s issuing authority for warnings, expiry times and affected areas.');s.append(link('Official weather warnings',c.warning));const r=section(node,'Construction & transport notices');r.append(link('Road closure notices',c.road),link('Transport operator status',c.transport));note(r,'The official portals provide authoritative notices. Automated matching to your exact route is unavailable without geocoded, licensed disruption data.');}
function noise(node,id){const c=C.city(id),s=section(node,'Noise pollution · source map');note(s,id==='london'?'England’s DEFRA strategic road/rail noise maps describe modelled conditions from a historical reference period (2021), published in 2024. This is NOT live noise and must not be applied to a specific street without the geographic data.':'A verified reusable city noise geometry feed has not been integrated for this city. Showing a coloured local noise map without values would be misleading.');s.append(link(id==='london'?'Open DEFRA strategic noise maps':'Open European noise observation map',c.noise));note(s,'In-app noise heatmap unavailable until comparable licensed, georeferenced datasets are integrated.');}
async function holidays(node,id,token){const c=C.city(id);note(node,'Checking public holiday calendar…');try{const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:c.zone,year:'numeric'}).format(new Date()));const dateParts=new Intl.DateTimeFormat('en-GB',{timeZone:c.zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const datePart=n=>dateParts.find(x=>x.type===n)?.value;const dateNow=[datePart('year'),datePart('month'),datePart('day')].join('-');const [current,next]=await Promise.allSettled([cached('holiday:'+c.country+':'+year,`https://date.nager.at/api/v3/PublicHolidays/${year}/${c.country}`,24*60*60000),cached('holiday:'+c.country+':'+(year+1),`https://date.nager.at/api/v3/PublicHolidays/${year+1}/${c.country}`,24*60*60000)]);if(token!==state.generation)return;node.replaceChildren();const s=section(node,'Upcoming public holidays');const rows=[...(current.status==='fulfilled'?current.value:[]),...(next.status==='fulfilled'?next.value:[])];const upcoming=C.holidaysForCity(rows,id,dateNow);if(!upcoming.length)note(s,'Holiday data unavailable or no upcoming confirmed entries.','warn');for(const h of upcoming){const el=create('article',undefined,'v15e-event');el.append(create('strong',`${h.date} · ${h.localName||h.name}`));note(el,'Country/subdivision calendar · not a guarantee of individual business hours or transport timetables.');s.append(el);}note(s,'Calendar: Nager.Date, country-level holidays; city-only observances may be missing. Check operators for holiday schedules.');s.append(link('Calendar provider','https://date.nager.at/'));const special=section(node,'Special opening hours / service times');special.append(link('Official public-transport service notices',c.transport));note(special,'A public holiday does not prove a timetable or shop-hour change. Only provider-published special hours count.');}
 catch{if(token===state.generation){node.replaceChildren();note(node,'Holiday provider unavailable; no dates inferred.','warn');node.append(link('Calendar provider','https://date.nager.at/'));}}}
async function render(){const id=cityId(),c=C.city(id),token=++state.generation;if(id!==state.city){hideMarkers();hideClimate();hideSafety();}state.city=id;$('v15e-city-title').textContent=c.name+' · City Intelligence';panel.querySelectorAll('[data-city-tab]').forEach(b=>{const active=b.dataset.cityTab===state.tab;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});const node=$('v15e-city-content');node.replaceChildren();if(!navigator.onLine&&['climate','bikes','holidays'].includes(state.tab))note(node,'You are offline. Previously fetched dynamic city data is not shown as current.','warn');
 try{switch(state.tab){case 'climate':await climate(node,id,token);break;case 'essentials':essentials(node,id);break;case 'safety':safetyData(node,id);break;case 'driving':driving(node,id);break;case 'bikes':await bikes(node,id,token);break;case 'alerts':alerts(node,id);break;case 'noise':noise(node,id);break;case 'holidays':await holidays(node,id,token);break;default:essentials(node,id);}}
 catch(e){if(token===state.generation){node.replaceChildren();note(node,'Provider data unavailable. Check connection and source links; nothing has been estimated.', 'warn');console.warn('City Intelligence',e);}}
}
launch.onclick=()=>state.open?close():open('climate');$('v15e-close').onclick=close;panel.querySelectorAll('[data-city-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.cityTab;render();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.open)close();});
document.querySelectorAll('[data-city]').forEach(b=>b.addEventListener('click',()=>{if(state.open)setTimeout(()=>{if(cityId()!==state.city)render();},50);}));
const oldSwitch=typeof switchCity==='function'?switchCity:null;if(oldSwitch){switchCity=async function(...args){close();hideMarkers();hideClimate();hideSafety();return oldSwitch.apply(this,args);};}
$('nav2-go')?.addEventListener('click',()=>{close();hideMarkers();hideClimate();hideSafety();});
window.CityIntelligence={open,close,render};console.info('v1.5E.2 City Intelligence and sourced area crime comparison available; no street risk predictions.');
})();
