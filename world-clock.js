/* v1.5C compact map-independent time-zone dropdown. */
(function(){
 'use strict';
 const C=window.WorldClockCore;
 const shell=document.getElementById('world-clock-shell');
 const trigger=document.getElementById('city-clock');
 const menu=document.getElementById('world-clock-menu');
 const time=document.getElementById('city-clock-time');
 const date=document.getElementById('city-clock-date');
 if(!C||!shell||!trigger||!menu)return;
 let open=false,clicked=false;
 const rows=new Map();
 for(const city of C.CITIES){
   const row=document.createElement('div');row.className='world-clock-row';row.dataset.city=city.id;
   const label=document.createElement('div');label.className='world-clock-row-name';label.textContent=city.name;
   const off=document.createElement('small');off.className='world-clock-offset';
   const tm=document.createElement('b');tm.className='world-clock-row-time';
   row.append(label,off,tm);menu.append(row);rows.set(city.id,{row,tm,off});
 }
 function activeCity(){try{return (typeof currentCityId!=='undefined'&&currentCityId)||'london';}catch{return 'london';}}
 function update(){
   const now=new Date(),id=activeCity(),city=C.CITIES.find(c=>c.id===id)||C.CITIES[0];
   // app.js maintains the main clock, but refresh here as well to avoid stale minute after tab resume.
   const active=C.format(city,now);
   time.textContent=new Intl.DateTimeFormat('en-GB',{timeZone:city.zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
   date.textContent=new Intl.DateTimeFormat('en-GB',{timeZone:city.zone,weekday:'short',day:'2-digit',month:'short'}).format(now);
   trigger.setAttribute('aria-label',`${city.name} ${active.clock}. Show other city times`);
   for(const c of C.CITIES){const row=rows.get(c.id),f=C.format(c,now);row.tm.textContent=f.clock;row.off.textContent=f.offset;row.row.classList.toggle('world-clock-current',c.id===id);}
 }
 function setOpen(next){open=!!next;menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));shell.classList.toggle('world-clock-open',open);if(open)update();}
 trigger.addEventListener('click',e=>{e.stopPropagation();clicked=!open;setOpen(!open);});
 if(window.matchMedia?.('(hover: hover)').matches){
   shell.addEventListener('mouseenter',()=>setOpen(true));
   shell.addEventListener('mouseleave',()=>{if(!clicked)setOpen(false);});
 }
 document.addEventListener('pointerdown',e=>{if(!shell.contains(e.target)){clicked=false;setOpen(false);}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){clicked=false;setOpen(false);trigger.focus();}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
 window.addEventListener('focus',update);
 setInterval(update,1000);update();setOpen(false);
})();
