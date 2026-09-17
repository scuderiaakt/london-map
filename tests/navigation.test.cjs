const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../navigation-core.js');
const a={lat:51.5,lng:-.12},b={lat:51.51,lng:-.12},end={lat:51.52,lng:-.12};
test('coordinate validation rejects null, strings and impossible positions',()=>{
  for(const p of [null,{lat:null,lng:0},{lat:'51',lng:0},{lat:91,lng:0},{lat:1,lng:Infinity}])assert.equal(C.point(p),null);
  assert.deepEqual(C.point({lat:()=>51,lng:()=>0}),{lat:51,lng:0});
});
test('segment projection measures progress between sparse vertices',()=>{
  const line=[a,end],cum=C.measure(line),p=C.project(b,line,cum);
  assert.ok(p.gap<.01);assert.ok(Math.abs(p.along-cum[1]/2)<1);
  const r=C.remaining(1200,2200,p.along,cum[1]);assert.ok(Math.abs(r.seconds-600)<1);
});
test('heading and off-route hysteresis reject weak GPS',()=>{
  assert.equal(C.bearing(a,b),0);assert.equal(C.offRoute({accuracy:100},200,2),0);
  assert.equal(C.offRoute({accuracy:10},100,2),3);assert.equal(C.offRoute({accuracy:10},20,2),0);
});
test('loop crossings do not jump thousands of metres ahead',()=>{
  const line=[a,end,{lat:51.52,lng:-.08},{lat:51.5,lng:-.08},a,b];
  const p=C.project(a,line,C.measure(line),10);assert.ok(p.along<100);
});

// Deterministic integration harness: DOM, Maps and GPS are fakes. No billable API calls.
function harness(){
  const nodes=new Map(),docEvents={},winEvents={},storage=new Map(),watches=new Map(),intervals=new Map();
  let clock=1000000,seq=0,calls=[],routeImpl=async()=>({routes:[fixture()]}),storageFail=false;
  class Element{
    constructor(id=''){this.id=id;this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;this.textContent='';this.events={};this.attributes={};this.inert=false;const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{on=on===undefined?!classes.has(x):on;if(on)classes.add(x);else classes.delete(x);return on;}};if(id)nodes.set(id,this);}
    insertAdjacentHTML(_,html){for(const m of html.matchAll(/id="([^"]+)"/g)){const n=new Element(m[1]);this.children.push(n);} }
    append(...v){this.children.push(...v);}prepend(...v){this.children.unshift(...v);}replaceChildren(...v){this.children=[...v];}
    set innerHTML(v){this._html=v;this.textContent=String(v).replace(/<[^>]*>/g,'');}get innerHTML(){return this._html||'';}
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    addEventListener(k,v){(this.events[k]??=[]).push(v);}focus(){document.activeElement=this;}click(){return this.onclick?.();}remove(){}
  }
  const document={hidden:false,body:new Element(),activeElement:null,getElementById:id=>nodes.get(id)||null,createElement:()=>new Element(),createTextNode:s=>s,querySelectorAll:()=>[],addEventListener:(k,v)=>docEvents[k]=v};
  for(const id of ['app','map','navigation-sheet','navigation-mode-grid','navigation-results','navigation-status','navigation-taxi-ranks','navigation-use-location','navigation-destination-centre'])new Element(id);
  nodes.get('app').children.push(nodes.get('map'),nodes.get('navigation-sheet'));
  const map={getCenter:()=>a,getZoom:()=>16,getHeading:()=>0,getTilt:()=>0,getRenderingType:()=>'VECTOR',setCenter(){},setZoom(){},setHeading(v){this.heading=v;},setTilt(){},panTo(v){this.position=v;},addListener:()=>({remove(){map.listenerRemoved=true;}})};
  class Marker{constructor(){this.removed=false;}setMap(v){this.removed=v===null;}setPosition(v){this.position=v;}setIcon(v){this.icon=v;}}
  class DirectionsService{route(req){calls.push(req);return routeImpl(req);}}
  const nav={origin:{...a,name:'Start'},destination:{...end,name:'Home'},mode:'walk',candidates:[],selectedIndex:0};
  const context={console:{info(){},warn(){}},document,NavigationCore:C,google:{maps:{importLibrary:async()=>({DirectionsService}),Marker,SymbolPath:{FORWARD_CLOSED_ARROW:'arrow'}}},map,v14eNavigation:nav,
    navigator:{onLine:true,geolocation:{watchPosition(success,error,options){const id=++seq;watches.set(id,{success,error,options});return id;},clearWatch(id){watches.delete(id);}},wakeLock:{request:async()=>({release:async()=>{context.releases++;}})}},releases:0,
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(storageFail)throw Error('quota');storage.set(k,v);}},V14D_PROFILE_STORAGE:'profile',lastUserPosition:null,userLocationWatchId:null,followUserLocation:false,updateLocationButton(){},
    v14eDrawCandidate:i=>{nav.selectedIndex=i;},v15SetEndpoint:(key,value)=>{nav[key]=value;nav.candidates=[];},v14eOpenNavigation(){nav.candidates=[];},v14eCloseNavigation(){},v14eClearNavPolylines(){},v14eCalculateNavigation:async()=>{context.customOpened=true;},openRouteEditor(){},
    v14eDefaultOrigin:()=>a,v15fixAirCandidates:async()=>[],showToast:s=>context.toast=s,
    v14eCandidateFromRoute:r=>({route:r,path:r.overview_path,duration:1200,distance:2224,summary:r.summary,transfers:0,walk:2224}),
    setTimeout:()=>++seq,clearTimeout(){},setInterval:fn=>{const id=++seq;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    Date:class extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}},crypto:{randomUUID:()=>String(++seq)},URL,Blob,
    addEventListener:(k,v)=>winEvents[k]=v};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../navigation.js'),'utf8'),context);
  return {ctx:context,nav,nodes,watches,intervals,storage,calls,docEvents,winEvents,map,setRoute:f=>routeImpl=f,setQuota:()=>storageFail=true,
    tick(n=7000){clock+=n;},fix(lat=51.505,lng=-.12,accuracy=10){clock+=7000;[...watches.values()].at(-1)?.success({timestamp:clock,coords:{latitude:lat,longitude:lng,accuracy,heading:0,speed:1}});},click:id=>nodes.get(id).onclick(),
    async plan(mode='walk'){await context.v14eCalculateNavigation(mode);},async start(){await nodes.get('nav2-go').onclick();}};
}
function fixture(){return {summary:'Test route',overview_path:[a,b,end],legs:[{steps:[{instructions:'Head <b>north</b>',end_location:b,distance:{value:1112}},{instructions:'Continue home',end_location:end,distance:{value:1112}}]}],warnings:[],copyrights:'Test data'};}
test('comparison issues three requests, reuses car for taxi and handles partial failures',async()=>{
  const h=harness();h.setRoute(async r=>{if(r.travelMode==='TRANSIT')throw Error('ZERO_RESULTS');return {routes:[fixture()]};});
  await h.plan('compare');assert.equal(h.calls.length,3);assert.equal(h.nav.candidates.length,3);assert.match(h.nodes.get('navigation-status').textContent,/Unavailable: Public transport/);assert.equal(h.nodes.get('nav2-go').disabled,false);
});
test('new requests and endpoint changes invalidate late route responses',async()=>{
  const h=harness();let resolve;h.setRoute(()=>new Promise(r=>resolve=r));const old=h.plan();await new Promise(setImmediate);
  h.ctx.v15SetEndpoint('destination',{lat:51.6,lng:0});resolve({routes:[fixture()]});await old;assert.equal(h.nav.candidates.length,0);
});
test('location permission denial is actionable, End clears watches and timers',async()=>{
  const h=harness();await h.plan();await h.start();assert.equal(h.watches.size,1);
  [...h.watches.values()][0].error({code:1});assert.match(h.nodes.get('nav2-status').textContent,/permission denied/);
  h.click('nav2-stop');assert.equal(h.watches.size,0);assert.equal(h.intervals.size,0);assert.equal(h.map.listenerRemoved,true);
});
test('accurate movement advances steps and arrives without restarting GPS',async()=>{
  const h=harness();await h.plan();await h.start();h.fix(51.505);assert.match(h.nodes.get('nav2-instruction').textContent,/Head north/);
  h.fix(51.515);assert.match(h.nodes.get('nav2-instruction').textContent,/Continue home/);
  h.fix(51.51995);assert.equal(h.nodes.get('nav2-distance').textContent,'Arrived');assert.equal(h.watches.size,0);
  h.ctx.document.hidden=true;h.docEvents.visibilitychange();h.ctx.document.hidden=false;h.docEvents.visibilitychange();assert.equal(h.watches.size,0);
});
test('low battery replaces GPS watch; poor accuracy pauses progress',async()=>{
  const h=harness();await h.plan();await h.start();h.nodes.get('nav2-live-low').onchange({target:{checked:true}});
  assert.equal(h.watches.size,1);assert.equal([...h.watches.values()][0].options.enableHighAccuracy,false);
  h.fix(51.51,-.12,150);assert.match(h.nodes.get('nav2-status').textContent,/better fix/);assert.equal(h.nodes.get('nav2-time').textContent,'ETA paused');
});
test('rerouting requires sustained deviation and respects data saver',async()=>{
  const h=harness();await h.plan();await h.start();h.nodes.get('nav2-data').onchange({target:{checked:true}});
  h.fix(51.505,-.13);h.fix(51.505,-.13);h.fix(51.505,-.13);assert.equal(h.calls.length,1);
  assert.match(h.nodes.get('nav2-status').textContent,/Data saver/);await h.click('nav2-reroute');assert.equal(h.calls.length,2);
});
test('reroute completion after End cannot reopen or replace guidance',async()=>{
  const h=harness();await h.plan();await h.start();h.fix();let resolve;h.setRoute(()=>new Promise(r=>resolve=r));const pending=h.click('nav2-reroute');await new Promise(setImmediate);h.click('nav2-stop');resolve({routes:[fixture()]});await pending;
  assert.equal(h.watches.size,0);assert.equal(h.nodes.get('nav2-live').classList.contains('hidden'),true);
});
test('offline requests make no API calls; packs work without Google or Supabase',async()=>{
  const h=harness();h.ctx.navigator.onLine=false;await h.plan();assert.equal(h.calls.length,0);
  h.nodes.get('nav2-pack-title').value='Our journey';h.nodes.get('nav2-pack-notes').value='<script>private notes</script>';h.click('nav2-pack-create');
  const stored=JSON.parse(h.storage.get('everythingApp.journeyPacks.v1.kagan'));assert.equal(stored.length,1);assert.equal(stored[0].notes,'<script>private notes</script>');assert.equal(stored[0].route,undefined);
  h.storage.set('profile','ela');h.click('nav2-packs-open');assert.match(h.nodes.get('nav2-pack-list').textContent,/No journey packs/);
});
test('pack quota failure is visible and does not report saved',()=>{
  const h=harness();h.nodes.get('nav2-pack-title').value='Trip';h.nodes.get('nav2-pack-notes').value='Notes';h.setQuota();h.click('nav2-pack-create');assert.match(h.nodes.get('nav2-pack-status').textContent,/Storage unavailable/);
});
test('custom car preferences reach provider; original custom editor remains accessible',async()=>{
  const h=harness();await h.plan('custom');h.nodes.get('nav2-avoid-tolls').checked=true;await h.click('nav2-custom-plan');assert.equal(h.calls[0].avoidTolls,true);await h.click('nav2-custom-hand');assert.equal(h.ctx.customOpened,true);
});
test('hidden document suspends GPS and resumes with a fresh watch',async()=>{
  const h=harness();await h.plan();await h.start();h.ctx.document.hidden=true;h.docEvents.visibilitychange();assert.equal(h.watches.size,0);h.ctx.document.hidden=false;h.docEvents.visibilitychange();assert.equal(h.watches.size,1);assert.match(h.nodes.get('nav2-status').textContent,/fresh GPS/);
});
