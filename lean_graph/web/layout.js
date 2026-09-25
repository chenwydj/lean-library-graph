/* Adapted from Archon ProofGraph.tsx, commit 3fe2618870808d8c20912ab8b5aff80af275a1de.
 * Apache-2.0. Modified: framework-independent layout; indexed groups; no agent state.
 * Keep Archon's top-aligned shortest-column shelves and inner node columns.
 */
export function groupedLayout(declarations, files, aspect = 2.5) {
  const NW = 220, NH = 48, GP = 12, NX = 12, NY = 12, GH = 36, CX = 24, RY = 26;
  const byFile = new Map();
  for (const d of declarations) {
    if (!byFile.has(d.file)) byFile.set(d.file, []);
    byFile.get(d.file).push(d);
  }
  const sized = files.filter(f => byFile.has(f.file)).map((f, ci) => {
    const ds = byFile.get(f.file), ic = ds.length > 14 ? 3 : ds.length > 6 ? 2 : 1;
    const rows = Math.ceil(ds.length / ic);
    return { file: f.file, label: f.module, ds, ic, rows, ci,
      w: ic * NW + (ic - 1) * NX + GP * 2, h: GH + rows * (NH + NY) - NY + GP };
  });
  if (!sized.length) return { nodes: [], groups: [], w: 800, h: 500 };
  const widest = Math.max(...sized.map(g => g.w));
  const avgW = sized.reduce((s, g) => s + g.w, 0) / sized.length;
  const area = sized.reduce((s, g) => s + g.w * g.h, 0);
  const columns = Math.max(1, Math.min(sized.length, Math.round(Math.max(widest, Math.sqrt(area * aspect)) / (avgW + CX))));
  const bottoms = Array(columns).fill(RY), widths = Array(columns).fill(0), placements = [];
  for (const g of sized) {
    let col = 0;
    for (let c = 1; c < columns; c++) if (bottoms[c] < bottoms[col] - 0.5) col = c;
    placements.push({ g, col, y: bottoms[col] });
    bottoms[col] += g.h + RY;
    widths[col] = Math.max(widths[col], g.w);
  }
  const xs = [CX];
  for (let c = 1; c < columns; c++) xs[c] = xs[c - 1] + widths[c - 1] + CX;
  const nodes = [], groups = [];
  for (const {g, col, y} of placements) {
    const x = xs[col];
    g.ds.forEach((d, i) => nodes.push({ id: d.id, d,
      x: x + GP + Math.floor(i / g.rows) * (NW + NX), y: y + GH + (i % g.rows) * (NH + NY), w: NW, h: NH }));
    groups.push({ file: g.file, label: g.label, ci: g.ci, x, y, w: g.w, h: g.h });
  }
  return { nodes, groups, w: Math.max(...groups.map(g => g.x + g.w)) + CX,
    h: Math.max(...groups.map(g => g.y + g.h)) + RY };
}

// Layer dependencies before their users. Kahn traversal is iterative, so deep
// import chains don't exhaust the JavaScript call stack. Cycles get a last layer.
export function moduleLayout(modules, edges, aspect = 2.5) {
  const map = new Map(modules.map(m => [m.id, m]));
  const pending = new Map(modules.map(m => [m.id, 0])), users = new Map(), level = new Map();
  for (const e of edges) {
    if (!map.has(e.from) || !map.has(e.to)) continue;
    pending.set(e.from, pending.get(e.from) + 1);
    if (!users.has(e.to)) users.set(e.to, []);
    users.get(e.to).push(e.from);
  }
  const queue = modules.filter(m => pending.get(m.id) === 0).map(m => m.id);
  queue.forEach(id => level.set(id, 0));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const user of users.get(id) || []) {
      level.set(user, Math.max(level.get(user) || 0, level.get(id) + 1));
      pending.set(user, pending.get(user) - 1);
      if (pending.get(user) === 0) queue.push(user);
    }
  }
  const last = Math.max(0, ...level.values()) + 1;
  const rows = new Map();
  const nodes = modules.map(d => {
    const l = pending.get(d.id) ? last : level.get(d.id) || 0, row = rows.get(l) || 0;
    rows.set(l, row + 1);
    return { id: d.id, d, x: 30 + l * 360, y: 30 + row * 90, w: 300, h: 64 };
  });
  const horizontal = { nodes, groups: [], w: Math.max(400, ...nodes.map(n => n.x + n.w + 30)),
    h: Math.max(200, ...nodes.map(n => n.y + n.h + 30)) };
  const verticalNodes = nodes.map(n => ({...n, x: 30 + (n.y - 30) / 90 * 340, y: 30 + (n.x - 30) / 360 * 120}));
  const vertical = { nodes: verticalNodes, groups: [], vertical: true,
    w: Math.max(400, ...verticalNodes.map(n => n.x + n.w + 30)),
    h: Math.max(200, ...verticalNodes.map(n => n.y + n.h + 30)) };
  // Orient long import chains to use the available viewport more effectively.
  return Math.max(vertical.w / aspect, vertical.h) < Math.max(horizontal.w / aspect, horizontal.h) ? vertical : horizontal;
}

// Nested folder lanes preserve actual source ownership while global dependency
// stages align chains left to right (user -> dependency). Each sibling folder
// occupies its own vertical band, so folder boxes cannot overlap accidentally.
export function folderModuleLayout(modules, edges) {
  if (!modules.length) return {nodes:[], groups:[], w:800, h:500};
  const NW=300, NH=64, STEP=360, PAD=22, HEADER=36, GAP=24, ROW=86;
  const map=new Map(modules.map(d=>[d.id,d]));
  const outgoing=new Map(modules.map(d=>[d.id,new Set()]));
  const incoming=new Map(modules.map(d=>[d.id,0])), rank=new Map();
  for(const e of edges) {
    if(e.from===e.to||!map.has(e.from)||!map.has(e.to)||outgoing.get(e.from).has(e.to))continue;
    outgoing.get(e.from).add(e.to);incoming.set(e.to,incoming.get(e.to)+1);
  }
  const queue=modules.filter(d=>incoming.get(d.id)===0).map(d=>d.id).sort();
  queue.forEach(id=>rank.set(id,0));
  for(let i=0;i<queue.length;i++)for(const to of outgoing.get(queue[i])) {
    rank.set(to,Math.max(rank.get(to)||0,rank.get(queue[i])+1));
    incoming.set(to,incoming.get(to)-1);
    if(incoming.get(to)===0)queue.push(to);
  }
  // Cycles cannot have a strict directional order. Keep unresolved nodes finite
  // and deterministic in a final stage, as in the dependency-layer layout.
  const last=Math.max(0,...rank.values())+1;
  for(const d of modules)if(incoming.get(d.id)>0)rank.set(d.id,last);
  const folder=(path,label,depth)=>({path,label,depth,children:new Map(),direct:[]});
  const root=folder('', 'Repository root', 0), external=folder(null,'External imports',0);
  for(const d of modules) {
    if(d.external){external.direct.push(d);continue;}
    let current=root, path='';
    const parts=(d.file||'').split('/').slice(0,-1).filter(Boolean);
    for(const part of parts) {
      path=path?`${path}/${part}`:part;
      if(!current.children.has(part))current.children.set(part,folder(path,part,current.depth+1));
      current=current.children.get(part);
    }
    current.direct.push(d);
  }
  // Order sibling lanes by earliest dependency stage, then path, independently
  // of importance ranking and pin insertion order.
  function prepare(f) {
    const children=[...f.children.values()];children.forEach(prepare);
    f.count=f.direct.length+children.reduce((sum,c)=>sum+c.count,0);
    f.stage=Math.min(...f.direct.map(d=>rank.get(d.id)),...children.map(c=>c.stage));
    f.ordered=children.sort((a,b)=>a.stage-b.stage||a.path.localeCompare(b.path));
    f.direct.sort((a,b)=>rank.get(a.id)-rank.get(b.id)||a.id.localeCompare(b.id));
  }
  prepare(root);prepare(external);
  const nodes=[], groups=[];
  function place(f,y) {
    const g={kind:'folder',path:f.path,label:f.label,depth:f.depth,count:f.count,y};
    groups.push(g); // Parent backgrounds must paint before child backgrounds.
    const rows=new Map(), contents=[];
    for(const d of f.direct) {
      const stage=rank.get(d.id), row=rows.get(stage)||0;rows.set(stage,row+1);
      const n={id:d.id,d,x:stage*STEP,y:y+HEADER+row*ROW,w:NW,h:NH,folder:f.path};
      nodes.push(n);contents.push(n);
    }
    const directHeight=rows.size?(Math.max(...rows.values())-1)*ROW+NH:0;
    let cursor=y+HEADER+directHeight+(directHeight&&f.ordered.length?GAP:0);
    for(const child of f.ordered) {
      const box=place(child,cursor);contents.push(box);cursor=box.y+box.h+GAP;
    }
    const bottom=f.ordered.length?cursor-GAP:y+HEADER+directHeight;
    g.x=Math.min(...contents.map(c=>c.x))-PAD;
    g.w=Math.max(...contents.map(c=>c.x+c.w))-g.x+PAD;
    g.h=bottom-y+PAD;
    return g;
  }
  let bottom=0;
  if(root.count){const g=place(root,0);bottom=g.h+GAP;}
  if(external.count)place(external,bottom);
  const shift=30-Math.min(...groups.map(g=>g.x));
  for(const box of [...groups,...nodes]){box.x+=shift;box.y+=30;}
  return {nodes,groups,w:Math.max(...groups.map(g=>g.x+g.w))+30,
    h:Math.max(...groups.map(g=>g.y+g.h))+30};
}

// Build a directed mind-map model from the filtered graph. Source strongly
// connected components supply roots, so cycles never hide an entire component.
// A cycle uses a deterministic representative rather than inventing a real root.
export function treeModel(nodes, edges) {
  const ids = nodes.map(n => n.id).sort(), allowed = new Set(ids);
  const out = new Map(ids.map(id => [id, new Set()]));
  const incoming = new Map(ids.map(id => [id, new Set()]));
  for (const {from, to} of edges) if (allowed.has(from) && allowed.has(to)) {
    out.get(from).add(to); incoming.get(to).add(from);
  }
  for (const [id, children] of out) out.set(id, [...children].sort());
  const seen = new Set(), finish = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const stack = [[id, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1], children = out.get(frame[0]);
      if (frame[1] === children.length) { finish.push(frame[0]); stack.pop(); continue; }
      const child = children[frame[1]++];
      if (!seen.has(child)) { seen.add(child); stack.push([child, 0]); }
    }
  }
  const component = new Map(), components = [];
  for (const id of finish.reverse()) {
    if (component.has(id)) continue;
    const index = components.length, members = [], pending = [id];
    component.set(id, index);
    for (let i = 0; i < pending.length; i++) {
      const next = pending[i]; members.push(next);
      for (const parent of incoming.get(next)) if (!component.has(parent)) {
        component.set(parent, index); pending.push(parent);
      }
    }
    components.push(members.sort());
  }
  const nonRoots = new Set();
  for (const [from, children] of out) for (const to of children) {
    if (component.get(from) !== component.get(to)) nonRoots.add(component.get(to));
  }
  const roots = [], cycleRoots = new Set();
  components.forEach((members, i) => {
    if (nonRoots.has(i)) return;
    roots.push(members[0]);
    if (members.length > 1 || out.get(members[0]).includes(members[0])) cycleRoots.add(members[0]);
  });
  return {roots: roots.sort(), cycleRoots, out, incoming: new Map([...incoming].map(([id, users])=>[id,[...users].sort()])), component, components};
}

// Reveal actual outgoing neighbors only from expanded nodes. Shared children
// stay visible while ANY open path reaches them. The first BFS parent determines
// placement; all visible graph edges remain available to the renderer.
export function treeLayout(nodes, model, expanded, forced = new Set(), aspect = 2.5) {
  const map = new Map(nodes.map(n => [n.id, n]));
  const roots = [...new Set([...model.roots, ...forced].filter(id => map.has(id)))];
  const order = [...roots], seen = new Set(roots), children = new Map();
  for (let i = 0; i < order.length; i++) {
    const id = order[i]; children.set(id, []);
    if (!expanded.has(id)) continue;
    for (const child of model.out.get(id) || []) {
      if (seen.has(child)) continue;
      seen.add(child); order.push(child); children.get(id).push(child);
    }
  }
  const NW = 300, NH = 96, GAP = 30, STEP = 156, PAD = 36;
  const widths = new Map(), heights = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], cs = children.get(id);
    heights.set(id, NH + (cs.length ? STEP - NH + Math.max(...cs.map(c => heights.get(c))) : 0));
    widths.set(id, Math.max(NW, cs.reduce((sum, c) => sum + widths.get(c), 0) + Math.max(0, cs.length - 1) * GAP));
  }
  // Separate root trees wrap into rows, avoiding a single unreadably wide strip
  // when a filtered library has many independent entry points.
  const left = new Map(), top = new Map();
  const area = roots.reduce((sum,id) => sum + (widths.get(id)+GAP)*(heights.get(id)+80),0);
  const target = Math.max(NW, ...roots.map(id=>widths.get(id)), Math.sqrt(area*Math.max(.2,aspect)));
  let cursor = PAD, rowY = PAD + 22, rowHeight = 0, width = 400;
  for (const id of roots) {
    if(cursor>PAD && cursor+widths.get(id)>target+PAD) { cursor=PAD;rowY+=rowHeight+80;rowHeight=0; }
    left.set(id,cursor);top.set(id,rowY);cursor+=widths.get(id)+GAP;
    rowHeight=Math.max(rowHeight,heights.get(id));width=Math.max(width,cursor-GAP+PAD);
  }
  const placed = [], rootSet = new Set(model.roots); let height = 200;
  for (const id of order) {
    const x = left.get(id) + (widths.get(id) - NW) / 2, y = top.get(id);
    placed.push({id, d:map.get(id), x, y, w:NW, h:NH, treeRoot:rootSet.has(id), cycleRoot:model.cycleRoots.has(id)});
    height = Math.max(height, y + NH + PAD);
    let childLeft = left.get(id);
    for (const child of children.get(id)) { left.set(child, childLeft);top.set(child,y+STEP);childLeft+=widths.get(child)+GAP; }
  }
  return {nodes:placed, groups:[], vertical:true, tree:true, w:width, h:height};
}

// Search and file matches are starting points, not boundaries on exploration.
// Parent and child disclosures are independent. Recompute reachability from
// seeds on collapse so shared paths survive but detached branches disappear.
export function exploreTreeLayout(nodes, edges, model, seeds, childrenOpen, parentsOpen, hidden = new Set()) {
  const map = new Map(nodes.map(n=>[n.id,n]));
  const pending = [...new Set([...seeds].filter(id=>map.has(id)&&!hidden.has(id)))], shown = new Set(pending);
  for(let i=0;i<pending.length;i++) {
    const id=pending[i];
    for(const [open,index] of [[childrenOpen,model.out],[parentsOpen,model.incoming]]) {
      if(!open.has(id))continue;
      for(const next of index.get(id)||[])if(map.has(next)&&!hidden.has(next)&&!shown.has(next)) {shown.add(next);pending.push(next);}
    }
  }
  const visibleEdges=edges.filter(e=>shown.has(e.from)&&shown.has(e.to));
  const visibleNodes=pending.map(id=>map.get(id)), visibleModel=treeModel(visibleNodes,visibleEdges);
  // Rank the SCC DAG top-down: every parent is above its dependency except for
  // edges within a cycle, which necessarily share a level. Nodes are never copied.
  const {component,components}=visibleModel;
  const next=components.map(()=>new Set()),indegree=components.map(()=>0),levels=components.map(()=>0);
  for(const e of visibleEdges) {
    const a=component.get(e.from),b=component.get(e.to);
    if(a!==b&&!next[a].has(b)){next[a].add(b);indegree[b]++;}
  }
  const queue=indegree.flatMap((n,i)=>n===0?[i]:[]);
  for(let i=0;i<queue.length;i++)for(const b of next[queue[i]]) {
    levels[b]=Math.max(levels[b],levels[queue[i]]+1);
    if(--indegree[b]===0)queue.push(b);
  }
  const rows=new Map();
  for(const d of visibleNodes) {
    const level=levels[component.get(d.id)];
    if(!rows.has(level))rows.set(level,[]);
    rows.get(level).push(d);
  }
  const NW=330,NH=100,GAP=32,STEP=165,PAD=36;
  let columns=0;for(const row of rows.values())columns=Math.max(columns,row.length);
  const width=Math.max(400,columns*(NW+GAP)-GAP+2*PAD),placed=[];
  const roots=new Set(visibleModel.roots), starts=new Set(seeds);
  for(const [level,row] of [...rows].sort((a,b)=>a[0]-b[0])) {
    row.sort((a,b)=>a.id.localeCompare(b.id));
    const offset=(width-(row.length*(NW+GAP)-GAP))/2;
    row.forEach((d,i)=>placed.push({id:d.id,d,x:offset+i*(NW+GAP),y:PAD+22+level*STEP,w:NW,h:NH,
      treeRoot:roots.has(d.id),cycleRoot:visibleModel.cycleRoots.has(d.id),treeSeed:starts.has(d.id)}));
  }
  return {nodes:placed,groups:[],vertical:true,tree:true,w:width,h:Math.max(200,PAD*2+22+NH+(rows.size-1)*STEP)};
}
