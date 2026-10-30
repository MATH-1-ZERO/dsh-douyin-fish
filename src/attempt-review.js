export const isBlockingAttempt=q=>q.status==='reserved'||q.status==='uncertain'&&q.ownerAcknowledgedUncertain!==true;
export function archiveUncertain(state,args,time=Date.now()){
 if(args.confirm!=='archive_uncertain_without_retry')return {state,value:{allowed:false,reason:'explicit_archive_required'}};
 if(!state.paused||state.resources.autonomy?.enabled||state.resources.ownerReplies?.enabled)return {state,value:{allowed:false,reason:'pause_before_archiving'}};
 const ids=args.attemptIds,videos=args.quarantineVideoIds??[];
 if(!Array.isArray(ids)||ids.length<1||ids.length>20||new Set(ids).size!==ids.length||!Array.isArray(videos)||videos.length>20||videos.some(id=>!/^\d{10,25}$/.test(id))||!Number.isSafeInteger(time)||time<state.lastTime)throw Error('Invalid exact archive request');
 const attempts=ids.map(id=>state.resources.interactionAttempts?.find(q=>q.id===id));if(attempts.some(q=>!q||q.status!=='uncertain'||q.ownerAcknowledgedUncertain))throw Error('Only exact unarchived uncertain attempts can be archived');
 const quarantine=[...new Set([...(state.resources.interactionQuarantine??[]),...videos])];if(quarantine.length>200)throw Error('Quarantine history full');
 for(const q of attempts){q.ownerAcknowledgedUncertain=true;q.ownerAcknowledgedAt=time;}
 state.resources.interactionQuarantine=quarantine;state.lastTime=time;
 return {state,value:{allowed:true,archived:ids.length,statusesUnchanged:true,usagePreserved:true,exactRetriesStillBlocked:true,quarantinedVideoIds:quarantine,automaticTasksStillPaused:true}};
}
