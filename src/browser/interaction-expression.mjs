import {pageRestriction} from './page-restriction.mjs';
import {classifyLikeState} from './like-state.mjs';
import {commentFingerprint} from '../comment-policy.js';
import {nativeControls} from './native-controls.mjs';
import {mentionSvgPath} from './native-icon-fingerprint.mjs';
function interactionOperation(input,restrictionCheck,classifyLike,nativeUi){
 const u=new URL(location.href),id=u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');
 const deny=reason=>({ready:false,reason});
 const restriction=restrictionCheck();
 if(restriction)return deny(restriction==='verification'?'manual_verification_required':'manual_login_required');
 if(u.origin!=='https://www.douyin.com'||id!==input.videoId||u.username||u.password||u.hash)return deny('video_changed');
 if(u.pathname==='/jingxuan'&&([...u.searchParams].length!==1||!u.searchParams.has('modal_id')))return deny('unsafe_route');
 if(u.pathname!=='/jingxuan'&&(u.pathname!=='/video/'+id||u.search))return deny('unsafe_route');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 if(input.phase!=='native_inspect'&&[...document.querySelectorAll('[role="dialog"]')].some(visible))return deny('dialog_visible');
 const roots=[...document.querySelectorAll('[data-e2e="feed-active-video"]')].filter(visible),videos=[...document.querySelectorAll('video')].filter(visible).filter(v=>roots.length===1&&roots[0].contains(v));
 if(roots.length!==1||videos.length!==1||!roots[0].classList.contains('video_'+id)||!roots[0].contains(videos[0]))return deny('video_not_bound');
 const root=roots[0],boxes=[...root.querySelectorAll('.comment-input-container')].filter(visible);
 if(['native_inspect','point_share_open','point_share_owner_hover','composer_geometry','point_mention_open','point_next_video','mention_query_append_guard','point_mention_candidate','point_native_share_send',"native_mention_state","native_mention_diagnostic","native_mention_append_guard","native_mention_clear_guard","native_mention_verify_clear","native_mention_receipt","point_native_mention_submit"].includes(input.phase))return nativeUi(input,root,visible);
 const editors=boxes.flatMap(box=>[...box.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],textarea,input[type="text"]')].filter(visible));
 const editorText=e=>(['INPUT','TEXTAREA'].includes(e.tagName)?e.value:e.innerText)||'';
 const author=root.querySelector('[data-e2e="video-avatar"][href]');
 const authorPath=author?new URL(author.getAttribute('href'),location.href).pathname:null;
 const likes=[...root.querySelectorAll('[data-e2e="video-player-digg"]')].filter(visible);
 const like=likes.length===1?likes[0]:null;
 const likeInfo=like?{className:like.getAttribute('class'),ariaPressed:like.getAttribute('aria-pressed'),e2eState:like.getAttribute('data-e2e-state'),title:like.getAttribute('title'),svg:[...like.querySelectorAll('svg,path,use')].slice(0,4).map(e=>({tag:e.tagName,fill:e.getAttribute('fill'),computedFill:getComputedStyle(e).fill,color:getComputedStyle(e).color,href:e.getAttribute('href')||e.getAttribute('xlink:href')}))}:null;
 let replyParent;
 if(input.replyBinding){
  const b=input.replyBinding;
  const parents=[...root.querySelectorAll('[data-e2e="comment-item"]')].filter(visible).filter(item=>{
   const own=selector=>[...item.querySelectorAll(selector)].filter(visible).filter(e=>e.closest('[data-e2e="comment-item"]')===item);
   const texts=own('.FduGc_lz'),authors=own('.comment-item-info-wrap a[href]');
   if(texts.length!==1||authors.length!==1||(texts[0].innerText||'').trim()!==b.text||(authors[0].innerText||'').trim()!==b.authorName)return false;
   try{const a=new URL(authors[0].getAttribute('href'),u.href);return a.origin===u.origin&&a.pathname==='/user/'+b.authorId&&!a.search&&!a.hash&&!a.username&&!a.password;}catch{return false;}
  });
  if(parents.length!==1)return deny('reply_parent_changed');replyParent=parents[0];
 }
 const matchingComments=typeof input.text==='string'?[...root.querySelectorAll('[data-e2e="comment-item"]')].filter(visible).filter(item=>!input.replyBinding||item!==replyParent&&replyParent.contains(item)).slice(0,50).flatMap(item=>{
  const texts=[...item.querySelectorAll('.FduGc_lz')].filter(visible),authors=[...item.querySelectorAll('.comment-item-info-wrap a[href]')].filter(visible);
  if(texts.length!==1||authors.length!==1||(texts[0].innerText||'').trim()!==input.text)return [];
  const a=new URL(authors[0].getAttribute('href'),location.href),authorId=a.pathname.match(/^\/user\/([A-Za-z0-9_-]{5,200})$/)?.[1];
  return a.origin===u.origin&&authorId?[{authorId,recent:/刚刚|\d+秒前|1分钟前/.test(item.innerText||'')}]:[];
 }):[];
 if(likeInfo){
  likeInfo.visibleSvg=[...like.querySelectorAll('svg,path,use')].filter(visible).slice(0,16).map(e=>({tag:e.tagName,fill:e.getAttribute('fill'),computedFill:getComputedStyle(e).fill,color:getComputedStyle(e).color}));
  likeInfo.states=[...like.querySelectorAll('[data-e2e-state],[aria-label],[title]')].filter(visible).slice(0,8).map(e=>({state:e.getAttribute('data-e2e-state'),ariaLabel:e.getAttribute('aria-label'),title:e.getAttribute('title')}));
  likeInfo.count=(like.innerText||'').trim().slice(0,30);
  likeInfo.state=classifyLike(likeInfo);
 }
 if(input.phase==='inspect')return {ready:true,authorPath,boxCount:boxes.length,editorCount:editors.length,editorEmpty:editors.length===1?editorText(editors[0]).trim()==='':null,like:likeInfo,
  matchingComments,textControls:boxes.flatMap(box=>[...box.querySelectorAll('button,[role="button"],span,div')].filter(visible).filter(e=>!e.children.length&&!e.closest('[contenteditable]')).map(e=>({tag:e.tagName,text:(e.innerText||'').trim().slice(0,60),className:(e.getAttribute('class')||'').slice(0,120)}))).filter(c=>c.text).slice(0,15)};
 if(input.phase==='receipt')return {ready:true,matches:matchingComments,editorEmpty:editors.length===0||editors.length===1&&!editorText(editors[0]).trim()};
 if(input.phase==='mention_inspect'){
  if(editors.length!==1||editorText(editors[0]).trim()!==input.text)return deny('mention_query_changed');
  // Douyin renders the mention candidate popup as a Semi Design dropdown, so the
  // classic listbox/mention selectors miss it on the real page.
  const containers=[...document.querySelectorAll('[role="listbox"],[class*="mention" i],[data-e2e*="mention" i],[class*="semi-dropdown" i]')].filter(visible).filter(e=>!root.contains(e)||!e.contains(editors[0]));
  const links=[...new Set(containers.flatMap(e=>[...e.querySelectorAll('a[href]')].filter(visible)))];
  const matches=links.filter(e=>{try{const url=new URL(e.getAttribute('href'),u.href);return url.origin===u.origin&&url.pathname==='/user/'+input.mentionOwner.platformId&&!url.search&&!url.hash&&!url.username&&!url.password;}catch{return false;}});
  return {ready:true,queryUnchanged:true,containerCount:containers.length,publicProfileLinkCount:links.length,verifiedOwnerCandidateCount:matches.length,
   structure:containers.slice(0,6).map(e=>({tag:e.tagName,role:e.getAttribute('role'),className:(e.getAttribute('class')||'').slice(0,120),visibleOptionCount:[...e.querySelectorAll('[role="option"],li,button')].filter(visible).length}))};
 }
 if(input.phase==='refresh'){location.reload();return {ready:true,refreshRequested:true};}
 if(input.phase==='focus'){
  if(boxes.length!==1)return deny('composer_ambiguous');
  if(editors.length===1){if((editors[0].innerText||'').trim())return deny('existing_draft_preserved');editors[0].focus();return {ready:true,focused:true};}
  const inner=[...boxes[0].querySelectorAll('.comment-input-inner-container')].filter(visible);
  if(inner.length!==1)return deny('composer_not_found');inner[0].click();return {ready:true,focused:true};
 }
 const replyComposerBound=()=>{
  if(!input.replyBinding)return !(boxes[0]?.querySelector('.r2YYQP1x')?.innerText||'').trim();
  const label=(boxes[0]?.querySelector('.r2YYQP1x')?.innerText||'').replace(/\s/g,'');
  const name=input.replyBinding.authorName.replace(/\s/g,'');
  return name&&['回复'+name,'回复'+name+':','回复'+name+'：'].includes(label);
 };
 if(input.phase==='point_like'||input.phase==='point_focus'||input.phase==='point_submit'||input.phase==='point_reply'){
  let target;
  if(input.phase==='point_like'){
    if(!like||likeInfo.state!=='unliked')return deny('like_not_in_unliked_state');
    target=like;
  }else if(input.phase==='point_reply'){
    if(!replyParent||boxes.length!==1||editors.some(e=>editorText(e).trim()))return deny('reply_composer_not_empty');
    const controls=[...replyParent.querySelectorAll('.comment-item-stats-container span,.comment-item-stats-container div,.comment-item-stats-container p,.comment-item-stats-container button')].filter(visible).filter(e=>e.closest('[data-e2e="comment-item"]')===replyParent&&(e.innerText||'').trim()==='回复'&&![...(e.children||[])].some(c=>(c.innerText||'').trim()==='回复'));
    if(controls.length!==1)return deny('reply_control_ambiguous');target=controls[0];
  }else if(input.phase==='point_submit'){
    if(boxes.length!==1||editors.length!==1||editorText(editors[0]).trim()!==input.text)return deny('submission_text_changed');
    if(!replyComposerBound())return deny('unexpected_reply_target');
    const sends=[...boxes[0].querySelectorAll('.commentInput-right-ct .wchsYBpK')].filter(visible);
    if(sends.length!==1)return deny('send_control_ambiguous');target=sends[0];
  }else{
    if(boxes.length!==1)return deny('composer_ambiguous');
    if(editors.some(e=>editorText(e).trim()))return deny('existing_draft_preserved');
    target=boxes[0].querySelector('.comment-input-inner-container');
    if(!target||!visible(target))return deny('composer_not_found');
  }
  const r=target.getBoundingClientRect(),x=r.left+(input.phase==='point_focus'?Math.min(24,r.width/2):r.width/2),y=r.top+(input.phase==='point_like'?Math.min(20,r.height/3):r.height/2),hit=document.elementFromPoint(x,y);
  const allowedTarget=input.phase==='point_like'?like:target;
  if(!hit||hit!==allowedTarget&&!allowedTarget.contains(hit))return {...deny('control_occluded'),point:{x,y},hitTag:hit?.tagName,hitClass:hit?.getAttribute('class')};
  return {ready:true,point:{x,y}};
 }
 if(['input_guard','clear_guard','verify_input','verify_clear'].includes(input.phase)){
  if(input.phase==='verify_clear'&&editors.length===0&&boxes.length===1&&(boxes[0].innerText||'').includes('留下你的精彩评论吧'))return {ready:true,cleared:true,collapsed:true};
  if(editors.length!==1)return deny('editor_not_unique');
  const editor=editors[0],current=editorText(editor).replace(/\r/g,'').trim();
  if(input.phase==='input_guard'){
    if(!replyComposerBound())return deny('unexpected_reply_target');
    if(current)return deny('existing_draft_preserved');editor.focus();return {ready:true};
  }
  if(input.phase==='verify_input')return {ready:current===input.text,filled:current===input.text};
  if(input.phase==='verify_clear')return {ready:current==='',cleared:current===''};
  if(current!==input.text)return deny('draft_changed_do_not_clear');
  editor.focus();if(['INPUT','TEXTAREA'].includes(editor.tagName))editor.select();else{const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}return {ready:true};
 }
 return deny('operation_not_supported');
}
export function interactionExpression(input){
 if(!input||!['inspect','focus','receipt','refresh','point_like','point_focus','point_submit','input_guard','clear_guard','verify_input','verify_clear','mention_inspect','point_reply','native_inspect','point_share_open','point_share_owner_hover','composer_geometry','point_mention_open','point_next_video','mention_query_append_guard','point_mention_candidate','point_native_share_send',"native_mention_state","native_mention_diagnostic","native_mention_append_guard","native_mention_clear_guard","native_mention_verify_clear","native_mention_receipt","point_native_mention_submit"].includes(input.phase)||typeof input.videoId!=='string'||!/^\d{10,25}$/.test(input.videoId))throw Error('Invalid browser operation');
 if(input.recipientKind==='selected_conversation'){
  if(!['point_share_open','point_native_share_send'].includes(input.phase)||!/^[a-f0-9]{64}$/.test(input.recipientKey||'')||typeof input.account!=='string'||!input.account.startsWith('https://')||input.account.length>2048||typeof input.ownerName!=='string'||!input.ownerName||input.ownerName.length>60||typeof input.ownerAvatarResource!=='string'||!/^\/img\/aweme-avatar\/[A-Za-z0-9_/-]{5,300}$/.test(input.ownerAvatarResource))throw Error('Invalid selected native share scope');
 }else{
  if(['point_mention_candidate','point_native_share_send',"native_mention_state","native_mention_diagnostic","native_mention_append_guard","native_mention_clear_guard","native_mention_verify_clear","native_mention_receipt","point_native_mention_submit"].includes(input.phase)&&(!/^[A-Za-z0-9_-]{5,200}$/.test(input.ownerPlatformId||'')||typeof input.ownerName!=='string'||!input.ownerName||input.ownerName.length>60||typeof input.ownerAvatarResource!=='string'||!/^\/img\/aweme-avatar\/[A-Za-z0-9_/-]{5,300}$/.test(input.ownerAvatarResource)))throw Error('Fresh public owner avatar binding required');
  if(['native_inspect','point_share_open','point_share_owner_hover','mention_query_append_guard'].includes(input.phase)&&(!/^[A-Za-z0-9_-]{5,200}$/.test(input.ownerPlatformId||'')||typeof input.ownerName!=='string'||!input.ownerName||input.ownerName.length>60||!/^[-A-Za-z0-9_.]{1,80}$/.test(input.ownerHandle||'')))throw Error('Invalid native owner scope');
 }
 if(["native_mention_state","native_mention_diagnostic","native_mention_append_guard","native_mention_clear_guard","native_mention_verify_clear","native_mention_receipt","point_native_mention_submit"].includes(input.phase)&&(typeof input.mentionText!=='string'||!input.mentionText.trim()||input.mentionText.trim()!==input.mentionText||[...input.mentionText].length>40||/[@＠]|https?:\/\/|[\r\n]/iu.test(input.mentionText)))throw Error('Invalid native mention body');
 if(input.replyBinding!==undefined){
  const b=input.replyBinding;
  if(!b||typeof b.text!=='string'||!b.text.trim()||[...b.text].length>300||typeof b.authorName!=='string'||!b.authorName.trim()||[...b.authorName].length>60||typeof b.authorId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(b.authorId)||b.localCommentKey!==commentFingerprint(input.videoId,b.authorId,b.text)||input.mentionOwner!==undefined)throw Error('Invalid exact reply binding');
 }
 if(input.phase==='point_reply'&&!input.replyBinding)throw Error('Exact reply binding required');
 const mentionQuery=input.mentionOwner!==undefined;
 if(mentionQuery&&(!input.mentionOwner||typeof input.mentionOwner.platformId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(input.mentionOwner.platformId)||typeof input.mentionOwner.handle!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(input.mentionOwner.handle)||input.mentionOwner.name!==undefined&&(typeof input.mentionOwner.name!=='string'||!input.mentionOwner.name||input.mentionOwner.name.length>60)||!['@','@'+input.mentionOwner.handle,...(input.mentionOwner.name?['@'+input.mentionOwner.name]:[])].includes(input.text)||!['input_guard','clear_guard','verify_input','verify_clear','mention_inspect','inspect'].includes(input.phase)))throw Error('Invalid owner mention query');
 if(input.phase==='mention_inspect'&&!mentionQuery)throw Error('Exact owner mention required');
 if(['point_submit','input_guard','clear_guard','verify_input','verify_clear'].includes(input.phase)&&(typeof input.text!=='string'||!input.text.trim()||[...input.text].length>300||(/[@＠]|https?:\/\//iu.test(input.text)&&!mentionQuery)))throw Error('Invalid comment input');
 return `(${interactionOperation.toString()})(${JSON.stringify(input)},${pageRestriction.toString()},${classifyLikeState.toString()},(input,root,visible)=>(${nativeControls.toString()})(input,root,visible,${JSON.stringify(mentionSvgPath)}))`;
}
