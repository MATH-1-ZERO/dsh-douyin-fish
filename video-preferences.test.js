import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {freshState,validateState} from './engine.js';
import {FishAutonomy,freshAutonomy} from './autonomy.js';
import {videoDefaults,preferenceDecision,videoActions,validateVideoPreferences} from './video-preferences.js';
import {digest,replyDefaults} from './conversation-state.js';
import {sendSelectedNativeCard} from './conversation-share.js';
import {interactionDecision} from './interaction-gate.js';
import {nativeControls} from './live-browser/native-controls.mjs';
import {ConsoleOperations} from './console-operations.js';
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8')),profile=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const videoId='7551370789157637436',sourceRef='https://www.douyin.com/video/'+videoId;
function fixture(){
 let s=freshState(),models=0,deliveries=0,text='小猫在厨房等米饭',selectedAction='comment',deliveryStatus='confirmed';
 s.paused=false;s.resources.persona=structuredClone(profile);s.resources.persona.ownerId='verified_owner';s.resources.persona.schedule.enabled=false;s.resources.persona.likedTags=['小猫'];s.resources.persona.blockedTags=['广告'];s.resources.ownerIdentity={verified:true,platformId:'verified_owner',ownerHandle:'owner_handle'};
 s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};s.resources.autonomy={...freshAutonomy(),enabled:true,deliveryMode:'console_preferences'};
 const c={name:'朋友',avatar:'https://p3.douyinpic.com/img/aweme-avatar/known-avatar~crop.webp',account:'https://p3.douyinpic.com/img/aweme-avatar/self~crop.webp'};const contact={...c,id:digest([c.account,c.name,c.avatar])};
 s.resources.conversations={at:Date.now(),ownerId:'e'.repeat(64),items:[contact]};s.resources.videoPreferences={...videoDefaults,commentEnabled:true,shareRecipient:contact.id,commentStyle:'可爱自然'};
 const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const worker=new FishAutonomy({store,loadBase:async()=>base,setTimer:()=>({unref(){}}),clearTimer(){},read:async()=>({allowed:true,untrustedMaterial:{sourceRef,text}}),generate:async(p,{commit})=>{models++;assert.deepEqual(p.payload.context,{});assert.equal(p.writingRules.commentStyle,'可爱自然');assert.ok(p.actionChoices.includes(selectedAction));if(selectedAction==='skip')return {allowed:true,status:'skipped'};return {...await commit('这只小猫也在等开饭嘛。',{action:selectedAction}),status:'draft_saved'};},deliver:async(_s,request,deps)=>{deliveries++;assert.equal(request.sourceRef,sourceRef);assert.equal(deps.autonomyLeaseId,s.resources.autonomy.inFlightId);return {allowed:deliveryStatus==='confirmed',interaction:{status:deliveryStatus,attemptId:'12345678-1234-1234-1234-123456789abc'}};}});
 return {store,worker,contact,get state(){return s;},get models(){return models;},get deliveries(){return deliveries;},set material(v){text=v;},set action(v){selectedAction=v;},set outcome(v){deliveryStatus=v;}};
}
test('interest filter skips unmatched and blocked video text before using a model',async()=>{
 for(const text of ['风景不错','小猫广告']){const f=fixture();f.material=text;const r=await f.worker.tick();assert.equal(r.allowed,false);assert.equal(f.models,0);assert.equal(f.deliveries,0);}
 assert.equal(preferenceDecision(fixture().state,'小猫真可爱').allowed,true);
});
test('interested video can publish once and retains no draft or cached response',async()=>{
 const f=fixture(),r=await f.worker.tick();assert.equal(r.allowed,true);assert.equal(r.action,'comment');assert.equal(f.models,1);assert.equal(f.deliveries,1);assert.equal(f.state.resources.manualDrafts.length,0);assert.equal(f.state.resources.requests[0].result,null);await f.worker.tick();assert.equal(f.deliveries,1);
});
test('sharing can target a selected conversation independently of private-message reply selection',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.videoPreferences.shareEnabled=true;s.resources.videoPreferences.commentEnabled=false;s.resources.replySettings={...replyDefaults,ownerEnabled:false,selected:[]};return {state:s,value:null};});f.action='share_card';assert.deepEqual(videoActions(f.state),['share_card','skip']);assert.equal((await f.worker.tick()).allowed,true);assert.equal(f.deliveries,1);assert.equal(f.state.resources.manualDrafts.length,0);
});
test('both switches expose only the two authorized actions and skip',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.videoPreferences.shareEnabled=true;return {state:s,value:null};});f.action='skip';assert.deepEqual(videoActions(f.state),['comment','share_card','skip']);await f.worker.tick();assert.equal(f.deliveries,0);
});
test('uncertain interaction stops the video worker without leaving a draft',async()=>{
 const f=fixture();f.outcome='uncertain';await f.worker.tick();assert.equal(f.state.paused,true);assert.equal(f.state.resources.autonomy.enabled,false);assert.equal(f.state.resources.manualDrafts.length,0);await f.worker.tick();assert.equal(f.deliveries,1);
});
test('invalid share recipients and missing interests block startup',async()=>{
 const f=fixture();await f.worker.stop();await f.store.transact(s=>{s.resources.persona.likedTags=[];return {state:s,value:null};});assert.equal((await f.worker.start('start_browse_and_deliver','console_preferences')).reason,'video_interests_required');assert.equal(f.state.paused,true);
 assert.throws(()=>validateVideoPreferences({...videoDefaults,shareRecipient:'arbitrary-name'}));
});
test('pause during video startup probe cannot restart the worker afterward',async()=>{
 const f=fixture();await f.worker.stop();let release,entered;const ready=new Promise(r=>entered=r);f.worker.generate.probe=async()=>{entered();await new Promise(r=>release=r);};const start=f.worker.start('start_browse_and_deliver','console_preferences');await ready;await f.worker.stop();release();assert.equal((await start).reason,'autonomy_start_cancelled');assert.equal(f.worker.live,false);assert.equal(f.state.paused,true);
});
test('reply permission alone does not authorize a video card',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.conversationReplies={enabled:true,lease:'l',seen:[],events:[],baselines:[]};s.resources.replySettings={...replyDefaults,selected:[f.contact.id]};return {state:s,value:null};});
 const intent={kind:'dm',identityKind:'selected_douyin_conversation',recipientId:f.contact.id,sourceRef:'douyin-conversation:'+f.contact.id,text:'native_video_card',nativeCardVideoId:videoId};assert.equal(interactionDecision(f.state,intent).reason,'conversation_not_authorized');
});
test('selected native card verifies before clicking and reconciles a persistent receipt once',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.videoPreferences.shareEnabled=true;s.resources.autonomy.inFlightId='12345678-1234-1234-1234-123456789abc';return {state:s,value:null};});let clicked=0,verified=0;
 const deps={store:f.store,autonomyLeaseId:f.state.resources.autonomy.inFlightId,delay:async()=>{},verifyConversation:async(c,id,_deps,after)=>{assert.equal(c.id,f.contact.id);assert.equal(id,videoId);verified++;return {allowed:true,verifiedAt:Date.now()};},read:async(_s,_a,options)=>{await options.run({});return {allowed:true,checks:{browserReused:true,browserRetained:true,sessionReleased:true}};},run:async options=>options.afterReady({settings:{},read:async(_s,{operation})=>{if(operation.phase==='click_native_share_send')clicked++;return {allowed:true,operationResult:{ready:true}};}})};
 const result=await sendSelectedNativeCard(base,{sourceRef},deps);assert.equal(result.allowed,true);assert.equal(clicked,1);assert.equal(verified,2);assert.equal(f.state.resources.interactionAttempts[0].status,'confirmed');
 const duplicate=await sendSelectedNativeCard(base,{sourceRef},deps);assert.equal(duplicate.reason,'interaction_duplicate');assert.equal(clicked,1);
});
test('selected native share validates current account before considering a candidate',()=>{
 const input={recipientKind:'selected_conversation',account:'https://p3.douyinpic.com/img/aweme-avatar/self',phase:'point_native_share_send'};
 const result=vm.runInNewContext(`(${nativeControls.toString()})(input,{},()=>true,'')`,{input,URL,location:{href:sourceRef},document:{querySelectorAll:()=>[{getAttribute:()=> 'https://p3.douyinpic.com/img/aweme-avatar/another-account'}]}});assert.equal(result.reason,'conversation_account_changed');
});
test('video settings persist typed preferences and pause without enabling tasks',async()=>{
 const f=fixture(),ops=new ConsoleOperations({store:f.store,loadBase:async()=>base,stopAll:()=>f.worker.stop()});const r=await ops.commands().save_video({changes:{likedTags:['旅行'],blockedTags:['广告'],shareEnabled:true,shareRecipient:f.contact.id,commentEnabled:true,commentStyle:'简短',cycleIntervalSeconds:45,dwellMinSeconds:5,dwellMaxSeconds:15}});assert.equal(r.allowed,true);assert.equal(f.state.paused,true);assert.equal(f.state.resources.persona.schedule.enabled,false);assert.deepEqual(f.state.resources.persona.likedTags,['旅行']);assert.equal(f.state.resources.persona.watch.cycleIntervalSeconds,45);
});
