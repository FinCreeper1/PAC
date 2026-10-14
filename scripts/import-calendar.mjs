import {readFile} from 'node:fs/promises';
const file=process.argv[2],base=process.env.WORKER_URL,password=process.env.ADMIN_PASSWORD;
if(!file||!base||!password) throw new Error('Dateipfad, WORKER_URL und ADMIN_PASSWORD erforderlich.');
const origin=new URL(base);
if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname)) throw new Error('HTTPS erforderlich.');
const calendar=JSON.parse(await readFile(file,'utf8'));
const login=await fetch(new URL('/admin/login',origin),{method:'POST',body:new URLSearchParams({password}),redirect:'manual'});
if(login.status!==303) throw new Error('Adminanmeldung fehlgeschlagen.');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
try {
 const response=await fetch(new URL('/api/admin/calendar',origin),{headers:{cookie}});
 if(!response.ok) throw new Error(`Kalenderabruf fehlgeschlagen (${response.status}).`);
 const {revision,csrf}=await response.json();
 const saved=await fetch(new URL('/api/admin/calendar',origin),{method:'PUT',headers:{cookie,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({calendar,revision})});
 if(!saved.ok) throw new Error(`Import fehlgeschlagen (${saved.status}): ${(await saved.json()).error}`);
 console.log('Kalender erfolgreich veröffentlicht.');
} finally {
 const session=await fetch(new URL('/api/admin/calendar',origin),{headers:{cookie}});
 if(session.ok) {
  const {csrf}=await session.json();
  await fetch(new URL('/admin/logout',origin),{method:'POST',headers:{cookie,'x-csrf-token':csrf},redirect:'manual'});
 }
}
