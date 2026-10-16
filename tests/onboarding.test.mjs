import {test} from 'node:test';import assert from 'node:assert/strict';
import {Portal} from '../src/index.js';
import {runInNewContext} from 'node:vm';
import {validateSetup,setupScript,openConfiguration,validateTrip,initializeTrip} from '../src/onboarding.js';
import {mockWebdav} from './helpers/webdav.mjs';
const secret='a'.repeat(64),origin='https://portal.test';
const input={TRIP_MODE:'new',TRIP_TITLE:'Herbstreise',TRIP_START:'2027-10-17',TRIP_END:'2027-10-19',TRIP_ORIGIN:'Hamburg',TRIP_DESTINATION:'Bremen',TRIP_PARTICIPANTS:'Alex\nKim\nAlex',TRIP_TIMEZONE:'Europe/Berlin',PORTAL_PASSWORD:'participant-pass-123',confirmPortal:'participant-pass-123',ADMIN_PASSWORD:'admin-password-456',confirmAdmin:'admin-password-456',NEXTCLOUD_WEBDAV_URL:'https://cloud.test/remote.php/dav/files/test',NEXTCLOUD_USERNAME:'user',NEXTCLOUD_APP_PASSWORD:'app-password-private',NEXTCLOUD_ROOT:'PAC'};
function fixture(overrides={}){
 const rows=new Map(),state={storage:{get:async key=>structuredClone(rows.get(key)),put:async(key,value)=>rows.set(key,structuredClone(value)),delete:async key=>rows.delete(key)}};
 let probes=0;const env={cloudStorage:mockWebdav().cloud,PAC_SETUP_SECRET:secret,probeSetupStorage:async()=>{probes++;},...overrides};let portal=new Portal(state,env);
 return {rows,env,get probes(){return probes;},restart(){portal=new Portal(state,env);},call:(path,options={})=>portal.fetch(new Request(origin+path,options)),submit:(patch={},headers={})=>portal.fetch(new Request(origin+'/api/setup',{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+secret,...headers},body:JSON.stringify({...input,...patch})}))};
}
test('new PAC opens the setup form without requiring a portal password',async()=>{
 const f=fixture();const root=await f.call('/');assert.equal(root.status,303);assert.equal(root.headers.get('location'),'/setup');
 const page=await f.call('/setup');assert.equal(page.status,200);const html=await page.text();assert.match(html,/Einrichtung abschließen/);assert.match(html,/NEXTCLOUD_APP_PASSWORD/);assert.ok(!html.includes(secret));
 const script=await f.call('/setup.js');assert.equal(script.status,200);assert.match(await script.text(),/history.replaceState/);
});
test('setup requires the bootstrap token, same origin and valid different passwords',async()=>{
 const f=fixture();assert.equal((await f.submit({}, {authorization:'Bearer wrong'})).status,403);assert.equal((await f.submit({}, {origin:'https://other.test'})).status,403);
 for(const patch of [{ADMIN_PASSWORD:input.PORTAL_PASSWORD,confirmAdmin:input.PORTAL_PASSWORD},{confirmPortal:'wrong'},{NEXTCLOUD_WEBDAV_URL:'http://cloud.test/'},{NEXTCLOUD_ROOT:'../wrong'}])assert.equal((await f.submit(patch)).status,400);
 assert.equal(f.probes,0);assert.equal(f.rows.size,0);
});
test('configuration is encrypted, works after object restart and closes setup permanently',async()=>{
 const f=fixture();const response=await f.submit();assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/profilreise_session=.*HttpOnly; Secure/);assert.equal((await response.json()).ready,true);assert.equal(f.probes,1);
 const stored=f.rows.get('configuration:v1');assert.ok(!JSON.stringify(stored).includes(input.NEXTCLOUD_APP_PASSWORD));const config=await openConfiguration(stored,secret);assert.equal(config.NEXTCLOUD_ROOT,'PAC');assert.equal(config.SESSION_SECRET.length,64);assert.notEqual(config.SESSION_SECRET,config.CALENDAR_FEED_SECRET);
 await assert.rejects(()=>openConfiguration(stored,'wrong-key'));
 f.restart();const login=await f.call('/__login',{method:'POST',body:new URLSearchParams({password:input.PORTAL_PASSWORD})});assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/profilreise/);
 assert.equal((await f.submit()).status,409);assert.equal((await f.call('/setup')).status,303);assert.equal(f.probes,1);
});
test('failed cloud access does not save settings and allows a corrected submission',async()=>{
 let fail=true;const f=fixture({probeSetupStorage:async()=>{if(fail)throw new Error(input.NEXTCLOUD_APP_PASSWORD);}});
 const response=await f.submit();assert.equal(response.status,422);assert.ok(!(await response.text()).includes(input.NEXTCLOUD_APP_PASSWORD));assert.equal(f.rows.size,0);fail=false;assert.equal((await f.submit()).status,200);
});
test('unconfigured older deployments cannot be claimed without a bootstrap secret',async()=>{
 const f=fixture({PAC_SETUP_SECRET:undefined});assert.equal((await f.submit()).status,403);assert.equal(f.rows.size,0);
});

test('new trip creates exactly the requested days and no demonstration events',async()=>{
 const {cloud}=mockWebdav(),trip=validateTrip(input);const result=await initializeTrip({},trip,cloud);assert.equal(result.mode,'new');
 const saved=JSON.parse((await cloud.readText('calendar:snapshot')).value);assert.equal(saved.trip.title,'Herbstreise');assert.deepEqual(saved.trip.participants,['Alex','Kim']);assert.deepEqual(saved.calendar.days.map(d=>d.isoDate),['2027-10-17','2027-10-18','2027-10-19']);assert.deepEqual(saved.calendar.events,[]);assert.deepEqual(saved.materials,{});
});
test('existing trip is retained byte for byte and cannot be overwritten by new setup data',async()=>{
 const {cloud}=mockWebdav();await initializeTrip({},validateTrip(input),cloud);const before=await cloud.readText('calendar:snapshot');
 await assert.rejects(()=>initializeTrip({},validateTrip({...input,TRIP_TITLE:'Overwrite'}),cloud),/bereits eine Reise/);
 const result=await initializeTrip({},null,cloud);assert.equal(result.trip.title,'Herbstreise');assert.equal((await cloud.readText('calendar:snapshot')).value,before.value);
});
test('invalid dates and reversed periods are rejected; missing existing trip is explained',async()=>{
 for(const patch of [{TRIP_START:'2027-02-30'},{TRIP_END:'2027-10-16'},{TRIP_END:'2030-01-01'},{TRIP_TITLE:''}])assert.throws(()=>validateTrip({...input,...patch}));
 assert.equal(validateTrip({TRIP_MODE:'existing'}),null);await assert.rejects(()=>initializeTrip({},null,mockWebdav().cloud),/keine Reise gefunden/);
});
test('completed setup uses entered trip details on the login page and calendar',async()=>{
 const f=fixture();assert.equal((await f.submit()).status,200);f.restart();const page=await f.call('/');assert.match(await page.text(),/Herbstreise/);
 const login=await f.call('/__login',{method:'POST',body:new URLSearchParams({password:input.PORTAL_PASSWORD})});const cookie=login.headers.get('set-cookie').split(';')[0];const calendar=await (await f.call('/data/calendar.json',{headers:{cookie}})).json();assert.equal(calendar.days.length,3);assert.deepEqual(calendar.events,[]);
});

test('setup prefills the installer title as plain text and removes the link fragment',()=>{
 for(const title of ['Köln & München 2027','<img src=x onerror=alert(1)>','']){
  const elements={TRIP_START:{addEventListener(){}},TRIP_END:{addEventListener(){}},TRIP_MODE:{value:'new',addEventListener(){}},TRIP_TITLE:{value:''},TRIP_TIMEZONE:{value:''}};
  const button={},form={elements,querySelector:()=>button,querySelectorAll:()=>[],addEventListener(){}},fields={},message={};
  let cleaned;
  runInNewContext(setupScript,{document:{querySelector:selector=>({'form':form,'#message':message,'#trip-fields':fields}[selector])},URLSearchParams,Intl,location:{hash:'#'+new URLSearchParams({token:'test-token',title})},history:{replaceState:(_state,_unused,path)=>{cleaned=path;}}});
  assert.equal(elements.TRIP_TITLE.value,title);
  assert.equal(cleaned,'/setup');
  assert.notEqual(button.disabled,true);
 }
});

test('setup accepts six-character passwords and rejects shorter or matching passwords',()=>{
 const shorter={...input,PORTAL_PASSWORD:'reise1',confirmPortal:'reise1',ADMIN_PASSWORD:'admin1',confirmAdmin:'admin1'};
 assert.equal(validateSetup(shorter).PORTAL_PASSWORD,'reise1');
 assert.throws(()=>validateSetup({...shorter,PORTAL_PASSWORD:'kurz',confirmPortal:'kurz'}),/mindestens 6/);
 assert.throws(()=>validateSetup({...shorter,ADMIN_PASSWORD:'reise1',confirmAdmin:'reise1'}),/unterschiedliche/);
});
test('setup date range follows the start and passwords can be shown and hidden',()=>{
 const control=(value='')=>({value,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
 const start=control(),end=control(),password={type:'password',dataset:{label:'Portalpasswort'}},toggle={...control(),dataset:{password:'PORTAL_PASSWORD'},setAttribute(key,value){this[key]=value;}};
 const elements={TRIP_START:start,TRIP_END:end,TRIP_MODE:control('new'),TRIP_TITLE:control(),TRIP_TIMEZONE:control(),PORTAL_PASSWORD:password};
 const form={elements,querySelector:()=>({}),querySelectorAll:()=>[toggle],addEventListener(){}};
 runInNewContext(setupScript,{document:{querySelector:selector=>selector==='form'?form:{}},URLSearchParams,Intl,location:{hash:'#token=test'},history:{replaceState(){}}});
 start.value='2027-05-10';start.handlers.change();assert.equal(end.value,start.value);assert.equal(end.min,start.value);
 end.value='2027-05-15';start.handlers.change();assert.equal(end.value,'2027-05-15');
 start.value='2027-05-20';start.handlers.change();assert.equal(end.value,start.value);
 toggle.handlers.click();assert.equal(password.type,'text');assert.equal(toggle['aria-pressed'],'true');
 toggle.handlers.click();assert.equal(password.type,'password');assert.equal(toggle['aria-pressed'],'false');
});
