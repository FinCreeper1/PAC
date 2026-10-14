import {mapLocation} from './legacy/api/ideas.js';
import {safeEqual} from './legacy/_middleware.js';
const reply=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
function publicIdeas(ideas) {
  return ideas.map(idea=>({id:idea.id,text:idea.text,createdAt:idea.createdAt,author:idea.author||'',date:idea.date||idea.createdAt.slice(0,10),time:idea.time||'',place:idea.place||'',participants:Array.isArray(idea.participants)?idea.participants:[],location:idea.location||null}))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.createdAt.localeCompare(b.createdAt));
}
export async function handleIdeas(request,cloud,snapshot,env) {
  const method=request.method;
  if(!['GET','POST','PUT','DELETE'].includes(method)) return reply({error:'Methode nicht erlaubt.'},405);
  const body=method==='GET'?{}:await request.json().catch(()=>null);
  if(!body) return reply({error:'Ungültige Anfrage.'},400);
  if(method==='DELETE' && (typeof body.password!=='string'||!safeEqual(body.password,env.ADMIN_PASSWORD))) return reply({error:'Das Adminpasswort ist nicht richtig.'},403);
  const record=await cloud.readText('ideas:board'),ideas=record.value===null?[]:JSON.parse(record.value);
  if(!Array.isArray(ideas)) throw new Error('Ideenspeicher ist beschädigt.');
  if(method==='GET') return reply({ideas:publicIdeas(ideas)});
  if(method==='POST') {
    const raw=typeof body.text==='string'?body.text.trim():'';
    if(!raw||[...raw].length>500) return reply({error:'Die Idee muss zwischen 1 und 500 Zeichen lang sein.'},400);
    const text=raw.replace(/https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.(?:com|de)\/maps|maps\.google\.(?:com|de))[^\s<>"']*/giu,'').trim();
    if(!text) return reply({error:'Bitte zusätzlich zum Maps-Link einen Titel eingeben.'},400);
    const author=String(body.author||'').trim(),date=String(body.date||''),time=String(body.time||''),place=String(body.place||'').trim();
    if(!snapshot.trip.participants?.includes(author)) return reply({error:'Bitte einen Namen aus der Teilnehmerliste auswählen.'},400);
    const minute=CalendarModel.minutes(time);
    if(place.length>160||minute===null||!snapshot.calendar.events.some(event=>event.type==='free'&&event.timing==='scheduled'&&snapshot.calendar.days[event.day-1].isoDate===date&&minute>=CalendarModel.minutes(event.startTime)&&minute<CalendarModel.minutes(event.endTime))) return reply({error:'Diese Uhrzeit liegt nicht in einer freigegebenen Freizeit.'},400);
    if(ideas.length>=500) return reply({error:'Die Ideenliste ist voll.'},409);
    let location=null;
    try {location=await mapLocation(place+' '+raw);} catch {const googleUrl=raw.match(/https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+/)?.[0];if(googleUrl) location={googleUrl,name:'',latitude:null,longitude:null,retryAt:new Date(Date.now()+900000).toISOString(),resolverVersion:3};}
    ideas.push({id:crypto.randomUUID().replaceAll('-',''),text,createdAt:new Date().toISOString(),author,date,time,place:place||location?.name||'',participants:[author],location});
  } else {
    if(typeof body.id!=='string'||!/^[0-9a-f]{32}$/.test(body.id)) return reply({error:'Ungültige Idee.'},400);
    const index=ideas.findIndex(idea=>idea.id===body.id);if(index<0) return reply({error:'Idee nicht gefunden.'},404);
    if(method==='DELETE') ideas.splice(index,1);
    else {
      const name=String(body.name||'').trim(),attending=body.attending??true;
      if(!snapshot.trip.participants?.includes(name)||typeof attending!=='boolean') return reply({error:'Bitte einen Namen aus der Teilnehmerliste auswählen.'},400);
      ideas[index].participants=(ideas[index].participants||[]).filter(value=>value.toLowerCase()!==name.toLowerCase());
      if(attending) ideas[index].participants.push(name);
    }
  }
  await cloud.writeText('ideas:board',JSON.stringify(ideas),record.etag);
  return reply({ideas:publicIdeas(ideas)},method==='POST'?201:200);
}
