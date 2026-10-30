import test from 'node:test';import assert from 'node:assert/strict';import {freshState,validateState} from '../../src/engine.js';
import {archiveUncertain,isBlockingAttempt} from '../../src/attempt-review.js';import {interactionDecision,validateIntent,interactionTargetHash} from '../../src/interaction-gate.js';
const time=1800000000000,videoId='7551370789157637436',old=validateIntent({kind:'comment',sourceRef:'https://www.douyin.com/video/'+videoId,videoId,text:'旧评论'}),id='12345678-1234-1234-1234-123456789abc';
function state(){const s=freshState();s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};s.resources.interactionAttempts=[{id,key:interactionTargetHash(old),kind:'comment',at:time-1000,status:'uncertain',receiptId:null}];s.resources.manualBrowserReads=[time-2000];return s;}
test('explicit archival preserves unknown status, usage and exact duplicate block; quarantined video remains blocked for automation',()=>{
 const s=state(),r=archiveUncertain(s,{confirm:'archive_uncertain_without_retry',attemptIds:[id],quarantineVideoIds:[videoId]},time);validateState(r.state);
 assert.equal(r.value.allowed,true);assert.equal(s.resources.interactionAttempts[0].status,'uncertain');assert.equal(isBlockingAttempt(s.resources.interactionAttempts[0]),false);assert.deepEqual(s.resources.manualBrowserReads,[time-2000]);
 s.paused=false;assert.equal(interactionDecision(s,old,{time:time+1}).reason,'video_quarantined_by_owner');
 assert.equal(interactionDecision(s,old,{ownerRequested:true,time:time+1}).reason,'interaction_duplicate');
 const next={...old,videoId:'7551370789157637437',sourceRef:'https://www.douyin.com/video/7551370789157637437'};assert.equal(interactionDecision(s,next,{time:time+1}).allowed,true);
});
test('archive rejects missing confirmation, active tasks, reserved entries, unknown IDs and partial batches',()=>{
 assert.equal(archiveUncertain(state(),{attemptIds:[id]},time).value.allowed,false);const active=state();active.paused=false;assert.equal(archiveUncertain(active,{confirm:'archive_uncertain_without_retry',attemptIds:[id]},time).value.allowed,false);
 for(const mutation of [s=>s.resources.interactionAttempts[0].status='reserved',s=>s.resources.interactionAttempts[0].status='confirmed']){const s=state();mutation(s);assert.throws(()=>archiveUncertain(s,{confirm:'archive_uncertain_without_retry',attemptIds:[id]},time));}
 const s=state();assert.throws(()=>archiveUncertain(s,{confirm:'archive_uncertain_without_retry',attemptIds:[id,'nonexistent']},time));assert.equal(s.resources.interactionAttempts[0].ownerAcknowledgedUncertain,undefined);
});
