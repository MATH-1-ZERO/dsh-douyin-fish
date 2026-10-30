export function validateDevelopment(d){
 if(d===undefined)return;
 if(!d||typeof d.enabled!=='boolean'||!Number.isSafeInteger(d.readsTotal)||d.readsTotal<0||!(d.lastReadAt===null||Number.isSafeInteger(d.lastReadAt)&&d.lastReadAt>=0))throw Error('Invalid development state');
}
export function developmentRead(state,time){
 const d=state.resources?.development;
 if(!d?.enabled)return null;
 validateDevelopment(d);
 if(!Number.isSafeInteger(time)||time<state.lastTime)return {state,value:{allowed:false,reason:'clock_rollback'}};
 if(d.readsTotal===Number.MAX_SAFE_INTEGER)throw Error('Development counter overflow');
 d.readsTotal++;d.lastReadAt=time;state.lastTime=time;
 return {state,value:{allowed:true,developmentMode:true,developmentReads:d.readsTotal,readReservationsLimit:null,productionUsagePreserved:true}};
}
