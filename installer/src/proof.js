import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest();
export function beginProof(challenge) {
 const {challengeToken,seed,k,g}=challenge||{};
 const bytes=Buffer.from(typeof seed==='string'?seed:'','base64url');
 if(typeof challengeToken!=='string'||!challengeToken||bytes.length!==32||!Number.isInteger(k)||k<1||!Number.isInteger(g)||g<1||k*g>64000000||k>64000)throw new Error('unsupported-challenge');
 const hash=sha(bytes);
 return {challengeToken,k,g,segment:0,iteration:0,hash:hash.toString('base64'),first:hash.toString('base64'),blocks:0};
}
export function advanceProof(progress,budget=500000) {
 let hash=Buffer.from(progress.hash,'base64'),segment=progress.segment,iteration=progress.iteration;
 const checkpoints=[];
 for(let work=0;work<budget&&segment<progress.k;work++) {
  hash=sha(hash);iteration++;
  if(iteration===progress.g){iteration=0;segment++;checkpoints.push(hash);if(checkpoints.length>=3000)break;}
 }
 return {progress:{...progress,hash:hash.toString('base64'),segment,iteration,blocks:progress.blocks+1},block:Buffer.concat(checkpoints),done:segment===progress.k};
}
