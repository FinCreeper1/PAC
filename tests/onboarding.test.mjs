import {test} from 'node:test';import assert from 'node:assert/strict';
import {Portal} from '../src/index.js';
import {openConfiguration} from '../src/onboarding.js';
const secret='a'.repeat(64),origin='https://portal.test';
const input={PORTAL_PASSWORD:'participant-pass-123',confirmPortal:'participant-pass-123',ADMIN_PASSWORD:'admin-password-456',confirmAdmin:'admin-password-456',NEXTCLOUD_WEBDAV_URL:'https://cloud.test/remote.php/dav/files/test',NEXTCLOUD_USERNAME:'user',NEXTCLOUD_APP_PASSWORD:'app-password-private',NEXTCLOUD_ROOT:'PAC'};
function fixture(overrides={}){
 const rows=new Map(),state={storage:{get:async key=>structuredClone(rows.get(key)),put:async(key,value)=>rows.set(key,structuredClone(value)),delete:async key=>rows.delete(key)}};
 let probes=0;const env={PAC_SETUP_SECRET:secret,probeSetupStorage:async()=>{probes++;},...overrides};let portal=new Portal(state,env);
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
