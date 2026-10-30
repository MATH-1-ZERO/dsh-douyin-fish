import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedProfileName} from '../../src/owner-dm.js';
const profile='https://www.douyin.com/user/verified_owner_123',handle='owner_123';
const page={ready:true,url:profile,title:'',labels:['抖音号：'+handle],profileNames:['老大']};
test('owner DM accepts an exact profile and unique handle/name when document title stays empty',()=>{
 assert.equal(verifiedProfileName(page,profile,handle),'老大');
 for(const changed of [{url:profile+'other'},{labels:['抖音号：other']},{labels:[...page.labels,...page.labels]},{profileNames:['老大','另一个人']},{title:'另一个人的抖音'},{ready:false}])assert.equal(verifiedProfileName({...page,...changed},profile,handle),null);
});
