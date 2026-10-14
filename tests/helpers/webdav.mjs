import assert from 'node:assert/strict';
import {NextcloudStorage} from '../../src/nextcloud.js';
export function mockWebdav() {
 const files=new Map(),calls=[];let version=0,fail=false,malformed=false,failMetadata=false;
 const env={NEXTCLOUD_WEBDAV_URL:'https://cloud.test/remote.php/dav/files/test',NEXTCLOUD_USERNAME:'test',NEXTCLOUD_APP_PASSWORD:'test-app-password',NEXTCLOUD_ROOT:'Profilreise'};
 const root='/remote.php/dav/files/test/Profilreise',xmlEscape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname,headers=new Headers(options.headers),method=options.method;
  calls.push({path,method,headers});assert.equal(options.redirect,'manual');assert.equal(headers.get('authorization'),'Basic '+btoa('test:test-app-password'));
  if(fail) return new Response('Unavailable',{status:503});
  if(method==='MKCOL') return new Response(null,{status:201});
  if(method==='PUT') {
   if((headers.get('if-none-match')==='*'&&files.has(path))||(headers.has('if-match')&&headers.get('if-match')!==files.get(path)?.etag)) return new Response(null,{status:412});
   if(failMetadata&&path.includes('/metadata/')) return new Response(null,{status:503});
   const bytes=await new Response(options.body).arrayBuffer();const etag='"v'+(++version)+'"';files.set(path,{bytes,etag});return new Response(null,{status:201,headers:{etag}});
  }
  if(method==='GET') {const object=files.get(path);return object?new Response(object.bytes,{headers:{etag:object.etag}}):new Response(null,{status:404});}
  if(method==='DELETE') return new Response(null,{status:files.delete(path)?204:404});
  if(method==='PROPFIND') {
   if(malformed) return new Response('<broken',{status:207});
   const children=[...files.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/'));
   const rows=[path+'/',...children].map(key=>`<d:response><d:href>${xmlEscape(key)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('');
   return new Response(`<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`,{status:207});
  }
  throw new Error('Unexpected method '+method);
 };
 const cloud=new NextcloudStorage(env,fetcher);
 return {cloud,files,calls,env,root,setFail:value=>{fail=value;},setMalformed:value=>{malformed=value;},setMetadataFailure:value=>{failMetadata=value;}};
}
