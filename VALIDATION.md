# Validation

Validated locally on September 10, 2026 with Python 3.14 and the Codex browser.

## Node Hide and dependency previews, September 24, 2026

- App syntax check passed; no browser errors were reported.
- Declaration dependency preview for coordProj_coordEmbed showed its lemma header
  without `:= by`, preserving selected declaration, node count, and exact viewBox.
  Show node then revealed and selected that dependency.
- Hide removed the selected node and set Exclude node. Returning to the original
  declaration and choosing Show node restored it and cleared exclusion.
- In Module imports, opening WaveIVPSource3D's dependency box showed seven code
  previews without `:= by`, while selection and the single-node diagram remained
  unchanged. Show node then revealed its module as a second node.
- Previous Inspector focus buttons remain absent; This file is retained.

## Fold upper controls, September 22, 2026

- App syntax check passed; browser reported no errors.
- Toolbar chevron hid title, statistics, search/filter controls, and analysis controls.
  Inspector and diagram toolbar remained visible; canvas height increased.
- Zoom remained at 1 SVG unit per screen pixel when folding and restoring.
- Full-page Expand/Restore retained the folded state. Restoring upper controls
  retained the `Problem1` search and correctly updated the button's accessible label.

## Exclusive Wildcard / Regex search, September 22, 2026

- App syntax and direct checks of the actual search functions passed for exact
  names, `*`, `?`, case-insensitivity, literal regex punctuation, regex anchors,
  substring regex behavior, and invalid regex syntax.
- Browser: default Wildcard `Problem1` showed only the three Problem1 modules in
  different folders. `Problem1*` showed 568 modules, including Problem1037.
- Regex `Problem1$` returned the exact endings. Invalid regex `[` showed an error;
  switching to Wildcard treated it literally and cleared the error.
- No browser errors were reported. Final preview uses Wildcard `Problem1`.

## Regex search, September 22, 2026

- App JavaScript syntax check passed.
- Browser: `WaveIVP[123]D$` matched exactly the 1D, 2D, and 3D modules.
- Lowercase `^pde/basics/wave/waveivp[12]d\.lean$` matched the two file paths,
  confirming case-insensitive, field-specific anchors and escaped punctuation.
- Invalid `[` displayed an inline error, set aria-invalid, and retained the prior
  graph. Correcting it cleared the error and updated results.

## Stable manual zoom, September 22, 2026

- App syntax check passed; browser reported no errors.
- WaveIVPSource2D remained 330 screen pixels wide at the same screen coordinates
  after children and then parents were unfolded (1 to 4 to 8 nodes).
- After manual zoom-out to 1.3333 SVG units per screen pixel, Expand all children
  (41 nodes), page expansion, restoration, and Collapse all preserved that scale.
- Explicit Fit changed scale to 0.8266 units per pixel, confirming it still works.
- Initial scale is independent of graph size. Canvas resizing preserves units per
  screen pixel; node navigation changes position without changing zoom.

## Search-driven bidirectional tree, September 22, 2026

- All 43 JavaScript tests passed; app syntax check passed.
- New tests cover empty startup, over 200 starting nodes, independent parent/child
  disclosure beyond seed matches, top-down parent placement, shared paths after
  collapse, exclusions, and cycles.
- Browser verified Minimum score, Max nodes, and both layout controls are hidden.
- Searching WaveIVPSource2D initially showed one module. Children expanded to four
  nodes beyond the search; parents expanded to eight with users above the start.
  Collapsing children preserved the five-node parent branch; Collapse all restored
  the single start.
- Choosing WaveIVPSource2D.lean in Declarations showed its four declarations.
  Child expansion revealed declarations in other files without changing File;
  keyboard parent expansion worked. Browser reported no errors. No Lean build ran.

## Expandable tree, September 22, 2026

- `node --test tests/*.test.mjs`: 38 tests passed.
- App and layout JavaScript syntax checks passed.
- Tree tests cover level-by-level disclosure, shared children after collapse,
  deterministic roots for cycles, filtered boundaries, forced pins/navigation,
  non-overlapping top-down geometry, wrapped root trees, and 15,000-node chains.
- Browser: Module imports with the WaveIVP search began at 2 roots / 6 eligible
  nodes. Unfolding WaveIVPSource2D showed its 2 children below the parent. Clicking
  the WaveIVPSource3D node opened its Inspector and unfolded another child.
  Expand all showed all 6; Collapse all returned to the 2 roots.
- Browser: keyboard disclosure worked in Declarations; layout and open branches
  survived switching between views. No browser errors were reported.
- Validation used source analysis only, with no Lean build.

## Automated checks

- `python3 -m unittest discover -s tests -v`: 25 tests passed.
- `node --test tests/*.test.mjs`: 31 tests passed.
- `node --check lean_graph/web/app.js`: passed.
- `node --check lean_graph/web/layout.js`: passed.

The HTTP tests require permission to bind loopback sockets in a sandboxed
environment. They passed with that permission.

New coverage includes lemma/theorem headers before `:= by`, complete definitions
and structure fields, retained full proof bodies, binder defaults, paired bars,
and quoted names; scans forbidden from executing subprocesses; proof-only and
statement-only Git changes; file renames and line shifts; shallow clone boundaries;
untracked and uncommitted nodes; history windows; distinct direct/transitive reuse,
cycles, score thresholds, strict node caps, and custom metrics.

Source-reader coverage includes complete source text, escaped HTML and filenames,
line anchors, raw text, snapshot refresh, import-only files, missing files, and
rejection of paths outside the scanned source snapshot.

## Real libraries

| Library | Lean files | Scanned declarations | Inferred references | Explicit import links | Sorry/admit tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| `pde_ai` | 105 | 2,621 | 9,123 | 569 | 4 |
| `pde_choksi/pde` | 32 | 1,679 | 5,969 | 226 | 2 |

The default source-root and exclusion settings were used. The `pde_ai` scan
took approximately 3.7 seconds on this machine. Counts describe these local
source snapshots, not Lean build results.

## Browser checks

Repeated-node click: u'approxLift initially highlighted 33 arrows; a second click
restored all displayed arrows to rgb(135,159,189), width 1.1 px, with zero selected
edges. Inspector text, viewBox, and history remained unchanged. A third click
restored the 33 emphasized arrows. The same reset worked for HeatKernelND in
Module imports, and selecting HeatMaximumPrincipleND then emphasized its 55
related arrows. App syntax passed; no browser errors occurred.

Arrow distance styling: HeatKernelND's direct edges rendered dark blue
rgb(30, 89, 174) at 3.4 px; two-step edges rendered rgb(72, 122, 191) at 2.65 px.
Changing selection to HeatSolutionPropertyND changed the SolutionND → KernelND
edge from distance 1 to 2 with corresponding color, width, and marker changes.
The u'approxLift declaration showed styled edges at distances 1 through 6,
including Selected node mode. The expanded module diagram was visually checked.
All nine relationship tests and app syntax passed; coverage includes both
directions, shortcuts, cycles, ordering independence, and monotonic emphasis.

Diagram font controls: A+ changed node text from 14.77 to 16.247 px and file
labels from 13.54 to 14.894 px, preserving the exact SVG viewBox and 13 px
Inspector typography. Per-view sizes were retained across view switching.
Module folder labels reached 21 px at 150%; the controls stayed available while
expanded, and Copy Image completed with scaled labels. At 150%, all 200 default
declaration nodes had no text overlap or box overflow after the baseline spacing
adjustment. At 50%, node text was 7.385 px and the smaller button was disabled.
App syntax passed and the browser reported no errors.

Page expansion and clipboard image: in the Heat module folder graph, Expand
filled the 724 × 979 page, hid the title and Inspector, and kept Restore and
bottom controls visible. After zooming while expanded, Restore returned the exact
original SVG viewBox, Inspector width, search, and selected node. Escape also
restored the prior view. Copy Image completed with the browser clipboard write
resolved and an Image copied message; no application error occurred. PNG and PDF
share the existing SVG rasterizer. Both PDF unit tests and app syntax passed.

Exclusions: HeatKernelND disappeared with its arrows after exclusion and its pin
cleared. Pinning it cleared the exclusion and restored the node. Exclude all on
the ten-module Heat filter produced an empty graph; all ten exclusions survived
reload and were isolated from Declarations. Un-exclude all restored 105 modules
and 418 connections. Excluding a declaration kept 200 nodes visible by filling
the freed slot, while its Inspector stayed open. Test exclusions were cleared.
No browser errors occurred; all eight pin/policy tests and app syntax passed.

Folder layout: 105 pde_ai modules occupy 20 nested folder boxes; all 418 local
module edges advance left to right. Actual-file ownership and containment were
checked for every module. Browser checks covered 15-node and Heat-only filters,
highlighted ancestry for HeatKernelND (root / PDE / Basics / Heat), keyboard
folder zoom, layout switching with selection preserved, and empty score filters.
Declarations still shows file groups and hides the module layout selector. No
browser errors occurred. All four layout tests and app syntax checks passed.
New tests cover nested containment, non-overlapping sibling folders and nodes,
dependency order, stable input ordering, root-level files, external imports,
filtered paths, empty graphs, duplicate edges, and cycles.

Minimum score restored: with Direct users selected, a threshold of 100 showed
10 declarations; Max nodes = 3 reduced the render to 3 of those 10. Switching
views reset the threshold to 0. In Module imports, a threshold of 10 showed
11 modules. No browser errors occurred. All 10 existing importance and pin tests
passed, including threshold filtering and pins bypassing score limits; app syntax
validation passed.

Solid arrows and complete user paths: selecting HeatKernelND in the live module
graph now highlights both PDE → HeatMaximumPrincipleND and
HeatMaximumPrincipleND → HeatKernelND. Both remain visible and blue in Selected
node mode. All rendered edges have computed stroke-dasharray = none; provenance
remains in hover text. No browser errors occurred. All six relationship tests
passed, including the reported chain, unrelated-branch exclusions, filtering,
cycles, and 20,000-edge traversal in either direction. App JavaScript syntax passed.

Initial module relationships and upstream paths check (before the complete user
path extension above): the pde_ai snapshot adds 180
inferred module arrows, with 418 combined connections between the 105 local
modules. Problem13 has an inferred link to GreensFunctionSymmetry supported by eight
declaration references. Its selected paths include 314 blue edges, 309 beyond
immediate connections; every expected visible dependency edge was highlighted,
and Selected node mode retained all 314. In Declarations, u'approxLift highlighted
33 edges, 27 beyond immediate connections, again retained in Selected node mode.
Hidden mode rendered zero edges. The filtered Wave module diagram was visually
checked for complete blue paths. Five new unit tests cover umbrella imports,
deduplication, within-file exclusions, branches, filtered boundaries, cycles, and
20,000-edge chains. All 23 JavaScript tests and four HTTP server tests passed.

Node navigation: visited `Wave.tderiv`, `Wave.xderiv`, and module `PDE`. Back
restored `Wave.xderiv` in Declarations and Forward restored `PDE` in Module
imports. Switching each view tab restored its last visited node. With Max nodes
= 1, Back still revealed the requested declaration. An inline Used by preview
preserved Forward, while its explicit jump to `Wave.contDiff_one_xderiv` cleared
the forward path and retained Back to `Wave.xderiv`. Arrow placement was visually
checked at the diagram's top-right; no browser errors occurred. Four navigation
unit tests cover mixed views, branching, repeated visits, empty views, and stale
nodes after refresh. All 18 JavaScript and four HTTP server tests passed.

Simplified importance controls and larger type: Minimum score is absent; Max
nodes = 10 renders 10 nodes in both views, and the default 200 still renders 200
declarations. Node labels omit scores. Only SVG diagram typography is about 23%
larger: node names are 14.77px, metadata 11.08px, and file labels 13.54px.
Inspector and other interface fonts retain their original sizes (code 11px,
detail titles 18px, root 13px); the separate source reader was also restored.
Computed browser sizes confirmed this scope. No label overflow was found among
the 200 default declarations or 10 checked modules, and Inspector code still
wrapped. Ranking changes worked and no browser errors occurred. JavaScript syntax
and all 14 existing JavaScript tests passed.

Used by previews: selecting `Wave.tderiv` and expanding `Wave.contDiff_one_tderiv`
showed its statement at file lines 103 through 105 without a tactic proof. The
selected node, 200 rendered nodes, and SVG viewport remained unchanged. Show in
Declarations then selected and revealed `Wave.contDiff_one_tderiv`. No browser
errors occurred; JavaScript syntax validation passed.

Inspector divider: dragging the center arrow left widened the panel from 350 to
550 pixels; dragging right reduced it to 450. Pointer capture released cleanly.
Home clamped the width to 260 pixels, Left increased it by 20, and End preserved
280 pixels for the graph without main-layout overflow. The corner resize grip is
disabled, and the separator's accessible width values follow the visible panel.

Inspector wrapping: module preview and Statement for `Wave.hasDerivAt_slice_snd`
show file lines 72 through 75; Full Source shows lines 72 through 78. Long lines
wrap beside a single gutter number without horizontal overflow. The recent diff
for `nearBranch_wave_eq_field` shows context in both old/new gutters, deletions
201 through 212 only on the left, and additions 201 through 212 only on the right.
Wrapped diff colors and alignment were inspected visually; no browser errors.

Module declaration previews: expanding `Wave.hasDerivAt_slice_snd` displayed its
header without the tactic proof while retaining the selected module and Module
imports view. A term-style declaration remained complete. Show in Declarations
switched modes and selected the requested declaration. Multiple previews can stay
open. Parser coverage includes tactic definitions, binder defaults, comments,
quoted names, strings, and structures.

Save PDF: the browser downloaded the filtered WeakFormulation graph containing
all 11 declarations and 10 connections even with the viewport zoomed elsewhere.
Poppler parsed the PDF as a valid single-page PDF 1.4; its rendered PNG was
visually inspected for complete bounds, labels, node colors, groups, and arrows.
A second export of six Wave modules and five import connections also parsed and
rendered correctly, retaining selection styling and sorry colors after zooming.
JavaScript tests verify binary stream preservation, cross-reference byte offsets,
page/image dimensions, and invalid-input handling. No PDF runtime dependency was
added to the tool.

Open Lean file checks: selecting `Wave.tderiv` and clicking the Inspector link
opened a separate browser tab containing all 570 lines of its original file.
The browser scrolled to line 58 and highlighted it below the sticky header.
Selecting module `PDE` opened another tab at the beginning of `PDE.lean`, including
all 71 lines of comments and imports despite having no declarations. The graph
remained open, and both source and graph pages reported no browser errors.

Pinning checks: two declaration pins survived Max nodes = 1 (three total nodes),
a search with no matches, Minimum score = 9999 (only the two pins), and a page
reload. Module and declaration pins remained separate while switching views.
The three HTTP tests also passed with the new `/pins.js` asset.

Bulk pin checks: searching WeakFormulation displayed 11 nodes; Pin all pinned
exactly those 11. In Module imports with a cap of one, Pin all pinned only the
one node rendered before the click, leaving the newly revealed node unpinned.
Unpin all in Module imports removed its pin while all 11 declaration pins
remained. Unpin all in Declarations then removed those pins and restored the
ordinary node cap. No browser errors occurred. Test pins were cleared afterward.

September 10 feature checks on `pde_ai`:

- Default overview renders 200 of 2,621 declarations; changing Max nodes to 10
  renders exactly 10. Minimum score 99999 yields no matches.
- Switching to Reuse across files updates the metric description and ranking.
- Searching `nearBranch_wave_eq_field` finds one node. Statement view shows its
  written header while omitting the proof from source lines 1222 through 1435.
- Recent diff finds two changing commits in the last 20 first-parent commits.
  The latest diff shows proof edits, including replacing `sorry`; choosing the
  earlier commit shows declaration creation.
- Activity coloring assigns that node the strongest shade (2 changes). Turning
  coloring off restores source-status colors. A one-commit window reports zero
  changes for that node.
- The 20-commit Git scan reported 41 declaration-change events without warnings
  at HEAD `12328f8288452cbf8ce88232e9cbd1ddeab9999b`; scan plus history took
  approximately 14 seconds. History is cached for repeated requests.
- No browser errors during these interactions; the narrow layout was inspected.

Earlier baseline checks (before the default 200-node cap):

- Initial graph loads without browser errors.
- Searching `WeakFormulation` produces 11 declarations and 10 connections.
- Selecting `IsWeakSolution` displays source lines 47 through 55, 9 inferred
  dependencies, and 2 direct users.
- Neighborhood focus displays 12 declarations, with references across files.
- Module view displays 105 local modules and 238 local import links.
- Enabling external imports displays 240 modules and all 569 import links.
- Filtering for `Contains sorry` displays the 4 corresponding declarations.
- SVG export was exercised from the filtered declaration view without errors.
- Source details, filtering, mode switching, and the responsive narrow layout
  were inspected in the browser. The final graph was left open for use.

No Lean build or kernel-level dependency comparison was performed. See README
for the source scanner's limitations.


## Per-view exploration restoration (2026-09-25)

Browser regression check against the local pde_ai source graph:

1. In File (Module), search Problems.Undergraduate.Problem1, expand its children,
   select it, and zoom in. Record the four visible node IDs and SVG viewport.
2. Choose Show all declarations in this file. Record the six visible declaration
   IDs, selected file, empty search, and SVG viewport, without selecting a node.
3. Switch to File (Module), then Declarations. Both snapshots match exactly,
   including the module selection, all nodes, filters, and distinct viewports.
4. Fold the solution's parents in Declarations, adjust zoom, and repeat the round
   trip. The single-node folded graph and its viewport are restored exactly.

No browser console errors. All 47 JavaScript tests pass; app.js syntax check passes.

## Receiver-aware source dependencies (2026-10-06)

The full source-only pde_ai scan covers 2,408 files and 27,329 declarations.
It finds 1,917 declaration edges with explicit receiver-type evidence. In
CaratheodoryExistence.lean, `CaratheodoryFull.caratheodory_existence` now links to
`IsSetup.exists_solution`, `IsSetup.ae_hasDerivAt`, and `IsSetup.t0_mem` under the
`CaratheodoryFull` namespace, in addition to `IsSetup` and `exists_shrink`.
The `S.ae_hasDerivAt` evidence points to line 1080, column 5, with receiver type
`CaratheodoryFull.IsSetup`. No Lean build or elaboration is used.

Scanner regressions cover typed parameters and local have/let/set bindings,
multiline variables/types, include/omit and command-local inclusion, nested
sections, type resolution at the binding's declaration, shadowing and initializer
scope, lambda/pattern scopes, unknown local types, same-suffix methods on different
types, import visibility, private/later declarations, and umbrella imports.
All 27 scanner tests and the 14 other Python tests pass. All 47 JavaScript tests
pass. API tests used a temporary loopback server.

Browser verification against the restarted localhost server confirms all five
dependencies in the Inspector and all six nodes after expanding children.
No browser console errors were recorded.

## Python 3.9 compatibility (2026-10-06)

Reproduced the startup TypeError from `Binding.head: str | None` using macOS
Python 3.9.6 (`/usr/bin/python3`). Postponed annotation evaluation in
`source_context.py` fixes the import. The CLI `--help` now exits successfully.
All 37 scanner/history/statement tests and all four HTTP server tests pass on
Python 3.9.6. Server tests ran separately with temporary loopback access.
Package metadata, requirements comments, and README now specify Python >= 3.9.
