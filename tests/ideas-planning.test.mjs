import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/shared/ideas-v2.js',import.meta.url),'utf8');
function planning(calendar,participants=['Person A']) {
 const elements=new Map();
 const element=()=>({value:'',options:[],disabled:false,replaceChildren(){this.options=[];this.value='';},append(option){this.options.push(option);},querySelector(){return get('submit');}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const trip={title:'Neue Reise',participants,timeZone:'Europe/Berlin'};
 const context={Intl,Date,document:{querySelectorAll:()=>[],getElementById:get,createElement:element},fetch:async url=>({ok:true,json:async()=>url.includes('trip')?trip:calendar})};
 const prefix=source.slice(0,source.indexOf('  dateInput.addEventListener'));
 const label=source.slice(source.indexOf('  function dayLabel'),source.indexOf('  function ideaCard'));
 vm.runInNewContext(prefix+label+'globalThis.load=loadPlanningConfig; globalThis.update=updateFreeTimes;})();',context);
 return {get,load:context.load,update:context.update};
}
test('ideas use actual sparse trip days and their released free times',async()=>{
 const state=planning({days:[{isoDate:'2030-05-06'},{isoDate:'2030-05-09'}],events:[{type:'free',timing:'scheduled',day:2,startTime:'16:00',endTime:'17:00'}]});
 assert.equal(state.get('submit').disabled,true);await state.load();
 assert.deepEqual(state.get('idea-date').options.map(o=>o.value),['2030-05-06','2030-05-09']);
 assert.equal(state.get('idea-date').value,'2030-05-09');
 assert.deepEqual(state.get('idea-time').options.map(o=>o.value),['','16:00','16:15','16:30','16:45']);
 assert.equal(state.get('submit').disabled,false);
 state.get('idea-date').value='2030-05-06';state.update();
 assert.equal(state.get('idea-time').disabled,true);assert.equal(state.get('submit').disabled,true);
});
test('refresh preserves valid selections and removes stale dates and times',async()=>{
 const calendar={days:[{isoDate:'2031-01-01'}],events:[{type:'free',timing:'scheduled',day:1,startTime:'10:00',endTime:'11:00'}]};
 const state=planning(calendar);await state.load();state.get('idea-time').value='10:15';state.get('idea-author').value='Person A';
 await state.load();assert.equal(state.get('idea-time').value,'10:15');assert.equal(state.get('idea-author').value,'Person A');
 calendar.days=[{isoDate:'2031-02-02'}];calendar.events=[];await state.load();
 assert.equal(state.get('idea-date').value,'2031-02-02');assert.equal(state.get('idea-time').value,'');assert.equal(state.get('submit').disabled,true);
 calendar.days=[];await state.load();assert.equal(state.get('idea-date').disabled,true);
});

test('ideas API saves the selected trip date, validates free windows and attendance',async()=>{
 await import('../public/shared/calendar-model.js');
 const {handleIdeas}=await import('../src/ideas.js');
 let stored=null;
 const cloud={readText:async()=>({value:stored,etag:null}),writeText:async(key,value)=>{stored=value;}};
 const snapshot={trip:{participants:['Person A','Person B']},calendar:{days:[{isoDate:'2030-05-09'}],events:[{day:99,type:'free',timing:'scheduled',startTime:'09:00',endTime:'10:00'},{day:1,type:'free',timing:'scheduled',startTime:'16:00',endTime:'17:00'}]}};
 const call=(method,body)=>handleIdeas(new Request('https://portal.test/api/ideas',{method,body:JSON.stringify(body),headers:{'content-type':'application/json'}}),cloud,snapshot,{ADMIN_PASSWORD:'admin'});
 const idea={text:'Museum',author:'Person A',date:'2030-05-09',time:'16:15'};
 assert.equal((await call('POST',{...idea,date:'2026-10-12'})).status,400);
 assert.equal((await call('POST',{...idea,time:'17:00'})).status,400);
 const saved=await call('POST',idea);assert.equal(saved.status,201);
 const {ideas}=await saved.json();assert.equal(ideas[0].date,idea.date);
 assert.equal((await call('PUT',{id:ideas[0].id,name:'Person B',attending:true})).status,200);
 assert.deepEqual(JSON.parse(stored)[0].participants,['Person A','Person B']);
 assert.equal((await call('DELETE',{id:ideas[0].id,password:'admin'})).status,200);assert.deepEqual(JSON.parse(stored),[]);
});


test('ideas explain missing participant names even when free time exists',async()=>{
 const state=planning({days:[{isoDate:'2030-05-09'}],events:[{type:'free',timing:'scheduled',day:1,startTime:'16:00',endTime:'17:00'}]},[]);
 await state.load();assert.equal(state.get('submit').disabled,true);assert.match(state.get('idea-free-time-hint').textContent,/Teilnehmende ergänzen/);
});
