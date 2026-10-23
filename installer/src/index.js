import payload from '../generated/pac-worker.txt';
import version from '../generated/pac-version.txt';
import notes from '../generated/pac-notes.txt';
import {route} from './router.js';
import {withCredit} from '../../src/credit.js';
import {InstallJob as Job,InstallLimits} from './jobs.js';
export {InstallLimits};
const release={PAC_VERSION:version.trim(),PAC_NOTES:notes.trim()};
export class InstallJob extends Job {constructor(state,env){super(state,{...env,PAC_PAYLOAD:payload,...release});}}
export default {async fetch(request,env){return withCredit(await route(request,{...env,...release}),{inlineStyle:false});}};
