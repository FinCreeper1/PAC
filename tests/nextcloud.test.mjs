import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NextcloudStorage,StorageConflict,davBasenames} from '../src/nextcloud.js';
import {mockWebdav} from './helpers/webdav.mjs';
const id='8d08a0ce-cbe6-4f3e-a1d0-75cd189ddff7',key='test-event/'+id;
test('text paths match the existing PHP SHA-256 layout exactly',async()=>{
 const {cloud,files,root}=mockWebdav();
 for(const key of ['calendar:snapshot','ideas:board','shared-note:test-event','note:test-event']) {
  await cloud.writeText(key,'existing format',null);
  const path=root+'/text/'+createHash('sha256').update(key).digest('hex')+'.txt';assert.ok(files.has(path));
  assert.equal((await cloud.readText(key)).value,'existing format');
 }
});
test('ETag conditional writes protect external edits and concurrent creation',async()=>{
 const {cloud}=mockWebdav();await cloud.writeText('ideas:board','[]',null);
 const a=await cloud.readText('ideas:board'),b=await cloud.readText('ideas:board');
 await cloud.writeText('ideas:board','["new"]',a.etag);
 await assert.rejects(()=>cloud.writeText('ideas:board','["stale"]',b.etag),StorageConflict);
 await assert.rejects(()=>cloud.writeText('ideas:board','[]',null),StorageConflict);
 assert.equal((await cloud.readText('ideas:board')).value,'["new"]');
});
test('PHP-compatible files and metadata remain accessible without migration',async()=>{
 const {cloud,files,root}=mockWebdav(),metadata={name:'Bestehend.pdf',type:'application/pdf',size:8,uploadedAt:'2026-10-14T12:00:00Z'};
 files.set(root+'/files/'+key,{bytes:new TextEncoder().encode('existing'),etag:'"file"'});
 files.set(root+'/metadata/'+key+'.json',{bytes:new TextEncoder().encode(JSON.stringify(metadata)),etag:'"meta"'});
 const list=await cloud.list({prefix:'test-event/'});assert.equal(list.keys[0].metadata.name,'Bestehend.pdf');
 const object=await cloud.getWithMetadata(key,'stream');assert.equal(await new Response(object.value).text(),'existing');
});
test('failed metadata publication rolls back the uploaded bytes',async()=>{
 const webdav=mockWebdav();webdav.setMetadataFailure(true);
 await assert.rejects(()=>webdav.cloud.putFile(key,new Blob(['test']).stream(),{name:'test.txt',type:'application/octet-stream',uploadedAt:new Date().toISOString()}));
 assert.equal(webdav.files.size,0);
});
test('empty uploads are removed rather than published',async()=>{
 const {cloud,files}=mockWebdav();await assert.rejects(()=>cloud.putFile(key,new Blob([]).stream(),{name:'empty',type:'application/octet-stream',uploadedAt:new Date().toISOString()}),/Leere Datei/);assert.equal(files.size,0);
});
test('upstream errors and malformed WebDAV replies are not empty lists',async()=>{
 const mock=mockWebdav();mock.setFail(true);await assert.rejects(()=>mock.cloud.list({prefix:'test-event/'}));
 mock.setFail(false);mock.setMalformed(true);await assert.rejects(()=>mock.cloud.list({prefix:'test-event/'}));
});
test('namespace-aware WebDAV parsing rejects entities, per-resource errors and foreign paths',()=>{
 const base='https://cloud.test/root/metadata/topic';
 const xml=(href,status='200 OK')=>`<multistatus xmlns="DAV:"><response><href>${href}</href><status>HTTP/1.1 ${status}</status></response></multistatus>`;
 assert.deepEqual(davBasenames(xml('/root/metadata/topic/file.json'),base),['file.json']);
 assert.deepEqual(davBasenames('<x:multistatus xmlns:x="DAV:"><x:response><x:href>/root/metadata/topic/file.json</x:href><x:status>HTTP/1.1 200 OK</x:status></x:response></x:multistatus>',base),['file.json']);
 for(const value of [xml('/root/metadata/topic/file.json','403 Forbidden'),xml('https://evil.test/root/metadata/topic/file.json'),xml('/root/metadata/other/file.json'),xml('/root/metadata/topic/%2e%2e'),xml('/root/metadata/topic/%2fsecret'),xml('/root/metadata/topic/file.json').replace('DAV:','urn:foreign'),'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+xml('/root/metadata/topic/file.json'),'<broken']) assert.throws(()=>davBasenames(value,base));
});
test('configuration and keys cannot escape the configured cloud root',async()=>{
 const {cloud,env}=mockWebdav();
 for(const patch of [{NEXTCLOUD_WEBDAV_URL:'http://cloud.test/'},{NEXTCLOUD_WEBDAV_URL:'https://user:pass@cloud.test/'},{NEXTCLOUD_ROOT:'../other'},{NEXTCLOUD_ROOT:'..'}]) assert.throws(()=>new NextcloudStorage({...env,...patch}));
 for(const key of ['../secret','note:../secret','route:anything']) await assert.rejects(()=>cloud.readText(key));
 await assert.rejects(()=>cloud.getWithMetadata('../'+id,'stream'));await assert.rejects(()=>cloud.list({prefix:'../'}));
});

test('fetch is invoked without binding the storage adapter as its receiver',async()=>{
 const {env}=mockWebdav();let receiver;
 const cloud=new NextcloudStorage(env,function(){receiver=this;return Promise.resolve(new Response(null,{status:404}));});
 assert.equal((await cloud.readText('ideas:board')).value,null);assert.equal(receiver,undefined);
});
test('known upload size uses the Workers fixed-length stream to avoid empty WebDAV files',async()=>{
 const prior=globalThis.FixedLengthStream;let length;
 globalThis.FixedLengthStream=class{constructor(size){length=size;return new TransformStream();}};
 try{const {cloud}=mockWebdav();await cloud.putFile(key,'test bytes',{name:'test.txt',type:'text/plain',uploadedAt:'2030-01-01',size:10});assert.equal(length,10);assert.equal(new TextDecoder().decode((await cloud.getWithMetadata(key,'arrayBuffer')).value),'test bytes');}
 finally{if(prior===undefined)delete globalThis.FixedLengthStream;else globalThis.FixedLengthStream=prior;}
});

test('WebDAV property fallback recovers stripped ETags and conditionally refetches the matching body',async()=>{
 const {env}=mockWebdav();let path;const calls=[];
 const cloud=new NextcloudStorage(env,async(url,options)=>{path=new URL(url).pathname;calls.push(options);if(options.method==='PROPFIND')return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href><d:propstat><d:prop><d:getetag>&quot;dav-v1&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207});return new Response(options.headers['if-match']?'latest body':'discarded body');});
 const record=await cloud.readText('calendar:snapshot');assert.equal(record.value,'latest body');assert.equal(record.etag,'"dav-v1"');assert.equal(calls.length,3);assert.equal(calls[2].headers['if-match'],'"dav-v1"');
});
test('fallback refuses missing DAV versions and detects a race before the conditional read',async()=>{
 const {env}=mockWebdav();
 const cloud=new NextcloudStorage(env,async(url,options)=>{if(options.method==='PROPFIND')return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(url).pathname}</d:href><d:propstat><d:prop><d:getetag>&quot;old&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207});return options.headers['if-match']?new Response(null,{status:412}):new Response('old body');});
 await assert.rejects(()=>cloud.readText('calendar:snapshot'),StorageConflict);
 const missing=new NextcloudStorage(env,async(url,options)=>options.method==='PROPFIND'?new Response('<d:multistatus xmlns:d="DAV:"/>',{status:207}):new Response('body'));
 await assert.rejects(()=>missing.readText('calendar:snapshot'),e=>e.reason==='etag');
});


test('metadata listings use at most four concurrent reads and preserve the DAV order',async()=>{
 const f=mockWebdav(),names=[];
 for(let i=0;i<9;i++){
  const id=crypto.randomUUID();names.push('test-event/'+id);
  f.files.set(f.root+'/metadata/test-event/'+id+'.json',{bytes:new Uint8Array(),etag:'"v1"'});
 }
 let active=0,max=0;
 f.cloud.metadata=async key=>{
  active++;max=Math.max(max,active);
  await new Promise(resolve=>setTimeout(resolve,5));active--;
  return {name:key};
 };
 const result=await f.cloud.list({prefix:'test-event/'});
 assert.equal(max,4);assert.equal(active,0);assert.deepEqual(result.keys.map(row=>row.name),names);
});
