# Third-party notices

This tool contains adaptations of [Archon](https://github.com/frenzymath/Archon),
licensed under Apache License 2.0. A copy of that license is included as `LICENSE`.

Source revision: `3fe2618870808d8c20912ab8b5aff80af275a1de`.

Adapted components:

- `src/archon/ui/client/src/views/ProofGraph.tsx`: the `doLayout` file-group
  algorithm and its geometry approach were ported to `lean_graph/web/layout.js`.
  The port preserves top-aligned, shortest-column shelves and one/two/three inner
  node columns. It changes geometry, indexes declarations by file, returns plain
  JavaScript data, and removes React and Archon iteration/agent state.
- `src/archon/ui/server/src/routes/proofgraph.ts`: source scanning and the
  declaration/reference graph approach informed `lean_graph/scanner.py`.
  The Python adaptation adds comment/string masking, namespaces, import visibility,
  Unicode names, anonymous nodes, unique source IDs, exclusions, and explicit
  source-analysis labeling. It does not use Archon journal or git metadata.

The browser app, Python server, CLI, import layout, and tests were developed for
this standalone tool. No code from Archon's separately bundled MIT-licensed
`lean4-skills` or `lean-lsp-mcp` components is included here.
