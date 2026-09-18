/* v1.5F — Four-city walking-environment evidence, not a prediction of crime. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EverythingSafetyCore=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
const WALKWAYS=new Set(['pedestrian','footway','path','living_street']);
const HARD=new Set(['asphalt','paved','concrete','concrete:plates','paving_stones','sett','cobblestone']);
const SOFT=new Set(['mud','dirt','sand','earth','ground','gravel','grass']);
function classify(tags={}){
 const lit=String(tags.lit||'').toLowerCase(),walkway=WALKWAYS.has(tags.highway);
 const sidewalk=String(tags.sidewalk||'').toLowerCase();
 const sideyes=['yes','both','both:separate','separate'].includes(sidewalk)||['yes','separate'].includes(tags['sidewalk:both']);
 const sideno=sidewalk==='no'||sidewalk==='none';
 const surface=String(tags.surface||'').toLowerCase();
 const lightGood=['yes','24/7'].includes(lit),lightBad=['no','disused'].includes(lit);
 const tagsKnown=Boolean(lit||sidewalk||tags['sidewalk:both']||surface);
 const facts=[];
 if(lightGood)facts.push('Mapped lighting: present (not verified operational).');
 else if(lightBad)facts.push('Mapped lighting: absent or disused; relevant after dark.');
 else if(lit)facts.push('Lighting tag: '+lit+'; operating hours may differ.');
 if(walkway)facts.push('Mapped pedestrian-priority route or footway.');
 if(sideyes)facts.push('Mapped pavement/sidewalk: present.');
 else if(sideno)facts.push('Mapped sidewalk tag: no; a separately mapped path may still exist.');
 if(HARD.has(surface))facts.push('Mapped hard-surfaced path or roadway.');
 else if(SOFT.has(surface))facts.push('Mapped loose/unsealed surface.');
 const reliablePositive=lightGood&&(walkway||sideyes);
 const combinedConcern=lightBad&&(sideno||SOFT.has(surface));
 let band='unknown',score=null;
 if(combinedConcern){band='red';score=25;}
 else if(reliablePositive){band='green';score=80;}
 else if(tagsKnown||walkway){band='yellow';score=55;}
 return {band,score,facts,tagCount:[lit,sidewalk,tags['sidewalk:both'],surface].filter(Boolean).length};
}
function parseWays(json,limit=450){if(!Array.isArray(json?.elements))throw Error('Invalid Overpass response');return json.elements.filter(x=>x?.type==='way'&&x.tags?.highway&&Array.isArray(x.geometry)&&x.geometry.length>=2).slice(0,limit).map(x=>({id:x.id,name:String(x.tags.name||x.tags.ref||'Unnamed mapped way').slice(0,120),tags:x.tags,path:x.geometry.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(p=>({lat:p.lat,lng:p.lon})),assessment:classify(x.tags)})).filter(x=>x.path.length>=2);}
function query(center){const lat=Number(center.lat),lng=Number(center.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>80||Math.abs(lng)>180)throw Error('Invalid location');const dLat=.005,dLon=Math.min(.013,.005/Math.max(.35,Math.cos(lat*Math.PI/180)));const bbox=[lat-dLat,lng-dLon,lat+dLat,lng+dLon].map(n=>n.toFixed(5)).join(',');const roads='^(residential|living_street|tertiary|secondary|service|pedestrian|footway|path|unclassified|primary)$';return `[out:json][timeout:22];(way["highway"~"${roads}"]["lit"](${bbox});way["highway"~"${roads}"]["sidewalk"](${bbox});way["highway"~"${roads}"]["surface"](${bbox}););out geom 450;`;}
return {classify,parseWays,query};
});
