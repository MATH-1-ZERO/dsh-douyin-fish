// Selectors below were observed in the dedicated Edge session on 2026-10-24.
export async function captureVisibleCards(base){
 if(base.commentSnapshot?.status!=='unsupported_structure'||base.restriction||!base.captionBound||base.visibleVideoCount!==1)return base;
 const u=new URL(location.href),videoId=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');
 if(!/^\d{10,25}$/.test(videoId||''))return base;
 if(u.origin!=='https://www.douyin.com'||u.username||u.password||u.hash)return base;
 if(u.pathname==='/jingxuan'&&([...u.searchParams].length!==1||!u.searchParams.has('modal_id')))return base;
 if(u.pathname!=='/jingxuan'&&(u.pathname!=='/video/'+videoId||u.search))return base;
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 if([...document.querySelectorAll('[role="dialog"]')].some(visible))return base;
 const roots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible),lists=[...document.querySelectorAll('[data-e2e="comment-list"]')].filter(visible),videos=[...document.querySelectorAll('video')].filter(visible).filter(e=>roots.length===1&&roots[0].contains(e));
 if(roots.length!==1||lists.length!==1||videos.length!==1||!roots[0].classList?.contains('video_'+videoId)||!roots[0].contains(lists[0])||!roots[0].contains(videos[0]))return base;
 const items=[...lists[0].querySelectorAll('[data-e2e="comment-item"]')].filter(visible).slice(0,10),comments=[],bindings=[],seen=new Set();
 const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 for(const item of items){
  const texts=[...item.querySelectorAll('.FduGc_lz')].filter(visible),authors=[...item.querySelectorAll('.comment-item-info-wrap a[href]')].filter(visible);
  if(texts.length!==1||authors.length!==1)continue;
  const a=new URL(authors[0].getAttribute('href'),location.href),authorId=a.pathname.match(/^\/user\/([A-Za-z0-9_-]{5,200})$/)?.[1],text=(texts[0].innerText||'').trim(),authorName=(authors[0].innerText||'').trim();
  if(a.origin!==u.origin||a.username||a.password||a.search||a.hash||!authorId||!text||[...text].length>300||[...authorName].length>60)continue;
  const localCommentKey=await sha(JSON.stringify([videoId,authorId,text]));
  if(seen.has(localCommentKey))return base;
  seen.add(localCommentKey);comments.push({localCommentKey,authorId,authorName,text});bindings.push({item,node:texts[0],text,author:authors[0],href:authors[0].getAttribute('href')});
  if(comments.length===3)break;
 }
 if(!comments.length)return base;
 const source=videos[0].currentSrc,videoKey=await sha(source);
 if(!source||videoKey!==base.videoKey||videos[0].currentSrc!==source||location.href!==base.url||bindings.some(b=>!visible(b.item)||!roots[0].contains(b.item)||(b.node.innerText||'').trim()!==b.text||b.author.getAttribute('href')!==b.href))return base;
 return {...base,commentSnapshot:{status:'bound_visible_cards',identityKind:'dom_fingerprint',videoId,comments,diagnostic:base.commentSnapshot.diagnostic}};
}
