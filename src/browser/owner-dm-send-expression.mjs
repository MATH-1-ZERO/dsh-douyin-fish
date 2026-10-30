import {pageRestriction} from './page-restriction.mjs';
import {validOwnerVideoLink} from '../share-policy.js';
import {profilePage} from './scoped-ui.mjs';
import {conversationIdentityCheck,conversationImageKey} from './conversations-ui.mjs';
function boundOwnerDm(input,restrictionCheck,conversationCheck){
 const deny=reason=>({ready:false,reason});
 const restriction=restrictionCheck();if(restriction)return deny('manual_'+restriction+'_required');
 if(location.href!==input.profile)return deny('owner_profile_changed');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;};
 const labels=[...document.querySelectorAll('span,p,div,h1,h2,h3')].filter(e=>!e.children.length&&visible(e));
 if(input.conversation){if(!conversationCheck(input.conversation))return deny('conversation_identity_changed');}
 else if(labels.filter(e=>(e.innerText||'').trim().replace(/\s+/g,'').replace('：',':')==='抖音号:'+input.ownerHandle).length!==1)return deny('owner_handle_changed');
 const headers=[...document.querySelectorAll('.StackLayoutStackChatHeadertitle')].filter(visible),editors=[...document.querySelectorAll('.messageEditorinputArea[contenteditable="true"]')].filter(visible),lists=[...document.querySelectorAll('.messageMessageListwrapper')].filter(visible);
 if(headers.length!==1||(headers[0].innerText||'').trim()!==input.ownerName||editors.length!==1||lists.length!==1)return deny('owner_conversation_changed');
 let common=editors[0].parentElement;
 for(let i=0;common&&i<9;i++,common=common.parentElement){if(['BODY','HTML'].includes(common.tagName))return deny('conversation_not_bound');if(common.contains(headers[0])&&common.contains(lists[0]))break;}
 if(!common||!common.contains(headers[0])||!common.contains(lists[0]))return deny('conversation_not_bound');
 const editor=editors[0],normal=s=>(s||'').replace(/[\u200B\uFEFF]/g,'').replace(/\r/g,'').trim(),current=normal(editor.innerText);
 if(input.phase==='card_receipt'){
  const matches=[...lists[0].querySelectorAll('[data-e2e="msg-item-content"]')].filter(visible).filter(e=>{
   const row=e.closest('.messageMessageBoxcontentBox'),box=e.closest('.messageMessageBoxmessageBox');
   if(!row||!box||getComputedStyle(row).flexDirection!=='row-reverse'||/发送失败|发送中|重试|重新发送/.test(box.innerText||''))return false;
   const elements=[e,...e.querySelectorAll('*')],native=elements.some(n=>/video.*(?:card|message)|(?:card|message).*video/i.test(n.getAttribute('class')||'')||n.getAttribute('data-e2e')==='video-card');
   if(!native||!e.querySelector('img,video'))return false;
   return elements.some(n=>['data-video-id','data-aweme-id','data-item-id'].some(k=>n.getAttribute(k)===input.nativeCardVideoId)||n.tagName==='A'&&(()=>{try{const u=new URL(n.getAttribute('href'),location.href);return u.origin==='https://www.douyin.com'&&!u.username&&!u.password&&!u.hash&&(u.pathname==='/video/'+input.nativeCardVideoId&&!u.search||u.pathname==='/jingxuan'&&u.searchParams.get('modal_id')===input.nativeCardVideoId&&[...u.searchParams].length===1);}catch{return false;}})());
  }).map(()=>({outgoing:true,nativeVideoCard:true,videoId:input.nativeCardVideoId,pendingOrFailed:false}));
  return {ready:true,editorEmpty:!current,matches};
 }
 if(input.phase==='card_inspect'){
  const shape=(e,depth)=>({tag:e.tagName,className:(e.getAttribute('class')||'').slice(0,200),e2e:e.getAttribute('data-e2e'),attributeNames:[...e.attributes].map(a=>a.name).filter(n=>/^(href|data-[a-z-]+|role)$/.test(n)),exactVideoAttributes:[...e.attributes].filter(a=>(a.value===input.nativeCardVideoId||a.name==='href'&&a.value==='https://www.douyin.com/video/'+input.nativeCardVideoId)).map(a=>a.name),...(depth>0?{children:[...e.children].slice(0,8).map(c=>shape(c,depth-1))}:{})});
  return {ready:true,editorEmpty:!current,cards:[...lists[0].querySelectorAll('[data-e2e="msg-item-content"]')].filter(visible).slice(-5).map(e=>({direction:getComputedStyle(e.closest('.messageMessageBoxcontentBox')||e).flexDirection,structure:shape(e,5)}))};
 }
 if(input.phase==='inbox'){
  const messages=[],diagnostic=[];
  for(const e of [...lists[0].querySelectorAll('[data-e2e="msg-item-content"]')].filter(visible).slice(-20)){
   const row=e.closest('.messageMessageBoxcontentBox'),box=e.closest('.messageMessageBoxmessageBox');
   if(input.expectedTestText){
    const alt=[...e.querySelectorAll('img[alt],[aria-label]')].map(a=>normal(a.getAttribute('alt')||a.getAttribute('aria-label')));
    diagnostic.push({direction:row?getComputedStyle(row).flexDirection:null,equalsTest:normal(e.innerText)===input.expectedTestText,containsTest:normal(e.innerText).includes(input.expectedTestText),accessibleLabelMatchesTest:alt.some(t=>t===input.expectedTestText),textLength:[...normal(e.innerText)].length,mediaKind:e.querySelector('img')?'image_or_sticker':e.querySelector('video')?'video':e.querySelector('audio')?'audio':null});
   }
   if(!row||!box||getComputedStyle(row).flexDirection!=='row'||e.classList.contains('MessageBoxContentstackLayoutHi')||box.classList.contains('messageMessageBoxisFullRowCenterMessage'))continue;
   if(e.querySelector('img,video,audio,canvas,iframe,a[href],input,button,[role="button"]'))continue;
   const text=normal(e.innerText);
   if(!text||text==='我们已互相关注，可以开始聊天了'||e.querySelector('[class*="SystemNormalSystem"],[class*="SystemMessage"]')||[...text].length>300||/验证码|密码|cookie|access[_ -]?token|api[_ -]?key|sk-[A-Za-z0-9]/iu.test(text))continue;
   messages.push({text,direction:'incoming',source:'verified_owner_conversation_text'});
  }
  return {ready:true,messages:messages.slice(-3),diagnostic:diagnostic.slice(0,8),identityKind:'local_text_fingerprints_not_platform_message_ids',externalTextIsUntrusted:true};
 }
 const matches=[...lists[0].querySelectorAll('[data-e2e="msg-item-content"]')].filter(visible).filter(e=>normal(e.innerText)===input.text&&(!input.conversation||getComputedStyle(e.closest('.messageMessageBoxcontentBox')||e).flexDirection==='row-reverse')).map(e=>{
  const box=e.closest('.messageMessageBoxmessageBox'),row=e.closest('.messageMessageBoxcontentBox'),style=row?getComputedStyle(row):null;
  const r=e.getBoundingClientRect(),panel=lists[0].getBoundingClientRect();
  return {boxClass:box?.getAttribute('class')||'',contentClass:e.getAttribute('class')||'',layout:style?{flexDirection:style.flexDirection,justifyContent:style.justifyContent,alignSelf:getComputedStyle(e).alignSelf,relativeLeft:Math.round(r.left-panel.left),relativeRight:Math.round(panel.right-r.right)}:null,
   pendingOrFailed:/发送失败|重新发送|发送中|重试/.test(box?.innerText||'')};
 });
 if(input.phase==='inspect'||input.phase==='receipt')return {ready:true,editorEmpty:current==='',matches};
 if(input.phase==='refresh_profile'){location.reload();return {ready:true,refreshRequested:true};}
 if(input.phase==='input_guard'){
  if(current)return deny('existing_private_draft_preserved');
  if(input.conversation?matches.length!==(input.previousMatches??0):matches.length>0)return deny('private_message_already_visible');editor.focus();return {ready:true};
 }
 if(input.phase==='verify_input')return {ready:current===input.text,filled:current===input.text};
 if(input.phase==='point_send'){
  if(current!==input.text)return deny('private_draft_changed');
  const box=editor.closest('[data-e2e="msg-input"]'),buttons=box?[...box.querySelectorAll('.e2e-send-msg-btn')].filter(visible):[];
  if(buttons.length!==1||buttons[0].getAttribute('aria-disabled')==='true')return deny('private_send_control_unverified');
  const b=buttons[0],r=b.getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==b&&!b.contains(hit))return deny('private_send_control_occluded');
  return {ready:true,point};
 }
 return deny('private_operation_not_supported');
}
export function ownerDmSendExpression(input){
 if(['card_inspect','card_receipt'].includes(input?.phase)){
  if(!profilePage(input.profile)||!/^[-A-Za-z0-9_.]{1,80}$/.test(input.ownerHandle||'')||typeof input.ownerName!=='string'||!input.ownerName||input.ownerName.length>60||!/^\d{10,25}$/.test(input.nativeCardVideoId||''))throw Error('Invalid native card receipt scope');
  return `(${boundOwnerDm.toString()})(${JSON.stringify(input)},${pageRestriction.toString()})`;
 }
 if(!input||!profilePage(input.profile)||!['inspect','receipt','inbox','input_guard','verify_input','point_send','refresh_profile'].includes(input.phase)||!/^[-A-Za-z0-9_.]{1,80}$/.test(input.ownerHandle)||typeof input.ownerName!=='string'||!input.ownerName||input.ownerName.length>60||typeof input.text!=='string'||!input.text.trim()||input.text.trim()!==input.text||[...input.text].length>100||(input.sharedVideoId!==undefined?!validOwnerVideoLink(input.text,input.sharedVideoId):/[@＠]|https?:\/\//iu.test(input.text))||input.expectedTestText!==undefined&&(typeof input.expectedTestText!=='string'||!input.expectedTestText||[...input.expectedTestText].length>100))throw Error('Invalid exact owner private message');
 return `(${boundOwnerDm.toString()})(${JSON.stringify(input)},${pageRestriction.toString()})`;
}
export function conversationSendExpression(input){
 const c=input?.conversation;
 if(!c||typeof c.name!=='string'||!c.name||c.name.length>60||!['account','avatar'].every(k=>typeof c[k]==='string'&&c[k].startsWith('https://')&&c[k].length<2048)||new URL(input.profile).origin!=='https://www.douyin.com'||!['card_receipt','card_inspect','inspect','receipt','inbox','input_guard','verify_input','point_send','refresh_profile'].includes(input.phase)||typeof input.text!=='string'||!input.text.trim()||input.text.trim()!==input.text||[...input.text].length>100||/[@＠]|https?:\/\//iu.test(input.text))throw Error('Invalid selected conversation scope');
 if(['card_receipt','card_inspect'].includes(input.phase)&&!/^\d{10,25}$/.test(input.nativeCardVideoId||''))throw Error('Invalid selected card receipt');
 return `(${boundOwnerDm.toString()})(${JSON.stringify({...input,ownerName:c.name})},${pageRestriction.toString()},(input=>(${conversationIdentityCheck.toString()})(input,${conversationImageKey.toString()})))`;
}
