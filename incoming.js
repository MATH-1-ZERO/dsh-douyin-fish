import {createHash,randomUUID} from 'node:crypto';
import {transition} from './engine.js';
import {effectiveSettings} from './persona.js';
import {approvedVideoPage} from './live-browser/route-policy.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function incomingCommand(base,state,command,input,time=Date.now()){
  const r=state.resources,c=effectiveSettings(base,state);
  r.contactRequests??=[];r.incomingPrepared??=[];r.incomingReservations??=[];
  const reply=value=>({state,value:{...value,sendingSupported:false,inboxConnected:false}});
  if(!Number.isSafeInteger(time)||time<state.lastTime)return reply({allowed:false,reason:'clock_rollback'});
  state.lastTime=time;
  if(command==='contact_requests')return reply({requests:r.contactRequests.filter(q=>q.status==='pending').slice(0,10).map(q=>({id:q.id,senderId:q.senderId,preview:q.preview,at:q.at})),pending:r.contactRequests.filter(q=>q.status==='pending').length});
  if(command==='contact_decide'){
    if(input.confirm!=='owner_contact_decision'||!['allow_once','deny'].includes(input.decision))throw Error('Explicit owner decision required');
    const q=r.contactRequests.find(q=>q.id===input.id);
    if(!q||q.status!=='pending')return reply({allowed:false,reason:'request_not_pending'});
    q.status=input.decision==='allow_once'?'allowed_once':'denied';
    return reply({allowed:true,id:q.id,status:q.status,scope:'one_exact_incoming_message',contactAddedToAllowlist:false});
  }
  if(command!=='incoming_prepare')throw Error('Invalid incoming command');
  for(const key of ['senderId','messageId'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>200)throw Error('Invalid incoming identity');
  if(!['comment_reply','dm'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw Error('Invalid incoming material');
  if(input.kind==='comment_reply'&&(!approvedVideoPage(input.videoRef)||!/(?:\/video\/|modal_id=)/.test(input.videoRef)))throw Error('Exact public video reference required');
  const key=hash([input.kind,input.senderId,input.messageId,input.text]);
  if(r.incomingPrepared.includes(key))return reply({allowed:false,reason:'incoming_already_prepared'});
  if(/去死|滚蛋|傻[逼比]|加我微信|转账|验证码|密码|cookie|access[_ -]?token/iu.test(input.text))return reply({allowed:false,reason:'skip_hostile_or_sensitive_material'});
  const known=c.ownerId===input.senderId||c.dmContacts.includes(input.senderId);
  const policy=c.inboundPolicy;
  const senderHash=hash(input.senderId);
  if(input.kind==='dm'&&policy){
    if(c.ownerId===input.senderId&&!policy.allowOwner)return reply({allowed:false,reason:'owner_dm_disabled'});
    if(c.ownerId!==input.senderId&&known&&!policy.allowContacts)return reply({allowed:false,reason:'contact_dm_disabled'});
    if(!known&&policy.strangers==='ignore')return reply({allowed:false,reason:'stranger_ignored'});
  }
  let permission;
  if(input.kind==='dm'&&!known){
    permission=r.contactRequests.find(q=>q.key===key);
    if(!permission){
      if(r.contactRequests.length>=50)return reply({allowed:false,reason:'contact_request_queue_full'});
      permission={id:randomUUID(),key,senderId:input.senderId,preview:[...input.text].slice(0,160).join(''),at:time,status:'pending'};
      r.contactRequests.push(permission);
    }
    if(permission.status!=='allowed_once')return reply({allowed:false,reason:permission.status==='denied'?'owner_denied':'owner_approval_required',requestId:permission.id});
  }
  if(input.kind==='dm'&&policy){
    const recent=r.incomingReservations.filter(q=>q.senderHash===senderHash&&time-q.time<86400000);
    if(recent.length>=policy.dailyLimitPerContact)return reply({allowed:false,reason:'contact_daily_limit'});
    if(recent.some(q=>time-q.time<policy.intervalSeconds*1000))return reply({allowed:false,reason:'contact_cooldown'});
  }
  const prepared=transition(c,state,'manual_prepare',{kind:input.kind==='dm'?'dm':'comment',material:input.text,
    recipientHint:c.ownerId===input.senderId?(c.ownerAddress??'主人'):known?'指定联系人':'网友',sourceRef:input.kind==='dm'?'incoming:'+hash([input.senderId,input.messageId]):input.videoRef},time);
  if(prepared.value.allowed){
    r.incomingPrepared=[...r.incomingPrepared,key].slice(-200);if(permission)permission.status='used';
    if(input.kind==='dm'&&!prepared.value.cacheHit)r.incomingReservations=[...r.incomingReservations.filter(q=>time-q.time<86400000),{time,senderHash,key}];
  }
  // transition clones state; carry approval and dedup edits into its committed copy.
  prepared.state.resources.contactRequests=r.contactRequests;prepared.state.resources.incomingPrepared=r.incomingPrepared;
  prepared.state.resources.incomingReservations=r.incomingReservations;
  return {state:prepared.state,value:{...prepared.value,incomingKey:key,incomingKind:input.kind,identityVerifiedByPlatform:false,sendingSupported:false,inboxConnected:false}};
}
