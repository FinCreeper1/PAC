import payload from '../generated/pac-worker.txt';
import {route} from './router.js';
import {InstallJob as Job,InstallLimits} from './jobs.js';
export {InstallLimits};
export class InstallJob extends Job {constructor(state,env){super(state,{...env,PAC_PAYLOAD:payload});}}
export default {fetch(request,env){return route(request,env);}};
