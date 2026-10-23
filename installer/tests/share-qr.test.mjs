import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function harness({clipboard=true,native=true}={}){
 const nodes=new Map(),calls=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,style:{removeProperty(name){delete this[name];}},addEventListener(type,fn){this[type]=fn;},getContext(){return {clearRect(){}};},toBlob(fn){fn(new Blob(['png'],{type:'image/png'}));}});return nodes.get(id);};
 const navigator={clipboard:clipboard?{write:async items=>{calls.push(['copy',await items[0].data['image/png']]);}}:undefined,canShare:()=>native,share:async data=>calls.push(['share',data])};
 class ClipboardItem{constructor(data){this.data=data;}}
 class File extends Blob{constructor(data,name,options){super(data,options);this.name=name;}}
 const context=vm.createContext({$,navigator,window:{ClipboardItem},ClipboardItem,File,Blob,Promise,Error,QRCode:{toCanvas(canvas,url,options,callback){canvas.style.width=options.width+'px';canvas.style.height=options.width+'px';calls.push(['render',url,options]);callback();}},document:{createElement(){return {click(){calls.push(['download',this.download]);}};}},URL:{createObjectURL:()=> 'blob:qr',revokeObjectURL(){}},setTimeout(){}});
 vm.runInContext('let sharing={name:"Test",url:"https://example.com"};'+app.slice(app.indexOf('let qrBlobPromise='),app.indexOf("$('#share-copy').addEventListener")),context);
 return {nodes,$,calls,prepare:url=>vm.runInContext(`prepareShareQr({url:${JSON.stringify(url)}})`,context)};
}
test('QR encodes the selected PAC URL with a quiet zone and copies a PNG',async()=>{
 const h=harness();h.prepare('https://test4.example/');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.$('#share-qr-canvas').style.width,undefined);assert.equal(h.$('#share-qr-canvas').style.height,undefined);
 assert.equal(h.calls[0][1],'https://test4.example/');assert.equal(h.calls[0][2].margin,4);
 assert.equal(h.$('#share-qr-copy').disabled,false);
 await h.$('#share-qr-copy').click();assert.equal(h.calls[1][1].type,'image/png');assert.equal(h.$('#share-qr-copy').textContent,'Kopiert');
 h.prepare('https://other.example/');assert.equal(h.calls.at(-1)[1],'https://other.example/');assert.equal(h.$('#share-qr-copy').textContent,'Kopieren');
});
test('QR shares the image file through native sharing',async()=>{
 const h=harness();h.prepare('https://example.com');await h.$('#share-qr-send').click();
 const file=h.calls.find(call=>call[0]==='share')[1].files[0];assert.equal(file.type,'image/png');assert.equal(file.name,'reiseplan-qr.png');
});
test('unsupported image clipboard is disabled and unsupported sharing downloads PNG',async()=>{
 const h=harness({clipboard:false,native:false});h.prepare('https://example.com');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.$('#share-qr-copy').disabled,true);await h.$('#share-qr-send').click();assert.deepEqual(h.calls.at(-1),['download','reiseplan-qr.png']);
});

test('QR bundle is served through the installer router, including the install prefix',async()=>{
 const {route}=await import('../src/router.js');
 for(const prefix of ['', '/install']){
  let requested;
  const response=await route(new Request('https://example.com'+prefix+'/qrcode.js'),{ASSETS:{async fetch(request){requested=new URL(request.url).pathname;return new Response('qr bundle',{headers:{'content-type':'application/javascript'}});}}});
  assert.equal(response.status,200);assert.equal(requested,'/qrcode.js');assert.equal(await response.text(),'qr bundle');
 }
});

test('QR enlargement opens a full-resolution copy by click and keyboard and closes on background',()=>{
 const nodes=new Map(),calls=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{width:600,height:600,disabled:false,addEventListener(type,fn){this[type]=fn;},getContext(){return {drawImage(...args){calls.push(args);}};},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
 vm.runInNewContext(app.slice(app.indexOf('// QR enlargement'),app.indexOf("$('#share-dialog').addEventListener('click'")),{$});
 const source=$('#share-qr-canvas'),dialog=$('#share-qr-zoom');
 $('#share-url').value='https://test4.example/';
 source.click();assert.equal(dialog.open,true);assert.equal(calls[0][0],source);assert.equal($('#share-qr-large').width,600);
 assert.equal($('#share-qr-full-url').href,'https://test4.example/');assert.equal($('#share-qr-full-url').textContent,'https://test4.example/');
 $('#share-qr-large').click();assert.equal(dialog.open,false);source.click();
 dialog.click({target:dialog,currentTarget:dialog});assert.equal(dialog.open,false);
 for(const key of ['Enter',' ']){let prevented=false;source.keydown({key,preventDefault(){prevented=true;}});assert.equal(dialog.open,true);assert.equal(prevented,true);dialog.close();}
 $('#share-qr-send').disabled=true;source.click();assert.equal(dialog.open,false);
});
