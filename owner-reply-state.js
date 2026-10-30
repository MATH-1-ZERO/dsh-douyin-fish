import {createHash} from 'node:crypto';
export const ownerIncomingKey=(owner,text)=>createHash('sha256').update(JSON.stringify([owner,'incoming',text])).digest('hex');
export const freshOwnerReplies=()=>({enabled:false,ownerId:null,pollSeconds:60,baselineReady:false,sessionStart:null,restUntil:null,inFlightId:null,inFlightAt:null,seen:[],events:[],lastOutcome:null});
export function validateOwnerReplies(r){
 if(r===undefined)return;
 const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),time=x=>Number.isSafeInteger(x)&&x>=0;
 if(!r||typeof r.enabled!=='boolean'||!(r.ownerId===null||typeof r.ownerId==='string'&&/^[A-Za-z0-9_-]{5,200}$/.test(r.ownerId))||!Number.isSafeInteger(r.pollSeconds)||r.pollSeconds<15||r.pollSeconds>3600||typeof r.baselineReady!=='boolean'||!['sessionStart','restUntil','inFlightAt'].every(k=>r[k]===null||time(r[k]))||!(r.inFlightId===null||typeof r.inFlightId==='string'&&/^[a-f0-9-]{36}$/.test(r.inFlightId))||!Array.isArray(r.seen)||r.seen.length>500||new Set(r.seen).size!==r.seen.length||r.seen.some(x=>!hex(x))||!Array.isArray(r.events)||r.events.length>200)throw Error('Invalid owner reply runtime');
 for(const e of r.events)if(!e||!hex(e.key)||!time(e.at)||!['reserved','draft_saved','deferred','confirmed','uncertain','skipped','failed'].includes(e.status)||e.draftId!==undefined&&typeof e.draftId!=='string'||e.attemptId!==undefined&&typeof e.attemptId!=='string'||e.reason!==undefined&&(typeof e.reason!=='string'||!e.reason||e.reason.length>120))throw Error('Invalid owner reply event');
}
