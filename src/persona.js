import {validateOwnerLimits,inheritedLimits} from './owner-limits.js';
import {interactionLimits} from './interaction-gate.js';
// Owner-tunable watching rhythm. Nothing here can claim understanding audio or video.
export const watchDefaults={dwellMinSeconds:8,dwellMaxSeconds:20,sampleIntervalMs:2000,
  minAdvancePercent:60,readCommentsEveryVideos:3,maxVideosPerSession:20,cycleIntervalSeconds:60};
export const watchProperties={dwellMinSeconds:{type:'integer',minimum:1,maximum:600},
  dwellMaxSeconds:{type:'integer',minimum:1,maximum:600},sampleIntervalMs:{type:'integer',minimum:500,maximum:10000},
  minAdvancePercent:{type:'integer',minimum:0,maximum:100},readCommentsEveryVideos:{type:'integer',minimum:0,maximum:50},
  maxVideosPerSession:{type:'integer',minimum:1,maximum:200},cycleIntervalSeconds:{type:'integer',minimum:15,maximum:3600}};
export function validateWatch(value){
 if(value===undefined)return {...watchDefaults};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(watchDefaults,k)))throw Error('Invalid watch policy');
 const out={...watchDefaults,...value};
 for(const [key,schema]of Object.entries(watchProperties)){
  const v=out[key];
  if(!Number.isSafeInteger(v)||v<schema.minimum||v>schema.maximum)throw Error('Invalid watch setting: '+key);
 }
 if(out.dwellMaxSeconds<out.dwellMinSeconds)throw Error('Invalid watch dwell range');
 return out;
}
export function watchPolicy(persona){return validateWatch(persona?.watch);}
const allowed=['version','name','personaText','voice','likedTags','blockedTags','ownerId','ownerAddress','dmContacts','schedule','limits','interactionLimits','watch'];
const schedules=['enabled','timeZone','activeStart','activeEnd','sessionMinutes','restMinutes','intervalMinutes','dailyReads'];
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validatePersona(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!allowed.includes(k))||p.version!==1||!text(p.name,60)||!p.name.trim()||!text(p.personaText,8000)||!text(p.voice,300)||!p.voice.trim())throw Error('Invalid persona fields');
  for(const key of ['likedTags','blockedTags','dmContacts'])if(!Array.isArray(p[key])||p[key].length>100||p[key].some(t=>!text(t,key==='dmContacts'?200:80)||!t.trim()))throw Error('Invalid persona list');
  if(!text(p.ownerId,200))throw Error('Invalid owner ID');
  if(p.ownerAddress!==undefined&&(typeof p.ownerAddress!=='string'||! /^[\p{L}\p{N}·_-]{1,16}$/u.test(p.ownerAddress)))throw Error('Invalid owner address');
  const s=p.schedule;
  if(!s||Object.keys(s).some(k=>!schedules.includes(k))||!text(s.timeZone,80))throw Error('Invalid schedule');
  if(s.enabled!==undefined&&typeof s.enabled!=='boolean')throw Error('Invalid schedule enabled flag');
  new Intl.DateTimeFormat('en',{timeZone:s.timeZone});
  for(const key of ['activeStart','activeEnd'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s[key]))throw Error('Invalid activity hours');
  if(s.activeStart===s.activeEnd||!integer(s.sessionMinutes,1,120)||!integer(s.restMinutes,1,1440)||!integer(s.intervalMinutes,1,1440)||!integer(s.dailyReads,0,100))throw Error('Invalid schedule limits');
  if(p.limits!==undefined)validateOwnerLimits(p.limits);
  if(p.interactionLimits!==undefined)interactionLimits(p.interactionLimits);
  validateWatch(p.watch);
  return p;
}
export function effectiveSettings(base,state){
  const p=state.resources?.persona;if(!p)return base;validatePersona(p);const limits=inheritedLimits(base,p);
  const ownerAddress=p.ownerAddress??base.ownerAddress??'主人',addressRule='称呼主人为“'+ownerAddress+'”。';
  return {...base,ownerAddress,likedTags:[...p.likedTags],blockedTags:[...p.blockedTags],ownerId:p.ownerId,dmContacts:[...p.dmContacts],
    interactionLimits:interactionLimits(p.interactionLimits),
    watch:watchPolicy(p),
    scheduleEnabled:p.schedule.enabled??true,timeZone:p.schedule.timeZone,activeStart:p.schedule.activeStart,activeEnd:p.schedule.activeEnd,
    sessionMinutes:p.schedule.sessionMinutes,restMinutes:p.schedule.restMinutes,
    manualDrafts:{...base.manualDrafts,persona:p.voice.slice(0,300-addressRule.length)+addressRule,maxCharacters:limits.maxCharacters,maxEmoji:limits.maxEmoji,maxLines:limits.maxLines},
    efficiency:{...base.efficiency,requestsPer24Hours:limits.modelRequestsPer24Hours,maxOutputTokens:limits.maxOutputTokens},
    draftPolicy:{dailyLimit:limits.draftDailyLimit,intervalSeconds:limits.draftIntervalSeconds},
    inboundPolicy:{dailyLimitPerContact:limits.dmDailyLimitPerContact,intervalSeconds:limits.dmIntervalSeconds,allowOwner:limits.allowOwnerDm,allowContacts:limits.allowContactsDm,strangers:limits.strangers},
    manualBrowser:{...base.manualBrowser,readsPer24Hours:p.schedule.dailyReads,intervalMinutes:p.schedule.intervalMinutes}};
}
export function importPersona(state,profile){
  validatePersona(profile);state.resources.persona=structuredClone(profile);
  state.paused=true;
  if(state.resources.autonomy)state.resources.autonomy.enabled=false;
  return {state,value:{allowed:true,name:profile.name,personaImported:true,automaticTasksPaused:true,
    ownerConfigured:!!profile.ownerId,contactCount:profile.dmContacts.length,sendingSupported:false,
    note:'Persona changes voice and typed preferences, never grants tools or sending permissions.'}};
}
export function personaStatus(state){const p=state.resources?.persona;return {imported:!!p,...(p?{name:p.name,voice:p.voice,schedule:p.schedule,scheduleEnabled:p.schedule.enabled??true,watch:watchPolicy(p),likedTags:p.likedTags,blockedTags:p.blockedTags,ownerConfigured:!!p.ownerId,contactCount:p.dmContacts.length}:{}),sendingSupported:false};}
