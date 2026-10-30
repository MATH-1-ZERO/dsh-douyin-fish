// Local-only tests for the real-watch loop: no browser process is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshState,validateState} from './engine.js';
import {FishAutonomy,freshAutonomy,MAX_LEASE_AGE_MS,admission} from './autonomy.js';

const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
// Explicit scheduling fixture; the distributable defaults to schedule disabled.
persona.schedule.enabled=true;
const T=Date.parse('2026-10-24T12:00:00+08:00'),sourceRef='https://www.douyin.com/video/7551370789157637436';

function fixture({mode='comment',watchResult=()=>({allowed:true,playbackSufficient:true,sampleCount:3,dwellMs:6000,playbackAdvancedSeconds:4}),lease=null,watchSettings={}}={}){
  let s=freshState(),models=0,deliveries=0,watchCalls=0,videos=0;
  s.resources.persona={...structuredClone(persona),ownerId:'owner_verified_123',watch:{dwellMinSeconds:4,dwellMaxSeconds:4,sampleIntervalMs:2000,minAdvancePercent:60,readCommentsEveryVideos:1,maxVideosPerSession:2,cycleIntervalSeconds:60,...watchSettings}};
  s.resources.ownerIdentity={verified:true,platformId:'owner_verified_123',ownerHandle:'owner_handle'};
  s.resources.autonomy={...freshAutonomy(),enabled:true,deliveryMode:mode};
  s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
  s.paused=false;
  const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
  const worker=new FishAutonomy({store,loadBase:async()=>base,now:()=>T,setTimer:()=>({unref(){}}),clearTimer(){},
    requireWatch:true,
    loadLease:async()=>lease,
    read:async(_settings,args)=>{
      const ref='https://www.douyin.com/video/7551370789157637'+String(videos++).padStart(3,'0');
      if(args.includeComments===true)return {allowed:true,untrustedMaterial:{text:'小鲸鱼端着白米饭',sourceRef:ref},untrustedComments:{comments:[{authorId:'a1',authorName:'鱼片',text:'好可爱'}]}};
      return {allowed:true,untrustedMaterial:{text:'小鲸鱼端着白米饭',sourceRef:ref}};
    },
    watch:async options=>{watchCalls++;return watchResult(options);},
    generate:async(p,{commit})=>{models++;const r=await commit('老大，小鱼发现一碗白米饭。',mode==='review'?undefined:{action:['share_card','share_link','mention_owner'].includes(mode)?mode:'comment'});return {allowed:r.allowed,status:'draft_saved',modelRequests:1};},
    deliver:async()=>{deliveries++;return {allowed:true,interaction:{status:'confirmed',attemptId:'aaaaaaaa-1111-2222-3333-444444444444'}};}});
  return {worker,store,get state(){return s;},get models(){return models;},get deliveries(){return deliveries;},get watchCalls(){return watchCalls;}};
}
const lease={read:async()=>({allowed:true}),verify:async()=>({url:sourceRef})};

test('a stale browser binding fails before any read reservation or browser action',async()=>{
  const f=fixture({mode:'watch_only',lease:{verify:async()=>{throw Error('Retained browser listener changed');}}});
  const before=await f.store.snapshot();
  f.worker.read=async()=>assert.fail('stale binding must not open a new browser');
  const result=await f.worker.tick();
  assert.equal(result.reason,'Retained browser listener changed');
  assert.equal(f.state.resources.development.readsTotal,before.resources.development.readsTotal);
  assert.equal(f.state.paused,true);assert.equal(f.watchCalls,0);
});

test('watch-only traverses distinct videos, rests at the session limit and never prepares text',async()=>{
  const f=fixture({lease,mode:'watch_only'});
  const before=await f.store.snapshot();
  const first=await f.worker.tick(),second=await f.worker.tick(),third=await f.worker.tick();
  assert.equal(first.status,'watched_without_generation');
  assert.equal(second.report.claims.watchComplete,true);
  assert.notEqual(first.report.stages.read.videoId,second.report.stages.read.videoId);
  assert.equal(third.reason,'resting');
  assert.equal(f.watchCalls,2);assert.equal(f.models,0);assert.equal(f.deliveries,0);
  assert.deepEqual(f.state.resources.requests,before.resources.requests);
  assert.deepEqual(f.state.resources.manualDrafts,[]);
  assert.equal(first.report.stages.model.called,false);
  assert.equal(first.report.stages.action.attempted,false);
  assert.equal((await f.worker.status()).sendingSupported,false);
  assert.equal((await f.worker.status()).mode,'autonomous_watch_only');
});

test('watch-only single run needs its own confirmation, no model runtime and always stops',async()=>{
  const f=fixture({lease,mode:'watch_only'});
  f.worker.generate=null;
  assert.equal((await f.worker.runOnce('run_one_autonomous_delivery_test','watch_only')).allowed,false);
  const result=await f.worker.runOnce('run_one_watch_test','watch_only');
  assert.equal(result.status,'watched_without_generation');assert.equal(result.singleCycle,true);
  assert.equal(f.state.paused,true);assert.equal(f.worker.timer,null);
  assert.equal(f.state.resources.autonomy.inFlightId,null);
  assert.equal(f.state.resources.autonomy.enabled,false);
});

test('watch-only does not probe the model or accept a live mode change',async()=>{
  const f=fixture({lease,mode:'watch_only'});
  f.worker.generate.probe=async()=>assert.fail('watching must not probe the model');
  assert.equal((await f.worker.start('start_watch_only','watch_only',{singleRun:true})).allowed,true);
  const changed=await f.worker.start('start_browse_and_deliver','comment',{singleRun:true});
  assert.equal(changed.reason,'stop_before_changing_autonomy_mode');
  assert.equal(f.state.resources.autonomy.deliveryMode,'watch_only');
  await f.worker.stop();
});

test('watch-only ignores draft budgets but still respects browser limits',async()=>{
  const f=fixture({lease,mode:'watch_only'}),s=await f.store.snapshot();
  // This existing manual reservation exhausts the persona daily draft limit.
  s.resources.requests=Array.from({length:100},()=>({manual:{},time:T}));
  assert.equal(admission(base,s,T).allowed,true);
  s.resources.autonomy.deliveryMode='review';
  assert.equal(admission(base,s,T).allowed,false);
  s.resources.autonomy.deliveryMode='watch_only';s.resources.development.enabled=false;
  s.resources.manualBrowserReads=[T-1];
  assert.equal(admission(base,s,T).reason,'manual_browser_cooldown');
});

test('a time-based rest resets the video counter before the next session',async()=>{
  const f=fixture({lease,mode:'watch_only'}),s=await f.store.snapshot();
  s.resources.autonomy.sessionStart=T-60000;
  s.resources.autonomy.restUntil=T;
  s.resources.autonomy.videosThisSession=2;
  assert.equal(admission(base,s,T).allowed,true);
  assert.equal(s.resources.autonomy.videosThisSession,0);
  s.resources.autonomy.sessionStart=T;
  assert.equal(admission(base,s,T+1).allowed,true);
});

test('stopping watch-only during playback cancels without generating or saving',async()=>{
  let entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const f=fixture({lease,mode:'watch_only',watchResult:({signal})=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>resolve({allowed:false,reason:'cancelled'}),{once:true});entered();
  })});
  const cycle=f.worker.tick();await ready;
  const stopped=await f.worker.stop();await cycle;
  assert.equal(stopped.cancelledActiveCycle,true);
  assert.equal(f.state.resources.autonomy.inFlightId,null);
  assert.equal(f.models,0);assert.equal(f.deliveries,0);
  assert.equal(f.state.resources.manualDrafts.length,0);
});

test('a real round watches the bound video once and only then calls the model',async()=>{
  const f=fixture({lease});
  const r=await f.worker.tick();
  assert.equal(f.watchCalls,1);
  assert.equal(f.models,1);
  assert.equal(f.deliveries,1);
  assert.equal(r.report.stages.watch.completed,true);
  assert.equal(r.report.stages.model.requests,1);
  assert.equal(r.report.stages.platformVisible.verified,false);
  assert.equal(r.report.stages.ownerReceived.verified,false);
  assert.equal(f.state.resources.autonomy.videosThisSession,1);
});

test('no retained browser means no claimed watching, no model call and no delivery',async()=>{
  const f=fixture({lease:null});
  const r=await f.worker.tick();
  assert.equal(r.reason,'retained_browser_required_for_watch');
  assert.equal(f.models,0);assert.equal(f.deliveries,0);assert.equal(f.watchCalls,0);
  assert.equal(f.state.paused,true);assert.equal(f.state.resources.autonomy.enabled,false);
});

test('an incomplete watch pauses instead of letting a decision through',async()=>{
  const f=fixture({lease,watchResult:()=>({allowed:false,reason:'bound_video_changed'})});
  const r=await f.worker.tick();
  await f.worker.active;
  assert.equal(r.status,'watch_incomplete');
  assert.equal(f.models,0);assert.equal(f.deliveries,0);
  assert.equal(f.state.paused,true);
  const stalled=fixture({lease,watchResult:()=>({allowed:true,playbackSufficient:false,reason:'stalled'})});
  const second=await stalled.worker.tick();
  assert.equal(second.reason,'watch_playback_insufficient');
  assert.equal(stalled.models,0);
});

test('configured comment cadence feeds only labeled untrusted text and counts the session',async()=>{
  const f=fixture({lease,mode:'review'});
  await f.worker.tick();
  assert.equal(f.state.resources.requests.some(q=>q.manual),true);
  const material=f.state.resources.requests.find(q=>q.manual);
  assert.equal(material.expiresAt>material.time,true);
  await f.worker.tick();
  assert.equal(f.state.resources.autonomy.videosThisSession,2);
  // Every third video would be skipped by the dedupe key first; two watched
  // videos already consume the configured session length.
  const third=await f.worker.tick();
  assert.equal(third.reason,'resting');
  assert.equal(f.state.resources.autonomy.restUntil>T,true);
});

test('recovery after a host restart refuses a fresh lease but clears a stale one',async()=>{
  const f=fixture({lease,mode:'review'});
  await f.store.transact(s=>{s.resources.autonomy.inFlightId='bbbbbbbb-2222-3333-4444-555555555555';s.resources.autonomy.inFlightAt=T-1000;return {state:s,value:null};});
  const busy=await f.worker.resume('recover_after_host_restart');
  assert.equal(busy.reason,'autonomy_busy_or_stale_lease');
  await f.store.transact(s=>{s.resources.autonomy.inFlightAt=T-(MAX_LEASE_AGE_MS+1);return {state:s,value:null};});
  const recovered=await f.worker.resume('recover_after_host_restart');
  assert.equal(recovered.leaseCleared,true);
  assert.equal(recovered.allowed,true);
  assert.equal(f.state.resources.autonomy.deliveryMode,'review');
  assert.equal(f.state.resources.autonomy.lastOutcome.reason,'stale_lease_cleared_after_host_restart');
  assert.equal(f.state.resources.autonomy.inFlightId!=='bbbbbbbb-2222-3333-4444-555555555555',true);
  const wrong=await f.worker.resume('wrong');
  assert.equal(wrong.reason,'explicit_recover_required');
});

test('stop reports whether a real round was cancelled and never leaves a lease behind',async()=>{
  const f=fixture({lease});
  const stopped=await f.worker.stop();
  assert.equal(stopped.paused,true);
  assert.equal(stopped.cancelledActiveCycle,false);
  assert.equal(f.state.paused,true);
  assert.equal(f.state.resources.autonomy.enabled,false);
  const idle=await f.worker.resume('recover_after_host_restart');
  assert.equal(idle.reason,'autonomy_not_enabled');
  assert.equal(f.worker.live,false);
});
