import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {freshState,validateState} from './engine.js';import {confirmOwnerReceipt} from './owner-receipt.js';import {validateIntent,interactionTargetHash} from './interaction-gate.js';
import {freshOwnerReplies} from './owner-reply-state.js';
import {liveVerificationView} from './live-verification.js';
const owner='owner_verified_123',videoId='7699788489050574090',sourceRef='https://www.douyin.com/video/'+videoId,id='12345678-1234-1234-1234-123456789abc',time=1800000000000;
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
function fixture(mention=false){const s=freshState();s.resources.persona={...structuredClone(persona),ownerId:owner};s.resources.ownerIdentity={verified:true,platformId:owner,ownerHandle:'owner_handle'};const target=validateIntent(mention?{kind:'comment',videoId,sourceRef,text:'老大看这里',nativeMentionOwnerId:owner}:{kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:owner,sourceRef:'https://www.douyin.com/user/'+owner,text:'native_video_card',nativeCardVideoId:videoId});s.resources.interactionAttempts=[{id,key:interactionTargetHash(target),kind:target.kind,at:time-1000,status:'uncertain',receiptId:null,...(mention?{nativeMentionOwnerId:owner}:{})}];return s;}
test('owner confirmation is exact, records its human source and never sends or enables automation',()=>{
 for(const mention of [true,false]){const s=fixture(mention),r=confirmOwnerReceipt(s,{confirm:mention?'owner_saw_exact_mention_and_notification':'owner_opened_exact_native_card',kind:mention?'native_mention':'native_card',attemptId:id,sourceRef,...(mention?{text:'老大看这里'}:{})},time);validateState(r.state);assert.equal(r.value.allowed,true);assert.equal(r.value.source,'owner_confirmation');assert.equal(r.value.sendingPerformed,false);assert.equal(s.paused,true);assert.equal(s.resources.interactionAttempts[0].ownerConfirmedReceived,true);}
});
test('wrong text, wrong video, wrong owner, pre-submit failures and missing confirmation cannot resolve a receipt',()=>{
 const good={confirm:'owner_saw_exact_mention_and_notification',kind:'native_mention',attemptId:id,sourceRef,text:'老大看这里'};
 for(const delta of [{text:'别的话'},{sourceRef:'https://www.douyin.com/video/7551370789157637436'},{attemptId:'unknown'},{confirm:'model_thinks_delivered'}]){const s=fixture(true);assert.equal(confirmOwnerReceipt(s,{...good,...delta},time).value.allowed,false);assert.equal(s.resources.interactionAttempts[0].status,'uncertain');}
 const failed=fixture(true);failed.resources.interactionAttempts[0].status='not_applied';assert.equal(confirmOwnerReceipt(failed,good,time).value.allowed,false);
 const changed=fixture(true);changed.resources.persona.ownerId='different_owner';assert.equal(confirmOwnerReceipt(changed,good,time).value.allowed,false);
});

test('plain owner reply receipt requires exact text and explicit human confirmation',()=>{
 const source='https://www.douyin.com/user/'+owner,text='老大，小鱼在打工呢。';
 const s=fixture();s.resources.interactionAttempts[0]={id,kind:'dm',key:interactionTargetHash(validateIntent({kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:owner,sourceRef:source,text})),at:time-1000,status:'confirmed',receiptId:'local-only'};
 s.resources.ownerReplies={...freshOwnerReplies(),ownerId:owner,events:[{key:'a'.repeat(64),at:time-1000,status:'confirmed',attemptId:id}]};
 const good={confirm:'owner_received_exact_dm',kind:'owner_dm',attemptId:id,sourceRef:source,text};
 assert.equal(liveVerificationView(s).ownerReplyLiveVerified,false);
 for(const change of [{text:'不同内容'},{sourceRef:source+'other'},{confirm:'model_says_received'},{attemptId:'unknown'}])assert.equal(confirmOwnerReceipt(structuredClone(s),{...good,...change},time).value.allowed,false);
 const result=confirmOwnerReceipt(s,good,time);validateState(result.state);
 assert.equal(result.value.ownerReplyLiveVerified,true);assert.equal(s.paused,true);
 assert.equal(result.value.sendingPerformed,false);
 s.resources.ownerIdentity.platformId='changed_owner';
 assert.equal(liveVerificationView(s).ownerReplyLiveVerified,false);
});
