// Bounded real-watch observation for one already-bound public video.
// It only samples the page and waits locally: no clicks, no navigation, no
// model calls. A sample never proves that画面 was understood or audio heard.
import {setTimeout as delay} from 'node:timers/promises';
import {validateWatch} from './persona.js';
import {videoIdFromPage} from './comment-policy.js';

export function watchWindow(settings,{random=Math.random}={}){
  // `settings.watch` is already a watch policy; watchPolicy() takes a persona.
  const policy=validateWatch(settings?.watch);
  const draw=random(),roll=Number.isFinite(draw)?draw:0;
  const seconds=policy.dwellMinSeconds+Math.round((policy.dwellMaxSeconds-policy.dwellMinSeconds)*Math.min(1,Math.max(0,roll)));
  const dwellMs=seconds*1000;
  // Keep at most 12 observations, but spread them across the full requested
  // dwell. Capping the count must not silently shorten a long watch to 22s.
  const intervalMs=Math.max(policy.sampleIntervalMs,Math.ceil(dwellMs/11));
  const samples=Math.min(12,Math.max(2,Math.ceil(dwellMs/intervalMs)+1));
  const playableMs=dwellMs;
  return {policy,dwellMs,intervalMs,samples,playableMs,
    requiredAdvanceSeconds:Number(((playableMs/1000)*(policy.minAdvancePercent/100)).toFixed(3))};
}

const round=(value,digits=3)=>Number(value.toFixed(digits));

// A freshly opened card can be mid-transition for a moment: the feed may hold two
// active roots or swap the player element. Only before any playback was observed
// do we re-take the first sample a couple of times; never after watching started.
const settlingReasons=new Set(['watch_active_video_not_unique','watch_bound_video_unstable',
  'watch_bound_player_or_caption_not_unique','watch_binding_lost']);

export async function observeWatch({read,settings,sourceRef,expectedVideoId,videoKey,frame=false,signal,
  wait=delay,now=()=>performance.now(),random=Math.random,maxSettlingRetries=2}){
  if(typeof read!=='function')throw Error('Watch requires an explicit bound read');
  const expected=expectedVideoId??videoIdFromPage(sourceRef);
  if(!expected)throw Error('Exact bound video required for watching');
  const window=watchWindow(settings,{random});
  const samples=[];
  const started=now();
  let settlingRetries=0,watchStarted;
  const failure=(reason,extra={})=>({allowed:false,reason,samples,dwellMs:Math.round(now()-started),
    modelCalled:false,audioObserved:false,settlingRetries,...extra});
  for(let index=0;index<window.samples;index++){
    if(signal?.aborted)throw Error('Cancelled');
    if(index>0)await wait(Math.max(0,watchStarted+Math.min(index*window.intervalMs,window.dwellMs)-now()),undefined,{signal});
    let result=await read(settings,{signal,watch:true,frame:frame&&index===0});
    while(!result?.allowed&&samples.length===0&&index===0&&settlingReasons.has(result?.reason)&&settlingRetries<maxSettlingRetries){
      settlingRetries++;
      await wait(500,undefined,{signal});
      if(signal?.aborted)throw Error('Cancelled');
      result=await read(settings,{signal,watch:true,frame:frame&&index===0});
    }
    if(signal?.aborted)throw Error('Cancelled');
    if(!result?.allowed)return failure(result?.reason??'watch_sample_refused');
    const state=result.watchState;
    if(!state?.bound)return failure('watch_binding_lost');
    if(state.videoId!==expected)return failure('bound_video_changed',{observedVideoId:state.videoId});
    if(videoKey&&state.videoKey!==videoKey)return failure('bound_video_source_changed');
    if(samples.length&&state.videoKey!==samples[0].videoKey)return failure('bound_video_source_changed');
    if(watchStarted===undefined)watchStarted=now();
    const previous=samples.at(-1);
    const current={elapsedMs:Math.round(now()-started),currentTime:state.currentTime,duration:state.duration,paused:state.paused,
      seeking:state.seeking,pageVisible:state.pageVisible,playbackRate:state.playbackRate,readyState:state.readyState,
      ended:state.ended,captionPresent:state.captionPresent,videoKey:state.videoKey};
    if(previous&&!state.ended&&current.currentTime<previous.currentTime-0.05)
      return failure('playback_restarted_or_seeked',{samples:[...samples,current]});
    samples.push(current);
    if(state.ended)break;
  }
  const first=samples[0],last=samples.at(-1);
  if(!first||!last)return failure('watch_samples_missing');
  let playingMs=0,advanced=0,ended=last.ended===true;
  for(let i=1;i<samples.length;i++){
    const previous=samples[i-1],current=samples[i];
    const playing=!previous.paused&&!current.paused&&!previous.seeking&&!current.seeking&&
      previous.pageVisible&&current.pageVisible&&current.playbackRate>0;
    if(!playing)continue;
    playingMs+=current.elapsedMs-previous.elapsedMs;
    advanced+=Math.max(0,current.currentTime-previous.currentTime);
  }
  const dwellMs=Math.round(last.elapsedMs);
  // A video that reached its end cannot advance further; the remaining media,
  // not the planned window, is then the honest maximum.
  const remaining=ended&&Number.isFinite(last.duration)?Math.max(0,last.duration-first.currentTime):Number.POSITIVE_INFINITY;
  const required=Math.min(window.requiredAdvanceSeconds,(playingMs/1000)*(window.policy.minAdvancePercent/100),remaining);
  // No playing interval at all, or a mostly-paused dwell, is not watching.
  const dwellComplete=ended||last.elapsedMs-first.elapsedMs>=window.dwellMs;
  const playbackSufficient=dwellComplete&&playingMs>0&&playingMs*2>=dwellMs&&advanced+0.25>=required;
  const interrupted=samples.some(s=>s.paused||s.seeking||!s.pageVisible);
  return {allowed:true,sourceRef,videoId:expected,videoKeyStable:true,videoKey:videoKey??last.videoKey,
    samples,dwellMs,dwellTargetMs:window.dwellMs,dwellComplete,sampleCount:samples.length,playingMs,settlingRetries,
    playbackAdvancedSeconds:round(advanced),playbackRequiredSeconds:round(required),playbackSufficient,
    ended,interrupted,frameCaptured:frame===true&&typeof samples[0]?.currentTime==='number',
    modelCalled:false,audioObserved:false,
    notes:['Sampled the bound player only; this is not evidence of understanding画面 or hearing audio.',
      ...(playbackSufficient?[]:['Playback advance below owner rhythm; the video is treated as not really watched.']),
      ...(interrupted?['A sample was paused, seeking or hidden during the dwell window.']:[])]};
}
