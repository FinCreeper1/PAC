import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {build} from '../demo/build.mjs';

function loadShim(source){
  const network=[],storage=new Map(),listeners=[];
  const window={fetch:async url=>{network.push(String(url));return new Response('real');},XMLHttpRequest:class{}};
  const context=vm.createContext({window,location:new URL('https://pac-demo.example/'),crypto,Intl,Date,URL,Headers,Response,Request,Blob,EventTarget,setTimeout,JSON,
    Navigator:class{},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}},
    document:{body:null,addEventListener:(...args)=>listeners.push(args)}});
  vm.runInContext(source,context);
  return {fetch:window.fetch,network,storage,navigator:new context.Navigator()};
}
const berlinDate=offset=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));

test('demo build ships the portal with the shim but without real trip data',async()=>{
  const dist=await build(),top=await readdir(dist);
  assert.ok(!top.includes('data')&&!top.includes('materials'));
  for(const page of ['index.html','admin/index.html']){
    const html=await readFile(new URL(page,'file://'+dist+'/'),'utf8');
    assert.match(html,/<head>\s*<script src="\/demo-shim.js"><\/script>/);
    assert.match(html,/PAC-Demo<\/title>/);
  }
});

test('demo trip has already started and uploads stay in the browser',async()=>{
  const demo=loadShim(await readFile(new URL('../demo/demo-shim.js',import.meta.url),'utf8'));
  const calendar=await (await demo.fetch('/data/calendar.json')).json();
  assert.deepEqual(calendar.days.map(day=>day.isoDate),[berlinDate(-1),berlinDate(0),berlinDate(1)]);
  assert.equal((await (await demo.fetch('/data/trip.json')).json()).title,'Studienfahrt Berlin');
  const upload=await demo.fetch('/api/materials?project=d2-museum',{method:'PUT',headers:{'x-file-name':'Plan.pdf'},body:new Blob(['x'])});
  assert.equal(upload.status,201);
  const files=(await (await demo.fetch('/api/materials?project=d2-museum')).json()).files;
  assert.deepEqual(files.map(file=>file.name),['Plan.pdf']);
  assert.equal(await (await demo.fetch(`/api/files/d2-museum/${files[0].id}`)).text(),'x');
  const saved=await demo.fetch('/api/admin/calendar',{method:'PUT',body:JSON.stringify({calendar:{...calendar,events:calendar.events.slice(1)}})});
  assert.equal((await saved.json()).calendar.events.length,calendar.events.length-1);
  assert.deepEqual(demo.network,[]);
  await demo.fetch('https://example.org/x');
  assert.deepEqual(demo.network,['https://example.org/x']);
});

test('demo journeys have one transfer and simulated IRIS delays',async()=>{
  const demo=loadShim(await readFile(new URL('../demo/demo-shim.js',import.meta.url),'utf8'));
  const journeys=await (await demo.fetch('/data/journeys.json')).json(),calendar=await (await demo.fetch('/data/calendar.json')).json();
  assert.equal(journeys.hinfahrt.legs.length,2);
  assert.ok(calendar.events.some(event=>event.journeyId==='hinfahrt'));
  const date=calendar.days[0].isoDate.replaceAll('-','').slice(2);
  const plan=await (await demo.fetch(`https://iris.noncd.db.de/iris-tts/timetable/plan/8002549/${date}/08`)).text();
  const changes=await (await demo.fetch('https://iris.noncd.db.de/iris-tts/timetable/fchg/8002549')).text();
  assert.match(plan,new RegExp(`<tl n="1707"/><dp pt="${date}0800" pp="13"/>`));
  assert.match(changes,new RegExp(`<dp ct="${date}0804" cp="14"/>`));
  assert.deepEqual(demo.network,[]);
});

test('demo offline storage answers like the service worker without fetching files',async()=>{
  const demo=loadShim(await readFile(new URL('../demo/demo-shim.js',import.meta.url),'utf8'));
  const manifest=await (await demo.fetch('/api/offline-manifest')).json(),worker=(await demo.navigator.serviceWorker.ready).active;
  const ask=(data)=>new Promise(resolve=>{const channel=new MessageChannel(),messages=[];channel.port1.onmessage=({data})=>{messages.push(data);if(data.type!=='CACHE_PROGRESS'){channel.port1.close();resolve({result:data,messages});}};worker.postMessage(data,[channel.port2]);});
  const day=manifest.files[0].isoDate,files=manifest.files.filter(file=>file.isoDate===day);
  const saved=await ask({type:'CACHE_DAY_FILES',files,isoDate:day});
  assert.equal(saved.result.cached,files.length);
  assert.ok(saved.messages.some(message=>message.type==='CACHE_PROGRESS'));
  assert.equal((await ask({type:'STATUS_DAY_FILES',files:manifest.files})).result.cached,files.length);
  assert.deepEqual((await ask({type:'LIST_DAY_FILES',files:manifest.files})).result.days.map(entry=>[entry.isoDate,entry.complete]),[[day,true]]);
  await ask({type:'REMOVE_DAY_FILES',isoDate:day});
  assert.equal((await ask({type:'STATUS_DAY_FILES',files:manifest.files})).result.cached,0);
  assert.deepEqual(demo.network,[]);
});
