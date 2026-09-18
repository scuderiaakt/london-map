/* v1.5C — contextual transit details on the *selected* Google route.
   Read-only: no Supabase writes, no new Google route queries, no personal locations sent to TfL. */
(function(){
 'use strict';
 const C=window.TransportCore,$=id=>document.getElementById(id);
 if(!C||!$('navigation-sheet'))return;
 const sheet=document.createElement('section');sheet.id='transport-intelligence';sheet.className='transport-intel hidden';sheet.setAttribute('aria-label','Public transport information');
 sheet.innerHTML='<div class="transport-intel-head"><h3>Transport intelligence</h3><button id="transport-intel-refresh" type="button">Refresh status</button></div><p id="transport-intel-context" class="transport-intel-caption"></p><label class="transport-intel-access-label"><input id="transport-step-free-preference" type="checkbox"> I require step-free access</label><p id="transport-intel-access-warning" class="transport-intel-alert hidden" role="status">This Google route is NOT verified step-free. Use the operator’s accessible journey planner to confirm every station, platform, transfer and lift before travelling.</p><div id="transport-intel-steps"></div><div id="transport-intel-fare"></div><div id="transport-intel-status" role="status"></div><div id="transport-intel-links" class="transport-intel-links"></div><p class="transport-intel-caption">Only route-provider steps and directly checked TfL statuses are shown as specific facts. Platforms, exits, transfer fares, last connecting service, lift availability and step-free routing are not verified here; check the operator before travelling.</p>';
 const results=$('navigation-results');results.parentNode.insertBefore(sheet,results.nextSibling);
 const accessible=$('transport-step-free-preference');
 try{accessible.checked=localStorage.getItem('everythingApp.transport.stepfree.v1')==='true';}catch{}
 function accessibility(){ $('transport-intel-access-warning').classList.toggle('hidden',!accessible.checked); }
 accessible.addEventListener('change',()=>{try{localStorage.setItem('everythingApp.transport.stepfree.v1',String(accessible.checked));}catch{}accessibility();});
 accessibility();
 const live=document.createElement('div');live.id='transport-live-hint';live.className='transport-intel-live hidden';live.textContent='Transport details are available in the journey planner. Check the operator for live platform, accessibility and last-service information.';
 $('nav2-live')?.querySelector('details')?.append(live);
 const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
 const a=(label,url)=>{const link=el('a','transport-intel-link',label+' ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;};
 let generation=0,selectedId=null;
 function current(){return (typeof v14eNavigation!=='undefined')?v14eNavigation.candidates?.[v14eNavigation.selectedIndex]:null;}
 function city(){try{return currentCityId;}catch{return 'london';}}
 function clear(){generation++;selectedId=null;sheet.classList.add('hidden');$('transport-intel-steps').replaceChildren();$('transport-intel-status').replaceChildren();$('transport-intel-links').replaceChildren();}
 function field(parent,label,value){const row=el('div','transport-intel-field');row.append(el('span','',label),el('b','',value||'Not provided'));parent.append(row);}
 function statusMessage(message){$('transport-intel-status').replaceChildren(el('p','transport-intel-caption',message));}
 async function checkStatus(routeId,entries){
   const token=++generation;
   const ids=[...new Set(entries.map(s=>s.lineId).filter(Boolean))].slice(0,6);
   const target=$('transport-intel-status');target.replaceChildren();
   if(!C.isLondon(routeId)||!ids.length){statusMessage(C.isLondon(routeId)?'No TfL line IDs identified on this route; consult the operator for live status.':'London TfL statuses do not apply to this city. Use the route operator’s website for live information.');return;}
   if(!navigator.onLine){statusMessage('Offline: disruption status cannot be checked.');return;}
   statusMessage('Checking current TfL line status…');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8500);
   const checked=await Promise.allSettled(ids.map(async id=>{const resp=await fetch(C.statusUrl(id),{signal:controller.signal,cache:'no-store'});if(!resp.ok)throw Error('HTTP '+resp.status);const data=await resp.json();return {id,rows:C.statuses(data,id)};}));clearTimeout(timer);
   if(token!==generation)return;
   target.replaceChildren();let found=0,failed=0;
   for(let i=0;i<checked.length;i++){
     const item=checked[i];if(item.status!=='fulfilled'||!item.value.rows.length){failed++;continue;}
     for(const record of item.value.rows){found++;const card=el('div','transport-intel-alert');card.append(el('b','',`${record.line}: ${record.label}`));if(record.detail)card.append(el('p','',record.detail.slice(0,1100)));target.append(card);}
   }
   const stamp=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
   target.prepend(el('p','transport-intel-caption',found?`TfL line-status API checked at ${stamp} (your local time). Updates may lag. ${failed?failed+' line(s) could not be verified.':''}`:'TfL status unavailable; no conclusion about service quality.'));
 }
 function render(){
   const candidate=current(),entries=C.steps(candidate),routeCity=city();
   if(!candidate||candidate.estimated||!entries.length){clear();return;}
   selectedId=candidate;generation++;sheet.classList.remove('hidden');
   $('transport-intel-context').textContent=`${entries.length} boarding stage${entries.length===1?'':'s'} · ${C.isLondon(routeCity)?'London: TfL information where applicable':'Provider directions only — TfL rules do not automatically apply'}`;
   const stageBox=$('transport-intel-steps');stageBox.replaceChildren();
   for(const [i,s] of entries.entries()){
     const box=el('article','transport-intel-stage');box.append(el('h4','',`${i+1}. ${s.line}${s.headsign?' · towards '+s.headsign:''}`));
     field(box,'Board',s.from);field(box,'Get off',s.to);
     if(s.departure)field(box,'Scheduled departure',s.departure);
     if(s.arrival)field(box,'Scheduled arrival',s.arrival);
     if(s.stops!==null)field(box,'Stops',String(s.stops));
     if(s.agency)field(box,'Route provider',s.agency);
     field(box,'Platform / exit','Not supplied — follow station signs');
     stageBox.append(box);
   }
   const fare=$('transport-intel-fare');fare.replaceChildren();
   const raw=candidate.route?.fare;
   if(raw?.text){fare.append(el('p','transport-intel-caption',`Google route fare estimate: ${String(raw.text)}. Check ticket type, discounts and operator conditions.`));}
   else fare.append(el('p','transport-intel-caption','No route-specific fare provided. No fare has been estimated.'));
   const links=$('transport-intel-links');links.replaceChildren();
   if(C.isLondon(routeCity)){
     if(entries.some(C.isTfL)){fare.append(el('p','transport-intel-caption','TfL pay as you go generally accepts contactless or Oyster. Touch in and out with the same card/device on rail; on buses and trams, touch in only. Check this route’s operators, ticket conditions and discounts.'));links.append(a('How to pay on TfL',C.LINKS.pay));}
     links.append(a('TfL fare finder',C.LINKS.fare),a('Disruptions & stations',C.LINKS.status),a('Step-free route planner',C.LINKS.accessiblePlanner),a('Timetables / last services',C.LINKS.timetable));
   }else{
     const trusted=new Set();for(const l of candidate.route?.legs||[])for(const s of l.steps||[])for(const agency of s.transit?.line?.agencies||[]){try{const u=new URL(agency.url);if(u.protocol==='https:'&&u.hostname&&!trusted.has(u.href)){trusted.add(u.href);links.append(a(`Operator: ${String(agency.name||'transit').slice(0,60)}`,u.href));}}catch{}}
     links.append(el('span','transport-intel-caption','Use the local transit operator for payments, fares, accessibility, exits and service updates.'));
   }
   checkStatus(routeCity,entries);
 }
 $('transport-intel-refresh').addEventListener('click',()=>{if(current()!==selectedId){render();return;}checkStatus(city(),C.steps(current()));});
 // Navigation 2.0 already owns selection; this adapter merely observes it.
 const baseDraw=v14eDrawCandidate;
 v14eDrawCandidate=function(index){const result=baseDraw.apply(this,arguments);render();return result;};
 const watcher=new MutationObserver(()=>{if(!results.children.length)clear();});
 watcher.observe(results,{childList:true});
 $('navigation-sheet').addEventListener('click',e=>{if(e.target.closest('[data-nav-mode],#nav2-custom-plan,#nav2-compare,#nav2-more')){clear();setTimeout(render,0);}});
 $('nav2-go')?.addEventListener('click',()=>{live.classList.toggle('hidden',!C.steps(current()).length);});
 $('navigation-close')?.addEventListener('click',clear);
 console.info('v1.5C transport intelligence ready (provider-verified fields and TfL status checks only)');
})();
