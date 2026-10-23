import {createHash,timingSafeEqual} from 'node:crypto';
import {releaseInfo} from './release.js';
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https://pac-install.linusleupold.workers.dev; media-src 'self' https://pac-install.linusleupold.workers.dev; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const reply=(value,status=200)=>Response.json(value,{status,headers});
function readSession(request,cookieName) {
 const value=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return /^[a-f0-9]{64}$/.test(value||'')?value:null;
}
// The Hetzner proxy reaches the Worker from one server IP; only it may name the real client, proven by PROXY_SECRET.
function clientIp(request,env) {
 const secret=env.PROXY_SECRET,sent=request.headers.get('x-pac-proxy-secret'),forwarded=request.headers.get('x-pac-client-ip');
 if(secret&&sent&&forwarded&&/^[0-9a-fA-F:.]{2,45}$/.test(forwarded)){
  const a=createHash('sha256').update(secret).digest(),b=createHash('sha256').update(sent).digest();
  if(timingSafeEqual(a,b))return forwarded;
 }
 return request.headers.get('cf-connecting-ip')||'unknown';
}
export async function route(request,env) {
 const url=new URL(request.url),method=request.method;
 const base=url.pathname==='/install'||url.pathname.startsWith('/install/')?'/install':'';
 const path=base?(url.pathname.slice(base.length)||'/'):url.pathname;
 const origin=base?'https://profilfahrt.linusfin.de':url.origin;
 const cookieName=base?'__Secure-pac-install-path':'__Host-pac-install';
 if(url.pathname==='/install')return new Response(null,{status:308,headers:{...headers,location:'/install/'}});
 // The installer moved from / to /app; PAC admin pages still link to /?update=… and must land in it.
 if(path==='/'&&(url.searchParams.has('update')||url.searchParams.has('login')))return new Response(null,{status:302,headers:{...headers,location:base+'/app'+url.search}});
 // Public and read-only, so PAC admin pages on any domain can compare their installed version.
 if(path==='/api/version'){
  const cors={...headers,'access-control-allow-origin':'*','access-control-allow-methods':'GET'};
  if(method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!['GET','HEAD'].includes(method))return reply({error:'Methode nicht erlaubt.'},405);
  return Response.json(await releaseInfo(env),{headers:cors});
 }
 if(path.startsWith('/api/')||path==='/oauth/callback') {
  if(!['GET','POST'].includes(method))return reply({error:'Methode nicht erlaubt.'},405);
  if(method==='POST'&&(request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json')))return reply({error:'Ungültiger Ursprung.'},403);
  let session=readSession(request,cookieName),fresh=false;
  if(path==='/api/session'&&method==='GET'&&!session){session=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');fresh=true;}
  if(!session)return reply({error:'Bitte die Seite neu laden.'},401);
  if(!['/api/session','/api/login','/api/start','/api/pacs','/api/delete-prepare','/api/delete','/api/update','/api/status','/api/forget','/api/overview','/oauth/callback'].includes(path))return reply({error:'Nicht gefunden.'},404);
  if((['/api/login','/api/start','/api/pacs','/api/delete-prepare','/api/delete','/api/update','/api/forget','/api/overview'].includes(path))!==(method==='POST'))return reply({error:'Methode nicht erlaubt.'},405);
  let body;
  if(method==='POST') {
   const raw=await request.text();if(raw.length>2048)return reply({error:'Anfrage zu groß.'},413);
   try{body=JSON.parse(raw);}catch{return reply({error:'Ungültige Anfrage.'},400);}
   if(!body||Array.isArray(body)||typeof body!=='object')return reply({error:'Ungültige Anfrage.'},400);
   const ip=clientIp(request,env);
   body.rateKey=createHash('sha256').update((env.RATE_SALT||'pac-installer')+':'+ip).digest('hex');
  }
  if(path==='/api/login')body.redirectUri=origin+base+'/oauth/callback';
  if(path==='/oauth/callback')body={state:url.searchParams.get('state'),code:url.searchParams.get('code'),error:url.searchParams.get('error')};
  const object=env.JOBS.get(env.JOBS.idFromName('session:'+session));
  let response=await object.fetch(new Request('https://internal'+(path==='/oauth/callback'?'/callback':path.slice(4)),{method:path==='/oauth/callback'?'POST':method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined}));
  if(path==='/api/session'&&response.status===410){
   session=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');fresh=true;
   response=await env.JOBS.get(env.JOBS.idFromName('session:'+session)).fetch(new Request('https://internal/session'));
  }
  const cookie=`${cookieName}=${session}; Path=${base||'/'}; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`;
  // The cookie slides with activity so it never expires before the job behind it.
  if(path==='/oauth/callback')return new Response(null,{status:303,headers:{...headers,location:response.ok?base+'/app':base+'/app?login=invalid',...(response.ok?{'set-cookie':cookie}:{})}});
  const result=new Response(response.body,response);for(const [key,value]of Object.entries(headers))result.headers.set(key,value);
  if(fresh||(response.ok&&path!=='/api/forget'))result.headers.set('set-cookie',cookie);
  if(path==='/api/forget'&&response.ok)result.headers.set('set-cookie',`${cookieName}=; Path=${base||'/'}; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  return result;
 }
 if(!['GET','HEAD'].includes(method))return reply({error:'Methode nicht erlaubt.'},405);
 if(!['/','/index.html','/style.css','/theme.css','/theme.js','/app.js','/qrcode.js','/qrcode.LICENSE.txt','/app','/app.html','/home.css','/shot-desktop.png','/shot-desktop-dark.png','/shot-mobile.png','/shot-mobile-dark.png','/logo.png','/logo.svg','/favicon.ico','/setup','/setup.html','/datenschutz','/datenschutz.html','/info','/info.html','/iserv-wolke.png','/iserv-hamburg.png','/tutorials/webdav.mp4','/tutorials/app-password.mp4','/tutorials/webdav.jpg','/tutorials/app-password.jpg','/tutorials.js'].includes(path))return reply({error:'Nicht gefunden.'},404);
 const assetUrl=new URL(request.url);assetUrl.pathname=path==='/favicon.ico'?'/logo.png':path;
 const asset=await env.ASSETS.fetch(new Request(assetUrl,request));
 // Static assets fetched through a Worker may return 200 for Range requests.
 // Serve the requested bytes explicitly so native video controls can seek reliably.
 if(path.endsWith('.mp4')&&asset.status===200&&request.headers.has('range')){
  const bytes=await asset.arrayBuffer(),size=bytes.byteLength;
  const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range'));
  let start=NaN,end=NaN;
  if(match&&(match[1]||match[2])){
   start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
   end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
  }
  const rangeHeaders=new Headers(asset.headers);
  for(const [key,value]of Object.entries(headers))rangeHeaders.set(key,value);
  rangeHeaders.set('accept-ranges','bytes');
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){
   rangeHeaders.set('content-range',`bytes */${size}`);rangeHeaders.set('content-length','0');
   return new Response(null,{status:416,headers:rangeHeaders});
  }
  rangeHeaders.set('content-range',`bytes ${start}-${end}/${size}`);
  rangeHeaders.set('content-length',String(end-start+1));
  return new Response(method==='HEAD'?null:bytes.slice(start,end+1),{status:206,headers:rangeHeaders});
 }
 let body=asset.body;
 if(base&&asset.headers.get('content-type')?.includes('text/html'))body=(await asset.text()).replaceAll('href="/','href="'+base+'/').replaceAll('src="/','src="'+base+'/');
 const response=new Response(method==='HEAD'?null:body,asset);
 if(base&&response.headers.get('location')?.startsWith('/'))response.headers.set('location',base+response.headers.get('location'));
 for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
