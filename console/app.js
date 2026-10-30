const $=selector=>document.querySelector(selector);
const token=new URLSearchParams(location.hash.slice(1)).get('access')||sessionStorage.getItem('fish-console-access');
if(token){sessionStorage.setItem('fish-console-access',token);history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).has('access'))location.reload();});
let view,page='overview',busy=false,guestPrepared=false,refreshInFlight=null,refreshForced=false,actionCount=0;
const labels={overview:'概览',persona:'人格档案',memory:'记忆',videos:'刷视频与互动',replies:'私信与运行',abilities:'能力与成长',timeline:'时间线',billing:'账单与余额',runtime:'运行状态'};
const kindLabels={dm:'私信',comment:'评论',like:'点赞',reply:'评论回复',mention:'提及',note:'主人笔记',video:'视频观察',message:'消息记录'};
const statusLabels={confirmed:'页面回执已确认',uncertain:'送达待核对',not_applied:'未执行',reserved:'处理中'};
const date=(time,full=false)=>time?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(full?{year:'numeric'}:{})}).format(time):'暂无记录';
function el(tag,cls,children=[]){const node=document.createElement(tag);if(cls)node.className=cls;for(const child of [children].flat(Infinity)){if(child===null||child===undefined)continue;node.append(child instanceof Node?child:document.createTextNode(String(child)));}return node;}
const pill=(text,tone='')=>el('span','pill '+tone,text);
const empty=(title,subtitle='')=>el('div','empty',[el('span','empty-icon','✧'),el('p','',title),el('small','',subtitle)]);
const line=(label,value)=>el('div','line-item',[el('span','',label),el('span','',value)]);
function card(title,children,subtitle){return el('section','card',[el('div','card-header',[el('h2','heading-dot',title),subtitle?el('small','',subtitle):null]),children]);}
function button(label,style,handler,disabled=false){const b=el('button','button '+style,label);b.type='button';b.disabled=disabled;b.addEventListener('click',handler);return b;}
function intro(title,subtitle,badge){return el('div','page-intro',[el('div','',[el('span','eyebrow','FISH / '+page.toUpperCase()),el('h1','',title),el('p','',subtitle)]),badge?pill(badge):null]);}
function notify(message){$('#notice').hidden=!message;$('#notice').textContent=message||'';}
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+(token||''),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});const result=await response.json();if(!response.ok)throw Error(result.error||'连接失败');return result;}
const reasons={dedicated_browser_binding_required:'专用抖音浏览器尚未连接，请先在 DSH 中核验浏览器会话。',owner_reply_result_unresolved:'有一条回复的送达尚未核实，请先核对该条记录。',interaction_result_unresolved:'有一次互动尚待核对，已保持暂停。',existing_owner_reply_runtime_active:'已有任务正在启动或测试，请稍后操作。',verified_owner_required:'请先核验主人身份。',agent_bridge_probe_failed:'模型连接检查未通过，请查看 DSH 的模型状态。',owner_dm_disabled_by_policy:'当前设置未开启主人私信。',owner_replies_paused:'主人回复已暂停。'};
async function action(name,extra={}){
 if(busy&&name!=='pause')return;busy=++actionCount>0;updateBillingButton();
 try{const result=await api('/api/action',{action:name,...extra});if(result.allowed===false)throw Error(friendlyReason(result.reason));notify(({open_browser:'专用浏览器已连接，可以读取会话或启动回复。',check_browser:result.browser?.bindingVerified?'专用浏览器连接正常。':'尚未连接，点击“打开 / 重新连接”。',scan_conversations:'已读取 '+result.count+' 个当前加载的会话。',save_replies:'回复设置已保存，任务保持暂停。',save_video:'刷视频设置已保存，任务保持暂停。',save_persona:'人格设置已保存，任务保持暂停。',start_plugin:extra.mode==='watch_only'?'只看视频任务已启动。':extra.mode==='videos'?'已按保存的喜好与互动设置启动刷视频。':'自动回复已启动，正在建立消息基线。'})[name]||(name==='refresh_billing'?(result.billing?.status==='ready'?'账号余额已核对。':billingStatus(result.billing)):name==='pause'?'已暂停自动任务。':name==='remember_note'?(result.duplicate?'这条笔记已经记住了。':'记住了，已保存到本机。'):'主人回复已启动，当前消息建立基线后将等待新消息。'));await refresh(true);return result;}
 catch(error){notify(error.message);}finally{busy=--actionCount>0;updateBillingButton();}
}
function controls(){return controlButtons();}
function runtimeText(){if(view.runtime.consoleOperationActive)return '正在处理控制台操作';if(view.runtime.conversationRepliesActive)return '正在自动回复新私信';if(view.runtime.conversationRepliesEnabled)return '任务需要重新启动';if(view.runtime.ownerRepliesActive)return '正守着老大的新消息';if(view.runtime.autonomyActive)return '正在运行自主任务';if(view.runtime.ownerRepliesEnabled||view.runtime.autonomyEnabled)return '任务需要从宿主恢复';return '小鱼正在待命';}
function stats(){const guest=view.role==='guest';return el('div','stats',[
 stat('记忆留下的足迹',view.counts.memory,'条','来自本机保存的观察与笔记','✧'),
 stat('主人收件确认',view.counts.ownerReceipts,'次','由主人明确确认的实际收件','↗'),
 stat(guest?'已确认的页面回执':'今日模型预约',guest?view.counts.confirmed:view.usage.today,'次',guest?'不同互动的本地确认记录':'预约次数，不等同实际账单','⌁'),
 stat('开发阶段作息',view.runtime.scheduleEnabled?'开启':'关闭','','按当前保存的设置运行','◷'),
 ]);}
function stat(label,value,unit,note,icon){return el('section','stat',[el('div','stat-top',[el('span','',label),el('span','stat-icon',icon)]),el('strong','',[value,el('span','stat-unit',unit)]),el('p','',note)]);}
function chart(){const days=view.usage.days,max=Math.max(1,...days.map(d=>d.requests));return el('div','',[
 el('div','chart',days.map(day=>{const bar=el('div','chart-bar');bar.style.setProperty('--bar',Math.max(3,day.requests/max*104)+'px');bar.title=day.day+' · '+day.requests+' 次模型预约';return el('div','chart-col',[el('span','chart-value',day.requests),bar,el('span','chart-day',day.day.slice(5).replace('-','/'))]);})),
 el('p','chart-note',[el('span','','● 模型请求预约'),el('span','','仅统计仍保留的本机记录')]),
 ]);}
function overview(){
 const hero=el('section','hero',[el('div','hero-text',[el('span','eyebrow','A LITTLE WARMTH, WITH YOU'),el('h1','','老大，今天也有小鱼陪你。'),el('p','','记住一点日常，接住每句问候。这里有小鱼的近况，也有一起留下的小小足迹。'),el('div','hero-tags',[pill(runtimeText(),'mint'),pill(view.runtime.scheduleEnabled?'作息已开启':'开发作息已关闭'),pill(view.role==='guest'?'访客 · 只读':'主人视角')])]),el('span','hero-ornament','慢慢来，也很可爱。')]);hero.append($('#whale').content.cloneNode(true));
 const sections=[hero,stats()];
 if(view.role==='guest'){sections.push(card('她正在学习的能力',features()));return sections;}
 sections.push(el('div','grid',[
 card('与老大的连接',[el('p','status-lead',runtimeText()),el('p','status-copy',view.runtime.canControl?'按已保存的主人、联系人和默认回复设置处理新私信。':'此页面正在查看本机记录；从 DSH 打开后可控制回复。'),line('主人身份',view.owner.configured?pill('已核验','mint'):pill('待核验','gold')),line('最近收件确认',date(view.replies.latestOwnerReceiptAt)),line('作息与场次休息',view.runtime.scheduleEnabled?'已开启':'已关闭'),controls()]),
 card('近 7 天的小小足迹',chart(),'模型预约 / 次'),
 ]));
 sections.push(el('div','grid section-space',[
 card('最近记住的事',view.memory.recent.length?view.memory.recent.slice(0,2).map(memoryEntry):empty('这里还很安静','可以在「记忆」里留下一条主人笔记。')),
 card('最近的行动',view.timeline.length?timeline(view.timeline.slice(0,3)):empty('还没有行动记录','每一次实际互动都会留在时间线里。')),
 ]));return sections;
}
function locked(){return el('section','card locked',[el('span','eyebrow','PRIVATE SPACE'),el('h2','','这部分，只留给老大。'),el('p','','访客预览不提供人格详情、记忆正文、时间线或操作权限。')]);}
function memoryEntry(entry){return el('article','memory-entry',[el('div','entry-meta',[pill(kindLabels[entry.kind]||'记录'),el('time','',date(entry.at))]),el('p','',entry.text)]);}
function memoryPage(){const input=el('textarea');input.id='note';input.maxLength=160;input.placeholder='例如：老大喜欢简短自然的回复，不要总拿米饭开玩笑。';const count=el('span','muted small','0 / 160');input.addEventListener('input',()=>count.textContent=[...input.value].length+' / 160');const label=el('label','','让小鱼记住一件事');label.htmlFor='note';const save=button('记住这件事','primary',()=>{},!view.runtime.canControl);save.type='submit';const form=el('form','notes-form',[label,input,el('div','actions',[count,save])]);form.addEventListener('submit',async event=>{event.preventDefault();if(!input.value.trim())return;const text=input.value.trim();await action('remember_note',{text});});return [intro('记住的，都是相遇。','这里只展示实际保存的内容；私信正文遵循原有保留设置。',view.memory.total+' 条观察'),el('div','grid',[
 card('近期记忆',view.memory.recent.length?view.memory.recent.map(memoryEntry):empty('还没有记忆笔记','第一条，可以从老大的一个小偏好开始。')),
 el('div','',[card('留下一点记忆',form),el('div','section-space',card('记忆小账本',[line('累计观察',view.memory.total+' 条'),line('近期保留',view.memory.recent.length+' 条'),line('较早记录',Object.values(view.memory.compacted).reduce((a,b)=>a+b,0)+' 条，已折叠为计数'),el('p','muted small section-space','笔记会进入插件已有的记忆流程。不读取其他联系人的消息，也不会把笔记当成新的操作权限。')]))]),
 ])];}
const formEdits=new Map();
function formState(key,initial){if(!formEdits.has(key)||!formEdits.get(key).dirty)formEdits.set(key,{key,value:structuredClone(initial),dirty:false});return formEdits.get(key);}
function field(state,key,label,{type='text',min,max,rows=3,help='',options}={}){
 const id='setting-'+key;let input;
 if(type==='textarea'){input=el('textarea');input.rows=rows;}
 else if(type==='select'){input=el('select','');for(const [value,text]of options) {const option=el('option','',text);option.value=value;input.append(option);}}
 else {input=el('input');input.type=type;}
 input.id=id;input.name=key;input.value=state.value[key]??'';
 if(type==='checkbox')input.checked=state.value[key]===true;
 if(min!==undefined)input.min=min;if(max!==undefined){if(type==='number')input.max=max;else input.maxLength=max;}
 input.addEventListener(type==='checkbox'||type==='select'?'change':'input',()=>{state.value[key]=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value;state.dirty=true;const mark=$('[data-dirty="'+state.key+'"]');if(mark)mark.textContent='有修改待保存';});
 const caption=el('label','',label);caption.htmlFor=id;
 return el('div','form-field '+(type==='checkbox'?'switch-field':''),type==='checkbox'?[input,el('div','',[caption,help?el('small','muted',help):null])]:[caption,input,help?el('small','muted',help):null]);
}
function operationButton(label,name,extra={},style='secondary'){return button(label,style,()=>action(name,extra),!view.runtime.canControl||busy||view.runtime.consoleOperationActive);}
function controlButtons(){return el('div','actions',[
 operationButton('启动私信自动回复','start_plugin',{mode:'replies'},'primary'),
 button('暂停所有任务','secondary',()=>action('pause'),!view.runtime.canControl),
 ]);}
function browserCard(){const b=view.browser??{};return card('连接抖音',[el('div','connection-state',[pill(b.bindingVerified?'专用浏览器已连接':b.liveChecked?'需要重新连接':'等待连接检查',b.bindingVerified?'mint':'gold')]),el('p','status-copy','打开插件专用 Edge，使用其中已登录的抖音账号。重新连接可修复浏览器关闭后留下的旧绑定。'),el('div','actions',[operationButton('打开 / 重新连接','open_browser',{},'primary'),operationButton('检查连接','check_browser')]),b.reason?el('p','muted small section-space',friendlyReason(b.reason)):null]);}
function friendlyReason(reason){if(/^Single scroll/.test(reason||''))return '下滑后未确认切换到新视频，已停止本轮；重新连接后再启动。';const known={
 'Retained browser listener changed':'专用浏览器已关闭或端口发生变化，点击“打开 / 重新连接”即可重新绑定。',
 'Retained browser instance changed':'浏览器实例已更换，请重新连接。',
 'Retained tab changed, private, or ambiguous':'专用浏览器中请保留一个抖音标签，然后重新连接。',
 baseline_saved:'已跳过启动前的消息，等待新私信。',no_new_message:'本轮没有新私信，继续等待。',starting:'正在建立消息基线。',confirmed:'本地页面已确认发送。',
 replies_paused:'自动回复已暂停。',owner_requested_stop:'主人要求停止，自动回复已暂停。',
 console_operation_in_progress:'上一项操作仍在进行，可随时点击暂停。',console_operation_cancelled:'操作已取消，任务保持暂停。',
 read_conversations_first:'请先点击“读取抖音会话”，再选择回复联系人。',conversation_selection_expired:'联系人列表已更新，请重新勾选后保存。',
 conversation_selection_changed:'会话已移位或信息改变，请重新读取会话列表。',conversation_identity_changed:'当前会话身份不匹配，已停止；请重新读取会话。',conversation_account_changed:'抖音登录账号发生变化，请重新读取会话。',
 no_reply_recipient_selected:'请至少开启主人回复或选择一位联系人。',invalid_reply_settings:'请检查回复设置：间隔 15–3600 秒，长度 10–100 字，默认回复须在长度内。',invalid_generated_reply:'模型回复超出当前设置，已停止本轮。',
 existing_input_preserved:'抖音页面中有未发送输入，请先处理该输入再继续。',manual_login_required:'请在专用 Edge 中登录抖音，完成后点击重新连接。',manual_verification_required:'抖音页面显示验证，请在专用 Edge 完成后重新连接。',
 dm_contact_cooldown:'当前联系人的发送间隔尚未到，稍后继续检查。',interaction_cooldown:'当前发送间隔尚未到，稍后继续检查。',
 };
 return known[reason]||reasons[reason]||reason||'暂无运行记录。';}
function repliesPage(){
 const state=formState('replies',view.replySettings),p=state.value,items=view.conversations.items,run=view.conversationReplies;
 const recipients=el('div','contact-list',items.length?items.map(c=>{
  if(c.isOwner)return el('div','contact-option',[el('span','contact-avatar',c.name.slice(0,1)),el('div','',[el('strong','',c.name),el('small','muted','已核验主人 · 使用主人回复开关')]),pill('主人','mint')]);
  const box=el('input');box.type='checkbox';box.checked=p.selected.includes(c.id);box.setAttribute('aria-label','自动回复 '+c.name);box.addEventListener('change',()=>{p.selected=box.checked?[...p.selected,c.id]:p.selected.filter(x=>x!==c.id);state.dirty=true;});
  return el('label','contact-option',[box,el('span','contact-avatar',c.name.slice(0,1)),el('div','',[el('strong','',c.name),el('small','muted','单聊会话 · 勾选后使用 AI 回复')])]);
 }):[empty('还没有读取会话','连接专用浏览器后，点击上方读取按钮。')]);
 const save=button('保存回复设置','primary',async()=>{const result=await action('save_replies',{changes:state.value});if(result?.allowed){formEdits.delete('replies');render();}},!view.runtime.canControl||busy);save.type='submit';
 const mark=el('span','muted small',state.dirty?'有修改待保存':'设置已保存');mark.dataset.dirty='replies';
 const form=el('form','settings-form',[el('div','grid',[
 card('主人与指定联系人',[
 field(state,'ownerEnabled','自动回复主人',{type:'checkbox',help:'使用已核验的主人身份，回复新收到的文字私信。'}),
 el('div','actions section-space',[operationButton('读取抖音会话','scan_conversations')]),el('p','muted small','读取后从下方勾选。显示抖音当前已加载的会话；群聊、身份不明确的对象不发送。读取会暂停任务。'),recipients,
 el('small','muted','最近读取：'+date(view.conversations.at)),
 ]),
 card('回复方式',[
 el('div','form-grid',[field(state,'pollSeconds','新消息检查间隔（秒）',{type:'number',min:15,max:3600}),field(state,'maxCharacters','单条回复最多字数',{type:'number',min:10,max:100})]),
 field(state,'replyStyle','额外回复风格',{type:'textarea',max:1000,help:'例如：轻松简短、少用表情，问到余额时不编造数字。'}),
 field(state,'defaultEnabled','回复其他已读取会话',{type:'checkbox',help:'开启后，对未勾选的已读取单聊使用下方固定内容；主人单独由左侧开关控制。'}),
 field(state,'defaultText','其他会话的默认回复',{type:'textarea',max:100,help:'只回复启动后的新文字消息。未读取的联系人不会自动加入。'}),
 ]),
 ]),el('div','save-bar',[el('div','',[el('strong','','按你喜欢的方式回复'),el('p','muted small','保存会暂停运行；点击启动后应用已保存设置。旧消息不补发，送达不明不会重发。')]),mark,save])]);
 form.addEventListener('submit',e=>e.preventDefault());
 return [intro('消息交给小鱼，规则由你来定。','连接、选人、设置、启动，都在这里完成。'),el('div','grid',[
 browserCard(),card('运行控制',[el('p','status-lead',runtimeText()),el('p','status-copy','启动后真实读取并发送回复。首次读取建立基线，之后处理新消息。'),controlButtons(),el('div','actions section-space',[operationButton('启动只看视频','start_plugin',{mode:'watch_only'})]),el('p','muted small','只看视频与私信回复分别运行，切换会暂停当前任务。作息限制保持关闭。')]),
 ]),el('div','section-space',form),el('div','grid section-space',[
 card('本轮回复进度',[line('运行状态',runtimeText()),line('检查间隔',view.replySettings.pollSeconds+' 秒 / 轮'),line('已建立基线的会话',run.baselineCount+' 个'),line('当前处理',run.inFlight?'处理中':'等待新消息'),line('作息限制',view.runtime.scheduleEnabled?'已开启':'开发阶段已关闭')]),
 card('真实回复记录',[line('本模块处理事件',run.eventCount+' 条'),line('本模块页面确认',run.confirmedCount+' 条'),line('此前主人页面确认',view.replies.confirmedCount+' 条'),line('待核对互动',view.counts.unresolved+' 条'),el('p','muted small section-space',date(run.lastOutcome?.at||view.replies.lastOutcome?.at)),el('p','persona-text',friendlyReason(run.lastOutcome?.reason||view.replies.lastOutcome?.reason))]),
 ])];
}
function persona(){
 const state=formState('persona',{name:view.name,ownerAddress:view.owner.address,personaText:view.persona.text,voice:view.persona.voice,likedTags:view.persona.likedTags.join('，'),blockedTags:view.persona.blockedTags.join('，')});
 const save=button('保存人格设置','primary',async()=>{const changes={...state.value};for(const k of ['likedTags','blockedTags'])changes[k]=changes[k].split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);const result=await action('save_persona',{changes});if(result?.allowed){formEdits.delete('persona');render();}},!view.runtime.canControl||busy);save.type='submit';
 const mark=el('small','muted',state.dirty?'有修改待保存':'设置已保存');mark.dataset.dirty='persona';
 const form=el('form','settings-form',[el('div','grid',[
 card('名字与人格',[field(state,'name','小鱼的名字',{max:60}),field(state,'ownerAddress','对主人的称呼',{max:16}),field(state,'personaText','人格设定',{type:'textarea',max:8000,rows:12})]),
 card('表达与偏好',[field(state,'voice','实际生成回复时使用的语气',{type:'textarea',max:300,rows:7}),field(state,'likedTags','喜欢的话题',{help:'多个话题用逗号分隔。'}),field(state,'blockedTags','避开的话题',{help:'多个话题用逗号分隔。'}),el('p','muted small','人格内容决定表达风格；回复对象与自动发送开关在「私信与运行」中设置。')]),
 ]),el('div','save-bar',[el('p','muted small','保存后暂停自动任务，下一次启动使用新设置。'),mark,save])]);form.addEventListener('submit',e=>e.preventDefault());
 return [intro('小鱼的模样，你来定义。','名字、称呼、人设和说话方式均可直接修改。'),form];
}

function videosPage(){
 const v=view.videoSettings,state=formState('videos',{likedTags:v.likedTags.join('，'),blockedTags:v.blockedTags.join('，'),shareEnabled:v.shareEnabled,commentEnabled:v.commentEnabled,shareRecipient:v.shareRecipient,commentStyle:v.commentStyle,cycleIntervalSeconds:v.cycleIntervalSeconds,dwellMinSeconds:v.dwellMinSeconds,dwellMaxSeconds:v.dwellMaxSeconds});
 const options=[['owner','已核验主人 · '+view.owner.address],...view.conversations.items.filter(c=>!c.isOwner).map(c=>[c.id,c.name])];
 if(!options.some(([id])=>id===state.value.shareRecipient))options.push([state.value.shareRecipient,'原联系人不在当前列表，请重新选择']);
 const save=button('保存刷视频设置','primary',async()=>{const changes={...state.value};for(const k of ['likedTags','blockedTags'])changes[k]=changes[k].split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);const result=await action('save_video',{changes});if(result?.allowed){formEdits.delete('videos');if(!formEdits.get('persona')?.dirty)formEdits.delete('persona');render();}},!view.runtime.canControl||busy);save.type='submit';
 const mark=el('small','muted',state.dirty?'有修改待保存':'设置已保存');mark.dataset.dirty='videos';
 const form=el('form','settings-form',[el('div','grid',[
 card('想看什么，由你决定',[
 field(state,'likedTags','感兴趣的主题 / 关键词',{type:'textarea',max:2000,help:'例如：猫咪，美食，旅行。用逗号或换行分隔；开启分享或评论时至少填一个。'}),
 field(state,'blockedTags','避开的话题',{type:'textarea',max:2000,help:'命中避开词就跳过，优先于喜欢的主题。与人格档案中的偏好同步。'}),
 el('p','muted small','依据实际读到的标题、视频说明与公开评论筛选，再由模型判断。没有接入画面识别或语音识别，不会假装看懂内容。'),
 ]),
 card('感兴趣时，做些什么',[
 field(state,'shareEnabled','自动分享感兴趣的视频',{type:'checkbox',help:'使用抖音原生视频卡片，发送给下方选定的接收人。'}),
 field(state,'shareRecipient','分享给谁',{type:'select',options,help:'指定联系人来自「私信与运行」中读取的会话，不用填写用户 ID。'}),
 field(state,'commentEnabled','在感兴趣的视频下自动评论',{type:'checkbox',help:'按小鱼人设生成并发布简短评论；有争议、证据不足或看不懂就跳过。'}),
 field(state,'commentStyle','评论语气与偏好',{type:'textarea',max:1000,help:'例如：轻松可爱，贴合视频说明，不要尬夸，少用米饭梗。'}),
 el('p','muted small','分享和评论都开启时，模型每个视频选择其中一项或跳过。关闭两项则只看视频。'),
 ]),
 ]),el('div','section-space',card('观看节奏',el('div','form-grid',[
 field(state,'cycleIntervalSeconds','每轮检查间隔（秒）',{type:'number',min:15,max:3600}),
 field(state,'dwellMinSeconds','每段最短观察（秒）',{type:'number',min:1,max:600}),
 field(state,'dwellMaxSeconds','每段最长观察（秒）',{type:'number',min:1,max:600}),
 ]))),el('div','save-bar',[el('div','',[el('strong','','保存喜好，再让小鱼出发'),el('p','muted small','保存会暂停当前任务。启动后可真实分享或发表评论，随时在控制台暂停。')]),mark,save])]);
 form.addEventListener('submit',e=>e.preventDefault());
 return [intro('遇到喜欢的，就分享给你。','按你的喜好刷视频，把有趣的相遇留下来。'),el('div','grid',[
 browserCard(),card('刷视频运行',[el('p','status-lead',view.runtime.autonomyActive?'正在按设置刷视频':'准备好就可以出发'),el('div','actions',[operationButton('启动刷视频与互动','start_plugin',{mode:'videos'},'primary'),button('暂停所有任务','secondary',()=>action('pause'),!view.runtime.canControl)]),line('当前已观察视频',view.watching.videos+' 个'),line('保存的分享规则',v.shareEnabled?'原生卡片分享':'关闭'),line('保存的评论规则',v.commentEnabled?'按兴趣发表评论':'关闭'),el('p','muted small section-space',friendlyReason(view.watching.lastOutcome?.reason)),el('p','muted small','私信与刷视频分别运行，切换会先暂停当前任务。开发作息仍保持关闭。')]),
 ]),el('div','section-space',form)];
}

function outcomeText(){const last=view.replies.lastOutcome;if(!last)return '还没有运行记录。';return ({confirmed:'本地已确认发送，主人收件另行记录。',no_new_message:'没有新的主人消息，继续等待。',baseline_saved:'消息基线已建立，旧消息不会自动回复。',owner_requested_stop:'主人要求停止，已暂停。',owner_replies_paused:'任务已暂停。'})[last.reason]||reasons[last.reason]||last.reason;}
function features(){return el('div','feature-grid',view.capabilities.map((f,i)=>el('section','card feature',[el('div','feature-top',[el('span','feature-symbol',['☏','▧','＠','▷','♫','✧'][i]),pill(({verified:'已有实测',implemented:'已实现',testing:'验收中',planned:'后续阶段'})[f.state],f.state==='verified'?'mint':f.state==='testing'?'gold':'')]),el('h3','',f.name),el('p','',f.description),el('small','',f.detail)])));}
function abilities(){return [intro('慢慢长出，自己的本领。','按真实实现与验收进度展示，不虚构技能等级。'),features(),el('div','section-space',card('下一步的方向',el('p','muted small','先稳定主人私信的连续收发，再逐步接入语音、日记和可追溯的成长记录。三餐与作息不会因为参考截图而自动开启。')))];}
function timeline(items){return el('div','timeline',items.map(item=>el('article','timeline-row',[el('time','',date(item.at,true)),el('div','',[el('span','',kindLabels[item.kind]||'互动'),pill(item.ownerConfirmedReceived?'主人已确认收到':statusLabels[item.status]||item.status,item.ownerConfirmedReceived?'mint':item.status==='uncertain'?'gold':'')]),item.archived?el('p','','旧记录已封存，原送达状态保留。'):null])));}
function timelinePage(){return [intro('每一步，都有迹可循。','真实互动的时间记录；页面回执与主人收件分别显示。'),card('行动时间线',view.timeline.length?timeline(view.timeline):empty('还没有互动记录'))];}

function updateBillingButton(){const button=$('#refresh-billing');if(button){button.disabled=busy||!view?.runtime.hostConnected;button.textContent=busy?'查询中…':'刷新账号余额';}}
function billingStatus(b){if(b?.refreshing)return b.wallets?.length?'更新中 · 显示上次余额':'正在查询账号余额';return ({ready:'已连接 · 当前账号',stale:'刷新失败 · 显示上次余额',failed:'暂时无法查询，请稍后重试',signed_out:'请在 DSH 登录 DeepSeek 账号',loading:'正在查询账号余额'})[b?.status]||(b?.reason==='account_provider_not_selected'?'当前模型未使用 DeepSeek 账号':'DSH 账号服务尚未就绪');}
function money(value,currency){if(value===null||value===undefined)return '未提供';const [whole,fraction='']=value.split('.');return (currency==='CNY'?'¥':'US$')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.padEnd(2,'0');}
function balanceSummary(b){const row=b?.wallets?.find(w=>w.currency==='CNY')??b?.wallets?.[0];if(!row)return billingStatus(b);const value=row.total!==null?money(row.total,row.currency):row.recharge!==null?money(row.recharge,row.currency)+'（充值）':money(row.bonus,row.currency)+'（赠送）';return value+(b.status==='stale'?' · 旧数据':'');}
function billingPage(){
 const b=view.billing,wallets=b?.wallets??[];
 const refresh=button(busy?'查询中…':'刷新账号余额','primary',()=>action('refresh_billing'),!view.runtime.hostConnected||busy);refresh.id='refresh-billing';
 const link=b?.usageUrl?el('a','button secondary','打开官方用量账单 ↗'):null;if(link){link.href=b.usageUrl;link.target='_blank';link.rel='noopener noreferrer';}
 return [intro('账号余额，随时看清。','读取 DSH 当前登录账号的钱包。账号余额包含其他会话的使用，不等于本插件单独花费。'),
 card('DeepSeek 账号钱包',[el('div','billing-status',[pill(billingStatus(b),b?.status==='ready'?'mint':'gold'),el('small','muted','最近成功查询：'+date(b?.fetchedAt,true))]),
 el('div','actions section-space',[refresh,link]),el('p','muted small section-space','余额自动缓存 60 秒，手动刷新最短间隔 10 秒。查询余额不调用模型。官方账单在新页面打开，浏览器可能需要登录。')]),
 el('div','grid section-space',wallets.length?wallets.map(w=>card(w.currency==='CNY'?'人民币钱包':'美元钱包',[
 el('div','wallet-total',[el('span','muted small','充值 + 赠送'),el('strong','',money(w.total,w.currency))]),line('充值余额',money(w.recharge,w.currency)),line('赠送余额',money(w.bonus,w.currency)),w.total===null?el('p','muted small','接口未提供完整的钱包，暂不计算合计。'):null,
 ])):card('钱包余额',empty(billingStatus(b),b?.refreshing?'页面可继续使用，查询完成后自动更新。':'未读到金额时保留为空，不当作零余额。'))),
 el('div','grid section-space',[
 card('本插件的本机记录',[line('今日模型请求预约',view.usage.today+' 次'),line('输入字节预留',view.usage.inputBytesReserved.toLocaleString()+' B'),line('输出 token 预留',view.usage.outputTokensReserved.toLocaleString()),el('p','muted small section-space','预约量用于本机运行控制，不能换算为实际扣费。')]),
 card('账单的统计范围',[line('余额来源','DSH 登录账号 · 官方钱包'),line('余额范围','整个账号'),line('实际 token 与扣费明细','通过上方官方用量账单查看'),el('p','muted small section-space','余额接口不返回逐次扣费或额度恢复时间。充值、赠送与消费都可能改变余额，因此不把余额差额记作插件花费。')])
 ])];
}
function runtimePage(){return [intro('把运行状态，说清楚。','数据来自当前插件文件和宿主运行状态。'),el('div','grid',[
 card('当前运行',[line('插件版本',view.version),line('宿主连接',view.runtime.hostConnected?'DSH 已连接':'独立查看模式'),line('全局状态',view.runtime.paused?'暂停':'运行'),line('私信回复',view.runtime.conversationRepliesActive||view.runtime.ownerRepliesActive?'运行中':view.runtime.ownerRepliesEnabled?'需要恢复':'已关闭'),line('自主任务',view.runtime.autonomyActive?'运行中':view.runtime.autonomyEnabled?'需要恢复':'已关闭'),line('作息与场次休息',view.runtime.scheduleEnabled?'开启':'关闭'),line('开发免额度模式',view.runtime.developmentEnabled?'开启':'关闭'),controls()]),
 card('用量与记录',[line('今日模型预约',view.usage.today+' 次'),line('输入字节预留',view.usage.inputBytesReserved.toLocaleString()+' B'),line('输出 token 预留',view.usage.outputTokensReserved.toLocaleString()),line('实际 token 消耗','请查看官方用量明细'),line('账号余额',balanceSummary(view.billing)),el('p','muted small section-space','请求预约不等于实际扣费。余额来自 DSH 当前登录账号；控制台刷新不调用模型。')]),
 ])];}
function render(){if(!view)return;const guest=view.role==='guest';$('#page-label').textContent=labels[page];$('#access-role').textContent=guest?'访客 · 只读':'主人视角';$('#connection').textContent=view.runtime.hostConnected?'宿主已连接':'本机记录';$('#version').textContent=view.version?.replace('0.8.0-','')||'';$('#updated').textContent='更新于 '+new Date(view.generatedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});$('#side-usage').hidden=guest;if(!guest)$('#side-requests').replaceChildren(document.createTextNode(view.usage.today+' '),el('small','','次模型预约'));if(!guest){$('#side-balance').textContent=balanceSummary(view.billing);$('#side-balance').title=billingStatus(view.billing);}
 $('#guest-link').hidden=guest||!guestPrepared;for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');}
 const pages={videos:videosPage,overview,persona,memory:memoryPage,replies:repliesPage,abilities,timeline:timelinePage,billing:billingPage,runtime:runtimePage};$('#content').replaceChildren(...[guest&&!['overview','abilities'].includes(page)?locked():pages[page]()].flat());
}
function refresh(force=false){
 refreshForced ||= force;
 if(refreshInFlight)return refreshInFlight;
 refreshInFlight=(async()=>{try{
  view=await api('/api/view');
  if(refreshForced||!document.activeElement?.closest('.notes-form,.settings-form'))render();
  if(view.role==='owner'&&!guestPrepared){const guest=await api('/api/action',{action:'guest_preview'});$('#guest-link').href=guest.url;guestPrepared=true;$('#guest-link').hidden=false;}
 }catch(error){notify(error.message);$('#connection').textContent='连接已断开';if(!view)$('#content').replaceChildren(el('section','card locked',[el('h2','','暂时连接不上小鱼'),el('p','',error.message),el('p','muted small','在 DSH 调用 fish_console_open，使用新返回的链接打开。')]));}
 finally{refreshInFlight=null;refreshForced=false;}})();return refreshInFlight;
}
for(const nav of document.querySelectorAll('[data-page]'))nav.addEventListener('click',()=>{page=nav.dataset.page;render();});
$('.brand').addEventListener('click',event=>{event.preventDefault();page='overview';render();});$('#refresh').addEventListener('click',()=>refresh(true));$('#cancel-start').addEventListener('click',()=>$('#start-dialog').close());$('#confirm-start').addEventListener('click',()=>{$('#start-dialog').close();void action('start_replies');});
async function poll(){if(document.visibilityState==='visible'&&!busy)await refresh();setTimeout(poll,view?.billing?.refreshing?2000:8000);}
void poll();
