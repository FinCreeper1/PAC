import {api,deployPac} from './cloudflare.js';
import {beginLogin,exchangeCode} from './oauth.js';
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
 async fetch(request){return this.state.blockConcurrencyWhile(async()=>{
  const path=new URL(request.url).pathname;
  let job=await this.state.storage.get('job');
  if(path==='/session'){
   // Old temporary-account sessions cannot continue under the OAuth installer.
   if(job&&!job.version){await this.state.storage.deleteAll();job=null;}
   if(!job){job={version:2,stage:'idle',csrf:crypto.randomUUID(),expiresAt:Date.now()+hour};await this.save(job);}
   if(job.expiresAt<=Date.now())return json({error:'Sitzung abgelaufen. Bitte neu laden.'},410);
   return json({csrf:job.csrf,configured:Boolean(this.env.OAUTH_CLIENT_ID)});
  }
  if(!job||job.expiresAt<=Date.now())return json({error:'Sitzung abgelaufen. Bitte neu laden.'},410);
  if(path==='/status'){
   const login=job.stage==='authorizing'?await this.state.storage.get('login'):null;
   if(job.stage==='authorizing'&&(!login||login.expiresAt<=Date.now())){await this.fail(job,'Die Anmeldung ist abgelaufen. Bitte neu beginnen.');return this.status(await this.state.storage.get('job'));}
   return this.status(job);
  }
  const body=await request.json();
  if(path==='/callback'){
   const login=await this.state.storage.get('login');
   if(job.stage!=='authorizing'||!login||body.state!==login.state||login.expiresAt<=Date.now())return json({error:'Anmeldung ungültig oder abgelaufen. Bitte neu beginnen.'},403);
   // Consume state before exchanging the single-use authorization code.
   await this.state.storage.delete('login');
   if(body.error||typeof body.code!=='string'||body.code.length>4096)return this.fail(job,'Die Cloudflare-Anmeldung wurde nicht abgeschlossen.');
   try{
    const secret=await (this.env.exchangeCode||exchangeCode)(this.env.OAUTH_CLIENT_ID,login,body.code);
    const accounts=await (this.env.requestApi||api)('/accounts?per_page=50',{token:secret.apiToken,stage:'accounts'});
    job.accounts=accounts.filter(a=>/^[a-f0-9]{32}$/.test(a.id)&&typeof a.name==='string').map(a=>({id:a.id,name:a.name}));
    if(!job.accounts.length)throw new Error('no-accounts');
    await this.state.storage.put('secret',secret);job.stage='authorized';job.expiresAt=secret.expiresAt;await this.save(job);return json({ok:true});
   }catch(error){return this.fail(job,error.message==='no-accounts'?'Es wurde kein zugängliches Cloudflare-Konto gefunden. Prüfe deine Kontomitgliedschaft und die freigegebenen Konten.':error.status===403?'Cloudflare hat den Kontozugriff abgelehnt. Erlaube Account Settings → Read und Workers → Admin und melde dich erneut an.':error.status===429?'Cloudflare begrenzt gerade die Anfragen. Warte kurz und melde dich erneut an.':'Die Cloudflare-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut anmelden.');}
  }
  if(body.csrf!==job.csrf)return json({error:'Ungültige Sitzung.'},403);
  if(path==='/forget'){
   if(job.stage==='uploading')return json({error:'Die Bereitstellung läuft noch.'},409);
   await this.state.storage.deleteAll();await this.state.storage.deleteAlarm();return json({forgotten:true});
  }
  if(path==='/login'){
   if(!this.env.OAUTH_CLIENT_ID)return json({error:'Die direkte Cloudflare-Anmeldung wird noch freigeschaltet.'},503);
   if(!['idle','failed','authorizing'].includes(job.stage))return json({error:'Bitte die aktuelle Einrichtung abschließen.'},409);
   const limiter=await this.env.LIMITS.get(this.env.LIMITS.idFromName('limits')).fetch('https://internal/',{method:'POST',body:JSON.stringify({key:body.rateKey})});if(!limiter.ok)return limiter;
   const login=beginLogin(this.env.OAUTH_CLIENT_ID,body.redirectUri);login.expiresAt=Date.now()+600000;
   await this.state.storage.put('login',login);job.stage='authorizing';await this.save(job);return json({url:login.url});
  }
  if(path==='/start'){
   if(job.stage==='uploading'||job.stage==='ready')return this.status(job);
   if(job.stage!=='authorized'||!job.accounts.some(a=>a.id===body.accountId))return json({error:'Bitte ein verbundenes Cloudflare-Konto auswählen.'},403);
   job.accountId=body.accountId;job.scriptName='pac-'+crypto.randomUUID().replaceAll('-','').slice(0,12);job.stage='uploading';
   job.dashboardUrl='https://dash.cloudflare.com/'+job.accountId+'/workers/services/view/'+job.scriptName+'/production/settings';
   await this.save(job,Date.now()+100);return this.status(job);
  }
  return json({},404);
 });}
 async save(job,alarm=job.expiresAt){await this.state.storage.put('job',job);await this.state.storage.setAlarm(alarm);}
 status(job){return json({stage:job.stage,expiresAt:job.expiresAt,...(job.stage==='authorized'?{accounts:job.accounts}:{}),...(job.stage==='ready'?{previewUrl:job.previewUrl,dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{}),...(job.stage==='failed'?{error:job.error,...(job.diagnostic?{diagnostic:job.diagnostic}:{}),...(job.dashboardUrl?{dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{})}:{})});}
 async fail(job,error,diagnostic){await this.state.storage.deleteAll();await this.save({version:2,stage:'failed',csrf:job.csrf,error,...(diagnostic?{diagnostic}:{}),...(job.dashboardUrl?{dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{}),expiresAt:Date.now()+600000});return json({ok:false});}
 async alarm(){
  const job=await this.state.storage.get('job');if(!job)return;
  if(!job.version||job.expiresAt<=Date.now()){await this.state.storage.deleteAll();return;}
  if(job.stage!=='uploading'){await this.state.storage.setAlarm(job.expiresAt);return;}
  try{
   const secret=await this.state.storage.get('secret');if(!secret||secret.expiresAt<=Date.now())throw new Error('expired');
   job.previewUrl=await (this.env.deployPac||deployPac)({...secret,accountId:job.accountId,scriptName:job.scriptName},this.env.PAC_PAYLOAD);
   job.dashboardUrl='https://dash.cloudflare.com/'+job.accountId+'/workers/services/view/'+job.scriptName+'/production/settings';
   job.stage='ready';delete job.accounts;await this.state.storage.delete('secret');await this.save(job);
  }catch(error){
   const labels={'subdomain':'Konto-Subdomain lesen','register-subdomain':'Konto-Subdomain einrichten','subdomain-response':'Konto-Subdomain prüfen','settings':'Vorhandenen Worker prüfen','already-exists':'Worker bereits vorhanden','upload':'Worker hochladen','enable-subdomain':'Worker-Adresse aktivieren'};
   const stage=Object.hasOwn(labels,error.stage)?error.stage:'deployment';
   const diagnostic={stage,...(Number.isInteger(error.status)?{status:error.status}:{}),...(Number.isInteger(error.code)?{code:error.code}:{})};
   const detail='Schritt: '+(labels[stage]||'Bereitstellung')+(diagnostic.status?' · HTTP '+diagnostic.status:'')+(diagnostic.code?' · Cloudflare-Code '+diagnostic.code:'')+'. ';
   const advice=error.status===403&&stage==='subdomain'?'Cloudflare verweigert das Lesen der Konto-Subdomain. Diese API verlangt laut Dokumentation Workers Scripts Read oder Write; Workers → Admin allein deckt den Aufruf nicht ab. ':error.status===403&&stage==='upload'?'Zum Anlegen eines neuen Workers ist Workers → Admin erforderlich. Workers → Edit erlaubt nur Änderungen an bestehenden Workern. Bitte den OAuth-Client anpassen und erneut anmelden. ':error.status===403?'Cloudflare hat diesen API-Aufruf abgelehnt. Die erforderliche Berechtigung hängt vom angezeigten Schritt ab. ':error.status===401?'Die Cloudflare-Anmeldung ist abgelaufen. ':'';
   await this.fail(job,detail+advice+'Bitte prüfe vor einem neuen Versuch den Worker '+job.scriptName+' in deinem Konto.',diagnostic);
  }
 }
}
