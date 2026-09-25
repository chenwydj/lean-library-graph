import {rankAndFilter} from './importance.js';

// One update path for individual checkboxes and bulk actions. Enabling either
// policy clears the other; disabling one does not resurrect an old policy.
export function updateNodePolicy(pinnedIds, excludedIds, ids, policy, enabled) {
  const pins=new Set(pinnedIds), excluded=new Set(excludedIds);
  const target=policy==='pin'?pins:excluded, other=policy==='pin'?excluded:pins;
  for(const id of ids) {
    if(enabled){target.add(id);other.delete(id);}else target.delete(id);
  }
  return {pins,excluded};
}

export function updateVisiblePins(pinnedIds, visibleIds, pin) {
  const result = new Set(pinnedIds);
  // Operate on this render's snapshot, not nodes revealed by the next render.
  for (const id of visibleIds) {
    if (pin) result.add(id); else result.delete(id);
  }
  return result;
}

// Named declarations retain their pins when source edits move their line numbers.
// Anonymous declarations use their snapshot ID because their names are unstable.
export function pinKey(node) {
  return JSON.stringify(node.kind === 'module' || node.external
    ? ['module', node.id]
    : node.anonymous ? ['anonymous', node.id] : [node.file, node.kind, node.fullName]);
}

export function restorePins(keys, nodes) {
  const grouped = new Map();
  for (const node of nodes) {
    const key = pinKey(node);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node.id);
  }
  // Drop deleted or ambiguous nodes instead of pinning an arbitrary replacement.
  return new Set(keys.flatMap(key => grouped.get(key)?.length === 1 ? grouped.get(key) : []));
}

export function visibleWithPins(candidates, allNodes, pinnedIds, scores, options = {}) {
  // Pins bypass search, file, kind, status, focus, score, and count filters.
  // The count limit is an allowance for additional unpinned nodes.
  const excluded = options.excludedIds || new Set();
  const pinned = allNodes.filter(node => pinnedIds.has(node.id) && !excluded.has(node.id));
  const ranked = rankAndFilter(candidates.filter(node => !pinnedIds.has(node.id) && !excluded.has(node.id)), scores, options);
  return {nodes: [...pinned, ...ranked.nodes], eligible: pinned.length + ranked.eligible,
    pinnedCount: pinned.length};
}

// Hide is transient and does not alter pins or exclusions. Opening a branch
// restores hidden direct neighbors. Closing also folds file/search seed neighbors
// that would otherwise remain visible solely because they match the starting set.
export function updateDisclosure({id, neighbors, expanded, hidden, shown, seeds, pins}) {
  const open = neighbors.length > 0 && neighbors.every(n=>shown.has(n));
  const nextExpanded=new Set(expanded), nextHidden=new Set(hidden);
  if(open) {
    nextExpanded.delete(id);
    for(const n of neighbors)if(n!==id&&seeds.has(n)&&!pins.has(n))nextHidden.add(n);
  } else {
    nextExpanded.add(id);
    for(const n of neighbors)nextHidden.delete(n);
  }
  return {expanded:nextExpanded,hidden:nextHidden};
}
