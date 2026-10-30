import {limitProperties,inheritedLimits} from './owner-limits.js';
import {interactionProperties,interactionLimits} from './interaction-gate.js';
import {validatePersona,personaStatus,validateWatch,watchPolicy,watchProperties} from './persona.js';
export const settingProperties={
  name:{type:'string',maxLength:60},personaText:{type:'string',maxLength:8000},voice:{type:'string',maxLength:300},
  scheduleEnabled:{type:'boolean'},
  dailyReads:{type:'integer',minimum:0,maximum:100},readIntervalMinutes:{type:'integer',minimum:1,maximum:1440},
  activeStart:{type:'string'},activeEnd:{type:'string'},timeZone:{type:'string'},sessionMinutes:{type:'integer',minimum:1,maximum:120},restMinutes:{type:'integer',minimum:1,maximum:1440},
  likedTags:{type:'array',items:{type:'string'}},blockedTags:{type:'array',items:{type:'string'}},ownerId:{type:'string'},dmContacts:{type:'array',items:{type:'string'}},
  ...limitProperties,
  ownerAddress:{type:'string',maxLength:16},
  interactionLimits:{type:'object',properties:interactionProperties,additionalProperties:false},
  watch:{type:'object',properties:watchProperties,additionalProperties:false},
};
const direct=['name','personaText','voice','likedTags','blockedTags','ownerId','ownerAddress','dmContacts'];
const scheduleKeys=['dailyReads','activeStart','activeEnd','timeZone','sessionMinutes','restMinutes'];
export function updatedPersona(base,state,changes){
  if(!state.resources?.persona)throw Error('Import a persona first');
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!Object.hasOwn(settingProperties,k)))throw Error('Invalid owner settings patch');
  const p=structuredClone(state.resources.persona);p.limits=inheritedLimits(base,p);
  for(const [key,value]of Object.entries(changes)){
    if(key==='interactionLimits'){
      interactionLimits(value);p.interactionLimits=interactionLimits({...p.interactionLimits,...value});
    }
    else if(key==='watch')p.watch=validateWatch({...watchPolicy(p),...value});
    else if(key==='scheduleEnabled')p.schedule.enabled=value;
    else if(direct.includes(key))p[key]=structuredClone(value);
    else if(scheduleKeys.includes(key))p.schedule[key]=value;
    else if(key==='readIntervalMinutes')p.schedule.intervalMinutes=value;
    else p.limits[key]=value;
  }
  return validatePersona(p);
}
export function ownerSettingsView(base,state){
  const p=state.resources?.persona;
  return {pluginVersion:'0.8.0-dev.18',persona:personaStatus(state),limits:p?inheritedLimits(base,p):null,
    interactionLimits:interactionLimits(p?.interactionLimits),interactionAdapterConnected:true,
    settings:p?{...p.schedule,scheduleEnabled:p.schedule.enabled??true,readIntervalMinutes:p.schedule.intervalMinutes,likedTags:p.likedTags,blockedTags:p.blockedTags,ownerId:p.ownerId,ownerAddress:p.ownerAddress??base.ownerAddress??'主人',dmContacts:p.dmContacts,watch:watchPolicy(p),...inheritedLimits(base,p)}:null,
    sendingSupported:true,sendingScope:'explicit_exact_public_actions_and_verified_owner_dm',ownerDmReadSupported:true,automaticSendingEnabled:false,ownerAutomaticReplyConfigured:state.resources?.ownerReplies?.enabled===true,inboxConnected:false,
    constraints:{dailyReads:[0,100],readIntervalMinutes:[1,1440],dailyZeroDisablesReads:true,strangerChoices:['ask','ignore']},
    notes:['数值范围是插件的技术边界，不是平台认可的安全频率。','修改保留已有额度并暂停任务；主人自动回复需单独启动，陌生人及其他联系人真实私信尚未接入。']};
}
