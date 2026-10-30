// Fixed read-only extraction. This selector is provisional until a separately approved live inspection.
import {pageRestriction} from './page-restriction.mjs';
async function capture(restrictionCheck) {
  const visible = element => {
    const style=getComputedStyle(element), r=element.getBoundingClientRect();
    return style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0&&
      r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
  };
  const restriction=restrictionCheck();
  const result={url:location.href,readyState:document.readyState,title:document.title,
    pageDescription:(document.querySelector('meta[name="description"]')?.content||'').slice(0,500),
    text:'',captionCandidateCount:0,visibleVideoCount:0,videoKey:'',captionBound:false,restriction};
  if(restriction)return result;
  const allVideos=[...document.querySelectorAll('video')];
  const activeRoots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible);
  const active=activeRoots.length===1?activeRoots[0]:null;
  const videos=allVideos.filter(visible).filter(v=>!active||active.contains(v));
  const captions=[...document.querySelectorAll('[data-e2e="video-desc"]')].filter(visible).filter(c=>!active||active.contains(c));
  result.visibleVideoCount=videos.length;result.captionCandidateCount=captions.length;
  if(activeRoots.length>1){result.visibleVideoCount=2;return result;}
  if(active){const u=new URL(location.href),id=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');if(id&&!active.classList.contains('video_'+id))return result;}
  const shape=e=>({tag:e.tagName,className:(e.getAttribute?.('class')||'').slice(0,160),marker:(e.getAttribute?.('data-e2e')||'').slice(0,80)});
  const publicVideoCards=[...document.querySelectorAll('a[href]')].filter(visible).map(a=>{
    try {const u=new URL(a.getAttribute('href'),location.href);return u.origin==='https://www.douyin.com'&&/^\/video\/\d{10,25}$/.test(u.pathname)&&!u.search&&!u.hash?
      {path:u.pathname,title:(a.getAttribute('title')||a.innerText||'').trim().slice(0,200)}:null;}catch{return null;}
  }).filter(Boolean).slice(0,3);
  const cardShapes=[...document.querySelectorAll('[data-e2e*="video"],[data-e2e*="feed"],[class*="video-card"]')].filter(visible).slice(0,8).map(e=>({...shape(e),children:[...(e.children||[])].slice(0,8).map(shape)}));
  result.structure={publicVideoCards,cardShapes,viewport:{width:innerWidth,height:innerHeight},videoElementCount:allVideos.length,videoLayout:allVideos.slice(0,2).map(video=>{
    const r=video.getBoundingClientRect(),s=getComputedStyle(video);
    return {width:r.width,height:r.height,top:r.top,left:r.left,display:s.display,visibility:s.visibility,opacity:s.opacity,paused:video.paused,readyState:video.readyState};
  }),videoAncestors:allVideos.slice(0,2).map(video=>{
    const ancestors=[];let node=video.parentElement;
    for(let i=0;node&&i<6;i++,node=node.parentElement){
      if(['BODY','HTML'].includes(node.tagName))break;
      ancestors.push({...shape(node),children:[...(node.children||[])].slice(0,12).map(shape)});
    }
    return ancestors;
  })};
  if(videos.length!==1||captions.length!==1)return result;
  const video=videos[0],caption=captions[0];
  // Require a nearby shared container; never infer a match merely from page-wide uniqueness.
  let container=video.parentElement;
  for(let depth=0;container&&depth<6;depth++,container=container.parentElement){
    if(['BODY','HTML'].includes(container.tagName))break;
    if(container.contains(caption)){result.captionBound=true;break;}
  }
  if(!result.captionBound||!video.currentSrc)return result;
  const source=video.currentSrc;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  // Hash is only an ephemeral consistency key. Never return or save media URLs.
  result.videoKey=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  result.text=(caption.innerText||'').trim().slice(0,1000);
  if(video.currentSrc!==source||!visible(video)||!visible(caption)||!container?.contains(caption)||!container?.contains(video)){
    result.text='';result.videoKey='';result.captionBound=false;
  }
  result.url=location.href;
  return result;
}
export const SNAPSHOT_EXPRESSION=`(${capture.toString()})(${pageRestriction.toString()})`;
// One normal public-video navigation, never an interaction button or arbitrary selector.
function openPublicCard(){
  if(location.href!=='https://www.douyin.com/jingxuan')return {clicked:false};
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))return {clicked:false};
  const card=[...document.querySelectorAll('.discover-video-card-item .jingxuanVideoCard')].find(visible);
  if(!card)return {clicked:false};
  const anchor=card.closest('a[href]')||card.querySelector('a[href]');
  if(anchor){try{const u=new URL(anchor.getAttribute('href'),location.href);if(u.origin!=='https://www.douyin.com'||!/^\/video\/\d{10,25}$/.test(u.pathname)||u.search||u.hash)return {clicked:false};}catch{return {clicked:false};}}
  card.click();
  return {clicked:true};
}
export const OPEN_PUBLIC_CARD_EXPRESSION=`(${openPublicCard.toString()})()`;
