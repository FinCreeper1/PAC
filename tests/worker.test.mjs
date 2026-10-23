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
 return {call,data,env,webdav,portal};
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
test('PAC login pages link to the other login, including password errors',async()=>{
 const {call}=setup();
 for(const [path,options,href,label,action] of [
  ['/',{},'/admin','Zum Admin-Login','/__login'],
  ['/admin',{},'/','Zum normalen Login','/admin/login'],
  ['/__login',{method:'POST',body:new URLSearchParams({password:'wrong'})},'/admin','Zum Admin-Login','/__login'],
  ['/admin/login',{method:'POST',body:new URLSearchParams({password:'wrong'})},'/','Zum normalen Login','/admin/login']
 ]) {
  const response=await call(path,options),html=await response.text();
  assert.ok(html.includes('<a class="login-switch" href="'+href+'">'+label+'</a>'));
  assert.ok(html.includes('action="'+action+'"'));
  assert.equal(response.status,options.method?401:200);
 }
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
 const pdf={method:'PUT',headers:{cookie,'x-csrf-token':csrf,'x-file-name':btoa('Beleg.pdf'),'x-file-note':btoa('Museum'),'x-file-amount-cents':'2490','content-length':'3'},body:'pdf'};
 const saved=await(await call('/api/admin/invoices',pdf)).json();
 const listed=(await(await call('/api/admin/invoices',{headers:{cookie}})).json()).files.find(file=>file.id===saved.id);
 assert.equal(listed.note,'Museum');assert.equal(listed.amountCents,2490);
 const view=await call('/api/admin/invoices/'+saved.id,{headers:{cookie}});
 assert.equal(view.headers.get('content-type'),'application/pdf');assert.match(view.headers.get('content-disposition'),/^inline/);
 assert.match((await call('/api/admin/invoices/'+saved.id+'?download',{headers:{cookie}})).headers.get('content-disposition'),/^attachment/);
 pdf.headers['x-file-amount-cents']='-5';assert.equal((await call('/api/admin/invoices',pdf)).status,400);
 assert.equal(listed.category,'sonstiges');assert.equal(listed.paid,false);
 const patch=body=>call('/api/admin/invoices/'+saved.id,{method:'PATCH',headers:{cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify(body)});
 const edited=await patch({amountCents:1500,note:' Zoo ',category:'eintritt',paid:true});assert.equal(edited.status,200,await edited.clone().text());
 const relisted=(await(await call('/api/admin/invoices',{headers:{cookie}})).json()).files.find(file=>file.id===saved.id);
 assert.deepEqual([relisted.amountCents,relisted.note,relisted.category,relisted.paid,relisted.name],[1500,'Zoo','eintritt',true,'Beleg.pdf']);
 const partial=await(await patch({paidCents:600})).json();
 assert.deepEqual([partial.paidCents,partial.remainingCents,partial.paid],[600,900,false]);
 const persisted=(await(await call('/api/admin/invoices',{headers:{cookie}})).json()).files.find(file=>file.id===saved.id);
 assert.equal(persisted.remainingCents,900);
 for(const invalid of [{paidCents:-1},{paidCents:1501},{paidCents:0.5},{paidCents:'600'},{amountCents:500},{amountCents:null}]) assert.equal((await patch(invalid)).status,400);
 assert.equal((await(await patch({paidCents:1500})).json()).paid,true);
 assert.equal((await(await patch({paid:false})).json()).paidCents,0);
 assert.equal((await(await patch({amountCents:null,paid:false})).json()).amountCents,null);
 for(const invalid of [{amountCents:-1},{category:'party'},{paid:'yes'},{note:'x'.repeat(301)}])assert.equal((await patch(invalid)).status,400);
 assert.equal((await call('/api/admin/invoices/'+saved.id,{method:'PATCH',headers:{cookie},body:'{}'})).status,403);
 pdf.headers['x-file-amount-cents']='100';pdf.headers['x-file-category']='party';assert.equal((await call('/api/admin/invoices',pdf)).status,400);
});

test('invoice budget enforces admin, CSRF, validation, persistence and revision protection',async()=>{
 const {call}=setup(),cookie=await login(call,true),path='/api/admin/invoice-budget';
 assert.equal((await call(path)).status,401);
 const current=await(await call(path,{headers:{cookie}})).json();assert.equal(current.budgetCents,null);
 const options={method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({...current,budgetCents:500000,students:25})};
 assert.equal((await call(path,options)).status,403);options.headers['x-csrf-token']=current.csrf;
 const saved=await call(path,options);assert.equal(saved.status,200,await saved.clone().text());
 assert.equal((await call(path,options)).status,409);
 const next=await(await call(path,{headers:{cookie}})).json();assert.equal(next.budgetCents,500000);assert.equal(next.students,25);
 for(const invalid of [{budgetCents:-1},{budgetCents:0.1},{students:0},{students:1.5}]){
  options.body=JSON.stringify({...next,...invalid});assert.equal((await call(path,options)).status,400);
 }
 options.body=JSON.stringify({...next,budgetCents:0,students:null});assert.equal((await call(path,options)).status,200);
});

test('stored generic materials preview by signature and preserve download bytes', async () => {
 const {call}=setup(),cookie=await login(call),event=seed.events[0].id;
 for (const [name,bytes,type] of [
  ['photo.png',[137,80,78,71,13,10,26,10,1,2,3],'image/png'],
  ['photo.jpg',[255,216,255,224,1,2,3],'image/jpeg'],
  ['photo.gif',[...Buffer.from('GIF89a'),1,2],'image/gif'],
  ['photo.webp',[...Buffer.from('RIFF1234WEBP'),1,2],'image/webp'],
  ['file.pdf',[...Buffer.from('%PDF-1.7')],'application/pdf'],
  ['fake.png',[...Buffer.from('<html>unsafe</html>')],'application/octet-stream']
 ]) {
  const upload=await call('/api/materials?project='+event,{method:'PUT',headers:{cookie,'x-portal-password':btoa('portal-test'),'x-delete-password':btoa('owner'),'x-file-name':btoa(name)},body:new Uint8Array(bytes)});
  assert.equal(upload.status,201);
  const {file}=await upload.json(),path=`/api/files/${event}/${file.id}`;
  for(const download of [false,true]) {
   const response=await call(path+(download?'?download':''),{headers:{cookie}});
   assert.equal(response.headers.get('content-type'),type);
   assert.match(response.headers.get('content-disposition'),download||type==='application/octet-stream'?/^attachment/:/^inline/);
   assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(bytes));
  }
 }
});

test('authenticated static assets do not read or depend on WebDAV',async()=>{
 const {call,webdav}=setup(),cookie=await login(call);
 webdav.setFail(true);
 for(const path of ['/','/script.js','/styles.css','/shared/calendar-model.js']) {
  const response=await call(path,{headers:{cookie}});
  assert.equal(response.status,200,path);
  assert.equal(response.headers.get('x-portal-content'),'authenticated');
 }
 assert.equal(webdav.calls.length,0);
});
test('startup data shares a short snapshot cache and writes invalidate it',async()=>{
 const {call,webdav}=setup(),cookie=await login(call,true);
 const get=path=>call(path,{headers:{cookie}});
 const current=await (await get('/api/admin/calendar')).json();
 const reads=webdav.calls.length;
 await get('/api/admin/settings');
 assert.equal(webdav.calls.length,reads);
 current.calendar.events[0].title='Fresh after write';
 const response=await call('/api/admin/calendar',{method:'PUT',headers:{cookie,'x-csrf-token':current.csrf,'content-type':'application/json'},body:JSON.stringify(current)});
 assert.equal(response.status,200);
 assert.equal((await (await get('/api/admin/calendar')).json()).calendar.events[0].title,'Fresh after write');
});
test('trip settings preserve identity and events and reject removing occupied days',async()=>{
 const {call}=setup(),cookie=await login(call,true);
 const before=await(await call('/api/admin/calendar',{headers:{cookie}})).json();
 const settings=await(await call('/api/admin/settings',{headers:{cookie}})).json();
 const t=before.trip;
 const values={TRIP_TITLE:'Neue Reisebezeichnung',TRIP_START:t.startDate,TRIP_END:t.endDate,TRIP_ORIGIN:t.origin,TRIP_DESTINATION:t.destination,TRIP_TIMEZONE:t.timeZone||'Europe/Berlin',TRIP_PARTICIPANTS:'Anna\nBen\nAnna'};
 const put=(trip,revision)=>call('/api/admin/settings',{method:'PUT',headers:{cookie,'content-type':'application/json','x-csrf-token':settings.csrf},body:JSON.stringify({trip,mapProvider:'openstreetmap',revision})});
 const response=await put(values,settings.revision);assert.equal(response.status,200,await response.clone().text());
 const saved=await response.json();assert.equal(saved.trip.id,t.id);assert.deepEqual(saved.trip.participants,['Anna','Ben']);
 const after=await(await call('/api/admin/calendar',{headers:{cookie}})).json();assert.deepEqual(after.calendar.events,before.calendar.events);
 assert.equal((await put(values,settings.revision)).status,409);
 assert.equal((await put({...values,TRIP_START:'2030-01-01',TRIP_END:'2030-01-02'},saved.revision)).status,400);
});
test('trip settings change the day hours only when all events still fit',async()=>{
 const {call}=setup(),cookie=await login(call,true);
 const before=await(await call('/api/admin/calendar',{headers:{cookie}})).json();
 const settings=await(await call('/api/admin/settings',{headers:{cookie}})).json(),t=before.trip;
 assert.match(settings.dayHours.start,/^\d\d:\d\d$/);
 const values={TRIP_TITLE:t.title,TRIP_START:t.startDate,TRIP_END:t.endDate,TRIP_ORIGIN:t.origin,TRIP_DESTINATION:t.destination,TRIP_TIMEZONE:t.timeZone||'Europe/Berlin',TRIP_PARTICIPANTS:''};
 const put=(trip,revision)=>call('/api/admin/settings',{method:'PUT',headers:{cookie,'content-type':'application/json','x-csrf-token':settings.csrf},body:JSON.stringify({trip,mapProvider:'openstreetmap',revision})});
 if(before.calendar.events.length)assert.equal((await put({...values,TRIP_DAY_START:'21:00',TRIP_DAY_END:'23:00'},settings.revision)).status,400);
 assert.equal((await put({...values,TRIP_DAY_START:'10:00',TRIP_DAY_END:'11:00'},settings.revision)).status,400);
 const response=await put({...values,TRIP_DAY_START:'00:00',TRIP_DAY_END:'23:00'},settings.revision);assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual((await response.json()).dayHours,{start:'00:00',end:'23:00'});
 const after=await(await call('/api/admin/calendar',{headers:{cookie}})).json();
 assert.equal(after.calendar.timeSlots.length,23);assert.equal(after.calendar.events.length,before.calendar.events.length);
});
test('configuration is admin-only and never discloses existing passwords',async()=>{
 const {call}=setup();assert.equal((await call('/api/admin/configuration')).status,401);
 const cookie=await login(call,true),response=await call('/api/admin/configuration',{headers:{cookie}}),data=await response.json();
 assert.equal(data.domain,'portal.test');assert.equal(data.editable,false);
 assert.equal(data.values.PORTAL_PASSWORD,undefined);assert.equal(data.values.ADMIN_PASSWORD,undefined);assert.equal(data.values.NEXTCLOUD_APP_PASSWORD,undefined);
 assert.equal((await call('/api/admin/configuration',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:'{}'})).status,403);
});
test('public version probe reports the running Portal version without cloud reads or authentication',async()=>{
 const f=setup();f.env.PAC_VERSION='release-test';
 const response=await f.call('/api/version?check=unique');
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await response.json(),{version:'release-test'});
});

test('deadline ranges validate and preserve existing deadlines without a start',()=>{
 const calendar=CalendarModel.normalize(seed,trip);
 const deadline={title:'Abgabe',at:'2026-10-20T12:00:00Z',hideAt:'2026-10-20T12:00:00Z',warningMinutes:60};
 calendar.countdown={enabled:true,deadline};
 validateCalendar(calendar,seed,trip,journeys);
 deadline.startAt='2026-10-19T12:00:00Z';
 validateCalendar(calendar,seed,trip,journeys);
 for(const start of ['invalid',42,'2026-10-20T12:00:00Z','2026-10-21T12:00:00Z']) {
  deadline.startAt=start;
  assert.throws(()=>validateCalendar(calendar,seed,trip,journeys));
 }
});


function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function beforeRelease(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Read blocked behind a write')),1000);})]);}
 finally{clearTimeout(timer);}
}
test('slow streaming uploads do not block static assets, calendar reads or version probes',async()=>{
 const f=setup(),cookie=await login(f.call),admin=await login(f.call,true),event=seed.events[0].id;
 const started=deferred(),release=deferred(),put=f.webdav.cloud.putFile.bind(f.webdav.cloud);
 f.webdav.cloud.putFile=async(...args)=>{started.resolve();await release.promise;return put(...args);};
 const upload=f.call('/api/materials?project='+event,{method:'PUT',headers:{cookie,'x-portal-password':btoa('portal-test'),'x-delete-password':btoa('owner'),'x-file-name':btoa('slow.txt')},body:'streamed bytes'});
 await started.promise;
 try{
  const results=await beforeRelease(Promise.all([
   f.call('/script.js',{headers:{cookie}}),f.call('/data/calendar.json',{headers:{cookie}}),
   f.call('/api/admin/session',{headers:{cookie:admin}}),f.call('/api/version')
  ]));
  assert.deepEqual(results.map(response=>response.status),[200,200,200,200]);
 }finally{release.resolve();}
 assert.equal((await upload).status,201);
});
test('a read finishing after publication cannot put its stale snapshot back in the shared cache',async()=>{
 const f=setup(),admin=await login(f.call,true),cookie=await login(f.call);
 const current=await(await f.call('/api/admin/calendar',{headers:{cookie:admin}})).json();
 f.portal.invalidateSnapshot();
 const started=deferred(),release=deferred(),read=f.webdav.cloud.readText.bind(f.webdav.cloud);let first=true;
 f.webdav.cloud.readText=async key=>{
  const record=await read(key);
  if(key==='calendar:snapshot'&&first){first=false;started.resolve();await release.promise;}
  return record;
 };
 const oldRead=f.call('/data/calendar.json',{headers:{cookie}});await started.promise;
 current.calendar.events[0].title='Published during read';
 try{
  const saved=await beforeRelease(f.call('/api/admin/calendar',{method:'PUT',headers:{cookie:admin,'content-type':'application/json','x-csrf-token':current.csrf},body:JSON.stringify(current)}));
  assert.equal(saved.status,200);
 }finally{release.resolve();}
 assert.equal((await oldRead).status,200);
 const latest=await(await f.call('/data/calendar.json',{headers:{cookie}})).json();
 assert.equal(latest.events[0].title,'Published during read');
});
test('corrupt notes and budgets reject reads and writes without replacing their original bytes',async()=>{
 for(const raw of ['{broken','[]','null','{"text":12,"revision":"wrong","budgetCents":-1}']){
  const f=setup(),participant=await login(f.call),admin=await login(f.call,true),event=seed.events[0].id;
  const settings=await(await f.call('/api/admin/calendar',{headers:{cookie:admin}})).json();
  for(const [key,path,cookie,body] of [
   ['shared-note:'+event,'/api/shared-note?event='+event,participant,{event,text:'replacement',baseRevision:0,baseText:''}],
   ['invoices:budget','/api/admin/invoice-budget',admin,{budgetCents:1000,students:2}]
  ]){
   await f.webdav.cloud.writeText(key,raw,null);
   for(const options of [{},{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':settings.csrf},body:JSON.stringify(body)}]){
    const response=await f.call(path,{...options,headers:{cookie,...options.headers}});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'stored_data_corrupt');
    assert.equal((await f.webdav.cloud.readText(key)).value,raw);
   }
  }
 }
});
test('all-device revocation requires admin and CSRF, survives restart and preserves calendar feeds',async()=>{
 const f=setup(),participant=await login(f.call),admin=await login(f.call,true);
 const settings=await(await f.call('/api/admin/calendar',{headers:{cookie:admin}})).json();
 const feed=await(await f.call('/api/calendar-subscription',{headers:{cookie:participant}})).json();
 const path='/api/admin/sessions/revoke';
 assert.equal((await f.call(path,{method:'POST',headers:{cookie:participant}})).status,401);
 assert.equal((await f.call(path,{method:'POST',headers:{cookie:admin}})).status,403);
 assert.equal((await f.call(path,{method:'POST',headers:{cookie:admin,'x-csrf-token':settings.csrf}})).status,200);
 const fresh=new Portal(f.portal.state,f.env);
 for(const portal of [f.portal,fresh]){
  assert.equal((await portal.fetch(new Request('https://portal.test/api/calendar-subscription',{headers:{cookie:participant}}))).status,401);
  assert.equal((await portal.fetch(new Request('https://portal.test/api/admin/calendar',{headers:{cookie:admin}}))).status,401);
 }
 assert.equal((await f.call(feed.path)).status,200);
 const newCookie=await login(f.call);
 assert.match((await f.call('/data/trip.json',{headers:{cookie:newCookie}})).headers.get('set-cookie'),/Max-Age=1209600/);
});
test('changing Cloudflare-managed passwords invalidates their existing sessions',async()=>{
 const f=setup(),participant=await login(f.call),admin=await login(f.call,true);
 f.env.PORTAL_PASSWORD='new-participant-password';f.env.ADMIN_PASSWORD='new-admin-password';
 assert.equal((await f.call('/api/calendar-subscription',{headers:{cookie:participant}})).status,401);
 assert.equal((await f.call('/api/admin/calendar',{headers:{cookie:admin}})).status,401);
});
