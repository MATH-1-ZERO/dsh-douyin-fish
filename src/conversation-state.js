import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const replyDefaults={ownerEnabled:true,pollSeconds:30,selected:[],defaultEnabled:false,defaultText:'你好呀，消息收到啦，我是自动回复的小鱼，稍后再聊～',maxCharacters:100,replyStyle:''};
export function replySettings(state){return {...replyDefaults,pollSeconds:state.resources.ownerReplies?.pollSeconds??replyDefaults.pollSeconds,ownerEnabled:state.resources.persona?.limits?.allowOwnerDm??true,...state.resources.replySettings};}
export function validateReplySettings(value){
 if(!value||Object.keys(value).some(k=>!Object.hasOwn(replyDefaults,k))||typeof value.ownerEnabled!=='boolean'||typeof value.defaultEnabled!=='boolean'||!Number.isInteger(value.pollSeconds)||value.pollSeconds<15||value.pollSeconds>3600||!Number.isInteger(value.maxCharacters)||value.maxCharacters<10||value.maxCharacters>100||typeof value.replyStyle!=='string'||value.replyStyle.length>1000||typeof value.defaultText!=='string'||!value.defaultText.trim()||[...value.defaultText].length>value.maxCharacters||value.defaultText.split(/\r?\n/).length>2||/[@＠]|https?:\/\//iu.test(value.defaultText)||!Array.isArray(value.selected)||value.selected.length>50||new Set(value.selected).size!==value.selected.length||value.selected.some(x=>!/^[a-f0-9]{64}$/.test(x)))throw Error('invalid_reply_settings');return value;
}
export function validateConversationResources(r){
 if(r.replySettings!==undefined)validateReplySettings(r.replySettings);
 if(r.conversations!==undefined){const d=r.conversations;
  if(!d||!Number.isSafeInteger(d.at)||!Array.isArray(d.items)||d.items.length>50||new Set(d.items.map(x=>x.id)).size!==d.items.length||d.items.some(x=>!x||typeof x.name!=='string'||!x.name||x.name.length>60||!['avatar','account'].every(k=>typeof x[k]==='string'&&x[k].startsWith('https://')&&x[k].length<2048)||x.id!==digest([x.account,x.name,x.avatar])))throw Error('Invalid conversation directory');
 }
 if(r.conversationReplies!==undefined){const q=r.conversationReplies;
  if(!q||typeof q.enabled!=='boolean'||!(q.lease===null||typeof q.lease==='string')||!Array.isArray(q.seen)||q.seen.length>1000||q.seen.some(x=>!/^[a-f0-9]{64}$/.test(x))||!Array.isArray(q.baselines)||q.baselines.length>51||!Array.isArray(q.events)||q.events.length>300||q.events.some(e=>!e||!/^[a-f0-9]{64}$/.test(e.key)||typeof e.recipient!=='string'||!Number.isSafeInteger(e.at)||!['preparing','confirmed','failed','uncertain','skipped'].includes(e.status)))throw Error('Invalid conversation reply state');
 }
}
export const freshConversationReplies=()=>({enabled:false,lease:null,seen:[],baselines:[],events:[],lastOutcome:null});
export function selectedConversation(state,id){
 const item=state.resources.conversations?.items.find(x=>x.id===id);if(!item)return null;
 const p=replySettings(state);return p.selected.includes(id)?{...item,mode:'model'}:p.defaultEnabled?{...item,mode:'fixed'}:null;
}
export function settingsPatch(state,changes){
 const value=validateReplySettings({...replySettings(state),...changes});
 if(value.selected.some(id=>!state.resources.conversations?.items.some(x=>x.id===id)))throw Error('conversation_selection_expired');
 return value;
}
