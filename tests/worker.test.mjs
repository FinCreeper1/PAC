import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Portal} from '../src/index.js';
import {mockWebdav} from './helpers/webdav.mjs';
import {validateCalendar} from '../src/validation.js';
import seed from '../public/data/calendar.json' with {type:'json'};
import trip from '../public/data/trip.json' with {type:'json'};
import journeys from '../public/data/journeys.json' with {type:'json'};
function setup() {
 const data=new Map(),webdav=mockWebdav();
 const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),list:async({prefix})=>new Map([...data].filter(([k])=>k.startsWith(prefix)))};
 const env={PORTAL_PASSWORD:'portal-test',ADMIN_PASSWORD:'admin-test',SESSION_SECRET:'test-secret-not-for-production',cloudStorage:webdav.cloud,
  ASSETS:{fetch:async req=>{try{return new Response(await readFile(new URL('../public'+new URL(req.url).pathname,import.meta.url)));}catch{return new Response('Not found',{status:404});}}}};
 const portal=new Portal({storage,blockConcurrencyWhile:fn=>fn()},env);
 const call=(path,options={})=>portal.fetch(new Request('https://portal.test'+path,options));
 return {call,data,env,webdav};
}
async function login(call,admin=false) {
 const response=await call(admin?'/admin/login':'/__login',{method:'POST',body:new URLSearchParams({password:admin?'admin-test':'portal-test'})});
 assert.equal(response.status,303);return response.headers.get('set-cookie').split(';')[0];
}
test('private assets and JSON APIs require authentication',async()=>{
 const {call}=setup();assert.match(await (await call('/')).text(),/Kalender öffnen/);
 assert.equal((await call('/api/materials?project=x')).status,401);
 assert.equal((await call('/data/calendar.json')).headers.get('x-portal-content'),null);
});
test('portal login, calendar and logout',async()=>{
 const {call}=setup(),cookie=await login(call);
 const response=await call('/data/calendar.json',{headers:{cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('x-portal-content'),'authenticated');assert.ok((await response.json()).events.length);
 assert.match((await call('/__logout',{headers:{cookie}})).headers.get('set-cookie'),/Max-Age=0/);
});
test('admin isolation, CSRF, publication and stale revision rejection',async()=>{
 const {call}=setup(),cookie=await login(call,true);
 assert.equal((await call('/api/admin/calendar')).status,401);
 const current=await (await call('/api/admin/calendar',{headers:{cookie}})).json();
 current.calendar.events[0].title='Worker publication';
 current.calendar.countdown={enabled:true,deadline:{title:'Abgabe',at:'2026-10-20T12:00:00Z',hideAt:'2026-10-21T12:00:00Z',warningMinutes:60}};
 const options={method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(current)};
 assert.equal((await call('/api/admin/calendar',options)).status,403);
 options.headers['x-csrf-token']=current.csrf;
 const response=await call('/api/admin/calendar',options);assert.equal(response.status,200,await response.clone().text());
 assert.equal((await call('/api/admin/calendar',options)).status,409);
 const saved=await (await call('/api/admin/calendar',{headers:{cookie}})).json();assert.deepEqual(saved.calendar.countdown,current.calendar.countdown);
 const portal=await login(call);assert.equal((await (await call('/data/calendar.json',{headers:{cookie:portal}})).json()).events[0].title,'Worker publication');
});
test('countdown settings reject invalid deadlines',()=>{
 for(const countdown of [{enabled:'yes'},{enabled:true,deadline:{title:'Abgabe',at:'bad',hideAt:'bad',warningMinutes:60}},{enabled:true,deadline:{title:'Abgabe',at:'2026-10-21T12:00:00Z',hideAt:'2026-10-20T12:00:00Z',warningMinutes:60}}]){
  const calendar=CalendarModel.normalize(seed,trip);calendar.countdown=countdown;
  assert.throws(()=>validateCalendar(calendar,seed,trip,journeys));
 }
});
test('invalid calendar values are rejected',()=>{
 const calendar=CalendarModel.normalize(seed,trip);validateCalendar(calendar,seed,trip,journeys);
 calendar.events[0].startTime='99:99';assert.throws(()=>validateCalendar(calendar,seed,trip,journeys));
});
test('shared notes reject conflicting revisions without losing changes',async()=>{
 const {call}=setup(),cookie=await login(call),event=seed.events[0].id;
 const put=body=>call('/api/shared-note',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({event,...body})});
 assert.equal((await put({text:'First',baseText:'',baseRevision:0})).status,200);
 const conflict=await put({text:'Second',baseText:'',baseRevision:0});assert.equal(conflict.status,409);assert.equal((await conflict.json()).text,'First');
});
test('stream upload, manifest, download and password protected deletion',async()=>{
 const {call}=setup(),cookie=await login(call),event=seed.events[0].id;
 const response=await call('/api/materials?project='+event,{method:'PUT',headers:{cookie,'x-portal-password':btoa('portal-test'),'x-delete-password':btoa('owner'),'x-file-name':btoa('test.txt')},body:'worker file'});
 assert.equal(response.status,201,await response.clone().text());const {file}=await response.json();
 const list=await (await call('/api/materials?project='+event,{headers:{cookie}})).json();assert.equal(list.files.length,1);assert.equal(list.files[0].deletePasswordHash,undefined);
 const download=await call(`/api/files/${event}/${file.id}`,{headers:{cookie}});assert.equal(await download.text(),'worker file');
 const manifest=await (await call('/api/offline-manifest',{headers:{cookie}})).json();assert.equal(manifest.files.length,1);
 for(const [password,status] of [['wrong',401],['owner',200]]) assert.equal((await call('/api/materials',{method:'DELETE',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({project:event,id:file.id,password})})).status,status);
});
test('calendar subscriptions work without login but require a token and support ETags',async()=>{
 const {call}=setup(),cookie=await login(call),{path}=await (await call('/api/calendar-subscription',{headers:{cookie}})).json();
 assert.equal((await call('/calendar.ics')).status,401);
 const response=await call(path);assert.equal(response.status,200);assert.match(await response.text(),/BEGIN:VCALENDAR/);
 assert.equal((await call(path,{headers:{'if-none-match':response.headers.get('etag')}})).status,304);
});
test('existing cloud ideas and attendance remain compatible',async()=>{
 const {call,webdav}=setup(),cookie=await login(call),id='a'.repeat(32);
 const idea={id,text:'Museum besuchen',author:trip.participants[0],createdAt:'2026-10-01T12:00:00Z',date:trip.startDate,time:'18:00',place:'Museum',participants:[trip.participants[0]]};
 await webdav.cloud.writeText('ideas:board',JSON.stringify([idea]),null);
 const read=await call('/api/ideas',{headers:{cookie}});assert.equal((await read.json()).ideas[0].author,idea.author);
 const attend=await call('/api/ideas',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id,name:trip.participants[1],attending:true})});assert.equal(attend.status,200);assert.equal((await attend.json()).ideas[0].participants.length,2);
 const stored=await webdav.cloud.readText('ideas:board');assert.equal(JSON.parse(stored.value)[0].participants.length,2);
});
test('cross origin writes are rejected',async()=>{
 const {call}=setup();assert.equal((await call('/__login',{method:'POST',headers:{origin:'https://evil.test'},body:new URLSearchParams({password:'portal-test'})})).status,403);
});
test('requests are serialized even when storage yields',async()=>{
 const {call}=setup(),cookie=await login(call),event=seed.events[0].id;
 const options=text=>({method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({event,text,baseText:'',baseRevision:0})});
 const results=await Promise.all([call('/api/shared-note',options('A')),call('/api/shared-note',options('B'))]);
 assert.deepEqual(results.map(r=>r.status),[200,409]);
});
test('published new events receive their own material area',async()=>{
 const {call}=setup(),cookie=await login(call,true),current=await (await call('/api/admin/calendar',{headers:{cookie}})).json();
 current.calendar.events.push({...current.calendar.events[0],id:'new-worker-event'});
 const saved=await call('/api/admin/calendar',{method:'PUT',headers:{cookie,'x-csrf-token':current.csrf,'content-type':'application/json'},body:JSON.stringify(current)});assert.equal(saved.status,200);
 const portal=await login(call),response=await call('/api/materials?project=new-worker-event',{headers:{cookie:portal}});assert.equal(response.status,200);assert.deepEqual((await response.json()).files,[]);
});

test('cloud snapshot and shared notes survive replacement of the worker object',async()=>{
 const first=setup(),cookie=await login(first.call,true),state=await (await first.call('/api/admin/calendar',{headers:{cookie}})).json();
 state.calendar.events[0].title='Persisted only in Nextcloud';
 assert.equal((await first.call('/api/admin/calendar',{method:'PUT',headers:{cookie,'x-csrf-token':state.csrf,'content-type':'application/json'},body:JSON.stringify(state)})).status,200);
 const fresh=new Portal({storage:{get:async()=>null}},first.env);
 const response=await fresh.fetch(new Request('https://portal.test/data/calendar.json',{headers:{cookie:await login(first.call)}}));assert.equal((await response.json()).events[0].title,'Persisted only in Nextcloud');
 assert.ok([...first.data.keys()].every(key=>key.startsWith('session:')));
});
test('cloud outage never becomes a blank success or a fresh seed calendar',async()=>{
 const {call,webdav}=setup(),cookie=await login(call);webdav.setFail(true);
 for(const path of ['/data/calendar.json','/api/shared-note?event='+seed.events[0].id,'/api/materials?project='+seed.events[0].id]) {
  const response=await call(path,{headers:{cookie}});assert.equal(response.status,502);assert.equal((await response.json()).code,'storage_unavailable');
 }
});
test('existing cloud snapshot supplies trip data, aliases, journeys and route bodies',async()=>{
 const {call,webdav}=setup(),calendar=CalendarModel.normalize(seed,trip),changedTrip={...trip,title:'Reise aus der Wolke'},event=calendar.events[0];
 event.routeRef='route-cloud';
 const route={points:[{name:'Cloud stop',latitude:50,longitude:6}]};
 const snapshot={calendar,trip:changedTrip,journeys,materials:{[event.id]:'old-storage-alias'},routes:{'route-cloud.json':route}};
 await webdav.cloud.writeText('calendar:snapshot',JSON.stringify(snapshot),null);
 const cookie=await login(call);
 assert.equal((await (await call('/data/trip.json',{headers:{cookie}})).json()).title,changedTrip.title);
 assert.deepEqual(await (await call('/data/routes/route-cloud.json',{headers:{cookie}})).json(),route);
 const current=await (await call('/api/materials?project='+event.id,{headers:{cookie}})).json();assert.deepEqual(current.files,[]);
 assert.ok(webdav.calls.some(row=>row.method==='PROPFIND'&&row.path.endsWith('/metadata/old-storage-alias')));
 const admin=await login(call,true);
 assert.equal((await (await call('/api/admin/calendar',{headers:{cookie:admin}})).json()).trip.title,changedTrip.title);
});
test('legacy cloud notes are readable and shared notes keep the existing key',async()=>{
 const {call,webdav}=setup(),calendar=CalendarModel.normalize(seed,trip),event=calendar.events[0];delete event.note;
 await webdav.cloud.writeText('calendar:snapshot',JSON.stringify({calendar,trip,journeys,materials:{},routes:{}}),null);
 await webdav.cloud.writeText('note:'+event.id,'Bestehende Notiz',null);
 await webdav.cloud.writeText('shared-note:'+event.id,JSON.stringify({text:'Gemeinsame Wolkennotiz',revision:7,updatedAt:'2026-10-14T12:00:00Z'}),null);
 const cookie=await login(call);
 assert.equal((await (await call('/api/notes?event='+event.id,{headers:{cookie}})).json()).note,'Bestehende Notiz');
 const shared=await (await call('/api/shared-note?event='+event.id,{headers:{cookie}})).json();assert.equal(shared.revision,7);assert.equal(shared.text,'Gemeinsame Wolkennotiz');
});

test('unconfigured claimed deployment returns setup guidance instead of crashing',async()=>{
 const env={PORTAL_PASSWORD:'test',ADMIN_PASSWORD:'test',SESSION_SECRET:'test'};
 const portal=new Portal({storage:{get:async()=>null}},env);
 const response=await portal.fetch(new Request('https://portal.test/'));
 assert.equal(response.status,503);assert.match(await response.text(),/Variables and Secrets/);
});

test('unconfigured portal provides setup instructions without revealing configured values',async()=>{
 const {env,data}=setup();delete env.PORTAL_PASSWORD;env.NEXTCLOUD_APP_PASSWORD='never-show-this';
 const portal=new Portal({storage:{get:async()=>null}},env);
 const page=await portal.fetch(new Request('https://portal.test/'));
 assert.equal(page.status,503);assert.match(page.headers.get('content-type'),/text\/html/);const html=await page.text();assert.match(html,/PORTAL_PASSWORD/);assert.match(html,/WebDAV/);assert.ok(!html.includes('never-show-this'));
 const api=await portal.fetch(new Request('https://portal.test/api/materials'));assert.equal(api.status,503);const body=await api.json();assert.equal(body.code,'configuration_missing');assert.deepEqual(body.missing,['PORTAL_PASSWORD']);
 const head=await portal.fetch(new Request('https://portal.test/',{method:'HEAD'}));assert.equal(await head.text(),'');
});
test('invalid Nextcloud configuration returns actionable setup response',async()=>{
 const portal=new Portal({storage:{get:async()=>null}},{PORTAL_PASSWORD:'x',ADMIN_PASSWORD:'y',SESSION_SECRET:'secret',NEXTCLOUD_WEBDAV_URL:'http://invalid.test',NEXTCLOUD_USERNAME:'user',NEXTCLOUD_APP_PASSWORD:'private',NEXTCLOUD_ROOT:'PAC'});
 const response=await portal.fetch(new Request('https://portal.test/api/materials'));assert.equal(response.status,503);const data=await response.json();assert.equal(data.code,'configuration_invalid');assert.ok(!JSON.stringify(data).includes('private'));
});

test('deployed admin form retains same-origin referrers while rejecting foreign and null origins',async()=>{
 const {default:worker}=await import('../src/index.js');const fixture=setup();
 const env={PORTAL:{idFromName:x=>x,get:()=>({fetch:req=>fixture.call(new URL(req.url).pathname,{method:req.method,headers:req.headers,body:req.method==='POST'?req.body:undefined,...(req.method==='POST'?{duplex:'half'}:{})})})}};
 const page=await worker.fetch(new Request('https://portal.test/admin'),env);assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'strict-origin-when-cross-origin');assert.match(await page.text(),/action="\/admin\/login"/);
 const submit=origin=>worker.fetch(new Request('https://portal.test/admin/login',{method:'POST',headers:{origin},body:new URLSearchParams({password:'admin-test'})}),env);
 assert.equal((await submit('https://portal.test')).status,303);assert.equal((await submit('https://other.test')).status,403);assert.equal((await submit('null')).status,403);
});

test('admin creates a train journey and publishes its details atomically',async()=>{
 const {call}=setup(),cookie=await login(call,true);
 const state=await (await call('/api/admin/calendar',{headers:{cookie}})).json();
 const event=state.calendar.events[0];
 event.type='travel';event.timing='scheduled';event.journeyId=event.id;
 event.journey={heading:'Start → Ziel',url:'https://www.bahn.de/',dialog:event.id+'-journey',statusId:event.id+'-status',buttonId:event.id+'-refresh',legs:[{service:'ICE 123',origin:'Start',destination:'Ziel',departure:event.startTime,arrival:event.endTime,timeId:event.id+'-leg',platformId:event.id+'-platform',delayId:event.id+'-delay'}]};
 const details=structuredClone(event.journey);
 const publish=await call('/api/admin/calendar',{method:'PUT',headers:{cookie,'x-csrf-token':state.csrf},body:JSON.stringify({calendar:state.calendar,revision:state.revision})});
 assert.equal(publish.status,200);
 const saved=await publish.json();assert.equal(saved.calendar.events[0].journey,undefined);
 const participant=await login(call);
 assert.deepEqual((await (await call('/data/journeys.json',{headers:{cookie:participant}})).json())[event.id],details);
 const invalid=structuredClone(state.calendar);invalid.events[0].journey.url='javascript:alert(1)';
 assert.throws(()=>validateCalendar(invalid,seed,trip,journeys));
 invalid.events[0].journey=details;invalid.events[0].journey.legs=[];
 assert.throws(()=>validateCalendar(invalid,seed,trip,journeys));
});

test('publishing an extended range updates trip dates atomically and preserves existing event dates',async()=>{
 const {call}=setup(),cookie=await login(call,true);
 const state=await (await call('/api/admin/calendar',{headers:{cookie}})).json();
 const first=state.calendar.days[0].isoDate;
 const previous=new Date(Date.parse(first)-1460*86400000).toISOString().slice(0,10);
 const originalDates=new Map(state.calendar.events.map(e=>[e.id,state.calendar.days[e.day-1].isoDate]));
 const calendar=CalendarModel.extend(state.calendar,previous);
 const response=await call('/api/admin/calendar',{method:'PUT',headers:{cookie,'x-csrf-token':state.csrf},body:JSON.stringify({calendar,revision:state.revision})});
 assert.equal(response.status,200);
 const saved=await response.json();assert.equal(saved.trip.startDate,previous);assert.equal(saved.calendar.days[0].isoDate,previous);
 assert.equal(saved.calendar.days.length,state.calendar.days.length+1);
 for(const event of saved.calendar.events)assert.equal(saved.calendar.days[event.day-1].isoDate,originalDates.get(event.id));
 const participant=await login(call);
 const persisted=await (await call('/data/trip.json',{headers:{cookie:participant}})).json();
 assert.equal(persisted.startDate,previous);assert.equal(persisted.endDate,state.calendar.days.at(-1).isoDate);
 const reloaded=await (await call('/api/admin/calendar',{headers:{cookie}})).json();
 assert.equal(reloaded.trip.startDate,previous);assert.equal(reloaded.calendar.days[0].isoDate,previous);
});

test('map settings require admin and CSRF, persist without altering calendar, and reject stale writes',async()=>{
 const {call,env}=setup();
 assert.equal((await call('/api/admin/settings')).status,401);
 const cookie=await login(call,true), headers={cookie};
 const current=await (await call('/api/admin/settings',{headers})).json();
 const before=await (await call('/api/admin/calendar',{headers})).json();
 const put=(mapProvider,revision=current.revision,csrf=current.csrf)=>call('/api/admin/settings',{method:'PUT',headers:{cookie,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({mapProvider,revision})});
 assert.equal((await put('openstreetmap',current.revision,'invalid')).status,403);
 assert.equal((await put('invalid')).status,400);
 assert.equal((await put('mapkit')).status,400);
 const response=await put('openstreetmap');assert.equal(response.status,200);
 const saved=await response.json();
 assert.equal((await put('mapkit')).status,409);
 const after=await (await call('/api/admin/calendar',{headers})).json();
 assert.deepEqual(after.calendar,before.calendar);assert.equal(after.trip.mapProvider,'openstreetmap');
 const participant=await login(call);
 assert.equal((await (await call('/data/trip.json',{headers:{cookie:participant}})).json()).mapProvider,'openstreetmap');
 env.APPLE_MAPS_TOKEN='configured-test-token';
 assert.equal((await put('mapkit',saved.revision)).status,200);
 assert.equal((await (await call('/api/admin/settings',{headers})).json()).mapProvider,'mapkit');
});
test('invoices require admin, CSRF and confirmed deletion and stay out of participant downloads',async()=>{
 const {call}=setup(),participant=await login(call),cookie=await login(call,true);
 for(const headers of [{},{cookie:participant}])assert.equal((await call('/api/admin/invoices',{headers})).status,401);
 const {csrf}=await(await call('/api/admin/invoices',{headers:{cookie}})).json();
 const options={method:'PUT',headers:{cookie,'x-file-name':btoa('Rechnung.txt'),'content-length':'7'},body:'invoice'};
 assert.equal((await call('/api/admin/invoices',options)).status,403);options.headers['x-csrf-token']=csrf;
 const uploaded=await call('/api/admin/invoices',options);assert.equal(uploaded.status,201,await uploaded.clone().text());
 const {id}=await uploaded.json(),path='/api/admin/invoices/'+id;
 assert.equal(await(await call(path,{headers:{cookie}})).text(),'invoice');
 assert.equal((await call(path,{headers:{cookie:participant}})).status,401);
 assert.equal((await(await call('/api/offline-manifest',{headers:{cookie:participant}})).json()).files.length,0);
 assert.equal((await call('/api/files/_admin-invoices/'+id,{headers:{cookie:participant}})).status,404);
 const headers={cookie,'x-csrf-token':csrf};assert.equal((await call(path,{method:'DELETE',headers})).status,400);
 headers['x-confirm-delete']='yes';assert.equal((await call(path,{method:'DELETE',headers})).status,200);
 assert.equal((await call(path,{headers:{cookie}})).status,404);
});
