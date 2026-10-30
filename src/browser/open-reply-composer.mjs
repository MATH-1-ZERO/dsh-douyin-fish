// Diagnostic only: open a specific reply composer; never fill it or send.
async function openReply(expected){
 const u=new URL(location.href),id=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');
 if(u.origin!=='https://www.douyin.com'||id!==expected.videoId||u.username||u.password||u.hash)return {clicked:false};
 if(u.pathname==='/jingxuan'&&([...u.searchParams].length!==1||!u.searchParams.has('modal_id')))return {clicked:false};
 if(u.pathname!=='/jingxuan'&&(u.pathname!=='/video/'+id||u.search))return {clicked:false};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 if([...document.querySelectorAll('[role="dialog"]')].some(visible))return {clicked:false};
 const roots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible),lists=[...document.querySelectorAll('[data-e2e="comment-list"]')].filter(visible);
 if(roots.length!==1||lists.length!==1||!roots[0].classList.contains('video_'+id)||!roots[0].contains(lists[0]))return {clicked:false};
 const matches=[];
 for(const item of [...lists[0].querySelectorAll('[data-e2e="comment-item"]')].filter(visible).slice(0,30)){
  const texts=[...item.querySelectorAll('.FduGc_lz')].filter(visible),authors=[...item.querySelectorAll('.comment-item-info-wrap a[href]')].filter(visible);
  if(texts.length!==1||authors.length!==1)continue;
  const a=new URL(authors[0].getAttribute('href'),location.href),authorId=a.pathname.match(/^\/user\/([A-Za-z0-9_-]{5,200})$/)?.[1],text=(texts[0].innerText||'').trim();
  if(!authorId||a.origin!==u.origin||a.search||a.hash||a.username||a.password)continue;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([id,authorId,text])));
  const key=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(key===expected.key)matches.push({item,textNode:texts[0],text,author:authors[0],href:authors[0].getAttribute('href')});
 }
 if(matches.length!==1)return {clicked:false};
 const m=matches[0],controls=[...m.item.querySelectorAll('.comment-item-stats-container span,.comment-item-stats-container div,.comment-item-stats-container p,.comment-item-stats-container button')].filter(visible).filter(e=>(e.innerText||'').trim()==='回复'&&![...(e.children||[])].some(c=>(c.innerText||'').trim()==='回复'));
 if(controls.length!==1||location.href!==u.href||!visible(m.item)||(m.textNode.innerText||'').trim()!==m.text||m.author.getAttribute('href')!==m.href)return {clicked:false};
 controls[0].click();return {clicked:true};
}
export function replyComposerExpression(videoId,key){
 if(typeof videoId!=='string'||!/^\d{10,25}$/.test(videoId)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid diagnostic reply identity');
 return `(${openReply.toString()})(${JSON.stringify({videoId,key})})`;
}
