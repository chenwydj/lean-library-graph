/** Pivotality metrics. Pure functions, independent of the UI and Git history.
 *
 * CUSTOMIZATION: add a {id, label, description, score(node, context)} entry to
 * METRICS. The dropdown discovers it automatically. Larger scores rank first.
 * context.nodes/outgoing/incoming are Maps; adjacency values are Sets of IDs.
 * context.transitiveUsers(id) returns a Set of all reachable users, excluding
 * the node itself, and caches the result for this graph snapshot.
 * Scores always use the FULL graph, before file/search/status/render filters.
 */
export const METRICS = [
  {id: 'direct-users', label: 'Direct users',
    description: 'Number of distinct nodes that directly reference this node.',
    score: (node, context) => context.incoming.get(node.id).size},
  {id: 'transitive-users', label: 'Transitive users',
    description: 'Number of distinct direct and indirect users; cycles count each other node once.',
    score: (node, context) => context.transitiveUsers(node.id).size},
  {id: 'cross-file-users', label: 'Reuse across files',
    description: 'Number of other files containing at least one direct user.',
    score: (node, context) => new Set([...context.incoming.get(node.id)]
      .map(id => context.nodes.get(id)?.file)
      .filter(file => file && file !== node.file)).size},
];

export function createContext(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map(nodes.map(n => [n.id, new Set()]));
  const outgoing = new Map(nodes.map(n => [n.id, new Set()]));
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from).add(edge.to);
    incoming.get(edge.to).add(edge.from);
  }
  const cache = new Map();
  return {nodes: byId, incoming, outgoing, transitiveUsers(id) {
    if (cache.has(id)) return cache.get(id);
    const seen = new Set([id]), queue = [id];
    for (let i = 0; i < queue.length; i++) for (const user of incoming.get(queue[i]) || []) {
      if (!seen.has(user)) { seen.add(user); queue.push(user); }
    }
    seen.delete(id); cache.set(id, seen); return seen;
  }};
}

export function scoreNodes(context, metricId, registry = METRICS) {
  const metric = registry.find(metric => metric.id === metricId);
  if (!metric) throw new Error(`Unknown importance metric: ${metricId}`);
  return new Map([...context.nodes.values()].map(node => {
    const score = metric.score(node, context);
    if (!Number.isFinite(score) || score < 0) throw new Error(`Invalid importance score for ${node.id}`);
    return [node.id, score];
  }));
}

export function rankAndFilter(nodes, scores, {minimum = 0, limit = 200, focusId = null} = {}) {
  // A focus root remains visible and consumes one of the allowed slots.
  const ranked = nodes.filter(n => (scores.get(n.id) || 0) >= minimum || n.id === focusId)
    .sort((a, b) => (b.id === focusId ? 1 : 0) - (a.id === focusId ? 1 : 0)
      || (scores.get(b.id) || 0) - (scores.get(a.id) || 0)
      || a.id.localeCompare(b.id));
  return {eligible: ranked.length, nodes: limit > 0 ? ranked.slice(0, limit) : ranked};
}
