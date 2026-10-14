import assert from 'node:assert/strict';
const base='http://127.0.0.1:8793';
const session=await fetch(base+'/api/session');assert.equal(session.status,200);
const cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
const post=body=>fetch(base+'/api/start',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
assert.equal((await post({csrf})).status,403);
assert.equal((await post({csrf,acceptTerms:true,acceptPrivacy:true})).status,200);
let data;
for(let attempt=0;attempt<40;attempt++) {
 const response=await fetch(base+'/api/status',{headers:{cookie}});assert.equal(response.status,200);data=await response.json();
 if(data.stage==='ready'||data.stage==='failed')break;
 await new Promise(resolve=>setTimeout(resolve,500));
}
assert.equal(data.stage,'ready',JSON.stringify(data));assert.equal(data.claimUrl,'https://dash.cloudflare.com/claim-preview?claimToken=fixture-private-claim');
assert.equal(JSON.stringify(data).includes('fixture-private-token'),false);
const other=await fetch(base+'/api/session'),otherCookie=other.headers.get('set-cookie').split(';')[0];
assert.equal((await (await fetch(base+'/api/status',{headers:{cookie:otherCookie}})).json()).stage,'idle');
const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/Eigene PAC-Instanz erstellen/);
assert.equal(page.headers.get('referrer-policy'),'no-referrer');
console.log('Workerd HTTP integration passed: consent, alarms, full mocked deployment, private result, session isolation and page delivery. No Cloudflare accounts created.');
