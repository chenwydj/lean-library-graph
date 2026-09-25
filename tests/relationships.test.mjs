import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moduleRelationships, selectionEdges} from '../lean_graph/web/relationships.js';

test('umbrella imports retain explicit paths and add direct detailed module use',()=>{
  const imports=[{from:'Client',to:'PDE'},{from:'PDE',to:'Deep'}];
  const decls=[{id:'proof',module:'Client'},{id:'lemma',module:'Deep'},{id:'helper',module:'Client'}];
  const edges=moduleRelationships(imports,decls,[
    {from:'proof',to:'lemma'},{from:'helper',to:'lemma'},
    {from:'proof',to:'lemma'},{from:'proof',to:'helper'},{from:'proof',to:'unknown'},
  ]);
  assert.deepEqual(edges,[
    {from:'Client',to:'PDE',explicit:true,referenceCount:0},
    {from:'PDE',to:'Deep',explicit:true,referenceCount:0},
    {from:'Client',to:'Deep',explicit:false,referenceCount:2},
  ]);
  assert.equal(imports[0].explicit,undefined);
});

test('references coinciding with explicit imports merge into a single solid edge',()=>{
  const edges=moduleRelationships([{from:'A',to:'B'},{from:'A',to:'B'}],
    [{id:'a',module:'A'},{id:'b',module:'B'}],[{from:'a',to:'b'}]);
  assert.deepEqual(edges,[{from:'A',to:'B',explicit:true,referenceCount:1}]);
});

const edge=(from,to)=>({from,to});
test('selection follows full dependency and user paths without unrelated branches',()=>{
  const edges=[edge('s','a'),edge('a','root'),edge('s','b'),edge('b','c'),edge('c','root'),
    edge('user','s'),edge('user','unrelated'),edge('granduser','user'),edge('elsewhere','root')];
  assert.deepEqual([...selectionEdges(edges,'s')].sort((a,b)=>edges.indexOf(a)-edges.indexOf(b)),[...edges.slice(0,6),edges[7]]);
  assert.equal(selectionEdges(edges,null).size,0);
});

test('selecting HeatKernelND includes the user chain through HeatMaximumPrincipleND to PDE',()=>{
  const edges=[edge('PDE','HeatMaximumPrincipleND'),edge('HeatMaximumPrincipleND','HeatKernelND'),
    edge('PDE','Unrelated'),edge('HeatKernelND','Base'),edge('Other','Base')];
  const selected=selectionEdges(edges,'HeatKernelND');
  assert.deepEqual(edges.filter(e=>selected.has(e)),[edges[0],edges[1],edges[3]]);
  // A filtered-out intermediate module must not invent an edge to PDE.
  assert.equal(selectionEdges([edges[2],edges[3],edges[4]],'HeatKernelND').size,1);
});

test('visible boundaries stop traversal and cycles terminate',()=>{
  const edges=[edge('s','a'),edge('a','b'),edge('b','a'),edge('hidden','root')];
  const visible=edges.filter(e=>e.from!=='hidden');
  assert.equal(selectionEdges(visible,'s').size,3);
  assert.equal(selectionEdges(visible,'b').size,3);
  assert.equal(selectionEdges([edge('a','root')],'s').size,0);
});

test('deep dependency chains do not exhaust the call stack',()=>{
  const edges=Array.from({length:20000},(_,i)=>edge(String(i),String(i+1)));
  assert.equal(selectionEdges(edges,'0').size,20000);
  assert.equal(selectionEdges(edges,'20000').size,20000);
});

test('edge distance uses shortest directed paths on both sides of the selection',async()=>{
  const {selectionEdgeDistances}=await import('../lean_graph/web/relationships.js');
  const edges=[edge('s','a'),edge('a','b'),edge('b','c'),
    edge('u','s'),edge('v','u'),edge('w','v'),edge('u','unrelated'),edge('other','a')];
  const distances=selectionEdgeDistances(edges,'s');
  assert.deepEqual(edges.map(e=>distances.get(e)),[1,2,3,1,2,3,undefined,undefined]);
  assert.equal(selectionEdgeDistances(edges,null).size,0);
});

test('shortcuts, cycles, and reversed edge order keep nearest-edge distance stable',async()=>{
  const {selectionEdgeDistances}=await import('../lean_graph/web/relationships.js');
  const edges=[edge('s','a'),edge('a','b'),edge('b','c'),edge('s','c'),edge('c','s')];
  const d=selectionEdgeDistances(edges,'s'), reversed=selectionEdgeDistances([...edges].reverse(),'s');
  assert.deepEqual(edges.map(e=>d.get(e)),[1,2,2,1,1]);
  assert.deepEqual(edges.map(e=>d.get(e)),edges.map(e=>reversed.get(e)));
  assert.equal(selectionEdgeDistances([edges[1],edges[2]],'s').size,0);
});

test('arrow emphasis becomes lighter and thinner with distance and stays visible',async()=>{
  const {arrowEmphasis}=await import('../lean_graph/web/relationships.js');
  let previous=arrowEmphasis(1);
  assert.equal(previous.width,5.5);
  assert.equal(previous.color,'rgb(12, 53, 138)');
  for(const distance of [2,3,4,8,20,20000]){
    const style=arrowEmphasis(distance);
    assert.ok(style.width<previous.width&&style.width>=.65);
    const rgb=style.color.match(/\d+/g).map(Number), prev=previous.color.match(/\d+/g).map(Number);
    assert.ok(rgb.every((v,i)=>v>=prev[i]&&v<=255));
    previous=style;
  }
});
