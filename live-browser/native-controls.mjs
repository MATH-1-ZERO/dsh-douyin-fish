// Structural diagnostics only. Do not return contact lists, message bodies,
// images, input values, cookies or application memory.
export function nativeControls(input,root,visible,mentionSvgPath){
 const asset=src=>{try{const relative=typeof src==='string'&&src.startsWith('/')&&!src.startsWith('//'),u=new URL(src,location.href),trusted=/^(?:[a-z0-9-]+\.)*(?:douyinpic\.com|byteimg\.com|pstatp\.com|douyincdn\.com)$/.test(u.hostname),p=u.pathname.split('~')[0],m=p.match(/\/aweme-avatar\/([A-Za-z0-9_/-]+?)(?:\.(?:jpe?g|png|webp))?$/);return u.protocol==='https:'&&!u.username&&!u.password&&(relative||trusted)&&m?'/aweme-avatar/'+m[1]:null;}catch{return null;}};
 if(input.recipientKind==='selected_conversation'){
  const accounts=[...document.querySelectorAll('a[href="//www.douyin.com/user/self"] img,a[href="https://www.douyin.com/user/self"] img')].filter(visible);
  const image=e=>{try{const u=new URL(e.getAttribute('src'),location.href);return u.protocol==='https:'?(asset(u.href)||u.origin+u.pathname):null;}catch{return null;}};
  if(accounts.length!==1||image(accounts[0])!==(asset(input.account)||input.account))return {ready:false,reason:'conversation_account_changed'};
 }
 const pointFor=target=>{const r=target.getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);return hit&&(hit===target||target.contains(hit))?{ready:true,point}:{ready:false,reason:'native_control_occluded'};};
 if(input.phase==='point_next_video'){
  if([...root.querySelectorAll('[contenteditable="true"],textarea,input[type="text"]')].filter(visible).some(e=>(e.value||e.innerText||'').trim()))return {ready:false,reason:'existing_input_preserved'};
  const videos=[...root.querySelectorAll('video')].filter(visible);if(videos.length!==1)return {ready:false,reason:'video_scroll_target_ambiguous'};
  const r=videos[0].getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||!root.contains(hit)||hit.closest('[contenteditable],input,textarea'))return {ready:false,reason:'video_scroll_target_occluded'};
  return {ready:true,point};
 }
 if(input.phase.startsWith('native_mention_')||input.phase==='point_native_mention_submit'){
  const normal=t=>(t||'').replace(/[\u200B\uFEFF]/g,'').replace(/\r/g,'').trim(),prefix='@'+input.ownerName,full=prefix+' '+input.mentionText;
  const boxes=[...root.querySelectorAll('.comment-input-container')].filter(visible),editors=boxes.flatMap(b=>[...b.querySelectorAll('[contenteditable="true"]')].filter(visible));
  // DraftJS inserts a nonbreaking separator after selecting an @ entity.
  // Normalize only that separator, never arbitrary spaces in the body.
  const canonical=t=>{const n=normal(t);return n.startsWith(prefix)?prefix+n.slice(prefix.length).replace(/^[\s\u00a0]+/u,' '):n;};
  const editor=editors.length===1?editors[0]:null,current=canonical(editor?.innerText),tokens=editor?[...editor.querySelectorAll('.douyin_mention_word')]:[],selected=!!editor&&tokens.length===1&&normal(tokens[0].innerText)===prefix&&![...root.querySelectorAll('.atBox-inner-container')].some(visible);
  if(input.phase==='native_mention_diagnostic'){
   const rows=[...root.querySelectorAll('[data-e2e="comment-item"]')].filter(e=>(e.innerText||'').includes(input.mentionText));
   return {ready:true,commentItemCount:root.querySelectorAll('[data-e2e="comment-item"]').length,matchingRows:rows.slice(0,2).map(e=>({visible:visible(e),textNodes:[...e.querySelectorAll('.FduGc_lz')].map(t=>({text:normal(t.innerText).slice(0,120),canonicalMatches:canonical(t.innerText)===full})),profileLinks:[...e.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.getAttribute('href'),location.href);return u.origin==='https://www.douyin.com'&&u.pathname.startsWith('/user/')?{path:u.pathname,queryKeys:[...u.searchParams.keys()],text:normal(a.innerText).slice(0,60)}:null;}catch{return null;}}).filter(Boolean)}))};
  }
  if(input.phase==='native_mention_receipt'){
   const matches=[...root.querySelectorAll('[data-e2e="comment-item"]')].filter(visible).filter(e=>{const text=e.querySelector('.FduGc_lz');return text&&canonical(text.innerText)===full;}).map(e=>{
    const a=e.querySelector('.comment-item-info-wrap a[href]');let authorId=null;try{authorId=new URL(a?.getAttribute('href'),location.href).pathname.match(/^\/user\/([A-Za-z0-9_-]{5,200})$/)?.[1]||null;}catch{}
    const linked=[...e.querySelectorAll('.FduGc_lz a[href]')].some(a=>{try{const u=new URL(a.getAttribute('href'),location.href);return u.origin==='https://www.douyin.com'&&u.pathname==='/user/'+input.ownerPlatformId&&!u.search&&!u.hash;}catch{return false;}});
    return {authorId,ownerMentionLinked:linked};
   });return {ready:true,matches,editorEmpty:!current};
  }
  if(input.phase==='native_mention_state')return {ready:true,selected,filled:selected&&current===full,editorEmpty:!current,prefixOnly:current===prefix,textLength:[...current].length,tokenCount:tokens.length,tokenMatchesOwner:tokens.length===1&&normal(tokens[0].innerText)===prefix,knownOwnedText:full.startsWith(current)?current:undefined};
  if(input.phase==='native_mention_verify_clear')return {ready:!current,cleared:!current};
  if(input.phase==='native_mention_clear_guard'){
   const allowed=['@',prefix,full,...(input.knownBackspaceRecovery===true?[[...full].slice(0,-1).join('')]:[])];
   if(!editor||!allowed.includes(current))return {ready:false,reason:'owned_native_draft_changed'};
   editor.focus();if(document.activeElement!==editor)return {ready:false,reason:'owned_editor_focus_not_verified'};return {ready:true};
  }
  if(!selected||boxes.length!==1)return {ready:false,reason:'native_mention_entity_not_selected'};
  if(input.phase==='native_mention_append_guard'){
   if(current!==prefix)return {ready:false,reason:'native_mention_draft_changed'};
   editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return {ready:true};
  }
  if(input.phase==='point_native_mention_submit'){
   if(current!==full||(boxes[0].querySelector('.r2YYQP1x')?.innerText||'').trim())return {ready:false,reason:'native_mention_submission_changed'};
   const sends=[...boxes[0].querySelectorAll('.commentInput-right-ct .wchsYBpK')].filter(visible);return sends.length===1?pointFor(sends[0]):{ready:false,reason:'native_mention_send_ambiguous'};
  }
  return {ready:false,reason:'native_mention_phase_unknown'};
 }
 if(input.phase==='point_mention_candidate'||input.phase==='point_native_share_send'){
  const mention=input.phase==='point_mention_candidate',selector=mention?'.atBox-inner-container .dTwsCivh':'.otFjqQEX',nameSelector=mention?'.lgAE_oZa':'.EnYt_IKl';
  const rows=[...(mention?root:document).querySelectorAll(selector)].filter(visible).filter(e=>[...e.querySelectorAll(nameSelector)].filter(visible).some(n=>(n.innerText||'').trim()===input.ownerName)).filter(e=>{const avatars=[...e.querySelectorAll('img')].filter(visible);return avatars.length===1&&asset(input.ownerAvatarResource)!==null&&asset(avatars[0].currentSrc||avatars[0].src)===asset(input.ownerAvatarResource);});
  // Identical names AND avatar resources can still be ambiguous: never pick
  // the first candidate if the page contains more than one matching row.
  if(rows.length!==1)return {ready:false,reason:'native_owner_name_avatar_not_unique',matchedRows:rows.length};
  if(mention)return pointFor(rows[0]);
  const sends=[...rows[0].querySelectorAll('button,span,div')].filter(visible).filter(e=>(e.innerText||'').trim()==='分享'&&!e.children.length);
  if(sends.length!==1)return {ready:false,reason:'native_share_send_ambiguous'};
  return {...pointFor(sends[0]),recipientBinding:input.recipientKind==='selected_conversation'?'fresh_selected_conversation_name_and_avatar':'fresh_verified_profile_name_and_avatar'};
 }
 const ownerPath='/user/'+input.ownerPlatformId;
 const labels=new Set(['分享','分享到','分享给朋友','分享给好友','私信好友','发送','确认','取消','搜索','复制链接','微信','QQ','@朋友','私信','好友','@','艾特','提及','添加朋友','搜索朋友','搜索用户']);
 let count=0;
 const shape=(e,depth)=>{
  if(++count>150)return null;
  const s={tag:e.tagName,className:(e.getAttribute('class')||'').slice(0,180),role:e.getAttribute('role'),e2e:e.getAttribute('data-e2e'),editable:e.getAttribute('contenteditable'),placeholder:(e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||'').slice(0,60)};
  for(const key of ['aria-label','title','data-icon']){const v=e.getAttribute(key);if(v&&v.length<40&&/分享|发送|提及|@|艾特|表情|图片/.test(v))s[key]=v;}
  const leaf=!e.children.length?(e.innerText||'').trim():'';
  if(labels.has(leaf))s.label=leaf;
  if(leaf===input.ownerName||leaf==='@'+input.ownerName||leaf===input.ownerHandle)s.ownerLabelMatches=true;
  s.identityAttributes=[...(e.attributes||[])].map(a=>a.name).filter(n=>/^(data-(?:uid|user-id|sec-uid|id|entity|type|mention|name)|href|role|aria-label|contenteditable)$/.test(n));
  for(const key of ['data-uid','data-user-id','data-sec-uid','data-id'])if(e.getAttribute(key)===input.ownerPlatformId)s.ownerIdMatchAttribute=key;
  const href=e.getAttribute('href');if(href){try{const u=new URL(href,location.href);if(u.origin==='https://www.douyin.com'&&/^\/user\/[A-Za-z0-9_-]+$/.test(u.pathname)){s.publicProfileLink=true;s.ownerProfileMatches=u.pathname===ownerPath&&!u.search&&!u.hash&&!u.username&&!u.password;}}catch{}}
  if(depth>0)s.children=[...e.children].filter(visible).slice(0,12).map(c=>shape(c,depth-1)).filter(Boolean);
  return s;
 };
 const share=[...root.querySelectorAll('[data-e2e="video-player-share"]')].filter(visible);
 const popups=[...document.querySelectorAll('[role="dialog"],[role="listbox"],[class*="share" i],[class*="mention" i],[class*="suggest" i],[class*="popover" i],[class*="dropdown" i]')].filter(visible).filter(e=>!e.contains(root)&&!root.contains(e)||e!==root&&!e.contains(root.querySelector('video')));
 const outer=popups.filter(e=>!popups.some(p=>p!==e&&p.contains(e))).slice(0,5);
 if(input.phase==='mention_query_append_guard'){
  const editors=[...root.querySelectorAll('.comment-input-container [contenteditable="true"]')].filter(visible);
  if(editors.length!==1||(editors[0].innerText||'').trim()!=='@')return {ready:false,reason:'native_mention_query_changed'};
  editors[0].focus();const range=document.createRange();range.selectNodeContents(editors[0]);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  return {ready:true};
 }
 if(input.phase==='point_mention_open'){
  const boxes=[...root.querySelectorAll('.comment-input-container')].filter(visible);
  if(boxes.length!==1||[...boxes[0].querySelectorAll('[contenteditable="true"],textarea,input')].some(e=>(e.value||e.innerText||'').trim()))return {ready:false,reason:'existing_draft_preserved'};
  const icons=[...boxes[0].querySelectorAll('.oWdMk9B9 > span')].filter(visible).filter(e=>[...e.querySelectorAll('svg path')].map(p=>p.getAttribute('d')||'').join('\n')===mentionSvgPath);
  if(icons.length!==1)return {ready:false,reason:'mention_icon_not_verified'};
  const r=icons[0].getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==icons[0]&&!icons[0].contains(hit))return {ready:false,reason:'mention_icon_occluded'};
  return {ready:true,point};
 }
 if(input.phase==='composer_geometry'){
  const boxes=[...root.querySelectorAll('.comment-input-container')].filter(visible);
  if(boxes.length!==1)return {ready:false,reason:'composer_ambiguous'};
  if([...boxes[0].querySelectorAll('[contenteditable="true"],textarea,input')].some(e=>(e.value||e.innerText||'').trim()))return {ready:false,reason:'existing_draft_preserved'};
  const r=boxes[0].getBoundingClientRect(),x=Math.max(0,r.left),y=Math.max(0,r.top),width=Math.min(innerWidth,r.right)-x,height=Math.min(innerHeight,r.bottom)-y;
  return width>0&&height>0?{ready:true,clip:{x,y,width,height,scale:1}}:{ready:false,reason:'composer_outside_viewport'};
 }
 if(input.phase==='point_share_owner_hover'){
  const rows=[...document.querySelectorAll('.otFjqQEX')].filter(visible).filter(e=>[...e.querySelectorAll('.EnYt_IKl')].filter(visible).some(n=>(n.innerText||'').trim()===input.ownerName));
  if(rows.length!==1)return {ready:false,reason:'owner_share_row_ambiguous'};
  const avatar=rows[0].querySelector('.fP4e2tXU');if(!avatar||!visible(avatar))return {ready:false,reason:'owner_avatar_not_visible'};
  const r=avatar.getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==avatar&&!avatar.contains(hit))return {ready:false,reason:'owner_avatar_occluded'};
  return {ready:true,point,recipientSelected:false};
 }
 if(input.phase==='native_inspect'){
  const controls=[...document.querySelectorAll('button,span,p,div')].filter(visible).filter(e=>!e.children.length&&!e.closest('[contenteditable],[data-e2e="comment-item"],[data-e2e="video-desc"],[data-e2e="msg-item-content"]')).filter(e=>labels.has((e.innerText||'').trim()));
  const contexts=[...new Set(controls.filter(e=>!['分享','好友','私信'].includes((e.innerText||'').trim())).map(e=>e.parentElement?.parentElement).filter(e=>e&&!['BODY','HTML'].includes(e.tagName)))].slice(0,5);
  const editors=[...root.querySelectorAll('.comment-input-container [contenteditable="true"],.comment-input-container textarea')].filter(visible);
  const ownedTokens=editors.length===1?[...editors[0].querySelectorAll('.douyin_mention_word,a,[contenteditable="false"]')].slice(0,5).map(e=>({tag:e.tagName,attributes:[...e.attributes].filter(a=>/^(class|href|contenteditable|data-[a-z-]+)$/.test(a.name)).map(a=>({name:a.name,value:a.value.slice(0,250)})),textMatchesOwner:(e.innerText||'').trim()==='@'+input.ownerName})):[];
  const diagnostic={ownedTokens,ownerCandidates:[...root.querySelectorAll('.atBox-inner-container .dTwsCivh')].filter(e=>[...e.querySelectorAll('.lgAE_oZa')].some(n=>(n.innerText||'').trim()===input.ownerName)).map(e=>({visible:visible(e),avatars:[...e.querySelectorAll('img')].map(i=>({visible:visible(i),resource:asset(i.currentSrc||i.src)}))})).slice(0,4),editorTextLength:editors.length===1?(editors[0].innerText||'').length:null,ownerQueryMatches:editors.length===1&&(editors[0].innerText||'').replace(/[\u200B\uFEFF]/g,'').trim()==='@'+input.ownerName};
  diagnostic.shareRows=[...document.querySelectorAll('.otFjqQEX')].filter(visible).length;
  diagnostic.shareOwnerCandidates=[...document.querySelectorAll('.otFjqQEX')].filter(e=>[...e.querySelectorAll('.EnYt_IKl')].some(n=>(n.innerText||'').trim()===input.ownerName)).slice(0,3).map(e=>({visible:visible(e),avatars:[...e.querySelectorAll('img')].map(i=>({visible:visible(i),resource:asset(i.currentSrc||i.src)}))}));
  return {ready:true,...diagnostic,composerState:{editorCount:editors.length,empty:editors.length===0||editors.length===1&&!(editors[0].value||editors[0].innerText||'').trim(),atOnly:editors.length===1&&(editors[0].value||editors[0].innerText||'').trim()==='@'},atBoxes:[...root.querySelectorAll('.atBox-inner-container')].filter(visible).slice(0,1).map(e=>shape(e,9)),shareControlCount:share.length,shares:share.map(e=>shape(e,2)),popups:outer.map(e=>shape(e,6)),labelContexts:contexts.map(e=>shape(e,5)),composerIcons:[...root.querySelectorAll('.comment-input-container .oWdMk9B9 > span')].filter(visible).slice(0,4).map(e=>({paths:[...e.querySelectorAll('svg path')].map(p=>(p.getAttribute('d')||'').slice(0,5000))})),composers:[...root.querySelectorAll('.comment-input-container')].filter(visible).slice(0,1).map(e=>shape(e,7))};
 }
 if(input.phase==='point_share_open'){
  if(share.length!==1)return {ready:false,reason:'share_control_ambiguous'};
  const r=share[0].getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+Math.min(20,r.height/3)},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==share[0]&&!share[0].contains(hit))return {ready:false,reason:'share_control_occluded'};
  return {ready:true,point};
 }
 return {ready:false,reason:'native_operation_not_supported'};
}
