export const videoDefaults={shareEnabled:false,commentEnabled:false,shareRecipient:'owner',commentStyle:''};
export const videoPreferences=state=>({...videoDefaults,...state.resources.videoPreferences});
export function validateVideoPreferences(value){
 if(!value||Object.keys(value).some(k=>!Object.hasOwn(videoDefaults,k))||typeof value.shareEnabled!=='boolean'||typeof value.commentEnabled!=='boolean'||typeof value.commentStyle!=='string'||value.commentStyle.length>1000||value.shareRecipient!=='owner'&&!/^[a-f0-9]{64}$/.test(value.shareRecipient))throw Error('invalid_video_preferences');return value;
}
export function videoActions(state){const p=videoPreferences(state);return [...(p.commentEnabled?['comment']:[]),...(p.shareEnabled?['share_card']:[]),'skip'];}
export function preferenceDecision(state,text){
 const p=state.resources.persona,normal=value=>String(value).normalize('NFKC').toLocaleLowerCase(),body=normal(text);
 if(p.blockedTags.some(tag=>body.includes(normal(tag))))return {allowed:false,reason:'blocked_preference'};
 if(!p.likedTags.length)return {allowed:false,reason:'video_interests_required'};
 const matches=p.likedTags.filter(tag=>body.includes(normal(tag)));return matches.length?{allowed:true,matches}:{allowed:false,reason:'not_preferred'};
}
export function videoRecipient(state){
 const p=videoPreferences(state);if(!p.shareEnabled)return null;
 if(p.shareRecipient==='owner')return {kind:'owner',id:state.resources.ownerIdentity?.platformId};
 const item=state.resources.conversations?.items.find(c=>c.id===p.shareRecipient&&c.id!==state.resources.conversations.ownerId);return item?{...item,kind:'contact'}:null;
}
export function selectedVideoSharing(state,id){return state.resources.autonomy?.enabled===true&&!!state.resources.autonomy.inFlightId&&state.resources.autonomy.deliveryMode==='console_preferences'&&videoPreferences(state).shareEnabled&&videoPreferences(state).shareRecipient===id&&videoRecipient(state)?.kind==='contact';}
