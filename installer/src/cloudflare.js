export const API='https://api.cloudflare.com/client/v4';
export const TERMS='https://www.cloudflare.com/terms/';
export const PRIVACY='https://www.cloudflare.com/privacypolicy/';
export class ApiError extends Error {
 constructor(status,stage){super(stage);this.status=status;this.stage=stage;}
}
export async function api(path,{method='GET',token,body,form,fetcher=fetch,stage='api'}={}) {
 const headers={};if(token)headers.authorization='Bearer '+token;
 if(body!==undefined)headers['content-type']='application/json';
 const response=await fetcher(API+path,{method,headers,body:form|| (body!==undefined?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(90000)});
 let payload;try{payload=await response.json();}catch{throw new ApiError(response.status,stage);}
 if(!response.ok||payload.success!==true) throw new ApiError(response.status,stage);
 return payload.result;
}
export function validateAccount(value,now=Date.now()) {
 const expiresAt=Math.min(Date.parse(value?.account?.expiresAt),Date.parse(value?.claim?.expiresAt));
 let url;try{url=new URL(value.claim.url);}catch{throw new ApiError(502,'account-response');}
 if(!/^[a-f0-9]{32}$/.test(value?.account?.id||'')||typeof value?.account?.apiToken!=='string'||value.account.apiToken.length<10||!Number.isFinite(expiresAt)||expiresAt<=now||url.origin!=='https://dash.cloudflare.com'||url.pathname!=='/claim-preview'||!url.searchParams.get('claimToken')) throw new ApiError(502,'account-response');
 return {accountId:value.account.id,apiToken:value.account.apiToken,claimUrl:url.href,expiresAt};
}
export async function deployPac(secret,payload,fetcher=fetch) {
 const prefix='/accounts/'+secret.accountId+'/workers',token=secret.apiToken;
 let subdomain;
 try{subdomain=(await api(prefix+'/subdomain',{token,fetcher,stage:'subdomain'}))?.subdomain;}catch(error){if(error.status!==404)throw error;}
 if(!subdomain) {
  subdomain='pac-'+secret.accountId.slice(0,12);
  await api(prefix+'/subdomain',{method:'PUT',token,body:{subdomain},fetcher,stage:'register-subdomain'});
 }
 if(!/^[a-z0-9-]+$/.test(subdomain))throw new ApiError(502,'subdomain-response');
 // An alarm retry may follow an accepted upload whose response was lost.
 let existing=false;
 try {const settings=await api(prefix+'/scripts/pac/settings',{token,fetcher,stage:'settings'});existing=settings?.migration_tag==='v1';} catch(error){if(error.status!==404)throw error;}
 const metadata={main_module:'worker.mjs',compatibility_date:'2026-09-10',bindings:[{type:'durable_object_namespace',name:'PORTAL',class_name:'Portal'}],...(!existing?{migrations:{new_tag:'v1',steps:[{new_sqlite_classes:['Portal']}]}}:{})};
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new File([payload],'worker.mjs',{type:'application/javascript+module'}));
 await api(prefix+'/scripts/pac',{method:'PUT',token,form,fetcher,stage:'upload'});
 await api(prefix+'/scripts/pac/subdomain',{method:'POST',token,body:{enabled:true,previews_enabled:false},fetcher,stage:'enable-subdomain'});
 return 'https://pac.'+subdomain+'.workers.dev';
}
