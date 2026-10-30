import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftGenerator} from '../../src/agent-bridge.js';
function host(action='comment'){
 const ids=[],registrations=[],listeners=[],events=new Map();let requests=0,disposed=0,followups=0;
 const ctx={agents:{async create(options){
  // Match the bundled factory/registry contract that the previous fake omitted.
  const session={id:options.sessionId??'session-1'};
  const agent={id:options.sessionId,session,followup(message){assert.equal(message.role,'user');assert.match(message.id,/^[a-f0-9-]{36}$/);assert.equal(message.source.kind,'douyin-fish-automation');assert.ok(Array.isArray(message.content));followups++;},cancel(cause){assert.ok(['user','hook','disposed'].includes(cause.kind));},async whenIdle(){requests++;const config={provider:'deepseek',model:'deepseek-chat',maxTokens:160};assert.equal(await listeners.at(-1)({},()=>config),config);const tool=registrations.at(-1);await tool.execute({text:'老大，小鱼来交作业啦。',...(tool.parameters.properties.action?{action}:{})});}};
  if(agent.id!==session.id)throw Error(`agent id "${agent.id}" does not match session id "${session.id}"`);
  ids.push(options.sessionId);options.setup({tools:{restrict:rules=>assert.deepEqual(rules,{allow:[]}),register:t=>registrations.push(t)},on:(name,fn)=>{listeners.push(fn);events.set(name,fn);}},agent);
  return {agent,dispose:async()=>{disposed++;}};
 }},agentDefaultModel:{currentSelection:()=>({provider:'deepseek',model:'deepseek-chat'})}};
 return {ctx,ids,emit:(name,payload,next)=>events.get(name)?.(payload,next),get disposed(){return disposed;},get requests(){return requests;},get followups(){return followups;},registrations};
}
test('model probe and generation use unique explicit identities matching the actual factory contract',async()=>{
 const h=host(),generate=createDraftGenerator(h.ctx);
 const p=await generate.probe();assert.equal(p.agentIdentityMatched,true);assert.equal(h.requests,0);assert.equal(h.followups,0);assert.equal(h.disposed,1);
 const r=await generate({payload:{},writingRules:{},maxOutputTokens:160},{commit:async text=>({allowed:true,draft:{id:'draft',text}})});
 assert.equal(r.status,'draft_saved');assert.equal(h.requests,1);assert.equal(h.disposed,2);assert.equal(new Set(h.ids).size,2);assert.ok(h.ids.every(id=>/^fish-[a-f0-9-]{36}$/.test(id)));
});
test('a wrongly returned handle is disposed without followup',async()=>{
 let disposed=0,driven=0;
 const ctx={agents:{create:async()=>({agent:{id:'wrong',session:{id:'wrong'},followup(){driven++;}},dispose:async()=>{disposed++;}})},agentDefaultModel:{currentSelection:()=>({provider:'deepseek',model:'deepseek-chat'})}};
 await assert.rejects(createDraftGenerator(ctx).probe(),/identity_mismatch/);assert.equal(disposed,1);assert.equal(driven,0);
});
test('scoped action choices cannot expand into another action or grant tools',async()=>{
 const h=host();let commits=0;
 const generate=createDraftGenerator(h.ctx);
 await assert.rejects(generate({actionChoices:['dm_anyone']},{commit:async()=>{commits++;}}),/Invalid autonomous/);
 assert.equal(h.ids.length,0);assert.equal(commits,0);
});
test('native card and owner mention choices reach only the scoped commit',async()=>{
 for(const action of ['share_card','mention_owner']){
  const h=host(action);let selected;
  const result=await createDraftGenerator(h.ctx)({payload:{},writingRules:{},actionChoices:[action,'skip']},{commit:async(text,choice)=>{selected=choice.action;return {allowed:true,draft:{id:'temporary'}};}});
  assert.equal(result.allowed,true);assert.equal(selected,action);assert.equal(h.requests,1);assert.equal(h.disposed,1);
 }
 const h=host('mention_owner');
 await assert.rejects(createDraftGenerator(h.ctx)({actionChoices:['share_card','skip']},{commit:async()=>assert.fail('unoffered action must not commit')}),/Invalid scoped draft result/);
});
test('host-contained runtime errors remain distinguishable from no model request',async()=>{
 for(const fail of [true,false]){
  const h=host(),create=h.ctx.agents.create;
  h.ctx.agents.create=async options=>{const handle=await create(options);handle.agent.whenIdle=async()=>{if(fail)h.emit('agent/error',{error:Error('runtime unavailable')});};return handle;};
  const call=createDraftGenerator(h.ctx)({payload:{},writingRules:{}},{commit:async()=>assert.fail('must not commit')});
  if(fail)await assert.rejects(call,/DSH_agent_runtime_error: runtime unavailable/);
  else assert.deepEqual(await call,{allowed:false,reason:'model_request_not_started',modelRequests:0});
  assert.equal(h.disposed,1);
 }
});
test('the original provider failure survives a denied retry without exceeding one request',async()=>{
 const h=host(),create=h.ctx.agents.create;
 h.ctx.agents.create=async options=>{const handle=await create(options);
  handle.agent.whenIdle=async()=>{
   await h.emit('agent/request',{},()=>({}));
   h.emit('agent/assistant-stream',{frame:{type:'chunk',chunk:{type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT',message:'DeepSeek Messages transport failed'}}}}});
   try{await h.emit('agent/request',{},()=>assert.fail('retry must not reach provider'));}catch(error){h.emit('agent/error',{error});}
  };return handle;};
 const result=await createDraftGenerator(h.ctx)({payload:{},writingRules:{}},{commit:async()=>assert.fail('must not commit')});
 assert.equal(result.reason,'model_request_failed');assert.equal(result.modelRequests,1);assert.equal(result.failure.code,'TRANSPORT');
});
test('compact DeepSeek account generation disables thinking only for its own session',async()=>{
 const h=host(),selection={provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'low'},create=h.ctx.agents.create;
 h.ctx.agentDefaultModel.currentSelection=()=>selection;
 h.ctx.agents.create=async options=>{assert.equal(options.agentOptions.reasoningEffort,'off');assert.equal(options.agentOptions.maxTokens,160);return create(options);};
 await createDraftGenerator(h.ctx)({payload:{},writingRules:{}},{commit:async()=>({allowed:true,draft:{id:'temporary'}})});
 assert.equal(selection.reasoningEffort,'low');
});
