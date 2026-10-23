import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(fail=false){
 const nodes=new Map(),calls=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#account'?'account-a':'',hidden:false,disabled:false,addEventListener(type,fn){this[type]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){}});return nodes.get(id);};
 const context=vm.createContext({$,api:async(path,body)=>{calls.push({path,body});if(path==='delete'&&fail)throw new Error('Unklarer Löschstatus');return {confirmationToken:'one-use'};},loadPacs:async()=>calls.push({path:'reload'}),error:message=>calls.push({path:'error',message}),rememberTarget(){}});
 vm.runInContext("let busy=false,updateTarget='';"+app.slice(app.indexOf('// Three explicit confirmations'),app.indexOf('let sharing=null;')),context);
 return {$,calls,open:()=>vm.runInContext("openDelete({name:'pac-berlin'})",context),submit:()=>$('#delete-form').submit({preventDefault(){}})};
}
test('delete dialogs send nothing before exact typing and final confirmation, and allow cancellation',async()=>{
 const h=harness();h.open();assert.match(h.$('#delete-description').textContent,/1 von 3/);assert.equal(h.calls.length,0);
 await h.submit();assert.match(h.$('#delete-description').textContent,/2 von 3/);assert.equal(h.$('#delete-next').disabled,true);
 h.$('#delete-input').value='pac-Berlin';h.$('#delete-input').input();await h.submit();assert.equal(h.calls.length,0);
 h.$('#delete-input').value='pac-berlin';h.$('#delete-input').input();await h.submit();assert.deepEqual(h.calls.map(c=>c.path),['delete-prepare']);assert.match(h.$('#delete-description').textContent,/3 von 3/);
 h.$('#delete-cancel').click();assert.equal(h.$('#delete-dialog').open,false);assert.equal(h.calls.length,1);
 h.open();await h.submit();h.$('#delete-input').value='pac-berlin';await h.submit();await h.submit();
 assert.deepEqual(h.calls.map(c=>c.path),['delete-prepare','delete-prepare','delete','reload']);assert.equal(h.calls[2].body.accountId,'account-a');assert.equal(h.calls[2].body.confirmationToken,'one-use');assert.equal(h.$('#delete-dialog').open,false);assert.match(h.$('#pacs-status').textContent,/endgültig gelöscht/);
});
test('Escape cancels and uncertain deletion reloads without retrying or showing success',async()=>{
 const h=harness(true);h.open();h.$('#delete-dialog').cancel({preventDefault(){}});assert.equal(h.$('#delete-dialog').open,false);assert.equal(h.calls.length,0);
 h.open();await h.submit();h.$('#delete-input').value='pac-berlin';await h.submit();await h.submit();await h.submit();
 assert.deepEqual(h.calls.map(c=>c.path),['delete-prepare','delete','reload','error']);assert.equal(h.$('#delete-dialog').open,false);
});
