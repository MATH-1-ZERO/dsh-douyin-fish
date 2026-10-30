import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLikeState} from '../../src/browser/like-state.mjs';
test('visible red heart overrides a lagging unliked marker, but conflicting icons fail closed',()=>{
 const old={e2eState:'video-player-no-digged',visibleSvg:[{computedFill:'rgb(254, 44, 85)'}]};
 assert.equal(classifyLikeState(old),'liked');
 assert.equal(classifyLikeState({...old,visibleSvg:[...old.visibleSvg,{computedFill:'rgb(255, 255, 255)'}]}),'unknown');
});
test('unliked requires white hydrated heart and consistent negative marker',()=>{
 const white={e2eState:'video-player-no-digged',visibleSvg:[{computedFill:'rgb(255, 255, 255)'}]};
 assert.equal(classifyLikeState(white),'unliked');
 assert.equal(classifyLikeState({...white,ariaPressed:'true'}),'unknown');
 assert.equal(classifyLikeState({...white,e2eState:'video-player-digged'}),'unknown');
 for(const fill of ['rgb(0, 0, 0)','none',null])assert.equal(classifyLikeState({...white,visibleSvg:[{computedFill:fill}]}),'unknown');
 assert.equal(classifyLikeState({...white,visibleSvg:[],svg:[{computedFill:'rgb(255, 255, 255)'}]}),'unknown');
 assert.equal(classifyLikeState(null),'unknown');
});
