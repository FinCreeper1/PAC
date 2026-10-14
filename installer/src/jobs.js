import {beginProof,advanceProof} from './proof.js';
import {api,validateAccount,deployPac,TERMS,PRIVACY} from './cloudflare.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const hour=3600000;
export class InstallLimits {
 constructor(state){this.state=state;}
 async fetch(request) {
  if(request.method!=='POST')return json({},405);
  const {key}=await request.json();
  return this.state.blockConcurrencyWhile(async()=>{
   const now=Date.now(),window=Math.floor(now/hour),global=await this.state.storage.get('global')||{},ip=await this.state.storage.get('ip:'+key)||{};
   const total=global.window===window?global.count:0,own=ip.window===window?ip.count:0;
   if(total>=20||own>=3)return json({error:'Zu viele Einrichtungen. Bitte später erneut versuchen.'},429);
   await this.state.storage.put({'global':{window,count:total+1},['ip:'+key]:{window,count:own+1}});
   await this.state.storage.setAlarm((window+1)*hour+1000);return json({allowed:true});
  });
 }
 async alarm(){
  const now=Date.now(),window=Math.floor(now/hour),entries=await this.state.storage.list();
  for(const [key,value] of entries)if(value.window<window)await this.state.storage.delete(key);
  if((await this.state.storage.list()).size)await this.state.storage.setAlarm((window+1)*hour+1000);
 }
}
export class InstallJob {
 constructor(state,env){this.state=state;this.env=env;}
 async fetch(request) {
  const url=new URL(request.url);
  return this.state.blockConcurrencyWhile(async()=>{
   let job=await this.state.storage.get('job');
   if(url.pathname==='/session'){
    if(!job){job={stage:'idle',csrf:crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+hour};await this.state.storage.put('job',job);await this.state.storage.setAlarm(job.expiresAt);}
    if(job.expiresAt<=Date.now())return json({error:'Einrichtung abgelaufen. Bitte neu starten.'},410);
    return json({csrf:job.csrf});
   }
   if(!job||job.expiresAt<=Date.now())return json({error:'Einrichtung abgelaufen. Bitte die Seite neu laden.'},410);
   if(url.pathname==='/start'){
    const body=await request.json();
    if(body.csrf!==job.csrf||body.acceptTerms!==true||body.acceptPrivacy!==true)return json({error:'Bitte beiden Cloudflare-Bedingungen zustimmen.'},403);
    if(job.stage!=='idle')return this.status(job);
    const limiter=await this.env.LIMITS.get(this.env.LIMITS.idFromName('limits')).fetch('https://internal/',{method:'POST',body:JSON.stringify({key:body.rateKey})});
    if(!limiter.ok)return limiter;
    job={...job,stage:'challenge',startedAt:Date.now(),expiresAt:Date.now()+hour};
    await this.state.storage.put('job',job);await this.state.storage.setAlarm(Date.now()+100);return this.status(job);
   }
   if(url.pathname==='/status')return this.status(job);
   if(url.pathname==='/forget'&&request.method==='POST'){
    const {csrf}=await request.json();if(csrf!==job.csrf)return json({},403);
    if(!['ready','failed','idle'].includes(job.stage))return json({error:'Die Einrichtung läuft noch.'},409);
    await this.state.storage.deleteAll();await this.state.storage.deleteAlarm();return json({forgotten:true});
   }
   return json({},404);
  });
 }
 status(job) {
  return json({stage:job.stage,progress:job.progress||0,...(job.stage==='ready'?{claimUrl:job.claimUrl,previewUrl:job.previewUrl,expiresAt:job.expiresAt}:{}),...(job.stage==='failed'?{error:job.error}:{}),expiresAt:job.expiresAt});
 }
 async alarm() {
  let job=await this.state.storage.get('job');if(!job)return;
  if(job.expiresAt<=Date.now()){await this.state.storage.deleteAll();return;}
  const requestApi=this.env.requestApi||api;
  try {
   if(job.stage==='idle'||job.stage==='ready'||job.stage==='failed'){await this.state.storage.setAlarm(job.expiresAt);return;}
   if(job.stage==='challenge') {
    const challenge=await requestApi('/provisioning/previews/challenge',{method:'POST',body:{},stage:'challenge'});
    await this.state.storage.put('proof',beginProof(challenge));job.stage='solving';
   } else if(job.stage==='solving') {
    const current=await this.state.storage.get('proof'),step=advanceProof(current,this.env.proofBudget||500000);
    if(step.block.length)await this.state.storage.put('proof-block:'+String(current.blocks).padStart(5,'0'),step.block);
    await this.state.storage.put('proof',step.progress);job.progress=Math.floor(65*step.progress.segment/step.progress.k);
    if(step.done)job.stage='provision';
   } else if(job.stage==='provision') {
    const proof=await this.state.storage.get('proof'),blocks=await this.state.storage.list({prefix:'proof-block:'});
    const checkpoints=Buffer.concat([Buffer.from(proof.first,'base64'),...[...blocks.values()].map(value=>Buffer.from(value))]).toString('base64');
    // Account creation has no idempotency key. Never repeat an ambiguous POST.
    job.stage='creating';await this.state.storage.put('job',job);
    const result=await requestApi('/provisioning/previews',{method:'POST',body:{termsOfService:TERMS,privacyPolicy:PRIVACY,acceptTermsOfService:'yes',challengeToken:proof.challengeToken,solution:{checkpoints}},stage:'provision'});
    const secret=validateAccount(result);await this.state.storage.put('secret',{accountId:secret.accountId,apiToken:secret.apiToken});
    job={...job,stage:'uploading',claimUrl:secret.claimUrl,expiresAt:secret.expiresAt,progress:75};
    await this.state.storage.delete(['proof',...[...blocks.keys()]]);
   } else if(job.stage==='creating') {
    throw new Error('account-creation-uncertain');
   } else if(job.stage==='uploading') {
    const secret=await this.state.storage.get('secret');
    job.previewUrl=await (this.env.deployPac||deployPac)(secret,this.env.PAC_PAYLOAD);
    job.stage='ready';job.progress=100;
    // No persistent deployment access remains after delivering the result.
    await this.state.storage.delete('secret');
   }
   await this.state.storage.put('job',job);await this.state.storage.setAlarm(['ready','failed'].includes(job.stage)?job.expiresAt:Date.now()+100);
  } catch(error) {
   const status=error.status;
   if(['challenge','uploading'].includes(job.stage)&&(job.retries||0)<2&&(!status||status===429||status>=500)){
    job.retries=(job.retries||0)+1;await this.state.storage.put('job',job);await this.state.storage.setAlarm(Date.now()+2000*job.retries);return;
   }

   const message=status===429?'Cloudflare begrenzt gerade neue Konten. Bitte später erneut versuchen.':status===403?'Cloudflare hat die Einrichtung abgelehnt. Bitte später erneut versuchen.':error.message==='account-creation-uncertain'?'Die Kontoerstellung wurde unterbrochen. Bitte neu starten.':'Die Einrichtung konnte nicht abgeschlossen werden. Bitte erneut versuchen.';
   // Do not log API bodies, account tokens or claim URLs.
   await this.state.storage.deleteAll();
   await this.state.storage.put('job',{stage:'failed',csrf:job.csrf,expiresAt:Date.now()+600000,error:message});
   await this.state.storage.setAlarm(Date.now()+600000);
  }
 }
}
