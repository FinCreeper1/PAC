// Update notes come from the GitHub release of the bundled version; the CHANGELOG text built into the installer is the fallback.
export const releaseRepo='FinCreeper1/PAC';
const maxNotes=2000;
export async function releaseInfo(env) {
 const version=env.PAC_VERSION||null;
 if(!version)return {version:null,notes:null,releaseUrl:null};
 const fallback={version,notes:(env.PAC_NOTES||'').slice(0,maxNotes)||null,releaseUrl:null};
 const api='https://api.github.com/repos/'+releaseRepo+'/releases/tags/'+encodeURIComponent(version);
 const cache=env.releaseCache===undefined?globalThis.caches?.default:env.releaseCache;
 try{
  let response=await cache?.match(api);
  if(!response){
   const fresh=await (env.githubFetch||fetch)(api,{headers:{accept:'application/vnd.github+json','user-agent':'PAC-Installer'},signal:AbortSignal.timeout(4000)});
   if(fresh.status!==200&&fresh.status!==404)return fallback;
   response=new Response(fresh.status===200?await fresh.text():'null',{headers:{'content-type':'application/json','cache-control':'max-age=600'}});
   await cache?.put(api,response.clone());
  }
  const data=await response.json();
  if(!data||data.draft)return fallback;
  const url=typeof data.html_url==='string'&&data.html_url.startsWith('https://github.com/'+releaseRepo+'/')?data.html_url:null;
  return {version,notes:typeof data.body==='string'&&data.body.trim()?data.body.trim().slice(0,maxNotes):fallback.notes,releaseUrl:url};
 }catch{return fallback;}
}
