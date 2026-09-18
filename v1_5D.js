/* v1.5D — route choices, payment clarity and responsive place previews.
   No Supabase writes; do not cache provider routing or map content. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('navigation-sheet'))return;
 // Keep Go and route comparison next to the mode selector instead of below a long transit report.
 const goRow=$('nav2-go')?.closest?.('.nav2-actions');
 if(goRow&&$('navigation-status'))$('navigation-status').insertAdjacentElement('afterend',goRow);
 let alternativeLines=[],alternativeLabels=[],routePicking=false,previewToken=0;
 function clearAlternatives(){for(const line of alternativeLines)line.setMap(null);for(const label of alternativeLabels)label.setMap(null);alternativeLines=[];alternativeLabels=[];}
 const previousClear=v14eClearNavPolylines;
 v14eClearNavPolylines=function(){clearAlternatives();return previousClear.apply(this,arguments);};
 function isPoint(point){return !!point&&Number.isFinite(Number(point.lat))&&Number.isFinite(Number(point.lng));}
 function routeMode(c){return c?.nav2Mode||c?.fastestMode||v14eNavigation.mode||'drive';}
 function labelFor(c){return Number.isFinite(c?.duration)&&c.duration>0?`${Math.max(1,Math.round(c.duration/60))} min`:'Time unavailable';}
 function showRouteChoices(){
   clearAlternatives();if(routePicking||document.body.classList.contains('nav2-active'))return;
   const routes=v14eNavigation.candidates||[],selected=v14eNavigation.selectedIndex;
   if(routes.filter(c=>Array.isArray(c.path)&&c.path.length>1).length<2)return;
   // Draw alternatives behind the primary route. No guessed alternatives or extra API calls.
   const bounds=new google.maps.LatLngBounds();
   for(const c of routes)for(const p of c.path||[])if(isPoint(p))bounds.extend(p);
   routes.forEach((candidate,index)=>{
     if(index===selected||!Array.isArray(candidate.path)||candidate.path.length<2)return;
     const mode=routeMode(candidate);
     const color=mode==='walk'?'#b3adf5':mode==='transit'?'#a9a8bf':'#e9a85e';
     const line=new google.maps.Polyline({map,path:candidate.path,strokeColor:color,strokeWeight:5,strokeOpacity:.79,zIndex:88,clickable:true});
     line.addListener('click',()=>v14eDrawCandidate(index));alternativeLines.push(line);
     const anchor=candidate.path[Math.min(candidate.path.length-1,Math.max(0,Math.floor(candidate.path.length*(.38+(index%3)*.10))))];
     if(!isPoint(anchor))return;
     const overlay=new class extends google.maps.OverlayView{
       onAdd(){const button=document.createElement('button');button.type='button';button.className='v15d-alt-label';button.textContent=labelFor(candidate);button.title=`Choose alternative ${index+1}: ${labelFor(candidate)}`;button.setAttribute('aria-label',button.title);button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();v14eDrawCandidate(index);});this.button=button;this.getPanes().overlayMouseTarget.appendChild(button);}
       draw(){const p=this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(anchor));if(!p||!this.button)return;this.button.style.left=`${p.x}px`;this.button.style.top=`${p.y}px`;}
       onRemove(){this.button?.remove();this.button=null;}
     }();overlay.setMap(map);alternativeLabels.push(overlay);
   });
   // Include both the chosen and alternatives so timings stay in view when routes diverge.
   if(!bounds.isEmpty())map.fitBounds(bounds,window.matchMedia?.('(max-width:700px)').matches?{top:85,bottom:Math.round((window.innerHeight||700)*.55),left:38,right:38}:70);
 }
 const previousDraw=v14eDrawCandidate;
 v14eDrawCandidate=function(index){
   clearAlternatives();routePicking=true;
   let result;
   try{result=previousDraw.apply(this,arguments);}finally{routePicking=false;}
   // Larger high-contrast selected line: keep the original provider geometry and transit colors.
   if(typeof v14eNavPolylines!=='undefined')for(const line of v14eNavPolylines){
     const z=line.get?.('zIndex')??line.opts?.zIndex;
     if(z===95)line.setOptions?.({strokeWeight:13,strokeOpacity:1});
     if(z===96)line.setOptions?.({strokeWeight:7.5,strokeOpacity:1});
   }
   showRouteChoices();
   for(const button of document.querySelectorAll('#navigation-results [data-nav-route]')){
      const active=Number(button.dataset.navRoute)===v14eNavigation.selectedIndex;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
   }
   return result;
 };
 // The overlay is removed when planning changes or live navigation starts.
 $('nav2-go')?.addEventListener('click',clearAlternatives);
 $('nav2-stop')?.addEventListener('click',()=>{if(v14eNavigation.candidates?.length)requestAnimationFrame(()=>v14eDrawCandidate(v14eNavigation.selectedIndex));});
 const choicesObserver=new MutationObserver(()=>{if(!$('navigation-results')?.querySelector('[data-nav-route]'))clearAlternatives();});
 choicesObserver.observe($('navigation-results'),{childList:true});

 // Explain actual accepted media per Google transit boarding stage, never assume Oyster is required.
 function paymentInfo(){
   const section=$('transport-intelligence');if(!section||section.classList.contains('hidden'))return;
   const candidate=v14eNavigation.candidates?.[v14eNavigation.selectedIndex];
   const stages=window.TransportCore?.steps(candidate)||[];
   const cards=section.querySelectorAll('.transport-intel-stage');
   if(!cards.length||cards.length!==stages.length)return;
   const london=(typeof currentCityId!=='undefined'&&currentCityId==='london');
   cards.forEach((card,i)=>{
     const s=stages[i],row=document.createElement('div');row.className='v15d-payment';
     const heading=document.createElement('strong');heading.textContent='How to pay';row.append(heading);
     const detail=document.createElement('p');
     if(london&&window.TransportCore.isTfL(s)){
       const bus=/BUS|TRAM/i.test(s.mode);
       detail.textContent=bus?'TfL: pay with Oyster OR a supported contactless bank card / phone. Touch in when boarding; do not touch out.':
         'TfL: Oyster OR a supported contactless bank card / phone (you do not need both). Touch in and out with the SAME card/device. Oyster is not accepted on Elizabeth line journeys between Reading and Iver; check the exact stations.';
       const link=document.createElement('a');link.href=window.TransportCore.LINKS.pay;link.target='_blank';link.rel='noopener noreferrer';link.textContent='TfL payment rules ↗';row.append(detail,link);
     }else{
       detail.textContent='Accepted ticket/card for this operator is not verified. Confirm with the operator before boarding; Oyster is not universally valid on other services.';row.append(detail);
     }
     card.append(row);
   });
 }
 const transportDraw=v14eDrawCandidate;
 v14eDrawCandidate=function(index){const result=transportDraw.apply(this,arguments);paymentInfo();return result;};

 // Fast-place previews: immediate route/save actions, small Places field mask first, rich fields after.
 // Superseded requests can never overwrite a newer place panel or steal a route-selection dialog.
 const placeCache=new Map();const TTL=10*60*1000,MAX=30;
 function latLngPoint(p){const lat=typeof p?.lat==='function'?p.lat():Number(p?.lat),lng=typeof p?.lng==='function'?p.lng():Number(p?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;}
 function showPlace(data,token,loading=false){
   if(token!==previewToken||!data?.loc)return;
   const content=$('detail-content');if(!content)return;
   const name=data.name||'Selected map location',type=data.type||'Place',address=data.address||`${data.loc.lat.toFixed(5)}, ${data.loc.lng.toFixed(5)}`;
   content.replaceChildren();
   const tag=document.createElement('div');tag.className='detail-label';tag.textContent=loading?'MAP · QUICK PREVIEW':type.toUpperCase();
   const title=document.createElement('h2');title.textContent=name;
   const sub=document.createElement('div');sub.className='sub';sub.textContent=address;
   const actions=document.createElement('div');actions.className='detail-actions compact-action-row';
   const route=document.createElement('button');route.className='primary-btn compact-btn';route.textContent='Directions ↗';route.onclick=()=>v14eOpenNavigation({...data.loc,name});
   const save=document.createElement('button');save.className='secondary-btn compact-btn';save.textContent='Save place';save.onclick=()=>openPlaceEditor(data.loc,name,address,v14dPoiCategory(type));
   actions.append(route,save);content.append(tag,title,sub,actions);
   if(loading){const msg=document.createElement('p');msg.className='sub';msg.textContent='Loading place name in the background. Directions and Save already work.';content.append(msg);}
   else{
     if(data.status||data.hours){const msg=document.createElement('p');msg.className='sub';msg.textContent=[data.status,data.hours].filter(Boolean).join(' · ');content.append(msg);}
     if(data.photoUrl){const img=document.createElement('img');img.className='poi-photo';img.alt=name;img.loading='lazy';img.decoding='async';img.src=data.photoUrl;content.append(img);}
     if(data.source){const src=document.createElement('p');src.className='poi-source-note';src.textContent=`Place information: ${data.source}`;content.append(src);}
   }
   // Preserve route endpoint chooser when place is opened from From / To autocomplete.
   const pending=(typeof v15EndpointState!=='undefined'?v15EndpointState.pending:null);
   if(pending&&Math.hypot((pending.item.lat-data.loc.lat)*111000,(pending.item.lng-data.loc.lng)*72000)<85){
     const use=document.createElement('button');use.className='primary-btn compact-btn';use.textContent=`Use as ${pending.endpoint==='origin'?'FROM':'TO'}`;use.onclick=()=>{v15SetEndpoint(pending.endpoint,{...pending.item,...data.loc,name,address});v15EndpointState.pending=null;closeDetail(false);bringPanelToFront?.($('navigation-sheet'));};actions.prepend(use);
   }
 }
 v14dShowPoi=async function(placeId,latLng){
   const loc=latLngPoint(latLng);if(!loc||!placeId)return;
   const token=++previewToken;const cached=placeCache.get(placeId);
   showPlace(cached&&Date.now()-cached.time<TTL?cached.value:{loc,name:'Selected map location',address:'',type:'Place'},token,!(cached&&Date.now()-cached.time<TTL));
   openDetail();bringPanelToFront?.($('detail-card'));
   if(cached&&Date.now()-cached.time<TTL)return;
   try{
     const {Place}=await google.maps.importLibrary('places');
     const place=new Place({id:placeId,requestedLanguage:getActiveCityConfig().language||'en'});
     await place.fetchFields({fields:['displayName','formattedAddress','location','primaryTypeDisplayName']});
     const newLoc=latLngPoint(place.location)||loc;
     const basic={loc:newLoc,name:place.displayName||'Selected map location',address:place.formattedAddress||'',type:place.primaryTypeDisplayName||'Place',source:'Google Maps'};
     placeCache.delete(placeId);placeCache.set(placeId,{time:Date.now(),value:basic});
     if(placeCache.size>MAX)placeCache.delete(placeCache.keys().next().value);
     showPlace(basic,token);
     // Secondary details are never on the critical path to opening a place or requesting directions.
     try{
       await place.fetchFields({fields:['currentOpeningHours','regularOpeningHours','photos','businessStatus']});
       const richer={...basic,hours:typeof v14dPoiHours==='function'?v14dPoiHours(place):'',status:String(place.businessStatus||'').replaceAll('_',' ').toLowerCase(),photoUrl:place.photos?.[0]?.getURI?.({maxWidth:700,maxHeight:420})||''};
       if(placeCache.get(placeId)?.value===basic)placeCache.set(placeId,{time:Date.now(),value:richer});
       showPlace(richer,token);
     }catch{/* Optional photos and hours can fail independently. */}
   }catch(err){
     console.debug('Quick Places lookup failed',err);
     if(token!==previewToken)return;
     const fallback={loc,name:'Selected map location',type:'Place',address:`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`,source:'Map coordinates · provider details unavailable'};
     showPlace(fallback,token);
   }
 };
 console.info('Our Cities v1.5D — map alternatives, faster previews and transit payment cards ready');
})();
