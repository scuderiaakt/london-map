/* v1.5C pure world clock helpers; no network or account access. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.WorldClockCore = value;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const CITIES = Object.freeze([
    {id:'london',name:'London',zone:'Europe/London'},
    {id:'rome',name:'Rome',zone:'Europe/Rome'},
    {id:'istanbul',name:'İstanbul',zone:'Europe/Istanbul'},
    {id:'izmir',name:'İzmir',zone:'Europe/Istanbul'}
  ]);
  function format(city, at = new Date()) {
    const date = at instanceof Date ? at : new Date(at);
    const tz = city.zone;
    const clock = new Intl.DateTimeFormat('en-GB', {timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:tz,timeZoneName:'shortOffset',hour:'2-digit'}).formatToParts(date);
    const raw = parts.find(p=>p.type==='timeZoneName')?.value || 'GMT';
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
    const offset = m ? `UTC${m[1]}${Number(m[2])}${m[3] ? ':' + m[3] : ''}` : 'UTC+0';
    return {clock,offset,city:city.name};
  }
  return {CITIES,format};
});
