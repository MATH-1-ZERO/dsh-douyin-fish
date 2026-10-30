// Re-checking a recorded native mention must stay read-only: no candidate is
// chosen, nothing is typed, nothing is submitted, and only our own local
// receipt is allowed to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkOwnerMention} from '../../src/native-mention.js';
import {freshState,validateState} from '../../src/engine.js';
import {interactionTargetHash,validateIntent} from '../../src/interaction-gate.js';
import {commentFingerprint} from '../../src/comment-policy.js';
const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('../../personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const owner='verified_owner_123',T=Date.parse('2026-10-24T12:00:00+08:00');
const videoId='7700205679987183205',sourceRef='https://www.douyin.com/video/'+videoId,text='念鱼 米饭给小鱼留一口';
const attemptId='11111111-2222-3333-4444-555555555555';
function fixture({status='uncertain',found=true,refusal=null,withDraft=true}={}){
 let s=freshState(),phases=[],reads=0;
 s.paused=false;s.resources.persona=structuredClone(persona);s.resources.persona.ownerId=owner;
 s.resources.ownerIdentity={verified:true,platformId:owner,ownerHandle:'owner_handle'};
 s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 // The ledger key is always the normalized intent, even when the owner passed a
 // jingxuan modal URL; the re-check must resolve that same record.
 const key=interactionTargetHash(validateIntent({kind:'comment',sourceRef:'https://www.douyin.com/jingxuan?modal_id='+videoId,videoId,text,nativeMentionOwnerId:owner}));
 const attempt={id:attemptId,key,kind:'comment',at:T,status,receiptId:status==='confirmed'?'ui-native-mention:old':null,nativeMentionOwnerId:owner};
 s.resources.interactionAttempts=[attempt];
 if(withDraft)s.resources.manualDrafts=[{id:'draft-1',kind:'comment',recipientHint:'可见评论作者',sourceHash:'a'.repeat(64),text,time:T,status:'send_uncertain',deliveryAttemptId:attemptId}];
 const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const readOperation=async(_browser,{operation})=>{
  phases.push(operation.phase);
  if(operation.phase!=='native_mention_receipt')return {allowed:true,operationResult:{ready:true}};
  if(refusal)return {allowed:true,operationResult:{ready:false,reason:refusal}};
  return {allowed:true,operationResult:{ready:true,editorEmpty:true,matches:found?[{ownerMentionLinked:true,authorId:'author_1'}]:[]}};
 };
 const deps={store,signal:undefined,delay:async()=>{},
  publicProof:async()=>({allowed:true,proof:{ownerName:'念鱼',avatarResource:'/img/aweme-avatar/tos-cn-i-0000/1'}}),
  read:async(_settings,_args,opts)=>{reads++;return opts.run({});},
  run:async options=>({allowed:true,report:{result:await options.afterReady({settings:{},read:readOperation,signal:undefined})}})};
 return {deps,store,get state(){return s;},get phases(){return phases;},get reads(){return reads;}};
}
const args={confirm:'check_one_recorded_native_owner_mention',attemptId,sourceRef,text};
test('a re-check needs the explicit confirmation and never reads without it',async()=>{
 const f=fixture();
 assert.equal((await checkOwnerMention(base,{},f.deps)).reason,'explicit_native_mention_check_required');
 assert.equal(f.reads,0);
 assert.equal((await checkOwnerMention(base,{...args,confirm:'check'},f.deps)).reason,'explicit_native_mention_check_required');
 assert.equal(f.reads,0);
});
test('unknown or already-settled attempts are reported without opening a window',async()=>{
 const f=fixture();
 assert.equal((await checkOwnerMention(base,{...args,attemptId:'22222222-2222-3333-4444-555555555555'},f.deps)).reason,'recorded_native_mention_not_found');
 assert.equal(f.reads,0);
 const done=fixture({status:'confirmed'});
 const r=await checkOwnerMention(base,args,done.deps);
 assert.equal(r.allowed,true);assert.equal(r.alreadyConfirmed,true);assert.equal(r.receiptId,'ui-native-mention:old');assert.equal(done.reads,0);
 const applied=fixture({status:'not_applied'});
 assert.equal((await checkOwnerMention(base,args,applied.deps)).reason,'native_mention_not_pending_confirmation');
 assert.equal(applied.reads,0);
});
test('a visible comment with the structured mention upgrades the receipt and the draft, and submits nothing',async()=>{
 const f=fixture();
 const r=await checkOwnerMention(base,args,f.deps);
 assert.equal(r.allowed,true);assert.equal(r.status,'confirmed');assert.equal(r.sendingPerformed,false);
 assert.equal(r.receiptId,'ui-native-mention:'+commentFingerprint(videoId,'author_1',text));
 assert.equal(f.state.resources.interactionAttempts[0].status,'confirmed');
 assert.equal(f.state.resources.interactionAttempts[0].reconciliationMethod,'fresh_public_comment_observation');
 assert.equal(f.state.resources.manualDrafts[0].status,'confirmed_sent');
 assert.deepEqual(f.phases.filter(p=>p!=='native_mention_receipt'),[]);
 assert.equal(f.phases.includes('native_mention_submit'),false);
 assert.equal(f.phases.includes('native_mention_send'),false);
});
test('not finding the comment keeps the attempt uncertain and never resends',async()=>{
 const f=fixture({found:false});
 const r=await checkOwnerMention(base,args,f.deps);
 assert.equal(r.allowed,false);assert.equal(r.reason,'native_mention_not_found');assert.equal(r.sendingPerformed,false);
 assert.equal(f.state.resources.interactionAttempts[0].status,'uncertain');
 assert.equal(f.state.resources.manualDrafts[0].status,'send_uncertain');
 assert.equal(f.phases.includes('native_mention_submit'),false);
});
test('a refused receipt probe is reported as inconclusive instead of claimed',async()=>{
 const f=fixture({refusal:'Comment panel not visible'});
 const r=await checkOwnerMention(base,args,f.deps);
 assert.equal(r.allowed,false);assert.equal(r.reason,'native_mention_check_inconclusive');assert.equal(r.refusal,'Comment panel not visible');
 assert.equal(f.state.resources.interactionAttempts[0].status,'uncertain');
});
test('only the exact recorded text matches, and @ / links are still refused',async()=>{
 const f=fixture();
 assert.equal((await checkOwnerMention(base,{...args,text:'另一段没有记录过的话'},f.deps)).reason,'recorded_native_mention_not_found');
 assert.equal(f.reads,0);
 await assert.rejects(()=>checkOwnerMention(base,{...args,text:undefined},f.deps),/Exact recorded native mention required/);
 await assert.rejects(()=>checkOwnerMention(base,{...args,text:'@念鱼 来一口'},f.deps),/Exact recorded native mention required/);
 await assert.rejects(()=>checkOwnerMention(base,{...args,text:'https://x.y'},f.deps),/Exact recorded native mention required/);
});
test('an unverified owner or a swapped owner never reaches the browser',async()=>{
 const f=fixture();
 f.state.resources.ownerIdentity.verified=false;
 const store={snapshot:async()=>structuredClone(f.state),transact:async fn=>{throw Error('Must not write');}};
 const r=await checkOwnerMention(base,args,{...f.deps,store});
 assert.equal(r.reason,'verified_owner_required');assert.equal(f.reads,0);
});
