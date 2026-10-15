import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {beginLogin,exchangeCode} from '../src/oauth.js';
import {deployPac,api} from '../src/cloudflare.js';
import {InstallJob,InstallLimits} from '../src/jobs.js';
import {route} from '../src/router.js';
function state(){const data=new Map();return {data,storage:{get:async key=>structuredClone(data.get(key)),put:async(key,value)=>{if(typeof key==='string')data.set(key,structuredClone(value));else for(const [k,v]of Object.entries(key))data.set(k,structuredClone(v));},delete:async key=>{for(const k of Array.isArray(key)?key:[key])data.delete(k);},deleteAll:async()=>data.clear(),setAlarm:async at=>{data.set('_alarm',at);},deleteAlarm:async()=>data.delete('_alarm'),list:async(options={})=>new Map([...data].filter(([key])=>key.startsWith(options.prefix||'')&&key!=='_alarm').sort(([a],[b])=>a.localeCompare(b)))},blockConcurrencyWhile:fn=>fn()};}
const accountId='a'.repeat(32);
function fixture(){
 const storage=state(),env={OAUTH_CLIENT_ID:'client',PAC_PAYLOAD:'payload',LIMITS:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({allowed:true})})},exchangeCode:async()=>({apiToken:'private-token',expiresAt:Date.now()+3600000}),requestApi:async()=>[{id:accountId,name:'My account'}],deployPac:async(secret)=>{assert.equal(secret.apiToken,'private-token');assert.match(secret.scriptName,/^pac-[a-f0-9]{12}$/);return 'https://'+secret.scriptName+'.test.workers.dev';}};
 const job=new InstallJob(storage,env);env.JOBS={idFromName:x=>x,get:()=>({fetch:req=>job.fetch(req)})};
 const call=async(path,body)=>{const response=await job.fetch(new Request('https://internal/'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}));return {status:response.status,data:await response.json()};};
 return {storage,env,job,call};
}
async function authorized(){const f=fixture();f.csrf=(await f.call('session')).data.csrf;await f.call('login',{csrf:f.csrf,redirectUri:'https://install.test/oauth/callback'});f.login=f.storage.data.get('login');await f.call('callback',{state:f.login.state,code:'code'});return f;}
test('PKCE uses a fresh verifier and state, with fixed Cloudflare endpoint',()=>{
 const login=beginLogin('client','https://install.test/oauth/callback'),url=new URL(login.url);
 assert.equal(url.origin,'https://dash.cloudflare.com');assert.equal(url.searchParams.get('scope'),'account-settings.read workers-scripts.admin');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(login.verifier).digest('base64url'));assert.notEqual(beginLogin('client','https://install.test/oauth/callback').state,login.state);
});
test('token exchange keeps verifier server-side and refuses invalid token responses',async()=>{
 const login=beginLogin('client','https://install.test/oauth/callback');
 const result=await exchangeCode('client',login,'code',async(url,init)=>{assert.equal(init.redirect,'manual');assert.equal(init.body.get('code_verifier'),login.verifier);return Response.json({access_token:'private',token_type:'Bearer',expires_in:300});});assert.equal(result.apiToken,'private');
 await assert.rejects(()=>exchangeCode('client',login,'code',async()=>Response.json({error:'private-detail'},{status:400})));
});
test('login requires configuration and CSRF',async()=>{
 const f=fixture(),{csrf}= (await f.call('session')).data;
 assert.equal((await f.call('login',{csrf:'wrong'})).status,403);delete f.env.OAUTH_CLIENT_ID;
 assert.equal((await f.call('login',{csrf,redirectUri:'https://install.test/oauth/callback'})).status,503);
});
test('callback state is bound to session and consumed once',async()=>{
 const f=fixture(),{csrf}=(await f.call('session')).data;await f.call('login',{csrf,redirectUri:'https://install.test/oauth/callback'});
 assert.equal((await f.call('callback',{state:'wrong',code:'code'})).status,403);
 const login=f.storage.data.get('login');assert.equal((await f.call('callback',{state:login.state,code:'code'})).status,200);
 assert.equal((await f.call('callback',{state:login.state,code:'code'})).status,403);
});
test('authorization never deploys until a valid account is explicitly selected',async()=>{
 const f=await authorized();assert.equal(f.storage.data.get('job').stage,'authorized');
 assert.equal((await f.call('start',{csrf:f.csrf,accountId:'b'.repeat(32)})).status,403);
 await f.call('start',{csrf:f.csrf,accountId});await f.job.alarm();const result=(await f.call('status')).data;
 assert.equal(result.stage,'ready');assert.equal(f.storage.data.has('secret'),false);assert.equal(JSON.stringify(result).includes('private-token'),false);assert.match(result.dashboardUrl,/dash.cloudflare.com/);
});
test('expiry and deployment failure delete credentials',async()=>{
 const f=await authorized();await f.call('start',{csrf:f.csrf,accountId});f.env.deployPac=async()=>{throw new Error('private-token');};await f.job.alarm();
 assert.equal(f.storage.data.has('secret'),false);assert.equal((await f.call('status')).data.stage,'failed');assert.equal(JSON.stringify((await f.call('status')).data).includes('private-token'),false);
 f.storage.data.set('job',{version:2,expiresAt:0});await f.job.alarm();assert.equal(f.storage.data.size,0);
});
test('old provisioning sessions are discarded rather than resumed',async()=>{const f=fixture();f.storage.data.set('job',{stage:'provision',expiresAt:Date.now()+60000});f.storage.data.set('secret','old');await f.call('session');assert.equal(f.storage.data.has('secret'),false);assert.equal(f.storage.data.get('job').stage,'idle');});
test('router requires same-origin POSTs and sets callback-compatible secure cookies',async()=>{
 const f=fixture();const session=await route(new Request('https://install.test/api/session'),f.env);assert.match(session.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Lax/);
 const bad=await route(new Request('https://install.test/api/start',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),f.env);assert.equal(bad.status,403);
});
test('deployment refuses an existing worker before uploading',async()=>{
 let uploads=0;await assert.rejects(()=>deployPac({accountId,scriptName:'pac-123456abcdef',apiToken:'token'},'payload',async(url,init)=>{if(init.body instanceof FormData)uploads++;return Response.json({success:true,result:url.endsWith('/workers/subdomain')?{subdomain:'test'}:{migration_tag:'v1'}});}),e=>e.status===409);assert.equal(uploads,0);
});
test('deployment uploads SQLite binding with unique name and no redirects',async()=>{
 const calls=[];const result=await deployPac({accountId,scriptName:'pac-123456abcdef',apiToken:'token'},'payload',async(url,init)=>{new Request(url,init);calls.push({url,init});if(url.endsWith('/settings'))return Response.json({success:false},{status:404});return Response.json({success:true,result:url.endsWith('/workers/subdomain')?{subdomain:'test'}:{}});});
 assert.equal(result,'https://pac-123456abcdef.test.workers.dev');assert.ok(calls.every(c=>c.init.redirect==='manual'));const upload=calls.find(c=>c.init.body instanceof FormData);assert.equal(JSON.parse(await upload.init.body.get('metadata').text()).migrations.steps[0].new_sqlite_classes[0],'Portal');
});
test('API does not disclose upstream errors or follow redirects',async()=>{await assert.rejects(()=>api('/test',{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})}),e=>e.status===302);await assert.rejects(()=>api('/test',{fetcher:async()=>Response.json({success:false,errors:[{message:'private'}]},{status:403})}),e=>!e.message.includes('private'));});
test('per-client rate limits apply',async()=>{const limiter=new InstallLimits(state());for(let i=0;i<4;i++)assert.equal((await limiter.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({key:'hashed-ip'})}))).status,i<3?200:429);});

test('denied authorization and missing accounts produce recoverable failures without credentials',async()=>{
 for(const mode of ['denied','empty','forbidden']){
  const f=fixture(),{csrf}=(await f.call('session')).data;await f.call('login',{csrf,redirectUri:'https://install.test/oauth/callback'});
  if(mode==='empty')f.env.requestApi=async()=>[];
  if(mode==='forbidden')f.env.requestApi=async()=>{const e=new Error('private-response');e.status=403;throw e;};
  await f.call('callback',{state:f.storage.data.get('login').state,...(mode==='denied'?{error:'access_denied'}:{code:'code'})});
  const result=(await f.call('status')).data;assert.equal(result.stage,'failed');assert.ok(!JSON.stringify(result).includes('private-response'));assert.equal(f.storage.data.has('secret'),false);
  assert.match(result.error,mode==='empty'?/kein zugängliches/:mode==='forbidden'?/Workers → Admin/:/nicht abgeschlossen/);
  assert.equal((await f.call('forget',{csrf})).status,200);
 }
});
test('expired authorization offers a new start and removes PKCE verifier',async()=>{
 const f=fixture(),{csrf}=(await f.call('session')).data;await f.call('login',{csrf,redirectUri:'https://install.test/oauth/callback'});
 f.storage.data.get('login').expiresAt=Date.now()-1;
 assert.equal((await f.call('status')).data.stage,'failed');assert.equal(f.storage.data.has('login'),false);
});
test('failed deployment retains only safe recovery details and never repeats upload',async()=>{
 const f=await authorized();let attempts=0;f.env.deployPac=async()=>{attempts++;throw new Error('private-token');};await f.call('start',{csrf:f.csrf,accountId});await f.job.alarm();await f.job.alarm();
 const result=(await f.call('status')).data;assert.equal(attempts,1);assert.match(result.scriptName,/^pac-[a-f0-9]{12}$/);assert.equal(new URL(result.dashboardUrl).origin,'https://dash.cloudflare.com');assert.ok(!JSON.stringify(result).includes('private-token'));assert.equal(f.storage.data.has('secret'),false);
});

test('subdomain permission rejection identifies exact safe stage and code without upstream secrets',async()=>{
 const f=await authorized();await f.call('start',{csrf:f.csrf,accountId});f.env.deployPac=async()=>{const e=new Error('private-token and upstream body');e.stage='subdomain';e.status=403;e.code=10000;throw e;};await f.job.alarm();
 const result=(await f.call('status')).data;assert.deepEqual(result.diagnostic,{stage:'subdomain',status:403,code:10000});assert.match(result.error,/Workers Scripts Read/);assert.ok(!JSON.stringify(result).includes('private-token'));assert.equal(f.storage.data.has('secret'),false);
});
