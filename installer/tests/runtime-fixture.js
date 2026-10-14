import {InstallJob as BaseJob,InstallLimits} from '../src/jobs.js';
import {route} from '../src/router.js';
export {InstallLimits};
export class InstallJob extends BaseJob {
 constructor(state,env){super(state,{...env,PAC_PAYLOAD:'test-payload',proofBudget:100,
 requestApi:async path=>path.endsWith('/challenge')?{challengeToken:'fixture',seed:Buffer.alloc(32,7).toString('base64url'),k:3,g:4}:{account:{id:'a'.repeat(32),apiToken:'fixture-private-token',expiresAt:new Date(Date.now()+3600000).toISOString()},claim:{url:'https://dash.cloudflare.com/claim-preview?claimToken=fixture-private-claim',expiresAt:new Date(Date.now()+3600000).toISOString()}},
 deployPac:async()=> 'https://pac.fixture.workers.dev'});}
}
export default {fetch:route};
