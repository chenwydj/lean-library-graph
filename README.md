# Lean Library Graph

A standalone localhost explorer for Lean source libraries, based on
[Archon's Proof Graph](https://github.com/frenzymath/Archon).
It reuses Archon's file-group layout and source-scanning approach, with a new
Python server and framework-free SVG interface. Python 3.10 or newer is the
only runtime dependency. No Lean build, Node, network access, or Archon metadata
is needed to use the tool. Git is optional and enables activity coloring and diffs.

## Run it

From the directory containing this README:

```sh
python3 . ../pde_ai --open
```

Or run from any working directory:

```sh
python3 /path/to/lean-library-graph \
  /path/to/lean-library --open
```

The URL is [http://127.0.0.1:8765](http://127.0.0.1:8765).
Stop with Ctrl+C. Use `--port 8766` for another simultaneous library, or
`--port 0` to select a free port. The terminal prints the actual URL.

To visualize another library, replace the library argument:

```sh
python3 . /path/to/another/lean/project --open
```

The tool reads the selected source directory. It does not build, edit, or add
files to that library. All browser assets are bundled and served locally.

Optional installation into your own Python environment provides a command:

```sh
python3 -m pip install .
lean-library-graph /path/to/library --open
```

## Explore

- **Declarations:** Archon's grouped SVG layout, one group per file. Click a node
  to inspect the fully qualified name, line range, statement, references, and users.
  The inspector opens on **Statement**: lemmas/theorems show everything before
  `:= by`; definitions, structures, instances, and other declarations show their
  complete source. Switch to **Recent diff** for declaration-scoped Git changes or **Full Source**
  for the complete declaration.
- In the declaration Inspector, **Used by** boxes expand inline to show the
  user's declaration before its top-level `:= by`, with wrapping and file line
  numbers. Expanding or collapsing keeps the current node and graph unchanged.
  **Show in Declarations** explicitly selects and reveals the referenced node.
- **Open Lean file** in the Inspector opens the entire source file in a new
  browser tab. Module nodes open at the beginning; declaration nodes jump to
  their starting line, highlighted in yellow. Line numbers are clickable links.
  The page includes imports, comments, definitions, and complete proofs, with a
  **Raw source** link. It uses the graph's source snapshot; Refresh sources in
  the graph and reload the source tab after edits. External import placeholders
  have no local source button.
  Anonymous instances and examples have source-coordinate labels.
- **File (Module):** a layered graph of explicit imports and inferred declaration use, including files that
  contain no declarations. Arrows point from an importing module to its dependency.
  External imports can be shown as collapsed placeholders. Click a local module
  to list its declarations in the Inspector. Click a declaration box to expand
  its Lean code before the top-level `:= by`, without leaving File (Module);
  click again to collapse it. This preview omits tactic bodies for any declaration
  kind, and keeps the complete source when no such boundary exists.
  **Show in Declarations** explicitly switches views and selects that declaration.
  **Show all declarations in this file** shows the file's declarations together in the declaration graph.
- Both views use the expandable tree described below. The previous folder,
  dependency-layer, and declaration-file layouts remain implemented but are hidden
  from the UI for now.
- All Inspector code snippets wrap to the panel width while preserving indentation.
  Statement, Full Source, and module previews show original Lean file line numbers;
  wrapped continuations do not get extra numbers. Recent diff has separate old/new
  line gutters, relative to the declaration in each revision.
- Drag the **↔ divider** between the diagram and Inspector left or right to resize
  the panel. It remains accessible while the Inspector scrolls. You can also focus
  it and use Left/Right (Shift for larger steps), or Home/End for width limits.
  On narrow screens the panels stack vertically and the divider is hidden.
- **← / →** at the top-right of the diagram navigate node visits across both
  Declarations and File (Module). Switching views preserves each view's search
  mode and filters, expanded/folded and temporarily hidden nodes, selection, edge
  settings, and zoom/pan. An unselected file overview is preserved too, including
  after **Show all declarations in this file**. These view snapshots last for the
  current page session. Navigation reveals the node even outside current filters or the
  node cap. Expanding an inline preview does not add a visit; choosing **Show in
  Declarations** does. A new visit after going back replaces the forward path.
  History lasts for the current page session; source refresh drops visits whose
  node IDs no longer exist, and reloading the page starts a new history.
- Search across names, namespaces, and file paths. Filter by file, kind, or status.
  For example, search `WeakFormulation` in `pde_ai`, then select `IsWeakSolution`.
- **Importance** computes direct users (default), transitive users, or reuse
  across files over the full graph. Values appear in the Inspector, not node labels.
  The **Importance** selector is hidden; its metrics remain implemented.
  **Minimum score** and **Max nodes** are hidden for now, with both set to 0
  (no threshold or cap). Their ranking/filtering implementations remain available.
- **Hide** at the top-right of each node temporarily hides it without changing its
  pin or exclusion status. Restore it with a new search/file selection, by expanding
  a connected node, or by choosing **Show node** in a dependency preview. Hide state
  lasts only for this page session. **Exclude node** is persistent and search,
  expansion, and navigation never override it.
- Inspector **Dependencies** boxes unfold code before `:= by` without navigating
  or changing the diagram. A separate **Show node** button reveals and selects
  the dependency. Module dependency previews show their scanned declarations;
  import-only files and unscanned external modules display an explanatory note.
- Select a node and check **Pin node** in the Inspector to keep it visible through
  search, file/kind/status filters, focus, and node limits.
  Small blue pin icons mark pins. **Pin all** pins the nodes
  currently rendered; **Unpin all** unpins only the currently rendered nodes.
  Both affect only the active graph view. Existing pins kept visible outside
  search filters are included. Button counts indicate how many nodes will change.
  Pin all acts once on the current render; additional nodes revealed afterward
  by the unpinned-node allowance are not automatically pinned.
  Declaration and module pins are remembered separately for each library in this
  browser, including after reload. Named pins survive source line shifts; deleted
  or ambiguous declarations are dropped on refresh. Pinning preserves visibility,
  not a fixed position in the layout.
- **Color by changes** switches to a light-to-dark orange scale for the number
  of commits changing each node. Set **Recent commits** from 1 to 200 (default
  20). History loads on demand, so the initial graph needs neither Git nor a build.
- Use each graph node’s **Parents** and **Children** controls to explore references.
  The Inspector retains dependency/user lists for reading and navigation; legacy
  Neighborhood, Dependencies, Used by, and Show all focus buttons are removed.
- Scroll to zoom, drag to pan, or use the zoom buttons. **Fit** frames the current
  filtered graph. With the canvas focused, arrow keys pan, `+`/`-` zoom, and `0` fits.
  Double-click a file group to isolate it. Full names and paths appear on hover.
- Automatic edge display shows all visible connections up to 1,200 edges, then
  shows complete visible dependency and user paths of the selected node to keep a large overview
  readable. The **Edges** menu can override this. For large libraries, start with
  File (Module), search a topic, or isolate a file before inspecting declarations.
- **Refresh sources** rescans the directory, including added and deleted files.
  It also clears Git history caches. The server otherwise serves a consistent
  in-memory snapshot; use Refresh after source edits or new commits.
- **Export JSON** includes the full graph and declaration bodies. **Save SVG**
  exports the current viewport, filters, selection, and visible edges.
- The **up-chevron** at the right of the diagram toolbar folds the page title,
  statistics, search, and analysis controls above the diagram. The down-chevron
  restores them with their values unchanged. The diagram toolbar and Inspector
  remain available, and zoom is preserved. This folded state also survives a
  full-page Expand/Restore cycle for the current page session.
- The **diagonal expansion arrows (↙ / ↗)**, immediately right of the up-chevron, fills the page with the graph, hiding
  the title, filter bars, and Inspector. The restore button and bottom controls
  remain available. Click the icon again, or press Escape, to return to the previous panel layout,
  scroll positions, and graph zoom/pan. Expansion works within the page and does
  not change the browser window or your filter, pin, and exclusion settings.
- **A− / A+**, beside Edges, decrease/increase diagram text in 10% steps from
  50% to 250%. Node names, metadata, file labels, folder labels, and folder counts
  scale together. Node positions, graph zoom, and Inspector text do not change.
  Long labels truncate to fit; hover still shows full names. Each graph view
  remembers its size until reload. The buttons remain available in expanded mode,
  and SVG, PDF, and Copy Image exports include the selected size.
- **Copy Image**, beside Save PDF, copies the complete filtered graph as a PNG
  with a white background, current colors, folder boxes, and displayed arrows.
  Like PDF, it includes the full layout regardless of viewport zoom or pan. The
  button confirms success or reports browser clipboard errors. Image dimensions
  are capped at 8192 pixels per side and 32 megapixels. Copying requires a browser
  with image clipboard support; localhost is a supported secure context.
- **Save PDF** downloads a single-page PDF of the entire filtered graph in either
  view, including pins, current colors, selection styling, and displayed edges.
  Pan and zoom do not crop the export. The Inspector and toolbars are excluded.
  The PDF embeds a high-resolution image (up to 8,192 pixels per side and 32
  megapixels), preserving Unicode labels without extra packages or network calls.
  Filter large graphs for readable exports; use SVG for vector scaling and text.

Colors indicate source findings: green means no `sorry` or `admit` token was
found; red means at least one was found; purple marks an axiom. No color is a
Lean verification result. Comments, ordinary/raw strings, character literals,
and quoted identifiers such as `«sorry»` do not count as proof holes.

## Customize importance

Edit `lean_graph/web/importance.js`. Its pure `METRICS` registry is separate from
rendering, filtering, and Git activity. Add an entry and reload the page; it
appears in the dropdown automatically. For example:

```js
{id: 'weighted-reuse', label: 'Weighted reuse',
 description: 'Direct users count twice, indirect users once.',
 score: (node, context) => context.incoming.get(node.id).size
   + context.transitiveUsers(node.id).size},
```

`context.nodes` maps IDs to node records. `incoming` and `outgoing` map IDs to
sets of immediate users and dependencies. `transitiveUsers(id)` returns a cached
set of distinct reachable users, excluding the node itself even in cycles.
Return a finite, nonnegative number; larger scores rank first. Equal scores use
the node ID as a stable tiebreak. Metrics apply to declaration and module views.
Declaration scores reflect inferred references, not kernel-verified dependencies.

## Git activity and diffs

The window is the repository's last N **first-parent commits**, including commits
that do not touch Lean. Each commit is compared to its first parent. A node gets
one change when its complete source declaration differs, including statement,
proof, and internal comments or whitespace. Creation counts as one change.
The scale uses the maximum across the full graph, so filters keep colors stable.
Module colors count commits changing any parsed declaration in that file.

Named declarations are matched by kind and fully qualified name. The history
walker follows Git-detected file renames. A pure file rename or line shift outside
the declaration does not count. Declaration name changes and moves between files
are not followed; anonymous declarations are matched by kind and ordinal, which
is approximate. Duplicate or untracked declarations are shown as unknown.
Attributes/doc comments preceding the scanner's declaration boundary are excluded.

Uncommitted source edits are flagged in the inspector and excluded from commit
counts and diffs. **Recent diff** initially shows the latest changing commit in
the window; its dropdown selects earlier changes. Diffs include both statement
and proof, and their hunk line numbers are relative to the declaration. Libraries
without Git still support all source and importance views. Shallow-history gaps
are reported. Large histories can take time to read; repeated requests are cached.

## Source roots and exclusions

By default, paths relative to the supplied directory determine module names:
`Foo/Bar.lean` becomes `Foo.Bar`. All source files are included except
`lakefile.lean`, hidden directories, `.lake`, `_lake`, `.archon`, `node_modules`,
`build`, `dist`, and Python environment/cache directories. Symlinked files and
directories are not traversed. Unreadable files are reported in the UI.

For a Lake project using a custom `srcDir`, supply its import search root:

```sh
python3 . /path/to/project --source-root src --open
```

You may repeat `--source-root` for separate, nonoverlapping source trees. The tool
does not execute or infer arbitrary Lake configuration. Root directories must be
inside the supplied library. Exclusions match a relative path glob or basename:

```sh
python3 . ../pde_ai --exclude 'Problems/**' --exclude LiterateExtract.lean --open
```

Dependencies under `.lake/packages` are omitted by default. To explore a dependency
itself, point the tool directly at that package directory. Import targets outside
the selected source roots appear as external placeholders.

## Excluding nodes

Check **Exclude node** in the Inspector to hide a module or declaration and its
arrows. The Inspector remains open so you can undo the exclusion. **Pin node**
and **Exclude node** are mutually exclusive. Excluding a node clears its pin;
uncheck Exclude node before pinning it again.
Exclusions apply before score and count limits; another eligible node can fill
the freed slot. Excluded nodes stay hidden during navigation, even when focused.
Their Inspector can still be opened through history or reference lists.

**Exclude all** excludes the currently rendered nodes, including pins. It uses
that visible snapshot, so nodes subsequently revealed by Max nodes are not also
excluded. **Un-exclude all** clears every exclusion in the current view, including
nodes outside the current search. Restored nodes follow the current filters and
node limit; previous pins are not reinstated. Exclusions are saved per library
and view across reloads, using the same stable source identities as pins. They
only change visualization: source files and full-graph importance scores remain
unchanged.

## Expandable tree

Both Declarations and File (Module) always open in tree mode. Use Search or
choose a **File** to display starting nodes. **Search mode** selects exactly one
interpretation, applied case-insensitively:

- **Wildcard** (default): matches an entire short name, full name, file path,
  filename, or filename without `.lean`. `Problem1` matches exactly that name;
  `Problem1*` also matches `Problem1037`. `*` means zero or more characters and `?`
  means one character. All other characters, including regex punctuation, are
  literal. Use `*Heat*` for a substring search.
- **Regex**: JavaScript regular expressions against full names and file paths,
  separately. Use bare patterns without `/` delimiters: `Heat|Wave` matches either
  term, `WaveIVP[123]D$` matches those name endings, and `^PDE\.Basics\.Wave\.`
  matches a namespace prefix. Escape literal punctuation, for example `\.lean$`.
  Invalid patterns show an inline error and preserve the previous diagram.

Switching modes reinterprets the existing input and starts a fresh collapsed tree.
With neither Search nor File selected, the canvas prompts you to begin (saved pins
can still appear). Matching nodes are shown without a hidden 200-node cap. Search
and File combine when both are set; Kind and Status narrow declaration starts.

Every node has two independent **+ / −** buttons:

- **Parents** reveals nodes that use/import this node, placed above it.
- **Children** reveals dependencies used/imported by this node, placed below it.

Zoom does not automatically fit when nodes are added or removed. Expanding a
branch preserves the clicked node's screen position and size. Search, navigation,
Inspector resizing, and page expansion preserve the current scale as well. New
searches pan to a starting node without shrinking it. Drag to pan and use the wheel
or +/- controls to zoom. **Fit** (or `0` with the canvas focused) is explicit only.

Expansion can reveal nodes outside the search, file, kind, or status selection.
Exclusions still apply; external imports require the External imports checkbox
unless pinned. Clicking the node body opens its Inspector; click a disclosure
button to choose which direction to expand. Up/Down on a focused node toggles
parents/children; Enter/Space on a disclosure button toggles that direction.

**Expand all children** follows dependencies from the current visible nodes.
**Collapse all** closes both directions, retaining starting nodes, pins, and any
node revealed by Inspector/history navigation, unless temporarily hidden. A new search or file/filter change
starts fresh with collapsed branches and clears temporary Hide state. Parent and
child controls also fold matching starting nodes, so showing every declaration
in a file does not prevent parent folding. Pinned starting nodes remain visible
when folding a branch. Shared nodes appear once and remain visible
while another open path or starting node still reaches them. Arrows retain their
user-to-dependency direction and existing highlighting. Cycles share a row because
no strict top-down order is possible within a cycle.

`exploreTreeLayout` in `web/layout.js` handles bidirectional disclosure and layout.
The original `treeLayout`, folder/dependency layouts, importance metrics, and score
and node-limit calculations remain available in code. Their UI switches are hidden
for now. No Lean build or elaboration is needed.

## Controls retained in code but hidden from the UI

- Importance selection: direct users, transitive users, and cross-file reuse.
  Scores are still calculated and shown in the Inspector, but not on graph nodes.
- Minimum score and Max nodes: ranking, threshold, and count-limit functions.
- Graph layout selection: declaration file grouping, module folder hierarchy,
  and module dependency layers; the active UI uses expandable trees.
- Inspector Neighborhood, Dependencies, and Used by focus actions: the `focus`
  and `focusSet` functions retain their traversal logic. The old Show all button
  was removed; the filter/focus reset logic remains.

## Analysis accuracy

In File (Module), solid arrows show both explicit source imports and cross-file
dependencies inferred from declaration references, including use via transitive
umbrella imports. References within the same file are omitted. Each module pair
gets one arrow, even when supported by both imports and declaration references.
Hover an arrow or inspect Dependencies / Used by to see its kind and the
number of distinct declaration-reference pairs supporting it. Module ranking and
focus use this combined graph; the import statistic and exported `moduleEdges`
still describe explicit imports. The browser derives the additional arrows from
the exported declarations and declaration edges in `web/relationships.js`.

In both views, selecting a node highlights complete visible paths in both
directions: dependencies and transitive users. For example, selecting HeatKernelND
highlights PDE → HeatMaximumPrincipleND → HeatKernelND. The two directions are
traversed separately, excluding unrelated branches that merely share a dependency
or user. Selected node edge mode and Automatic on
large graphs retain these complete paths. Traversal stops at filtered-out nodes;
it does not add shortcuts across hidden nodes. Hidden edge mode still hides all
arrows. Inferred module arrows have the same source-analysis limitations as
declaration references.

Highlighted arrows fade from dark, thick blue near the selected node to light,
thin blue further away. Arrowheads match, and direct edges paint last. Distances
are computed by separate breadth-first traversals of visible dependencies and
visible users, so unrelated branches remain unhighlighted. In either traversal,
an edge's distance is `1 + min(distance(from), distance(to))`; if both traversals
reach an edge, the smaller result wins. Direct incoming/outgoing edges have
distance 1. Hover shows the distance. `arrowEmphasis` in `web/relationships.js`
maps distance to color and width, using strength `0.45 ** (distance - 1)` and width
`0.65 + 4.85 * strength`. Long paths retain a visible light-blue floor. The styling
is included in SVG, PDF, and copied PNG images.

Click the selected node again to turn off its arrow emphasis and return to the
current Edges mode's default rendering. Another click turns emphasis back on.
The Inspector, selected node, filters, zoom, and navigation history stay intact.
Selecting a different node or navigating to a node activates its arrow emphasis.
Enter and Space on a focused node perform the same toggle.

External imports are not recursively loaded. The scanner understands common Lean 4 source conventions,
nested comments, multiline attribute blocks, Unicode/quoted names, namespaces,
sections, basic `open` commands, and common declaration modifiers.

Declaration edges are **inferred lexical references**, as in Archon. The resolver
uses namespace prefixes, basic opened namespaces, transitive local imports, and
source order within a file. It keeps duplicate declarations distinct, excludes
other files' private declarations, and skips ambiguous candidate references.
References in both types and bodies can produce edges.

The scanner also tracks explicitly typed declaration parameters, section
`variable` commands, `include`/`omit` (including `in` before a theorem), and typed
local `have`, `let`, and `set` bindings. Namespace/section endings restore their
previous variable context. A use such as `S.ae_hasDerivAt` can therefore resolve
through `S : IsSetup ...` to `IsSetup.ae_hasDerivAt`. Type names are resolved in
the context where the binding was declared. Used/included section-variable types
also contribute dependencies even when omitted from the declaration's source.
Recognized local bindings shadow outer/global names; simple lambda, quantifier,
pattern, and layout-delimited proof scopes are tracked conservatively.

`source_context.py` separates scope/binding extraction from the global resolver
in `scanner.py`. Edges retain `kind: inferred-reference` and add an `evidence`
list with the reference spelling, source line/column, and resolution method.
Receiver-derived edges additionally report `receiverType`. Unsupported or
unresolved local field accesses appear in each declaration's
`unresolvedReferences`, with a total in `analysis.unresolvedFieldReferences`.
These diagnostics are available in Export JSON. No suffix-only fallback is used.
The new declaration edges also feed the existing cross-file module-use graph.

This is not Lean elaboration. Complex local scopes and shadowing can still be missed.
Notation, macros, generated declarations/projections, typeclass resolution,
implicit arguments, inferred local types, chained field accesses, type unfolding,
inherited structure methods, implicit section-instance inclusion, mutual recursion, renamed/restricted
or command-local `open`, unusual multiline command headers, and module visibility
rules are not fully modeled. Some legal Lean syntax may be missed. A quoted name
whose literal text contains a dot is not fully resolved semantically. `sorryAx`
or an indirect dependency on an axiom is not detected as a `sorry` token.
Use this graph for source navigation, not as a certified proof dependency graph.

For lemmas/theorems, Statement cuts before a top-level `:= by`, allowing comments
and line breaks between those tokens and preserving binder defaults. If that
boundary is absent (for example, a term-style proof), the complete declaration is
shown. All other declaration kinds retain their implementation, fields, and
equations. Full Source always shows the complete declaration, including tactic
proof steps. The scanner does not infer types or expand section variables;
unusual headers and macro syntax may not be parsed correctly.

The distinctions between source identifiers and elaborated references follow the
[Lean identifier documentation](https://lean-lang.org/doc/reference/latest/Terms/Identifiers/)
and [namespace documentation](https://lean-lang.org/doc/reference/latest/Namespaces-and-Sections/).

## JSON and API

Export without starting a server:

```sh
python3 . ../pde_ai --export /tmp/pde-ai-graph.json
```

The JSON includes `schemaVersion`, project settings, analysis metadata, statistics,
declarations, inferred declaration edges, file/module records, module edges,
external module names, and scan warnings. Node IDs include file, line, and full
name; they are snapshot identifiers and can change after source edits.

Local endpoints:

| Endpoint | Response |
| --- | --- |
| `/api/graph` | Cached graph without source bodies |
| `/api/graph?refresh=1` | Rescan and return the updated graph |
| `/api/node?id=...` | One declaration including its source body |
| `/api/history?window=20` | Per-node and per-module change counts and commit metadata |
| `/api/node-history?id=...&window=20&commit=SHA` | One node's history and selected declaration diff; commit optional |
| `/api/export` | Full cached graph including bodies |
| `/source?file=...#L42` | Complete scanned source file with a highlighted line anchor |
| `/source?file=...&raw=1` | Complete scanned source as plain text |

The server binds only to `127.0.0.1`, rejects foreign Host/Origin values, and
serves only named application assets and scanned graph records. It offers no
arbitrary file-reading or command-execution endpoint.

## Development and checks

```sh
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

Node is only needed for JavaScript tests, not for using the explorer. The Python
suite covers comment/string handling, scopes, Unicode names, adjacent declarations,
import visibility, ambiguous and private names, import cycles, exclusions, source
roots, symlinks, empty libraries, HTTP refresh, and API path/origin restrictions.
History tests use temporary repositories to check statement/proof edits, renames,
line shifts, commit windows, and uncommitted changes. A source-scan regression test
forbids subprocess calls, including Lean/Lake. JavaScript tests check layouts,
importance metrics, cycles, thresholds, caps, and custom metric registration.

Implementation: `lean_graph/scanner.py` extracts the graph; `lean_graph/cli.py`
provides the CLI/server; `lean_graph/statements.py` extracts headers;
`lean_graph/history.py` reads Git; `lean_graph/web/importance.js` defines scoring;
the remaining `lean_graph/web/` files implement the browser interface.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for Archon provenance and
[LICENSE](LICENSE) for Apache-2.0 terms.
