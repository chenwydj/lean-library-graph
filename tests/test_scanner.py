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


if __name__ == '__main__':
    unittest.main()
