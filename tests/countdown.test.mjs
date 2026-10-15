import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/script.js',import.meta.url),'utf8').split('// Only a confirmed outage')[0];
function countdown(events){
 const timer={},label={},value={closest:()=>timer,replaceChildren(...children){this.children=children;},setAttribute(name,value){this[name]=value;}};
 const handlers={};
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-16T00:00:00Z']));}}
 const context={Date:Clock,Intl,portalCalendar:{days:[{isoDate:'2026-10-26'}],events},setTimeout:()=>0,clearTimeout(){},document:{hidden:false,getElementById:id=>id.endsWith('value')?value:label,createElement:()=>({setAttribute(){},getAnimations:()=>[],animate(){}}),addEventListener(){}},window:{matchMedia:()=>({matches:true}),addEventListener:(name,handler)=>handlers[name]=handler}};
 vm.runInNewContext(source,context);handlers['portal-calendar-ready']();return {timer,label,value};
}
test('countdown uses actual next event and keeps every digit above 99 hours',()=>{
 const {timer,label,value}=countdown([{timing:'scheduled',day:1,title:'Aufstehen',startTime:'08:00'}]);
 assert.equal(timer.hidden,false);assert.match(label.textContent,/Aufstehen.*08:00/);
 assert.equal(value['aria-label'],'246:00:00');assert.equal(value.children.map(child=>child.textContent).join(''),'246:00:00');
});
test('empty or unscheduled calendars never invent a meeting countdown',()=>{
 for(const events of [[],[{timing:'unscheduled',day:1,title:'Idee',startTime:'07:00'}]]){
 const {timer,value}=countdown(events);assert.equal(timer.hidden,true);assert.equal(value.hidden,true);
 }
});
