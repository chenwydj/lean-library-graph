import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContext,scoreNodes,rankAndFilter} from '../lean_graph/web/importance.js';

const nodes=[{id:'a',file:'A.lean'},{id:'b',file:'B.lean'},{id:'c',file:'B.lean'},{id:'d',file:'D.lean'}];
const edges=[{from:'b',to:'a'},{from:'c',to:'a'},{from:'d',to:'b'},{from:'d',to:'c'},{from:'b',to:'a'}];
test('reuse metrics use distinct users and files over the full graph',()=>{
  const c=createContext(nodes,edges);
  assert.equal(scoreNodes(c,'direct-users').get('a'),2);
  assert.equal(scoreNodes(c,'cross-file-users').get('a'),1);
  assert.equal(scoreNodes(c,'transitive-users').get('a'),3);
  const filtered=rankAndFilter(nodes.slice(0,2),scoreNodes(c,'direct-users'),{limit:1});
  assert.deepEqual(filtered.nodes.map(n=>n.id),['a']);
  assert.equal(filtered.eligible,2);
});
test('cycles terminate and do not count the node itself',()=>{
  const c=createContext(nodes,[...edges,{from:'a',to:'d'},{from:'a',to:'a'}]);
  assert.equal(scoreNodes(c,'transitive-users').get('a'),3);
});
test('thresholds, limits, deterministic ties, and focused nodes',()=>{
  const scores=scoreNodes(createContext(nodes,edges),'direct-users');
  assert.deepEqual(rankAndFilter(nodes,scores,{minimum:2,limit:0}).nodes.map(n=>n.id),['a']);
  assert.deepEqual(rankAndFilter(nodes,scores,{limit:2}).nodes.map(n=>n.id),['a','b']);
  assert.deepEqual(rankAndFilter(nodes,scores,{minimum:2,limit:1,focusId:'d'}).nodes.map(n=>n.id),['d']);
});
test('custom metric needs no changes to ranking or UI',()=>{
  const registry=[{id:'custom',score:(n,c)=>2*c.incoming.get(n.id).size+c.outgoing.get(n.id).size}];
  const scores=scoreNodes(createContext(nodes,edges),'custom',registry);
  assert.equal(scores.get('a'),4);
  assert.throws(()=>scoreNodes(createContext(nodes,edges),'bad'));
});
