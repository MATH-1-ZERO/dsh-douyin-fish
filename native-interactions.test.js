import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {publishOwnerMention} from './native-mention.js';import {sendOwnerNativeCard} from './native-share.js';
import {validateIntent,interactionDecision,dispatchInteraction,interactionTargetHash} from './interaction-gate.js';
import {freshState,validateState} from './engine.js';import {nativeControls} from './live-browser/native-controls.mjs';
const id='owner_verified_123',videoId='7551370789157637436',sourceRef='https://www.douyin.com/video/'+videoId;
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
async function fixture(){let s=freshState();s.resources.persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));s.resources.persona.ownerId=id;s.resources.ownerIdentity={verified:true,platformId:id,ownerHandle:'test_owner_handle'};s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};return {store:{snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}},state:()=>s};}
test('native actions require their distinct confirmation and never fall back to a text link',async()=>{
 assert.equal((await sendOwnerNativeCard({}, {},{})).reason,'explicit_native_share_required');assert.equal((await publishOwnerMention({}, {},{})).reason,'explicit_native_mention_required');
 const f=await fixture();assert.equal((await sendOwnerNativeCard({...base,inboundPolicy:{allowOwner:false}},{confirm:'share_one_native_video_card_to_boss',sourceRef},{store:f.store})).reason,'owner_dm_disabled_by_policy');
 assert.equal((await sendOwnerNativeCard(base,{confirm:'share_one_native_video_card_to_boss',sourceRef},{store:f.store,autonomous:true})).reason,'native_share_live_verification_required');
 assert.equal((await publishOwnerMention(base,{confirm:'publish_one_native_owner_mention',sourceRef,text:'老大来看看'},{store:f.store,autonomous:true})).reason,'native_mention_live_verification_required');
});
test('native card keys distinguish videos and cannot be mixed with arbitrary link metadata',()=>{
 const intent={kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:id,sourceRef:'https://www.douyin.com/user/'+id,text:'native_video_card',nativeCardVideoId:videoId};
 assert.equal(validateIntent(intent).nativeCardVideoId,videoId);assert.notEqual(interactionTargetHash(validateIntent(intent)),interactionTargetHash(validateIntent({...intent,nativeCardVideoId:'7551370789157637437'})));
 for(const q of [{...intent,text:'https://evil.example/'},{...intent,sharedVideoId:videoId},{...intent,nativeCardVideoId:'not-a-video'}])assert.throws(()=>validateIntent(q));
});
test('mention requires actual verified owner; one explicit new native test never clears older unknown records',async()=>{
 const f=await fixture(),intent={kind:'comment',sourceRef,videoId,text:'老大来看看',nativeMentionOwnerId:id},time=Date.now();
 assert.equal(interactionDecision(f.state(),{...intent,nativeMentionOwnerId:'wrong_owner'},{ownerRequested:true,time}).reason,'verified_owner_mention_required');
 await f.store.transact(s=>{s.resources.interactionAttempts=[{id:'12345678-1234-1234-1234-123456789abc',key:'0'.repeat(64),kind:'comment',at:time-100,status:'uncertain',receiptId:null}];return {state:s,value:null};});
 assert.equal(interactionDecision(f.state(),intent,{ownerRequested:true,time}).allowed,true);
 assert.equal(interactionDecision({...f.state(),paused:false},intent,{ownerRequested:false,time}).reason,'interaction_result_unresolved');
 const r=await dispatchInteraction({store:f.store,intent,ownerRequested:true,now:()=>time,adapter:{inspectTarget:async t=>({ready:true,targetHash:interactionTargetHash(t)}),sendOnce:async()=>({verified:false})}});assert.equal(r.status,'uncertain');assert.equal(f.state().resources.interactionAttempts.length,2);
 assert.equal(interactionDecision(f.state(),{...intent,text:'换一句'},{ownerRequested:true,time}).reason,'interaction_result_unresolved');
});
test('native candidate must match name AND same avatar asset; CDN crop paths normalize but another user cannot match',()=>{
 const context={URL,location:{href:sourceRef},getComputedStyle:()=>({}),document:{elementFromPoint:()=>row}};
 const image={currentSrc:'https://p3-pc-sign.douyinpic.com/aweme/100x100/aweme-avatar/known-avatar.jpeg'},name={innerText:'测试主人'};
 const row={querySelectorAll:s=>s==='.lgAE_oZa'?[name]:s==='img'?[image]:[],getBoundingClientRect:()=>({left:10,top:10,width:100,height:40}),contains:()=>true};
 let rows=[row];const root={querySelectorAll:s=>s==='.atBox-inner-container .dTwsCivh'?rows:[]};
 const input={phase:'point_mention_candidate',ownerName:'测试主人',ownerAvatarResource:'/img/aweme-avatar/known-avatar',ownerPlatformId:id};
 const run=()=>vm.runInNewContext(`(${nativeControls.toString()})(input,root,()=>true,'')`,{...context,input,root});
 assert.equal(run().ready,true);rows=[row,row];assert.equal(run().ready,false);rows=[row];image.currentSrc='https://evil.example/aweme/100x100/aweme-avatar/known-avatar.jpeg';assert.equal(run().ready,false);image.currentSrc='https://p3-pc-sign.douyinpic.com/aweme/100x100/aweme-avatar/someone-else.jpeg';assert.equal(run().ready,false);
});
test('failed login stops before opening the share panel, reserving a send or generating model text',async()=>{
 const f=await fixture();let browserLaunches=0;
 const result=await sendOwnerNativeCard(base,{confirm:'share_one_native_video_card_to_boss',sourceRef},{store:f.store,publicProof:async()=>({allowed:false,reason:'manual_login_required'}),run:async()=>{browserLaunches++;throw Error('must not launch');}});
 assert.equal(result.reason,'manual_login_required');assert.equal(browserLaunches,0);assert.equal(f.state().resources.interactionAttempts,undefined);assert.equal(f.state().resources.requests.length,0);
});
test('typing an @name or an unfinished query never substitutes for selecting a real native entity',()=>{
 let token=null;const editor={innerText:'@测试主人\u00a0',querySelectorAll:s=>s==='.douyin_mention_word'&&token?[token]:[]},box={querySelectorAll:()=>[editor]},root={querySelectorAll:s=>s==='.comment-input-container'?[box]:[]};
 const input={phase:'native_mention_state',ownerName:'测试主人',mentionText:'老大看这里'};
 const run=()=>vm.runInNewContext(`(${nativeControls.toString()})(input,root,()=>true,'')`,{input,root,URL,location:{href:sourceRef}});
 assert.equal(run().selected,false);token={innerText:'@'};assert.equal(run().selected,false);token={innerText:'@测试主人'};assert.equal(run().selected,true);editor.innerText='@测试主人 老大看这里';assert.equal(run().filled,true);editor.innerText='@测试主人\u00a0 老大看这里';assert.equal(run().filled,true);editor.innerText='@测试主人\u00a0 老大  看这里';assert.equal(run().filled,false);
});
