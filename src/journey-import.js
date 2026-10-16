const API = 'https://api.transitous.org/api/';
const CLIENT = 'PAC/1.0 (https://github.com/FinCreeper1/PAC)';
export class SearchDetailsRequired extends Error {}
const clean = value => typeof value === 'string' ? value.trim() : '';
export function linkSearch(value) {
  if (!clean(value)) return {};
  let url;
  try { url = new URL(value); } catch { throw Error('Bitte einen gültigen Bahn-Link einfügen.'); }
  if (url.protocol !== 'https:' || !['www.bahn.de','bahn.de','int.bahn.de'].includes(url.hostname) || url.username || url.password || url.port)
    throw Error('Bitte einen HTTPS-Link von bahn.de verwenden.');
  const params = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(url.hash.replace(/^#\??/, ''))) if (!params.has(key)) params.set(key, value);
  const stamp = params.get('hd') || '';
  const date = params.get('date') || stamp.slice(0,10);
  return {origin:clean(params.get('so')), destination:clean(params.get('zo')),
    date: /^\d{2}\.\d{2}\.\d{4}$/.test(date) ? date.split('.').reverse().join('-') : date,
    time:clean(params.get('time')) || stamp.slice(11,16)};
}
function localParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function searchInstant(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new SearchDetailsRequired('Bitte Reisetag und Abfahrtszeit ergänzen.');
  const wanted = `${date}T${time}:00Z`, target = Date.parse(wanted);
  if (!Number.isFinite(target)) throw new SearchDetailsRequired('Bitte ein gültiges Reisedatum eintragen.');
  let guess = target;
  for (let i=0;i<3;i++) {
    const p = localParts(guess,timeZone);
    guess += target - Date.parse(`${p.date}T${p.time}:00Z`);
  }
  const p = localParts(guess,timeZone);
  if (p.date!==date || p.time!==time) throw new SearchDetailsRequired('Dieses Datum oder diese Ortszeit ist ungültig. Bitte prüfen.');
  return new Date(guess).toISOString();
}
export function parseItinerary(itinerary, timeZone='Europe/Berlin') {
  const railModes = new Set(['HIGHSPEED_RAIL','LONG_DISTANCE','NIGHT_RAIL','REGIONAL_RAIL','SUBURBAN','SUBWAY','RAIL']);
  if (!Array.isArray(itinerary.legs) || itinerary.legs.some(l=>l.mode!=='WALK'&&!railModes.has(l.mode))) throw Error('Die Verbindung enthält nicht unterstützte Verkehrsmittel.');
  const source = itinerary.legs.filter(l=>railModes.has(l.mode));
  if (!source.length || source.length>20 || source.some(l=>l.cancelled)) throw Error('Keine nutzbare Zugverbindung gefunden.');
  let date, previousEnd;
  const legs = source.map(l=>{
    const start = l.scheduledStartTime || l.startTime, end = l.scheduledEndTime || l.endTime;
    const startMs=Date.parse(start),endMs=Date.parse(end);
    if (!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs||(previousEnd!=null&&startMs<previousEnd)) throw Error('Transitous hat widersprüchliche Fahrzeiten geliefert.');
    previousEnd=endMs;
    const a=localParts(start,timeZone),b=localParts(end,timeZone);
    date ??= a.date;
    if(a.date!==date||b.date!==date) throw Error('Verbindungen über Mitternacht werden noch nicht unterstützt. Bitte in einzelne Tage aufteilen.');
    const service=l.displayName || [l.routeShortName,l.tripShortName].filter(Boolean).join(' ') || l.routeLongName;
    if (![l.from?.name,l.to?.name,service].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)) throw Error('Transitous hat unvollständige Zugangaben geliefert.');
    const track=l.from.scheduledTrack || l.from.track || '',arrivalTrack=l.to.scheduledTrack || l.to.track || '';
    // Transitous stop IDs are not EVA numbers; keep them out of the DB live API.
    return {origin:l.from.name,destination:l.to.name+(arrivalTrack?` · Gleis ${arrivalTrack}`:''),service,
      departure:a.time,arrival:b.time,platform:track?`Gleis ${track}`:'',
      number:'',station:'',arrivalStation:'',transitousTripId:l.tripId || ''};
  });
  const from=source[0].from,to=source.at(-1).to;
  const result={legs,date,startTime:legs[0].departure,endTime:legs.at(-1).arrival,title:`${from.name} → ${to.name}`,location:from.name,source:'transitous'};
  if(Number.isFinite(from.lat)&&Math.abs(from.lat)<=90&&Number.isFinite(from.lon)&&Math.abs(from.lon)<=180) Object.assign(result,{latitude:from.lat,longitude:from.lon});
  return result;
}
export async function importJourney(value, fetcher=fetch, search={}, timeZone='Europe/Berlin') {
  const linked=linkSearch(value);
  const input=Object.fromEntries(['origin','destination','date','time'].map(key=>[key,clean(search[key]) || linked[key] || '']));
  if(!input.origin||!input.destination) throw new SearchDetailsRequired('Transitous kann die kurze Bahn-Verbindungs-ID (vbid) nicht auflösen. Ergänze Start, Ziel, Reisetag und Abfahrt; bei langen Bahn-Links werden diese Angaben übernommen.');
  if(input.origin.length>200||input.destination.length>200) throw Error('Bitte kürzere Bahnhofsnamen verwenden.');
  const instant=searchInstant(input.date,input.time,timeZone);
  async function request(path, params) {
    const response=await fetcher(API+path+'?'+new URLSearchParams(params),{
      redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','User-Agent':CLIENT}});
    if(!response.ok) throw Error(response.status===429?'Transitous ist gerade ausgelastet. Bitte später erneut versuchen.':'Transitous ist gerade nicht erreichbar oder hat für dieses Datum keine Fahrplandaten.');
    const text=await response.text();
    if(text.length>2000000) throw Error('Die Transitous-Antwort ist zu groß.');
    try{return JSON.parse(text);}catch{throw Error('Transitous hat keine lesbaren Fahrplandaten geliefert.');}
  }
  const normalize = name => name.toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]/gu,'');
  async function station(name) {
    const results=await request('v1/geocode',{text:name,type:'STOP',mode:'RAIL',numResults:'5',language:'de'});
    if(!Array.isArray(results)) throw Error('Transitous hat keine lesbaren Bahnhöfe geliefert.');
    const match=results.find(s=>s.type==='STOP'&&normalize(s.name)===normalize(name));
    if(!match?.id) throw new SearchDetailsRequired(`Bitte den Bahnhof „${name}“ genauer angeben, z. B. „Hamburg Hbf“ oder „Aachen Hbf“.`);
    return match.id;
  }
  const from=await station(input.origin),to=await station(input.destination);
  const data=await request('v6/plan',{fromPlace:from,toPlace:to,time:instant,transitModes:'RAIL',directModes:'',numItineraries:'3',maxItineraries:'3',timetableView:'true',detailedLegs:'false'});
  if(!Array.isArray(data.itineraries)||!data.itineraries.length) throw Error('Transitous hat für diese Suche keine Zugverbindung gefunden. Prüfe Datum, Uhrzeit und Bahnhöfe.');
  const choices=[];
  let problem;
  for(const itinerary of data.itineraries.slice(0,3)) {
    try{choices.push(parseItinerary(itinerary,timeZone));}catch(error){problem=error;}
  }
  if(!choices.length) throw problem || Error('Keine unterstützte Zugverbindung gefunden.');
  return {choices,source:'transitous'};
}
