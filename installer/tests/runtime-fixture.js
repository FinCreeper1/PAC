import {InstallJob as BaseJob,InstallLimits} from '../src/jobs.js';
import {route} from '../src/router.js';
export {InstallLimits};
export class InstallJob extends BaseJob {
 constructor(state,env){super(state,{...env,OAUTH_CLIENT_ID:'fixture-client',PAC_PAYLOAD:'test-payload',exchangeCode:async()=>({apiToken:'fixture-private-token',expiresAt:Date.now()+3600000}),requestApi:async()=>[{id:'a'.repeat(32),name:'Fixture account'}],deployPac:async()=> 'https://pac.fixture.workers.dev'});}
}
export default {fetch:route};
