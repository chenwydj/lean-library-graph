"""Resolve source links on demand, without fetching or changing a checkout."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from urllib.parse import quote, unquote, urlencode, urlsplit


@dataclass(frozen=True)
class RemoteWeb:
    base: str
    provider: str

    def file_url(self, branch: str, file: str, line: int = 0, end: int = 0) -> str:
        routes = {'github': 'blob', 'gitlab': '-/blob',
                  'bitbucket': 'src', 'codeberg': 'src/branch'}
        url = f'{self.base}/{routes[self.provider]}/{quote(branch, safe="")}/{quote(file, safe="/")}'
        if line:
            if self.provider == 'bitbucket':
                url += f'#lines-{line}' + (f':{end}' if end > line else '')
            else:
                url += f'#L{line}'
                if end > line:
                    url += f'-{end}' if self.provider == 'gitlab' else f'-L{end}'
        return url


def remote_web(remote: str) -> RemoteWeb | None:
    """Convert HTTPS/SSH clone URLs to browser URLs, never copying credentials."""
    if '://' not in remote:
        match = re.fullmatch(r'(?:[^/@:\s]+@)?([^/:\s]+):(.+)', remote)
        if not match:
            return None  # A filesystem remote has no browser file view.
        remote = f'ssh://{match[1]}/{match[2]}'
    try:
        parsed = urlsplit(remote)
        host = (parsed.hostname or '').lower()
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in {'https', 'http', 'ssh', 'git'} or not host:
        return None
    if host == 'github.com' or host.startswith('github.'):
        provider = 'github'
    elif host == 'gitlab.com' or host.startswith('gitlab.'):
        provider = 'gitlab'
    elif host == 'bitbucket.org':
        provider = 'bitbucket'
    elif host == 'codeberg.org':
        provider = 'codeberg'
    else:
        return None
    path = unquote(parsed.path).strip('/').removesuffix('.git')
    if len(path.split('/')) < 2 or any(p in {'', '.', '..'} for p in path.split('/')):
        return None
    scheme = parsed.scheme if parsed.scheme in {'http', 'https'} else 'https'
    authority = host + (f':{port}' if port and parsed.scheme in {'http', 'https'} else '')
    return RemoteWeb(f'{scheme}://{authority}/{quote(path, safe="/")}', provider)


class SourceLinks:
    """Remote selection and short-lived ref cache, independent of source scanning.

    Prefer the current branch's configured remote, then origin, then the first
    supported remote. Online refs are authoritative, even when a cached local
    remote-tracking branch still exists. Offline, use remote-tracking refs only.
    """

    def __init__(self, root: Path):
        self.root = root.resolve()
        self._heads = {}
        self._lock = threading.Lock()

    def clear(self):
        with self._lock:
            self._heads.clear()

    def _git(self, *args: str) -> str | None:
        env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never',
               'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes'}
        try:
            result = subprocess.run(
                ['git', '-c', 'core.fsmonitor=false', '-C', str(self.root), *args],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=8, env=env, encoding='utf-8', errors='replace', check=False)
            return result.stdout.strip() if result.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None

    def _branches(self, remote: str, clone_url: str) -> set[str]:
        key = (remote, clone_url)
        with self._lock:
            cached = self._heads.get(key)
            if cached and time.monotonic() - cached[0] < 60:
                return cached[1]
            output = self._git('ls-remote', '--heads', '--', remote)
            if output is not None:
                refs = [line.split('\t', 1)[-1] for line in output.splitlines()]
                branches = {ref[len('refs/heads/'):] for ref in refs if ref.startswith('refs/heads/')}
            else:
                prefix = f'refs/remotes/{remote}/'
                refs = self._git('for-each-ref', '--format=%(refname)', prefix) or ''
                branches = {ref[len(prefix):] for ref in refs.splitlines()
                            if ref.startswith(prefix) and ref != prefix + 'HEAD'}
            self._heads[key] = (time.monotonic(), branches)
            return branches

    def destination(self, file: str, line: int = 0, end: int = 0) -> str:
        local = '/source?' + urlencode({'file': file}) + (f'#L{line}' if line else '')
        repo = self._git('rev-parse', '--show-toplevel')
        if not repo:
            return local
        try:
            path = (self.root / file).resolve().relative_to(Path(repo).resolve()).as_posix()
        except ValueError:
            return local
        branch = self._git('symbolic-ref', '--quiet', '--short', 'HEAD') or ''
        preferred = self._git('config', '--get', f'branch.{branch}.remote') if branch else None
        remotes = (self._git('remote') or '').splitlines()
        for remote in dict.fromkeys([preferred, 'origin', *remotes]):
            if not remote or remote not in remotes:
                continue
            clone_url = self._git('config', '--get', f'remote.{remote}.url') or ''
            web = remote_web(clone_url)
            if web is None:
                continue
            branches = self._branches(remote, clone_url)
            selected = next((b for b in (branch, 'main', 'master') if b and b in branches), None)
            # No evidence for an existing matching/main/master branch: avoid a
            # fabricated remote URL and keep the readable local snapshot.
            if selected is None:
                return local
            return web.file_url(selected, path, line, end)
        return local
