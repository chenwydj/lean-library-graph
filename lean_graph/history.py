"""Read-only Git activity for source declarations. Never builds or checks out Lean.

Count one change per first-parent commit when a declaration's complete source
body differs from its parent's. Pure line shifts and file renames do not count.
Named declarations are matched by (kind, full name), independent of line numbers.
Anonymous declarations use kind/ordinal within their file; this is approximate.
Only current nodes with an unambiguous counterpart at HEAD are followed.
"""

from collections import defaultdict
from difflib import unified_diff
from hashlib import sha256
from pathlib import Path
import subprocess

from .scanner import parse_source


class GitError(RuntimeError):
    pass


class GitHistory:
    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()
        self.repo = self.root
        self.parsed: dict[str, dict] = {}

    def git(self, *args: str) -> bytes:
        try:
            result = subprocess.run(
                ['git', '-c', 'core.fsmonitor=false', '-C', str(self.repo), *args],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise GitError(str(error)) from error
        if result.returncode:
            raise GitError(result.stderr.decode('utf-8', errors='replace').strip())
        return result.stdout

    @staticmethod
    def keyed(declarations: list[dict]) -> dict:
        grouped = defaultdict(list)
        ordinal = defaultdict(int)
        for d in declarations:
            if d['anonymous']:
                ordinal[d['kind']] += 1
                key = (d['kind'], f"@anonymous:{ordinal[d['kind']]}")
            else:
                key = (d['kind'], d['fullName'])
            grouped[key].append(d)
        # Never assign history to an arbitrary duplicate name.
        return {key: values[0] for key, values in grouped.items() if len(values) == 1}

    def snapshot(self, commit: str, path: str) -> dict:
        raw = self.git('show', f'{commit}:{path}')
        digest = sha256(raw).hexdigest()
        if digest not in self.parsed:
            declarations, _ = parse_source(raw.decode('utf-8-sig'), path, '')
            self.parsed[digest] = self.keyed(declarations)
        return self.parsed[digest]

    def changes(self, sha: str, parent: str) -> list[tuple[str, str, str]]:
        if parent:
            raw = self.git('diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', parent, sha)
        else:
            raw = self.git('diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '--root', sha)
        tokens = raw.decode('utf-8').split('\0')
        changes = []
        i = 0
        while i < len(tokens) and tokens[i]:
            status, old = tokens[i:i + 2]
            i += 2
            new = old
            if status[0] in {'R', 'C'}:
                new = tokens[i]
                i += 1
            changes.append((status[0], old, new))
        return changes

    def analyze(self, graph: dict, window: int) -> dict:
        if not 1 <= window <= 200:
            raise ValueError('Recent commits must be between 1 and 200')
        try:
            self.repo = Path(self.git('rev-parse', '--show-toplevel').decode().strip())
            head = self.git('rev-parse', 'HEAD').decode().strip()
        except GitError as error:
            return dict(available=False, reason=f'Git history unavailable: {error}', window=window)

        prefix = self.root.relative_to(self.repo).as_posix()
        prefix = '' if prefix == '.' else prefix + '/'
        tracked = set(self.git('ls-tree', '-r', '--name-only', '-z', head).decode().split('\0'))
        log = self.git('log', '--first-parent', f'-{window}', '--format=%H%x09%P%x09%ct%x09%s', head).decode()
        commits = []
        for line in log.splitlines():
            sha, parents, timestamp, subject = line.split('\t', 3)
            if not parents:
                # Git log hides parents at a shallow boundary. Inspect the raw
                # commit so a missing parent cannot masquerade as file creation.
                header = self.git('cat-file', '-p', sha).decode().split('\n\n', 1)[0]
                parents = ' '.join(row[7:] for row in header.splitlines() if row.startswith('parent '))
            commits.append(dict(sha=sha, parent=parents.split()[0] if parents else '',
                                timestamp=int(timestamp), subject=subject))
        nodes = {d['id']: dict(changeCount=0, commits=[], tracked=False,
                              anonymous=d['anonymous'], workingTreeChanged=False) for d in graph['declarations']}
        modules = {f['module']: dict(changeCount=0, commits=[]) for f in graph['files']}
        details = {}
        warnings = []
        current_files = defaultdict(list)
        for d in graph['declarations']:
            current_files[prefix + d['file']].append(d)
        # path -> historical declaration keys -> IDs in the current source graph
        lineage = {}
        for path, declarations in current_files.items():
            if path not in tracked:
                continue
            at_head = self.snapshot(head, path)
            live = {}
            for key, d in self.keyed(declarations).items():
                if key in at_head:
                    live[key] = d['id']
                    nodes[d['id']]['tracked'] = True
                    nodes[d['id']]['workingTreeChanged'] = d['body'] != at_head[key]['body']
            if live:
                lineage[path] = live
        file_lineage = {prefix + f['file']: f['module'] for f in graph['files'] if prefix + f['file'] in tracked}

        for commit in commits:
            sha, parent = commit['sha'], commit['parent']
            try:
                changes = self.changes(sha, parent)
            except GitError as error:
                # Shallow history must not silently treat a missing parent as empty.
                warnings.append(f"Could not compare {sha[:8]} to its parent: {error}")
                continue
            for status, old_path, new_path in changes:
                if status == 'D' or (new_path not in lineage and new_path not in file_lineage):
                    continue
                before = {} if status == 'A' else self.snapshot(parent, old_path)
                after = self.snapshot(sha, new_path)
                live = lineage.pop(new_path, {})
                module_id = file_lineage.pop(new_path, None)
                next_live = {}
                for key, node_id in live.items():
                    old, new = before.get(key), after.get(key)
                    if new is None:
                        continue
                    old_body, new_body = old['body'] if old else '', new['body']
                    if old_body != new_body:
                        meta = {**commit, 'added': old is None,
                                'oldPath': old_path, 'newPath': new_path}
                        nodes[node_id]['changeCount'] += 1
                        nodes[node_id]['commits'].append(meta)
                        diff = '\n'.join(unified_diff(old_body.splitlines(), new_body.splitlines(),
                            fromfile=f"{parent[:8] or 'empty'}/{old_path}", tofile=f"{sha[:8]}/{new_path}", lineterm=''))
                        details[(node_id, sha)] = dict(**meta, diff=diff, before=old_body, after=new_body)
                    if old is not None:
                        next_live[key] = node_id
                # Module heat counts commits changing at least one parsed declaration,
                # not imports-only edits or textual movement outside a declaration.
                if module_id is not None:
                    before_bodies = {k: d['body'] for k, d in before.items()}
                    after_bodies = {k: d['body'] for k, d in after.items()}
                    if before_bodies != after_bodies:
                        modules[module_id]['changeCount'] += 1
                        modules[module_id]['commits'].append(commit)
                if status != 'A':
                    if next_live:
                        lineage[old_path] = next_live
                    if module_id is not None:
                        file_lineage[old_path] = module_id

        return dict(available=True, head=head, window=window, inspectedCommits=len(commits),
                    comparison='first-parent', includesWorkingTree=False, commits=commits,
                    nodes=nodes, modules=modules, warnings=warnings, _details=details)
