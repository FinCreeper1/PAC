const $=selector=>document.querySelector(selector);
let csrf='',timer,busy=false,configured=false;
async function api(path,body){
 const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify({...body,csrf}):undefined,cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Die Anfrage ist fehlgeschlagen.');return data;
}
function error(message){$('#error').textContent=message;$('#error').hidden=false;}
function show(view){for(const name of ['start','account','progress','result'])$('#'+name+'-view').hidden=name!==view;}
function apply(data){
 clearTimeout(timer);$('#error').hidden=true;$('#retry').hidden=true;
 if(data.stage==='idle'||data.stage==='authorizing'){
  show('start');$('#start').disabled=!configured;
  $('#availability').textContent=configured?'Die Anmeldung und Freigabe erfolgen direkt bei Cloudflare.':'Die direkte Cloudflare-Anmeldung wird noch freigeschaltet. Bitte später erneut öffnen.';return;
 }
 if(data.stage==='authorized'){show('account');$('#account').replaceChildren(...data.accounts.map(account=>{const option=document.createElement('option');option.value=account.id;option.textContent=account.name;return option;}));return;}
 if(data.stage==='ready'){show('result');$('#dashboard').href=data.dashboardUrl;$('#preview').href=data.previewUrl;return;}
 if(data.stage==='failed'){show('start');error(data.error);$('#retry').hidden=false;$('#start').disabled=true;return;}
 show('progress');$('#stage').textContent='PAC wird in deinem Cloudflare-Konto bereitgestellt …';timer=setTimeout(poll,2500);
}
async function poll(){try{apply(await api('status'));}catch(e){error(e.message);timer=setTimeout(poll,6000);}}
$('#setup-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;$('#start').disabled=true;
 try{const {url}=await api('login',{});const target=new URL(url);if(target.origin!=='https://dash.cloudflare.com')throw new Error('Ungültige Anmeldung.');location.assign(target.href);}catch(e){error(e.message);$('#start').disabled=!configured;busy=false;}
});
$('#deploy-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;try{apply(await api('start',{accountId:$('#account').value}));}catch(e){error(e.message);}finally{busy=false;}});
async function forget(){try{await api('forget',{});location.reload();}catch(e){error(e.message);}}
$('#forget').addEventListener('click',forget);$('#retry').addEventListener('click',forget);
(async()=>{try{const session=await api('session');csrf=session.csrf;configured=session.configured;apply(await api('status'));}catch(e){error(e.message);}})();
