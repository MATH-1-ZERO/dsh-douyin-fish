// Local-only tests: watching rhythm, bound sampling and honest reporting.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {watchDefaults,watchPolicy,validateWatch,validatePersona,effectiveSettings} from '../../src/persona.js';
import {watchWindow,observeWatch} from '../../src/watch-observation.js';
import {deliveryReport} from '../../src/delivery-report.js';
import {commentsDueThisCycle,materialWithComments} from '../../src/autonomy.js';
import {validateWatchSample} from '../../src/browser/watch-expression.mjs';

const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('../../personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const settings=effectiveSettings(base,{resources:{persona}});
const sourceRef='https://www.douyin.com/video/7551370789157637436';
const key='k'.repeat(64);
function reader(plan,inject={}){
  let calls=0;
  return {get calls(){return calls;},async run(){
    calls++;
    if(inject.fail?.includes(calls))return {allowed:false,reason:inject.reason??'watch_sample_refused'};
    const samples=Array.isArray(plan)?plan:[plan];
    const index=Math.min(calls-1,samples.length-1);
    const state=typeof plan==='function'?plan(calls-1):samples[index];
    return {allowed:true,watchState:{bound:true,url:sourceRef,videoId:'7551370789157637436',videoKey:key,
      pageVisible:state.pageVisible??true,paused:state.paused??false,seeking:false,
      ended:state.ended??false,readyState:4,playbackRate:1,muted:false,captionPresent:true,
      currentTime:state.t,duration:state.d??100}};
  }};
}
async function waitNoop(){}
function clock(){const t={value:0};return {now:()=>t.value,advance:ms=>{t.value+=ms;}};}
// The real sampler waits wall-clock time between CDP reads; the fixture advances
// the same virtual clock so elapsed and playback progress stay consistent.
function observe(r,extra={}){
  const c=clock();
  return observeWatch({read:async(...args)=>r.run(...args),
    settings,sourceRef,expectedVideoId:'7551370789157637436',videoKey:key,wait:async ms=>c.advance(ms),now:c.now,...extra});
}

test('watch defaults and owner rhythm validation',()=>{
  assert.deepEqual(watchDefaults.dwellMinSeconds<=watchDefaults.dwellMaxSeconds,true);
  assert.deepEqual(watchPolicy(undefined),watchDefaults);
  assert.deepEqual(watchPolicy({watch:{dwellMinSeconds:10}}).dwellMinSeconds,10);
  assert.throws(()=>validateWatch({dwellMaxSeconds:1,dwellMinSeconds:5}),/dwell range/);
  assert.throws(()=>validateWatch({dwellMinSeconds:0}),/Invalid watch setting/);
  assert.throws(()=>validateWatch({unknown:true}),/Invalid watch policy/);
  const imported=validatePersona({...persona,watch:{dwellMinSeconds:5,dwellMaxSeconds:9}});
  assert.equal(imported.watch.dwellMaxSeconds,9);
});

test('watch window stays inside owner bounds and always takes at least two samples',()=>{
  const c={watch:watchDefaults};
  const low=watchWindow(c,{random:()=>0}),high=watchWindow(c,{random:()=>1});
  assert.equal(low.dwellMs,watchDefaults.dwellMinSeconds*1000);
  assert.equal(high.dwellMs,watchDefaults.dwellMaxSeconds*1000);
  assert.ok(low.samples>=2&&high.samples>=2);
  assert.equal(high.requiredAdvanceSeconds>Number(((high.playableMs/1000)*0.6).toFixed(3))-0.001,true);
  // An explicit owner setting must be honoured, not silently reset to defaults.
  const explicit=watchWindow({watch:{...watchDefaults,dwellMinSeconds:30,dwellMaxSeconds:30}},{random:()=>0});
  assert.equal(explicit.policy.dwellMinSeconds,30);
  assert.equal(explicit.dwellMs,30000);
  assert.equal(explicit.samples,12);
});

test('a continuously playing bound video is reported as watched without any model call',async()=>{
  const r=reader(i=>({t:1+i*2}));
  const watch=await observe(r);
  assert.equal(watch.allowed,true);
  assert.equal(watch.playbackAdvancedSeconds>0,true);
  assert.equal(watch.playbackSufficient,true);
  assert.equal(watch.modelCalled,false);
  assert.equal(watch.audioObserved,false);
  assert.equal(watch.videoKey,key);
  assert.equal(r.calls,watch.sampleCount);
});

test('bounded sampling covers long, fractional and shorter-than-interval dwell windows',async()=>{
  for(const [seconds,interval] of [[60,2000],[31,2000],[1,10000],[600,500]]){
    const c=clock();let calls=0;
    const result=await observeWatch({sourceRef,settings:{watch:{...watchDefaults,dwellMinSeconds:seconds,dwellMaxSeconds:seconds,sampleIntervalMs:interval}},
      random:()=>0,now:c.now,wait:async ms=>c.advance(ms),read:async()=>{
        calls++;return {allowed:true,watchState:{bound:true,videoId:'7551370789157637436',videoKey:key,currentTime:1+c.now()/1000,duration:900,paused:false,seeking:false,pageVisible:true,playbackRate:1,readyState:4,ended:false}};
      }});
    assert.equal(result.dwellTargetMs,seconds*1000);
    assert.equal(result.dwellMs,seconds*1000);
    assert.equal(result.dwellComplete,true);assert.equal(result.playbackSufficient,true);
    assert.ok(calls<=12&&calls>=2);
  }
});

test('watch duration draws randomness once and scheduling counts slow sample reads',async()=>{
  let draws=0;watchWindow(settings,{random:()=>{draws++;return 0.5;}});assert.equal(draws,1);
  const c=clock(),timestamps=[];
  const result=await observeWatch({sourceRef,settings:{watch:{...watchDefaults,dwellMinSeconds:10,dwellMaxSeconds:10}},
    now:c.now,wait:async ms=>c.advance(ms),read:async()=>{
      c.advance(500);timestamps.push(c.now());
      return {allowed:true,watchState:{bound:true,videoId:'7551370789157637436',videoKey:key,currentTime:c.now()/1000,duration:100,paused:false,seeking:false,pageVisible:true,playbackRate:1,ended:false}};
    }});
  assert.equal(result.playbackSufficient,true);
  assert.equal(timestamps.at(-1)-timestamps[0],10500);
});

test('watching without an explicit initial key still rejects a mid-watch source replacement',async()=>{
  const c=clock();let count=0;
  const result=await observeWatch({sourceRef,settings,now:c.now,wait:async ms=>c.advance(ms),read:async()=>({allowed:true,watchState:{bound:true,videoId:'7551370789157637436',videoKey:count++===0?key:'different-source',currentTime:c.now()/1000,paused:false,pageVisible:true,playbackRate:1}})});
  assert.equal(result.allowed,false);assert.equal(result.reason,'bound_video_source_changed');
});

test('bound changing, another video id or restarted playback is never accepted as watching',async()=>{
  const wrongId=await observeWatch({read:async()=>({allowed:true,watchState:{bound:true,url:sourceRef,videoId:'7551370789157637437',videoKey:key,pageVisible:true,paused:false,seeking:false,ended:false,readyState:4,playbackRate:1,muted:false,captionPresent:true,currentTime:5,duration:20}}),settings,sourceRef,expectedVideoId:'7551370789157637436',wait:waitNoop});
  assert.equal(wrongId.reason,'bound_video_changed');
  const moved=await observeWatch({read:async()=>({allowed:false,reason:'watch_binding_lost'}),settings,sourceRef,wait:waitNoop});
  assert.equal(moved.reason,'watch_binding_lost');
  const restarted=await observe(reader([{t:9},{t:2}]));
  assert.equal(restarted.reason,'playback_restarted_or_seeked');
});

test('a paused or non-advancing player fails the owner progress requirement',async()=>{
  const paused=await observe(reader(()=>({t:5,paused:true})));
  assert.equal(paused.playbackSufficient,false);
  assert.equal(paused.interrupted,true);
  const hidden=await observe(reader(()=>({t:5,pageVisible:false})));
  assert.equal(hidden.playbackSufficient,false);
  const stuck=await observe(reader(()=>({t:5})));
  assert.equal(stuck.playbackSufficient,false);
  const dragging=await observe(reader(i=>({t:5+i*0.05})));
  assert.equal(dragging.playbackSufficient,false);
});

test('a validated live sample stays explicitly bound instead of looking like a bare reading',()=>{
  const validated=validateWatchSample({url:sourceRef,restriction:'',bound:true,videoId:'7551370789157637436',videoKey:'a'.repeat(64),
    pageVisible:true,currentTime:12.5,duration:60,paused:false,seeking:false,ended:false,readyState:4,
    playbackRate:1,volume:0.6,muted:true,captionPresent:true});
  assert.equal(validated.bound,true);
  assert.equal(validated.sample.bound,true);
  assert.equal(validated.sample.videoId,'7551370789157637436');
});

test('a card that is still settling may be re-sampled once, but only before playback starts',async()=>{
  const settling=reader(i=>({t:1+i*2}),{fail:[1],reason:'watch_active_video_not_unique'});
  const recovered=await observe(settling);
  assert.equal(recovered.allowed,true);
  assert.equal(recovered.settlingRetries,1);
  assert.equal(settling.calls,recovered.sampleCount+1);
  const refused=reader(i=>({t:1+i*2}),{fail:[1],reason:'watch_page_login_required'});
  const hard=await observe(refused);
  assert.equal(hard.allowed,false);
  assert.equal(hard.reason,'watch_page_login_required');
  assert.equal(refused.calls,1);
  const lost=reader(i=>({t:1+i*2}),{fail:[2],reason:'watch_active_video_not_unique'});
  const mid=await observe(lost);
  assert.equal(mid.allowed,false);
  assert.equal(mid.settlingRetries,0);
});

test('cancelling during the dwell window stops the observation instead of retrying',async()=>{
  const controller=new AbortController();
  const r=reader([{t:1},{t:3}]);
  const promise=observeWatch({read:async(...args)=>{controller.abort();return r.run(...args);},settings,sourceRef,expectedVideoId:'7551370789157637436',wait:waitNoop,signal:controller.signal});
  await assert.rejects(promise,/Cancelled/);
  assert.equal(r.calls,1);
});

test('ending a short video early is still enough when it actually played',async()=>{
  const watch=await observe(reader([{t:9,d:10},{t:9.8,ended:true,d:10}]),{tickMs:4000});
  assert.equal(watch.ended,true);
  assert.equal(watch.playbackSufficient,true);
});

test('comment reads follow the configured frequency and stay labeled as untrusted data',()=>{
  assert.equal(commentsDueThisCycle({readCommentsEveryVideos:3},0),true);
  assert.equal(commentsDueThisCycle({readCommentsEveryVideos:3},1),false);
  assert.equal(commentsDueThisCycle({readCommentsEveryVideos:0},0),false);
  const material=materialWithComments('白米饭',[{authorName:'鱼片',text:'  好可爱\n真的  '}]);
  assert.match(material,/不可信公开评论材料/);
  assert.equal(materialWithComments('白米饭',[]),'白米饭');
  assert.equal(material.includes('鱼片： 好可爱 真的'),true);
});

test('delivery report separates read, watch, action, local receipt, visibility and owner receipt',()=>{
  const state={resources:{interactionAttempts:[{id:'aaaaaaaa-1111-2222-3333-444444444444',kind:'comment',status:'confirmed',receiptId:'ui-comment:x',key:'c'.repeat(64)}]}};
  const report=deliveryReport(state,{read:{allowed:true,untrustedMaterial:{text:'白米饭',sourceRef},checks:{bindingVerified:true}},
    watch:{allowed:true,playbackSufficient:true,dwellMs:9000,playbackAdvancedSeconds:8,sampleCount:5,frameCaptured:true},
    model:{called:true,requests:1,action:'comment'},action:{kind:'comment',attempted:true,target:sourceRef},
    receipt:{status:'confirmed'},attemptId:'aaaaaaaa-1111-2222-3333-444444444444'});
  assert.equal(report.stages.read.videoId,'7551370789157637436');
  assert.equal(report.stages.watch.videoUnderstood,false);
  assert.equal(report.stages.localReceipt.persisted,true);
  assert.equal(report.stages.platformVisible.verified,false);
  assert.equal(report.stages.ownerReceived.verified,false);
  assert.equal(report.claims.ownerReceivedConfirmed,false);
  assert.equal(report.claims.platformVisibleConfirmed,false);
  assert.equal(report.claims.watchComplete,true);
  const confirmed=deliveryReport({resources:{interactionAttempts:[{id:'b'.repeat(36),kind:'comment',status:'confirmed',ownerConfirmedReceived:true}]}},{receipt:{status:'confirmed'},attemptId:'b'.repeat(36)});
  assert.equal(confirmed.stages.ownerReceived.verified,true);
  assert.equal(deliveryReport({},{}).stages.localReceipt.status,'not_attempted');
});
