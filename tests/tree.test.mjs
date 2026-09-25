import {test} from 'node:test';
import assert from 'node:assert/strict';
import {treeModel,treeLayout} from '../lean_graph/web/layout.js';
const nodes = ids => ids.map(id=>({id}));
const edges = pairs => pairs.map(([from,to])=>({from,to}));
const visible = layout => layout.nodes.map(n=>n.id).sort();

test('tree starts at roots and unfolds one level at a time',()=>{
  const ns=nodes(['a','b','c','d','isolated']),es=edges([['a','b'],['a','c'],['b','d']]);
  const m=treeModel(ns,es);
  assert.deepEqual(m.roots,['a','isolated']);
  assert.deepEqual(visible(treeLayout(ns,m,new Set())),['a','isolated']);
  assert.deepEqual(visible(treeLayout(ns,m,new Set(['a']))),['a','b','c','isolated']);
  assert.deepEqual(visible(treeLayout(ns,m,new Set(['a','b']))),['a','b','c','d','isolated']);
  assert.deepEqual(visible(treeLayout(ns,m,new Set(['b']))),['a','isolated']);
});

test('shared dependencies survive collapse of another parent without duplication',()=>{
  const ns=nodes(['a','b','c','d']),m=treeModel(ns,edges([['a','c'],['b','c'],['c','d']]));
  const l=treeLayout(ns,m,new Set(['b','c']));
  assert.deepEqual(visible(l),['a','b','c','d']);
  assert.equal(l.nodes.filter(n=>n.id==='c').length,1);
  assert.deepEqual(visible(treeLayout(ns,m,new Set(['c']))),['a','b']);
});

test('source cycles have deterministic entry nodes; downstream cycles are not extra roots',()=>{
  const ns=nodes(['z','y','a','b','c','d']),es=edges([['z','y'],['y','z'],['z','a'],['a','b'],['b','a'],['c','d'],['d','d']]);
  const m=treeModel(ns,es);
  assert.deepEqual(m.roots,['c','y']);
  assert.deepEqual([...m.cycleRoots],['y']);
  assert.deepEqual(visible(treeLayout(ns,m,new Set(ns.map(n=>n.id)))),['a','b','c','d','y','z']);
  assert.deepEqual(treeModel([...ns].reverse(),[...es].reverse()).roots,m.roots);
});

test('pins and navigation targets remain visible through folded branches',()=>{
  const ns=nodes(['a','b','c']),m=treeModel(ns,edges([['a','b'],['b','c']]));
  assert.deepEqual(visible(treeLayout(ns,m,new Set(),new Set(['c','missing']))),['a','c']);
  // Removed/excluded/filtered nodes are not resurrected by forced visibility.
  const subset=ns.slice(1),filtered=treeModel(subset,edges([['a','b'],['b','c']]));
  assert.deepEqual(filtered.roots,['b']);
  assert.deepEqual(visible(treeLayout(subset,filtered,new Set(),new Set(['a']))),['b']);
});

test('top-down tree geometry stays non-overlapping, centered, and inside bounds',()=>{
  const ns=nodes(['a','b','c','d','e','f']),es=edges([['a','b'],['a','c'],['b','d'],['b','e'],['c','f']]);
  const l=treeLayout(ns,treeModel(ns,es),new Set(ns.map(n=>n.id))),map=new Map(l.nodes.map(n=>[n.id,n]));
  for(const e of es)assert.ok(map.get(e.from).y+map.get(e.from).h<map.get(e.to).y);
  for(const a of l.nodes){
    assert.ok(a.x>=0&&a.y>=0&&a.x+a.w<=l.w&&a.y+a.h<=l.h);
    for(const b of l.nodes)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
  }
  assert.equal(l.vertical,true);
});

test('empty, duplicate edges, self loops, and deep chains are safe',()=>{
  assert.deepEqual(treeLayout([],treeModel([],[]),new Set()).nodes,[]);
  const one=treeModel(nodes(['a']),edges([['a','a'],['a','a'],['a','missing']]));
  assert.deepEqual(one.out.get('a'),['a']);assert.ok(one.cycleRoots.has('a'));
  const ns=nodes(Array.from({length:15000},(_,i)=>String(i))),es=ns.slice(1).map((n,i)=>({from:ns[i].id,to:n.id}));
  const m=treeModel(ns,es),l=treeLayout(ns,m,new Set(ns.map(n=>n.id)));
  assert.deepEqual(m.roots,['0']);assert.equal(l.nodes.length,ns.length);
});

test('independent root trees wrap without overlap and preserve top-down branches',()=>{
  const ns=nodes(Array.from({length:80},(_,i)=>String(i)));
  const es=edges(Array.from({length:40},(_,i)=>[String(i),String(i+40)]));
  const l=treeLayout(ns,treeModel(ns,es),new Set(ns.map(n=>n.id)),new Set(),1);
  assert.ok(new Set(l.nodes.filter(n=>n.treeRoot).map(n=>n.y)).size>1);
  for(const a of l.nodes)for(const b of l.nodes)if(a!==b)
    assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
});

import {exploreTreeLayout} from '../lean_graph/web/layout.js';
const explore=(ns,es,seeds,children=[],parents=[])=>exploreTreeLayout(ns,es,treeModel(ns,es),new Set(seeds),new Set(children),new Set(parents));
test('explorer is empty without starting nodes and does not apply an implicit 200-node cap',()=>{
  const ns=nodes(Array.from({length:250},(_,i)=>String(i)));
  assert.equal(explore(ns,[],[]).nodes.length,0);
  assert.equal(explore(ns,[],ns.map(n=>n.id)).nodes.length,250);
});
test('search seeds can unfold full-library children and parents independently',()=>{
  const ns=nodes(['parent','seed','child','grandchild','sibling']),es=edges([['parent','seed'],['parent','sibling'],['seed','child'],['child','grandchild']]);
  assert.deepEqual(visible(explore(ns,es,['seed'])),['seed']);
  assert.deepEqual(visible(explore(ns,es,['seed'],['seed'])),['child','seed']);
  assert.deepEqual(visible(explore(ns,es,['seed'],[],['seed'])),['parent','seed']);
  assert.deepEqual(visible(explore(ns,es,['seed'],['seed'],['seed'])),['child','parent','seed']);
  assert.deepEqual(visible(explore(ns,es,['seed'],['seed','child'],['seed'])),['child','grandchild','parent','seed']);
});
test('parents are above starts and children below, including shared dependency paths',()=>{
  const ns=nodes(['a','b','s','c','d']),es=edges([['a','s'],['b','s'],['s','c'],['s','d'],['c','d']]);
  const l=explore(ns,es,['s'],['s','c'],['s']),map=new Map(l.nodes.map(n=>[n.id,n]));
  for(const e of es)assert.ok(map.get(e.from).y+map.get(e.from).h<map.get(e.to).y);
  assert.equal(l.nodes.filter(n=>n.id==='s').length,1);
});
test('collapse recomputes reachability; separate seeds/pins and shared paths survive',()=>{
  const ns=nodes(['a','b','shared','leaf']),es=edges([['a','shared'],['b','shared'],['shared','leaf']]);
  assert.deepEqual(visible(explore(ns,es,['a','b'],['b','shared'])),['a','b','leaf','shared']);
  assert.deepEqual(visible(explore(ns,es,['a','b'],['shared'])),['a','b']);
  assert.deepEqual(visible(explore(ns,es,['a','leaf'])),['a','leaf']);
});
test('exploration excludes missing nodes and terminates bidirectional cycles',()=>{
  const ns=nodes(['a','b']),es=edges([['a','b'],['b','a'],['a','excluded']]);
  const l=explore(ns,es,['a','excluded'],['a','b'],['a','b']);
  assert.deepEqual(visible(l),['a','b']);
  assert.ok(l.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
});

test('temporary hidden nodes stay suppressed until explicitly restored, without altering seeds',()=>{
  const ns=nodes(['a','b','c']),es=edges([['a','b'],['b','c']]),m=treeModel(ns,es);
  const seeds=new Set(['a']),open=new Set(['a','b']),hidden=new Set(['b']);
  assert.deepEqual(visible(exploreTreeLayout(ns,es,m,seeds,open,new Set(),hidden)),['a']);
  hidden.delete('b');
  assert.deepEqual(visible(exploreTreeLayout(ns,es,m,seeds,open,new Set(),hidden)),['a','b','c']);
  assert.deepEqual([...seeds],['a']);
});

import {updateDisclosure} from '../lean_graph/web/pins.js';
test('file seed parents can fold and unfold independently of child expansion',()=>{
  const ns=nodes(['parent','selected','child']),es=edges([['parent','selected'],['selected','child']]);
  const m=treeModel(ns,es),seeds=new Set(ns.map(n=>n.id)),children=new Set(['selected']);
  const closed=updateDisclosure({id:'selected',neighbors:['parent'],expanded:new Set(),hidden:new Set(),shown:new Set(seeds),seeds,pins:new Set()});
  assert.deepEqual(visible(exploreTreeLayout(ns,es,m,seeds,children,closed.expanded,closed.hidden)),['child','selected']);
  const opened=updateDisclosure({id:'selected',neighbors:['parent'],expanded:closed.expanded,hidden:closed.hidden,shown:new Set(['child','selected']),seeds,pins:new Set()});
  assert.deepEqual(visible(exploreTreeLayout(ns,es,m,seeds,children,opened.expanded,opened.hidden)),['child','parent','selected']);
  assert.deepEqual([...children],['selected']);
});

test('expanding an already open branch restores a temporarily hidden neighbor',()=>{
  const result=updateDisclosure({id:'a',neighbors:['b'],expanded:new Set(['a']),hidden:new Set(['b']),shown:new Set(['a']),seeds:new Set(['a']),pins:new Set()});
  assert.equal(result.hidden.has('b'),false);
  assert.equal(result.expanded.has('a'),true);
});

test('folding preserves pinned neighbors and never hides the clicked node in a cycle',()=>{
  const result=updateDisclosure({id:'a',neighbors:['a','b'],expanded:new Set(),hidden:new Set(),shown:new Set(['a','b']),seeds:new Set(['a','b']),pins:new Set(['b'])});
  assert.equal(result.hidden.size,0);
});
