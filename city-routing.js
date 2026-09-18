/* v1.5E route-level fares and opt-in, provider-derived segment traffic.
   Never fabricate congestion by splitting legacy Directions polylines. */
(function(){'use strict';
const C=window.CityIntelligenceCore,$=id=>document.getElementById(id);if(!C||!$('navigation-results')||typeof v14eDrawCandidate!=='function')return;
const traffic={enabled:false,generation:0,polys:[],routes:[],matches:new Map(),fingerprint:'',inflight:false};
const selected=()=>v14eNavigation.candidates?.[v14eNavigation.selectedIndex]||null;
const activeCity=()=>{try{return currentCityId;}catch{return'london';}};
const el=(tag,content,cls)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);if(cls)n.className=cls;return n;};
const link=(title,url)=>{const a=el('a',title+' ↗','v15e-route-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const panel=el('section',undefined,'v15e-traffic-tools');panel.id='v15e-traffic-tools';panel.innerHTML='<div class="v15e-route-heading"><strong>Traffic along driving routes</strong><span>Provider data · on demand</span></div><div class="v15e-traffic-actions"><button type="button" id="v15e-traffic-load">Show red / yellow / green traffic</button><button type="button" id="v15e-traffic-hide" disabled>Hide details</button></div><p id="v15e-traffic-status" role="status">Google traffic-aware polylines require a separate, potentially higher-priced Routes API call. Off by default. Normal Traffic layer still works.</p><div class="v15e-traffic-key"><span>● Normal flow</span><span>● Slow</span><span>● Congestion</span></div>';
$('navigation-results').insertAdjacentElement('afterend',panel);
const fareBox=el('section',undefined,'v15e-fare-box');fareBox.id='v15e-fare-box';
const transport=$('transport-intelligence');if(transport){$('transport-intel-fare')?.insertAdjacentElement('afterend',fareBox);}else $('navigation-results').insertAdjacentElement('afterend',fareBox);
function announce(msg){$('v15e-traffic-status').textContent=msg;}
function clearLines(){traffic.polys.forEach(p=>p.setMap?.(null));traffic.polys=[];}
function reset(message='New route: press Show traffic again for fresh information.'){traffic.generation++;traffic.enabled=false;traffic.inflight=false;traffic.routes=[];traffic.matches.clear();traffic.fingerprint='';clearLines();$('v15e-traffic-hide').disabled=true;$('v15e-traffic-load').disabled=false;announce(message);}
function isDrive(c){return ['drive','taxi'].includes(c?.nav2Mode||c?.fastestMode||v14eNavigation.mode);}
function point(p){const lat=typeof p?.lat==='function'?p.lat():Number(p?.lat),lng=typeof p?.lng==='function'?p.lng():Number(p?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;}
function hav(a,b){const x=(a.lat-b.lat)*111000,y=(a.lng-b.lng)*111000*Math.cos(a.lat*Math.PI/180);return Math.hypot(x,y);}
function nearestDistance(p,path){let min=Infinity;for(let i=0;i<path.length;i++){const q=point(path[i]);if(q)min=Math.min(min,hav(p,q));}return min;}
// Geometry matching is intentionally conservative: a newly computed road must closely track
// the legacy navigation geometry, or the app refuses to label it as that route's traffic.
function closeness(candidate,route){const x=(candidate?.path||[]).map(point).filter(Boolean),y=(route?.path||[]).map(point).filter(Boolean);if(x.length<2||y.length<2)return null;if(hav(x[0],y[0])>250||hav(x.at(-1),y.at(-1))>250)return null;
 const distance=(src,dst)=>{const samples=Math.min(18,src.length),dist=[];for(let i=0;i<samples;i++){const idx=Math.round(i*(src.length-1)/Math.max(1,samples-1));dist.push(nearestDistance(src[idx],dst));}return dist;};
 const xs=distance(x,y),ys=distance(y,x),joined=xs.concat(ys);const avg=joined.reduce((a,b)=>a+b,0)/joined.length,coverage=joined.filter(v=>v<85).length/joined.length;return avg<45&&coverage>.82?avg:null;}
function matchRoutes(){traffic.matches.clear();const used=new Set(),candidates=v14eNavigation.candidates||[];for(let i=0;i<candidates.length;i++){const cand=candidates[i];if(!isDrive(cand))continue;let best=null,score=Infinity;traffic.routes.forEach((r,index)=>{if(used.has(index))return;const s=closeness(cand,r);if(s!==null&&s<score){score=s;best=index;}});if(best!==null){used.add(best);traffic.matches.set(i,best);}}}
function overlay(){clearLines();if(!traffic.enabled||!traffic.routes.length)return;matchRoutes();const chosen=v14eNavigation.selectedIndex;
 for(const [idx,rIdx] of traffic.matches){const route=traffic.routes[rIdx],chosenRoute=idx===chosen;if(!Array.isArray(route.speedPaths)||!route.speedPaths.length)continue;for(const sp of route.speedPaths){const path=(sp.path||[]).map(point).filter(Boolean);if(path.length<2)continue;const category=String(sp.speed||'').toUpperCase();const color=category==='NORMAL'?'#31d26e':category==='SLOW'?'#f6be37':category==='TRAFFIC_JAM'?'#ee4755':null;if(!color)continue;
 const poly=new google.maps.Polyline({map,path,strokeColor:color,strokeWeight:chosenRoute?8:5,strokeOpacity:chosenRoute?1:0.83,zIndex:chosenRoute?120:91,clickable:!chosenRoute});if(!chosenRoute)poly.addListener('click',()=>v14eDrawCandidate(idx));traffic.polys.push(poly);}}
 const verified=traffic.matches.size;announce(verified?`Traffic segments matched to ${verified} route${verified===1?'':'s'}. Selected route is thicker. Unmatched alternatives retain original colours; they are NOT assigned guessed congestion. Traffic is a snapshot and may change.`:'The newer traffic-aware road geometry did not reliably match your original routes. No segments drawn; use Google Traffic layer or plan again.');
}
async function showTraffic(){const candidate=selected();if(!candidate||!isDrive(candidate)||!point(v14eNavigation.origin)||!point(v14eNavigation.destination)){announce('Calculate and select a Car or Taxi journey first.');return;}if(!navigator.onLine){announce('Offline: traffic data unavailable.');return;}
 const generation=++traffic.generation;traffic.enabled=false;traffic.inflight=true;clearLines();$('v15e-traffic-load').disabled=true;announce('Requesting Google traffic-aware segments and alternatives… This may use a higher-billed Routes API request.');
 try{const {Route}=await google.maps.importLibrary('routes');if(typeof Route?.computeRoutes!=='function')throw Error('Routes API computeRoutes unavailable for this key');const req={origin:point(v14eNavigation.origin),destination:point(v14eNavigation.destination),travelMode:'DRIVING',routingPreference:'TRAFFIC_AWARE',extraComputations:['TRAFFIC_ON_POLYLINE'],computeAlternativeRoutes:true,fields:['path','speedPaths','routeLabels','durationMillis']};
 const result=await Promise.race([Route.computeRoutes(req),new Promise((_,reject)=>setTimeout(()=>reject(Error('Provider timed out')),16000))]);if(generation!==traffic.generation)return;traffic.routes=result?.routes||[];if(!traffic.routes.some(r=>r.speedPaths?.length))throw Error('No speed sections returned');traffic.enabled=true;$('v15e-traffic-hide').disabled=false;overlay();}
 catch(e){if(generation===traffic.generation){traffic.enabled=false;announce(`Segment traffic unavailable (${String(e.message||e).slice(0,115)}). The normal Google Traffic layer and directions remain available. Your API key may need Routes API enabled.`);}}
 finally{if(generation===traffic.generation){traffic.inflight=false;$('v15e-traffic-load').disabled=false;}}
}
$('v15e-traffic-load').onclick=showTraffic;$('v15e-traffic-hide').onclick=()=>reset('Segment traffic hidden. Google Traffic map layer is separate.');
function renderFare(){const candidate=selected();const mode=candidate?.nav2Mode||candidate?.fastestMode||v14eNavigation.mode;const transit=mode==='transit'&&!!candidate?.route;if(!transit){fareBox.classList.add('hidden');fareBox.replaceChildren();return;}fareBox.classList.remove('hidden');fareBox.replaceChildren();const city=activeCity(),stages=window.TransportCore?.steps(candidate)||[],raw=candidate.route?.fare?.text||'';
 const data=C.fareForRoute(city,stages,raw),head=el('h3',`Payment options · ${data.city}`),notice=el('p','Displayed figures are published ticket / first-boarding reference prices, NOT guaranteed whole-journey totals. Some providers, transfers, passes and discounts are excluded; confirm current prices.','v15e-fare-note');fareBox.append(head,notice);
 const grid=el('div',undefined,'v15e-fare-grid');for(const [title,name,amount] of [['Transit card / ticket (reference fare)',data.card,data.amount],['Without that card (reference fare)',data.without,data.otherAmount]]){const card=el('div',undefined,'v15e-fare-option');card.append(el('small',title),el('strong',name),el('b',amount===null?'Journey price not verified':new Intl.NumberFormat(city==='london'?'en-GB':city==='rome'?'it-IT':'tr-TR',{style:'currency',currency:data.currency,maximumFractionDigits:2}).format(amount)));grid.append(card);}fareBox.append(grid);
 if(data.unit)fareBox.append(el('p',data.unit,'v15e-fare-note'));fareBox.append(el('p',data.note,'v15e-fare-note'));if(raw)fareBox.append(el('p',`Google-provided route fare: ${raw}. Ticket type and coverage are not established by this value.`,'v15e-fare-note'));fareBox.append(el('p',`Tariff: ${data.date}`,'v15e-fare-source'));fareBox.append(link('Official city fare table',data.source),link('Accepted payment types',C.city(city).payment));
}
const previousDraw=v14eDrawCandidate;
v14eDrawCandidate=function(...args){const result=previousDraw.apply(this,args);renderFare();if(traffic.enabled)overlay();return result;};
// Route modes may be rebuilt asynchronously; only invalidate when endpoints actually change.
function fingerprint(){const a=point(v14eNavigation.origin),b=point(v14eNavigation.destination);return a&&b?`${a.lat.toFixed(5)},${a.lng.toFixed(5)}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}`:'';}
const observer=new MutationObserver(()=>{const key=fingerprint();if(traffic.fingerprint&&key!==traffic.fingerprint)reset();if(!traffic.fingerprint&&key)traffic.fingerprint=key;if(!(v14eNavigation.candidates||[]).length&&traffic.enabled)reset('Choose a route first.');});observer.observe($('navigation-results'),{childList:true});
$('navigation-sheet')?.addEventListener('click',e=>{if(e.target.closest('[data-nav-mode],#nav2-custom-plan,#nav2-compare,#nav2-more')){reset();setTimeout(renderFare,100);}});
$('nav2-go')?.addEventListener('click',()=>{if(traffic.enabled){clearLines();requestAnimationFrame(()=>{if(document.body.classList.contains('nav2-active'))overlay();});}});
$('nav2-stop')?.addEventListener('click',()=>{if(traffic.enabled)requestAnimationFrame(overlay);});
$('nav2-reroute')?.addEventListener('click',()=>reset('Rerouted; old traffic snapshot removed. Recalculate once route settles.'));
const mapInterval=setInterval(()=>{if(traffic.enabled&&document.body.classList.contains('nav2-active')&&traffic.polys.length===0)overlay();},10000);
window.addEventListener('pagehide',()=>{clearLines();clearInterval(mapInterval);});
renderFare();console.info('v1.5E fare comparisons and opt-in traffic overlay initialized');
})();
