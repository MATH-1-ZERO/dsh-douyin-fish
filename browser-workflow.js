import {reserveBrowserRead} from './manual-browser.js';
const tickets=new WeakMap();
// An internal ticket reserves ALL stages before opening any window. It never
// crosses a tool boundary; caller-provided JSON cannot waive a limit.
export async function reserveBrowserWorkflow(settings,store,{stages=3,now=Date.now()}={}){
 // One round may now include the first read, a bounded watch window, an optional
 // comment pass and the delivery itself; all still reserved before any window.
 if(!Number.isInteger(stages)||stages<1||stages>8)throw Error('Invalid workflow stages');
 const reservation=await store.transact(s=>{
  const before=structuredClone(s),first=reserveBrowserRead(settings,s,now);if(!first.value.allowed)return first;
  const c=settings.manualBrowser;
  if(!s.resources.development?.enabled){
   if(s.resources.manualBrowserReads.length+stages-1>c.readsPer24Hours)return {state:before,value:{allowed:false,reason:'browser_workflow_daily_limit'}};
   // Existing state format requires strictly ordered reservation timestamps.
   // Allocate the batch's millisecond slots ending at this transaction time;
   // these are reservation slots, not claims that pages were actually read.
   const previous=s.resources.manualBrowserReads.at(-2)??-1,start=now-stages+1;
   if(start<=previous||start<0)return {state:before,value:{allowed:false,reason:'browser_workflow_clock_order'}};
   s.resources.manualBrowserReads.pop();for(let i=0;i<stages;i++)s.resources.manualBrowserReads.push(start+i);
  }else{if(s.resources.development.readsTotal>Number.MAX_SAFE_INTEGER-stages+1)throw Error('Development counter overflow');s.resources.development.readsTotal+=stages-1;}
  return {state:s,value:{allowed:true}};
 });
 if(!reservation.allowed)return reservation;
 const ticket=Object.freeze({});tickets.set(ticket,{store,remaining:stages,expires:now+180000,configuration:JSON.stringify(settings.manualBrowser)});
 return {allowed:true,ticket,reservedStages:stages};
}
export async function reserveBrowserStage(settings,store,ticket,now=Date.now()){
 if(ticket===undefined)return store.transact(s=>reserveBrowserRead(settings,s,now));
 const t=tickets.get(ticket);
 if(!t||t.store!==store||t.remaining<1||now>t.expires||t.configuration!==JSON.stringify(settings.manualBrowser)||settings.manualBrowser?.enabled!==true)return {allowed:false,reason:'browser_workflow_expired_or_changed'};
 --t.remaining;return {allowed:true,workflowStage:true};
}
