export const API='https://api.cloudflare.com/client/v4';
export class ApiError extends Error {
 constructor(status,stage,code){super(stage);this.status=status;this.stage=stage;if(Number.isInteger(code))this.code=code;}
}
export async function api(path,{method='GET',token,body,form,fetcher=fetch,stage='api'}={}) {
 const headers={};if(token)headers.authorization='Bearer '+token;
 if(body!==undefined)headers['content-type']='application/json';
 const response=await fetcher(API+path,{method,headers,body:form|| (body!==undefined?JSON.stringify(body):undefined),redirect:'manual',signal:AbortSignal.timeout(90000)});
 const raw=await response.text();
 if(method==='DELETE'&&response.ok&&!raw.trim())return null;
 let payload;try{payload=JSON.parse(raw);}catch{throw new ApiError(response.status,stage);}
 if(!response.ok||payload.success!==true) {
  const errors=Array.isArray(payload.errors)?payload.errors:[];
  throw new ApiError(response.status,stage,errors.find(error=>Number.isInteger(error.code))?.code);
 }
 return payload.result;
}
export function pacName(title) {
 if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('Bitte einen Reisenamen eingeben (höchstens 200 Zeichen).');
 const slug=title.trim().toLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,59).replace(/-$/,'');
 if(!slug||slug==='install')throw new Error('Bitte einen anderen Reisenamen mit Buchstaben oder Zahlen wählen.');
 return 'pac-'+slug;
}
const isPacName=name=>typeof name==='string'&&name.length<=63&&/^pac-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)&&name!=='pac-install';
export async function deletePac(accountId,name,token,requestApi=api) {
 if(!/^[a-f0-9]{32}$/.test(accountId||'')||!isPacName(name))throw new ApiError(400,'deletion-target');
 const path='/accounts/'+accountId+'/workers/scripts/'+name;
 const settings=await requestApi(path+'/settings',{token,stage:'delete-settings'});
 if(!settings?.bindings?.some(binding=>binding.type==='durable_object_namespace'&&binding.name==='PORTAL'&&binding.class_name==='Portal'))throw new ApiError(409,'not-pac');
 // Do not force deletion: Cloudflare must protect other Workers that reference this PAC.
 await requestApi(path,{method:'DELETE',token,stage:'delete-worker'});
}
export async function deployPac(secret,payload,fetcher=fetch) {
 const prefix='/accounts/'+secret.accountId+'/workers',token=secret.apiToken,name=secret.scriptName;
 if(!/^[a-f0-9]{64}$/.test(secret.setupToken||''))throw new ApiError(400,'setup-token');
 if(!/^[a-f0-9]{32}$/.test(secret.accountId)||!isPacName(name))throw new ApiError(400,'deployment-target');
 let subdomain;
 try{subdomain=(await api(prefix+'/subdomain',{token,fetcher,stage:'subdomain'}))?.subdomain;}catch(error){if(error.status!==404)throw error;}
 if(!subdomain) {
  subdomain='pac-'+secret.accountId.slice(0,12);
  await api(prefix+'/subdomain',{method:'PUT',token,body:{subdomain},fetcher,stage:'register-subdomain'});
 }
 if(!/^[a-z0-9-]+$/.test(subdomain))throw new ApiError(502,'subdomain-response');
 // A pre-existing script is never overwritten, including after an ambiguous upload.
 try{await api(prefix+'/scripts/'+name+'/settings',{token,fetcher,stage:'settings'});throw new ApiError(409,'already-exists');}catch(error){if(error.status!==404)throw error;}
 const metadata={main_module:'worker.mjs',compatibility_date:'2026-09-10',bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'},{type:'secret_text',name:'PAC_SETUP_SECRET',text:secret.setupToken}],migrations:{new_tag:'v1',steps:[{new_sqlite_classes:['Portal']}]}};
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new File([payload],'worker.mjs',{type:'application/javascript+module'}));
 await api(prefix+'/scripts/'+name,{method:'PUT',token,form,fetcher,stage:'upload'});
 await api(prefix+'/scripts/'+name+'/subdomain',{method:'POST',token,body:{enabled:true,previews_enabled:false},fetcher,stage:'enable-subdomain'});
 return 'https://'+name+'.'+subdomain+'.workers.dev';
}

// Replaces only the code of an existing PAC; secrets, variables and the PORTAL Durable Object stay untouched.
export async function updatePac(secret,payload,fetcher=fetch) {
 const prefix='/accounts/'+secret.accountId+'/workers',token=secret.apiToken,name=secret.scriptName;
 if(!/^[a-f0-9]{32}$/.test(secret.accountId)||!isPacName(name))throw new ApiError(400,'deployment-target');
 const before=await api(prefix+'/scripts/'+name+'/settings',{token,fetcher,stage:'update-settings'});
 const bindings=Array.isArray(before?.bindings)?before.bindings:[];
 if(!bindings.some(binding=>binding.type==='durable_object_namespace'&&binding.name==='PORTAL'&&binding.class_name==='Portal'))throw new ApiError(409,'not-pac');
 const metadata={main_module:'worker.mjs',compatibility_date:before.compatibility_date||'2026-09-10',bindings:[],keep_bindings:[...new Set(bindings.map(binding=>binding.type))],keep_assets:true};
 if(Array.isArray(before.compatibility_flags)&&before.compatibility_flags.length)metadata.compatibility_flags=before.compatibility_flags;
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new File([payload],'worker.mjs',{type:'application/javascript+module'}));
 const result=await api(prefix+'/scripts/'+name,{method:'PUT',token,form,fetcher,stage:'update-upload'});
 const after=await api(prefix+'/scripts/'+name+'/settings',{token,fetcher,stage:'update-verify'});
 for(const binding of bindings)if(!after?.bindings?.some(next=>next.name===binding.name&&next.type===binding.type))throw new ApiError(502,'update-verify');
 let subdomain;try{subdomain=(await api(prefix+'/subdomain',{token,fetcher,stage:'subdomain'}))?.subdomain;}catch{}
 return {url:subdomain&&/^[a-z0-9-]+$/.test(subdomain)?'https://'+name+'.'+subdomain+'.workers.dev':null,versionId:typeof result?.version_id==='string'?result.version_id:null};
}

export async function listPacs(accountId,token,requestApi=api) {
 if(!/^[a-f0-9]{32}$/.test(accountId||''))throw new ApiError(400,'account');
 const prefix='/accounts/'+accountId+'/workers';
 const scripts=await requestApi(prefix+'/scripts',{token,stage:'list-workers'});
 if(!Array.isArray(scripts))throw new ApiError(502,'list-workers');
 const matching=scripts.filter(script=>isPacName(script.id));
 let subdomain;
 if(matching.length){try{subdomain=(await requestApi(prefix+'/subdomain',{token,stage:'subdomain'}))?.subdomain;}catch(error){if(error.status!==404)throw error;}}
 if(subdomain&&!/^[a-z0-9-]+$/.test(subdomain))throw new ApiError(502,'subdomain-response');
 return matching.map(script=>({name:script.id,createdAt:typeof script.created_on==='string'?script.created_on:null,url:subdomain?'https://'+script.id+'.'+subdomain+'.workers.dev':null,dashboardUrl:'https://dash.cloudflare.com/'+accountId+'/workers/services/view/'+script.id+'/production/settings'})).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
}
