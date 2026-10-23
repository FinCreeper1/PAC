import {versionAssets} from './asset-versions.mjs';
import {releaseNotes} from './release-notes.mjs';
import {build} from 'esbuild';
import {readdir,readFile,writeFile,mkdir,stat,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),assets={};
await build({entryPoints:[path.join(root,'node_modules/qrcode/lib/browser.js')],bundle:true,format:'iife',globalName:'QRCode',platform:'browser',minify:true,legalComments:'inline',outfile:path.join(root,'public/qrcode.js')});
let template=path.resolve(root,'../dist-template');
try{
 const parentTrip=JSON.parse(await readFile(path.resolve(root,'../public/data/trip.json'),'utf8'));
 if(parentTrip.id==='pac-demo')template=path.resolve(root,'..');
}catch{}
if(template!==path.resolve(root,'..')) {
 template=path.join(await mkdtemp(path.join(tmpdir(),'pac-template-')),'export');
 await promisify(execFile)(process.execPath,[path.resolve(root,'../scripts/export-template.mjs')],{env:{...process.env,PAC_TEMPLATE_OUTPUT:template}});
}
async function walk(dir) {
 for(const entry of await readdir(dir,{withFileTypes:true})) {
  const absolute=path.join(dir,entry.name);
  if(entry.isDirectory()) await walk(absolute);
  else {
   const route='/'+path.relative(path.join(template,'public'),absolute).split(path.sep).join('/');
   const buffer=await readFile(absolute);assets[route]=buffer.toString('base64');
  }
 }
}
await walk(path.join(template,'public'));
versionAssets(assets);
const trip=JSON.parse(Buffer.from(assets['/data/trip.json'],'base64'));
if(trip.id!=='pac-demo'||trip.participants.some(name=>!['Person A','Person B'].includes(name))) throw new Error('Nur die bereinigte PAC-Vorlage darf eingebaut werden.');
const source=`import core,{Portal as CorePortal} from ${JSON.stringify(path.join(template,'src/index.js'))};
const files=${JSON.stringify(assets)};
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',webmanifest:'application/manifest+json'};
const ASSETS={async fetch(request){let p=new URL(request.url).pathname;if(p==='/')p='/index.html';if(p==='/admin'||p==='/admin/')p='/admin/index.html';const value=files[p];if(value===undefined)return new Response('Nicht gefunden',{status:404});return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(value),c=>c.charCodeAt(0)),{headers:{'content-type':types[p.split('.').at(-1)]||'application/octet-stream','cache-control':'private, no-store'}});}};
export class Portal extends CorePortal{constructor(state,env){super(state,{...env,ASSETS,PAC_VERSION:'__PAC_VERSION__'});}}
export default core;`;
const result=await build({stdin:{contents:source,resolveDir:root,sourcefile:'pac-payload.js'},bundle:true,nodePaths:[path.resolve(root,'../node_modules')],format:'esm',platform:'browser',target:'es2022',write:false,minify:true,legalComments:'inline'});
// Teachers see readable releases: the version comes from package.json, its notes from CHANGELOG.md.
const draft=result.outputFiles[0].text,version='v'+JSON.parse(await readFile(path.resolve(root,'../package.json'),'utf8')).version;
if(!/^v\d+\.\d+\.\d+$/.test(version))throw new Error('Die PAC-Version in package.json muss wie 1.0.5 aufgebaut sein.');
const notes=releaseNotes(await readFile(path.resolve(root,'../CHANGELOG.md'),'utf8'),version);
if(!notes)throw new Error('CHANGELOG.md enthält keinen Abschnitt „## '+version+'“. Bitte Versionshinweise ergänzen.');
const fingerprint=createHash('sha256').update(draft).digest('hex').slice(0,12);
if(!draft.includes('__PAC_VERSION__'))throw new Error('PAC-Version konnte nicht eingebaut werden.');
const output=draft.replace('__PAC_VERSION__',version);
if(Buffer.byteLength(output)>2800000) throw new Error('PAC-Payload überschreitet das Größenbudget.');
await mkdir(path.join(root,'generated'),{recursive:true});await writeFile(path.join(root,'generated/pac-worker.txt'),output);await writeFile(path.join(root,'generated/pac-version.txt'),version);await writeFile(path.join(root,'generated/pac-notes.txt'),notes);
console.log('Bereinigte PAC-Vorlage eingebaut: '+Object.keys(assets).length+' Assets, '+Buffer.byteLength(output)+' Bytes, Version '+version+' (Code '+fingerprint+').');
