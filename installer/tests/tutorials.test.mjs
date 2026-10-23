import {test} from 'node:test';
import assert from 'node:assert/strict';
import {route} from '../src/router.js';

test('tutorial videos retain byte ranges for seeking and are allowed by the page CSP', async()=>{
 for(const base of ['', '/install']) {
  let called=false;
  const env={ASSETS:{fetch:async request=>{
   called=true;
   assert.equal(new URL(request.url).pathname,'/tutorials/webdav.mp4');
   assert.equal(request.headers.get('range'),'bytes=10-19');
   return new Response(new Uint8Array(10),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 10-19/100','accept-ranges':'bytes'}});
  }}};
  const response=await route(new Request('https://install.test'+base+'/tutorials/webdav.mp4',{headers:{range:'bytes=10-19'}}),env);
  assert.equal(called,true);assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),'bytes 10-19/100');
  assert.match(response.headers.get('content-security-policy'),/media-src 'self' https:\/\/pac-install\.linusleupold\.workers\.dev/);
 }
});

test('video ranges also work when the asset binding ignores Range',async()=>{
 const env={ASSETS:{fetch:async()=>new Response(Uint8Array.from([0,1,2,3,4,5]),{headers:{'content-type':'video/mp4','content-length':'6'}})}};
 for(const [range,status,expected]of [['bytes=2-3',206,[2,3]],['bytes=-2',206,[4,5]],['bytes=4-',206,[4,5]],['bytes=9-',416,[]],['bytes=-0',416,[]]]){
  const response=await route(new Request('https://install.test/tutorials/app-password.mp4',{headers:{range}}),env);
  assert.equal(response.status,status);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],expected);
  assert.equal(response.headers.get('content-length'),String(expected.length));
 }
});

test('closing a tutorial pauses it and starting another pauses the first',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {runInNewContext}=await import('node:vm');
 const handlers={};let pauses=0;
 const first={pause(){pauses++;}},second={matches:selector=>selector==='video.cloud-video',pause(){throw new Error('active video must keep playing');}};
 runInNewContext(await readFile(new URL('../public/tutorials.js',import.meta.url),'utf8'),{
  document:{addEventListener:(name,handler)=>{handlers[name]=handler;},querySelectorAll:()=>[first,second]},
 });
 handlers.toggle({target:{matches:()=>true,open:false,querySelector:()=>first}});
 assert.equal(pauses,1);
 handlers.play({target:second});assert.equal(pauses,2);
});
