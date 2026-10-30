// Read-only playback sampler for the currently bound public video. It never
// clicks, scrolls, navigates or mutates the page, and never inspects inputs,
// cookies or tokens. Values here are observations, not understanding.
import {pageRestriction} from './page-restriction.mjs';

async function watch(restrictionCheck) {
  const visible = element => {
    const style=getComputedStyle(element), r=element.getBoundingClientRect();
    return style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0&&
      r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
  };
  const unbound=(url,restriction,reason,pageVisible)=>({url,restriction,bound:false,reason,pageVisible});
  const pageVisible=document.visibilityState==='visible';
  const restriction=restrictionCheck();
  const url=location.href;
  if(restriction)return unbound(url,restriction,'page_'+restriction+'_required',pageVisible);
  const u=new URL(url);
  const videoId=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');
  if(!videoId||!/^\d{10,25}$/.test(videoId))return unbound(url,'','no_bound_video_id',pageVisible);
  const activeRoots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible);
  if(activeRoots.length!==1)return unbound(url,'','active_video_not_unique',pageVisible);
  const active=activeRoots[0];
  if(!active.classList.contains('video_'+videoId))return unbound(url,'','bound_video_id_mismatch',pageVisible);
  const videos=[...document.querySelectorAll('video')].filter(visible).filter(v=>active.contains(v));
  const captions=[...document.querySelectorAll('[data-e2e="video-desc"]')].filter(visible).filter(c=>active.contains(c));
  if(videos.length!==1||captions.length!==1)return unbound(url,'','bound_player_or_caption_not_unique',pageVisible);
  const video=videos[0],caption=captions[0];
  let container=video.parentElement,bound=false;
  for(let depth=0;container&&depth<6;depth++,container=container.parentElement){
    if(['BODY','HTML'].includes(container.tagName))break;
    if(container.contains(caption)){bound=true;break;}
  }
  if(!bound||!video.currentSrc)return unbound(url,'','bound_video_unstable',pageVisible);
  const source=video.currentSrc;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  // Hash is an ephemeral consistency key. Media URLs are never returned or saved.
  const videoKey=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const sample={url,videoId,videoKey,bound:true,restriction:'',pageVisible,
    currentTime:video.currentTime,duration:video.duration,paused:video.paused,seeking:video.seeking,
    ended:video.ended,readyState:video.readyState,playbackRate:video.playbackRate,
    muted:video.muted,volume:video.volume,captionPresent:!!(caption.innerText||'').trim()};
  if(video.currentSrc!==source||!visible(video)||!visible(caption)||!container?.contains(caption)||!container?.contains(video))
    return unbound(url,'','bound_video_changed',pageVisible);
  return sample;
}
export const WATCH_EXPRESSION=`(${watch.toString()})(${pageRestriction.toString()})`;

// Clip is limited to the visible bound player so a frame never captures the
// composer, side bars or private message panes.
function boundFrameClip(){
  const visible=element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);
    return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility!=='visible'&&Number(s.opacity)>0;};
  const roots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible);
  if(roots.length!==1)return {ready:false,reason:'bound_player_not_unique'};
  const videos=[...document.querySelectorAll('video')].filter(visible).filter(v=>roots[0].contains(v));
  if(videos.length!==1)return {ready:false,reason:'bound_player_not_found'};
  const r=videos[0].getBoundingClientRect();
  const x=Math.max(0,Math.floor(r.left)),y=Math.max(0,Math.floor(r.top));
  const width=Math.min(Math.floor(r.width),Math.max(1,innerWidth-x)),height=Math.min(Math.floor(r.height),Math.max(1,innerHeight-y));
  if(width<8||height<8||width>1600||height>1600)return {ready:false,reason:'bound_frame_size_refused'};
  return {ready:true,clip:{x,y,width,height,scale:1}};
}
export const BOUND_FRAME_CLIP_EXPRESSION=`(${boundFrameClip.toString()})()`;

const numbers=['currentTime','duration','playbackRate','volume'];
export function validateWatchSample(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid watch sample');
  if(!['','login','verification'].includes(value.restriction))throw Error('Invalid watch restriction');
  if(typeof value.url!=='string'||value.url.length>500)throw Error('Invalid watch url');
  if(typeof value.pageVisible!=='boolean')throw Error('Invalid watch visibility');
  if(value.bound!==true){
    if(typeof value.reason!=='string'||!value.reason||value.reason.length>80)throw Error('Invalid watch failure reason');
    return {bound:false,reason:value.reason,restriction:value.restriction,url:value.url,pageVisible:value.pageVisible};
  }
  if(!/^\d{10,25}$/.test(value.videoId)||!/^[a-f0-9]{64}$/.test(value.videoKey))throw Error('Invalid watch binding');
  for(const key of numbers)if(!Number.isFinite(value[key]))throw Error('Invalid watch value: '+key);
  if(value.currentTime<0||Number.isFinite(value.duration)&&value.duration>0&&value.currentTime>value.duration+1)throw Error('Impossible playback position');
  for(const key of ['paused','seeking','ended','muted','captionPresent'])if(typeof value[key]!=='boolean')throw Error('Invalid watch flag: '+key);
  if(!Number.isInteger(value.readyState)||value.readyState<0||value.readyState>4)throw Error('Invalid watch ready state');
  // `bound` travels with the sample so a caller can never mistake a bare
  // playback reading for a verified binding.
  return {bound:true,sample:{bound:true,url:value.url,videoId:value.videoId,videoKey:value.videoKey,pageVisible:value.pageVisible,
    currentTime:value.currentTime,duration:value.duration,paused:value.paused,seeking:value.seeking,ended:value.ended,
    readyState:value.readyState,playbackRate:value.playbackRate,muted:value.muted,captionPresent:value.captionPresent}};
}
