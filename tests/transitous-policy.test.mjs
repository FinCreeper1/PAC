import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Portal} from '../src/index.js';
import {mockWebdav} from './helpers/webdav.mjs';

test('admin import enforces policy and persistent portal budget before reaching Transitous',async()=>{
 const rows=new Map();
 const storage={get:async key=>rows.get(key),put:async(key,value)=>rows.set(key,value),delete:async key=>rows.delete(key)};
 const env={TRANSITOUS_USAGE_CONFIRMED:'false',PORTAL_PASSWORD:'portal',ADMIN_PASSWORD:'admin',SESSION_SECRET:'test-secret',cloudStorage:mockWebdav().cloud};
 const portal=new Portal({storage},env);
 const call=(path,options={})=>portal.fetch(new Request('https://portal.test'+path,options));
 const login=await call('/admin/login',{method:'POST',body:new URLSearchParams({password:'admin'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const session=[...rows.entries()].find(([key])=>key.startsWith('session:'))[1];
 const options={method:'POST',headers:{cookie,'x-csrf-token':session.csrf},body:JSON.stringify({search:{origin:'Hamburg Hbf',destination:'Aachen Hbf',date:'2026-10-17',time:'08:00'}})};
 assert.equal((await call('/api/admin/journey-import',options)).status,503);
 assert.equal(rows.has('transitous:next-search:v1'),false);
 env.TRANSITOUS_USAGE_CONFIRMED='true';env.TRANSITOUS_CONTACT='operator@example.org';
 rows.set('transitous:next-search:v1',Date.now()+60000);
 assert.equal((await call('/api/admin/journey-import',options)).status,429);
});

test('pasted journeys bypass routing policy and rate limit and require explicit selection',async()=>{
 const rows=new Map([['transitous:next-search:v1',Date.now()+60000]]);
 const storage={get:async key=>rows.get(key),put:async(key,value)=>rows.set(key,value),delete:async key=>rows.delete(key)};
 const portal=new Portal({storage},{TRANSITOUS_USAGE_CONFIRMED:'false',PORTAL_PASSWORD:'portal',ADMIN_PASSWORD:'admin',SESSION_SECRET:'test-secret',cloudStorage:mockWebdav().cloud});
 const call=(path,options={})=>portal.fetch(new Request('https://portal.test'+path,options));
 const login=await call('/admin/login',{method:'POST',body:new URLSearchParams({password:'admin'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const session=[...rows.entries()].find(([key])=>key.startsWith('session:'))[1];
 const budget=rows.get('transitous:next-search:v1');
 const response=await call('/api/admin/journey-import',{method:'POST',headers:{cookie,'x-csrf-token':session.csrf},body:JSON.stringify({url:'26.10.2026\nvon Hamburg Hbf, Abfahrt 08:00 mit ICE 123\nnach Aachen Hbf, Ankunft 13:00 mit RE 1'})});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.source,'text');
 assert.equal(result.recommended,null);
 assert.equal(result.choices[0].incomplete,true);
 assert.equal(rows.get('transitous:next-search:v1'),budget);
});

test('complete share text still searches Transitous for actual train sections',async()=>{
 const rows=new Map(),storage={get:async key=>rows.get(key),put:async(key,value)=>rows.set(key,value),delete:async key=>rows.delete(key)};
 const portal=new Portal({storage},{PORTAL_PASSWORD:'portal',ADMIN_PASSWORD:'admin',SESSION_SECRET:'test-secret',PAC_VERSION:'v1.0.13',cloudStorage:mockWebdav().cloud});
 const call=(path,options={})=>portal.fetch(new Request('https://portal.test'+path,options));
 const login=await call('/admin/login',{method:'POST',body:new URLSearchParams({password:'admin'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const session=[...rows.entries()].find(([key])=>key.startsWith('session:'))[1];
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/geocode'))return Response.json([{type:'STOP',id:'stop:'+parsed.searchParams.get('text'),name:parsed.searchParams.get('text')}]);
  return Response.json({itineraries:[{legs:[{mode:'RAIL',displayName:'ICE 123',from:{name:'Hamburg Hbf'},to:{name:'Aachen Hbf'},scheduledStartTime:'2026-10-26T07:00:00Z',scheduledEndTime:'2026-10-26T12:00:00Z'}]}]});
 };
 try {
  const response=await call('/api/admin/journey-import',{method:'POST',headers:{cookie,'x-csrf-token':session.csrf},body:JSON.stringify({url:'26.10.2026\nvon Hamburg Hbf, Abfahrt 08:00 mit ICE 123\nnach Aachen Hbf, Ankunft 13:00 mit ICE 123'})});
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.source,'transitous');assert.equal(result.recommended,null);
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.options.headers['User-Agent']==='PAC/1.0.13 (https://github.com/FinCreeper1/PAC)'));
  const options={method:'POST',headers:{cookie,'x-csrf-token':session.csrf},body:JSON.stringify({url:'26.10.2026\nvon Hamburg Hbf, Abfahrt 08:00 mit ICE 123\nnach Aachen Hbf, Ankunft 13:00 mit ICE 123'})};
  const repeated=await call('/api/admin/journey-import',options);
  assert.equal((await repeated.json()).source,'transitous');
  assert.equal(calls.length,3,'identical retry reuses cached connections');
  const limited=await call('/api/admin/journey-import',{...options,body:options.body.replace('08:00','08:01')});
  assert.equal(limited.status,429,'rate limit must not masquerade as incomplete text');
  const error=await limited.json();assert.ok(error.retryAfter>0 && error.retryAfter<=60);
  assert.equal(error.choices,undefined);

 } finally {globalThis.fetch=originalFetch;}
});
