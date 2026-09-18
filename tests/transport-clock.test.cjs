const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const W=require('../world-clock-core.js');
const T=require('../transport-core.js');
const day='2026-09-18T12:00:00Z', winter='2026-01-18T12:00:00Z';
test('four city times are independent of map city and reflect summer offsets',()=>{
 const got=W.CITIES.map(c=>W.format(c,day));
 assert.deepEqual(got.map(c=>c.clock),['13:00','14:00','15:00','15:00']);
 assert.deepEqual(got.map(c=>c.offset),['UTC+1','UTC+2','UTC+3','UTC+3']);
});
test('winter UTC offsets handle DST without hard-coded rules',()=>{
 assert.deepEqual(W.CITIES.map(c=>W.format(c,winter).offset),['UTC+0','UTC+1','UTC+3','UTC+3']);
});
test('recognize TfL line names but do not guess operator IDs',()=>{
 assert.equal(T.lineId('Piccadilly line'),'piccadilly');
 assert.equal(T.lineId('Hammersmith & City'),'hammersmith-city');
 assert.equal(T.lineId('Waterloo & City line'),'waterloo-city');
 assert.equal(T.lineId('imaginary train'),null);
 assert.equal(T.lineId('London Overground'),null);
 assert.equal(T.statusUrl('../private'),null);
 assert.equal(T.statusUrl('piccadilly'),'https://api.tfl.gov.uk/Line/piccadilly/Status');
});
test('transit instructions expose only fields actually supplied by provider',()=>{
 const route={route:{legs:[{steps:[{travel_mode:'WALKING'}, {transit:{line:{name:'Piccadilly line',agencies:[{name:'Transport for London'}]},departure_stop:{name:'South Kensington'},arrival_stop:{name:'Piccadilly Circus'},departure_time:{text:'17:15'},headsign:'Cockfosters',num_stops:4}}]}]}};
 const s=T.steps(route);assert.equal(s.length,1);assert.equal(s[0].departure,'17:15');assert.equal(s[0].from,'South Kensington');assert.equal(s[0].lineId,'piccadilly');assert.equal(Object.hasOwn(s[0],'platform'),false);
 assert.equal(T.isTfL(s[0]),true);
});
test('TfL response only accepts matching lines and unknown responses fail closed',()=>{
 assert.deepEqual(T.statuses([{id:'piccadilly',name:'Piccadilly',lineStatuses:[{statusSeverity:9,statusSeverityDescription:'Minor Delays',reason:'Signal fault'}]},{id:'victoria',lineStatuses:[{statusSeverityDescription:'Good Service'}]}],'piccadilly').map(x=>x.label),['Minor Delays']);
 assert.throws(()=>T.statuses({message:'rate limited'},'piccadilly'));
});
test('v1.5C web assets are linked in index and versioned cache; old app and auth untouched',()=>{
 const base=path.join(__dirname,'..');const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),sw=fs.readFileSync(path.join(base,'sw.js'),'utf8');
 for(const file of ['world-clock-core.js','world-clock.js','world-clock.css','transport-core.js','transport.js','transport.css']){assert.ok(html.includes(file+'?v=1.5C'),file);assert.ok(sw.includes(file+'?v=1.5C'),file);}
 assert.match(html,/id="city-clock"[^>]*aria-expanded="false"/);
 assert.match(html,/id="world-clock-menu"[^>]*hidden/);
 assert.match(fs.readFileSync(path.join(base,'navigation.js'),'utf8'),/id="nav2-packs-open" class="nav2-packs-button">Journeys<\/button>/);
 for(const filename of ['app.js','accounts.js','cloud-schema.sql','PAIR_ACCOUNTS.sql']){const old=require('node:child_process').execFileSync('unzip',['-p','/mnt/data/everything_app_v1_5B.zip',filename]);assert.deepEqual(fs.readFileSync(path.join(base,filename)),old,filename+' changed');}
});
