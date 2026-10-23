const API = 'https://api.transitous.org/api/';
export class SearchDetailsRequired extends Error {}
export class TransitousPolicyError extends Error {
  constructor(message, status=503) { super(message); this.status=status; }
}
export function transitousClient(config={}) {
  if(config.TRANSITOUS_USAGE_CONFIRMED!=='true') throw new TransitousPolicyError('Der Transitous-Import ist deaktiviert. Zuerst Open-Source-Veröffentlichung bzw. Prototypbetrieb, nicht kommerzielle Nutzung und ressourcenschonende Nutzung gemäß installer/README.md bestätigen.');
  const contact=config.TRANSITOUS_CONTACT;
  if(typeof contact!=='string'||contact.length>300||/[\s()<>]/.test(contact)) throw new TransitousPolicyError('Für Transitous fehlt eine gültige Kontakt-URL oder E-Mail-Adresse.');
  let valid=false;
  try {const url=new URL(contact);valid=url.protocol==='https:'&&Boolean(url.hostname)&&!url.username&&!url.password;} catch {}
  if(!valid&&!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(contact)) throw new TransitousPolicyError('Für Transitous fehlt eine gültige Kontakt-URL oder E-Mail-Adresse.');
  const version=/^v?\d+\.\d+\.\d+$/.test(config.PAC_VERSION||'')?config.PAC_VERSION.replace(/^v/,''):'1.0';
  return `PAC/${version} (${contact})`;
}
// Called within the Portal's serialized queue; persisted across sessions/restarts.
export async function reserveTransitousSearch(storage, config, now=Date.now()) {
  transitousClient(config);
  const key='transitous:next-search:v1';
  const next=await storage.get(key);
  if(Number.isFinite(next)&&next>now) {
    const error=new TransitousPolicyError('Bitte mindestens eine Minute zwischen Transitous-Suchen warten.',429);
    error.retryAfter=Math.ceil((next-now)/1000);
    throw error;
  }
  await storage.put(key,now+60000);
}
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

    const service=l.displayName || [l.routeShortName,l.tripShortName].filter(Boolean).join(' ') || l.routeLongName;
    if (![l.from?.name,l.to?.name,service].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)) throw Error('Transitous hat unvollständige Zugangaben geliefert.');
    const track=l.from.scheduledTrack || l.from.track || '',arrivalTrack=l.to.scheduledTrack || l.to.track || '';
    // Transitous stop IDs are not EVA numbers; keep them out of the DB live API.
    return {origin:l.from.name,destination:l.to.name+(arrivalTrack?` · Gleis ${arrivalTrack}`:''),service,
      departure:a.time,arrival:b.time,departureDate:a.date,arrivalDate:b.date,platform:track?`Gleis ${track}`:'',
      number:'',station:'',arrivalStation:'',transitousTripId:l.tripId || ''};
  });
  const from=source[0].from,to=source.at(-1).to;
  // Preserve the old shape for same-day connections.
  const endDate=legs.at(-1).arrivalDate;
  if(endDate===date) for(const leg of legs) {delete leg.departureDate;delete leg.arrivalDate;}
  const result={legs,date,...(endDate!==date?{endDate}:{}),startTime:legs[0].departure,endTime:legs.at(-1).arrival,title:`${from.name} → ${to.name}`,location:from.name,source:'transitous'};
  if(Number.isFinite(from.lat)&&Math.abs(from.lat)<=90&&Number.isFinite(from.lon)&&Math.abs(from.lon)<=180) Object.assign(result,{latitude:from.lat,longitude:from.lon});
  return result;
}
const MONTHS={jan:1,feb:2,'mär':3,mar:3,apr:4,mai:5,may:5,jun:6,jul:7,aug:8,sep:9,okt:10,oct:10,nov:11,dez:12,dec:12};
const SERVICE=/\b(ICE|IC|EC|ECE|RJX?|NJ|EN|TGV|FLX|RE|RB|IRE|S)\s?(\d{1,5})\b/g;
const stationName = value => clean(value).replace(/\s+(?:am|um)\s+\d.*$|,?\s*\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?.*$|\s*\b\d{4}-\d{2}-\d{2}.*$/i,'').replace(/\s*\(?\b(?:ab|an)?\s*\d{1,2}:\d{2}\)?.*$/,'').replace(/^(?:von|ab|an|nach|hinfahrt|rückfahrt|verbindung)\s*:?\s+/i,'').replace(/[,;:·|]+$/,'').trim();
// Pulls stations, date, departure and train names out of copied Bahn texts (DB Navigator, booking mails, tickets).
export function textSearch(value) {
  const text = clean(value).slice(0,10000).replace(/\r/g,'');
  const result = {origin:'',destination:'',date:'',time:'',services:[]};
  if (!text) return result;
  const lines = text.split('\n').map(line=>line.replace(/https?:\/\/\S+/g,'').trim()).filter(Boolean);
  for (const line of lines) {
    const arrow = line.match(/^(.+?)\s*(?:→|->|⟶|➞| – | - )\s*(.+)$/), route = line.match(/\bvon\s+(.+?)\s+nach\s+(.+)$/i);
    const pair = route || arrow;
    if (pair && !result.origin) {
      const [origin,destination] = [stationName(pair[1]),stationName(pair[2])];
      if (/\p{L}{2}/u.test(origin) && /\p{L}{2}/u.test(destination) && origin.length<=200 && destination.length<=200) Object.assign(result,{origin,destination});
    }
  }
  if (!result.origin) {
    // Booking mails use "ab …"/"an …", DB Navigator shares "• von X, Abfahrt …"/"• nach Y, Ankunft …".
    const ab = lines.map(line=>line.match(/^[•*·-]?\s*(?:ab|von)\s+(.+)$/i)).filter(Boolean), an = lines.map(line=>line.match(/^[•*·-]?\s*(?:an|nach)\s+(.+)$/i)).filter(Boolean);
    const part = match => stationName(match[1].replace(/,.*$/,''));
    if (ab.length && an.length) Object.assign(result,{origin:part(ab[0]),destination:part(an.at(-1))});
  }
  const numeric = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/), iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const named = text.match(/\b(\d{1,2})\.?\s+(Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)\p{L}*\.?\s+(\d{4})/iu);
  const pad = n => String(n).padStart(2,'0');
  if (iso) result.date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (numeric) result.date = `${numeric[3].length===2?'20'+numeric[3]:numeric[3]}-${pad(numeric[2])}-${pad(numeric[1])}`;
  else if (named) result.date = `${named[3]}-${pad(MONTHS[named[2].toLocaleLowerCase('de')])}-${pad(named[1])}`;
  const afterDate = text.slice(Math.max(0,text.search(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}/)));
  const time = afterDate.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time) result.time = `${pad(time[1])}:${time[2]}`;
  result.services = [...new Set([...text.matchAll(SERVICE)].map(m=>`${m[1].toUpperCase()} ${m[2]}`))].slice(0,20);
  return result;
}
// Builds a journey straight from a share text with departure and arrival lines; needs no timetable API.
// Change stations are not part of share texts, so the trip becomes one editable section.
export function textJourney(value, timeZone='Europe/Berlin') {
  const text = clean(value).slice(0,10000).replace(/\r/g,'');
  const found = textSearch(text), lines = text.split('\n').map(line=>line.trim());
  // Detailed copies can contain one departure/arrival pair per train.
  const departures = lines.map((line,index)=>/^[•*·-]?\s*(?:ab|von)\s+/i.test(line)?index:-1).filter(index=>index>=0);
  if (departures.length>1) {
    if(departures.length>20) throw Error('Höchstens 20 Zugabschnitte importieren.');
    const sections=departures.map((start,index)=>textJourney(`${found.date}\n${lines.slice(start,departures[index+1] ?? lines.length).join('\n')}`,timeZone));
    if(sections.some(section=>!section)) throw Error('Nicht alle Zugabschnitte sind vollständig. Bitte Abfahrt und Ankunft je Abschnitt ergänzen.');
    let day=found.date,previousTime;
    for(const section of sections) {
      if(previousTime && section.startTime<previousTime) {
        if(Number(previousTime.slice(0,2))-Number(section.startTime.slice(0,2))<12) throw Error('Die Zugabschnitte schließen nicht aneinander an. Bitte Bahnhöfe und Zeiten prüfen.');
        day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
      }
      const overnight=Boolean(section.endDate);
      section.date=day;
      section.endDate=overnight?new Date(Date.parse(day)+86400000).toISOString().slice(0,10):day;
      Object.assign(section.legs[0],{departureDate:day,arrivalDate:section.endDate});
      day=section.endDate;previousTime=section.endTime;
    }
    const legs=sections.flatMap(section=>section.legs),endDate=sections.at(-1).endDate;
    if(legs.some((leg,index)=>index && leg.origin!==sections[index-1].title.split(' → ').at(-1))) throw Error('Die Zugabschnitte schließen nicht aneinander an. Bitte Bahnhöfe und Zeiten prüfen.');
    if(endDate===found.date) for(const leg of legs) {delete leg.departureDate;delete leg.arrivalDate;}
    const result={...sections[0],legs,endTime:sections.at(-1).endTime,title:`${found.origin} → ${found.destination}`,incomplete:sections.some(section=>section.incomplete)};
    if(endDate!==found.date) result.endDate=endDate;else delete result.endDate;
    return result;
  }
  const pick = pattern => lines.find(line=>pattern.test(line)) || '';
  const from = pick(/^[•*·-]?\s*(?:ab|von)\s+/i), to = [...lines].reverse().find(line=>/^[•*·-]?\s*(?:an|nach)\s+/i.test(line)) || '';
  const time = line => line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const end = time(to);
  if (!found.origin || !found.destination || !found.date || !found.time || !end) return null;
  const endTime = `${end[1].padStart(2,'0')}:${end[2]}`;
  if (endTime === found.time) return null;
  const endDate=endTime<found.time?new Date(Date.parse(found.date)+86400000).toISOString().slice(0,10):found.date;
  searchInstant(found.date,found.time,timeZone);
  const train = line => clean(line.match(/\bmit\s+([^,\n]{1,40})/i)?.[1]);
  const track = line => line.match(/\b(?:Gl\.|Gleis)\s*([\w-]{1,6})/i)?.[1];
  const services = [...new Set([train(from),train(to)].filter(Boolean))];
  const arrivalTrack = track(to);
  return {legs:[{origin:found.origin,destination:found.destination+(arrivalTrack?` · Gleis ${arrivalTrack}`:''),
      service:services.join(' → ') || 'Zug',departure:found.time,arrival:endTime,...(endDate!==found.date?{departureDate:found.date,arrivalDate:endDate}:{}),
      platform:track(from)?`Gleis ${track(from)}`:'',number:'',station:'',arrivalStation:''}],
    date:found.date,...(endDate!==found.date?{endDate}:{}),startTime:found.time,endTime,title:`${found.origin} → ${found.destination}`,location:found.origin,source:'text',incomplete:services.length!==1};
}
// Combines manual fields, a pasted Bahn link and pasted text; manual fields win.
export function detectSearch(value, search={}) {
  const raw = clean(value);
  if (raw && /^\S+:\/\//.test(raw) && !/\s/.test(raw)) linkSearch(raw);
  const link = raw.match(/https:\/\/(?:www\.|int\.)?bahn\.de\/\S+/)?.[0];
  const linked = link ? linkSearch(link.replace(/[).,;]+$/,'')) : {}, texted = textSearch(raw);
  const input = Object.fromEntries(['origin','destination','date','time'].map(key=>[key,clean(search[key]) || linked[key] || texted[key] || '']));
  return {...input, services:texted.services, shortLink:Boolean(link && /[?&#]vbid=/.test(link))};
}
export function prepareSearch(value, search={}, timeZone='Europe/Berlin') {
  const input = detectSearch(value, search);
  const missing = [['origin','Start'],['destination','Ziel'],['date','Reisetag'],['time','Abfahrt']].filter(([key])=>!input[key]).map(([,label])=>label);
  if (missing.length) {
    const error = new SearchDetailsRequired(`Bitte noch ergänzen: ${missing.join(', ')}.${input.shortLink?' Kurze Bahn-Links enthalten keine Fahrtdaten – kopiere am besten den ganzen Text aus „Teilen“ mit oder fülle die Felder unten.':''}`);
    error.detected = input;
    throw error;
  }
  if(input.origin.length>200||input.destination.length>200) throw Error('Bitte kürzere Bahnhofsnamen verwenden.');
  try { input.instant = searchInstant(input.date,input.time,timeZone); }
  catch (error) { error.detected = input; throw error; }
  return input;
}
export async function importJourney(value, fetcher=fetch, search={}, timeZone='Europe/Berlin', config={}) {
  const client=transitousClient(config);
  const input=prepareSearch(value,search,timeZone), instant=input.instant;
  const signal=AbortSignal.timeout(45000);
  async function request(path, params) {
    const response=await fetcher(API+path+'?'+new URLSearchParams(params),{
      redirect:'manual',signal,headers:{Accept:'application/json','User-Agent':client}});
    if(!response.ok) throw Error(response.status===429?'Transitous ist gerade ausgelastet. Bitte später erneut versuchen.':'Transitous ist gerade nicht erreichbar oder hat für dieses Datum keine Fahrplandaten.');
    const text=await response.text();
    if(text.length>2000000) throw Error('Die Transitous-Antwort ist zu groß.');
    try{return JSON.parse(text);}catch{throw Error('Transitous hat keine lesbaren Fahrplandaten geliefert.');}
  }
  const normalize = name => name.toLocaleLowerCase('de').replace(/\b(?:hbf|hauptbahnhof)\b\.?/g,'hauptbahnhof').replace(/(?:,?\s+)(?:bf|bahnhof)\.?$/u,'').replace(/[^\p{L}\p{N}]/gu,'');
  async function station(name) {
    const results=await request('v1/geocode',{text:name.replace(/[-‐‑–—,]+/gu,' ').replace(/\s+/g,' ').trim(),type:'STOP',mode:'RAIL',numResults:'5',language:'de'});
    if(!Array.isArray(results)) throw Error('Transitous hat keine lesbaren Bahnhöfe geliefert.');
    const matches=results.filter(s=>s.type==='STOP'&&typeof s.name==='string'&&s.id &&
      (normalize(s.name)===normalize(name) || (Array.isArray(s.areas) && s.areas.some(area=>
        typeof area.name==='string' && [area.name+' '+s.name,s.name+' '+area.name].some(alias=>normalize(alias)===normalize(name))))));
    // Different feeds assign different IDs to the same physical station.
    // Require every distinct-ID pair to be nearby; missing coordinates stay ambiguous.
    const coordinates = s => Number.isFinite(s.lat) && Math.abs(s.lat)<=90 && Number.isFinite(s.lon) && Math.abs(s.lon)<=180;
    const nearby = (a,b) => coordinates(a) && coordinates(b) &&
      (!a.country || !b.country || a.country===b.country) &&
      Math.hypot((a.lat-b.lat)*111195,(a.lon-b.lon)*111195*Math.cos((a.lat+b.lat)*Math.PI/360))<=150;
    const sameStation=matches.every((a,i)=>matches.slice(i+1).every(b=>a.id===b.id || nearby(a,b)));
    const match=sameStation?matches[0]:null;
    if(!match?.id) throw new SearchDetailsRequired(matches.length
      ? `Die Fahrplansuche liefert für „${name}“ mehrere unterschiedliche Bahnhöfe. Bitte den Ort oder einen Namenszusatz ergänzen.`
      : `Die Fahrplansuche konnte „${name}“ nicht zuordnen. Bitte die Schreibweise prüfen oder einen Namenszusatz ergänzen.`);
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
  const compact = name => name.replace(/\s+/g,'');
  const wanted = input.services.map(compact);
  const score = choice => (choice.startTime===input.time?2:0) + (wanted.length && choice.legs.every(leg=>wanted.some(w=>compact(leg.service).includes(w)))?1:0);
  const scores = choices.map(score), best = Math.max(...scores);
  // Only a single exact departure match is safe to apply without asking.
  const recommended = best>=2 && scores.filter(value=>value===best).length===1 ? scores.indexOf(best) : null;
  const {instant:_, ...detected} = input;
  return {choices,recommended,detected,source:'transitous'};
}
