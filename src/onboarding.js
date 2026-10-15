import {createSession} from './legacy/_middleware.js';
import {NextcloudStorage} from './nextcloud.js';
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
 if(config.PORTAL_PASSWORD.length<12||config.ADMIN_PASSWORD.length<12)throw new Error('Portal- und Adminpasswort müssen jeweils mindestens 12 Zeichen lang sein.');
 if(config.PORTAL_PASSWORD===config.ADMIN_PASSWORD)throw new Error('Verwende unterschiedliche Portal- und Adminpasswörter.');
 if(body.confirmPortal!==config.PORTAL_PASSWORD||body.confirmAdmin!==config.ADMIN_PASSWORD)throw new Error('Die Passwort-Wiederholungen stimmen nicht überein.');
 const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 config.SESSION_SECRET=token();config.CALENDAR_FEED_SECRET=token();
 // Use the same validation rules as normal operation before touching the cloud.
 new NextcloudStorage(config);return config;
}
async function probe(config){
 const cloud=new NextcloudStorage(config),parts=['text','setup-probe-'+crypto.randomUUID()],value=crypto.randomUUID();let created=false;
 await cloud.ensureBase();
 try{
  const put=await cloud.success(await cloud.request('PUT',parts,value,{'content-type':'text/plain','if-none-match':'*'}));created=true;await put.body?.cancel();
  const get=await cloud.success(await cloud.request('GET',parts));if(await get.text()!==value)throw new Error('Cloud round trip failed');
 }finally{if(created){const response=await cloud.request('DELETE',parts);if(response.status!==404)await cloud.success(response);await response.body?.cancel();}}
}
export async function finishSetup(request,portal){
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
 let config;try{config=validateSetup(body);}catch(error){return json({error:error.message==='Nextcloud-Konfiguration ist ungültig.'?'Prüfe die HTTPS-WebDAV-Adresse und den Wolke-Ordner (ein einzelner Name ohne Schrägstriche).':error.message},400);}
 try{await (env.probeSetupStorage||probe)(config);}catch{return json({error:'Die Wolke konnte nicht gelesen und beschrieben werden. Prüfe WebDAV-Adresse, Benutzername, App-Passwort und Schreibrechte. Es wurde noch keine Einrichtung gespeichert.'},422);}
 try{await portal.state.storage.put('configuration:v1',await sealConfiguration(config,secret));}catch{return json({error:'Die Einrichtung konnte nicht gespeichert werden. Bitte erneut versuchen.'},503);}
 portal.env={...config,...env};portal.cloud=null;portal.configurationLoaded=true;
 const response=json({ready:true,url:'/'});
 response.headers.set('set-cookie','profilreise_session='+await createSession(portal.env.SESSION_SECRET)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000');
 return response;
}
export const setupScript=`
const form=document.querySelector('form'),message=document.querySelector('#message'),button=form.querySelector('button');
let token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
if(location.hash)history.replaceState(null,'','/setup');
if(!token){message.textContent='Öffne den persönlichen Einrichtungslink auf der Erfolgsseite des Installers. Ohne ihn kann die Einrichtung nicht abgeschlossen werden.';button.disabled=true;}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;button.disabled=true;message.textContent='Wolke wird geprüft und Einrichtung gespeichert …';
 const body=Object.fromEntries(new FormData(form));
 try{const response=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Einrichtung ist fehlgeschlagen.');token='';form.reset();message.textContent='Einrichtung abgeschlossen. PAC wird geöffnet …';location.replace('/');}
 catch(error){message.textContent=error.message;button.disabled=false;}
});`;
export function onboardingResponse(request){
 const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 if(new URL(request.url).pathname==='/setup.js')return new Response(request.method==='HEAD'?null:setupScript,{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
 const field=(name,label,type='text',hint='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" required '+(type==='password'?'autocomplete="new-password"':'autocomplete="off"')+' '+(name.includes('PORTAL')||name.includes('ADMIN')||name.startsWith('confirm')?'minlength="12"':'')+'></label>'+(hint?'<p class="hint">'+hint+'</p>':'');
 const html='<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PAC einrichten</title><script src="/setup.js" defer></script><style>body{font:16px/1.5 system-ui,sans-serif;background:#fbfcfa;color:#171816;max-width:640px;margin:48px auto;padding:0 24px}h1{font-size:32px}fieldset{border:0;padding:0;margin:28px 0}legend{font-size:20px;font-weight:650;margin-bottom:12px}label{display:block;margin-top:16px}input{box-sizing:border-box;display:block;width:100%;padding:12px;margin-top:6px;border:1px solid #bfc3bb;border-radius:4px;font:inherit}button{padding:13px 20px;background:#33372f;color:white;border:0;border-radius:4px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.hint{font-size:14px;color:#676a64;margin:6px 0}#message{margin:18px 0}</style><main><h1>PAC einrichten</h1><p>Lege deine Zugänge fest und verbinde deine Wolke. Danach kannst du PAC direkt verwenden.</p><form><fieldset><legend>Portal-Zugänge</legend>'+field('PORTAL_PASSWORD','Passwort für Teilnehmende','password')+field('confirmPortal','Portalpasswort wiederholen','password')+field('ADMIN_PASSWORD','Passwort für die Reiseleitung','password','Mindestens 12 Zeichen; ein anderes Passwort als für Teilnehmende verwenden.')+field('confirmAdmin','Adminpasswort wiederholen','password')+'</fieldset><fieldset><legend>Deine Wolke</legend>'+field('NEXTCLOUD_WEBDAV_URL','WebDAV-Adresse','url','In Nextcloud unter Dateien → Dateieinstellungen kopieren. Beispiel: https://wolke.example/remote.php/dav/files/dein-benutzer/')+field('NEXTCLOUD_USERNAME','Wolke-Benutzername')+field('NEXTCLOUD_APP_PASSWORD','Wolke-App-Passwort','password','Ein App-Passwort in den persönlichen Nextcloud-Sicherheitseinstellungen erzeugen.')+field('NEXTCLOUD_ROOT','Wolke-Ordner','text','Ein einzelner Ordnername, z. B. PAC. Bei einer bestehenden Reise denselben Ordner weiterverwenden.')+'</fieldset><p class="hint">Die Zugangsdaten werden verschlüsselt in deinem eigenen Cloudflare-Konto gespeichert. Reiseinhalte bleiben in deiner Wolke. Beim Abschließen prüft PAC den Lese- und Schreibzugriff mit einer temporären Testdatei und entfernt sie wieder.</p><button type="submit">Einrichtung abschließen</button><p id="message" role="status" aria-live="polite"></p></form></main></html>';
 return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
}
