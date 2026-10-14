import assert from 'node:assert/strict';
const base='http://127.0.0.1:8793';
const session=await fetch(base+'/api/session');assert.equal(session.status,200);
const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
const post=(path,body)=>fetch(base+'/api/'+path,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
assert.equal((await post('login',{csrf:'wrong'})).status,403);
const login=await post('login',{csrf});assert.equal(login.status,200);const target=new URL((await login.json()).url);
assert.equal(target.origin,'https://dash.cloudflare.com');assert.equal(target.searchParams.get('code_challenge_method'),'S256');
const callback=await fetch(base+'/oauth/callback?'+new URLSearchParams({state:target.searchParams.get('state'),code:'fixture-code'}),{headers:{cookie},redirect:'manual'});assert.equal(callback.status,303);
assert.equal((await post('start',{csrf,accountId:'a'.repeat(32)})).status,200);
let data;
for(let attempt=0;attempt<40;attempt++){
 data=await (await fetch(base+'/api/status',{headers:{cookie}})).json();if(['ready','failed'].includes(data.stage))break;
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.equal(data.stage,'ready',JSON.stringify(data));assert.equal(data.previewUrl,'https://pac.fixture.workers.dev');assert.equal(JSON.stringify(data).includes('fixture-private-token'),false);
const other=await fetch(base+'/api/session'),otherCookie=other.headers.get('set-cookie').split(';')[0];assert.equal((await (await fetch(base+'/api/status',{headers:{cookie:otherCookie}})).json()).stage,'idle');
const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Mit Cloudflare anmelden/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
console.log('Workerd HTTP integration passed: PKCE login, callback, explicit account selection, alarm deployment, private results and session isolation. Cloudflare endpoints simulated; no visual tests.');
