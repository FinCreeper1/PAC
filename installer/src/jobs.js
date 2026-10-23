import {api,deployPac,listPacs,pacName,updatePac,deletePac} from './cloudflare.js';
import {releaseInfo} from './release.js';
import {beginLogin,exchangeCode} from './oauth.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const hour=3600000;
export function confirmsVersion(actual, expected) {
 if(typeof actual!=='string'||typeof expected!=='string'||!expected)return false;
 if(actual===expected)return true;
 const parse=value=>/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)?value.slice(1).split('.').map(BigInt):null;
 const a=parse(actual),b=parse(expected);
 if(!a||!b)return false;
 for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}
 return true;
}
export class InstallLimits {
 constructor(state){this.state=state;}
 async fetch(request) {
  if(request.method!=='POST')return json({},405);
  const {key}=await request.json();
  return this.state.blockConcurrencyWhile(async()=>{
   const now=Date.now(),window=Math.floor(now/hour),global=await this.state.storage.get('global')||{},ip=await this.state.storage.get('ip:'+key)||{};
   const total=global.window===window?global.count:0,own=ip.window===window?ip.count:0;
   if(total>=300||own>=30)return json({error:'Zu viele Anmeldeversuche. Bitte zur nächsten vollen Stunde erneut versuchen.'},429);
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
   if(job.stage==='activating' && (!job.activationCheckedAt || Date.now()-job.activationCheckedAt>=10000)){
    await this.checkActivation(job);job=await this.state.storage.get('job');
   }
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
   }catch(error){return this.fail(job,error.message==='no-accounts'?'Es wurde kein zugängliches Cloudflare-Konto gefunden. Prüfen Sie Ihre Kontomitgliedschaft und die freigegebenen Konten.':error.status===403?'Cloudflare hat den Kontozugriff abgelehnt. Erlauben Sie Account Settings → Read und Workers → Admin und melden Sie sich erneut an.':error.status===429?'Cloudflare begrenzt gerade die Anfragen. Warten Sie kurz und melden Sie sich erneut an.':'Die Cloudflare-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut anmelden.');}
  }
  if(body.csrf!==job.csrf)return json({error:'Ungültige Sitzung.'},403);
  if(path==='/overview'){
   // After an update the Cloudflare login stays valid, so the overview opens again without a new sign-in.
   const secret=await this.state.storage.get('secret');
   if(job.stage!=='updated'||!job.accounts?.length||!secret||secret.expiresAt<=Date.now())return json({error:'Die Cloudflare-Anmeldung ist abgelaufen. Bitte erneut anmelden.'},401);
   for(const key of ['accountId','scriptName','previewUrl','dashboardUrl','version','previousVersion','targetVersion','activationCheckedAt','activationChecks'])delete job[key];
   job.stage='authorized';await this.save(job);return this.status(job);
  }
  if(path==='/forget'){
   if(job.stage==='uploading'||job.stage==='updating'||job.stage==='activating')return json({error:'Die Bereitstellung läuft noch.'},409);
   await this.state.storage.deleteAll();await this.state.storage.deleteAlarm();return json({forgotten:true});
  }
  if(path==='/login'){
   if(!this.env.OAUTH_CLIENT_ID)return json({error:'Die direkte Cloudflare-Anmeldung wird noch freigeschaltet.'},503);
   if(!['idle','failed','authorizing'].includes(job.stage))return json({error:'Bitte die aktuelle Einrichtung abschließen.'},409);
   const limiter=await this.env.LIMITS.get(this.env.LIMITS.idFromName('limits')).fetch('https://internal/',{method:'POST',body:JSON.stringify({key:body.rateKey})});if(!limiter.ok)return limiter;
   const login=beginLogin(this.env.OAUTH_CLIENT_ID,body.redirectUri);login.expiresAt=Date.now()+600000;
   await this.state.storage.put('login',login);job.stage='authorizing';await this.save(job);return json({url:login.url});
  }
  if(path==='/pacs'){
   if(job.stage!=='authorized'||!job.accounts.some(a=>a.id===body.accountId))return json({error:'Bitte ein verbundenes Cloudflare-Konto auswählen.'},403);
   const secret=await this.state.storage.get('secret');
   if(!secret||secret.expiresAt<=Date.now())return json({error:'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.'},410);
   try{
    const pacs=await listPacs(body.accountId,secret.apiToken,this.env.requestApi||api),latest=this.env.PAC_VERSION||null;
    // Only offer an update where the running version is known to differ; unreachable PACs stay neutral.
    await Promise.all(pacs.map(async pac=>{
     pac.updateAvailable=null;if(!pac.url||!latest)return;
     try{
      const url=new URL('/api/version',pac.url);url.searchParams.set('check',crypto.randomUUID());
      const response=await (this.env.activationFetch||fetch)(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(5000)});
      if(response.status===404){pac.updateAvailable=true;return;} // Instances older than the version endpoint.
      if(response.ok){const version=(await response.json()).version;pac.version=typeof version==='string'&&version!=='source'?version:null;pac.updateAvailable=pac.version!==latest;} // Unversioned (manually deployed) PACs get the versioned build.
     }catch{}
    }));
    job.pacVersionsAccount=body.accountId;job.pacVersions=Object.fromEntries(pacs.map(pac=>[pac.name,pac.version||null]));await this.save(job);
    const release=await releaseInfo(this.env);
    return json({pacs,latestVersion:latest,latestNotes:release.notes,releaseUrl:release.releaseUrl});
   }
   catch(error){return json({error:error.status===403?'Cloudflare hat das Lesen der Worker abgelehnt. Bitte die Workers-Leserechte prüfen.':'Die vorhandenen PACs konnten nicht geladen werden. Bitte erneut versuchen.'},error.status===403?403:502);}
  }
  if(path==='/delete-prepare'||path==='/delete'){
   if(job.stage!=='authorized'||!job.accounts?.some(a=>a.id===body.accountId))return json({error:'Bitte ein verbundenes Cloudflare-Konto auswählen.'},403);
   const secret=await this.state.storage.get('secret');
   if(!secret||secret.expiresAt<=Date.now())return json({error:'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.'},410);
   if(typeof body.scriptName!=='string'||!/^pac-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.scriptName)||body.scriptName.length>63||body.scriptName==='pac-install')return json({error:'Bitte ein vorhandenes PAC auswählen.'},400);
   if(body.confirmName!==body.scriptName)return json({error:'Bitte den PAC-Namen exakt eingeben.'},400);
   if(path==='/delete-prepare'){
    const pending={accountId:body.accountId,scriptName:body.scriptName,token:crypto.randomUUID(),expiresAt:Date.now()+300000};
    await this.state.storage.put('deletion',pending);return json({confirmationToken:pending.token});
   }
   const pending=await this.state.storage.get('deletion');
   if(!pending||pending.expiresAt<=Date.now()||pending.accountId!==body.accountId||pending.scriptName!==body.scriptName||pending.token!==body.confirmationToken)return json({error:'Die Löschbestätigung ist ungültig oder abgelaufen. Bitte erneut beginnen.'},403);
   // Consume before the upstream call. An interrupted request must never silently repeat deletion.
   await this.state.storage.delete('deletion');
   try{
    await deletePac(body.accountId,body.scriptName,secret.apiToken,this.env.requestApi||api);
    if(job.pacVersionsAccount===body.accountId&&job.pacVersions){delete job.pacVersions[body.scriptName];await this.save(job);}
    return json({deleted:true,scriptName:body.scriptName});
   }catch(error){
    return json({error:error.stage==='not-pac'?'Dieser Worker ist keine PAC-Installation und wurde nicht gelöscht.':error.status===404?'Dieses PAC wurde nicht gefunden. Bitte die Übersicht neu laden.':error.status===403?'Cloudflare hat das Löschen abgelehnt. Bitte Workers → Admin freigeben und erneut anmelden.':'Das Löschen konnte nicht bestätigt werden. Bitte die Übersicht neu laden und den Worker bei Cloudflare prüfen, bevor Sie erneut beginnen.'},error.stage==='not-pac'?409:error.status===404?404:error.status===403?403:502);
   }
  }
  if(path==='/update'){
   if(job.stage==='activating'||job.stage==='updating'||job.stage==='updated')return this.status(job);
   if(job.stage!=='authorized'||!job.accounts.some(a=>a.id===body.accountId))return json({error:'Bitte ein verbundenes Cloudflare-Konto auswählen.'},403);
   if(typeof body.scriptName!=='string'||!/^pac-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.scriptName)||body.scriptName.length>63||body.scriptName==='pac-install')return json({error:'Bitte ein vorhandenes PAC auswählen.'},400);
   job.previousVersion=job.pacVersionsAccount===body.accountId?(job.pacVersions?.[body.scriptName]||null):null;job.targetVersion=this.env.PAC_VERSION||null;delete job.pacVersions;
   job.accountId=body.accountId;job.scriptName=body.scriptName;job.stage='updating';
   job.dashboardUrl='https://dash.cloudflare.com/'+job.accountId+'/workers/services/view/'+job.scriptName+'/production/settings';
   await this.save(job,Date.now()+100);return this.status(job);
  }
  if(path==='/start'){
   if(job.stage==='uploading'||job.stage==='ready'||job.stage==='activating'||job.stage==='updating'||job.stage==='updated')return this.status(job);
   if(job.stage!=='authorized'||!job.accounts.some(a=>a.id===body.accountId))return json({error:'Bitte ein verbundenes Cloudflare-Konto auswählen.'},403);
   let scriptName='pac-'+crypto.randomUUID().replaceAll('-','').slice(0,12);
   if(body.tripName!==undefined){
    try{scriptName=pacName(body.tripName);}catch(error){return json({error:error.message},400);}
    const secret=await this.state.storage.get('secret');
    if(!secret||secret.expiresAt<=Date.now())return json({error:'Bitte erneut bei Cloudflare anmelden.'},410);
    try{await (this.env.requestApi||api)('/accounts/'+body.accountId+'/workers/scripts/'+scriptName+'/settings',{token:secret.apiToken,stage:'settings'});return json({error:'Diese PAC-Adresse ist bereits vergeben. Bitte den Reisenamen ergänzen, etwa um das Jahr.'},409);}
    catch(error){if(error.status!==404)return json({error:'Die gewünschte PAC-Adresse konnte nicht geprüft werden. Bitte erneut versuchen.'},502);}
   }
   job.setupToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
   job.tripName=typeof body.tripName==='string'?body.tripName.trim():'';
   job.accountId=body.accountId;job.scriptName=scriptName;job.stage='uploading';
   job.dashboardUrl='https://dash.cloudflare.com/'+job.accountId+'/workers/services/view/'+job.scriptName+'/production/settings';
   await this.save(job,Date.now()+100);return this.status(job);
  }
  return json({},404);
 });}
 async save(job,alarm=job.expiresAt){await this.state.storage.put('job',job);await this.state.storage.setAlarm(alarm);}
 status(job){return json({stage:job.stage,expiresAt:job.expiresAt,...(job.targetVersion?{previousVersion:job.previousVersion||null,targetVersion:job.targetVersion}:{}),...(job.stage==='authorized'?{accounts:job.accounts}:{}),...(job.stage==='ready'?{previewUrl:job.previewUrl,...(job.setupToken?{setupUrl:job.previewUrl+'/setup#'+new URLSearchParams({token:job.setupToken,...(job.tripName?{title:job.tripName}:{})})}:{}),dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{}),...(['updating','activating'].includes(job.stage)?{scriptName:job.scriptName,...(job.stage==='activating'?{activationCheckedAt:job.activationCheckedAt||null,activationChecks:job.activationChecks||0,activationIssue:job.activationIssue||null}:{} )}:{}),...(job.stage==='updated'?{previewUrl:job.previewUrl,dashboardUrl:job.dashboardUrl,scriptName:job.scriptName,version:job.version}:{}),...(job.stage==='failed'?{error:job.error,...(job.diagnostic?{diagnostic:job.diagnostic}:{}),...(job.dashboardUrl?{dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{})}:{})});}
 async fail(job,error,diagnostic){await this.state.storage.deleteAll();await this.save({version:2,stage:'failed',csrf:job.csrf,error,...(diagnostic?{diagnostic}:{}),...(job.dashboardUrl?{dashboardUrl:job.dashboardUrl,scriptName:job.scriptName}:{}),expiresAt:Date.now()+600000});return json({ok:false});}
 async alarm(){
  const job=await this.state.storage.get('job');if(!job)return;
  if(!job.version||job.expiresAt<=Date.now()){await this.state.storage.deleteAll();return;}
  if(job.stage==='activating')return this.checkActivation(job);
  if(job.stage==='updating')return this.update(job);
  if(job.stage!=='uploading'){await this.state.storage.setAlarm(job.expiresAt);return;}
  try{
   const secret=await this.state.storage.get('secret');if(!secret||secret.expiresAt<=Date.now())throw new Error('expired');
   job.previewUrl=await (this.env.deployPac||deployPac)({...secret,accountId:job.accountId,scriptName:job.scriptName,setupToken:job.setupToken},this.env.PAC_PAYLOAD);
   job.dashboardUrl='https://dash.cloudflare.com/'+job.accountId+'/workers/services/view/'+job.scriptName+'/production/settings';
   job.stage='ready';delete job.accounts;await this.state.storage.delete('secret');await this.save(job);
  }catch(error){
   const labels={'subdomain':'Konto-Subdomain lesen','register-subdomain':'Konto-Subdomain einrichten','subdomain-response':'Konto-Subdomain prüfen','settings':'Vorhandenen Worker prüfen','already-exists':'Worker bereits vorhanden','upload':'Worker hochladen','enable-subdomain':'Worker-Adresse aktivieren'};
   const stage=Object.hasOwn(labels,error.stage)?error.stage:'deployment';
   const diagnostic={stage,...(Number.isInteger(error.status)?{status:error.status}:{}),...(Number.isInteger(error.code)?{code:error.code}:{})};
   const detail='Schritt: '+(labels[stage]||'Bereitstellung')+(diagnostic.status?' · HTTP '+diagnostic.status:'')+(diagnostic.code?' · Cloudflare-Code '+diagnostic.code:'')+'. ';
   const advice=error.status===403&&stage==='subdomain'?'Cloudflare verweigert das Lesen der Konto-Subdomain. Diese API verlangt laut Dokumentation Workers Scripts Read oder Write; Workers → Admin allein deckt den Aufruf nicht ab. ':error.status===403&&stage==='upload'?'Zum Anlegen eines neuen Workers ist Workers → Admin erforderlich. Workers → Edit erlaubt nur Änderungen an bestehenden Workern. Bitte den OAuth-Client anpassen und erneut anmelden. ':error.status===403?'Cloudflare hat diesen API-Aufruf abgelehnt. Die erforderliche Berechtigung hängt vom angezeigten Schritt ab. ':error.status===401?'Die Cloudflare-Anmeldung ist abgelaufen. ':'';
   await this.fail(job,detail+advice+'Bitte prüfen Sie vor einem neuen Versuch den Worker '+job.scriptName+' in Ihrem Konto.',diagnostic);
  }
 }
 async checkActivation(job){
  if(Date.now()>=job.activationDeadline){
   return this.fail(job,'Der neue Code wurde hochgeladen, aber die Aktivierung konnte innerhalb von 15 Minuten nicht bestätigt werden. Bitte die Adminseite später erneut öffnen. Ein erneuter Upload ist nicht erforderlich.',{stage:'update-activation'});
  }
  job.activationCheckedAt=Date.now();job.activationChecks=(job.activationChecks||0)+1;
  try{
   job.activationIssue='missing-target';
   if(job.previewUrl && job.version){
    const url=new URL('/api/version',job.previewUrl);url.searchParams.set('check',crypto.randomUUID());
    const response=await (this.env.activationFetch||fetch)(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)});
    job.activationIssue=response.ok?'version-pending':'http-'+response.status;
    const actual=response.ok?(await response.json()).version:null;
    if(confirmsVersion(actual,job.version)){
     job.version=actual;
     job.stage='updated';delete job.activationDeadline;delete job.activationIssue;await this.save(job);return;
    }
   }
  }catch{job.activationIssue='network-error';} // Old instances, transient errors and rollouts are retried without uploading again.
  await this.save(job,Date.now()+10000);
 }
 async update(job){
  try{
   const secret=await this.state.storage.get('secret');if(!secret||secret.expiresAt<=Date.now())throw new Error('expired');
   const result=await (this.env.updatePac||updatePac)({...secret,accountId:job.accountId,scriptName:job.scriptName},this.env.PAC_PAYLOAD);
   job.previewUrl=result.url;job.version=this.env.PAC_VERSION||null;job.stage='activating';
   job.activationDeadline=Math.min(job.expiresAt,Date.now()+15*60000);
   await this.save(job,Date.now()+1000);
  }catch(error){
   const labels={'update-settings':'Vorhandenes PAC lesen','not-pac':'PAC prüfen','update-upload':'Neue Version hochladen','update-verify':'Einstellungen nach dem Update prüfen'};
   const stage=Object.hasOwn(labels,error.stage)?error.stage:'update';
   const diagnostic={stage,...(Number.isInteger(error.status)?{status:error.status}:{}),...(Number.isInteger(error.code)?{code:error.code}:{})};
   const advice=error.stage==='not-pac'?'Dieser Worker ist keine PAC-Installation und wurde nicht verändert. ':error.status===404?'Dieses PAC wurde im gewählten Konto nicht gefunden. ':error.status===403?'Cloudflare hat das Update abgelehnt. Bitte Workers → Admin freigeben und erneut anmelden. ':error.status===401||error.message==='expired'?'Die Cloudflare-Anmeldung ist abgelaufen. ':'';
   await this.fail(job,'Schritt: '+(labels[stage]||'Update')+(diagnostic.status?' · HTTP '+diagnostic.status:'')+(diagnostic.code?' · Cloudflare-Code '+diagnostic.code:'')+'. '+advice+'Die bisherige Version von '+job.scriptName+' läuft weiter, falls das Hochladen nicht abgeschlossen wurde.',diagnostic);
  }
 }
}
