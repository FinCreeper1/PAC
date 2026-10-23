import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/shared/offline-files.js',import.meta.url),'utf8');
const file=(date,id)=>({isoDate:date,url:`/api/files/visit/${id}`,name:`file${id}.pdf`,size:10000});
const defaultManifest={days:[{isoDate:'2099-10-12'},{isoDate:'2099-10-13'}],files:[file('2099-10-12',1),file('2099-10-12',2),file('2099-10-13',3)]};
async function setup({manifest=defaultManifest,online=true}={}){
 const nodes=new Map(),confirmations=[],saves=[],saved=new Set(),widths=[];
 const make=()=>({listeners:{},children:[],dataset:{},style:{},attributes:{},textContent:'',disabled:false,hidden:false,open:false,
  addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(name,value){this.attributes[name]=value;},focus(){},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;}});
 for(const id of ['offline-day-files','offline-day-title','offline-day-copy','offline-day-action','offline-scope','offline-scope-day','offline-scope-week','offline-progress','offline-progress-bar','offline-management','offline-management-summary','offline-management-days','offline-management-status','offline-remove-all'])nodes.set(id,make());
 const bar=nodes.get('offline-progress-bar');let width='';Object.defineProperty(bar.style,'width',{get:()=>width,set:v=>{width=v;widths.push(v);}});
 class Channel{constructor(){this.port1={close(){}};this.port2={peer:this.port1};}}
 const worker={postMessage(data,ports){queueMicrotask(()=>{
  const reply=r=>ports[0].peer.onmessage({data:{ok:true,...r}});
  if(data.type==='STATUS_DAY_FILES')reply({cached:data.files.filter(f=>saved.has(f.url)).length,total:data.files.length,urls:[...saved]});
  if(data.type==='LIST_DAY_FILES')reply({days:saved.size?[{isoDate:'2099-10-12',cached:saved.size,total:saved.size,bytes:saved.size*10000,complete:true}]:[]});
  if(data.type==='CACHE_DAY_FILES'){saves.push(data);assert.equal(nodes.get('offline-progress').hidden,false);for(const f of data.files)saved.add(f.url);
   reply({type:'CACHE_PROGRESS',file:'f.pdf',fileIndex:data.files.length,loaded:data.files.length*10000,percent:100});reply({});}
 });}};
 const context=vm.createContext({Intl,Date,MessageChannel:Channel,setTimeout:()=>1,clearTimeout(){},
  document:{getElementById:id=>nodes.get(id),createElement:make,querySelectorAll:()=>[],addEventListener(){}},
  navigator:{onLine:online,serviceWorker:{ready:Promise.resolve({active:worker})}},
  window:{portalCalendarReady:true,confirm:t=>{confirmations.push(t);return true;},addEventListener(){},removeEventListener(){}},
  localStorage:{setItem(){},getItem(){return null;}},fetch:async()=>({ok:true,json:async()=>manifest})});
 vm.runInContext(source,context);await new Promise(r=>setImmediate(r));
 return {nodes,saves,confirmations,widths,save:()=>nodes.get('offline-day-action').listeners.click()};
}
test('card previews the next day with a visible scope switch and downloads without a dialog',async()=>{
 const app=await setup(),card=app.nodes.get('offline-day-files');
 assert.equal(card.dataset.state,'missing');assert.equal(app.nodes.get('offline-day-action').textContent,'Herunterladen');
 assert.match(app.nodes.get('offline-scope-day').textContent,/12/);assert.equal(app.nodes.get('offline-scope-day').attributes['aria-checked'],'true');
 assert.match(app.nodes.get('offline-day-copy').textContent,/2 Dateien/);
 await app.save();
 assert.equal(app.confirmations.length,0);assert.equal(app.saves.length,1);assert.ok(app.widths.includes('100%'));
 assert.equal(card.dataset.state,'complete');assert.equal(app.nodes.get('offline-progress').hidden,true);
 assert.match(app.nodes.get('offline-day-copy').textContent,/Offline verfügbar/);assert.equal(app.nodes.get('offline-day-action').textContent,'Aktualisieren');
 assert.match(app.nodes.get('offline-management-summary').textContent,/1 Tag/);
});
test('switching to the whole trip only previews and the arrow keys toggle the scope',async()=>{
 const app=await setup();
 await app.nodes.get('offline-scope-week').listeners.click();
 assert.equal(app.saves.length,0);assert.match(app.nodes.get('offline-day-copy').textContent,/3 Dateien/);
 assert.equal(app.nodes.get('offline-scope-week').attributes['aria-checked'],'true');
 await app.nodes.get('offline-scope').listeners.keydown({key:'ArrowLeft',preventDefault(){}});
 assert.equal(app.nodes.get('offline-scope-day').attributes['aria-checked'],'true');
});
test('after the last travel day only the whole trip is offered',async()=>{
 const app=await setup({manifest:{days:[{isoDate:'2000-01-01'}],files:[file('2000-01-01',1)]}});
 assert.equal(app.nodes.get('offline-scope-day').hidden,true);assert.equal(app.nodes.get('offline-scope-week').attributes['aria-checked'],'true');
});
test('offline click explains the missing connection and empty scope disables the action',async()=>{
 const offline=await setup({online:false});await offline.save();assert.equal(offline.saves.length,0);assert.match(offline.nodes.get('offline-day-copy').textContent,/Internetverbindung/);
 const empty=await setup({manifest:{days:[{isoDate:'2099-10-12'}],files:[]}});
 assert.equal(empty.nodes.get('offline-day-action').disabled,true);assert.equal(empty.nodes.get('offline-day-files').dataset.state,'empty');
});
