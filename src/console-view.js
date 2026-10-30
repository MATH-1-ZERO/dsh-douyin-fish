import {videoPreferences} from './video-preferences.js';
import {watchPolicy} from './persona.js';
import {replySettings} from './conversation-state.js';
import {isBlockingAttempt} from './attempt-review.js';

const dayKey=time=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);
const short=(value,max=300)=>typeof value==='string'?value.slice(0,max):'';
export function consoleView(state,{version,now=Date.now(),role='owner',runtime={},billing=null}={}){
 const r=state.resources??{},p=r.persona,a=r.interactionAttempts??[],replies=r.ownerReplies??{},memory=r.memory??{total:0,recent:[],compacted:{}},requests=r.requests??[];
 const owner=role==='owner',today=dayKey(now),todayRequests=requests.filter(q=>dayKey(q.time)===today);
 const confirmations=a.filter(q=>q.ownerConfirmedReceived===true&&q.status==='confirmed');
 const latestReply=(replies.events??[]).filter(e=>e.status==='confirmed'&&e.ownerConfirmedReceived===true&&confirmations.some(q=>q.id===e.attemptId)).sort((x,y)=>(y.ownerReportAt??y.at)-(x.ownerReportAt??x.at))[0];
 const days=Array.from({length:7},(_,i)=>dayKey(now-(6-i)*86400000));
 const view={version,generatedAt:now,role:owner?'owner':'guest',name:short(p?.name||'大肥鱼',60),
  runtime:{conversationRepliesActive:runtime.conversationRepliesActive===true,conversationRepliesEnabled:r.conversationReplies?.enabled===true,consoleOperationActive:owner&&runtime.consoleOperationActive===true,paused:state.paused===true,ownerRepliesEnabled:replies.enabled===true,ownerRepliesActive:runtime.ownerRepliesActive===true,autonomyEnabled:r.autonomy?.enabled===true,autonomyActive:runtime.autonomyActive===true,hostConnected:runtime.hostConnected===true,canControl:owner&&runtime.canControl===true,scheduleEnabled:p?.schedule?.enabled??true,developmentEnabled:r.development?.enabled===true},
  capabilities:[
   {name:'主人私信',description:'读取新消息、生成回复、真实发送',state:latestReply?'verified':'implemented',detail:latestReply?'已有主人确认收件；连续运行继续验收':'已实现，真实收件待确认'},
   {name:'原生视频卡片',description:'通过抖音分享面板发送视频卡片',state:r.liveVerification?.nativeCard?'verified':'implemented',detail:r.liveVerification?.nativeCard?'已有准确卡片的收件确认':'已实现，收件待确认'},
   {name:'原生 @ 主人',description:'选择已核验的主人并提交原生提及',state:r.liveVerification?.nativeMention?'verified':'implemented',detail:r.liveVerification?.nativeMention?'已有通知与评论可见确认':'已实现，通知待确认'},
   {name:'持续看视频',description:'观测播放进度与视频切换',state:'testing',detail:'单视频观测已验证，多视频继续验收'},
   {name:'语音表达',description:'声音、语气与语音记忆',state:'planned',detail:'尚未接入语音服务'},
   {name:'生活与成长',description:'日记、练习记录与成长里程碑',state:'planned',detail:'后续阶段，不生成虚构进度'},
  ],
  counts:{memory:memory.total??0,ownerReceipts:confirmations.length,confirmed:a.filter(q=>q.status==='confirmed').length,unresolved:a.filter(isBlockingAttempt).length},
 };
 if(!owner)return view;
 return {...view,owner:{configured:r.ownerIdentity?.verified===true&&r.ownerIdentity.platformId===p?.ownerId,address:short(p?.ownerAddress||'老大',16)},
  persona:{text:short(p?.personaText,8000),voice:short(p?.voice,300),likedTags:(p?.likedTags??[]).map(t=>short(t,80)),blockedTags:(p?.blockedTags??[]).map(t=>short(t,80))},
  replies:{baselineReady:replies.baselineReady===true,pollSeconds:replies.pollSeconds??60,inFlight:!!replies.inFlightId,seenCount:replies.seen?.length??0,eventCount:replies.events?.length??0,confirmedCount:(replies.events??[]).filter(e=>e.status==='confirmed').length,lastOutcome:replies.lastOutcome?{at:replies.lastOutcome.at,allowed:replies.lastOutcome.allowed===true,reason:short(replies.lastOutcome.reason,160)}:null,latestOwnerReceiptAt:latestReply?.ownerReportAt??latestReply?.at??null,testRunning:runtime.testRunning===true,testReplyCount:runtime.testReplyCount??0,testMaxReplies:runtime.testMaxReplies??null},
  billing,
  browser:runtime.browser??{liveChecked:false,bindingVerified:false},
  replySettings:replySettings(state),
  videoSettings:{...videoPreferences(state),likedTags:p?.likedTags??[],blockedTags:p?.blockedTags??[],...watchPolicy(p)},
  watching:{mode:r.autonomy?.deliveryMode??'watch_only',videos:r.autonomy?.videosThisSession??0,lastOutcome:r.autonomy?.lastOutcome??null},
  conversations:{at:r.conversations?.at??null,loadedOnly:true,ownerMatched:!!r.conversations?.ownerId,items:(r.conversations?.items??[]).map(c=>({id:c.id,name:c.name,isOwner:c.id===r.conversations.ownerId}))},
  conversationReplies:{baselineCount:r.conversationReplies?.baselines.length??0,eventCount:r.conversationReplies?.events.length??0,confirmedCount:r.conversationReplies?.events.filter(e=>e.status==='confirmed').length??0,inFlight:!!r.conversationReplies?.lease,lastOutcome:r.conversationReplies?.lastOutcome??null},
  usage:{today:todayRequests.length,inputBytesReserved:todayRequests.reduce((n,q)=>n+q.inputBytes,0),outputTokensReserved:todayRequests.reduce((n,q)=>n+q.outputTokens,0),actualTokens:null,balance:null,days:days.map(day=>({day,requests:requests.filter(q=>dayKey(q.time)===day).length,sends:a.filter(q=>dayKey(q.at)===day&&q.status==='confirmed').length}))},
  memory:{total:memory.total??0,revision:memory.revision??0,compacted:{...memory.compacted},recent:[...(memory.recent??[])].reverse().map(e=>({kind:e.kind,at:e.time,text:e.text==='[message text not retained]'?'消息正文未保留':short(e.text,500)}))},
  timeline:[...a].sort((x,y)=>y.at-x.at).slice(0,30).map(q=>({at:q.at,kind:q.kind,status:q.status,ownerConfirmedReceived:q.ownerConfirmedReceived===true,archived:q.ownerAcknowledgedUncertain===true})),
 };
}
