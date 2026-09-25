from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from lean_graph.history import GitHistory
from lean_graph.scanner import ScanConfig, build_graph, parse_source


class StatementTests(unittest.TestCase):
    def statement(self, code):
        return parse_source(code, 'A.lean', 'A')[0][0]['statement']

    def test_default_binders_comments_strings_and_proofs(self):
        header = 'theorem foo (n : Nat := 1) (s : String := ":=")\n    : n = n /- := fake -/'
        self.assertEqual(self.statement(header + ' := by\n  rfl\n'), header)

    def test_equations_where_and_quoted_names(self):
        for code in ['def «:=» : Nat := 1', 'def f : Nat → Nat\n  | n => n',
                     'instance : Inhabited Nat where\n  default := 0']:
            self.assertEqual(self.statement(code), code)
        self.assertEqual(self.statement('axiom A : True'), 'axiom A : True')
        self.assertEqual(self.statement('theorem abs_eq : |x| = x := by sorry'), 'theorem abs_eq : |x| = x')

    def test_other_declarations_keep_fields_and_tactic_implementations(self):
        for code in ['def identity (n : Nat) : Nat := by\n  exact n',
                     'structure Point where\n  x : Nat\n  y : Nat',
                     'class Witness where\n  proof : True := by trivial',
                     'example : True := by\n  trivial']:
            node = parse_source(code, 'A.lean', 'A')[0][0]
            self.assertEqual(node['statement'], code)
            self.assertEqual(node['body'], code)

    def test_lemma_boundary_and_full_source_are_separate(self):
        code = 'lemma «:= by» (h : True := by trivial) : True := /- proof -/\n  by\n  exact h'
        node = parse_source(code, 'A.lean', 'A')[0][0]
        self.assertEqual(node['statement'], 'lemma «:= by» (h : True := by trivial) : True')
        self.assertEqual(node['body'], code)
        term_proof = 'theorem term : True := let h : True := by trivial; h'
        self.assertEqual(self.statement(term_proof), term_proof)

    def test_scanning_never_executes_lean_or_lake(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'lakefile.lean').write_text('this lakefile cannot build')
            (root/'A.lean').write_text('theorem foo : False := by sorry')
            with patch('subprocess.run', side_effect=AssertionError('A scan must not execute a tool')):
                self.assertEqual(build_graph(ScanConfig(root))['stats']['declarations'],1)


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.git('init','-q')
        self.file='src/A.lean'
        (self.root/'src').mkdir()
        self.body='namespace Demo\ntheorem t (n : Nat := 1) : n = n := by\n  rfl\nend Demo\n'
        self.write(self.body)
        self.initial=self.commit('add declaration')
        self.body=self.body.replace('  rfl','  exact rfl')
        self.write(self.body)
        self.proof=self.commit('proof only')
        self.body=self.body.replace('Nat := 1','Nat := 2')
        self.write(self.body)
        self.statement=self.commit('statement only')
        self.write('-- line shift only\n\n'+self.body)
        self.shift=self.commit('move source lines')
        self.git('mv','src/A.lean','src/Renamed.lean')
        self.file='src/Renamed.lean'
        self.rename=self.commit('rename source file')
        (self.root/'README.md').write_text('unrelated change')
        self.unrelated=self.commit('documentation')

    def tearDown(self):
        self.temp.cleanup()

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),'-c','user.name=Graph Test',
            '-c','user.email=graph@example.invalid','-c','commit.gpgsign=false',
            '-c','core.hooksPath=/dev/null',*args],stderr=subprocess.PIPE).decode().strip()

    def write(self,body):
        (self.root/self.file).write_text(body)

    def commit(self,message):
        self.git('add','.')
        self.git('commit','-qm',message)
        return self.git('rev-parse','HEAD')

    def graph(self):
        return build_graph(ScanConfig(self.root/'src'))

    def test_full_source_changes_rename_and_line_shifts(self):
        graph=self.graph()
        result=GitHistory(self.root/'src').analyze(graph,20)
        node=graph['declarations'][0]
        activity=result['nodes'][node['id']]
        self.assertTrue(result['available'])
        self.assertEqual(result['inspectedCommits'],6)
        self.assertEqual(activity['changeCount'],3)
        self.assertEqual([c['sha'] for c in activity['commits']],[self.statement,self.proof,self.initial])
        detail=result['_details'][(node['id'],self.proof)]
        self.assertIn('-  rfl',detail['diff'])
        self.assertIn('+  exact rfl',detail['diff'])
        self.assertIn('Nat := 1',detail['before'])
        self.assertEqual(result['modules']['Renamed']['changeCount'],3)

    def test_window_limits_and_uncommitted_changes(self):
        self.write(self.body.replace('exact rfl','simp'))
        graph=self.graph()
        result=GitHistory(self.root/'src').analyze(graph,2)
        activity=result['nodes'][graph['declarations'][0]['id']]
        self.assertEqual(activity['changeCount'],0)
        self.assertTrue(activity['workingTreeChanged'])
        self.assertFalse(result['includesWorkingTree'])

    def test_untracked_node_has_unknown_history(self):
        (self.root/'src/New.lean').write_text('def fresh := 1')
        graph=self.graph()
        result=GitHistory(self.root/'src').analyze(graph,20)
        fresh=next(d for d in graph['declarations'] if d['name']=='fresh')
        self.assertFalse(result['nodes'][fresh['id']]['tracked'])

    def test_no_repository_and_invalid_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            result=GitHistory(root).analyze(build_graph(ScanConfig(root)),20)
            self.assertFalse(result['available'])
        with self.assertRaises(ValueError):
            GitHistory(self.root).analyze(self.graph(),201)

    def test_shallow_boundary_is_not_counted_as_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            shallow = Path(directory) / 'clone'
            self.git('clone', '-q', '--depth=1', self.root.resolve().as_uri(), str(shallow))
            graph = build_graph(ScanConfig(shallow / 'src'))
            result = GitHistory(shallow / 'src').analyze(graph,20)
            self.assertEqual(result['inspectedCommits'],1)
            self.assertEqual(result['nodes'][graph['declarations'][0]['id']]['changeCount'],0)
            self.assertTrue(result['warnings'])


if __name__=='__main__':
    unittest.main()
