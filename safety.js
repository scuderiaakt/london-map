/* v1.5F — Evidence-based four-city street CONDITIONS overlay. On-demand only. */
(function(){'use strict';
const core=window.EverythingSafetyCore;
if(!core)return;
const palette={green:'#38d986',yellow:'#ffcb61',red:'#ff6270',unknown:'#9cabb7'};
const state={shapes:[],token:0,city:'',active:false,infowindow:null,info:null};
function clear(){state.token++;state.active=false;for(const shape of state.shapes)shape.setMap?.(null);state.shapes=[];state.infowindow?.close?.();state.infowindow=null;if(state.info)state.info.textContent='Overlay cleared. Select Load near map centre to inspect another area.';}
function mapRef(){try{return typeof map!=='undefined'&&map?.getCenter?map:null;}catch{return null;}}
function city(){try{return typeof currentCityId!=='undefined'?currentCityId:'london';}catch{return 'london';}}
function el(t,text,cls){const n=document.createElement(t);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function mount(parent,id){
 const area=el('section',undefined,'v15f-safety-area');area.append(el('h3','Four-city street conditions index'));
 area.append(el('p','Green: mapped lighting AND pedestrian infrastructure. Yellow: partial or mixed evidence. Red: combined mapped walking-condition concerns. Grey/uncoloured: NOT ASSESSED. These are NOT crime or stabbing probabilities; missing reports do not mean low risk.','v15f-safety-disclaimer'));
 const legend=el('div',undefined,'v15f-safety-legend');for(const [band,title] of [['green','80 · Multiple favourable tags'],['yellow','55 · Partial evidence'],['red','25 · Combined concerns'],['unknown','— · No reliable tags']]){const p=el('span',title);p.style.borderLeft=`5px solid ${palette[band]}`;legend.append(p);}area.append(legend);
 const actions=el('div',undefined,'v15f-safety-actions');const load=el('button','Load street conditions near map centre','v15e-chip'),remove=el('button','Clear map overlay','v15e-chip');load.type=remove.type='button';actions.append(load,remove);area.append(actions);
 const status=el('p','Select a city, centre your map on a neighbourhood, then load. Nothing queries your GPS.','v15f-safety-status');area.append(status);state.info=status;
 const src=el('a','Source: OpenStreetMap community-mapped tags ↗');src.href='https://wiki.openstreetmap.org/wiki/Key:lit';src.target='_blank';src.rel='noopener noreferrer';src.className='v15e-link';area.append(src);
 area.append(el('p','Source is incomplete and may be outdated. An unlit road is not necessarily a high-crime road; a well-lit road is not guaranteed safe. No automatic navigation rerouting or street-level crime claims. © OpenStreetMap contributors.','v15f-safety-disclaimer'));
 parent.append(area);
 if(state.city&&state.city!==id)clear();state.city=id;
 remove.addEventListener('click',()=>clear());
 load.addEventListener('click',async()=>{
  const m=mapRef();if(!m||!window.google?.maps){status.textContent='Map not ready; try again once the city loads.';return;}
  if(navigator.onLine===false){status.textContent='Offline. This overlay requires an on-demand provider response.';return;}
  clear();const token=++state.token;load.disabled=true;status.textContent='Requesting mapped lighting and pedestrian tags…';
  const center=m.getCenter(),point={lat:center.lat(),lng:center.lng()},requestCity=city();
  try{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),26000);
    let response;try{response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:core.query(point)}),signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timeout);}
    if(!response.ok)throw Error('Provider HTTP '+response.status);
    const ways=core.parseWays(await response.json());if(token!==state.token||requestCity!==city())return;
    if(!ways.length){status.textContent='No mapped walking-condition tags in this area. Roads remain unassessed, not safe.';return;}
    let drawn=0;const counts={green:0,yellow:0,red:0,unknown:0};
    state.infowindow=new google.maps.InfoWindow();
    for(const way of ways){counts[way.assessment.band]++;if(way.assessment.band==='unknown')continue;
      const shape=new google.maps.Polyline({map:m,path:way.path,strokeColor:palette[way.assessment.band],strokeWeight:6,strokeOpacity:.88,zIndex:210,clickable:true});
      shape.addListener('click',event=>{
        const box=el('div');box.style.cssText='max-width:260px;color:#182533;font:13px/1.5 system-ui';box.append(el('strong',way.name));box.append(el('p',`Walking-conditions index: ${way.assessment.score}/100 · ${way.assessment.band.toUpperCase()}. Not an assault-risk score.`));for(const f of way.assessment.facts)box.append(el('p',f));box.append(el('small','Community-mapped tags · © OpenStreetMap contributors · not independently checked.'));state.infowindow.setContent(box);state.infowindow.setPosition(event.latLng);state.infowindow.open(m);
      });state.shapes.push(shape);drawn++;
    }
    const cover=new google.maps.Circle({map:m,center:point,radius:560,strokeColor:'#9cabb7',strokeOpacity:.6,strokeWeight:1,fillOpacity:0,clickable:false,zIndex:200});state.shapes.push(cover);
    state.active=true;status.textContent=`${requestCity[0].toUpperCase()+requestCity.slice(1)} · ${drawn} tagged ways assessed: ${counts.green} green, ${counts.yellow} yellow, ${counts.red} red. Other streets UNASSESSED. Tap a coloured segment for reasons.`;
  }catch(error){if(token===state.token){status.textContent='Street data unavailable ('+String(error.message||'provider error').slice(0,110)+'). No safety assessment inferred.';console.warn('Walking-condition overlay',error);}}
  finally{load.disabled=false;}
 });
}
window.EverythingSafety={mount,clear};
})();
