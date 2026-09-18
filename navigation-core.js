/* Navigation 2.0 pure geometry. No account, network or browser dependencies. */
(function(root) {
  'use strict';
  const rad = n => n * Math.PI / 180;
  function point(p) {
    if (!p) return null;
    const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
    const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180 ? {lat,lng} : null;
  }
  function distance(a,b) {
    const x = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1,Math.max(0,x))));
  }
  function bearing(a,b) {
    const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat));
    const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function measure(path) {
    const cumulative=[0];
    for(let i=1;i<path.length;i++) cumulative.push(cumulative[i-1]+distance(path[i-1],path[i]));
    return cumulative;
  }
  // Local metric projection onto segments, not nearest-vertex snapping.
  // A bounded forward window avoids jumping to a later crossing on looped routes.
  function project(p,path,cumulative,previous=null) {
    let best=null;
    const scale=111195, cos=Math.cos(rad(p.lat));
    for(let i=1;i<path.length;i++) {
      if(previous!==null && (cumulative[i]<previous-100 || cumulative[i-1]>previous+1500)) continue;
      const ax=(path[i-1].lng-p.lng)*scale*cos, ay=(path[i-1].lat-p.lat)*scale;
      const bx=(path[i].lng-p.lng)*scale*cos, by=(path[i].lat-p.lat)*scale;
      const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
      const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
      const gap=Math.hypot(ax+t*dx,ay+t*dy), along=cumulative[i-1]+t*(cumulative[i]-cumulative[i-1]);
      if(!best || gap<best.gap) best={gap,along,index:i-1};
    }
    return best;
  }
  function remaining(duration,distanceM,along,length) {
    const fraction=length?Math.max(0,Math.min(1,1-along/length)):1;
    return {distance:distanceM*fraction,seconds:duration*fraction};
  }
  function offRoute(fix,gap,count) {
    if(!Number.isFinite(fix.accuracy)||fix.accuracy>60) return 0;
    return gap>Math.max(55,fix.accuracy*2)?count+1:0;
  }
  const api={point,distance,bearing,measure,project,remaining,offRoute};
  if(typeof module!=='undefined') module.exports=api;
  else root.NavigationCore=api;
})(typeof window!=='undefined'?window:globalThis);
