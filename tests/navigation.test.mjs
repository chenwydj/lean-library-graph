import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NodeNavigation} from '../lean_graph/web/navigation.js';
const a={mode:'declarations',id:'a'}, b={mode:'declarations',id:'b'}, m={mode:'modules',id:'M'};

test('shared back/forward history remembers the last node in each view',()=>{
  const n=new NodeNavigation();
  for(const e of [a,b,m])n.visit(e.mode,e.id);
  assert.deepEqual(n.last,{declarations:'b',modules:'M'});
  assert.deepEqual(n.move(-1,m),b);
  assert.deepEqual(n.move(-1,b),a);
  assert.deepEqual(n.last,{declarations:'a',modules:'M'});
  assert.equal(n.move(-1,a),null);
  assert.deepEqual(n.move(1,a),b);
  assert.deepEqual(n.move(1,b),m);
  assert.equal(n.move(1,m),null);
  assert.equal(n.entries.length,3);
});

test('new visits branch after Back while repeated selections preserve Forward',()=>{
  const n=new NodeNavigation();
  for(const e of [a,b,m])n.visit(e.mode,e.id);
  n.move(-1,m);n.visit(b.mode,b.id);
  assert.equal(n.entries.length,3);
  assert.equal(n.target(1,b),2);
  n.visit('declarations','c');
  assert.deepEqual(n.entries,[a,b,{mode:'declarations',id:'c'}]);
  assert.equal(n.target(1,{mode:'declarations',id:'c'}),null);
});

test('Back from an unselected view returns to the latest visited node',()=>{
  const n=new NodeNavigation();
  assert.equal(n.target(-1,{mode:'modules',id:null}),null);
  n.visit(a.mode,a.id);
  assert.deepEqual(n.move(-1,{mode:'modules',id:null}),a);
  assert.equal(n.target(-1,a),null);
  n.visit(m.mode,m.id);n.visit(a.mode,a.id);
  assert.deepEqual(n.entries,[a,m,a]);
});

test('refresh removes missing nodes from history and per-view memory',()=>{
  const n=new NodeNavigation();
  for(const e of [a,m,b])n.visit(e.mode,e.id);
  n.move(-1,b);
  n.retain(e=>e.id!=='M');
  assert.deepEqual(n.entries,[a,b]);
  assert.equal(n.cursor,0);
  assert.equal(n.last.modules,null);
  assert.deepEqual(n.move(-1,{mode:'modules',id:null}),a);
  assert.deepEqual(n.move(1,a),b);
  n.retain(()=>false);
  assert.equal(n.cursor,-1);
  assert.equal(n.move(-1,b),null);
});
