// Separates what was actually evidenced from what is only a local artifact.
// A persisted local receipt is never reported as platform-visible or as owner-received.
import {videoIdFromPage} from './comment-policy.js';

export const NOT_EVIDENCED='not_evidenced';

function readStage(read){
  const material=read?.untrustedMaterial,sourceRef=read?.sourceRef??material?.sourceRef;
  return {allowed:read?.allowed===true,sourceRef:sourceRef??null,videoId:sourceRef?videoIdFromPage(sourceRef)??null:null,
    bindingVerified:read?.checks?.bindingVerified===true,captionCharacters:typeof material?.text==='string'?material.text.length:0,
    commentCount:read?.untrustedComments?.comments?.length??0,
    evidence:'bound_caption_read_only_not_full_viewing_or_audio'};
}
function watchStage(watch){
  if(!watch)return {performed:false,evidence:NOT_EVIDENCED};
  if(watch.allowed!==true)return {performed:true,completed:false,reason:watch.reason,evidence:'incomplete_watch'};
  return {performed:true,completed:true,dwellMs:watch.dwellMs,playbackAdvancedSeconds:watch.playbackAdvancedSeconds,
    playbackSufficient:watch.playbackSufficient,sampleCount:watch.sampleCount,frameCaptured:watch.frameCaptured===true,
    audioObserved:false,videoUnderstood:false,modelCalled:false,evidence:'bound_playback_samples_only'};
}
export function deliveryReport(state,{read,watch,model,action,receipt,attemptId}={}){
  const attempts=state?.resources?.interactionAttempts??[];
  const attempt=attemptId?attempts.find(q=>q.id===attemptId):null;
  const localStatus=receipt?.status??attempt?.status??(action?.attempted?'not_recorded':'not_attempted');
  const ownerConfirmed=attempt?.ownerConfirmedReceived===true;
  const ownerReportedMissing=attempt?.ownerReportedNotReceived===true;
  return {
    stages:{
      read:readStage(read),
      watch:watchStage(watch),
      model:{called:model?.called===true,requests:model?.requests??0,action:model?.action??null,
        outcome:model?.status??model?.reason??null},
      action:{kind:action?.kind??null,attempted:action?.attempted===true,singleAttempt:action?.attempted!==true||true,
        target:action?.target??null,error:action?.error??null},
      localReceipt:{status:localStatus,persisted:attempt!==null,attemptId:attemptId??null,
        kind:'local_persisted_ledger_not_platform_proof'},
      platformVisible:{verified:false,attemptType:attempt?.kind??null,
        claim:'Comment visibility was re-read from the page only; Douyin does not expose third-party visibility proof.',
        evidence:NOT_EVIDENCED},
      ownerReceived:{verified:ownerConfirmed,...(ownerReportedMissing?{ownerReportedMissing:true}:{}),
        evidence:ownerConfirmed?'owner_confirmation_tool':'owner_confirmation_required_not_local_echo'},
    },
    claims:{
      readSuccess:read?.allowed===true,
      watchComplete:watch?.allowed===true&&watch.playbackSufficient===true,
      videoUnderstood:false,audioUnderstood:false,
      actionAttempted:action?.attempted===true,
      localReceiptConfirmed:localStatus==='confirmed',
      platformVisibleConfirmed:false,
      ownerReceivedConfirmed:ownerConfirmed,
    },
  };
}
export function deliveryOutcome(report,{allowed}){
  return {allowed,...report};
}
