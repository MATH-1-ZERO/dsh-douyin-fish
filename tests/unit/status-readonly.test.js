import test from 'node:test';
import assert from 'node:assert/strict';
import {JsonStore} from '../../src/store.js';
import {freshState} from '../../src/engine.js';
import {apply} from '../../src/index.js';

test('fish_status works without state write access and preserves stored history',async t=>{
 const state=freshState(),before=structuredClone(state);
 t.mock.method(JsonStore.prototype,'snapshot',async()=>state);
 t.mock.method(JsonStore.prototype,'transact',async()=>{assert.fail('status must never acquire a write lock');});
 const registered=[];apply({tools:{register:tool=>registered.push(tool)}});
 const result=await registered.find(tool=>tool.name==='fish_status').execute({});
 assert.equal(result.paused,true);assert.equal(result.automaticSendingEnabled,false);
 assert.deepEqual(state,before);
});
