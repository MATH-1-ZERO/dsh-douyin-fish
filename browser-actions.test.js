import test from 'node:test';import assert from 'node:assert/strict';
import {freshState,validateState} from './engine.js';
import {reserveBrowserRead} from './manual-browser.js';
import {performLike,performComment} from './browser-actions.js';
import {waitForStableReceipt} from './interaction-settle.js';
const sourceRef='https://www.douyin.com/jingxuan?modal_id=7551370789157637436';
test('development reads bypass daily caps and cooldown without erasing production receipts',()=>{
 const s=freshState(),at=1800000000000;s.resources.manualBrowserReads=[at-100];s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 for(let i=0;i<150;i++)assert.equal(reserveBrowserRead({manualBrowser:{enabled:true,readsPer24Hours:1,intervalMinutes:15}},s,at+i).value.allowed,true);
 assert.deepEqual(s.resources.manualBrowserReads,[at-100]);assert.equal(s.resources.development.readsTotal,150);validateState(s);
 s.resources.development.enabled=false;assert.equal(reserveBrowserRead({manualBrowser:{enabled:true,readsPer24Hours:1,intervalMinutes:15}},s,at+151).value.reason,'manual_browser_daily_limit');
});
test('real adapter flow reserves before one click and verifies explicit liked state',async()=>{
 let s=freshState(),clicked=0,liked=false,elapsed=0,refreshed=0;s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const deps={store,monotonicNow:()=>elapsed,delay:async ms=>{elapsed+=ms;},read:async(_c,args,opts)=>{assert.equal(args.sourceRef,sourceRef);const report=await opts.run({approved:true});return {allowed:report.operationResult.status==='confirmed'};},run:async options=>({operationResult:await options.afterReady({settings:{},read:async(_s,{operation})=>{
  if(operation.phase==='click_like'){assert.equal(s.resources.interactionAttempts[0].status,'reserved');clicked++;liked=true;}
  if(operation.phase==='refresh'){assert.ok(elapsed>=10000);refreshed++;}
  return {allowed:true,operationResult:{ready:true,like:{state:liked?'liked':'unliked'}}};
 }})})};
 const r=await performLike({}, {confirm:'like_one_exact_video',sourceRef},deps);assert.equal(r.allowed,true);assert.equal(clicked,1);assert.equal(refreshed,1);assert.equal(s.paused,true);assert.equal(s.resources.interactionAttempts[0].status,'confirmed');
});
test('temporary optimistic receipt never meets the settling requirement',async()=>{
 let time=0,reads=0;
 const r=await waitForStableReceipt(async()=>++reads<4,Boolean,{now:()=>time,pause:async ms=>{time+=ms;}});
 assert.equal(r,null);assert.ok(time>=20000);
});
test('receipt waiter honors cancellation before any observation',async()=>{
 const controller=new AbortController();controller.abort();let read=false;
 await assert.rejects(waitForStableReceipt(async()=>{read=true;},Boolean,{signal:controller.signal}),{name:'AbortError'});
 assert.equal(read,false);
});
for(const kind of ['like','comment'])test(kind+' disappearing after reload stays uncertain and never submits again',async()=>{
 let state=freshState(),time=0,sends=0,refreshed=false;
 state.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 const store={snapshot:async()=>structuredClone(state),transact:async fn=>{const r=await fn(structuredClone(state));validateState(r.state);state=r.state;return r.value;}};
 const text='小鱼来认真加个油。';
 const readUi=async(_s,{operation})=>{
  const phase=operation.phase;
  if(phase==='click_like'||phase==='click_submit'){assert.equal(state.resources.interactionAttempts[0].status,'reserved');sends++;}
  if(phase==='refresh'){assert.ok(time>=10000);refreshed=true;}
  return {allowed:true,operationResult:{ready:true,filled:true,editorCount:1,editorEmpty:true,matchingComments:[],like:{state:sends&&!refreshed?'liked':'unliked'},matches:sends&&!refreshed?[{authorId:'test_author',recent:true}]:[]}};
 };
 const deps={store,monotonicNow:()=>time,delay:async ms=>{time+=ms;},read:async(_s,_a,opts)=>{await opts.run({});return {allowed:true};},run:async opts=>({operationResult:await opts.afterReady({settings:{},read:readUi})})};
 const r=await (kind==='like'?performLike:performComment)({}, {confirm:kind==='like'?'like_one_exact_video':'publish_one_exact_comment',sourceRef,text},deps);
 assert.equal(r.allowed,false);assert.equal(r.interaction.status,'uncertain');assert.equal(sends,1);assert.equal(refreshed,true);
 const again=await (kind==='like'?performLike:performComment)({}, {confirm:kind==='like'?'like_one_exact_video':'publish_one_exact_comment',sourceRef,text},deps);
 assert.equal(again.reason,'interaction_result_unresolved');assert.equal(sends,1);
});
test('like tool requires exact scope and rejects unrelated routes',async()=>{assert.equal((await performLike({}, {},{})).reason,'explicit_like_required');await assert.rejects(performLike({}, {confirm:'like_one_exact_video',sourceRef:'https://evil.example/'},{}),/Exact approved/);});
