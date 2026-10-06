from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from lean_graph.source_links import SourceLinks, remote_web


class RemoteURLTests(unittest.TestCase):
    def test_clone_urls_and_credentials(self):
        for remote in ['git@github.com:owner/repo.git', 'ssh://git@github.com:22/owner/repo.git',
                       'https://secret@github.com/owner/repo.git',
                       'https://user:password@github.com/owner/repo.git?token=secret']:
            self.assertEqual(remote_web(remote).file_url('feature/lean', 'src/A B.lean', 4, 9),
                             'https://github.com/owner/repo/blob/feature%2Flean/src/A%20B.lean#L4-L9')

    def test_provider_paths_and_line_anchors(self):
        cases = [
            ('https://gitlab.com/group/sub/repo.git', 'https://gitlab.com/group/sub/repo/-/blob/main/A.lean#L2-5'),
            ('git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo/src/main/A.lean#lines-2:5'),
            ('git@codeberg.org:team/repo.git', 'https://codeberg.org/team/repo/src/branch/main/A.lean#L2-L5'),
            ('https://gitlab.example.org:8443/group/repo.git', 'https://gitlab.example.org:8443/group/repo/-/blob/main/A.lean#L2-5'),
        ]
        for remote, expected in cases:
            with self.subTest(remote=remote):
                self.assertEqual(remote_web(remote).file_url('main', 'A.lean', 2, 5), expected)
        self.assertEqual(remote_web('git@github.com:o/r.git').file_url('main', 'λ #.lean', 2),
                         'https://github.com/o/r/blob/main/%CE%BB%20%23.lean#L2')

    def test_non_browser_and_invalid_remotes(self):
        for remote in ['/tmp/repo.git', '../repo.git', 'file:///tmp/repo.git',
                       'https://unknown.example/o/r', 'javascript://github.com/o/r',
                       'https://github.com/o/../r', 'https://github.com/o',
                       'https://github.com:bad/o/r']:
            self.assertIsNone(remote_web(remote), remote)


class SourceLinksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'checkout'
        self.root.mkdir()
        self.remote = Path(self.temp.name) / 'remote.git'
        self.git('init', '-q')
        self.git('symbolic-ref', 'HEAD', 'refs/heads/main')
        (self.root / 'src').mkdir()
        (self.root / 'src/A.lean').write_text('def a := 1\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'initial')
        subprocess.run(['git', 'init', '--bare', '-q', str(self.remote)], check=True)
        subprocess.run(['git', '-C', str(self.remote), 'config', 'receive.denyDeleteCurrent', 'ignore'], check=True)
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('push', '-q', 'origin', 'main')
        self.git('remote', 'set-url', 'origin', 'git@github.com:owner/repo.git')
        self.links = SourceLinks(self.root / 'src')
        original = self.links._git
        self.queries = 0

        def git_with_local_transport(*args):
            if args[0] == 'ls-remote':
                self.queries += 1
                # Exercise real Git remote refs, without contacting a web host.
                return original(*args[:-1], str(self.remote))
            return original(*args)

        self.transport = patch.object(self.links, '_git', side_effect=git_with_local_transport)
        self.transport.start()

    def tearDown(self):
        self.transport.stop()
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(
            ['git', '-C', str(self.root), '-c', 'user.name=Graph Test',
             '-c', 'user.email=graph@example.invalid', '-c', 'commit.gpgsign=false',
             '-c', 'core.hooksPath=/dev/null', *args], stderr=subprocess.PIPE).decode().strip()

    def test_matching_branch_subdirectory_and_cache(self):
        self.git('checkout', '-qb', 'feature/lean')
        self.git('push', '-q', str(self.remote), 'feature/lean')
        expected = 'https://github.com/owner/repo/blob/feature%2Flean/src/A.lean'
        self.assertEqual(self.links.destination('A.lean', 1), expected + '#L1')
        self.assertEqual(self.links.destination('A.lean'), expected)
        self.assertEqual(self.queries, 1)
        self.links.clear()
        self.links.destination('A.lean')
        self.assertEqual(self.queries, 2)

    def test_unpushed_and_deleted_remote_branches_fall_back_to_main(self):
        self.git('checkout', '-qb', 'local-only')
        self.git('update-ref', 'refs/remotes/origin/local-only', 'HEAD')
        self.assertEqual(self.links.destination('A.lean'),
                         'https://github.com/owner/repo/blob/main/src/A.lean')
        self.git('checkout', '--detach', '-q')
        self.assertEqual(self.links.destination('A.lean'),
                         'https://github.com/owner/repo/blob/main/src/A.lean')

    def test_master_fallback_and_no_standard_branch(self):
        self.git('branch', 'master')
        self.git('push', '-q', str(self.remote), 'master', ':main')
        self.assertEqual(self.links.destination('A.lean'),
                         'https://github.com/owner/repo/blob/master/src/A.lean')
        self.git('push', '-q', str(self.remote), ':master')
        self.links.clear()
        self.assertEqual(self.links.destination('A.lean', 1), '/source?file=A.lean#L1')

    def test_branch_remote_preferred_then_origin_then_other(self):
        self.git('remote', 'add', 'upstream', 'https://gitlab.com/team/library.git')
        self.git('config', 'branch.main.remote', 'upstream')
        self.assertEqual(self.links.destination('A.lean'),
                         'https://gitlab.com/team/library/-/blob/main/src/A.lean')
        self.git('config', '--unset', 'branch.main.remote')
        self.assertIn('github.com/owner/repo/', self.links.destination('A.lean'))
        self.git('remote', 'remove', 'origin')
        self.assertIn('gitlab.com/team/library/', self.links.destination('A.lean'))

    def test_offline_uses_tracking_refs_but_does_not_guess(self):
        original = self.links._git
        with patch.object(self.links, '_git', side_effect=lambda *a: None if a[0] == 'ls-remote' else original(*a)):
            self.assertEqual(self.links.destination('A.lean'),
                             'https://github.com/owner/repo/blob/main/src/A.lean')
            self.git('update-ref', '-d', 'refs/remotes/origin/main')
            self.links.clear()
            self.assertEqual(self.links.destination('A.lean'), '/source?file=A.lean')

    def test_no_remote_or_git_or_supported_host_opens_local(self):
        self.git('remote', 'set-url', 'origin', str(self.remote))
        self.assertEqual(self.links.destination('A.lean'), '/source?file=A.lean')
        self.assertEqual(self.queries, 0)
        self.git('remote', 'remove', 'origin')
        self.assertEqual(self.links.destination('A.lean', 1), '/source?file=A.lean#L1')
        with patch.object(self.links, '_git', return_value=None):
            self.assertEqual(self.links.destination('A B.lean', 1), '/source?file=A+B.lean#L1')


if __name__ == '__main__':
    unittest.main()
