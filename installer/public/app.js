const base=location.pathname.startsWith('/install/')?'/install':'';
const $=selector=>document.querySelector(selector);
let csrf='',timer,busy=false,configured=false,pacsRequest=0;
async function api(path,body){
 const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify({...body,csrf}):undefined,cache:'no-store'});
 let data;try{data=await response.json();}catch{const error=new Error(response.ok?'Unerwartete Antwort. Bitte die Seite neu laden.':'Der Installer ist gerade nicht erreichbar (HTTP '+response.status+'). Bitte kurz warten und neu laden.');error.status=response.status;throw error;}
 if(!response.ok){const error=new Error(data.error||'Die Anfrage ist fehlgeschlagen.');error.status=response.status;throw error;}return data;
}
function error(message){$('#error').textContent=message;$('#error').hidden=false;}
const pacPattern=/^pac-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function storedTarget(){try{return sessionStorage.getItem('pac-update-target')||'';}catch{return '';}}
function rememberTarget(name){try{name?sessionStorage.setItem('pac-update-target',name):sessionStorage.removeItem('pac-update-target');}catch{}}
{const requested=new URL(location.href).searchParams.get('update');if(requested!==null){rememberTarget(pacPattern.test(requested)&&requested.length<=63&&requested!=='pac-install'?requested:'');const clean=new URL(location.href);clean.searchParams.delete('update');history.replaceState(null,'',clean.pathname+clean.search);}}
let updateTarget=storedTarget(),latestVersion=null,latestNotes=null,releaseUrl=null;
function show(view){for(const name of ['start','account','progress','result','updated'])$('#'+name+'-view').hidden=name!==view;}
// The left panel tells where the user stands; step is 0-based, step===steps.length means all done.
const flows={
 install:['Bei Cloudflare anmelden','Konto und Reisenamen wählen','PAC bereitstellen','Passwörter festlegen und Wolke verbinden'],
 update:['Bei Cloudflare anmelden','PAC auswählen','Neue Version hochladen','Aktivierung bestätigen']
};
const intros={
 start:{flow:'install',step:0,eyebrow:'Neues PAC',title:['Ihr Reiseplan.','Ihr PAC.'],text:'Richten Sie PAC in Ihrem eigenen Cloudflare-Konto ein. Kalender, Dateien und Notizen bleiben in Ihrer Wolke.',detail:'Sie kommen nach der Cloudflare-Anmeldung automatisch zurück.',aside:'Benötigt: Cloudflare-Konto und Nextcloud. Kein GitHub.'},
 'update-start':{flow:'update',step:0,eyebrow:'Update',title:['Neue Version.','Gleiche Reise.'],text:'Ihr PAC wird auf den neuesten Stand gebracht. Passwörter, Wolke und Reisedaten bleiben unverändert.',detail:'Melden Sie sich mit dem Cloudflare-Konto an, in dem Ihr PAC liegt.',aside:'Nur der Programmcode wird ersetzt.'},
 account:{flow:'install',step:1,eyebrow:'Neues PAC',title:['Wohin geht','die Reise?'],text:'Geben Sie Ihrer Reise einen Namen. Daraus entsteht die Adresse Ihres PAC.',detail:'Der Name ist öffentlich sichtbar.',aside:'Legt einen neuen Worker an. Je nach Nutzung können Cloudflare-Kosten entstehen.'},
 'update-account':{flow:'update',step:1,eyebrow:'Update',title:['PAC wird gesucht.'],text:'Wählen Sie das PAC, das aktualisiert werden soll.',detail:'Anderes Konto? Rechts umschalten.',aside:'PAC bleibt während des Updates nutzbar.'},
 deploying:{flow:'install',step:2,working:true,eyebrow:'Läuft',title:['Ihr PAC','entsteht.'],text:'Der Installer legt gerade einen Worker in Ihrem Cloudflare-Konto an. Das dauert meist weniger als eine Minute.',detail:'Neuladen ist möglich, der Fortschritt bleibt erhalten.'},
 updating:{flow:'update',step:2,working:true,eyebrow:'Update läuft',title:['Neue Version','wird hochgeladen.'],text:'Der neue Programmcode wird zu Cloudflare übertragen.',detail:'Bitte dieses Fenster geöffnet lassen.',aside:'PAC bleibt während des Updates nutzbar.'},
 activating:{flow:'update',step:3,working:true,eyebrow:'Update läuft',title:['Gleich','ist es so weit.'],text:'Cloudflare verteilt die neue Version.',detail:'Das kann einige Minuten dauern.',aside:'PAC bleibt während des Updates nutzbar.'},
 result:{flow:'install',step:3,eyebrow:'Bereitgestellt',title:['Letzter Schritt:','Ihre Wolke.'],text:'Ihr PAC läuft. Öffnen Sie jetzt den Einrichtungslink, legen Sie Passwörter fest und verbinden Sie Ihre Nextcloud.',detail:'Der Einrichtungslink ist persönlich und wird nach dem Abschluss gesperrt.',aside:''},
 updated:{flow:'update',step:4,eyebrow:'Fertig',title:['Alles aktuell.'],text:'Die neue Version ist aktiv. Bereits geöffnete PAC-Seiten bitte einmal neu laden.',aside:'Frühere Versionen lassen sich bei Cloudflare unter Deployments wiederherstellen.'},
 failed:{flow:'install',step:-1,eyebrow:'Unterbrochen',title:['Da ist etwas','schiefgelaufen.'],text:'Die Einrichtung wurde nicht abgeschlossen. Rechts finden Sie den Grund und wie es weitergeht.',aside:'Bevor Sie neu beginnen, prüfen Sie bei Cloudflare, ob bereits ein Worker angelegt wurde.'}
};
let currentIntro='';
function setIntro(key){
 if(key===currentIntro)return;const intro=intros[key],panel=$('.introduction');currentIntro=key;
 $('#intro-eyebrow').textContent=intro.eyebrow;
 $('#intro-title').replaceChildren(...intro.title.flatMap((line,index)=>index?[document.createElement('br'),line]:[line]));
 $('#intro-text').textContent=intro.text;$('#intro-aside').textContent=intro.aside;
 $('#journey').replaceChildren(...flows[intro.flow].map((title,index)=>{
  const item=document.createElement('li'),dot=document.createElement('span'),label=document.createElement('span');
  const done=index<intro.step,current=index===intro.step;
  item.className=done?'done':current?'current'+(intro.working?' working':''):'';if(current)item.setAttribute('aria-current','step');
  dot.className='dot';dot.textContent=done?'✓':current&&intro.working?'':String(index+1);label.className='title';label.textContent=title;item.append(dot,label);
  if(current&&intro.detail){const detail=document.createElement('span');detail.className='detail';detail.textContent=intro.detail;item.append(detail);}
  return item;
 }));
 panel.classList.remove('changed');void panel.offsetWidth;panel.classList.add('changed');
}
function introFor(data){
 const update=Boolean(updateTarget);
 if(data.stage==='idle'||data.stage==='authorizing')return update?'update-start':'start';
 if(data.stage==='authorized')return update?'update-account':'account';
 if(data.stage==='ready')return 'result';
 if(data.stage==='updated'||data.stage==='failed'||data.stage==='updating'||data.stage==='activating')return data.stage;
 return 'deploying';
}
function apply(data){
 setIntro(introFor(data));document.body.classList.remove('wide');
 $('#update-versions').hidden=!data.targetVersion;$('#update-versions').textContent=data.targetVersion?'Installiert vor dem Update: '+(data.previousVersion||'Nicht ermittelbar')+' → Zielversion: '+data.targetVersion:'';
 clearTimeout(timer);$('#error').hidden=true;$('#retry').hidden=true;$('#recovery').hidden=true;
 if(data.stage==='idle'||data.stage==='authorizing'){
  show('start');$('#start').disabled=!configured;
  $('#availability').textContent=configured?'Die Anmeldung und Freigabe erfolgen direkt bei Cloudflare.':'Die direkte Cloudflare-Anmeldung wird noch freigeschaltet. Bitte später erneut öffnen.';
  $('#update-intro').hidden=!updateTarget;$('#update-intro-name').textContent=updateTarget;$('#start').textContent=updateTarget?'Mit Cloudflare anmelden':'Mit Cloudflare anmelden';return;
 }
 if(data.stage==='authorized'){show('account');setMode('overview');$('#account').replaceChildren(...data.accounts.map(account=>{const option=document.createElement('option');option.value=account.id;option.textContent=account.name;return option;}));loadPacs();return;}
 if(data.stage==='ready'){show('result');$('#result-address').textContent=data.previewUrl;$('#dashboard').href=data.dashboardUrl;$('#preview').href=data.previewUrl;$('#configure').href=data.setupUrl||data.previewUrl;return;}
 if(data.stage==='updated'){rememberTarget('');updateTarget='';show('updated');$('#updated-name').textContent=data.scriptName;for(const [id,url] of [['#updated-admin',data.previewUrl&&data.previewUrl+'/admin'],['#updated-preview',data.previewUrl]]){$(id).hidden=!url;if(url)$(id).href=url;}$('#updated-dashboard').href=data.dashboardUrl;return;}
 if(data.stage==='failed'){rememberTarget('');updateTarget='';show('start');$('#update-intro').hidden=true;error(data.error);$('#recovery').hidden=!data.dashboardUrl;if(data.dashboardUrl){$('#recovery-link').href=data.dashboardUrl;$('#recovery-name').textContent=data.scriptName;}$('#retry').hidden=false;$('#start').disabled=true;return;}
 show('progress');
 const activating=data.stage==='activating';
 $('#progress-heading').textContent=activating||data.stage==='updating'?'Ihr PAC wird aktualisiert':'Ihr PAC wird vorbereitet';
 $('#update-progress').value=activating?2:1;
 $('#update-step').textContent=activating?'Schritt 2 von 3 · Hochgeladen – Aktivierung prüfen':'Schritt 1 von 3 · Hochladen';
 $('#activation-detail').hidden=!activating;
 $('#activation-detail').textContent=activating?(data.activationIssue&&data.activationIssue!=='version-pending'?'Die Versionsprüfung ist gerade nicht erreichbar. Sie wird automatisch wiederholt.':'Die neue Version wurde noch nicht bestätigt. Nächste Prüfung in etwa 10 Sekunden.')+(data.activationCheckedAt?' Zuletzt geprüft: '+new Date(data.activationCheckedAt).toLocaleTimeString('de-DE')+'.':''):'';
 $('#stage').textContent=data.stage==='activating'?'Neue Version von '+data.scriptName+' wird aktiviert. Das kann einige Minuten dauern …':data.stage==='updating'?data.scriptName+' wird auf die neueste Version aktualisiert …':'PAC wird in Ihrem Cloudflare-Konto bereitgestellt …';timer=setTimeout(poll,2500);
}
async function poll(){try{apply(await api('status'));}catch(e){error(e.message);if(e.status===410||e.status===401){show('start');$('#start').disabled=true;$('#retry').hidden=false;}else timer=setTimeout(poll,6000);}}
async function startLogin(event){
 event.preventDefault();if(busy)return;busy=true;$('#start').disabled=true;
 try{const {url}=await api('login',{});const target=new URL(url);if(target.origin!=='https://dash.cloudflare.com')throw new Error('Ungültige Anmeldung.');location.assign(target.href);}catch(e){error(e.message);$('#start').disabled=!configured;busy=false;}
}
$('#setup-form').addEventListener('submit',startLogin);
$('#deploy-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;try{apply(await api('start',{accountId:$('#account').value,tripName:$('#trip-name').value}));}catch(e){error(e.message);}finally{busy=false;}});
async function forget(){if(busy)return;busy=true;++pacsRequest;clearTimeout(timer);try{await api('forget',{});location.assign(base+'/app');}catch(e){if(e.status===410||e.status===401){location.assign(base+'/app');return;}error(e.message);busy=false;}}
// Without a valid session the overview needs a fresh Cloudflare login; the flag skips the extra start click.
function autoLogin(set){try{if(set)sessionStorage.setItem('pac-auto-login','1');else{const value=sessionStorage.getItem('pac-auto-login');sessionStorage.removeItem('pac-auto-login');return value==='1';}}catch{return false;}}
$('#updated-back').addEventListener('click',async()=>{if(busy)return;try{apply(await api('overview',{}));}catch{autoLogin(true);forget();}});
$('#forget').addEventListener('click',forget);$('#updated-forget').addEventListener('click',forget);$('#retry').addEventListener('click',forget);
(async()=>{try{const session=await api('session');csrf=session.csrf;configured=session.configured;const status=await api('status');apply(status);if(autoLogin()&&configured&&status.stage==='idle')$('#setup-form').requestSubmit();if(new URL(location.href).searchParams.get('login')==='invalid'){error('Die Rückkehr von Cloudflare konnte keiner gültigen Anmeldung zugeordnet werden. Bitte erneut anmelden.');history.replaceState(null,'',base+'/app');}}catch(e){error(e.message);$('#retry').hidden=false;}})();

async function loadPacs(){
 const request=++pacsRequest, accountId=$('#account').value;
 $('#pacs-list').replaceChildren();$('#pacs-status').textContent='Vorhandene PACs werden geladen …';
 $('#pacs-refresh').disabled=true;
 try{
  const data=await api('pacs',{accountId});
  if(request!==pacsRequest)return;
  latestVersion=data.latestVersion;latestNotes=data.latestNotes||null;releaseUrl=data.releaseUrl||null;
  const outdated=data.pacs.filter(pac=>pac.updateAvailable).length;
  $('#pacs-status').textContent=!data.pacs.length?'In diesem Konto gibt es noch kein PAC.':(data.pacs.length===1?'1 PAC':data.pacs.length+' PACs')+' in diesem Konto'+(outdated?', '+(outdated===1?'eines kann':outdated+' können')+' aktualisiert werden.':'.');
  for(const pac of data.pacs)$('#pacs-list').append(pacCard(pac));
  const create=document.createElement('li');create.className='pac-card pac-new';
  const createButton=document.createElement('button');createButton.type='button';createButton.innerHTML='<span aria-hidden="true">+</span>Neues PAC erstellen';createButton.addEventListener('click',()=>setMode('create'));
  create.append(createButton);$('#pacs-list').append(create);
  if(updateTarget&&data.pacs.some(pac=>pac.name===updateTarget)){$('#pacs-status').textContent='Bitte die Versionen für '+updateTarget+' prüfen und das Update bestätigen.';return;}
  if(updateTarget)$('#pacs-status').textContent=updateTarget+' wurde in diesem Konto nicht gefunden. Bitte das passende Konto wählen.';
 }catch(e){if(request===pacsRequest)$('#pacs-status').textContent=e.message;}
 finally{if(request===pacsRequest)$('#pacs-refresh').disabled=false;}
}
function pacCard(pac){
 const item=document.createElement('li'),head=document.createElement('div'),name=document.createElement('h3');
 item.className='pac-card';head.className='pac-head';name.textContent=pac.name;head.append(name);
 if(pac.updateAvailable!==null&&pac.updateAvailable!==undefined){const badge=document.createElement('span');badge.className='badge'+(pac.updateAvailable?' badge-update':' badge-current');badge.textContent=pac.updateAvailable?'Update verfügbar':'Aktuell';head.append(badge);}
 item.append(head);
 if(pac.url){const address=document.createElement('p');address.className='pac-url';address.textContent=pac.url.replace('https://','');item.append(address);}
 const versions=document.createElement('dl');versions.className='pac-versions';
 for(const [label,value] of [['Installiert',pac.version],['Verfügbar',latestVersion]]){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value||'nicht ermittelbar';if(!value)detail.className='unknown';versions.append(term,detail);}
 item.append(versions);
 if(pac.updateAvailable){
  const notes=document.createElement('div');notes.className='pac-notes';
  const news=document.createElement('details'),summary=document.createElement('summary');news.className='pac-changelog';summary.textContent='Neu in '+(/^v\d+\.\d+\.\d+$/.test(latestVersion||'')?latestVersion:'dieser Version');news.append(summary);
  if(latestNotes){const list=document.createElement('p');list.className='pac-notes-text';list.textContent=latestNotes.replace(/^\s*[-*]\s+/gm,'• ').replace(/^#+\s*/gm,'');news.append(list);}
  if(releaseUrl){const more=document.createElement('a');more.href=releaseUrl;more.target='_blank';more.rel='noopener noreferrer';more.textContent='Alle Hinweise auf GitHub ↗';const line=document.createElement('p');line.append(more);news.append(line);}
  if(latestNotes||releaseUrl)notes.append(news);
  const notice=document.createElement('p');notice.textContent='Passwörter, Wolke und Reisedaten bleiben erhalten. PAC bleibt währenddessen nutzbar, danach geöffnete Seiten neu laden.';
  notes.append(notice);item.append(notes);
 }
 const actions=document.createElement('div');actions.className='pac-actions';
 for(const [title,url,primary] of [['Öffnen',pac.url,true],['Admin',pac.url?pac.url+'/admin':null],['Cloudflare',pac.dashboardUrl]]){
  if(!url)continue;const link=document.createElement('a');link.textContent=title+' ↗';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.className=primary?'button small':'quiet';actions.append(link);
 }
 if(pac.url){const share=document.createElement('button');share.type='button';share.className='share-button';share.title='Teilen';share.setAttribute('aria-label',pac.name+' teilen');share.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';share.addEventListener('click',()=>openShare(pac));head.append(share);}
 const remove=document.createElement('button');remove.type='button';remove.className='secondary delete-pac danger';remove.textContent='Löschen';remove.setAttribute('aria-label',pac.name+' endgültig löschen');remove.addEventListener('click',()=>openDelete(pac));actions.append(remove);
 item.append(actions);
 if(pac.updateAvailable){const update=document.createElement('button');update.type='button';update.className='update-now';update.textContent='Jetzt aktualisieren';update.addEventListener('click',()=>startUpdate(pac.name));item.append(update);}
 return item;
}
// Three explicit confirmations; the server binds the last one to this account and PAC.
let deleting=null,deleteStep=0,deleteToken='',deleteSubmitting=false;
function openDelete(pac){
 if(busy)return;
 busy=true;deleting={name:pac.name,accountId:$('#account').value};deleteStep=0;deleteToken='';
 $('#delete-input').value='';$('#delete-name').textContent=pac.name;
 renderDeleteStep();
}
function renderDeleteStep(){
 const dialog=$('#delete-dialog');
 $('#delete-title').textContent=['PAC endgültig löschen?','Löschen bestätigen','Letzte Bestätigung'][deleteStep];
 $('#delete-description').textContent=[
  'Schritt 1 von 3: Möchten Sie dieses PAC wirklich unwiderruflich löschen? Es gibt keine Möglichkeit, diesen Vorgang rückgängig zu machen.',
  'Schritt 2 von 3: Tippen Sie zur Bestätigung den unten angezeigten PAC-Namen exakt ab.',
  'Schritt 3 von 3: Soll dieses PAC jetzt endgültig gelöscht werden? Auch die gespeicherten Zugangsdaten und Einstellungen dieses PAC gehen verloren.'
 ][deleteStep];
 $('#delete-name-field').hidden=deleteStep!==1;$('#delete-input').required=deleteStep===1;
 $('#delete-error').hidden=true;$('#delete-next').textContent=deleteStep===2?'Jetzt unwiderruflich löschen':'Weiter';
 $('#delete-next').disabled=deleteStep===1&&$('#delete-input').value!==deleting.name;
 if(dialog.open)dialog.close();dialog.showModal();
 if(deleteStep===1)$('#delete-input').focus();else $('#delete-cancel').focus();
}
function cancelDelete(){if(deleteSubmitting)return;$('#delete-dialog').close();deleting=null;deleteToken='';busy=false;}
$('#delete-cancel').addEventListener('click',cancelDelete);
$('#delete-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelDelete();});
$('#delete-input').addEventListener('input',()=>{$('#delete-next').disabled=!deleting||$('#delete-input').value!==deleting.name;});
$('#delete-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!deleting||deleteSubmitting)return;
 if(deleteStep===0){deleteStep=1;renderDeleteStep();return;}
 if($('#delete-input').value!==deleting.name)return;
 deleteSubmitting=true;$('#delete-next').disabled=true;$('#delete-cancel').disabled=true;$('#delete-error').hidden=true;
 const target={accountId:deleting.accountId,scriptName:deleting.name,confirmName:$('#delete-input').value};
 try{
  if(deleteStep===1){const result=await api('delete-prepare',target);deleteToken=result.confirmationToken;deleteStep=2;renderDeleteStep();}
  else{
   $('#delete-next').textContent='Wird gelöscht …';
   await api('delete',{...target,confirmationToken:deleteToken});
   const name=deleting.name;
   if(updateTarget===name){rememberTarget('');updateTarget='';}
   $('#delete-dialog').close();deleting=null;deleteToken='';busy=false;
   await loadPacs();$('#pacs-status').textContent=name+' wurde endgültig gelöscht. Die Dateien in Ihrer Wolke bleiben erhalten.';
  }
 }catch(e){
  // A failed/ambiguous delete consumes its token; require the whole flow again.
  if(deleteStep===2){$('#delete-dialog').close();deleting=null;deleteToken='';busy=false;await loadPacs();error(e.message);}
  else{$('#delete-error').textContent=e.message;$('#delete-error').hidden=false;}
 }finally{deleteSubmitting=false;$('#delete-next').disabled=false;$('#delete-cancel').disabled=false;}
});
let sharing=null;
function openShare(pac){
 sharing=pac;const text='Unser Reiseplan: '+pac.url;
 $('#share-title').textContent=pac.name+' teilen';$('#share-url').value=pac.url;$('#share-copy span').textContent='Kopieren';
 $('#share-whatsapp').href='https://wa.me/?text='+encodeURIComponent(text);
 $('#share-telegram').href='https://t.me/share/url?url='+encodeURIComponent(pac.url)+'&text='+encodeURIComponent('Unser Reiseplan');
 $('#share-mail').href='mailto:?subject='+encodeURIComponent('Unser Reiseplan')+'&body='+encodeURIComponent(text);
 $('#share-native').hidden=!navigator.share;prepareShareQr(pac);$('#share-dialog').showModal();
}
let qrBlobPromise=null;
function prepareShareQr(pac){
 const canvas=$('#share-qr-canvas');
 $('#share-qr-status').textContent='';$('#share-qr-copy').textContent='Kopieren';
 $('#share-qr-copy').disabled=true;$('#share-qr-send').disabled=true;
 canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
 // Render synchronously so switching PACs cannot leave the previous QR visible.
 qrBlobPromise=new Promise((resolve,reject)=>{
  try{QRCode.toCanvas(canvas,pac.url,{width:600,margin:4,errorCorrectionLevel:'M'},error=>{
   if(error){reject(error);return;}
   // The renderer sets 600px inline dimensions; keep those pixels only in the PNG.
   canvas.style.removeProperty('width');canvas.style.removeProperty('height');
   canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG konnte nicht erstellt werden.')),'image/png');
  });}catch(error){reject(error);}
 });
 const current=qrBlobPromise;
 current.then(()=>{if(current!==qrBlobPromise)return;$('#share-qr-copy').disabled=!(navigator.clipboard?.write&&window.ClipboardItem);$('#share-qr-send').disabled=false;})
 .catch(()=>{if(current===qrBlobPromise)$('#share-qr-status').textContent='QR-Code konnte nicht erstellt werden.';});
}
$('#share-qr-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.write([new ClipboardItem({'image/png':qrBlobPromise})]);$('#share-qr-copy').textContent='Kopiert';}
 catch{$('#share-qr-status').textContent='Kopieren nicht möglich. Bitte „QR teilen“ verwenden.';}
});
$('#share-qr-send').addEventListener('click',async()=>{
 const pac=sharing;
 try{
  const blob=await qrBlobPromise,file=new File([blob],'reiseplan-qr.png',{type:'image/png'});
  if(navigator.canShare?.({files:[file]})){await navigator.share({title:pac.name,files:[file]});return;}
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  $('#share-qr-status').textContent='QR-Code als PNG gespeichert.';
 }catch(error){if(error.name!=='AbortError')$('#share-qr-status').textContent='QR-Code konnte nicht geteilt werden.';}
});
$('#share-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('#share-url').value);}catch{$('#share-url').select();document.execCommand('copy');}
 $('#share-copy span').textContent='Kopiert';
});
$('#share-native').addEventListener('click',()=>{if(sharing)navigator.share({title:'Unser Reiseplan',url:sharing.url}).catch(()=>{});});
// QR enlargement uses a separate modal so Escape restores the share menu and focus.
function enlargeShareQr(){
 if($('#share-qr-send').disabled)return;
 const source=$('#share-qr-canvas'),large=$('#share-qr-large');
 large.width=source.width;large.height=source.height;
 large.getContext('2d').drawImage(source,0,0);
 const link=$('#share-qr-full-url');link.textContent=$('#share-url').value;link.href=$('#share-url').value;
 $('#share-qr-zoom').showModal();
}
$('#share-qr-canvas').addEventListener('click',enlargeShareQr);
$('#share-qr-canvas').addEventListener('keydown',event=>{
 if(event.key==='Enter'||event.key===' '){event.preventDefault();enlargeShareQr();}
});
$('#share-qr-large').addEventListener('click',()=>$('#share-qr-zoom').close());
$('#share-qr-large').addEventListener('keydown',event=>{
 if(event.key==='Enter'||event.key===' '){event.preventDefault();$('#share-qr-zoom').close();}
});
$('#share-qr-zoom').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
$('#share-dialog').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
// The overview has no single task yet, so the step panel only appears once the user starts creating.
function setMode(mode){
 const overview=mode==='overview';$('#overview').hidden=!overview;$('#deploy-form').hidden=overview;
 document.body.classList.toggle('wide',overview);if(!overview)$('#trip-name').focus();
}
$('#create-back').addEventListener('click',()=>setMode('overview'));
async function startUpdate(scriptName){
 if(busy)return;busy=true;
 try{apply(await api('update',{accountId:$('#account').value,scriptName}));}catch(e){error(e.message);}finally{busy=false;}
}
$('#account').addEventListener('change',loadPacs);
$('#pacs-refresh').addEventListener('click',loadPacs);

for(const button of document.querySelectorAll('.logout'))button.addEventListener('click',forget);

// Mirrors pacName() in src/cloudflare.js; the server stays authoritative.
function tripSlug(title){return title.trim().toLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,59).replace(/-$/,'');}
$('#trip-name').addEventListener('input',()=>{
 const slug=tripSlug($('#trip-name').value),hint=$('#trip-address');
 if(!$('#trip-name').value.trim()){hint.textContent='Die Adresse beginnt mit pac- und Ihrem Reisenamen, etwa pac-berlin-2027.';return;}
 if(!slug||slug==='install'){hint.textContent='Bitte Buchstaben oder Zahlen verwenden.';return;}
 const name=document.createElement('strong');name.textContent='pac-'+slug;hint.replaceChildren('Adresse: ',name,'.…workers.dev');
});
// Returning from Cloudflare via the back button restores a page frozen mid-login.
addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
