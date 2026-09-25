import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinKey, restorePins, visibleWithPins, updateVisiblePins} from '../lean_graph/web/pins.js';

const nodes = ['a','b','c','d'].map(id => ({id, file:'A.lean', kind:'def', fullName:id}));
const scores = new Map([['a',4],['b',3],['c',2],['d',0]]);
test('Pin all pins only the rendered snapshot, not newly revealed nodes', () => {
  const before = visibleWithPins(nodes,nodes,new Set(),scores,{limit:2});
  const pins = updateVisiblePins(new Set(),new Set(before.nodes.map(n=>n.id)),true);
  assert.deepEqual([...pins],['a','b']);
  const after = visibleWithPins(nodes,nodes,pins,scores,{limit:2});
  assert.equal(after.nodes.length,4);
  assert.equal(after.pinnedCount,2);
});
test('Unpin all preserves pins outside the rendered snapshot and other views', () => {
  const pins = new Set(['a','c']);
  const otherView = new Set(['module']);
  const result = updateVisiblePins(pins,new Set(['a','b']),false);
  assert.deepEqual([...result],['c']);
  assert.deepEqual([...pins],['a','c']);
  assert.deepEqual([...otherView],['module']);
  assert.deepEqual([...updateVisiblePins(pins,new Set(),false)],['a','c']);
});
test('all pins survive filtered candidates, score thresholds and a smaller node cap', () => {
  const pins = new Set(['c','d']);
  const result = visibleWithPins(nodes.slice(0,2),nodes,pins,scores,{minimum:3,limit:1});
  assert.deepEqual(result.nodes.map(n=>n.id), ['c','d','a']);
  assert.equal(result.pinnedCount,2);
  assert.equal(result.eligible,4);
  assert.deepEqual(visibleWithPins([],nodes,pins,scores,{minimum:999,limit:1}).nodes.map(n=>n.id),['c','d']);
});
test('pins are not duplicated and unpinning restores ordinary filtering', () => {
  assert.equal(visibleWithPins(nodes,nodes,new Set(['a']),scores,{limit:0}).nodes.length,4);
  assert.deepEqual(visibleWithPins(nodes,nodes,new Set(),scores,{limit:1}).nodes.map(n=>n.id),['a']);
  assert.equal(visibleWithPins([],nodes,new Set(),scores,{limit:1}).nodes.length,0);
});
test('saved pins follow line shifts and discard missing or ambiguous declarations', () => {
  const keys = [pinKey(nodes[0]),pinKey(nodes[1])];
  const shifted = {...nodes[0],id:'A.lean:99:a'};
  assert.deepEqual([...restorePins(keys,[shifted,nodes[2]])],['A.lean:99:a']);
  assert.equal(restorePins(keys,[shifted,{...shifted,id:'duplicate'}]).size,0);
});
test('module and declaration pins cannot collide', () => {
  const module = {id:'a',kind:'module',file:'A.lean',fullName:'a'};
  assert.notEqual(pinKey(module),pinKey(nodes[0]));
  assert.deepEqual([...restorePins([pinKey(module)],[module])],['a']);
  assert.equal(restorePins([pinKey(nodes[0])],[module]).size,0);
});

test('pin and exclusion policies are mutually exclusive for individual and bulk actions',async()=>{
  const {updateNodePolicy}=await import('../lean_graph/web/pins.js');
  const originalPins=new Set(['a','b']),originalExcluded=new Set(['c']);
  let result=updateNodePolicy(originalPins,originalExcluded,['a'],'exclude',true);
  assert.deepEqual([...result.pins],['b']);assert.deepEqual([...result.excluded],['c','a']);
  result=updateNodePolicy(result.pins,result.excluded,['a'],'pin',true);
  assert.ok(result.pins.has('a'));assert.ok(!result.excluded.has('a'));
  result=updateNodePolicy(result.pins,result.excluded,['a','b'],'exclude',true);
  assert.equal(result.pins.size,0);assert.equal(result.excluded.size,3);
  result=updateNodePolicy(result.pins,result.excluded,result.excluded,'exclude',false);
  assert.equal(result.excluded.size,0);assert.equal(result.pins.size,0);
  assert.deepEqual([...originalPins],['a','b']);assert.deepEqual([...originalExcluded],['c']);
});

test('excluded nodes bypass neither focus nor pins and do not consume visible slots',()=>{
  const nodes=['a','b','c','d'].map(id=>({id}));
  const scores=new Map([['a',10],['b',9],['c',8],['d',7]]);
  const result=visibleWithPins(nodes,nodes,new Set(['a']),scores,
    {excludedIds:new Set(['a','b']),focusId:'a',limit:1});
  assert.deepEqual(result.nodes.map(n=>n.id),['c']);assert.equal(result.pinnedCount,0);
  assert.equal(result.eligible,2);
  const empty=visibleWithPins(nodes,nodes,new Set(),scores,{excludedIds:new Set(nodes.map(n=>n.id)),limit:0});
  assert.equal(empty.nodes.length,0);
});
