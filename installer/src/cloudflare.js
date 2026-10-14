export const API='https://api.cloudflare.com/client/v4';
export const TERMS='https://www.cloudflare.com/terms/';
export const PRIVACY='https://www.cloudflare.com/privacypolicy/';
export class ApiError extends Error {
 constructor(status,stage,code,reason){super(stage);this.status=status;this.stage=stage;if(Number.isInteger(code))this.code=code;if(reason)this.reason=reason;}
}
export async function api(path,{method='GET',token,body,form,fetcher=fetch,stage='api'}={}) {
 const headers={};if(token)headers.authorization='Bearer '+token;
 if(body!==undefined)headers['content-type']='application/json';
 const response=await fetcher(API+path,{method,headers,body:form|| (body!==undefined?JSON.stringify(body):undefined),redirect:'manual',signal:AbortSignal.timeout(90000)});
 let payload;try{payload=await response.json();}catch{throw new ApiError(response.status,stage);}
 if(!response.ok||payload.success!==true) {
  const errors=Array.isArray(payload.errors)?payload.errors:[],text=errors.map(error=>String(error.message||'')).join(' ').toLowerCase();
  const reason=text.includes('worker_subrequest_blocked')?'worker-subrequest-blocked':/ip.{0,30}(mismatch|match|differ)|(?:source|origin).{0,20}ip/.test(text)?'ip-mismatch':/expir/.test(text)?'expired':/proof|checkpoint|solution|challenge/.test(text)?'proof-rejected':/rate|limit/.test(text)?'rate-limit':undefined;
  throw new ApiError(response.status,stage,errors.find(error=>Number.isInteger(error.code))?.code,reason);
 }
 return payload.result;
}
export async function deployPac(secret,payload,fetcher=fetch) {
 const prefix='/accounts/'+secret.accountId+'/workers',token=secret.apiToken,name=secret.scriptName;
 if(!/^[a-f0-9]{32}$/.test(secret.accountId)||!/^pac-[a-f0-9]{12}$/.test(name||''))throw new ApiError(400,'deployment-target');
 let subdomain;
 try{subdomain=(await api(prefix+'/subdomain',{token,fetcher,stage:'subdomain'}))?.subdomain;}catch(error){if(error.status!==404)throw error;}
 if(!subdomain) {
  subdomain='pac-'+secret.accountId.slice(0,12);
  await api(prefix+'/subdomain',{method:'PUT',token,body:{subdomain},fetcher,stage:'register-subdomain'});
 }
 if(!/^[a-z0-9-]+$/.test(subdomain))throw new ApiError(502,'subdomain-response');
 // A pre-existing script is never overwritten, including after an ambiguous upload.
 try{await api(prefix+'/scripts/'+name+'/settings',{token,fetcher,stage:'settings'});throw new ApiError(409,'already-exists');}catch(error){if(error.status!==404)throw error;}
 const metadata={main_module:'worker.mjs',compatibility_date:'2026-09-10',bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'}],migrations:{new_tag:'v1',steps:[{new_sqlite_classes:['Portal']}]}};
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new File([payload],'worker.mjs',{type:'application/javascript+module'}));
 await api(prefix+'/scripts/'+name,{method:'PUT',token,form,fetcher,stage:'upload'});
 await api(prefix+'/scripts/'+name+'/subdomain',{method:'POST',token,body:{enabled:true,previews_enabled:false},fetcher,stage:'enable-subdomain'});
 return 'https://'+name+'.'+subdomain+'.workers.dev';
}
