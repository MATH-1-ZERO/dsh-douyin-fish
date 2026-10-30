import {pageRestriction} from './page-restriction.mjs';
import {profilePage} from './scoped-ui.mjs';
function inspectOwnerDm(expected,restrictionCheck){
 const deny=reason=>({ready:false,reason});
 const restriction=restrictionCheck();
 if(restriction)return deny(restriction==='verification'?'manual_verification_required':'manual_login_required');
 if(location.href!==expected.profile)return {...deny('profile_changed'),route:new URL(location.href).pathname};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;};
 const leaf=[...document.querySelectorAll('span,p,div,h1,h2,h3')].filter(e=>!e.children.length&&visible(e));
 const guarded=['point_open','point_close','closed'].includes(expected.phase);
 const handleNodes=guarded?leaf.filter(e=>!e.closest('[contenteditable],textarea,input,.messageMessageListwrapper')):leaf;
 const handle=handleNodes.filter(e=>(e.innerText||'').trim().replace(/\s+/g,'').replace('：',':')==='抖音号:'+expected.ownerHandle);
 if(handle.length!==1)return deny('owner_handle_not_verified');
 if(guarded){
  if(document.visibilityState!=='visible')return deny('owner_dm_page_hidden');
  // Closing or reselecting a conversation must never discard user input.
  // Return only the refusal, never an input value or private message text.
  const fields=[...document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""],textarea,input')].filter(visible).filter(e=>e.tagName!=='INPUT'||!['hidden','button','submit','reset','checkbox','radio','range','color','image','file'].includes((e.getAttribute('type')||'text').toLowerCase()));
  if(fields.some(e=>String(e.value??e.innerText??'').replace(/[\u200B\uFEFF]/g,'').trim()))return deny('existing_input_preserved');
 }
 if(expected.phase==='closed'||expected.phase==='point_close'){
  const headers=[...document.querySelectorAll('.StackLayoutStackChatHeadertitle')].filter(visible);
  const editors=[...document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],textarea')].filter(visible);
  const lists=[...document.querySelectorAll('.messageMessageListwrapper')].filter(visible);
  if(expected.phase==='closed')return {ready:true,closed:headers.length===0&&editors.length===0&&lists.length===0,headerCount:headers.length,editorCount:editors.length,listCount:lists.length,privateMessagesRead:false};
  if(headers.length!==1||(headers[0].innerText||'').trim()!==expected.ownerName||editors.length!==1||!editors[0].matches('.messageEditorinputArea[contenteditable="true"]')||lists.length!==1)return deny('owner_dm_close_conversation_mismatch');
  const panels=[...document.querySelectorAll('.StackLayoutpagespageRoot')].filter(visible),panel=headers[0].closest('.StackLayoutpagespageRoot');
  if(!panels.includes(panel)||editors[0].closest('.StackLayoutpagespageRoot')!==panel||lists[0].closest('.StackLayoutpagespageRoot')!==panel)return deny('owner_dm_close_panel_unbound');
  // Douyin can keep the contact-list page beneath the conversation in the
  // same stack. Only accept that covered layer, never a second exposed panel.
  const stack=panel.closest('.StackLayoutStackLayoutV2wrapper');
  for(const other of panels.filter(p=>p!==panel)){
   const closes=[...other.querySelectorAll('svg.StackLayoutStackTitleBarcloseImPage')].filter(visible);
   if(!stack||other.closest('.StackLayoutStackLayoutV2wrapper')!==stack||closes.length!==1)return deny('owner_dm_close_panel_unbound');
   const r=closes[0].getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   if(!hit||!panel.contains(hit))return deny('owner_dm_close_panel_unbound');
  }
  const bars=[...panel.querySelectorAll('.StackLayoutStackTitleBartitleBar')].filter(visible);
  const controls=[...panel.querySelectorAll('svg.StackLayoutStackTitleBarcloseImPage')].filter(visible);
  if(bars.length!==1||!bars[0].contains(headers[0])||controls.length!==1||controls[0].closest('.StackLayoutStackTitleBartitleBar')!==bars[0]||controls[0].closest('.StackLayoutpagespageRoot')!==panel)return deny('owner_dm_close_control_ambiguous');
  const control=controls[0];
  for(let e=control;e;e=e.parentElement){
   if(e.disabled===true||e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true'||e.hasAttribute('inert')||getComputedStyle(e).pointerEvents==='none')return deny('owner_dm_close_control_disabled');
   if(e===panel)break;
  }
  const r=control.getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==control&&!control.contains(hit))return deny('owner_dm_close_control_occluded');
  return {ready:true,point,privateMessagesRead:false};
 }
 if(expected.phase==='point_open'&&[...document.querySelectorAll('.StackLayoutStackChatHeadertitle,[contenteditable="true"],[contenteditable="plaintext-only"],textarea,.messageMessageListwrapper')].some(visible))return deny('owner_dm_panel_reopened_before_open');
 const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
 if(expected.phase==='point_open'){
  if(document.visibilityState==='hidden')return deny('owner_dm_page_hidden');
  const open=buttons.filter(e=>(e.innerText||'').trim()==='私信');
  if(open.length!==1)return deny('owner_dm_button_ambiguous');
  if(open[0].disabled||open[0].getAttribute('aria-disabled')==='true'||open[0].classList.contains('semi-button-loading'))return deny('owner_dm_button_disabled');
  const r=open[0].getBoundingClientRect(),point={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(point.x,point.y);
  if(!hit||hit!==open[0]&&!open[0].contains(hit))return deny('owner_dm_button_occluded');
  return {ready:true,point};
 }
 const shape=e=>({tag:e.tagName,marker:e.getAttribute('data-e2e'),className:(e.getAttribute('class')||'').slice(0,150),role:e.getAttribute('role'),editable:e.getAttribute('contenteditable'),placeholder:e.getAttribute('placeholder')||e.getAttribute('data-placeholder'),attributes:[...(e.attributes||[])].map(a=>a.name).slice(0,20),...(!e.children.length&&/^(发送|表情|按Enter发送|按 Enter 发送)$/.test((e.innerText||'').trim())?{controlLabel:(e.innerText||'').trim()}:{})});
 const editors=[...document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],textarea')].filter(visible).slice(0,3);
 const headers=[...document.querySelectorAll('.StackLayoutStackChatHeadertitle')].filter(visible);
 const headerMatchesOwner=headers.length===1&&(headers[0].innerText||'').trim()===expected.ownerName;
 let count=0;
 const tree=(e,depth)=>{if(++count>100)return null;return {...shape(e),...(depth>0?{children:[...e.children].slice(0,8).map(c=>tree(c,depth-1)).filter(Boolean)}:{})};};
 const lists=headerMatchesOwner&&editors.length===1?[...document.querySelectorAll('.messageMessageListwrapper')].filter(visible):[];
 return {ready:true,pageVisible:document.visibilityState==='visible',ownerHandleVerified:true,privateMessagesRead:false,sendingSupported:false,
  headerMatchesOwner,headerCount:headers.length,messageStructure:lists.length===1?tree(lists[0],11):null,
  composerStructure:headerMatchesOwner&&editors.length===1&&editors[0].closest('[data-e2e="msg-input"]')?tree(editors[0].closest('[data-e2e="msg-input"]'),7):null,
  bubbleLayouts:lists.length===1?[...lists[0].querySelectorAll('.messageMessageBoxmessageBox')].filter(visible).slice(0,5).map(e=>({className:e.getAttribute('class'),justifyContent:getComputedStyle(e).justifyContent,flexDirection:getComputedStyle(e).flexDirection,box:e.getBoundingClientRect().toJSON?.()||null})):[],
  restrictionNotices:leaf.filter(e=>/^(网络异常|加载失败|请稍后重试|私信功能暂不可用|暂时无法发送私信|请先登录|对方暂时无法接收消息)[。！!]?$/u.test((e.innerText||'').trim())).slice(0,5).map(e=>(e.innerText||'').trim()),
  frameRoutes:[...document.querySelectorAll('iframe[src]')].filter(visible).slice(0,5).map(e=>{try{const u=new URL(e.getAttribute('src'),location.href);return {origin:u.origin,path:u.pathname.slice(0,120)};}catch{return {invalid:true};}}),
  controls:buttons.filter(e=>/^(私信|发送|发消息|聊天|关闭|取消|表情|消息)$/.test((e.innerText||'').trim())).slice(0,12).map(e=>({...shape(e),label:(e.innerText||'').trim()})),
  editors:editors.map(e=>{const ancestors=[];for(let a=e.parentElement,i=0;a&&i<5;i++,a=a.parentElement){if(['BODY','HTML'].includes(a.tagName))break;ancestors.push({...shape(a),children:[...a.children].slice(0,8).map(shape)});}return {...shape(e),ancestors};}),
  ownerTitleNodes:leaf.filter(e=>(e.innerText||'').trim()===expected.ownerName).slice(0,5).map(e=>({...shape(e),parent:e.parentElement?shape(e.parentElement):null})),
 };
}
export function ownerDmExpression(args){
 if(!args||!profilePage(args.profile)||!['inspect','point_open','point_close','closed'].includes(args.phase)||!/^[-A-Za-z0-9_.]{1,80}$/.test(args.ownerHandle)||typeof args.ownerName!=='string'||!args.ownerName||args.ownerName.length>60)throw Error('Invalid verified owner DM scope');
 return `(${inspectOwnerDm.toString()})(${JSON.stringify(args)},${pageRestriction.toString()})`;
}
