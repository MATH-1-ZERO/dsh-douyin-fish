// Only opens the observed public comment panel. Never clicks reply/send/like.
function openCommentPanel(){
  const u=new URL(location.href),id=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');
  if(u.origin!=='https://www.douyin.com'||u.username||u.password||u.hash||!/^\d{10,25}$/.test(id||''))return {clicked:false};
  if(u.pathname==='/jingxuan'&&([...u.searchParams].length!==1||!u.searchParams.has('modal_id')))return {clicked:false};
  if(u.pathname!=='/jingxuan'&&(u.pathname!=='/video/'+id||u.search))return {clicked:false};
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))return {clicked:false};
  const roots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible);
  if(roots.length!==1||!roots[0].classList.contains('video_'+id))return {clicked:false};
  const root=roots[0],videos=[...document.querySelectorAll('video')].filter(visible).filter(e=>root.contains(e)),captions=[...document.querySelectorAll('[data-e2e="video-desc"]')].filter(visible).filter(e=>root.contains(e));
  if(videos.length!==1||captions.length!==1||!root.contains(videos[0])||!root.contains(captions[0]))return {clicked:false};
  const icons=[...root.querySelectorAll('[data-e2e="feed-comment-icon"]')].filter(visible);
  if(icons.length!==1)return {clicked:false};
  const commentElements=[...document.querySelectorAll('[data-e2e*="comment"],[class*="comment"]')].filter(visible);
  if(!commentElements.length||commentElements.some(e=>e!==icons[0]&&!icons[0].contains(e)))return {clicked:false};
  icons[0].click();return {clicked:true};
}
export const OPEN_COMMENT_PANEL_EXPRESSION=`(${openCommentPanel.toString()})()`;
