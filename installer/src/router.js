import {createHash} from 'node:crypto';
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const reply=(value,status=200)=>Response.json(value,{status,headers});
function readSession(request,cookieName) {
 const value=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return /^[a-f0-9]{64}$/.test(value||'')?value:null;
}
export async function route(request,env) {
 const url=new URL(request.url),method=request.method;
 const base=url.pathname==='/install'||url.pathname.startsWith('/install/')?'/install':'';
 const path=base?(url.pathname.slice(base.length)||'/'):url.pathname;
 const origin=base?'https://profilfahrt.linusfin.de':url.origin;
 const cookieName=base?'__Secure-pac-install-path':'__Host-pac-install';
 if(url.pathname==='/install')return new Response(null,{status:308,headers:{...headers,location:'/install/'}});
 if(path.startsWith('/api/')||path==='/oauth/callback') {
  if(!['GET','POST'].includes(method))return reply({error:'Methode nicht erlaubt.'},405);
  if(method==='POST'&&(request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json')))return reply({error:'Ungültiger Ursprung.'},403);
  let session=readSession(request,cookieName),fresh=false;
  if(path==='/api/session'&&method==='GET'&&!session){session=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');fresh=true;}
  if(!session)return reply({error:'Bitte die Seite neu laden.'},401);
  if(!['/api/session','/api/login','/api/start','/api/pacs','/api/status','/api/forget','/oauth/callback'].includes(path))return reply({error:'Nicht gefunden.'},404);
  if((['/api/login','/api/start','/api/pacs','/api/forget'].includes(path))!==(method==='POST'))return reply({error:'Methode nicht erlaubt.'},405);
  let body;
  if(method==='POST') {
   const raw=await request.text();if(raw.length>2048)return reply({error:'Anfrage zu groß.'},413);
   try{body=JSON.parse(raw);}catch{return reply({error:'Ungültige Anfrage.'},400);}
   if(!body||Array.isArray(body)||typeof body!=='object')return reply({error:'Ungültige Anfrage.'},400);
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
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
  if(path==='/oauth/callback')return new Response(null,{status:303,headers:{...headers,location:response.ok?base+'/':base+'/?login=invalid'}});
  const result=new Response(response.body,response);for(const [key,value]of Object.entries(headers))result.headers.set(key,value);
  if(fresh||(path==='/api/start'&&response.ok))result.headers.set('set-cookie',`${cookieName}=${session}; Path=${base||'/'}; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`);
  if(path==='/api/forget'&&response.ok)result.headers.set('set-cookie',`${cookieName}=; Path=${base||'/'}; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  return result;
 }
 if(!['GET','HEAD'].includes(method))return reply({error:'Methode nicht erlaubt.'},405);
 if(!['/','/index.html','/style.css','/app.js','/logo.png','/logo.svg','/setup','/setup.html'].includes(path))return reply({error:'Nicht gefunden.'},404);
 const assetUrl=new URL(request.url);assetUrl.pathname=path;
 const asset=await env.ASSETS.fetch(new Request(assetUrl,request));
 let body=asset.body;
 if(base&&asset.headers.get('content-type')?.includes('text/html'))body=(await asset.text()).replaceAll('href="/','href="'+base+'/').replaceAll('src="/','src="'+base+'/');
 const response=new Response(method==='HEAD'?null:body,asset);
 if(base&&response.headers.get('location')?.startsWith('/'))response.headers.set('location',base+response.headers.get('location'));
 for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;
}
