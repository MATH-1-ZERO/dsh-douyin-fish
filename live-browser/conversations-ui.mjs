import {pageRestriction} from './page-restriction.mjs';
// Only known Douyin image CDNs may share an avatar resource across hosts/crops.
// Other HTTPS images retain their exact origin and path.
export function conversationImageKey(source){
 try{const u=new URL(source);if(u.protocol!=='https:'||u.username||u.password)return null;
  const trusted=/^(?:[a-z0-9-]+\.)*(?:douyinpic\.com|byteimg\.com|pstatp\.com|douyincdn\.com)$/.test(u.hostname);
  const match=u.pathname.split('~')[0].match(/\/aweme-avatar\/([A-Za-z0-9_/-]+?)(?:\.(?:jpe?g|png|webp))?$/);
  return trusted&&match?'https://douyinpic.com/aweme-avatar/'+match[1]:u.origin+u.pathname;
 }catch{return null;}
}
function conversationUi(input,restrictionCheck,imageKey){
 const deny=reason=>({ready:false,reason}),restriction=restrictionCheck();if(restriction)return deny('manual_'+restriction+'_required');
 if(location.href!==input.page)return deny('conversation_page_changed');
 if(document.visibilityState!=='visible')return deny('owner_dm_page_hidden');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 const image=e=>imageKey(e?.getAttribute('src'));
 const accounts=[...document.querySelectorAll('a[href="//www.douyin.com/user/self"] img,a[href="https://www.douyin.com/user/self"] img')].filter(visible);
 if(accounts.length!==1||!image(accounts[0]))return deny('conversation_account_unverified');
 const account=image(accounts[0]);if(input.account&&input.account!==account)return deny('conversation_account_changed');
 const fields=[...document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],textarea,input[type="text"]')].filter(visible);
 if(fields.some(e=>String(e.value??e.innerText??'').replace(/[\u200B\uFEFF]/g,'').trim()))return deny('existing_input_preserved');
 const point=e=>{if(!e||!visible(e)||e.disabled||e.getAttribute('aria-disabled')==='true')return deny('conversation_control_unavailable');const r=e.getBoundingClientRect(),p={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(p.x,p.y);return hit&&(hit===e||e.contains(hit))?{ready:true,point:p}:deny('conversation_control_occluded');};
 const headers=[...document.querySelectorAll('.StackLayoutStackChatHeadertitle')].filter(visible);
 if(headers.length){
  if(headers.length!==1)return deny('conversation_header_ambiguous');
  const panel=headers[0].closest('.StackLayoutpagespageRoot');
  if(input.phase==='back'){const buttons=panel?[...panel.querySelectorAll('svg.StackLayoutStackTitleBarbackBtn')].filter(visible):[];return buttons.length===1?point(buttons[0]):deny('conversation_back_unavailable');}
  return {ready:true,conversationOpen:true,account};
 }
 const lists=[...document.querySelectorAll('.conversationConversationListwrapper')].filter(visible);
 if(!lists.length){
  if(input.phase==='open'){
   const nodes=[...document.querySelectorAll('[data-e2e="something-button"]')].filter(visible).filter(e=>(e.innerText||'').trim()==='消息');
   return nodes.length===1?point(nodes[0]):deny('conversation_entry_unavailable');
  }
  return {ready:true,listOpen:false,account};
 }
 if(lists.length!==1)return deny('conversation_list_ambiguous');
 if(input.phase==='close_list'){
  const panel=lists[0].closest('.StackLayoutpagespageRoot');
  const panels=[...document.querySelectorAll('.StackLayoutpagespageRoot')].filter(visible);
  const controls=panel?[...panel.querySelectorAll('svg.StackLayoutStackTitleBarcloseImPage')].filter(visible):[];
  return panels.length===1&&panels[0]===panel&&controls.length===1?point(controls[0]):deny('conversation_close_unbound');
 }
 const rows=[...lists[0].querySelectorAll('[data-e2e="conversation-item"]')].filter(visible);
 const items=rows.map(row=>{const names=row.querySelectorAll('.conversationConversationItemtitle'),avatars=row.querySelectorAll('.commonIMAvataravatarContainer img');
  if(names.length!==1||avatars.length!==1||row.querySelector('[class*="GroupAvatar"],[class*="groupAvatar"]'))return null;
  const name=(names[0].innerText||'').trim(),avatar=image(avatars[0]);if(!name||name.length>60||!avatar)return null;return {name,avatar};});
 if(input.phase==='select'){
  const found=rows.filter((r,i)=>items[i]?.name===input.name&&items[i]?.avatar===input.avatar);return found.length===1?point(found[0]):deny('conversation_selection_changed');
 }
 return {ready:true,listOpen:true,account,items:items.filter(Boolean).slice(0,50),loadedOnly:true,skipped:items.filter(x=>!x).length};
}
export function conversationsExpression(input){
 if(!input||!['list','open','back','select','close_list'].includes(input.phase)||typeof input.page!=='string'||new URL(input.page).origin!=='https://www.douyin.com')throw Error('Invalid conversation operation');
 return `(${conversationUi.toString()})(${JSON.stringify(input)},${pageRestriction.toString()},${conversationImageKey.toString()})`;
}

// These are UI identities, not invented platform user IDs. A selected row is
// bound by current account, unique nickname + avatar, and a one-to-one header.
export function conversationIdentityCheck(input,imageKey){
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 const image=e=>imageKey(e?.getAttribute('src'));
 const a=[...document.querySelectorAll('a[href="//www.douyin.com/user/self"] img,a[href="https://www.douyin.com/user/self"] img')].filter(visible);
 const h=[...document.querySelectorAll('.StackLayoutStackChatHeaderuser')].filter(visible);
 const headers=[...document.querySelectorAll('.StackLayoutStackChatHeadertitle')].filter(visible);
 if(a.length!==1||image(a[0])!==input.account||h.length!==1||headers.length!==1||(headers[0].innerText||'').trim()!==input.name||!h[0].contains(headers[0]))return false;
 const avatars=h[0].querySelectorAll('[data-apm-action="个人页卡片"] img');
 return avatars.length===1&&image(avatars[0])===input.avatar&&document.visibilityState==='visible';
}
export const currentConversationExpression=`(()=>{
 const image=e=>(${conversationImageKey.toString()})(e?.getAttribute('src'));
 const a=[...document.querySelectorAll('a[href="//www.douyin.com/user/self"] img,a[href="https://www.douyin.com/user/self"] img')];
 const h=[...document.querySelectorAll('.StackLayoutStackChatHeaderuser')];
 if(a.length!==1||h.length!==1)return null;
 const name=h[0].querySelector('.StackLayoutStackChatHeadertitle')?.innerText?.trim(),avatar=image(h[0].querySelector('[data-apm-action="个人页卡片"] img')),account=image(a[0]);
 return name&&avatar&&account?{name,avatar,account}:null;
})()`;
