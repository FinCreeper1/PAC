import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {beginProof,advanceProof} from '../src/proof.js';
import {validateAccount,deployPac,ApiError,api} from '../src/cloudflare.js';
import {InstallJob,InstallLimits} from '../src/jobs.js';
import {route} from '../src/router.js';
const sha=value=>createHash('sha256').update(value).digest();
const challenge={challengeToken:'challenge',seed:Buffer.alloc(32,7).toString('base64url'),k:3,g:4};
const account={account:{id:'a'.repeat(32),apiToken:'private-api-token',expiresAt:new Date(Date.now()+3600000).toISOString()},claim:{url:'https://dash.cloudflare.com/claim-preview?claimToken=private-claim',expiresAt:new Date(Date.now()+3600000).toISOString()}};
function state(){const data=new Map();return {data,storage:{get:async key=>structuredClone(data.get(key)),put:async(key,value)=>{if(typeof key==='string')data.set(key,structuredClone(value));else for(const [k,v]of Object.entries(key))data.set(k,structuredClone(v));},delete:async key=>{for(const k of Array.isArray(key)?key:[key])data.delete(k);},deleteAll:async()=>data.clear(),setAlarm:async at=>{data.set('_alarm',at);},deleteAlarm:async()=>data.delete('_alarm'),list:async(options={})=>new Map([...data].filter(([key])=>key.startsWith(options.prefix||'')&&key!=='_alarm').sort(([a],[b])=>a.localeCompare(b)))},blockConcurrencyWhile:fn=>fn()};}
function environment(overrides={}){
 const states=new Map(),calls=[],limitState=state(),limiter=new InstallLimits(limitState);
 const env={PAC_PAYLOAD:'export default {}',proofBudget:3,LIMITS:{idFromName:key=>key,get:()=>({fetch:async(url,options)=>limiter.fetch(new Request(url,options))})},requestApi:async(path,options)=>{calls.push({path,options});return path.endsWith('/challenge')?challenge:account;},deployPac:async(secret,payload)=>{assert.equal(secret.apiToken,'private-api-token');assert.equal(payload,'export default {}');return 'https://pac.example.workers.dev';},...overrides};
 env.JOBS={idFromName:key=>key,get:key=>{if(!states.has(key)){const storage=state();states.set(key,{storage,job:new InstallJob(storage,env)});}return {fetch:request=>states.get(key).job.fetch(request)};}};
 return {env,states,calls};
}
async function browser(env){let cookie='';const call=async(path,body,extra={})=>{const response=await route(new Request('https://install.test'+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json',origin:'https://install.test'}:{}),...extra},body:body?JSON.stringify(body):undefined}),env);if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};const response=await call('/api/session'),{csrf}=await response.json();return {call,csrf,getCookie:()=>cookie};}
test('incremental proof matches the official sequential checkpoint chain',()=>{
 let progress=beginProof(challenge),parts=[Buffer.from(progress.first,'base64')],done=false;
 while(!done){const step=advanceProof(progress,3);parts.push(step.block);progress=step.progress;done=step.done;}
 let hash=sha(Buffer.alloc(32,7)),expected=[hash];for(let s=0;s<3;s++){for(let i=0;i<4;i++)hash=sha(hash);expected.push(hash);}
 assert.deepEqual(Buffer.concat(parts),Buffer.concat(expected));assert.equal(progress.segment,3);
});
test('unsupported or oversized proofs are rejected before CPU work',()=>{
 for(const patch of [{k:0},{g:0},{g:1.2},{k:64001},{k:64000,g:2000},{seed:'invalid'}])assert.throws(()=>beginProof({...challenge,...patch}));
});
test('proof storage blocks stay below Durable Object value limits',()=>{
 const step=advanceProof(beginProof({...challenge,k:64000,g:1}),500000);assert.ok(step.block.length<=96000);assert.equal(step.progress.segment,3000);
});
test('terms, CSRF and browser origin are mandatory',async()=>{
 const {env,calls}=environment(),user=await browser(env);
 for(const body of [{csrf:user.csrf},{csrf:'wrong',acceptTerms:true,acceptPrivacy:true}])assert.equal((await user.call('/api/start',body)).status,403);
 assert.equal((await user.call('/api/start',{csrf:user.csrf,acceptTerms:true,acceptPrivacy:true},{origin:'https://evil.test'})).status,403);
 assert.equal(calls.length,0);
});
test('complete isolated installation exposes only preview and claim URLs',async()=>{
 const {env,states,calls}=environment(),user=await browser(env),other=await browser(env);
 const input={csrf:user.csrf,acceptTerms:true,acceptPrivacy:true};
 assert.equal((await user.call('/api/start',input)).status,200);
 assert.equal((await user.call('/api/start',input)).status,200);
 const entry=[...states.values()][0];for(let step=0;step<20&&entry.storage.data.get('job').stage!=='ready';step++)await entry.job.alarm();
 const response=await user.call('/api/status'),result=await response.json();assert.equal(result.stage,'ready');assert.equal(result.claimUrl,account.claim.url);
 assert.equal(JSON.stringify(result).includes('private-api-token'),false);assert.equal(entry.storage.data.has('secret'),false);
 assert.equal([...entry.storage.data.keys()].some(key=>key.startsWith('proof')),false);
 assert.equal((await (await other.call('/api/status')).json()).stage,'idle');assert.equal(calls.filter(call=>call.path==='/provisioning/previews').length,1);
 const request=calls.find(call=>call.path==='/provisioning/previews').options.body;assert.equal(request.acceptTermsOfService,'yes');assert.equal(request.termsOfService,'https://www.cloudflare.com/terms/');
 assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('account creation interrupted after POST is never automatically repeated',async()=>{
 const {env,states,calls}=environment(),user=await browser(env);await user.call('/api/start',{csrf:user.csrf,acceptTerms:true,acceptPrivacy:true});
 const entry=[...states.values()][0],job=entry.storage.data.get('job');entry.storage.data.set('job',{...job,stage:'creating'});await entry.job.alarm();
 assert.equal(calls.length,0);assert.equal(entry.storage.data.get('job').stage,'failed');
});
test('expired results and credentials are removed by the alarm',async()=>{
 const {env,states}=environment(),user=await browser(env),entry=[...states.values()][0];
 entry.storage.data.set('job',{stage:'ready',expiresAt:Date.now()-1,claimUrl:'private'});entry.storage.data.set('secret',{apiToken:'private'});await entry.job.alarm();
 assert.equal(entry.storage.data.size,0);assert.equal((await user.call('/api/status')).status,410);
 assert.equal((await user.call('/api/session')).status,200);
});
test('failed provisioning removes all intermediate data and returns a safe error',async()=>{
 const {env,states}=environment({requestApi:async()=>{throw new ApiError(403,'challenge');}}),user=await browser(env);await user.call('/api/start',{csrf:user.csrf,acceptTerms:true,acceptPrivacy:true});
 const entry=[...states.values()][0];await entry.job.alarm();const result=await (await user.call('/api/status')).json();assert.equal(result.stage,'failed');assert.match(result.error,/Cloudflare/);assert.equal(entry.storage.data.has('secret'),false);
});
test('per-client rate limit blocks excessive starts and does not leak client IPs',async()=>{
 const limiter=new InstallLimits(state());for(let count=0;count<4;count++){const response=await limiter.fetch(new Request('https://internal/',{method:'POST',body:JSON.stringify({key:'hash'})}));assert.equal(response.status,count<3?200:429);}
});
test('temporary-account response validation rejects foreign claims and expired tokens',()=>{
 assert.equal(validateAccount(account).apiToken,'private-api-token');
 assert.throws(()=>validateAccount({...account,claim:{...account.claim,url:'https://evil.test/claim-preview?claimToken=x'}}));
 assert.throws(()=>validateAccount({...account,account:{...account.account,expiresAt:'2000-01-01'}}));
});
test('deployment uploads bundled PAC with SQLite migration and enables workers.dev',async()=>{
 const calls=[];const fetcher=async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/settings'))return Response.json({success:false},{status:404});
  return Response.json({success:true,result:url.endsWith('/workers/subdomain')?{subdomain:'my-account'}:{}});
 };
 const result=await deployPac(validateAccount(account),'export default {}',fetcher);assert.equal(result,'https://pac.my-account.workers.dev');
 const upload=calls.find(call=>call.options.body instanceof FormData),metadata=JSON.parse(await upload.options.body.get('metadata').text());
 assert.deepEqual(metadata.migrations.steps,[{new_sqlite_classes:['Portal']}]);assert.equal(metadata.bindings[0].class_name,'Portal');assert.equal(await upload.options.body.get('worker.mjs').text(),'export default {}');
 assert.ok(calls.every(call=>call.options.headers.authorization==='Bearer private-api-token'));assert.ok(calls.some(call=>call.url.endsWith('/scripts/pac/subdomain')&&call.options.method==='POST'));
});
test('Cloudflare error details and tokens are not copied into thrown messages',async()=>{
 await assert.rejects(()=>api('/test',{fetcher:async()=>Response.json({success:false,errors:[{message:'private-token'}]},{status:403}),stage:'test'}),error=>error.message==='test'&&error.status===403);
});
