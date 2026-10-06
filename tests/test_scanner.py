import json
from pathlib import Path
import tempfile
import unittest

from lean_graph.scanner import ScanConfig, build_graph, mask_noncode, parse_source


class ParserTests(unittest.TestCase):
    def parse(self, code):
        return parse_source(code, 'Test.lean', 'Test')[0]

    def test_adjacent_declarations_and_comment_boundaries(self):
        ds = self.parse('/- theorem fake : False := sorry /- nested -/ -/\n'
                        'def a := 1\n/-- next doc -/\n@[simp]\ntheorem b : a = 1 := by rfl\n'
                        'theorem c : True := by sorry; sorry\nend Test\n')
        self.assertEqual([d['name'] for d in ds], ['a', 'b', 'c'])
        self.assertEqual(ds[0]['body'], 'def a := 1')
        self.assertEqual(ds[1]['line'], 5)
        self.assertEqual(ds[2]['sorryCount'], 2)
        self.assertNotIn('end Test', ds[2]['body'])

    def test_strings_chars_raw_strings_and_quoted_identifiers(self):
        code = '''def text := "sorry /- ignored -/ \\" admit"\n''' + "def ch := 'x'\n" + '''def raw := r#"sorry " theorem fake"#\ndef «a -- name» := 1\ndef x' := 2\n'''
        masked = mask_noncode(code)
        self.assertEqual(len(masked), len(code))
        self.assertEqual(masked.count('\n'), code.count('\n'))
        ds = self.parse(code)
        self.assertEqual([d['name'] for d in ds], ['text', 'ch', 'raw', '«a -- name»', "x'"])
        self.assertTrue(all(d['sorryCount'] == 0 for d in ds))

    def test_scopes_unicode_attributes_and_anonymous_nodes(self):
        ds = self.parse('namespace A\nsection S\n@[simp,\n  reducible]\n def α := 0\n'
                        'end S\ninstance : Inhabited Nat := ⟨0⟩\nexample : True := by admit\n'
                        'namespace B\naxiom β : True\nend B\nend A\ndef tail := 0\n')
        self.assertEqual(ds[0]['fullName'], 'A.α')
        self.assertEqual(ds[1]['namespace'], 'A')
        self.assertTrue(ds[1]['anonymous'])
        self.assertEqual(ds[2]['sorryCount'], 1)
        self.assertEqual(ds[3]['fullName'], 'A.B.β')
        self.assertEqual(ds[4]['fullName'], 'tail')

    def test_local_proof_commands_do_not_split_declaration(self):
        ds = self.parse('theorem test : True := by\n  let x := 1\n  have a : True := by\n    sorry\n  exact a\ndef next := 1\n')
        self.assertEqual(len(ds), 2)
        self.assertEqual(ds[0]['sorryCount'], 1)
        self.assertIn('exact a', ds[0]['body'])

    def test_module_preview_omits_tactic_bodies_for_all_kinds(self):
        ds = self.parse('def sample (n : Nat := by exact 0) : Nat := /- boundary -/ by\n  exact n\n'
                        'theorem «name := by» : True := by\n  trivial\n'
                        'def text := ":= by"\nstructure Record where\n  n : Nat\n')
        self.assertEqual(ds[0]['previewStatement'], 'def sample (n : Nat := by exact 0) : Nat')
        self.assertIn('exact n', ds[0]['statement'])
        self.assertEqual(ds[1]['previewStatement'], 'theorem «name := by» : True')
        self.assertEqual(ds[2]['previewStatement'], ds[2]['body'])
        self.assertEqual(ds[3]['previewStatement'], ds[3]['body'])


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, file, code):
        path = self.root / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(code)

    def named_edges(self, graph):
        names = {d['id']: d['fullName'] for d in graph['declarations']}
        return {(names[e['from']], names[e['to']]) for e in graph['edges']}

    def test_namespace_import_visibility_and_private(self):
        self.write('Base.lean', 'namespace A\ndef foo := 1\nprivate def secret := 2\nend A\n')
        self.write('Other.lean', 'namespace B\ndef foo := 2\nend B\n')
        self.write('User.lean', 'import Base\nopen A\ndef use := foo + A.foo\ndef bad := A.secret + B.foo\n')
        graph = build_graph(ScanConfig(self.root))
        self.assertEqual(self.named_edges(graph), {('use', 'A.foo')})
        self.assertEqual(graph['moduleEdges'], [{'from': 'User', 'to': 'Base'}])

    def test_ambiguous_open_is_skipped(self):
        self.write('Base.lean', 'namespace A\ndef foo := 1\nend A\nnamespace B\ndef foo := 2\nend B\n')
        self.write('User.lean', 'import Base\nopen A B\ndef use := foo\n')
        graph = build_graph(ScanConfig(self.root))
        self.assertEqual(graph['edges'], [])
        self.assertEqual(graph['analysis']['ambiguousReferencesSkipped'], 1)

    def test_transitive_imports_empty_modules_and_cycles(self):
        self.write('A.lean', 'import B\ndef a := 0\n')
        self.write('B.lean', 'import A\n')
        self.write('C.lean', 'import B Mathlib\ndef c := a\n')
        graph = build_graph(ScanConfig(self.root))
        self.assertIn(('c', 'a'), self.named_edges(graph))
        self.assertEqual(graph['stats']['files'], 3)
        self.assertEqual(graph['externalModules'], ['Mathlib'])

    def test_excludes_source_roots_and_symlinks(self):
        self.write('src/Foo/A.lean', 'def a := 0\n')
        self.write('src/Foo/Scratch.lean', 'def scratch := 0\n')
        self.write('src/.lake/Bad.lean', 'def bad := 0\n')
        self.write('src/lakefile.lean', 'def buildConfig := 0\n')
        (self.root / 'src' / 'Alias.lean').symlink_to(self.root / 'src' / 'Foo' / 'A.lean')
        graph = build_graph(ScanConfig(self.root, ('src',), ('*Scratch.lean',)))
        self.assertEqual([f['module'] for f in graph['files']], ['Foo.A'])
        with self.assertRaises(ValueError):
            ScanConfig(self.root, ('..',))
        with self.assertRaises(ValueError):
            build_graph(ScanConfig(self.root, ('.', 'src')))

    def test_duplicate_names_have_unique_ids_and_no_arbitrary_link(self):
        self.write('A.lean', 'def foo := 1\n')
        self.write('B.lean', 'def foo := 2\n')
        self.write('C.lean', 'import A B\ndef user := foo\n')
        graph = build_graph(ScanConfig(self.root))
        self.assertEqual(len({d['id'] for d in graph['declarations']}), 3)
        self.assertEqual(graph['edges'], [])

    def test_empty_library_is_valid(self):
        graph = build_graph(ScanConfig(self.root))
        self.assertEqual(graph['stats']['files'], 0)
        json.dumps(graph)

    def setup_types(self):
        self.write('Types.lean', '''namespace A
structure Setup where
  n : Nat
theorem Setup.finish (s : Setup) : True := by trivial
end A
namespace B
structure Setup where
  n : Nat
theorem Setup.finish (s : Setup) : True := by trivial
end B
''')

    def test_typed_receiver_selects_its_type_not_same_suffix(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem useA (S : A.Setup) : True := by
  exact S.finish
theorem useB (S : B.Setup) : True := by
  exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        self.assertIn(('useA', 'A.Setup.finish'), edges)
        self.assertIn(('useB', 'B.Setup.finish'), edges)
        self.assertNotIn(('useA', 'B.Setup.finish'), edges)
        evidence = [v for e in graph['edges'] for v in e['evidence'] if v['reference'] == 'S.finish']
        self.assertEqual({e['receiverType'] for e in evidence}, {'A.Setup', 'B.Setup'})
        self.assertTrue(all(e['resolution'] == 'receiver-type' for e in evidence))
        self.assertEqual({e['line'] for e in evidence}, {3, 5})
        json.dumps(graph)

    def test_local_have_let_and_multiline_types(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem example : True := by
  have S :
      A.Setup :=
    { n := 0 }
  have first := S.finish
  let T : B.Setup := { n := 0 }
  exact T.finish
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('example', 'A.Setup.finish'), edges)
        self.assertIn(('example', 'B.Setup.finish'), edges)

    def test_receiver_chain_keeps_known_member_and_type_dependencies(self):
        self.write('Base.lean', '''namespace Demo
structure Continuity where
  n : Nat
theorem Continuity.continuousOn (h : Continuity) : True := by trivial
theorem Continuity.tendsto (h : Continuity) : True := by trivial
structure IsSetup where
  n : Nat
namespace IsSetup
variable (S : IsSetup)
include S
def continuous_prim : Continuity := ⟨S.n⟩
end IsSetup
end Demo
''')
        self.write('Use.lean', '''import Base
namespace Demo
variable (S : IsSetup)
include S
theorem exists_solution : True := by
  have a := S.continuous_prim.continuousOn
  have b := S.continuous_prim.tendsto
  exact a
end Demo
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        self.assertIn(('Demo.exists_solution', 'Demo.IsSetup'), edges)
        self.assertIn(('Demo.exists_solution', 'Demo.IsSetup.continuous_prim'), edges)
        # Do not claim that later methods were resolved without their return type.
        self.assertNotIn(('Demo.exists_solution', 'Demo.Continuity.continuousOn'), edges)
        self.assertNotIn(('Demo.exists_solution', 'Demo.Continuity.tendsto'), edges)
        node = next(d for d in graph['declarations'] if d['fullName'] == 'Demo.exists_solution')
        target = next(d for d in graph['declarations'] if d['fullName'] == 'Demo.IsSetup.continuous_prim')
        matching = [e for e in graph['edges'] if e['from'] == node['id'] and e['to'] == target['id']]
        self.assertEqual(len(matching), 1)
        evidence = matching[0]['evidence']
        self.assertEqual({(e['reference'], e['line'], e['column']) for e in evidence},
                         {('S.continuous_prim.continuousOn', 6, 13),
                          ('S.continuous_prim.tendsto', 7, 13)})
        self.assertTrue(all(e['receiverType'] == 'Demo.IsSetup' for e in evidence))
        self.assertTrue(all(e['resolvedPrefix'] == 'S.continuous_prim' for e in evidence))
        self.assertEqual({r['unresolvedSuffix'] for r in node['unresolvedReferences']},
                         {'continuousOn', 'tendsto'})
        json.dumps(graph)

    def test_receiver_chain_does_not_treat_tail_as_original_type_member(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem A.Setup.finish.tail (S : A.Setup) : True := by trivial
theorem use (S : A.Setup) : True := by
  have a := S.finish.tail.more
  exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        self.assertIn(('use', 'A.Setup.finish'), edges)
        self.assertNotIn(('use', 'A.Setup.finish.tail'), edges)
        node = next(d for d in graph['declarations'] if d['name'] == 'use')
        self.assertEqual(node['unresolvedReferences'][0]['unresolvedSuffix'], 'tail.more')

    def test_receiver_chain_obeys_visibility_and_unknown_local_shadowing(self):
        self.setup_types()
        self.write('Hidden.lean', 'import Types\ntheorem A.Setup.hidden (S : A.Setup) : True := by trivial\n')
        self.write('Use.lean', '''import Types
theorem S.finish.tail : True := by trivial
theorem unknown (S : A.Setup) : True := by
  have S := arbitrary
  exact S.finish.tail
theorem unimported (S : A.Setup) : True := by exact S.hidden.tail
theorem later (S : A.Setup) : True := by exact S.future.tail
theorem A.Setup.future (S : A.Setup) : True := by trivial
open A B
theorem ambiguous (S : Setup) : True := by exact S.finish.tail
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        for user in ('unknown', 'unimported', 'later', 'ambiguous'):
            self.assertFalse(any(a == user and b not in {'A.Setup', 'B.Setup'} for a, b in edges))
            node = next(d for d in graph['declarations'] if d['name'] == user)
            self.assertNotIn('resolvedPrefix', node['unresolvedReferences'][0])

    def test_nested_shadowing_ends_at_dedent_and_initializer_uses_outer_binding(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem example (S : A.Setup) : True := by
  have inner : True := by
    have S : B.Setup := by
      have previous := S.finish
      exact { n := 0 }
    exact S.finish
  exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        evidence = [v for e in graph['edges'] for v in e['evidence'] if v['reference'] == 'S.finish']
        # Each (reference, receiver context) is retained at its first occurrence.
        self.assertEqual({(e['line'], e['receiverType']) for e in evidence},
                         {(5, 'A.Setup'), (7, 'B.Setup')})
        self.write('Use.lean', '''import Types
theorem example (S : A.Setup) : True := by
  have inner : True := by
    have S : B.Setup := { n := 0 }
    trivial
  exact S.finish
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('example', 'A.Setup.finish'), edges)
        self.assertNotIn(('example', 'B.Setup.finish'), edges)

    def test_unknown_local_does_not_inherit_outer_receiver_type(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem example (S : A.Setup) : True := by
  let S := arbitrary
  exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        self.assertNotIn(('example', 'A.Setup.finish'), edges)
        self.assertEqual(graph['analysis']['unresolvedFieldReferences'], 1)
        node = next(d for d in graph['declarations'] if d['name'] == 'example')
        self.assertEqual(node['unresolvedReferences'][0]['reference'], 'S.finish')

    def test_section_variables_include_omit_and_nested_scope_restore(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
namespace A
variable
  (S : Setup)
include S
section Inner
variable (S : B.Setup)
theorem inner : True := by exact S.finish
end Inner
theorem outer : True := by exact S.finish
omit S
theorem unused : True := by trivial
include S
theorem included : True := by trivial
end A
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('A.inner', 'B.Setup.finish'), edges)
        self.assertIn(('A.outer', 'A.Setup.finish'), edges)
        self.assertIn(('A.included', 'A.Setup'), edges)
        self.assertFalse(any(a == 'A.unused' for a, _ in edges))

    def test_section_variable_in_header_and_declared_type_context(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
open A
variable (S : Setup)
namespace B
theorem use : S = S := by
  have h := S.finish
  rfl
end B
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('B.use', 'A.Setup.finish'), edges)
        self.assertNotIn(('B.use', 'B.Setup.finish'), edges)

    def test_explicit_parameter_shadows_section_variable_without_spurious_type_edge(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
variable (S : A.Setup)
theorem example (S : B.Setup) : True := by exact S.finish
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('example', 'B.Setup.finish'), edges)
        self.assertNotIn(('example', 'A.Setup.finish'), edges)
        self.assertNotIn(('example', 'A.Setup'), edges)

    def test_lambda_shadowing_is_limited_to_expression(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem example (S : A.Setup) : True := by
  have f := (fun (S : B.Setup) => S.finish)
  exact S.finish
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('example', 'A.Setup.finish'), edges)
        self.assertIn(('example', 'B.Setup.finish'), edges)

    def test_local_type_parameter_does_not_resolve_to_global_type(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
open A
theorem example (Setup : Type) (S : Setup) : True := by exact S.finish
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertNotIn(('example', 'A.Setup.finish'), edges)
        self.assertNotIn(('example', 'A.Setup'), edges)

    def test_receiver_resolution_obeys_import_visibility_and_ambiguity(self):
        self.setup_types()
        self.write('Hidden.lean', 'theorem A.Setup.hidden (s : A.Setup) : True := by trivial\n')
        self.write('Use.lean', '''import Types
open A B
theorem ambiguous (S : Setup) : True := by exact S.finish
theorem unavailable (S : A.Setup) : True := by exact S.hidden
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertFalse(any(a == 'ambiguous' for a, _ in edges))
        self.assertNotIn(('unavailable', 'A.Setup.hidden'), edges)

    def test_caratheodory_pattern_recovers_all_three_receiver_dependencies(self):
        self.write('Example.lean', '''namespace CaratheodoryFull
structure IsSetup where
  h_pos : True
namespace IsSetup
section Basic
variable (S : IsSetup)
include S
theorem t0_mem : True := by trivial
theorem exists_solution : True := by exact S.t0_mem
end Basic
end IsSetup
theorem IsSetup.ae_hasDerivAt (S : IsSetup) : True := by exact S.t0_mem
theorem caratheodory_existence : True := by
  have S : IsSetup := { h_pos := True.intro }
  have h := S.exists_solution
  have h' := S.ae_hasDerivAt
  exact S.t0_mem
end CaratheodoryFull
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        for method in ('t0_mem', 'exists_solution', 'ae_hasDerivAt'):
            self.assertIn(('CaratheodoryFull.caratheodory_existence', 'CaratheodoryFull.IsSetup.' + method), edges)

    def test_include_in_and_omit_in_do_not_leak(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
variable (S : A.Setup)
include S in theorem one : True := by exact S.finish
theorem two : True := by trivial
include S in
theorem three : True := by exact S.finish
theorem four : True := by trivial
include S
omit S in theorem five : True := by trivial
theorem six : True := by exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        edges = self.named_edges(graph)
        for name in ('one', 'three', 'six'):
            self.assertIn((name, 'A.Setup.finish'), edges)
        for name in ('two', 'four', 'five'):
            self.assertFalse(any(a == name for a, _ in edges))

    def test_branch_pattern_shadows_outer_receiver(self):
        self.setup_types()
        self.write('Use.lean', '''import Types
theorem example (S : A.Setup) : True := by
  have h := match arbitrary with
    | some S => S.finish
    | none => True.intro
  exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        method_edges = [e for e in graph['edges'] if e['to'].endswith(':A.Setup.finish')]
        self.assertEqual(len(method_edges), 1)
        self.assertEqual(method_edges[0]['evidence'][0]['line'], 6)
        self.assertEqual(graph['analysis']['unresolvedFieldReferences'], 1)

    def test_private_and_later_methods_are_not_linked_from_receiver(self):
        self.write('Base.lean', '''structure Setup where
  n : Nat
private theorem Setup.secret (S : Setup) : True := by trivial
''')
        self.write('Use.lean', '''import Base
theorem example (S : Setup) : True := by
  have h := S.secret
  exact S.later
theorem Setup.later (S : Setup) : True := by trivial
''')
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertNotIn(('example', 'Setup.secret'), edges)
        self.assertNotIn(('example', 'Setup.later'), edges)

    def test_cross_file_receiver_edge_survives_umbrella_import(self):
        self.setup_types()
        self.write('Umbrella.lean', 'import Types\n')
        self.write('Use.lean', '''import Umbrella
theorem use (S : A.Setup) : True := by exact S.finish
''')
        graph = build_graph(ScanConfig(self.root))
        self.assertIn(('use', 'A.Setup.finish'), self.named_edges(graph))
        self.assertIn({'from': 'Use', 'to': 'Umbrella'}, graph['moduleEdges'])

    def test_set_binding_and_trailing_header_whitespace(self):
        self.setup_types()
        code = ('import Types\ntheorem use (S : A.Setup) : True := by' + '   \n'
                '  have h := S.finish\n'
                '  set T : B.Setup := { n := 0 } with hT\n'
                '  exact T.finish\n')
        self.write('Use.lean', code)
        edges = self.named_edges(build_graph(ScanConfig(self.root)))
        self.assertIn(('use', 'A.Setup.finish'), edges)
        self.assertIn(('use', 'B.Setup.finish'), edges)


if __name__ == '__main__':
    unittest.main()
