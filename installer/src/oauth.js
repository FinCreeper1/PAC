import {createHash,randomBytes} from 'node:crypto';
export const scopes='account-settings.read workers-scripts.edit';
export function beginLogin(clientId,redirectUri){
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
 const url=new URL('https://dash.cloudflare.com/oauth2/auth');
 url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:scopes,state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
 return {state,verifier,url:url.href,redirectUri};
}
export async function exchangeCode(clientId,login,code,fetcher=fetch){
 const response=await fetcher('https://dash.cloudflare.com/oauth2/token',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:login.redirectUri,code_verifier:login.verifier}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||typeof data.access_token!=='string'||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new Error('oauth-token');
 return {apiToken:data.access_token,expiresAt:Date.now()+Math.min(data.expires_in*1000,3600000)};
}
