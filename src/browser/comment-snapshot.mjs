// Provisional DOM contract. Live Douyin selectors have NOT been validated.
import {captureVisibleCards} from './visible-comment-cards.mjs';
// No fallback to text matching, DOM row number, network endpoints or page state.
async function captureComments(base){
  const out={...base,commentSnapshot:{status:'unsupported_structure',comments:[]}};
  if(base.restriction||!base.captionBound||base.visibleVideoCount!==1||!base.videoKey)return out;
  const url=new URL(location.href);
  const videoId=url.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||url.searchParams.get('modal_id');
  if(!/^\d{10,25}$/.test(videoId||''))return out;
  const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};
  if([...document.querySelectorAll('[role="dialog"]')].some(visible))return out;
  const shape=e=>({tag:e.tagName,marker:(e.getAttribute('data-e2e')||'').slice(0,80),className:(e.getAttribute('class')||'').slice(0,180),attributes:[...(e.attributes||[])].map(a=>a.name).slice(0,15),identityAttributes:Object.fromEntries(['id','data-id','data-comment-id','data-cid','data-video-id'].map(k=>[k,e.getAttribute(k)]).filter(([,v])=>/^(?:comment[-_])?\d{10,25}$/.test(v||'')))});
  out.commentSnapshot.diagnostic={
    candidates:[...document.querySelectorAll('[data-e2e*="comment"],[class*="comment"]')].filter(visible).slice(0,10).map(e=>({...shape(e),children:[...(e.children||[])].slice(0,6).map(child=>({...shape(child),children:[...(child.children||[])].slice(0,4).map(shape)}))})),
    controls:[...document.querySelectorAll('button,[role="button"],[data-e2e="video-comment"]')].filter(visible).slice(0,12).map(e=>({...shape(e),label:(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').slice(0,60)})),
    editors:[...document.querySelectorAll('[contenteditable],[role="textbox"],textarea,[class*="comment-input"]')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&r.width>0&&r.height>0;}).slice(0,6).map(e=>({...shape(e),placeholder:(e.getAttribute('data-placeholder')||e.getAttribute('placeholder')||'').slice(0,80),editable:e.getAttribute('contenteditable')})),
    interactionUi:(()=>{
      let count=0;
      const tree=(e,depth)=>{
        if(++count>120)return null;
        const node={tag:e.tagName,marker:(e.getAttribute('data-e2e')||'').slice(0,80),className:(e.getAttribute('class')||'').slice(0,120),state:Object.fromEntries(['aria-label','aria-pressed','aria-disabled','disabled','role','contenteditable','fill','data-state'].map(k=>[k,e.getAttribute(k)]).filter(([,v])=>v!==null))};
        if(!e.children?.length&&!e.closest?.('[contenteditable],textarea'))node.labelText=(e.innerText||'').slice(0,80);
        if(depth>0)node.children=[...(e.children||[])].slice(0,8).map(child=>tree(child,depth-1)).filter(Boolean);
        return node;
      };
      return {
        reactionControls:[...document.querySelectorAll('[data-e2e="feed-active-video"] [data-e2e]')].filter(visible).slice(0,25).map(e=>tree(e,0)),
        composers:[...document.querySelectorAll('.comment-input-container')].filter(e=>getComputedStyle(e).display!=='none').slice(0,1).map(e=>tree(e,7)),
        publicAuthors:[...document.querySelectorAll('[data-e2e="feed-active-video"] a[href]')].filter(visible).filter(e=>!e.closest?.('[data-e2e="comment-list"]')).slice(0,6).map(e=>({marker:e.getAttribute('data-e2e'),text:(e.innerText||'').slice(0,80),path:(e.getAttribute('href')||'').split('?')[0].slice(0,240)})),
        messageEntries:[...document.querySelectorAll('a,button,[role="button"]')].filter(visible).filter(e=>/^(私信|消息|我的消息|我)$/.test((e.innerText||'').trim())).slice(0,5).map(e=>({...shape(e),labelText:(e.innerText||'').trim(),href:(e.getAttribute('href')||'').split('?')[0].slice(0,200)})),
      };
    })(),
    commentItems:[...document.querySelectorAll('[data-e2e="comment-item"]')].filter(visible).slice(0,2).map(item=>{
      let count=0;
      const tree=(e,depth)=>{
        if(++count>35)return null;
        const node={...shape(e)};
        const href=e.getAttribute('href');
        if(href){try{const u=new URL(href,location.href);if(u.origin===location.origin&&/^\/user\/[A-Za-z0-9_-]{5,200}$/.test(u.pathname))node.publicAuthorPath=u.pathname;}catch{}}
        if(!e.children?.length)node.visibleText=(e.innerText||'').slice(0,160);
        if(depth>0)node.children=[...(e.children||[])].slice(0,6).map(c=>tree(c,depth-1)).filter(Boolean);
        return node;
      };
      return tree(item,6);
    }),
  };
  while(JSON.stringify(out.commentSnapshot.diagnostic).length>18000&&out.commentSnapshot.diagnostic.commentItems.length)out.commentSnapshot.diagnostic.commentItems.pop();
  while(JSON.stringify(out.commentSnapshot.diagnostic).length>18000&&out.commentSnapshot.diagnostic.candidates.length)out.commentSnapshot.diagnostic.candidates.pop();
  const lists=[...document.querySelectorAll('[data-e2e="comment-list"][data-video-id]')].filter(visible).filter(e=>e.getAttribute('data-video-id')===videoId);
  if(lists.length!==1)return out;
  const list=lists[0],videos=[...document.querySelectorAll('video')].filter(visible),captions=[...document.querySelectorAll('[data-e2e="video-desc"]')].filter(visible);
  if(videos.length!==1||captions.length!==1)return out;
  let container=videos[0].parentElement,bound=false;
  for(let depth=0;container&&depth<6;depth++,container=container.parentElement){
    if(['BODY','HTML'].includes(container.tagName))break;
    if(container.contains(list)&&container.contains(captions[0])){bound=true;break;}
  }
  if(!bound)return out;
  const items=[...list.querySelectorAll('[data-e2e="comment-item"][data-comment-id]')].filter(visible).slice(0,3);
  if(!items.length)return out; // An unsupported DOM must never be reported as an empty inbox.
  const comments=[],seen=new Set();
  for(const item of items){
    const commentId=item.getAttribute('data-comment-id');
    const texts=[...item.querySelectorAll('[data-e2e="comment-content"]')].filter(visible);
    const authors=[...item.querySelectorAll('[data-e2e="comment-user-name"][href]')].filter(visible);
    if(!/^\d{10,25}$/.test(commentId||'')||seen.has(commentId)||texts.length!==1||authors.length!==1)return out;
    const author=new URL(authors[0].getAttribute('href'),location.href),match=author.pathname.match(/^\/user\/([A-Za-z0-9_-]{5,200})$/);
    const text=(texts[0].innerText||'').trim(),authorName=(authors[0].innerText||'').trim();
    if(author.origin!==url.origin||author.username||author.password||author.search||author.hash||!match||!text||[...text].length>300||[...authorName].length>60)return out;
    seen.add(commentId);comments.push({commentId,authorId:match[1],authorName,text});
  }
  const source=videos[0].currentSrc;
  if(!source)return out;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const videoKey=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(location.href!==base.url||!visible(list)||videos[0].currentSrc!==source||videoKey!==base.videoKey)return out;
  out.commentSnapshot={status:'bound_visible_comments',videoId,comments};
  return out;
}
export function commentSnapshotExpression(videoExpression){return `(${videoExpression}).then(${captureComments.toString()}).then(${captureVisibleCards.toString()})`;}
