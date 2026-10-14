const $=selector=>document.querySelector(selector);
let csrf='',timer,busy=false;
const stages={challenge:'Cloudflare wird kontaktiert …',solving:'Deine Einrichtung wird vorbereitet …',provision:'Dein eigenes Cloudflare-Konto wird vorbereitet …',creating:'Dein eigenes Cloudflare-Konto wird erstellt …',uploading:'PAC wird in deiner Instanz bereitgestellt …'};
async function api(path,body) {
 const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify({...body,csrf}):undefined,cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.');return data;
}
function error(message){$('#error').textContent=message;$('#error').hidden=false;}
function show(view){for(const name of ['start','progress','result'])$('#'+name+'-view').hidden=name!==view;}
function apply(data) {
 clearTimeout(timer);$('#error').hidden=true;
 if(data.stage==='idle'){show('start');$('#start').disabled=false;return;}
 if(data.stage==='ready') {
  if(data.expiresAt<=Date.now()){expired();return;}
  show('result');$('#claim').href=data.claimUrl;$('#preview').href=data.previewUrl;
  $('#deadline').textContent='Bis '+new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'}).format(new Date(data.expiresAt))+' Uhr vollständig übernehmen.';
  timer=setTimeout(expired,Math.min(2147483647,data.expiresAt-Date.now()));return;
 }
 if(data.stage==='failed'){show('start');error(data.error);$('#retry').hidden=false;$('#start').disabled=true;return;}
 show('progress');$('#stage').textContent=stages[data.stage]||'Vorbereitung läuft …';$('#progress').value=data.progress||0;
 timer=setTimeout(poll,2500);
}
function expired(){clearTimeout(timer);$('#claim').removeAttribute('href');$('#preview').removeAttribute('href');show('start');error('Der Übernahme-Link ist abgelaufen. Bitte beginne eine neue Einrichtung.');$('#retry').hidden=false;$('#start').disabled=true;}
async function poll(){try{apply(await api('status'));}catch(e){error(e.message);timer=setTimeout(poll,6000);}}
$('#setup-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;$('#start').disabled=true;$('#error').hidden=true;
 try {apply(await api('start',{acceptTerms:$('#terms').checked,acceptPrivacy:$('#privacy').checked}));}catch(e){error(e.message);$('#start').disabled=false;}finally{busy=false;}
});
async function forget() {try{await api('forget',{});location.reload();}catch(e){if(/abgelaufen/.test(e.message)){location.reload();return;}error(e.message);}}
$('#forget').addEventListener('click',forget);$('#retry').addEventListener('click',forget);
(async()=>{try{const session=await api('session');csrf=session.csrf;apply(await api('status'));}catch(e){error(e.message);}})();
