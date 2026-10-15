import {openConfiguration,finishSetup,onboardingResponse} from './onboarding.js';
import {missingSettings,setupResponse} from './setup.js';
import { onRequest as authenticate, sign, safeEqual } from './legacy/_middleware.js';
import * as materials from './legacy/api/materials.js';
import { handleIdeas } from './ideas.js';
import { NextcloudStorage, StorageConflict } from './nextcloud.js';
import { onRequestGet as fileDownload } from './legacy/api/files/[[path]].js';
import { onRequestGet as mapsToken } from './legacy/api/apple-maps-token.js';
import '../public/shared/calendar-model.js';
import '../public/shared/calendar-export.js';
import seed from '../public/data/calendar.json' with {type:'json'};
import trip from '../public/data/trip.json' with {type:'json'};
import aliases from '../public/data/materials.json' with {type:'json'};
import journeys from '../public/data/journeys.json' with {type:'json'};
import { validateCalendar } from './validation.js';
const json = (data, status=200) => Response.json(data,{status,headers:{'cache-control':'private, no-store'}});
const cookie = (name,value,age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (location, session) => new Response(null,{status:303,headers:{location,'set-cookie':session,'cache-control':'no-store'}});
const secret = env => env.CALENDAR_FEED_SECRET || env.ADMIN_PASSWORD;
const feedToken = env => sign('profilreise:calendar-feed:v1',secret(env));
const attachmentToken = (env,event,id) => sign(`profilreise:calendar-attachment:v1:${event}:${id}`,secret(env));
function decodeHeader(request,name) {
  try {return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(request.headers.get(name)||''), c=>c.charCodeAt(0)));} catch {return '';}
}

// One object serializes writes; application data stays exclusively in Nextcloud.
export class Portal {
  constructor(state,env) {this.state=state;this.baseEnv=env;this.env=env;this.queue=Promise.resolve();this.cloud=env.cloudStorage || null;}
  async fetch(request) {
    // A promise queue serializes requests without closing the input gate:
    // closing that gate while streaming an upload can prevent its body arriving.
    const result=this.queue.then(()=>{this.currentSnapshot=undefined;return this.loadConfiguration().then(()=>this.handle(request));});
    this.queue=result.catch(()=>{});
    return result.catch(error=>{
      if(error instanceof StorageConflict) return json({error:error.message},409);
      console.error('portal_request_failed',error.message);
      return json({error:'Dateispeicher derzeit nicht erreichbar.',code:'storage_unavailable'},502);
    });
  }
  configured(){return missingSettings(this.env,Boolean(this.cloud)).length===0;}
  async loadConfiguration(){
    if(this.configurationLoaded)return;
    const record=await this.state.storage.get('configuration:v1');
    if(record){const config=await openConfiguration(record,this.baseEnv.PAC_SETUP_SECRET);this.env={...config,...this.baseEnv};}
    this.configurationLoaded=true;
  }
  async snapshot() {
    if(!this.currentSnapshot) {
      const record=await this.cloud.readText('calendar:snapshot');
      const value=record.value===null ? {calendar:CalendarModel.normalize(seed,trip),trip,journeys,materials:aliases,routes:{}} : JSON.parse(record.value);
      if(!value || !value.calendar || !value.routes || !value.trip || !value.journeys || !value.materials) throw new Error('Kalendersicherung in der Wolke ist ungültig.');
      value.calendar=CalendarModel.normalize(value.calendar,value.trip);
      this.currentSnapshot={value,etag:record.etag};
    }
    return this.currentSnapshot;
  }
  async calendar() {return (await this.snapshot()).value.calendar;}
  async route(ref) {return (await this.snapshot()).value.routes[ref+'.json'] || null;}
  async saveSnapshot(value) {const current=await this.snapshot();await this.cloud.writeText('calendar:snapshot',JSON.stringify(value),current.etag);}

  async revision(calendar) {return sign(JSON.stringify(calendar),'calendar-revision-v1');}
  async adminSession(request) {
    const raw=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('profilreise_admin='))?.slice('profilreise_admin='.length);
    if (!raw) return null;
    const session=await this.state.storage.get(`session:${raw}`);
    if (!session || session.expires<Date.now()) {await this.state.storage.delete(`session:${raw}`);return null;}
    return {...session,id:raw};
  }
  storeAdapter() {
    return {
      list:options=>this.cloud.list(options),
      getWithMetadata:(key,type)=>this.cloud.getWithMetadata(key,type),
      put:(key,value,options)=>this.cloud.putFile(key,value,options.metadata),
      delete:key=>this.cloud.delete(key),
    };
  }
  async handle(request) {
    const env=this.env, url=new URL(request.url), path=url.pathname, method=request.method;
    if(path==='/api/setup')return finishSetup(request,this);
    if(path==='/setup'||path==='/setup.js'){
      if(!['GET','HEAD'].includes(method))return json({error:'Methode nicht erlaubt.'},405);
      if(this.configured())return new Response(null,{status:303,headers:{location:'/', 'cache-control':'no-store'}});
      if(typeof this.baseEnv.PAC_SETUP_SECRET==='string'&&this.baseEnv.PAC_SETUP_SECRET.length>=32)return onboardingResponse(request);
    }
    const missing=missingSettings(env,Boolean(this.cloud));
    if(missing.length){
      if(this.baseEnv.PAC_SETUP_SECRET?.length>=32&&!path.startsWith('/api/'))return new Response(null,{status:303,headers:{location:'/setup','cache-control':'no-store'}});
      return setupResponse(request,missing);
    }
    try{this.cloud ||= new NextcloudStorage(env);}catch{return setupResponse(request,[],true);}
    if(!['GET','HEAD','OPTIONS'].includes(method) && request.headers.get('origin') && request.headers.get('origin')!==url.origin) return json({error:'Fremder Ursprung.'},403);
    const session=await this.adminSession(request);
    if(path==='/admin/login' && method==='POST') {
      const body=await request.formData();
      if(!safeEqual(String(body.get('password')||''),env.ADMIN_PASSWORD)) return this.adminLogin(request,true);
      const id=crypto.randomUUID(), csrf=crypto.randomUUID();
      await this.state.storage.put(`session:${id}`,{csrf,expires:Date.now()+7200000});
      return redirect('/admin',cookie('profilreise_admin',id,7200));
    }
    if(path.startsWith('/admin') || path.startsWith('/api/admin/')) {
      if(!session) return path.startsWith('/api/') ? json({error:'Bitte erneut anmelden.'},401) : this.adminLogin(request);
      if(!['GET','HEAD'].includes(method) && !safeEqual(request.headers.get('x-csrf-token')||'',session.csrf)) return json({error:'Ungültiger Sitzungsschlüssel.',code:'csrf_invalid'},403);
      if(path==='/admin/logout' && method==='POST') {await this.state.storage.delete(`session:${session.id}`);return redirect('/admin',cookie('profilreise_admin','',0));}
      if(path==='/api/admin/session' && method==='GET') {
        await this.state.storage.put(`session:${session.id}`,{csrf:session.csrf,expires:Date.now()+7200000});
        const response=json({authenticated:true});response.headers.set('set-cookie',cookie('profilreise_admin',session.id,7200));return response;
      }
      if(path==='/api/admin/calendar') {
        const current=await this.calendar(), revision=await this.revision(current);
        if(method==='GET') return json({calendar:current,revision,csrf:session.csrf,trip:(await this.snapshot()).value.trip,noteImportError:null});
        if(method!=='PUT') return json({error:'Methode nicht erlaubt.'},405);
        const text=await request.text();if(new TextEncoder().encode(text).length>2000000) return json({error:'Kalender zu groß.'},413);
        let body;try {body=JSON.parse(text);const snapshot=(await this.snapshot()).value;validateCalendar(body.calendar,current,snapshot.trip,snapshot.journeys);} catch(error) {return json({error:error.message},400);}
        if(body.revision!==revision) return json({error:'Kalender wurde inzwischen geändert. Bitte neu laden.'},409);
        const calendar=body.calendar,snapshot=structuredClone((await this.snapshot()).value);
        for(const event of calendar.events) {
          if(event.mapRoute) {
            const ref='route-'+await this.revision(event.mapRoute);
            snapshot.routes[ref+'.json']=event.mapRoute;event.routeRef=ref;delete event.mapRoute;
          }
          if(event.routeRef && !snapshot.routes[event.routeRef+'.json']) {
            const asset=await env.ASSETS.fetch(new Request(new URL(`/data/routes/${event.routeRef}.json`,request.url)));
            if(!asset.ok) return json({error:'Unbekannte Route.'},400);
            snapshot.routes[event.routeRef+'.json']=await asset.json();
          }
        }
        delete calendar.publicationSource;calendar.publishedAt=new Date().toISOString();
        snapshot.calendar=calendar;await this.saveSnapshot(snapshot);
        return json({saved:true,calendar,revision:await this.revision(calendar)});
      }
      if(path==='/api/admin/place-search' && method==='GET') return this.placeSearch(url);
      if(path.startsWith('/api/')) return json({error:'Nicht gefunden.'},404);
      if(!['GET','HEAD'].includes(method)) return json({error:'Methode nicht erlaubt.'},405);
      return this.asset(request,path==='/admin'||path==='/admin/'?'/admin/index.html':path);
    }
    if(path==='/calendar.ics') {
      if(method!=='GET' && method!=='HEAD') return json({error:'Methode nicht erlaubt.'},405);
      if(!safeEqual(url.searchParams.get('token')||'',await feedToken(env))) return json({error:'Ungültiger Token.'},401);
      return this.feed(request);
    }
    const attachment=/^\/calendar-attachment\/([a-z0-9-]+)\/([a-f0-9-]+)\/([a-f0-9]+)\//.exec(path);
    if(attachment) {
      if(!['GET','HEAD'].includes(method)) return json({error:'Methode nicht erlaubt.'},405);
      if(!safeEqual(attachment[3],await attachmentToken(env,attachment[1],attachment[2]))) return json({error:'Ungültiger Token.'},401);
      return this.download(request,attachment[1],attachment[2]);
    }
    if(session && path.startsWith('/data/routes/')) {
      const route=await this.route(path.split('/').at(-1).replace(/\.json$/,''));
      if(route) return json(route);
    }
    if(session && (path.startsWith('/shared/') || path.startsWith('/data/routes/') || path==='/api/apple-maps-token')) return path.startsWith('/api/') ? mapsToken({env}) : this.asset(request,path);
    return authenticate({request,env,next:()=>this.portal(request)});
  }
  async adminLogin(request,error=false) {
    // Reuse the existing login page, including its escaping and visual design.
    const page=await authenticate({request:new Request(new URL('/',request.url)),env:this.env,next:()=>new Response()});
    return new Response((await page.text()).replace('action="/__login"','action="/admin/login"').replace('Kalender öffnen','Admin öffnen').replace('Dieser Kalender ist nur für Teilnehmende zugänglich.',error?'Das Adminpasswort ist nicht richtig.':'Mit dem Passwort für die Reiseleitung anmelden.'),{status:error?401:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }
  async asset(request,path=new URL(request.url).pathname) {
    const response=await this.env.ASSETS.fetch(new Request(new URL(path,request.url),{method:request.method==='HEAD'?'HEAD':'GET'}));
    const result=new Response(response.body,response);result.headers.set('cache-control','private, no-store');return result;
  }
  async context(request) {
    const calendar=await this.calendar(),snapshot=(await this.snapshot()).value;
    return {request,env:{...this.env,MATERIALS:this.storeAdapter(),eventStorage:async()=>id=>calendar.events.some(e=>e.id===id)?snapshot.materials[id]||id:null}};
  }
  async download(request,event,id) {
    const context=await this.context(request);
    const response=await fileDownload({...context,params:{path:[event,id]}});
    if(request.method==='HEAD') return new Response(null,response);
    return response;
  }
  async portal(request) {
    const url=new URL(request.url),path=url.pathname,method=request.method,context=await this.context(request);
    if(path==='/data/calendar.json') return json(await this.calendar());
    const dataFile=/^\/data\/(trip|journeys|materials)\.json$/.exec(path);
    if(dataFile) return json((await this.snapshot()).value[dataFile[1]]);
    if(path.startsWith('/data/routes/')) {
      const route=await this.route(path.split('/').at(-1).replace(/\.json$/,''));
      if(route) return json(route);
    }
    if(path==='/api/calendar-subscription' && method==='GET') return json({path:'/calendar.ics?token='+await feedToken(this.env)});
    if(path==='/api/apple-maps-token' && method==='GET') return mapsToken(context);
    if(path==='/api/ideas') return handleIdeas(request,this.cloud,(await this.snapshot()).value,this.env);
    if(path==='/api/notes') {
      if(method!=='GET') return json({error:'Notizen werden mit dem Kalender veröffentlicht.'},403);
      const event=(await this.calendar()).events.find(e=>e.id===url.searchParams.get('event'));
      if(!event) return json({error:'Unbekannter Termin.'},400);
      const legacy=event.note==null ? (await this.cloud.readText('note:'+event.id)).value : null;
      return json({note:event.note??legacy??''});
    }
    if(path==='/api/shared-note') return this.sharedNote(request);
    if(path==='/api/offline-manifest' && method==='GET') return json(await this.manifest());
    if(path==='/api/materials') {
      if(method==='PUT') {
        const project=url.searchParams.get('project')||'',storageKey=(await context.env.eventStorage())(project);
        if(!storageKey) return json({error:'Unbekannter Termin.'},400);
        if(!safeEqual(decodeHeader(request,'x-portal-password'),this.env.PORTAL_PASSWORD)) return json({error:'Das Passwort ist nicht richtig.'},401);
        const password=decodeHeader(request,'x-delete-password'),name=decodeHeader(request,'x-file-name');
        if(!password||password.length>128||!name||!request.body) return json({error:'Dateiname und Löschpasswort erforderlich.'},400);
        const rawSize=request.headers.get('content-length'),expectedSize=rawSize!==null&&/^\d+$/.test(rawSize)?Number(rawSize):undefined;
        if(typeof FixedLengthStream==='function'&&!Number.isSafeInteger(expectedSize))return json({error:'Die Dateigröße fehlt. Bitte die Datei erneut als vollständige Datei hochladen.'},411);
        const id=crypto.randomUUID(),metadata={name:materials.safeFilename(name),type:'application/octet-stream',uploadedAt:new Date().toISOString(),...await materials.createDeletePasswordData(password)};
        const object=await this.cloud.putFile(`${storageKey}/${id}`,request.body,metadata,expectedSize);
        return json({file:{id,name:metadata.name,type:metadata.type,size:object.size,uploadedAt:metadata.uploadedAt}},201);
      }
      const handler=materials[{GET:'onRequestGet',POST:'onRequestPost',DELETE:'onRequestDelete'}[method]];
      return handler?handler(context):json({error:'Methode nicht erlaubt.'},405);
    }
    const file=/^\/api\/files\/([a-z0-9-]+)\/([a-f0-9-]+)$/.exec(path);
    if(file && ['GET','HEAD'].includes(method)) return this.download(request,file[1],file[2]);
    if(path.startsWith('/api/')) return json({error:'Nicht gefunden.'},404);
    if(!['GET','HEAD'].includes(method)) return json({error:'Methode nicht erlaubt.'},405);
    return this.asset(request,path==='/'?'/index.html':path);
  }
  async sharedNote(request) {
    const method=request.method;
    if(!['GET','PUT'].includes(method)) return json({error:'Methode nicht erlaubt.'},405);
    const body=method==='PUT'?await request.json():{}, id=body.event||new URL(request.url).searchParams.get('event');
    if(!(await this.calendar()).events.some(e=>e.id===id)) return json({error:'Unbekannter Termin.'},400);
    const key=`shared-note:${id}`,record=await this.cloud.readText(key),current=record.value===null?{text:'',revision:0,updatedAt:null}:JSON.parse(record.value);
    if(method==='GET') return json(current);
    if(typeof body.text!=='string'||body.text.length>10000) return json({error:'Notiz zu lang.'},400);
    if(body.baseRevision!==current.revision && body.text!==current.text && body.baseText!==current.text) return json({...current,conflict:true},409);
    const next={text:body.text,revision:current.revision+1,updatedAt:new Date().toISOString()};await this.cloud.writeText(key,JSON.stringify(next),record.etag);return json(next);
  }
  async manifest() {
    const calendar=await this.calendar(),files=[],store=this.storeAdapter(),snapshot=(await this.snapshot()).value;
    for(const event of calendar.events) {
      let cursor;
      do {
        const page=await store.list({prefix:`${snapshot.materials[event.id]||event.id}/`,cursor});
        for(const entry of page.keys) if(entry.metadata) {
          const {name,type,size,uploadedAt}=entry.metadata,id=entry.name.split('/').at(-1);
          files.push({event:event.id,id,name,type,size,uploadedAt,day:event.day,isoDate:calendar.days[event.day-1].isoDate,title:event.title,url:`/api/files/${event.id}/${id}`,materialsUrl:`/api/materials?project=${event.id}`});
        }
        cursor=page.cursor;
      } while(cursor);
    }
    return {generatedAt:new Date().toISOString(),days:calendar.days,files};
  }
  async feed(request) {
    const calendar=await this.calendar(),manifest=await this.manifest(),url=new URL(request.url);
    const events=await Promise.all(calendar.events.map(async event=>CalendarExport.calendarExportEvent({...event,url:url.origin,attachments:await Promise.all(manifest.files.filter(f=>f.event===event.id).map(async f=>({...f,url:`${url.origin}/calendar-attachment/${event.id}/${f.id}/${await attachmentToken(this.env,event.id,f.id)}/${encodeURIComponent(f.name)}`})))},calendar)));
    const text=CalendarExport.buildCalendarFile(events,new Date(calendar.publishedAt||'2026-10-14T00:00:00Z'));
    const etag='"'+await this.revision(text)+'"';
    return new Response(request.method==='HEAD'||request.headers.get('if-none-match')===etag?null:text,{status:request.headers.get('if-none-match')===etag?304:200,headers:{'content-type':'text/calendar; charset=utf-8','cache-control':'private, no-cache',etag}});
  }
  async placeSearch(url) {
    const query=(url.searchParams.get('q')||'').trim();
    if(!query||query.length>200) return json({error:'Bitte einen Ort eingeben.'},400);
    const key=`places:${query.toLowerCase()}`,cached=await this.state.storage.get(key);
    if(cached && cached.expires>Date.now()) return json({places:cached.places});
    const last=await this.state.storage.get('place-search-last')||0;
    if(Date.now()-last<1100) return json({error:'Bitte einen Moment warten.'},429);
    await this.state.storage.put('place-search-last',Date.now());
    const response=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q:query,format:'jsonv2',limit:'6','accept-language':'de'}),{headers:{'user-agent':'Profilreise-Ortssuche/1.0'},signal:AbortSignal.timeout(12000)});
    if(!response.ok) return json({error:'Ortssuche derzeit nicht verfügbar.'},502);
    const places=(await response.json()).filter(row=>Number.isFinite(Number(row.lat))&&Number.isFinite(Number(row.lon))).map(row=>({name:row.display_name,formattedAddress:row.display_name,coordinate:{latitude:Number(row.lat),longitude:Number(row.lon)}}));
    await this.state.storage.put(key,{places,expires:Date.now()+604800000});return json({places});
  }
}
export default {
  async fetch(request,env) {
    const response=await env.PORTAL.get(env.PORTAL.idFromName('portal-v1')).fetch(request);
    const result=new Response(request.method==='HEAD'?null:response.body,response);
    result.headers.set('x-content-type-options','nosniff');result.headers.set('x-frame-options','DENY');result.headers.set('referrer-policy','same-origin');
    return result;
  }
};
