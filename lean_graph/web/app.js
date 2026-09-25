import { groupedLayout, moduleLayout, folderModuleLayout, treeModel, treeLayout, exploreTreeLayout } from './layout.js';
import { METRICS, createContext, scoreNodes } from './importance.js';
import { pinKey, restorePins, visibleWithPins, updateNodePolicy, updateDisclosure } from './pins.js';
import { graphPdf, graphImage } from './pdf.js';
import { NodeNavigation } from './navigation.js';
import { moduleRelationships, selectionEdgeDistances, arrowEmphasis } from './relationships.js';

const $ = id => document.getElementById(id);
const svg = $('graph'), NS = 'http://www.w3.org/2000/svg';
const state = { graph: null, mode: 'declarations', selected: null, arrowFocus: true, focus: null, layout: null,
  view: [0, 0, 800, 600], viewportSize: null, nodeMap: new Map(), shown: new Set(), edges: [], busy: false,
  historyCache: new Map(), historyPending: new Map(), generation: 0, detailView: 'statement', detailRequest: 0,
  scoreCache: new Map(), pins: {declarations: new Set(), modules: new Set()},
  excluded: {declarations: new Set(), modules: new Set()}, copying: false,
  hidden: {declarations:new Set(),modules:new Set()},
  fontScale: {declarations:1,modules:1},
  viewLayout: {declarations:'tree',modules:'tree'},
  expandedParents: {declarations:new Set(),modules:new Set()},
  expanded: {declarations:new Set(),modules:new Set()}, treeModel:null, treeReveal:null };
const intro = $('inspector').cloneNode(true);
const statusLegend = $('legend').cloneNode(true);
const fmt = n => n.toLocaleString();
const navigation = new NodeNavigation();
// Exploration belongs to each view. Node history is separate from these snapshots.
const viewSessions = new Map();
const viewControlIds = ['search','search-mode','file','kind','status','importance',
  'min-score','node-limit','edge-mode','module-layout'];
function captureViewControls() {
  return {values:Object.fromEntries(viewControlIds.map(id=>[id,$(id).value])),
    external:$('external').checked};
}
function restoreViewControls(controls) {
  for(const [id,value] of Object.entries(controls.values))$(id).value=value;
  $('external').checked=controls.external;
  updateSearchHint();
}

function element(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function S(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(label, action) {
  const b = element('button', {}, label); b.onclick = action; return b;
}
function short(name, limit) { return name.length > limit ? name.slice(0, limit - 1) + '…' : name; }
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
async function json(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function indices(nodes, edges) {
  const map = new Map(nodes.map(n => [n.id, n])), out = new Map(), incoming = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    out.get(e.from).push(e.to); incoming.get(e.to).push(e.from);
  }
  return {map, out, incoming};
}
function currentIndex() { return state.mode === 'declarations' ? state.declIndex : state.moduleIndex; }
function isTree() { return state.viewLayout[state.mode] === 'tree'; }
function currentEdges() { return state.mode === 'declarations' ? state.graph.edges : state.moduleEdges; }
function pinStorageKey() { return 'lean-library-graph:pins:v1:' + state.graph.project.root; }
function exclusionStorageKey() { return 'lean-library-graph:excluded:v1:' + state.graph.project.root; }
function pinSnapshot(policies=state.pins) {
  return Object.fromEntries(['declarations','modules'].map(mode => {
    const index = mode === 'declarations' ? state.declIndex : state.moduleIndex;
    return [mode, [...policies[mode]].map(id => index?.map.get(id)).filter(Boolean).map(pinKey)];
  }));
}
function savePins() {
  try {
    localStorage.setItem(pinStorageKey(), JSON.stringify(pinSnapshot()));
    localStorage.setItem(exclusionStorageKey(), JSON.stringify(pinSnapshot(state.excluded)));
  } catch { /* Node policies still work for this page without browser storage. */ }
}
function changeNodePolicy(ids,policy,enabled) {
  const result=updateNodePolicy(state.pins[state.mode],state.excluded[state.mode],ids,policy,enabled);
  state.pins[state.mode]=result.pins;state.excluded[state.mode]=result.excluded;
  if(policy==='pin'&&enabled)for(const id of ids)state.hidden[state.mode].delete(id);
  savePins();render();showDetail();
}
function updatePinControls() {
  const pinned = [...state.shown].filter(id => state.pins[state.mode].has(id)).length;
  const unpinned = state.shown.size - pinned;
  $('pin-all').disabled = unpinned === 0;
  $('pin-all').textContent = unpinned ? `Pin all (${fmt(unpinned)})` : 'Pin all';
  $('unpin-all').disabled = pinned === 0;
  $('unpin-all').textContent = pinned ? `Unpin all (${fmt(pinned)})` : 'Unpin all';
  $('exclude-all').disabled = state.shown.size === 0;
  $('exclude-all').textContent = state.shown.size ? `Exclude all (${fmt(state.shown.size)})` : 'Exclude all';
  const excluded=state.excluded[state.mode].size;
  $('unexclude-all').disabled = excluded === 0;
  $('unexclude-all').textContent = excluded ? `Un-exclude all (${fmt(excluded)})` : 'Un-exclude all';
}
function historyWindow() { return Math.max(1, Math.min(200, Math.trunc(Number($('history-window').value) || 20))); }
function currentHistory() { return state.historyCache.get(historyWindow()); }
function currentScores() {
  const key = `${state.mode}:${$('importance').value}`;
  if (!state.scoreCache.has(key)) state.scoreCache.set(key, scoreNodes(state.contexts[state.mode], $('importance').value));
  return state.scoreCache.get(key);
}
function activity(node) {
  const history = currentHistory();
  if (!history?.available || node.external) return null;
  const record = (state.mode === 'declarations' ? history.nodes : history.modules)[node.id];
  if (state.mode === 'declarations' && !record?.tracked) return null;
  return record || null;
}
function updateHistoryStatus() {
  const history = currentHistory();
  $('history-status').textContent = state.historyPending.has(historyWindow()) ? 'Reading Git history...'
    : history?.available ? `${history.inspectedCommits} commits · ${history.head.slice(0,8)}${history.warnings.length ? ' · partial history' : ''}`
    : history ? 'Git history unavailable' : '';
  $('history-status').title = history?.reason || history?.warnings?.join('\n') || 'First-parent commits; uncommitted changes are excluded.';
}
async function ensureHistory() {
  const window = historyWindow(), generation = state.generation;
  if (state.historyCache.has(window)) return state.historyCache.get(window);
  if (state.historyPending.has(window)) return state.historyPending.get(window);
  const promise = json(`/api/history?window=${window}`).then(history => {
    if (generation === state.generation) state.historyCache.set(window, history);
    return history;
  }).catch(e => {
    const history = {available:false, reason:e.message};
    if (generation === state.generation) state.historyCache.set(window, history);
    return history;
  }).finally(() => {
    if (generation === state.generation) {
      state.historyPending.delete(window); updateHistoryStatus();
      if ($('heat').checked && state.layout) draw();
    }
  });
  state.historyPending.set(window, promise); updateHistoryStatus();
  return promise;
}

async function load(refresh = false) {
  if (state.busy) return;
  state.busy = true; $('refresh').disabled = true; $('refresh').textContent = 'Scanning...';
  try {
    const graph = await json('/api/graph' + (refresh ? '?refresh=1' : ''));
    let savedPins = pinSnapshot();
    let savedExcluded = pinSnapshot(state.excluded);
    const initial = !state.graph;
    state.graph = graph;
    if (initial) {
      try { savedPins = JSON.parse(localStorage.getItem(pinStorageKey())) || savedPins; }
      catch { /* Ignore unavailable or malformed browser storage. */ }
      try { savedExcluded = JSON.parse(localStorage.getItem(exclusionStorageKey())) || savedExcluded; }
      catch { /* Exclusions still work without saved browser state. */ }
    }
    state.generation++; state.historyCache.clear(); state.historyPending.clear(); state.scoreCache.clear();
    state.declIndex = indices(graph.declarations, graph.edges);
    state.moduleNodes = [...graph.files.map(f => ({...f, name: f.module, fullName: f.module, kind: 'module',
      hasSorry: f.sorryCount > 0})), ...graph.externalModules.map(id => ({id, name:id, fullName:id, kind:'external', external:true}))];
    state.moduleEdges = moduleRelationships(graph.moduleEdges, graph.declarations, graph.edges);
    state.moduleIndex = indices(state.moduleNodes, state.moduleEdges);
    navigation.retain(entry=>(entry.mode==='declarations'?state.declIndex:state.moduleIndex).map.has(entry.id));
    for (const mode of ['declarations','modules']) {
      state.pins[mode] = restorePins(Array.isArray(savedPins[mode]) ? savedPins[mode] : [],
        mode === 'declarations' ? graph.declarations : state.moduleNodes);
      state.excluded[mode] = restorePins(Array.isArray(savedExcluded[mode]) ? savedExcluded[mode] : [],
        mode === 'declarations' ? graph.declarations : state.moduleNodes);
      for(const id of state.excluded[mode])state.pins[mode].delete(id);
    }
    savePins(); updatePinControls();
    state.contexts = {declarations:createContext(graph.declarations,graph.edges), modules:createContext(state.moduleNodes,state.moduleEdges)};
    $('project').textContent = graph.project.root;
    $('project').title = graph.project.root;
    document.title = `${graph.project.name} | Lean Library Graph`;
    const s = graph.stats;
    $('stats').replaceChildren(...[[s.files,'Lean files'],[s.declarations,'declarations'],[s.edges,'inferred references'],
      [s.imports,'module imports'],[s.sorryCount,'sorry / admit tokens']].map(([n, label], i) => {
      const el = element('div', {class: 'stat' + (i === 4 ? ' warn' : '')});
      el.append(element('strong', {}, fmt(n)), element('span', {}, label)); return el;
    }));
    const fileValue = $('file').value, kindValue = $('kind').value;
    $('file').replaceChildren(element('option', {value:''}, 'All files'), ...graph.files.map(f => element('option', {value:f.file}, f.file)));
    $('kind').replaceChildren(element('option', {value:''}, 'All kinds'), ...[...new Set(graph.declarations.map(d => d.kind))].sort().map(k => element('option', {value:k}, k)));
    if (graph.files.some(f => f.file === fileValue)) $('file').value = fileValue;
    if ([...$('kind').options].some(o => o.value === kindValue)) $('kind').value = kindValue;
    if (!currentIndex().map.has(state.selected)) { state.selected = null; state.focus = null; }
    error(graph.warnings.join('\n'));
    render();
    showDetail();
    updateHistoryStatus();
    if ($('heat').checked) ensureHistory();
  } catch (e) { error(`Could not load library: ${e.message}`); }
  finally { state.busy = false; $('refresh').disabled = false; $('refresh').textContent = 'Refresh sources'; }
}

function focusSet() {
  if (!state.focus) return null;
  const {id, direction, transitive} = state.focus;
  const index = currentIndex(), seen = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const next = [];
    for (const from of frontier) {
      const neighbors = direction === 'dependencies' ? index.out.get(from) || []
        : direction === 'users' ? index.incoming.get(from) || []
        : [...index.out.get(from) || [], ...index.incoming.get(from) || []];
      for (const n of neighbors) if (!seen.has(n)) { seen.add(n); next.push(n); }
    }
    frontier = transitive ? next : [];
  }
  return seen;
}

// Wildcards match complete fields; regex retains substring matching unless
// explicitly anchored. Compile once per search, never once per node.
function compileSearch(query, mode) {
  if(!query)return null;
  if(mode==='regex')return new RegExp(query,'i');
  const literal=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('^(?:'+literal.replace(/\\\*/g,'.*').replace(/\\\?/g,'.')+')$','i');
}
function matchesSearch(node, pattern, mode) {
  const name=node.fullName||node.name||'',file=node.file||'';
  const fields=[name,file];
  if(mode==='wildcard') {
    const filename=file.split('/').pop();
    fields.push(node.name||'',name.split('.').pop(),filename,filename.replace(/\.lean$/i,''));
  }
  return fields.some(value=>value&&pattern.test(value));
}
function updateSearchHint(){
  const wildcard=$('search-mode').value==='wildcard';
  $('search').placeholder=wildcard?'Problem1 or Problem1*':'Regex: Heat|Wave';
  $('search').title=wildcard
    ? 'Case-insensitive wildcard search: exact names or paths; * matches any characters, ? matches one. Problem1 is exact; Problem1* includes Problem1037.'
    : 'Case-insensitive regular expression against full names or file paths. Example: WaveIVP[123]D$ (no / delimiters).';
}

function searchPattern() {
  const query=$('search').value.trim();
  try {
    const mode=$('search-mode').value,pattern=compileSearch(query,mode);
    $('search').setAttribute('aria-invalid','false');
    $('search-error').hidden=true;$('search-error').textContent='';
    return {query,pattern,mode};
  } catch(e) {
    $('search').setAttribute('aria-invalid','true');
    $('search-error').textContent=`Invalid regular expression: ${e.message.replace(/^Invalid regular expression: /,'')}. The previous diagram is unchanged.`;
    $('search-error').hidden=false;
    return null;
  }
}

function render(anchorId = null, {preserveViewport=false} = {}) {
  if (!state.graph) return;
  const search=searchPattern();
  if(!search)return;
  syncViewportSize();
  const previousNodes=state.nodeMap;
  const [vx,vy,vw,vh]=state.view;
  // Keep the node being unfolded under the pointer while the layout grows.
  // Otherwise preserve a nearby visible node, without changing the zoom.
  const anchorCandidates=[...previousNodes.values()].filter(n=>
    n.id===anchorId || n.x+n.w>=vx&&n.x<=vx+vw&&n.y+n.h>=vy&&n.y<=vy+vh);
  anchorCandidates.sort((a,b)=>a.id===anchorId?-1:b.id===anchorId?1:
    Math.hypot(a.x+a.w/2-vx-vw/2,a.y+a.h/2-vy-vh/2)-Math.hypot(b.x+b.w/2-vx-vw/2,b.y+b.h/2-vy-vh/2));
  const {query,pattern,mode:searchMode} = search, file = $('file').value, focus = focusSet();
  const isDecl = state.mode === 'declarations';
  const allNodes = isDecl ? state.graph.declarations : state.moduleNodes;
  const hasStart = Boolean(query || file || state.focus);
  const candidates = allNodes.filter(d => {
    if(isTree() && !hasStart)return false;
    if (focus && !focus.has(d.id)) return false;
    if (d.external && !$('external').checked) return false;
    if (file && d.file !== file) return false;
    if (pattern && !matchesSearch(d,pattern,searchMode)) return false;
    if (isDecl) {
      if ($('kind').value && d.kind !== $('kind').value) return false;
      const status = $('status').value;
      if (status === 'sorry' && !d.hasSorry || status === 'clear' && d.hasSorry || status === 'axiom' && d.kind !== 'axiom') return false;
    }
    return true;
  });
  const scores = currentScores();
  let {nodes, eligible, pinnedCount} = visibleWithPins(candidates, allNodes, state.pins[state.mode], scores, {
    excludedIds: state.excluded[state.mode],
    minimum: Math.max(0, Number($('min-score').value) || 0),
    limit: Math.max(0, Math.trunc(Number($('node-limit').value) || 0)), focusId: state.focus?.id,
  });
  state.available = new Set(nodes.map(n=>n.id));
  if (isTree()) {
    // Search and File choose seeds; expansion uses the full permitted library.
    const traversable = allNodes.filter(d=>!state.excluded[state.mode].has(d.id) &&
      (!d.external || $('external').checked || state.pins[state.mode].has(d.id)));
    state.treeModel = treeModel(traversable, currentEdges());
    state.treeSeeds = new Set(nodes.map(n=>n.id));
    if(state.treeReveal)state.treeSeeds.add(state.treeReveal);
    if(state.focus?.id)state.treeSeeds.add(state.focus.id);
    state.layout = exploreTreeLayout(traversable,currentEdges(),state.treeModel,state.treeSeeds,
      state.expanded[state.mode],state.expandedParents[state.mode],state.hidden[state.mode]);
    nodes = state.layout.nodes.map(n => n.d);
    state.available = new Set(traversable.map(n=>n.id));
  }
  $('tree-controls').hidden = !isTree();
  $('module-layout-label').hidden = isTree() || state.mode !== 'modules';
  $('tree-expand-all').disabled = !isTree() || !nodes.some(n=>state.treeModel.out.get(n.id)?.length && !state.expanded[state.mode].has(n.id));
  $('tree-collapse-all').disabled = !isTree() || (!state.expanded[state.mode].size && !state.expandedParents[state.mode].size);
  $('metric-description').textContent = 'Search or choose a file to start; expand Parents (users) above or Children (dependencies) below. Hide is temporary; excluded nodes stay excluded.';
  state.shown = new Set(nodes.map(n => n.id));
  $('export-pdf').disabled = nodes.length === 0;
  $('copy-image').disabled = nodes.length === 0 || state.copying;
  updatePinControls();
  updateNavigationControls();
  state.edges = currentEdges().filter(e => state.shown.has(e.from) && state.shown.has(e.to));
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width / Math.max(rect.height, 100);
  if (!isTree()) state.layout = isDecl ? groupedLayout(nodes, state.graph.files, aspect)
    : $('module-layout').value==='folders' ? folderModuleLayout(nodes,state.edges) : moduleLayout(nodes, state.edges, aspect);
  if(!isDecl && !isTree())$('analysis-note').textContent=$('module-layout').value==='folders'
    ? 'Arrows run from users to dependencies, left to right. Double-click a folder to zoom into it; Fit shows all folders.'
    : 'Arrows point to dependencies. Hover for import or inferred-use details. Blue follows all visible dependency and user paths.';
  if(isDecl && !isTree())$('analysis-note').textContent='Arrows point from a user to its dependency. Blue follows all visible dependency and user paths. References are inferred.';
  if(isTree())$('analysis-note').textContent='Parents use this node; Children are its dependencies. Expansion can go beyond the search or selected file. Shared nodes appear once.';
  state.nodeMap = new Map(state.layout.nodes.map(n => [n.id, n]));
  $('empty').hidden = nodes.length !== 0;
  $('empty').textContent=hasStart?'No matches. Try another search or file, or Un-exclude all.':'Search for a node or choose a file to begin.';
  $('visible-count').textContent = `${fmt(nodes.length)} / ${fmt(eligible)} ${isDecl ? 'declarations' : 'modules'} · ${fmt(state.edges.length)} connections` + (focus ? ' · Focus active' : '');
  if (isTree()) $('visible-count').textContent = `${fmt(nodes.length)} visible ${isDecl?'declarations':'modules'} · ${fmt([...state.treeSeeds].filter(id=>!state.hidden[state.mode].has(id)).length)} starting nodes · ${fmt(state.edges.length)} connections`;
  if (pinnedCount) $('visible-count').textContent += ` · ${fmt(pinnedCount)} pinned`;
  if(state.excluded[state.mode].size)$('visible-count').textContent+=` · ${fmt(state.excluded[state.mode].size)} excluded`;
  const anchor=anchorCandidates.find(n=>state.nodeMap.has(n.id));
  if(!preserveViewport && anchor) {
    const next=state.nodeMap.get(anchor.id);
    state.view[0]+=next.x+next.w/2-anchor.x-anchor.w/2;
    state.view[1]+=next.y+next.h/2-anchor.y-anchor.h/2;
  } else if(!preserveViewport && nodes.length && !nodes.some(n=>previousNodes.has(n.id))) {
    // A fresh search/file starts on a readable node, not a fitted overview.
    const first=state.layout.nodes.find(n=>n.treeSeed)||state.layout.nodes[0];
    state.view[0]=first.x+first.w/2-state.view[2]/2;
    state.view[1]=first.y-Math.min(60,state.view[3]/4);
  }
  draw();
}

function draw() {
  const fontScale=state.fontScale[state.mode];
  svg.style.setProperty('--diagram-font-scale',String(fontScale));
  $('font-smaller').disabled=fontScale<=.5;
  $('font-larger').disabled=fontScale>=2.5;
  for(const id of ['font-smaller','font-larger'])$(id).title=
    `${id==='font-smaller'?'Decrease':'Increase'} diagram text size (currently ${Math.round(fontScale*100)}%; range 50–250%)`;
  $('visible-count').textContent=$('visible-count').textContent.replace(/ · Selection (outside filters|excluded|folded|hidden)$/,'');
  if(state.selected&&!state.shown.has(state.selected))$('visible-count').textContent+=
    state.excluded[state.mode].has(state.selected)?' · Selection excluded'
      : state.hidden[state.mode].has(state.selected)?' · Selection hidden'
      : isTree()&&state.available.has(state.selected)?' · Selection folded':' · Selection outside filters';
  const history = currentHistory(), heat = $('heat').checked && history?.available;
  const allActivity = history?.available ? Object.values(state.mode === 'declarations' ? history.nodes : history.modules) : [];
  const maxChanges = Math.max(0, ...allActivity.map(n => n.changeCount));
  if (heat) {
    $('legend').replaceChildren(element('span',{class:'heat-swatch'}),document.createTextNode(`0 → ${maxChanges} changed commits · gray = unmatched`));
  } else $('legend').replaceChildren(...[...statusLegend.childNodes].map(n=>n.cloneNode(true)));
  const defs = S('defs');
  function addArrowMarker(id,color) {
    const marker = S('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
    marker.append(S('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:color})); defs.append(marker);
  }
  addArrowMarker('arrow','#879fbd');
  const groups = S('g'), edgeLayer = S('g'), nodeLayer = S('g');
  for (const g of state.layout.groups) {
    if(g.kind==='folder') {
      const d=state.moduleIndex.map.get(state.selected);
      const folder=d?.file?.split('/').slice(0,-1).join('/');
      const selected=state.shown.has(state.selected)&&(g.path===null?d?.external
        : !d?.external&&d?.file&&(g.path===''||folder===g.path||folder.startsWith(g.path+'/')));
      const el=S('g',{class:'folder-group'+(selected?' selected':''),'data-folder':g.path??'[external]',
        role:'button',tabindex:0,'aria-label':`Zoom to folder ${g.path===null?'External imports':g.path||'Repository root'}`});
      const colors=['#f2f5fb','#edf4fc','#eff8f6','#f6f3fb','#fcf6ee'];
      el.append(S('rect',{x:g.x,y:g.y,width:g.w,height:g.h,rx:12,fill:colors[g.depth%colors.length]}),
        S('text',{x:g.x+14,y:g.y+23},short(`${g.label}/`,Math.max(2,Math.floor((g.w-28-72*fontScale)/(8.5*fontScale))))),
        S('text',{class:'folder-count',x:g.x+g.w-14,y:g.y+23,'text-anchor':'end'},`${g.count} ${g.count===1?'file':'files'}`),
        S('title',{},`${g.path===null?'External imports (sources not scanned)':g.path||'Repository root'}\n${g.count} visible modules. Double-click to zoom into this folder.`));
      const zoomFolder=()=>{
        const r=svg.getBoundingClientRect(),scale=Math.max(g.w/Math.max(r.width,1),g.h/Math.max(r.height,1))/.9;
        const w=r.width*scale,h=r.height*scale;state.view=[g.x+g.w/2-w/2,g.y+g.h/2-h/2,w,h];updateView();
      };
      el.addEventListener('dblclick',e=>{e.stopPropagation();zoomFolder();});
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();zoomFolder();}});
      groups.append(el);continue;
    }
    const el = S('g',{class:'graph-group'});
    el.append(S('rect',{x:g.x,y:g.y,width:g.w,height:g.h,rx:9}),
      S('text',{x:g.x+12,y:g.y+22}, short(g.file.split('/').pop().replace(/\.lean$/,''),Math.max(2,Math.floor((g.w-24)/(8*fontScale))))),S('title',{},g.file));
    el.addEventListener('dblclick', e => {e.stopPropagation(); $('file').value=g.file; state.focus=null; render();});
    groups.append(el);
  }
  const edgeMode = $('edge-mode').value;
  const highlighted = selectionEdgeDistances(state.edges, state.arrowFocus && state.shown.has(state.selected) ? state.selected : null);
  if(highlighted.size&&edgeMode!=='none')$('legend').append(element('span',{class:'edge-depth-swatch',
    title:'Direct connections are darker and thicker; indirect connections are lighter and thinner.'}),document.createTextNode('Direct → indirect'));
  const arrowMarkers=new Set();
  // Draw distant paths first and direct connections last so stronger edges stay visible.
  const orderedEdges = [...state.edges].sort((a,b)=>{
    const ad=highlighted.get(a)??Infinity,bd=highlighted.get(b)??Infinity;
    return ad===bd?0:bd-ad;
  });
  if (edgeMode !== 'none') for (const e of orderedEdges) {
    const selected = highlighted.has(e);
    const distance = highlighted.get(e);
    if ((edgeMode === 'selected' || edgeMode === 'auto' && state.edges.length > 1200) && !selected) continue;
    const a=state.nodeMap.get(e.from), b=state.nodeMap.get(e.to);
    let x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2;
    if (a.x >= b.x) {x1=a.x; x2=b.x+b.w;}
    const bend = Math.max(35,Math.abs(x2-x1)/2), sign = x2 >= x1 ? 1 : -1;
    let path = `M${x1},${y1} C${x1+sign*bend},${y1} ${x2-sign*bend},${y2} ${x2},${y2}`;
    if (state.layout.vertical) {
      x1=a.x+a.w/2;x2=b.x+b.w/2;y1=a.y;y2=b.y+b.h;
      if(a.y<b.y){y1=a.y+a.h;y2=b.y;}
      const middle=(y1+y2)/2;
      path=`M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}`;
    }
    const inferred = state.mode === 'modules' && !e.explicit;
    const markerId=selected?`arrow-distance-${distance}`:'arrow';
    const edge = S('path',{class:'edge'+(inferred?' inferred':'')+(selected?' selected':''),
      'data-from':e.from,'data-to':e.to,
      d:path,
      'marker-end':`url(#${markerId})`});
    if(selected) {
      const emphasis=arrowEmphasis(distance);
      edge.setAttribute('data-distance',String(distance));
      edge.style.stroke=emphasis.color;edge.style.strokeWidth=String(emphasis.width);edge.style.strokeOpacity='1';
      if(!arrowMarkers.has(distance)){addArrowMarker(markerId,emphasis.color);arrowMarkers.add(distance);}
    }
    edge.append(S('title',{},`${e.from} → ${e.to}\n`+(state.mode==='modules'
      ? `${e.explicit?'Explicit import':'Inferred module dependency'}${e.referenceCount?` · ${e.referenceCount} declaration reference${e.referenceCount===1?'':'s'}`:''}`
      : 'Inferred declaration reference')+(selected?`\n${distance===1?'Direct connection':`${distance} steps from selection`} (visible graph)`:'')));
    edgeLayer.append(edge);
  }
  for (const n of state.layout.nodes) {
    const d=n.d, c=d.external?'external':d.kind==='axiom'?'axiom':d.hasSorry?'sorry':'clear';
    const pinned = state.pins[state.mode].has(d.id);
    const changes = activity(d), heatLevel = changes ? Math.ceil(changes.changeCount / Math.max(1,maxChanges) * 5) : 'unknown';
    const el=S('g',{class:`graph-node ${c}${heat?' heat heat-'+heatLevel:''}${d.id===state.selected?' selected':''}`,'data-node':d.id,
      tabindex:0,role:'button','aria-label':`${d.kind} ${d.fullName}${d.hasSorry?', contains sorry':''}${pinned?', pinned':''}`,'data-pinned':String(pinned)});
    el.append(S('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:6}),
      S('rect',{class:'status-stripe',x:n.x,y:n.y+8,width:3,height:n.h-16,rx:1}),
      S('text',{x:n.x+12,y:n.y+21},short(state.mode==='modules'?d.name.split('.').pop():d.name,Math.max(2,Math.floor((n.w-82)/(8.9*fontScale))))),
      S('text',{class:'node-meta',x:n.x+12,y:n.y+(isTree()?53:n.h-10)+Math.max(0,fontScale-1)*12},short(state.mode==='modules'
        ? d.external?'External module':`${d.declarations.length} declarations · ${d.sorryCount} sorry`
        : `${d.kind}${heat?' · '+(changes?changes.changeCount:'?')+' changes':''}${d.hasSorry?' · sorry':''}`,Math.max(2,Math.floor((n.w-24)/(6.2*fontScale))))),
      S('title',{},`${d.fullName}\n${d.file||'External import'}${d.line?':'+d.line:''}${heat?'\nChanged commits: '+(changes?changes.changeCount:'unmatched'):''}`));
    if (isTree()) {
      if(n.treeSeed || n.treeRoot)el.append(S('text',{class:'tree-root-label',x:n.x+4,y:n.y-10},n.cycleRoot?'CYCLE ENTRY':n.treeSeed?'START':'ROOT'));
      for(const [direction,index,label,x] of [
        ['parents',state.treeModel.incoming,'Parents',n.x+10],
        ['children',state.treeModel.out,'Children',n.x+n.w/2+4],
      ]) {
        const neighbors=index.get(d.id)||[],count=neighbors.length,open=count>0&&neighbors.every(id=>state.shown.has(id));
        const toggle=S('g',{class:'tree-toggle'+(!count?' disabled':''),role:'button',tabindex:count?0:-1,
          'data-tree-toggle':d.id,'data-direction':direction,'aria-expanded':String(open),'aria-disabled':String(!count),
          'aria-label':`${open?'Collapse':'Expand'} ${direction} of ${d.fullName}`});
        toggle.append(S('rect',{x,y:n.y+66,width:n.w/2-14,height:26,rx:5}),
          S('text',{x:x+8,y:n.y+84},`${count?(open?'−':'+'):'·'} ${label} ${count}`),
          S('title',{},direction==='parents'?'Nodes that use/import this node':'Dependencies used/imported by this node'));
        const action=e=>{e.stopPropagation();if(count)toggleTreeNode(d.id,direction);};
        toggle.addEventListener('click',action);
        toggle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action(e);}});
        el.append(toggle);
      }
    }
    const hide=S('g',{class:'node-hide',role:'button',tabindex:0,'data-hide-node':d.id,'aria-label':`Hide ${d.fullName}`});
    hide.append(S('rect',{x:n.x+n.w-52,y:n.y+5,width:44,height:23,rx:4}),
      S('text',{x:n.x+n.w-30,y:n.y+21,'text-anchor':'middle'},'Hide'),
      S('title',{},'Temporarily hide this node. Search again or expand a connected node to show it again.'));
    const hideNode=e=>{e.stopPropagation();state.hidden[state.mode].add(d.id);render();showDetail();};
    hide.addEventListener('click',hideNode);
    hide.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();hideNode(e);}});
    el.append(hide);
    if(pinned){
      const pin=S('g',{class:'pin-marker',transform:`translate(${n.x+n.w-74} ${n.y+5}) rotate(25 9 10)`});
      pin.append(S('path',{d:'M5 2H13 M6 2V8L3 11H15L12 8V2 M9 11V19'}),S('title',{},'Pinned'));
      el.append(pin);
    }
    el.addEventListener('click',e=>{e.stopPropagation();activateNode(d.id);});
    el.addEventListener('keydown',e=>{
      if(isTree() && (e.key==='ArrowUp'||e.key==='ArrowDown')) {
        e.preventDefault();e.stopPropagation();toggleTreeNode(d.id,e.key==='ArrowUp'?'parents':'children');
      } else if(e.key==='Enter'||e.key===' '){e.preventDefault();activateNode(d.id);}
    });
    nodeLayer.append(el);
  }
  svg.replaceChildren(defs,groups,edgeLayer,nodeLayer);
  updateView();
}

// Preserve SVG units per screen pixel as the canvas or Inspector changes size.
function syncViewportSize(){
  const r=svg.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return;
  const previous=state.viewportSize;
  if(!previous){state.view=[0,0,r.width,r.height];}
  else if(previous[0]!==r.width||previous[1]!==r.height){
    const scale=state.view[2]/previous[0],w=r.width*scale,h=r.height*scale;
    state.view=[state.view[0]+(state.view[2]-w)/2,state.view[1]+(state.view[3]-h)/2,w,h];
  }
  state.viewportSize=[r.width,r.height];
}
function updateView(){syncViewportSize();svg.setAttribute('viewBox',state.view.join(' '));}
function fit(){
  if(!state.layout)return;
  syncViewportSize();
  const r=svg.getBoundingClientRect(),w=state.layout.w,h=state.layout.h;
  const scale=Math.max(w/Math.max(r.width,1),h/Math.max(r.height,1))/0.92;
  state.view=[w/2-r.width*scale/2,h/2-r.height*scale/2,r.width*scale,r.height*scale];updateView();
}
function zoom(factor,fx=.5,fy=.5){
  const [x,y,w,h]=state.view;
  const width=Math.max(120,Math.min(200000,w*factor)),height=h*width/w;
  state.view=[x+(w-width)*fx,y+(h-height)*fy,width,height];updateView();
}
let drag=null;
svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(Math.exp(Math.max(-1,Math.min(1,e.deltaY*.002))),(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);},{passive:false});
svg.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-node]'))return;drag={x:e.clientX,y:e.clientY};svg.setPointerCapture(e.pointerId);svg.classList.add('dragging');});
svg.addEventListener('pointermove',e=>{if(!drag)return;const r=svg.getBoundingClientRect();state.view[0]-=(e.clientX-drag.x)*state.view[2]/r.width;state.view[1]-=(e.clientY-drag.y)*state.view[3]/r.height;drag={x:e.clientX,y:e.clientY};updateView();});
function endDrag(){drag=null;svg.classList.remove('dragging');}
svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);
svg.addEventListener('keydown',e=>{if(e.target!==svg)return;const moves={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};if(moves[e.key]){e.preventDefault();state.view[0]+=moves[e.key][0]*state.view[2];state.view[1]+=moves[e.key][1]*state.view[3];updateView();}if(e.key==='+'||e.key==='=')zoom(.8);if(e.key==='-')zoom(1.25);if(e.key==='0')fit();});

function clearFilters(){for(const id of ['search','file','kind','status'])$(id).value='';$('min-score').value='0';}
function updateNavigationControls(){
  for(const [name,direction] of [['back',-1],['forward',1]]){
    const b=$('node-'+name),target=navigation.target(direction,{mode:state.mode,id:state.selected});
    b.disabled=target===null;
    const entry=target===null?null:navigation.entries[target];
    const node=entry?(entry.mode==='declarations'?state.declIndex:state.moduleIndex)?.map.get(entry.id):null;
    b.title=node?`${name==='back'?'Back':'Forward'}: ${node.fullName} (${entry.mode==='declarations'?'Declarations':'File (Module)'})`:`No ${name==='back'?'previous':'next'} node`;
  }
}
function toggleTreeNode(id, direction) {
  const index=direction==='parents'?state.treeModel?.incoming:state.treeModel?.out;
  if(!index?.get(id)?.length)return;
  const key=direction==='parents'?'expandedParents':'expanded';
  const result=updateDisclosure({id,neighbors:index.get(id),expanded:state[key][state.mode],
    hidden:state.hidden[state.mode],shown:state.shown,seeds:state.treeSeeds,pins:state.pins[state.mode]});
  state[key][state.mode]=result.expanded;state.hidden[state.mode]=result.hidden;
  render(id);
  [...svg.querySelectorAll('[data-tree-toggle]')].find(el=>el.dataset.treeToggle===id&&el.dataset.direction===direction)?.focus({preventScroll:true});
}
function activateNode(id) {
  if(id===state.selected){state.arrowFocus=!state.arrowFocus;draw();}
  else select(id);
}
function select(id, reveal=false, {record=true}={}){
  if(!currentIndex()?.map.has(id))return;
  if(reveal&&!state.excluded[state.mode].has(id)) {
    state.hidden[state.mode].delete(id);
    if(currentIndex().map.get(id)?.external)$('external').checked=true;
    if(isTree()){state.treeReveal=id;render();}
    else if(!state.shown.has(id)){clearFilters();state.focus={id,direction:'both',transitive:false};render();}
  }
  state.selected=id;state.arrowFocus=true;draw();showDetail();
  $('inspector').scrollTop=0;
  if(record)navigation.visit(state.mode,id);
  updateNavigationControls();
  if(reveal){const n=state.nodeMap.get(id);if(n){const [, ,w,h]=state.view;state.view=[n.x+n.w/2-w/2,n.y+n.h/2-h/2,w,h];updateView();}}
}
function focus(direction,transitive=false){
  if(!state.selected)return;
  clearFilters();state.focus={id:state.selected,direction,transitive};render();showDetail();
}
function switchMode(mode,{restore=true}={}){
  if(!state.graph||mode===state.mode)return;
  // Finish a pending search in the departing view, never in the destination.
  if(searchTimer){clearTimeout(searchTimer);searchTimer=null;restartTreeSearch();}
  syncViewportSize();
  viewSessions.set(state.mode, {controls:captureViewControls(),
    selected:state.selected,arrowFocus:state.arrowFocus,focus:state.focus,
    treeReveal:state.treeReveal,detailView:state.detailView,
    view:[...state.view],viewportSize:[...state.viewportSize],
    inspectorScroll:$('inspector').scrollTop});
  const saved=viewSessions.get(mode);
  state.mode=mode;
  restoreViewControls(saved?.controls || initialViewControls);
  state.selected=restore && currentIndex().map.has(saved?.selected)?saved.selected:null;
  state.arrowFocus=saved?.arrowFocus ?? true;
  state.focus=saved?.focus && currentIndex().map.has(saved.focus.id)?saved.focus:null;
  state.treeReveal=currentIndex().map.has(saved?.treeReveal)?saved.treeReveal:null;
  state.detailView=saved?.detailView || 'statement';
  if(saved){state.view=[...saved.view];state.viewportSize=[...saved.viewportSize];}
  $('view-layout').value=state.viewLayout[mode];
  $('declarations').setAttribute('aria-pressed',String(mode==='declarations'));
  $('modules').setAttribute('aria-pressed',String(mode==='modules'));
  $('kind-label').hidden=mode==='modules';$('status-label').hidden=mode==='modules';$('external').disabled=mode==='declarations';
  $('module-layout-label').hidden=mode!=='modules';
  $('analysis-note').textContent=mode==='modules'?'Arrows point to dependencies. Hover for import or inferred-use details. Blue follows all visible dependency and user paths.':'Arrows point from a user to its dependency. Blue follows all visible dependency and user paths. References are inferred.';
  render(null,{preserveViewport:Boolean(saved)});showDetail();
  if(restore && state.selected)navigation.visit(mode,state.selected);
  updateNavigationControls();
  $('inspector').scrollTop=restore?(saved?.inspectorScroll || 0):0;
}

function navigateNode(direction){
  const entry=navigation.move(direction,{mode:state.mode,id:state.selected});
  if(!entry)return;
  switchMode(entry.mode,{restore:false});
  select(entry.id,true,{record:false});
}

function codeBlock(text, {diff=false, line=1}={}) {
  const pre=element('pre',{class:diff?'diff-code':'statement-code'});
  let oldLine=null,newLine=null;
  text.split('\n').forEach((text,i)=>{
    const hunk=diff&&text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let before='',after='';
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);}
    else if(diff&&oldLine!==null){
      if(text.startsWith('-'))before=oldLine++;
      else if(text.startsWith('+'))after=newLine++;
      else if(text.startsWith(' ')){before=oldLine++;after=newLine++;}
    }
    const type=diff?(hunk?' diff-hunk':before!==''&&after===''?' diff-remove':after!==''&&before===''?' diff-add':''):'';
    const row=element('span',{class:'source-line'+type});
    if(diff){
      row.append(element('span',{class:'line-no','aria-hidden':'true',title:'Previous version line'},String(before)),
        element('span',{class:'line-no','aria-hidden':'true',title:'Selected commit line'},String(after)));
    }else row.append(element('span',{class:'line-no','aria-hidden':'true',title:'Lean file line'},String(line+i)));
    row.append(element('span',{class:'code-text'},text||' '));pre.append(row);
  });
  return pre;
}

async function nodeContent(d, container, request) {
  const view=state.detailView, window=historyWindow();
  const isCurrent=()=>request===state.detailRequest&&state.selected===d.id&&state.mode==='declarations';
  if(view==='statement') {
    const note=['lemma','theorem'].includes(d.kind)
      ? 'Source before := by. If there is no tactic-proof boundary, the complete declaration is shown.'
      : 'Complete declaration, including its implementation and fields.';
    container.append(element('p',{class:'muted'},note),codeBlock(d.statement||d.signature,{line:d.line}));
    return;
  }
  container.append(element('p',{class:'muted'},view==='diff'?'Reading recent changes...':'Loading source...'));
  try {
    if(view==='source') {
      const detail=await json('/api/node?id='+encodeURIComponent(d.id));
      if(isCurrent())container.replaceChildren(codeBlock(detail.body,{line:detail.line}));
      return;
    }
    const history=await ensureHistory();
    if(!isCurrent())return;
    if(!history.available){container.replaceChildren(element('p',{class:'muted'},history.reason));return;}
    const record=history.nodes[d.id];
    container.replaceChildren(element('p',{class:'muted'},`${record?.changeCount||0} changed commits among the last ${history.inspectedCommits} first-parent commits. Comparing complete statement and proof against each commit's first parent.`));
    if(history.warnings.length)container.append(element('p',{class:'muted'},history.warnings.join('\n')));
    if(record?.anonymous)container.append(element('p',{class:'muted'},'Anonymous declarations are matched by their order within the file; insertions may affect matching.'));
    if(!record?.tracked){container.append(element('p',{class:'muted'},'No unambiguous matching declaration at HEAD. This node may be uncommitted, renamed, or have a duplicate name.'));return;}
    if(record.workingTreeChanged)container.append(element('p',{class:'working-note'},'This declaration also has uncommitted edits, which are excluded from the commit count and diffs below.'));
    if(!record.commits.length){container.append(element('p',{class:'muted'},'No changes to this declaration in this commit window. Increase Recent commits to look further back.'));return;}
    const picker=element('select',{id:'commit-picker','aria-label':'Changed commit'});
    record.commits.forEach(c=>picker.append(element('option',{value:c.sha},`${c.sha.slice(0,8)} · ${new Date(c.timestamp*1000).toISOString().slice(0,10)} · ${c.subject}`)));
    const label=element('label',{class:'commit-label'},'Commit');label.append(picker);
    const output=element('div',{id:'commit-diff'});container.append(label,output);
    let diffRequest=0;
    async function displayDiff(){
      const ticket=++diffRequest;
      output.replaceChildren(element('p',{class:'muted'},'Loading diff...'));
      try {
        const data=await json(`/api/node-history?id=${encodeURIComponent(d.id)}&window=${window}&commit=${picker.value}`);
        if(!isCurrent()||ticket!==diffRequest)return;
        output.replaceChildren(element('p',{class:'muted'},'Red: previous version. Green: selected commit. Line numbers: previous version on the left, selected commit on the right; relative to the declaration.'),codeBlock(data.selected.diff,{diff:true}));
      }catch(e){if(isCurrent()&&ticket===diffRequest)output.replaceChildren(element('p',{class:'muted'},e.message));}
    }
    picker.onchange=displayDiff;await displayDiff();
  }catch(e){if(isCurrent())container.replaceChildren(element('p',{class:'muted'},e.message));}
}

function showPreviewNode(id, mode) {
  if(state.mode!==mode)switchMode(mode,{restore:false});
  // Explicit navigation restores temporary Hide only; exclusion is intentional.
  state.hidden[mode].delete(id);
  select(id,true);
}
function declarationPreview(decl, label='Show in Declarations'){
  const entry=element('details',{class:'declaration-preview'});
  entry.append(element('summary',{},decl.fullName));
  // Expanding a preview leaves the selection, filters, and graph view intact.
  entry.addEventListener('toggle',()=>{
    if(!entry.open||entry.childNodes.length>1)return;
    entry.append(codeBlock(decl.previewStatement??decl.statement??decl.signature,{line:decl.line}),
      button(label,()=>showPreviewNode(decl.id,'declarations')));
  });
  return entry;
}

function moduleDependencyPreview(target, edge) {
  const entry=element('details',{class:'declaration-preview'});
  const summary=element('summary',{},target.fullName);
  if(edge)summary.append(element('span',{class:'relationship-note'},
    `${edge.explicit?'Explicit import':'Inferred use'}${edge.referenceCount?` · ${edge.referenceCount} declaration references`:''}`));
  entry.append(summary);
  entry.addEventListener('toggle',()=>{
    if(!entry.open||entry.childNodes.length>1)return;
    entry.append(button('Show node',()=>showPreviewNode(target.id,'modules')));
    const declarations=(target.declarations||[]).map(id=>state.declIndex.map.get(id)).filter(Boolean);
    if(!declarations.length)entry.append(element('p',{class:'muted'},target.external
      ?'Source not scanned for this external module.'
      :'This file has no scanned declarations to preview.'));
    for(const decl of declarations) {
      entry.append(element('h4',{class:'dependency-preview-name'},decl.fullName),
        codeBlock(decl.previewStatement??decl.statement??decl.signature,{line:decl.line}));
    }
  });
  return entry;
}

function showDetail(){
  const request=++state.detailRequest;
  const panel=$('inspector'),index=currentIndex(),d=index?.map.get(state.selected);
  if(!d){panel.replaceChildren(...[...intro.childNodes].map(n=>n.cloneNode(true)));return;}
  const status=d.external?'external':d.kind==='axiom'?'axiom':d.hasSorry?'sorry':'clear';
  const tags=element('div');tags.append(element('span',{class:'pill'},d.kind));
  tags.append(element('span',{class:'pill'},`Importance: ${currentScores().get(d.id)}`));
  if(!d.external)tags.append(element('span',{class:`pill ${status}`},status==='sorry'?`${d.sorryCount} sorry / admit`:status==='axiom'?'Assumed axiom':'No sorry found'));
  panel.replaceChildren(tags,element('h3',{class:'detail-name'},d.fullName),element('div',{class:'detail-file'},d.file?`${d.file}${d.line?' : '+d.line+'–'+d.endLine:''}`:'External import; source not scanned'));
  const pin = element('input',{type:'checkbox',id:'pin-node'});
  pin.checked = state.pins[state.mode].has(d.id);
  pin.disabled = state.excluded[state.mode].has(d.id);
  if(pin.disabled)pin.title='Uncheck Exclude node before pinning.';
  pin.onchange = () => changeNodePolicy([d.id],'pin',pin.checked);
  const pinLabel=element('label',{class:'check pin-control'});
  pinLabel.append(pin,document.createTextNode('Pin node'));
  panel.append(pinLabel);
  const exclude=element('input',{type:'checkbox',id:'exclude-node'});
  exclude.checked=state.excluded[state.mode].has(d.id);
  exclude.onchange=()=>changeNodePolicy([d.id],'exclude',exclude.checked);
  const excludeLabel=element('label',{class:'check pin-control'});
  excludeLabel.append(exclude,document.createTextNode('Exclude node'));panel.append(excludeLabel);
  if(!exclude.checked&&state.hidden[state.mode].has(d.id))panel.append(element('p',{class:'muted'},'Temporarily hidden. Search again, expand a connected node, or choose Show node to restore it.'));
  if(exclude.checked)panel.append(element('p',{class:'muted'},'Excluded from this graph view. Uncheck Exclude node to show it again. Search, expansion, and Show node do not override exclusion.'));
  if(d.file && !d.external) {
    const href='/source?file='+encodeURIComponent(d.file)+(d.line?'#L'+d.line:'');
    panel.append(element('a',{class:'source-file-button',href,target:'_blank',rel:'noopener noreferrer',
      title:d.line?`Open complete Lean file at line ${d.line} in a new tab`:'Open complete Lean file in a new tab'},'Open Lean file ↗'));
  }
  if(state.mode==='declarations') {
    const tabs=element('div',{class:'detail-tabs',role:'group','aria-label':'Node details'});
    for(const [id,title] of [['statement','Statement'],['diff','Recent diff'],['source','Full Source']]) {
      const b=button(title,()=>{state.detailView=id;showDetail();});
      b.setAttribute('aria-pressed',String(state.detailView===id));tabs.append(b);
    }
    const content=element('div',{id:'node-content'});panel.append(tabs,content);
    nodeContent(d,content,request);
  }
  const actions=element('div',{class:'detail-actions'});
  if(d.file)actions.append(button('Show all declarations in this file',()=>{
    if(state.mode==='modules')switchMode('declarations',{restore:false});
    clearTimeout(searchTimer);searchTimer=null;clearFilters();$('file').value=d.file;
    restartTreeSearch();showDetail();
  }));
  panel.append(actions);
  for(const [title,ids] of [['Dependencies',index.out.get(d.id)||[]],['Used by',index.incoming.get(d.id)||[]]]){
    panel.append(element('h4',{class:'detail-section'},`${title} (${ids.length})`));
    const list=element('div',{class:'ref-list','aria-label':title});
    for(const id of ids){
      const target=index.map.get(id);
      if(target) {
        if(title==='Dependencies') {
          if(state.mode==='declarations')list.append(declarationPreview(target,'Show node'));
          else list.append(moduleDependencyPreview(target,state.moduleEdges.find(e=>e.from===d.id&&e.to===id)));
        }
        else if(state.mode==='declarations'&&title==='Used by')list.append(declarationPreview(target));
        else {
          const item=button(target.fullName,()=>select(id,true));
          if(state.mode==='modules') {
            const edge=state.moduleEdges.find(e=>title==='Dependencies'?e.from===d.id&&e.to===id:e.from===id&&e.to===d.id);
            item.append(element('span',{class:'relationship-note'},
              `${edge.explicit?'Explicit import':'Inferred use'}${edge.referenceCount?` · ${edge.referenceCount} declaration references`:''}`));
          }
          list.append(item);
        }
      }
    }
    if(!list.childNodes.length)list.append(element('p',{class:'muted'},'None found in this source graph.'));
    panel.append(list);
  }
  if(state.mode==='modules'&&!d.external){
    panel.append(element('h4',{class:'detail-section'},`Declarations (${d.declarations.length})`));
    const list=element('div',{class:'ref-list'});
    for(const id of d.declarations){
      const decl=state.declIndex.map.get(id);
      if(!decl)continue;
      list.append(declarationPreview(decl));
    }
    panel.append(list);
  }
}

function download(blob,name){const a=element('a',{href:URL.createObjectURL(blob),download:name});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('copy-image').onclick=async()=>{
  if(!state.graph||!state.shown.size||state.copying)return;
  const b=$('copy-image'),status=$('copy-status');
  state.copying=true;b.disabled=true;b.textContent='Copying...';status.textContent='';
  try {
    if(!navigator.clipboard?.write||!globalThis.ClipboardItem)throw new Error('Image copying is unavailable in this browser.');
    // Start the clipboard write within the click gesture, with a promised PNG,
    // so browsers requiring transient user activation can await rasterization.
    const png=graphImage(svg,state.layout);
    png.catch(()=>{}); // The clipboard write below reports failures to the UI.
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
    status.textContent='Image copied';
  } catch(e) {
    status.textContent='Copy failed';
    error(`Could not copy image: ${e.message}`);
  } finally {state.copying=false;b.disabled=!state.shown.size;b.textContent='Copy Image';}
};

let expansionSnapshot=null, viewportResizeSuspended=false;
function toggleExpansion() {
  viewportResizeSuspended=true;
  const main=document.querySelector('main');
  if(!expansionSnapshot) {
    syncViewportSize();
    expansionSnapshot={view:[...state.view],viewportSize:[...state.viewportSize],inspectorScroll:$('inspector').scrollTop,mainScroll:main.scrollTop};
    document.body.classList.add('graph-expanded');
    updateView();
  } else {
    document.body.classList.remove('graph-expanded');
    state.view=expansionSnapshot.view;state.viewportSize=expansionSnapshot.viewportSize;updateView();
    $('inspector').scrollTop=expansionSnapshot.inspectorScroll;main.scrollTop=expansionSnapshot.mainScroll;
    expansionSnapshot=null;
  }
  const expanded=Boolean(expansionSnapshot),button=$('expand-graph');
  button.querySelector('path').setAttribute('d',expanded
    ?'M3 12H21 M3 8L7 12L3 16 M21 8L17 12L21 16'
    :'M3 12H21 M7 8L3 12L7 16 M17 8L21 12L17 16');
  button.setAttribute('aria-label',expanded?'Restore page layout':'Expand diagram');
  button.setAttribute('aria-expanded',String(expanded));
  button.title=expanded?'Restore the previous page layout (Escape)':'Expand the diagram to fill this page';
  requestAnimationFrame(()=>{viewportResizeSuspended=false;});
}
$('toggle-menus').onclick=()=>{
  syncViewportSize();
  const folded=document.body.classList.toggle('menus-folded');
  const label=folded?'Show controls above diagram':'Hide controls above diagram';
  $('toggle-menus').setAttribute('aria-expanded',String(!folded));
  $('toggle-menus').setAttribute('aria-label',label);
  $('toggle-menus').title=label;
  updateView();
};
$('expand-graph').onclick=toggleExpansion;
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&expansionSnapshot){e.preventDefault();toggleExpansion();$('expand-graph').focus();}
});
$('export-pdf').onclick=async()=>{
  if(!state.graph||!state.shown.size)return;
  const b=$('export-pdf');b.disabled=true;b.textContent='Saving PDF...';
  try{
    const name=`${state.graph.project.name}-${state.mode}.pdf`;
    download(await graphPdf(svg,state.layout),name);
  }catch(e){error(`Could not save PDF: ${e.message}`);}
  finally{b.disabled=!state.shown.size;b.textContent='Save PDF';}
};
$('export-json').onclick=async()=>{try{download(new Blob([JSON.stringify(await json('/api/export'),null,2)],{type:'application/json'}),`${state.graph.project.name}-graph.json`);}catch(e){error(e.message);}};
$('export-svg').onclick=async()=>{
  if(!state.graph)return;
  try{
    const copy=svg.cloneNode(true),css=await fetch('/style.css').then(r=>r.text());
    copy.setAttribute('xmlns',NS);copy.setAttribute('width','1600');copy.setAttribute('height',String(Math.round(1600*state.view[3]/state.view[2])));
    copy.removeAttribute('id');copy.removeAttribute('tabindex');
    copy.insertBefore(S('style',{},css),copy.firstChild);
    download(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}),`${state.graph.project.name}-${state.mode}.svg`);
  }catch(e){error(e.message);}
};
$('declarations').onclick=()=>switchMode('declarations');$('modules').onclick=()=>switchMode('modules');
$('node-back').onclick=()=>navigateNode(-1);$('node-forward').onclick=()=>navigateNode(1);
$('refresh').onclick=()=>load(true);$('fit').onclick=fit;$('zoom-in').onclick=()=>zoom(.75);$('zoom-out').onclick=()=>zoom(1/.75);
for (const [id, pin] of [['pin-all',true],['unpin-all',false]]) $(id).onclick=()=>{
  changeNodePolicy(state.shown,'pin',pin);
};
$('exclude-all').onclick=()=>changeNodePolicy(state.shown,'exclude',true);
$('unexclude-all').onclick=()=>changeNodePolicy(state.excluded[state.mode],'exclude',false);
$('clear-selection').onclick=()=>{state.selected=null;state.focus=null;render();showDetail();};
let searchTimer;
function restartTreeSearch(){
  if(!searchPattern())return;
  state.expanded[state.mode].clear();state.expandedParents[state.mode].clear();state.hidden[state.mode].clear();state.treeReveal=null;state.focus=null;render();
}
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;restartTreeSearch();},160);};
$('search-mode').onchange=()=>{clearTimeout(searchTimer);searchTimer=null;updateSearchHint();restartTreeSearch();};
updateSearchHint();
for(const id of ['file','kind','status'])$(id).onchange=restartTreeSearch;
$('external').onchange=()=>render();
$('edge-mode').onchange=()=>draw();
for(const [id,step] of [['font-smaller',-.1],['font-larger',.1]])$(id).onclick=()=>{
  if(!state.layout)return;
  state.fontScale[state.mode]=Math.max(.5,Math.min(2.5,Math.round((state.fontScale[state.mode]+step)*10)/10));
  draw();
};
$('module-layout').onchange=()=>render();
$('view-layout').onchange=()=>{
  state.viewLayout[state.mode]=$('view-layout').value;state.treeReveal=null;render();
};
$('tree-expand-all').onclick=()=>{
  // Expand children only from the currently explored nodes, never unrelated trees.
  const pending=[...state.shown],seen=new Set(pending);
  for(let i=0;i<pending.length;i++){
    const id=pending[i],cs=state.treeModel.out.get(id)||[];
    if(cs.length)state.expanded[state.mode].add(id);
    for(const child of cs){state.hidden[state.mode].delete(child);if(!seen.has(child)){seen.add(child);pending.push(child);}}
  }
  render();
};
$('tree-collapse-all').onclick=()=>{
  state.expanded[state.mode].clear();state.expandedParents[state.mode].clear();render();
};
$('importance').replaceChildren(...METRICS.map(m=>element('option',{value:m.id},m.label)));
$('importance').onchange=()=>{render();showDetail();};
$('node-limit').oninput=()=>render();
$('min-score').oninput=()=>render();
$('heat').onchange=()=>{if(state.layout)draw();if($('heat').checked)ensureHistory();};
$('history-window').onchange=()=>{
  $('history-window').value=String(historyWindow());updateHistoryStatus();
  if(state.layout)draw();
  if($('heat').checked)ensureHistory();
  if(state.detailView==='diff')showDetail();
};
$('external').disabled=true;

// A full-height splitter keeps resizing accessible even in a scrolled Inspector.
const resizer=$('inspector-resizer'), inspectorPane=$('inspector-pane');
let panelDrag=null;
function panelWidthBounds(){
  return {min:260,max:Math.max(260,inspectorPane.parentElement.clientWidth-resizer.offsetWidth-280)};
}
function updatePanelWidthAria(){
  const {min,max}=panelWidthBounds(),width=Math.round(inspectorPane.getBoundingClientRect().width);
  resizer.setAttribute('aria-valuemin',String(min));
  resizer.setAttribute('aria-valuemax',String(Math.round(max)));
  resizer.setAttribute('aria-valuenow',String(width));
  resizer.setAttribute('aria-valuetext',`Inspector width ${width} pixels`);
}
function setPanelWidth(width){
  const {min,max}=panelWidthBounds();
  inspectorPane.style.setProperty('--inspector-width',`${Math.max(min,Math.min(max,width))}px`);
}
function endPanelDrag(){
  panelDrag=null;document.body.classList.remove('resizing-inspector');
}
resizer.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  e.preventDefault();resizer.focus();
  panelDrag={id:e.pointerId,x:e.clientX,width:inspectorPane.getBoundingClientRect().width};
  resizer.setPointerCapture(e.pointerId);document.body.classList.add('resizing-inspector');
});
resizer.addEventListener('pointermove',e=>{
  if(panelDrag?.id===e.pointerId)setPanelWidth(panelDrag.width+panelDrag.x-e.clientX);
});
resizer.addEventListener('pointerup',e=>{
  if(panelDrag?.id!==e.pointerId)return;
  endPanelDrag();resizer.releasePointerCapture(e.pointerId);
});
resizer.addEventListener('pointercancel',endPanelDrag);
resizer.addEventListener('lostpointercapture',endPanelDrag);
resizer.addEventListener('keydown',e=>{
  const {min,max}=panelWidthBounds(),width=inspectorPane.getBoundingClientRect().width;
  const step=e.shiftKey?50:20;
  const next={ArrowLeft:width+step,ArrowRight:width-step,Home:min,End:max}[e.key];
  if(next!==undefined){e.preventDefault();setPanelWidth(next);}
});
const panelSizeObserver=new ResizeObserver(updatePanelWidthAria);
panelSizeObserver.observe(inspectorPane);panelSizeObserver.observe(inspectorPane.parentElement);
new ResizeObserver(()=>{if(!viewportResizeSuspended)updateView();}).observe(svg);
const initialViewControls=captureViewControls();
load();
