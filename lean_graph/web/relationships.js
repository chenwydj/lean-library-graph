// Project declaration references onto their containing modules. Preserve explicit
// imports, merge repeated module pairs, and omit within-file references.
export function moduleRelationships(imports, declarations, references) {
  const modules = new Map(declarations.map(d => [d.id, d.module]));
  const pairs = new Map();
  const key = (from, to) => JSON.stringify([from, to]);
  for (const e of imports) pairs.set(key(e.from, e.to), {...e, explicit: true, referenceCount: 0});
  const seen = new Set();
  for (const e of references) {
    const from = modules.get(e.from), to = modules.get(e.to), reference = key(e.from, e.to);
    if (!from || !to || from === to || seen.has(reference)) continue;
    seen.add(reference);
    const pair = key(from, to);
    if (!pairs.has(pair)) pairs.set(pair, {from, to, explicit: false, referenceCount: 0});
    pairs.get(pair).referenceCount++;
  }
  return [...pairs.values()];
}

// Edges point from users to dependencies. Traverse both dependencies and users
// transitively, each starting at the selection. Keep these traversals separate:
// changing direction mid-path would include unrelated users of a shared dependency
// or unrelated dependencies of a shared user. Only visible edges are passed in.
export function selectionEdgeDistances(edges, selected) {
  const result = new Map();
  if (!selected) return result;
  const out = new Map(), incoming = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e);
  }
  for (const [index, next] of [[out, 'to'], [incoming, 'from']]) {
    const distances = new Map([[selected,0]]), pending = [selected];
    for (let i = 0; i < pending.length; i++) {
      for (const e of index.get(pending[i]) || []) {
        if (!distances.has(e[next])) {
          distances.set(e[next],distances.get(pending[i])+1);pending.push(e[next]);
        }
      }
    }
    // Complete BFS before assigning edge depths so shortcuts and input ordering
    // cannot change the result. Direct incident edges always have distance 1.
    for(const id of pending)for(const e of index.get(id)||[]) {
      const distance=1+Math.min(distances.get(e.from),distances.get(e.to));
      result.set(e,Math.min(result.get(e)??Infinity,distance));
    }
  }
  return result;
}

export function selectionEdges(edges, selected) {
  return new Set(selectionEdgeDistances(edges,selected).keys());
}

// Keep the visual mapping independent of traversal and rendering for tuning.
// Exponential fading retains a visible light-blue floor on very long chains.
export function arrowEmphasis(distance) {
  const strength=Math.pow(.45,Math.max(0,distance-1));
  const dark=[12,53,138], light=[190,214,243];
  const rgb=light.map((value,i)=>Math.round(value+(dark[i]-value)*strength));
  return {color:`rgb(${rgb.join(', ')})`,width:.65+4.85*strength};
}
