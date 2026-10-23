import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {beginLogin,exchangeCode} from '../src/oauth.js';
import {deployPac,api,pacName} from '../src/cloudflare.js';
import {InstallJob,InstallLimits} from '../src/jobs.js';
import {route} from '../src/router.js';
import {releaseInfo} from '../src/release.js';
import {releaseNotes} from '../scripts/release-notes.mjs';
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
 assert.equal(result.stage,'ready');assert.equal(f.storage.data.has('secret'),false);assert.equal(JSON.stringify(result).includes('private-token'),false);assert.match(result.dashboardUrl,/dash.cloudflare.com/);assert.match(result.setupUrl,/\/setup#token=[a-f0-9]{64}$/);
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
 let uploads=0;await assert.rejects(()=>deployPac({accountId,scriptName:'pac-123456abcdef',apiToken:'token',setupToken:'c'.repeat(64)},'payload',async(url,init)=>{if(init.body instanceof FormData)uploads++;return Response.json({success:true,result:url.endsWith('/workers/subdomain')?{subdomain:'test'}:{migration_tag:'v1'}});}),e=>e.status===409);assert.equal(uploads,0);
});
test('deployment uploads SQLite binding with unique name and no redirects',async()=>{
 const calls=[];const result=await deployPac({accountId,scriptName:'pac-123456abcdef',apiToken:'token',setupToken:'c'.repeat(64)},'payload',async(url,init)=>{new Request(url,init);calls.push({url,init});if(url.endsWith('/settings'))return Response.json({success:false},{status:404});return Response.json({success:true,result:url.endsWith('/workers/subdomain')?{subdomain:'test'}:{}});});
 assert.equal(result,'https://pac-123456abcdef.test.workers.dev');assert.ok(calls.every(c=>c.init.redirect==='manual'));const upload=calls.find(c=>c.init.body instanceof FormData);const meta=JSON.parse(await upload.init.body.get('metadata').text());assert.equal(meta.bindings.find(b=>b.name==='PAC_SETUP_SECRET').text,'c'.repeat(64));assert.equal(JSON.parse(await upload.init.body.get('metadata').text()).migrations.steps[0].new_sqlite_classes[0],'Portal');
});
test('API does not disclose upstream errors or follow redirects',async()=>{await assert.rejects(()=>api('/test',{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})}),e=>e.status===302);await assert.rejects(()=>api('/test',{fetcher:async()=>Response.json({success:false,errors:[{message:'private'}]},{status:403})}),e=>!e.message.includes('private'));});
test('per-client rate limits apply',async()=>{const limiter=new InstallLimits(state());for(let i=0;i<31;i++)assert.equal((await limiter.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({key:'hashed-ip'})}))).status,i<30?200:429);});

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

test('existing PAC listing is authorized per account and never deploys or discloses tokens',async()=>{
 const f=await authorized();let calls=[];
 f.env.requestApi=async(path,options)=>{calls.push(path);assert.equal(options.token,'private-token');return path.endsWith('/scripts')?[{id:'pac-123456abcdef',created_on:'2026-10-15'},{id:'other-worker'},{id:'pac-install'},{id:'pac-<unsafe>'}]:{subdomain:'owner'};};
 assert.equal((await f.call('pacs',{csrf:'wrong',accountId})).status,403);
 assert.equal((await f.call('pacs',{csrf:f.csrf,accountId:'b'.repeat(32)})).status,403);assert.equal(calls.length,0);
 const result=await f.call('pacs',{csrf:f.csrf,accountId});assert.equal(result.status,200);assert.equal(result.data.pacs.length,1);
 assert.equal(result.data.pacs[0].url,'https://pac-123456abcdef.owner.workers.dev');assert.ok(!JSON.stringify(result).includes('private-token'));
 assert.equal(f.storage.data.get('job').stage,'authorized');assert.equal(calls.length,2);
 f.env.requestApi=async()=>{throw {status:403,message:'private upstream'};};const failure=await f.call('pacs',{csrf:f.csrf,accountId});assert.equal(failure.status,403);assert.ok(!JSON.stringify(failure).includes('private upstream'));
});

test('trip names create safe readable addresses and reject reserved or empty names',()=>{
 assert.equal(pacName('Köln & München 2027'),'pac-koeln-muenchen-2027');
 assert.equal(pacName('  Berlin 2027  '),'pac-berlin-2027');
 assert.ok(pacName('a'.repeat(200)).length<=63);
 for(const title of ['', '---', 'install', 'a'.repeat(201)])assert.throws(()=>pacName(title));
});
test('named deployment checks collisions before starting and allows another name',async()=>{
 const f=await authorized();
 f.env.requestApi=async()=>({});
 assert.equal((await f.call('start',{csrf:f.csrf,accountId,tripName:'Berlin 2027'})).status,409);
 assert.equal(f.storage.data.get('job').stage,'authorized');
 f.env.requestApi=async()=>{throw {status:404};};
 assert.equal((await f.call('start',{csrf:f.csrf,accountId,tripName:'Berlin 2027'})).status,200);
 assert.equal(f.storage.data.get('job').scriptName,'pac-berlin-2027');
 f.env.deployPac=async secret=>'https://'+secret.scriptName+'.test.workers.dev';
 await f.job.alarm();
 const ready=(await f.call('status')).data;
 const params=new URLSearchParams(new URL(ready.setupUrl).hash.slice(1));
 assert.equal(params.get('title'),'Berlin 2027');
 assert.equal(params.get('token'),f.storage.data.get('job').setupToken);
});

test('switching account forgets tokens, account grants and pending login before a fresh session',async()=>{
 const f=await authorized();assert.ok(f.storage.data.has('secret'));
 assert.equal((await f.call('forget',{csrf:'wrong'})).status,403);assert.ok(f.storage.data.has('secret'));
 assert.equal((await f.call('forget',{csrf:f.csrf})).status,200);
 assert.equal(f.storage.data.has('secret'),false);assert.equal(f.storage.data.has('job'),false);assert.equal(f.storage.data.has('login'),false);
 const next=(await f.call('session')).data;assert.notEqual(next.csrf,f.csrf);
 assert.equal((await f.call('status')).data.stage,'idle');
 assert.equal((await f.call('pacs',{csrf:next.csrf,accountId})).status,403);
});

test('proxy-forwarded client IP is trusted only with the proxy secret',async()=>{
 const seen=[],env={PROXY_SECRET:'proxy-secret',JOBS:{idFromName:x=>x,get:()=>({fetch:async request=>{seen.push((await request.json()).rateKey);return Response.json({});}})}};
 const cookie='__Secure-pac-install-path='+'a'.repeat(64),key=ip=>createHash('sha256').update('pac-installer:'+ip).digest('hex');
 const send=headers=>route(new Request('https://worker.test/install/api/forget',{method:'POST',headers:{cookie,origin:'https://profilfahrt.linusfin.de','content-type':'application/json','cf-connecting-ip':'198.51.100.1',...headers},body:'{}'}),env);
 await send({'x-pac-proxy-secret':'proxy-secret','x-pac-client-ip':'203.0.113.7'});
 await send({'x-pac-proxy-secret':'wrong','x-pac-client-ip':'203.0.113.7'});
 await send({'x-pac-client-ip':'203.0.113.7'});
 assert.deepEqual(seen,[key('203.0.113.7'),key('198.51.100.1'),key('198.51.100.1')]);
});
test('global login limit allows 300 attempts across IPs and resets in the next hour',async()=>{
 const storage=state(),limiter=new InstallLimits(storage);
 const attempt=key=>limiter.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({key})}));
 for(let i=0;i<300;i++)assert.equal((await attempt('ip-'+i)).status,200);
 assert.equal((await attempt('another-ip')).status,429);
 storage.data.set('global',{window:Math.floor(Date.now()/3600000)-1,count:300});
 assert.equal((await attempt('another-ip')).status,200);
});

test('prefixed installer isolates cookies, uses the public OAuth callback and checks its origin',async()=>{
 const f=fixture(),upstream='https://pac-install.linusleupold.workers.dev/install';
 const session=await route(new Request(upstream+'/api/session'),f.env);
 const cookie=session.headers.get('set-cookie');
 assert.match(cookie,/^__Secure-pac-install-path=/);assert.match(cookie,/Path=\/install; Secure; HttpOnly; SameSite=Lax/);
 const {csrf}=await session.json();
 const login=await route(new Request(upstream+'/api/login',{method:'POST',headers:{cookie,origin:'https://profilfahrt.linusfin.de','content-type':'application/json'},body:JSON.stringify({csrf})}),f.env);
 assert.equal(login.status,200);
 assert.equal(new URL((await login.json()).url).searchParams.get('redirect_uri'),'https://profilfahrt.linusfin.de/install/oauth/callback');
 const bad=await route(new Request(upstream+'/api/login',{method:'POST',headers:{cookie,origin:'https://evil.test','content-type':'application/json'},body:JSON.stringify({csrf})}),f.env);assert.equal(bad.status,403);
 const callback=await route(new Request(upstream+'/oauth/callback?error=access_denied',{headers:{cookie}}),f.env);
 assert.equal(callback.headers.get('location'),'/install/app?login=invalid');
});
test('prefixed assets keep requests inside install while original assets stay unchanged',async()=>{
 const env={ASSETS:{fetch:async request=>{assert.equal(new URL(request.url).pathname,'/');return new Response('<link href="/style.css"><script src="/app.js"></script>',{headers:{'content-type':'text/html'}});}}};
 const prefixed=await route(new Request('https://worker.test/install/'),env);assert.match(await prefixed.text(),/href="\/install\/style.css"/);
 const original=await route(new Request('https://worker.test/'),env);assert.match(await original.text(),/href="\/style.css"/);
 const redirect=await route(new Request('https://worker.test/install'),env);assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/install/');
});
test('asset canonical redirects remain inside the installer prefix',async()=>{
 const env={ASSETS:{fetch:async()=>new Response(null,{status:307,headers:{location:'/setup'}})}};
 const response=await route(new Request('https://worker.test/install/setup.html'),env);
 assert.equal(response.headers.get('location'),'/install/setup');
});
test('session cookie slides with activity and is renewed after the OAuth callback',async()=>{
 const f=fixture(),base='https://pac-install.test';
 const cookie=(await route(new Request(base+'/api/session'),f.env)).headers.get('set-cookie').split(';')[0];
 const status=await route(new Request(base+'/api/status',{headers:{cookie}}),f.env);
 assert.match(status.headers.get('set-cookie'),/Max-Age=3600/);
 const {csrf}=await (await route(new Request(base+'/api/session',{headers:{cookie}}),f.env)).json();
 const login=await route(new Request(base+'/api/login',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf})}),f.env);
 const state=new URL((await login.json()).url).searchParams.get('state');
 const callback=await route(new Request(base+'/oauth/callback?'+new URLSearchParams({state,code:'c'}),{headers:{cookie}}),f.env);
 assert.equal(callback.headers.get('location'),'/app');assert.equal(callback.headers.get('set-cookie').split(';')[0],cookie);
});
test('favicon is served from the logo and the guide page needs no inline styles',async()=>{
 const {readFile}=await import('node:fs/promises');
 const env={ASSETS:{fetch:async request=>{assert.equal(new URL(request.url).pathname,'/logo.png');return new Response('png',{headers:{'content-type':'image/png'}});}}};
 assert.equal((await route(new Request('https://worker.test/favicon.ico'),env)).status,200);
 for(const page of ['index.html','app.html','setup.html','datenschutz.html'])assert.doesNotMatch(await readFile(new URL('../public/'+page,import.meta.url),'utf8'),/<style|style="/);
});
test('old installer links on / are forwarded to /app with their query',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('home',{headers:{'content-type':'text/html'}})}};
 const update=await route(new Request('https://worker.test/?update=pac-test4'),env);
 assert.equal(update.status,302);assert.equal(update.headers.get('location'),'/app?update=pac-test4');
 const prefixed=await route(new Request('https://worker.test/install/?login=invalid'),env);
 assert.equal(prefixed.headers.get('location'),'/install/app?login=invalid');
 assert.equal((await route(new Request('https://worker.test/'),env)).status,200);
});
test('update keeps existing bindings, refuses non-PAC workers and keeps the login for the overview',async()=>{
 const {updatePac}=await import('../src/cloudflare.js');
 const calls=[],settings={compatibility_date:'2026-09-10',bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'},{type:'secret_text',name:'PAC_SETUP_SECRET'}]};
 const fetcher=async(url,init)=>{calls.push([init.method,url,init.body]);if(url.endsWith('/subdomain'))return Response.json({success:true,result:{subdomain:'demo'}});if(init.method==='PUT')return Response.json({success:true,result:{version_id:'v2'}});return Response.json({success:true,result:settings});};
 const result=await updatePac({apiToken:'t',accountId,scriptName:'pac-test4'},'payload',fetcher);
 assert.deepEqual(result,{url:'https://pac-test4.demo.workers.dev',versionId:'v2'});
 const metadata=JSON.parse(await calls.find(c=>c[0]==='PUT')[2].get('metadata').text());
 assert.deepEqual(metadata.bindings,[]);assert.deepEqual(metadata.keep_bindings.sort(),['durable_object_namespace','secret_text']);assert.equal(metadata.migrations,undefined);
 settings.bindings=[{type:'secret_text',name:'OTHER'}];calls.length=0;
 await assert.rejects(()=>updatePac({apiToken:'t',accountId,scriptName:'pac-other'},'payload',fetcher),e=>e.stage==='not-pac');
 assert.equal(calls.some(c=>c[0]==='PUT'),false);
 const f=await authorized();f.env.PAC_VERSION='abc123';f.env.updatePac=async secret=>{assert.equal(secret.scriptName,'pac-test4');return {url:'https://pac-test4.demo.workers.dev'};};
 assert.equal((await f.call('update',{csrf:f.csrf,accountId,scriptName:'Bad Name'})).status,400);
 assert.equal((await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-test4'})).data.stage,'updating');
 await f.job.alarm();
 assert.equal((await f.call('status')).data.stage,'activating');
 f.env.activationFetch=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');return Response.json({version:'abc123'});};
 await f.job.alarm();
 const status=(await f.call('status')).data;
 assert.equal(status.stage,'updated');assert.equal(status.version,'abc123');assert.equal(JSON.stringify(status).includes('private-token'),false);
 assert.equal((await f.call('overview',{csrf:'wrong'})).status,403);
 const back=(await f.call('overview',{csrf:f.csrf})).data;assert.equal(back.stage,'authorized');assert.equal(back.accounts[0].id,accountId);
 assert.equal((await f.call('forget',{csrf:f.csrf})).status,200);assert.equal(f.storage.data.has('secret'),false);
});
test('version endpoint is public, read-only and CORS-enabled',async()=>{
 const response=await route(new Request('https://install.test/api/version'),{PAC_VERSION:'v1.0.5',PAC_NOTES:'- Neu',githubFetch:async()=>new Response('{}',{status:404})});
 assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.deepEqual(await response.json(),{version:'v1.0.5',notes:'- Neu',releaseUrl:null});
 assert.equal((await route(new Request('https://install.test/api/version',{method:'POST'}),{})).status,405);
});
test('release notes prefer the GitHub release of the bundled version and fall back to the changelog',async()=>{
 const calls=[];
 const env={PAC_VERSION:'v1.0.5',PAC_NOTES:'- Eingebaut',githubFetch:async url=>{calls.push(url);return Response.json({body:'- Von GitHub',html_url:'https://github.com/FinCreeper1/PAC/releases/tag/v1.0.5'});}};
 assert.deepEqual(await releaseInfo(env),{version:'v1.0.5',notes:'- Von GitHub',releaseUrl:'https://github.com/FinCreeper1/PAC/releases/tag/v1.0.5'});
 assert.equal(calls[0],'https://api.github.com/repos/FinCreeper1/PAC/releases/tags/v1.0.5');
 env.githubFetch=async()=>Response.json({body:'x',html_url:'https://evil.test/'});assert.equal((await releaseInfo(env)).releaseUrl,null);
 env.githubFetch=async()=>{throw new Error('offline');};assert.equal((await releaseInfo(env)).notes,'- Eingebaut');
 env.githubFetch=async()=>Response.json({draft:true,body:'geheim'});assert.equal((await releaseInfo(env)).notes,'- Eingebaut');
});
test('changelog sections are extracted per version',()=>{
 const log='# PAC\n\n## v1.0.6\n\n- Neuer\n\n## v1.0.5\n\n- Alt\n- Zwei\n';
 assert.equal(releaseNotes(log,'v1.0.5'),'- Alt\n- Zwei');assert.equal(releaseNotes(log,'v1.0.6'),'- Neuer');assert.equal(releaseNotes(log,'v1.0'),'');
});
test('activation retries old versions and outages without uploading again, survives restart and times out honestly',async()=>{
 const f=await authorized();let uploads=0;
 f.env.PAC_VERSION='new';f.env.updatePac=async()=>{uploads++;return {url:'https://pac-test4.demo.workers.dev'};};
 await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-test4'});await f.job.alarm();
 for(const probe of [async()=>Response.json({version:'old'}),async()=>{throw new Error('offline');},async()=>new Response('login page')]){
  f.env.activationFetch=probe;
  await new InstallJob(f.storage,f.env).alarm();
  assert.equal((await f.call('status')).data.stage,'activating');
  assert.ok(f.storage.data.get('_alarm')>Date.now());
 }
 assert.equal((await f.call('forget',{csrf:f.csrf})).status,409);
 await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-test4'});assert.equal(uploads,1);
 const job=f.storage.data.get('job');job.activationDeadline=Date.now()-1;f.storage.data.set('job',job);
 await f.job.alarm();const status=(await f.call('status')).data;
 assert.equal(status.stage,'failed');assert.match(status.error,/hochgeladen/);assert.equal(uploads,1);
});
test('status polling recovers activation if an alarm was missed and exposes probe failures',async()=>{
 const f=await authorized();f.env.PAC_VERSION='current';
 f.env.updatePac=async()=>({url:'https://pac-test4.demo.workers.dev'});
 await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-test4'});await f.job.alarm();
 f.env.activationFetch=async()=>new Response('error code: 1042',{status:404});
 let status=(await f.call('status')).data;
 assert.equal(status.stage,'activating');assert.equal(status.activationIssue,'http-404');assert.equal(status.activationChecks,1);
 const job=f.storage.data.get('job');job.activationCheckedAt=Date.now()-11000;f.storage.data.set('job',job);
 f.env.activationFetch=async()=>Response.json({version:'current'});
 status=(await f.call('status')).data;assert.equal(status.stage,'updated');
});
test('update overview offers the versioned build to manually deployed PACs without a version',async()=>{
 const f=await authorized();f.env.PAC_VERSION='new-version';
 f.env.requestApi=async path=>path.endsWith('/scripts')?[{id:'pac-a'},{id:'pac-b'}]:{subdomain:'owner'};
 f.env.activationFetch=async url=>Response.json({version:url.hostname.startsWith('pac-a.')?null:'source'});
 const overview=(await f.call('pacs',{csrf:f.csrf,accountId})).data;
 for(const pac of overview.pacs){assert.equal(pac.version,null);assert.equal(pac.updateAvailable,true);}
});
test('production installer permits public cross-Worker activation requests',async()=>{
 const {readFile}=await import('node:fs/promises');
 const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.ok(config.compatibility_flags.includes('global_fetch_strictly_public'));
});

test('update overview returns installed and target versions and retains them during update',async()=>{
 const f=await authorized();f.env.PAC_VERSION='new-version';f.env.PAC_NOTES='- Neu';f.env.githubFetch=async()=>new Response('{}',{status:404});
 f.env.requestApi=async path=>path.endsWith('/scripts')?[{id:'pac-example'}]:{subdomain:'owner'};
 f.env.activationFetch=async()=>Response.json({version:'old-version'});
 const overview=(await f.call('pacs',{csrf:f.csrf,accountId})).data;
 assert.equal(overview.latestVersion,'new-version');assert.equal(overview.latestNotes,'- Neu');assert.equal(overview.pacs[0].version,'old-version');assert.equal(overview.pacs[0].updateAvailable,true);
 const update=(await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-example'})).data;
 assert.equal(update.previousVersion,'old-version');assert.equal(update.targetVersion,'new-version');
 const status=(await f.call('status')).data;assert.equal(status.previousVersion,'old-version');assert.equal(status.targetVersion,'new-version');
});


test('activation accepts a newer stable release for a running older update without another upload',async()=>{
 const {confirmsVersion}=await import('../src/jobs.js');
 for(const [actual,expected,result] of [['v1.1.3','v1.1.2',true],['v1.10.0','v1.9.9',true],['v2.0.0','v1.99.9',true],['v1.1.1','v1.1.2',false],['v1.1.3-beta','v1.1.2',false],['source','v1.1.2',false],['abc','abc',true],['def','abc',false],[null,'v1.1.2',false]])assert.equal(confirmsVersion(actual,expected),result);
 const f=await authorized();let uploads=0;
 f.env.PAC_VERSION='v1.1.2';f.env.updatePac=async()=>{uploads++;return {url:'https://pac-test4.demo.workers.dev'};};
 await f.call('update',{csrf:f.csrf,accountId,scriptName:'pac-test4'});await f.job.alarm();
 f.env.PAC_VERSION='v1.1.3';
 f.env.activationFetch=async()=>Response.json({version:'v1.1.3'});
 await new InstallJob(f.storage,f.env).alarm();
 const status=(await f.call('status')).data;
 assert.equal(status.stage,'updated');assert.equal(status.version,'v1.1.3');assert.equal(status.targetVersion,'v1.1.2');assert.equal(uploads,1);
});

test('PAC deletion validates the target and binding and never forces referenced workers',async()=>{
 const {deletePac}=await import('../src/cloudflare.js');const calls=[];
 const requestApi=async(path,options)=>{calls.push({path,...options});return {bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'}]};};
 for(const name of ['pac-install','other-worker','pac-a/../x','pac-'+ 'a'.repeat(60)])await assert.rejects(()=>deletePac(accountId,name,'token',requestApi));
 assert.equal(calls.length,0);
 await deletePac(accountId,'pac-berlin','token',requestApi);
 assert.equal(calls.length,2);assert.equal(calls[1].method,'DELETE');assert.equal(calls[1].path,'/accounts/'+accountId+'/workers/scripts/pac-berlin');
 calls.length=0;
 await assert.rejects(()=>deletePac(accountId,'pac-other','token',async(path,options)=>{calls.push(options);return {bindings:[]};}),e=>e.stage==='not-pac');assert.equal(calls.length,1);
 assert.equal(await api('/test',{method:'DELETE',fetcher:async()=>new Response(null,{status:204})}),null);
 assert.equal(await api('/test',{method:'DELETE',fetcher:async()=>new Response(null,{status:200})}),null);
 await assert.rejects(()=>api('/test',{method:'DELETE',fetcher:async()=>new Response(null,{status:403})}),e=>e.status===403);
});

test('deletion needs a fresh account-bound single-use confirmation and exact name',async()=>{
 const f=await authorized(),target={csrf:f.csrf,accountId,scriptName:'pac-berlin',confirmName:'pac-berlin'};let deletes=0;
 f.env.requestApi=async(path,options)=>{assert.equal(options.token,'private-token');if(options.method==='DELETE')deletes++;return {bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'}]};};
 for(const [change,status] of [[{csrf:'bad'},403],[{accountId:'b'.repeat(32)},403],[{scriptName:'pac-install',confirmName:'pac-install'},400],[{confirmName:'PAC-berlin'},400],[{confirmName:'pac-berlin '},400]])assert.equal((await f.call('delete-prepare',{...target,...change})).status,status);
 assert.equal((await f.call('delete',target)).status,403);assert.equal(deletes,0);
 let token=(await f.call('delete-prepare',target)).data.confirmationToken;
 assert.equal((await f.call('delete',{...target,confirmationToken:'wrong'})).status,403);
 assert.equal((await f.call('delete',{...target,scriptName:'pac-hamburg',confirmName:'pac-hamburg',confirmationToken:token})).status,403);
 f.storage.data.get('deletion').expiresAt=0;
 assert.equal((await f.call('delete',{...target,confirmationToken:token})).status,403);
 token=(await f.call('delete-prepare',target)).data.confirmationToken;
 const result=await f.call('delete',{...target,confirmationToken:token});assert.equal(result.status,200);assert.deepEqual(result.data,{deleted:true,scriptName:'pac-berlin'});assert.equal(deletes,1);
 assert.equal((await f.call('delete',{...target,confirmationToken:token})).status,403);assert.equal(deletes,1);
 assert.equal(f.storage.data.get('job').stage,'authorized');assert.ok(f.storage.data.has('secret'));assert.ok(!JSON.stringify(result).includes('private-token'));
 f.storage.data.get('secret').expiresAt=0;assert.equal((await f.call('delete-prepare',target)).status,410);
});

test('failed deletion consumes confirmation, hides upstream details and never reports success',async()=>{
 for(const mode of ['not-pac','forbidden','ambiguous']){
  const f=await authorized(),target={csrf:f.csrf,accountId,scriptName:'pac-berlin',confirmName:'pac-berlin'};let deletes=0;
  f.env.requestApi=async(path,options)=>{
   if(options.method==='DELETE'){deletes++;throw {status:mode==='forbidden'?403:502,message:'private-token'};}
   return {bindings:mode==='not-pac'?[]:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'}]};
  };
  const confirmationToken=(await f.call('delete-prepare',target)).data.confirmationToken;
  const result=await f.call('delete',{...target,confirmationToken});assert.equal(result.status,mode==='not-pac'?409:mode==='forbidden'?403:502);assert.ok(!result.data.deleted);assert.ok(!JSON.stringify(result).includes('private-token'));
  assert.equal((await f.call('delete',{...target,confirmationToken})).status,403);assert.equal(deletes,mode==='not-pac'?0:1);
 }
});

test('delete routes require same-origin POST and a valid session on both installer addresses',async()=>{
 for(const prefix of ['', '/install']){
  const f=fixture(),origin=prefix?'https://profilfahrt.linusfin.de':'https://install.test',base='https://install.test'+prefix;
  const cookie=(await route(new Request(base+'/api/session'),f.env)).headers.get('set-cookie').split(';')[0];
  for(const path of ['delete-prepare','delete']){
   assert.equal((await route(new Request(base+'/api/'+path,{headers:{cookie}}),f.env)).status,405);
   assert.equal((await route(new Request(base+'/api/'+path,{method:'POST',headers:{cookie,origin:'https://evil.test','content-type':'application/json'},body:'{}'}),f.env)).status,403);
   assert.equal((await route(new Request(base+'/api/'+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'}),f.env)).status,403);
  }
 }
});
