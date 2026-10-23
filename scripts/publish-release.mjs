// Publishes the CHANGELOG.md section of the current package.json version as a GitHub release.
// Usage: GITHUB_TOKEN=… npm run release   (token needs "Contents: write" on FinCreeper1/PAC)
import {readFile} from 'node:fs/promises';
import {releaseNotes} from '../installer/scripts/release-notes.mjs';
const root=new URL('../',import.meta.url),repo='FinCreeper1/PAC';
const version='v'+JSON.parse(await readFile(new URL('package.json',root),'utf8')).version;
const notes=releaseNotes(await readFile(new URL('CHANGELOG.md',root),'utf8'),version);
if(!notes)throw new Error('CHANGELOG.md enthält keinen Abschnitt „## '+version+'“.');
const token=process.env.GITHUB_TOKEN;
if(!token)throw new Error('GITHUB_TOKEN fehlt.');
const headers={accept:'application/vnd.github+json',authorization:'Bearer '+token,'user-agent':'PAC-Release','x-github-api-version':'2022-11-28'};
const existing=await fetch('https://api.github.com/repos/'+repo+'/releases/tags/'+version,{headers});
const body=JSON.stringify({tag_name:version,name:'PAC '+version,body:notes,target_commitish:process.env.RELEASE_TARGET||'main'});
const response=existing.ok
 ?await fetch('https://api.github.com/repos/'+repo+'/releases/'+(await existing.json()).id,{method:'PATCH',headers,body:JSON.stringify({name:'PAC '+version,body:notes})})
 :await fetch('https://api.github.com/repos/'+repo+'/releases',{method:'POST',headers,body});
if(!response.ok)throw new Error('GitHub antwortete mit HTTP '+response.status+': '+await response.text());
console.log((existing.ok?'Release aktualisiert: ':'Release erstellt: ')+(await response.json()).html_url);
