import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function fixture(){
 const listeners={},stores=new Map();
 const key=request=>new URL(typeof request==='string'?request:request.url,'https://portal.test').href;
 const caches={
  keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),
  open:async name=>{
   if(!stores.has(name))stores.set(name,new Map());
   return {
    put:async(request,response)=>stores.get(name).set(key(request),response.clone()),
    match:async request=>stores.get(name)?.get(key(request))?.clone(),
    delete:async request=>stores.get(name)?.delete(key(request)),
    keys:async()=>[...stores.get(name).keys()].map(url=>new Request(url))
   };
  }
 };
 const context=vm.createContext({URL,Headers,Response,ReadableStream,Date,caches,
  fetch:async()=>new Response(null,{status:401}),
  self:{location:{origin:'https://portal.test'},addEventListener:(name,fn)=>{listeners[name]=fn;}}
 });
 vm.runInContext(source,context);
 const request=path=>{
  let response;listeners.fetch({request:new Request('https://portal.test'+path),respondWith:value=>{response=value;}});return response;
 };
 return {context,caches,stores,request};
}
test('online file authorization failures clear private offline caches without serving saved bytes',async()=>{
 for(const status of [401,403]){
  const app=fixture(),path='/api/files/event/file';
  await(await app.caches.open('profilreise-offline-files-v1')).put(path,new Response('private bytes'));
  await(await app.caches.open('profilreise-offline-v34')).put('/',new Response('private calendar'));
  app.context.fetch=async()=>new Response('Please log in',{status});
  assert.equal((await app.request(path)).status,status);assert.equal(app.stores.size,0);
 }
});
test('the extracted upload transport is included in the offline shell',async()=>{
 const app=fixture(),path='/shared/material-upload.js';
 app.context.fetch=async()=>new Response('upload transport',{headers:{'content-type':'text/javascript'}});
 assert.equal((await app.request(path)).status,200);
 assert.ok([...app.stores.values()].some(cache=>cache.has('https://portal.test'+path)));
});


test('cache deletion errors cannot turn a rejected online download into a private offline response',async()=>{
 const app=fixture(),path='/api/files/event/file';
 await(await app.caches.open('profilreise-offline-files-v1')).put(path,new Response('private bytes'));
 app.caches.delete=async()=>{throw Error('Storage failure');};
 const response=await app.request(path);assert.equal(response.status,401);
 assert.notEqual(await response.text(),'private bytes');
});
