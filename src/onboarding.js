import {createSession} from './legacy/_middleware.js';
import {NextcloudStorage,StorageConflict} from './nextcloud.js';
const encoder=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const keys=['PORTAL_PASSWORD','ADMIN_PASSWORD','NEXTCLOUD_WEBDAV_URL','NEXTCLOUD_USERNAME','NEXTCLOUD_APP_PASSWORD','NEXTCLOUD_ROOT'];
async function encryptionKey(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function sealConfiguration(value,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),encoder.encode(JSON.stringify(value)));
 return {version:1,iv:Array.from(iv),bytes:Array.from(new Uint8Array(bytes))};
}
export async function openConfiguration(record,secret){
 if(record.version!==1)throw new Error('Unsupported configuration');
 return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},await encryptionKey(secret),new Uint8Array(record.bytes))));
}
function equal(a,b){const x=encoder.encode(a),y=encoder.encode(b);if(x.length!==y.length)return false;let diff=0;for(let n=0;n<x.length;n++)diff|=x[n]^y[n];return diff===0;}
export function validateSetup(body){
 if(!body||Array.isArray(body)||typeof body!=='object')throw new Error('Bitte alle Felder ausfüllen.');
 const config={};for(const key of keys){if(typeof body[key]!=='string'||!body[key]||body[key].length>2048)throw new Error('Bitte alle Felder ausfüllen.');config[key]=key.endsWith('PASSWORD')?body[key]:body[key].trim();}
 if(config.PORTAL_PASSWORD.length<6||config.ADMIN_PASSWORD.length<6)throw new Error('Portal- und Adminpasswort müssen jeweils mindestens 6 Zeichen lang sein.');
 if(config.PORTAL_PASSWORD===config.ADMIN_PASSWORD)throw new Error('Verwende unterschiedliche Portal- und Adminpasswörter.');
 if(body.confirmPortal!==config.PORTAL_PASSWORD||body.confirmAdmin!==config.ADMIN_PASSWORD)throw new Error('Die Passwort-Wiederholungen stimmen nicht überein.');
 const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 config.SESSION_SECRET=token();config.CALENDAR_FEED_SECRET=token();
 // Use the same validation rules as normal operation before touching the cloud.
 new NextcloudStorage(config);return config;
}
const hour=value=>String(value).padStart(2,'0')+':00';
// Day length is stored as an hourly grid; the end hour is exclusive and at most 23:00.
export function dayTimeSlots(body,fallback=[8,21]){
 const read=(key,v)=>{const raw=body?.[key];if(raw==null||raw==='')return v;if(typeof raw!=='string'||!/^(?:[01]\d|2[0-3]):00$/.test(raw))throw new Error('Bitte Tagesbeginn und Tagesende als volle Stunde angeben.');return Number(raw.slice(0,2));};
 const start=read('TRIP_DAY_START',fallback[0]),end=read('TRIP_DAY_END',fallback[1]);
 if(end-start<2)throw new Error('Das Tagesende muss mindestens zwei Stunden nach dem Tagesbeginn liegen.');
 return Array.from({length:end-start},(_,i)=>hour(start+i));
}
export function validateTrip(body){
 if(body.TRIP_MODE==='existing')return null;
 if(body.TRIP_MODE!=='new')throw new Error('Wähle, ob du eine neue Reise anlegst oder eine bestehende übernimmst.');
 const value=(key,max)=>{const text=typeof body[key]==='string'?body[key].trim():'';if(!text||text.length>max)throw new Error('Bitte Reisetitel, Startort und Ziel ausfüllen.');return text;};
 const title=value('TRIP_TITLE',160),origin=value('TRIP_ORIGIN',120),destination=value('TRIP_DESTINATION',120);
 const date=key=>{const v=body[key];if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error('Bitte gültige Reisedaten angeben.');return v;};
 const startDate=date('TRIP_START'),endDate=date('TRIP_END'),count=(Date.parse(endDate)-Date.parse(startDate))/86400000+1;
 if(count<1||count>366)throw new Error('Das Reiseende muss am oder nach dem Beginn liegen. Höchstens 366 Reisetage sind möglich.');
 const raw=typeof body.TRIP_PARTICIPANTS==='string'?body.TRIP_PARTICIPANTS:'';const participants=[...new Set(raw.split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];
 if(participants.length>300||participants.some(v=>v.length>100))throw new Error('Bitte höchstens 300 Teilnehmende mit jeweils maximal 100 Zeichen angeben.');
 const timeZone=typeof body.TRIP_TIMEZONE==='string'?body.TRIP_TIMEZONE:'Europe/Berlin';try{new Intl.DateTimeFormat('de-DE',{timeZone});}catch{throw new Error('Die Zeitzone ist ungültig.');}
 return {id:'pac-'+crypto.randomUUID(),title,startDate,endDate,origin,destination,website:'',timeZone,participants,mapProvider:'openstreetmap'};
}
export async function initializeTrip(config,trip,cloud=new NextcloudStorage(config),timeSlots=dayTimeSlots({})){
 const existing=await cloud.readText('calendar:snapshot');
 if(existing.value!==null){
  if(trip)throw new Error('In diesem Wolke-Ordner liegt bereits eine Reise. Wähle „Vorhandene Reise übernehmen“ oder einen anderen Wolke-Ordner.');
  let saved;try{saved=JSON.parse(existing.value);}catch{throw new Error('Die vorhandenen Reisedaten sind ungültig. Bitte die Wolke-Sicherung prüfen.');}
  if(!saved?.trip||!Array.isArray(saved.calendar?.days)||!Array.isArray(saved.calendar?.events)||!saved.routes||!saved.materials||!saved.journeys)throw new Error('Die vorhandenen Reisedaten sind unvollständig. Bitte die Wolke-Sicherung prüfen.');
  return {mode:'existing',trip:saved.trip};
 }
 if(!trip)throw new Error('In diesem Wolke-Ordner wurde keine Reise gefunden. Wähle „Neue Reise anlegen“ oder prüfe den Ordner.');
 const days=[];for(let day=Date.parse(trip.startDate);day<=Date.parse(trip.endDate);day+=86400000)days.push({isoDate:new Date(day).toISOString().slice(0,10)});
 const snapshot={trip,calendar:{schemaVersion:2,days,timeSlots,events:[],publishedAt:new Date().toISOString()},routes:{},materials:{},journeys:{}};
 try{await cloud.writeText('calendar:snapshot',JSON.stringify(snapshot),null);}catch(error){if(error instanceof StorageConflict)throw new Error('Die Wolken-Reise wurde inzwischen angelegt. Bitte „Vorhandene Reise übernehmen“ wählen.');throw error;}
 return {mode:'new',trip};
}
export async function probe(config){
 const cloud=new NextcloudStorage(config),parts=['text','setup-probe-'+crypto.randomUUID()],value=crypto.randomUUID();let created=false;
 await cloud.ensureBase();
 try{
  const put=await cloud.success(await cloud.request('PUT',parts,value,{'content-type':'text/plain','if-none-match':'*'}));created=true;await put.body?.cancel();
  const get=await cloud.success(await cloud.request('GET',parts));if(await get.text()!==value)throw new Error('Cloud round trip failed');
 }finally{if(created){const response=await cloud.request('DELETE',parts);if(response.status!==404)await cloud.success(response);await response.body?.cancel();}}
}
export async function finishSetup(request,portal,checkOnly=false){
 const url=new URL(request.url),env=portal.baseEnv;
 if(request.method!=='POST')return json({error:'Methode nicht erlaubt.'},405);
 // Consume a bounded request body before any early response. This also avoids
 // forwarding a live body across the Worker/DO boundary after its request ends.
 if(Number(request.headers.get('content-length'))>16384)return json({error:'Anfrage zu groß.'},413);
 let raw='';const reader=request.body?.getReader();
 if(reader){const decoder=new TextDecoder();let count=0;try{while(true){const part=await reader.read();if(part.done)break;count+=part.value.byteLength;if(count>16384){await reader.cancel();return json({error:'Anfrage zu groß.'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}catch{return json({error:'Die Anfrage wurde unterbrochen. Bitte erneut versuchen.'},400);}}
 if(request.headers.get('origin')!==url.origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Ungültiger Ursprung.'},403);
 if(portal.configured())return json({error:'PAC ist bereits eingerichtet. Die Ersteinrichtung ist geschlossen.'},409);
 const secret=env.PAC_SETUP_SECRET;
 if(typeof secret!=='string'||secret.length<32||!equal(request.headers.get('authorization')||'','Bearer '+secret))return json({error:'Öffne deinen persönlichen Einrichtungslink aus dem Installer.'},403);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'Ungültige Formulardaten.'},400);}
 let config,trip,timeSlots;try{config=validateSetup(body);trip=validateTrip(body);timeSlots=dayTimeSlots(body);}catch(error){return json({error:error.message==='Nextcloud-Konfiguration ist ungültig.'?'Prüfe die HTTPS-WebDAV-Adresse und den Wolke-Ordner (ein einzelner Name ohne Schrägstriche).':error.message},400);}
 try{await (env.probeSetupStorage||probe)(config);}catch{return json({error:'Die Wolke konnte nicht gelesen und beschrieben werden. Prüfe WebDAV-Adresse, Benutzername, App-Passwort und Schreibrechte. Es wurde noch keine Einrichtung gespeichert.'},422);}
 if(checkOnly)return json({checked:true,message:'Die Wolke kann gelesen und beschrieben werden. Es wurde noch keine Reise eingerichtet.'});
 try{await initializeTrip(config,trip,env.cloudStorage,timeSlots);}catch(error){const known=/^(In diesem Wolke-Ordner|Die vorhandenen Reisedaten|Die Wolken-Reise)/.test(error.message);return json({error:known?error.message:'Die Reisedaten konnten nicht in der Wolke gespeichert werden. Prüfe Verbindung und Schreibrechte.'},409);}
 try{await portal.state.storage.put('configuration:v1',await sealConfiguration(config,secret));}catch{return json({error:'Die Einrichtung konnte nicht gespeichert werden. Bitte erneut versuchen.'},503);}
 portal.env={...config,...env};portal.cloud=env.cloudStorage||null;portal.owner.env=portal.env;portal.owner.cloud=portal.cloud;portal.invalidateSnapshot();
 const response=json({ready:true,url:'/'});
 response.headers.set('set-cookie','profilreise_session='+await createSession(await portal.participantCredential())+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600');
 return response;
}
export const setupScript=`
const form=document.querySelector('form'),message=document.querySelector('#message'),button=form.querySelector('button[type=submit]');
form.addEventListener('toggle',event=>{if(event.target.matches?.('.cloud-video-help')&&!event.target.open)event.target.querySelector('video')?.pause();},true);
form.addEventListener('play',event=>{if(event.target.matches?.('video'))for(const video of form.querySelectorAll('video'))if(video!==event.target)video.pause();},true);
const mode=form.elements.TRIP_MODE,tripFields=document.querySelector('#trip-fields');
function applyMode(){tripFields.hidden=mode.value==='existing';tripFields.disabled=mode.value==='existing';}
mode.addEventListener('change',applyMode);applyMode();
const start=form.elements.TRIP_START,end=form.elements.TRIP_END;
start.addEventListener('change',()=>{
 end.min=start.value;
 if(start.value&&(!end.value||end.value<start.value))end.value=start.value;
});
for(const input of [start,end])input.addEventListener('click',()=>{try{input.showPicker?.();}catch{}});
for(const toggle of form.querySelectorAll('[data-password]'))toggle.addEventListener('click',()=>{
 const input=form.elements[toggle.dataset.password],visible=input.type==='password';
 input.type=visible?'text':'password';
 toggle.textContent=visible?'Verbergen':'Anzeigen';
 toggle.setAttribute('aria-pressed',String(visible));
 toggle.setAttribute('aria-label',input.dataset.label+(visible?' verbergen':' anzeigen'));
});
form.elements.TRIP_TIMEZONE.value=Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Berlin';
const setupParams=new URLSearchParams(location.hash.slice(1));
form.elements.TRIP_TITLE.value=setupParams.get('title')||'';
let token=setupParams.get('token')||'';
if(location.hash)history.replaceState(null,'','/setup');
if(!token){message.textContent='Öffne den persönlichen Einrichtungslink auf der Erfolgsseite des Installers. Ohne ihn kann die Einrichtung nicht abgeschlossen werden.';button.disabled=true;}
const navigation=document.querySelector('#setup-navigation');
const wizardEnabled=Boolean(navigation?.querySelector);
let setupStep=0,cloudChecked=false;
const steps=['Reise festlegen','PAC-Passwörter festlegen','Wolke verbinden'];
function showSetupStep(index){
 setupStep=index;
 for(const group of form.querySelectorAll('[data-setup-step]'))group.hidden=Number(group.dataset.setupStep)!==index||(group.id==='trip-fields'&&mode.value==='existing');
 const progress=document.querySelector('#setup-progress');progress.hidden=false;progress.textContent='Schritt '+(index+1)+' von 3 · '+steps[index];
 document.querySelector('#setup-back').hidden=index===0;
 document.querySelector('#setup-next').hidden=index===2;
 document.querySelector('#setup-check').hidden=index!==2;
 button.hidden=index!==2;button.disabled=!token||!cloudChecked;
 progress.focus();
}
function validateSetupFields(currentOnly=false){
 for(const group of form.querySelectorAll('[data-setup-step]')){
  if(group.disabled||(currentOnly&&Number(group.dataset.setupStep)!==setupStep))continue;
  for(const field of group.querySelectorAll('input,select,textarea'))if(!field.checkValidity()){
   if(wizardEnabled)showSetupStep(Number(group.dataset.setupStep));field.reportValidity();return false;
  }
 }
 const fields=form.elements;
 for(const [name,original] of [['confirmPortal','PORTAL_PASSWORD'],['confirmAdmin','ADMIN_PASSWORD']]){
  const field=fields[name];field.setCustomValidity(field.value===fields[original].value?'':'Die Passwort-Wiederholung stimmt nicht überein.');
  if((!currentOnly||setupStep===1)&&!field.checkValidity()){if(wizardEnabled)showSetupStep(1);field.reportValidity();return false;}
 }
 fields.ADMIN_PASSWORD.setCustomValidity(fields.ADMIN_PASSWORD.value===fields.PORTAL_PASSWORD.value?'Bitte ein anderes Passwort als für Teilnehmende verwenden.':'');
 if((!currentOnly||setupStep===1)&&!fields.ADMIN_PASSWORD.checkValidity()){if(wizardEnabled)showSetupStep(1);fields.ADMIN_PASSWORD.reportValidity();return false;}
 return true;
}
if(wizardEnabled){
 navigation.hidden=false;form.noValidate=true;
 document.querySelector('#setup-back').addEventListener('click',()=>showSetupStep(setupStep-1));
 document.querySelector('#setup-next').addEventListener('click',()=>{if(validateSetupFields(true))showSetupStep(setupStep+1);});
 function setupChanged(){
  cloudChecked=false;button.disabled=true;
  message.textContent='';
  for(const name of ['confirmPortal','confirmAdmin','ADMIN_PASSWORD'])form.elements[name].setCustomValidity('');
 }
 form.addEventListener('input',setupChanged);form.addEventListener('change',setupChanged);
 document.querySelector('#setup-check').addEventListener('click',async()=>{
  if(!token||!validateSetupFields())return;
  const check=document.querySelector('#setup-check');check.disabled=true;message.textContent='Wolke-Verbindung wird geprüft …';
  const payload=JSON.stringify(Object.fromEntries(new FormData(form)));
  let unchanged=true;const invalidate=()=>{unchanged=false;cloudChecked=false;};form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
  try{
   const response=await fetch('/api/setup/check',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:payload});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Wolke-Prüfung ist fehlgeschlagen.');
   cloudChecked=unchanged;message.textContent=unchanged?data.message+' Klicke jetzt auf „Einrichtung abschließen“.' : 'Die Eingaben wurden während der Prüfung geändert. Bitte erneut prüfen.';
  }catch(error){cloudChecked=false;message.textContent=error.message;}
  finally{form.removeEventListener('input',invalidate);form.removeEventListener('change',invalidate);check.disabled=false;button.disabled=!cloudChecked;}
 });
 showSetupStep(0);
}
form.addEventListener('submit',async event=>{
 event.preventDefault();
 if(wizardEnabled&&setupStep<2){if(validateSetupFields(true))showSetupStep(setupStep+1);return;}
 if(button.disabled||!validateSetupFields())return;button.disabled=true;message.textContent='Wolke wird geprüft und Einrichtung gespeichert …';
 const body=Object.fromEntries(new FormData(form));form.inert=true;
 try{const response=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Einrichtung ist fehlgeschlagen.');token='';form.reset();message.textContent='Einrichtung abgeschlossen.';form.hidden=true;const success=document.querySelector('#setup-success');success.hidden=false;success.focus();}
 catch(error){message.textContent=error.message;button.disabled=false;}
 finally{form.inert=false;}
});`;
export function onboardingResponse(request){
 const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src https://pac-install.linusleupold.workers.dev; img-src https://pac-install.linusleupold.workers.dev; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 if(new URL(request.url).pathname==='/setup.js')return new Response(request.method==='HEAD'?null:setupScript,{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
 const field=(name,label,type='text',hint='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required '+(type==='password'?'autocomplete="new-password"':'autocomplete="off"')+' '+(name.includes('PORTAL')||name.includes('ADMIN')||name.startsWith('confirm')?'minlength="6"':'')+' data-label="'+label+'" id="'+name+'">'+(type==='password'?'<button class="password-toggle" type="button" data-password="'+name+'" aria-controls="'+name+'" aria-label="'+label+' anzeigen" aria-pressed="false">Anzeigen</button>':'')+'</label>'+(hint?'<p class="hint">'+hint+'</p>':'');
 const cloudTutorial='<section class="cloud-tutorial" aria-labelledby="cloud-help"><h2 id="cloud-help">Wolke verbinden</h2><a class="cloud-link" href="https://s5813.schuldock.de/iserv/cloudfiles/" target="_blank" rel="noopener noreferrer">Beispiel: Christianeum-Wolke öffnen ↗</a><p class="hint">PAC funktioniert auch mit anderen Nextcloud-Zugängen. Öffne dafür die Wolke deiner Schule oder deines Anbieters. Am Christianeum kannst du den Beispiellink verwenden. Deine Eingaben bleiben hier erhalten. Bei den Feldern findest du bei Bedarf eine kurze Videoanleitung.</p></section>';
 const webdavVideo='<details class="cloud-video-help"><summary>Video: WebDAV-Adresse finden<span class="cloud-video-duration">0:18</span></summary><div class="cloud-video-help-body"><video class="cloud-video" controls playsinline preload="none" width="1440" height="900" poster="https://pac-install.linusleupold.workers.dev/tutorials/webdav.jpg?v=2" aria-label="WebDAV-Adresse finden" src="https://pac-install.linusleupold.workers.dev/tutorials/webdav.mp4?v=2">Ihr Browser unterstützt dieses Video nicht. <a href="https://pac-install.linusleupold.workers.dev/tutorials/webdav.mp4?v=2">Video herunterladen</a></video><ol class="tutorial-steps"><li>In IServ die <strong>Wolke</strong> öffnen.</li><li>Unten links <strong>Dateien-Einstellungen</strong> wählen und zu <strong>WebDAV</strong> wechseln.</li><li>Die Adresse über das Kopiersymbol kopieren und in das Feld <strong>WebDAV-Adresse</strong> einfügen.</li></ol></div></details>';
 const passwordVideo='<details class="cloud-video-help"><summary>Video: App-Passwort erstellen<span class="cloud-video-duration">0:30</span></summary><div class="cloud-video-help-body"><video class="cloud-video" controls playsinline preload="none" width="1440" height="900" poster="https://pac-install.linusleupold.workers.dev/tutorials/app-password.jpg?v=2" aria-label="App-Passwort erstellen" src="https://pac-install.linusleupold.workers.dev/tutorials/app-password.mp4?v=2">Ihr Browser unterstützt dieses Video nicht. <a href="https://pac-install.linusleupold.workers.dev/tutorials/app-password.mp4?v=2">Video herunterladen</a></video><ol class="tutorial-steps"><li>In der Wolke das Profil öffnen und <strong>Persönliche Einstellungen → Sicherheit</strong> wählen.</li><li>Unter <strong>Geräte &amp; Sitzungen</strong> den App-Namen „PAC“ eintragen und ein App-Passwort erstellen.</li><li>Den angezeigten <strong>Benutzernamen</strong> und das <strong>App-Passwort</strong> kopieren und in die passenden Felder im Setup einfügen.</li></ol></div></details>';
 const hourSelect=(name,label,from,to,selected)=>'<label>'+label+'<select name="'+name+'">'+Array.from({length:to-from+1},(_,i)=>'<option'+(from+i===selected?' selected':'')+'>'+hour(from+i)+'</option>').join('')+'</select></label>';
 const html='<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PAC einrichten</title><script src="/setup.js" defer></script><style>body{font:16px/1.5 system-ui,sans-serif;background:#fbfcfa;color:#171816;max-width:640px;margin:48px auto;padding:0 24px}h1{font-size:32px}fieldset{border:0;padding:0;margin:28px 0}legend{font-size:20px;font-weight:650;margin-bottom:12px}label{display:block;margin-top:16px}input,textarea,select{box-sizing:border-box;display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #bfc3bb;border-radius:4px;font:inherit}button{padding:13px 20px;background:#33372f;color:white;border:0;border-radius:4px;font:inherit;cursor:pointer}.date-range{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.date-range input{min-width:0;cursor:pointer}label:has(.password-toggle){position:relative}label:has(.password-toggle) input{padding-right:100px}.password-toggle{position:absolute;right:4px;bottom:4px;padding:9px 10px;background:transparent;color:#33372f;font-size:14px;text-decoration:underline}input:focus-visible,button:focus-visible{outline:2px solid #33372f;outline-offset:2px}@media(max-width:380px){.date-range{grid-template-columns:1fr;gap:0}}.cloud-video{display:block;width:100%;height:auto;aspect-ratio:8/5;background:#111;border:1px solid var(--line,#d6d9d2);border-radius:8px}.cloud-video-help{margin:8px 0 20px;padding:0;border:0;color:inherit}.cloud-video-help>summary{cursor:pointer;font-size:14px;font-weight:600;line-height:1.5;padding:8px 0}.cloud-video-help>summary:focus-visible{outline:2px solid currentColor;outline-offset:4px}.cloud-video-duration{float:right;font-size:12px;font-weight:400;color:var(--muted,#676a64);font-variant-numeric:tabular-nums;margin-left:12px}.cloud-video-help-body{padding-top:8px}.tutorial-steps{padding-left:20px;margin:20px 0 0;font-size:15px;line-height:1.65}.tutorial-steps li{padding-left:4px;margin:0 0 12px}.cloud-video-help .tutorial-steps{font-size:14px;margin-top:14px}.cloud-tutorial{margin:8px 0 24px}.cloud-tutorial h2{font-size:18px;margin:0 0 12px}.cloud-link{display:inline-block;padding:10px 14px;border:1px solid #bfc3bb;border-radius:4px;color:inherit;text-decoration:none;font-weight:600}.cloud-link:hover{background:#eef0eb}.cloud-tutorial a{overflow-wrap:anywhere}button:disabled{opacity:.5;cursor:default}.hint{font-size:14px;color:#676a64;margin:6px 0}.setup-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:24px}.setup-actions #setup-navigation:not([hidden]){display:contents}.setup-actions button{box-sizing:border-box;min-height:46px;padding:10px 16px;border:1px solid #33372f}.setup-actions #setup-back,.setup-actions #setup-check{background:transparent;color:#33372f;border-color:#bfc3bb}.setup-actions #setup-back:hover,.setup-actions #setup-check:hover{background:#eef0eb}.setup-actions button[type=submit]{margin-left:auto}.setup-actions button:disabled{cursor:default}@media(max-width:600px){.setup-actions{flex-direction:column;align-items:stretch}.setup-actions button{width:100%}.setup-actions button[type=submit]{margin-left:0}}#message{margin:18px 0;font-size:14px;line-height:1.6}#message:empty{display:none}</style><main><h1>PAC einrichten</h1><p>Lege deine Zugänge fest und verbinde deine Wolke. Danach kannst du PAC direkt verwenden.</p><form novalidate><p id="setup-progress" role="status" tabindex="-1" hidden></p><fieldset data-setup-step="0"><legend>Deine Reise</legend><label>Reise einrichten<select name="TRIP_MODE"><option value="new">Neue Reise anlegen</option><option value="existing">Vorhandene Reise aus der Wolke übernehmen</option></select></label><p class="hint">Vorhandene Reisen werden nicht überschrieben. Wähle für eine neue Reise einen eigenen Wolke-Ordner.</p></fieldset><fieldset id="trip-fields" data-setup-step="0"><legend>Reisedaten</legend>'+field('TRIP_TITLE','Reisetitel')+'<div class="date-range">'+field('TRIP_START','Von','date')+field('TRIP_END','Bis','date')+'</div><div class="date-range">'+hourSelect('TRIP_DAY_START','Tagesbeginn',0,21,8)+hourSelect('TRIP_DAY_END','Tagesende',2,23,21)+'</div><p class="hint">Zeitraum, den der Kalender pro Tag anzeigt. Später in den Einstellungen änderbar.</p>'+field('TRIP_ORIGIN','Startort')+field('TRIP_DESTINATION','Reiseziel')+'<label>Teilnehmende<textarea name="TRIP_PARTICIPANTS" rows="5" maxlength="12000"></textarea></label><p class="hint">Eine Person pro Zeile. Kann zunächst leer bleiben.</p><input name="TRIP_TIMEZONE" type="hidden" value="Europe/Berlin"></fieldset><fieldset data-setup-step="1"><legend>PAC-Passwörter</legend><p class="hint">Diese beiden Passwörter gelten nur für PAC. Sie sind unabhängig von deinem Schul- oder Cloudflare-Passwort.</p>'+field('PORTAL_PASSWORD','Passwort für Teilnehmende','password')+field('confirmPortal','Portalpasswort wiederholen','password')+field('ADMIN_PASSWORD','Passwort für die Reiseleitung','password','Mindestens 6 Zeichen; ein anderes Passwort als für Teilnehmende verwenden.')+field('confirmAdmin','Adminpasswort wiederholen','password')+'</fieldset><fieldset data-setup-step="2"><legend>Deine Wolke</legend>'+cloudTutorial+field('NEXTCLOUD_WEBDAV_URL','WebDAV-Adresse','url','In Nextcloud unter Dateien → Dateieinstellungen kopieren. Beispiel: https://wolke.example/remote.php/dav/files/dein-benutzer/')+webdavVideo+field('NEXTCLOUD_USERNAME','App-Benutzername')+field('NEXTCLOUD_APP_PASSWORD','App-Passwort','password','Ein App-Passwort in den persönlichen Nextcloud-Sicherheitseinstellungen erzeugen.')+passwordVideo+field('NEXTCLOUD_ROOT','Wolke-Ordner','text','Ein einzelner Ordnername, z. B. PAC. Bei einer bestehenden Reise denselben Ordner weiterverwenden.')+'</fieldset><p class="hint">Die Zugangsdaten werden verschlüsselt in deinem eigenen Cloudflare-Konto gespeichert. Reiseinhalte bleiben in deiner Wolke. Bei der Wolke-Prüfung und beim Abschließen prüft PAC den Lese- und Schreibzugriff mit einer temporären Testdatei und entfernt sie wieder.</p><div class="setup-actions"><div id="setup-navigation" hidden><button type="button" id="setup-back">Zurück</button> <button type="button" id="setup-next">Weiter</button> <button type="button" id="setup-check" hidden>Wolke-Verbindung prüfen</button></div><button type="submit">Einrichtung abschließen</button></div><p id="message" role="status" aria-live="polite"></p></form><section id="setup-success" hidden tabindex="-1"><h2>Dein PAC ist eingerichtet</h2><p>Bereite jetzt den Reiseplan für deine Gruppe vor.</p><ol><li>Öffne die Verwaltung und melde dich mit dem gerade festgelegten Passwort für die Reiseleitung an.</li><li>Lege den ersten Termin an und speichere ihn im Entwurf.</li><li>Ergänze unter Einstellungen die Teilnehmenden. Lade Dateien am passenden Termin im Reiseplan hoch.</li><li>Klicke in der Verwaltung auf „Änderungen veröffentlichen“ und prüfe den Reiseplan.</li><li>Teile die normale PAC-Adresse und das Teilnehmerpasswort mit deiner Gruppe. Teile niemals den persönlichen Einrichtungslink.</li></ol><p><a href="/admin">Reiseplan als Reiseleitung vorbereiten</a></p><p><a href="/">Teilnehmeransicht öffnen</a></p></section></main></html>';
 return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
}
