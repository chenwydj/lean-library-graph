import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupedLayout,moduleLayout} from '../lean_graph/web/layout.js';

test('Archon shelves never overlap groups or put nodes outside their file',()=>{
  const files=Array.from({length:40},(_,i)=>({file:`F${i}.lean`,module:`F${i}`}));
  const declarations=files.flatMap((f,i)=>Array.from({length:i%23+1},(_,j)=>({id:`${i}:${j}`,file:f.file})));
  const layout=groupedLayout(declarations,files,1.7);
  for(const a of layout.groups)for(const b of layout.groups){
    if(a===b)continue;
    assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
  }
  for(const n of layout.nodes){const g=layout.groups.find(g=>g.file===n.d.file);assert.ok(n.x>=g.x&&n.y>=g.y&&n.x+n.w<=g.x+g.w&&n.y+n.h<=g.y+g.h);}
  assert.equal(layout.nodes.length,declarations.length);
});

test('module layout places dependencies first, handles cycles and empty graphs',()=>{
  const nodes=['A','B','C','D','E'].map(id=>({id}));
  const edges=[{from:'C',to:'B'},{from:'B',to:'A'},{from:'D',to:'E'},{from:'E',to:'D'}];
  const result=moduleLayout(nodes,edges),x=Object.fromEntries(result.nodes.map(n=>[n.id,n.x]));
  const y=Object.fromEntries(result.nodes.map(n=>[n.id,n.y]));
  assert.ok((x.A<x.B&&x.B<x.C)||(y.A<y.B&&y.B<y.C));
  assert.equal(result.nodes.length,5);
  assert.ok(result.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  assert.deepEqual(moduleLayout([],[]).nodes,[]);
});

test('folder layout nests actual paths, preserves ownership, and separates sibling boxes',async()=>{
  const {folderModuleLayout}=await import('../lean_graph/web/layout.js');
  const nodes=[{id:'PDE',file:'PDE.lean'},
    {id:'PDE.Heat.A',file:'PDE/Basics/Heat/A.lean'},
    {id:'PDE.Heat.B',file:'PDE/Basics/Heat/B.lean'},
    {id:'Wave',file:'PDE/Basics/Wave/C.lean'},
    {id:'Problem',file:'Problems/Problem.lean'},
    {id:'Mathlib',external:true}];
  const edges=[{from:'PDE',to:'PDE.Heat.A'},{from:'PDE.Heat.A',to:'PDE.Heat.B'},
    {from:'Problem',to:'PDE'},{from:'PDE.Heat.B',to:'Mathlib'}];
  const layout=folderModuleLayout(nodes,edges);
  const inside=(a,b)=>a.x>=b.x&&a.y>=b.y+36&&a.x+a.w<=b.x+b.w&&a.y+a.h<=b.y+b.h;
  const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
  for(const n of layout.nodes){
    const folder=layout.groups.find(g=>g.path===n.folder);
    assert.ok(inside(n,folder),n.id);
    for(const other of layout.nodes)if(n!==other)assert.ok(!overlap(n,other));
  }
  for(const child of layout.groups) {
    if(!child.path)continue;
    const parentPath=child.path.split('/').slice(0,-1).join('/');
    assert.ok(inside(child,layout.groups.find(g=>g.path===parentPath)),child.path);
  }
  for(const a of layout.groups)for(const b of layout.groups) {
    const ancestor=(a,b)=>a.path!==null&&b.path!==null&&(a.path===''||b.path.startsWith(a.path+'/'));
    if(a!==b&&!ancestor(a,b)&&!ancestor(b,a))assert.ok(!overlap(a,b),`${a.path} / ${b.path}`);
  }
  const byId=new Map(layout.nodes.map(n=>[n.id,n]));
  for(const e of edges)assert.ok(byId.get(e.from).x+300<byId.get(e.to).x);
  assert.equal(byId.get('PDE').folder,'');
  assert.equal(byId.get('Mathlib').folder,null);
  assert.equal(layout.groups.find(g=>g.path==='PDE/Basics').count,3);
  assert.deepEqual(folderModuleLayout([...nodes].reverse(),[...edges].reverse()),layout);
});

test('folder layout handles filtered paths, empty inputs, duplicate edges, and cycles',async()=>{
  const {folderModuleLayout}=await import('../lean_graph/web/layout.js');
  assert.deepEqual(folderModuleLayout([],[]).nodes,[]);
  const nodes=[{id:'a',file:'A/Deep/a.lean'},{id:'b',file:'B/b.lean'}];
  const edges=[{from:'a',to:'b'},{from:'b',to:'a'},{from:'a',to:'b'},{from:'a',to:'missing'}];
  const result=folderModuleLayout(nodes,edges);
  assert.ok([...result.nodes,...result.groups].every(n=>[n.x,n.y,n.w,n.h].every(Number.isFinite)));
  const filtered=folderModuleLayout(nodes.slice(0,1),edges);
  assert.deepEqual(filtered.groups.map(g=>g.path),['','A','A/Deep']);
  assert.equal(filtered.nodes.length,1);
  assert.equal(folderModuleLayout([{id:'Mathlib',external:true}],[]).groups.length,1);
});
