"""CLI and read-only, loopback-only HTTP server."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit
import webbrowser

from .scanner import ScanConfig, build_graph
from .history import GitHistory, GitError
from .source_view import source_page

WEB = Path(__file__).with_name("web")


class GraphStore:
    def __init__(self, config: ScanConfig):
        self.config = config
        self.lock = threading.Lock()
        self.sources = {}
        self.graph = build_graph(config, source_contents=self.sources)
        self.histories = {}

    def get(self, refresh: bool = False) -> dict:
        with self.lock:
            if refresh:
                sources = {}
                graph = build_graph(self.config, source_contents=sources)
                self.graph, self.sources = graph, sources
                self.histories.clear()
            return self.graph

    def source(self, file: str) -> str | None:
        # Exact keys from the scanner only. Never resolve client-supplied paths.
        with self.lock:
            return self.sources.get(file)

    def history(self, window: int) -> dict:
        with self.lock:
            if window not in self.histories:
                data = GitHistory(self.config.root).analyze(self.graph, window)
                # Keep memory bounded when trying many history windows.
                if len(self.histories) >= 3:
                    self.histories.pop(next(iter(self.histories)))
                self.histories[window] = data
            return self.histories[window]


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, store: GraphStore, **kwargs):
        self.store = store
        super().__init__(*args, **kwargs)

    def send_bytes(self, payload: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def json(self, payload: object, status: int = 200) -> None:
        self.send_bytes(json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        # Reject foreign Host/Origin values to prevent browser-driven access to
        # library source via DNS rebinding. No arbitrary filesystem routes exist.
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get("Host", "") not in allowed:
            self.json({"error": "Only localhost requests are accepted"}, 403)
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in allowed}:
            self.json({"error": "Cross-origin requests are not accepted"}, 403)
            return
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == "/api/graph":
                graph = self.store.get(query.get("refresh") == ["1"])
                # Bodies are fetched on demand so large libraries load faster.
                self.json({**graph, "declarations": [{k: v for k, v in d.items() if k != "body"} for d in graph["declarations"]]})
            elif url.path == "/api/node":
                node = next((d for d in self.store.get()["declarations"] if d["id"] == query.get("id", [""])[0]), None)
                self.json(node if node else {"error": "Declaration not found; refresh the graph"}, 200 if node else 404)
            elif url.path == "/api/export":
                self.json(self.store.get())
            elif url.path == '/source':
                file = query.get('file', [''])[0]
                source = self.store.source(file)
                if source is None:
                    self.json({'error': 'File is not in the scanned library; refresh the graph'}, 404)
                elif query.get('raw') == ['1']:
                    self.send_bytes(source.encode('utf-8'), 'text/plain; charset=utf-8')
                else:
                    self.send_bytes(source_page(file, source).encode('utf-8'), 'text/html; charset=utf-8')
            elif url.path in {"/api/history", "/api/node-history"}:
                try:
                    window = int(query.get('window', ['20'])[0])
                    if not 1 <= window <= 200:
                        raise ValueError()
                except ValueError:
                    self.json({'error': 'Recent commits must be an integer from 1 to 200'}, 400)
                    return
                history = self.store.history(window)
                if url.path == '/api/history':
                    self.json({k: v for k, v in history.items() if not k.startswith('_')})
                else:
                    node_id = query.get('id', [''])[0]
                    node = history.get('nodes', {}).get(node_id)
                    if not history['available']:
                        self.json(history)
                    elif node is None:
                        self.json({'error': 'Declaration not found; refresh the graph'}, 404)
                    else:
                        sha = query.get('commit', [''])[0]
                        if not sha and node['commits']:
                            sha = node['commits'][0]['sha']
                        detail = history['_details'].get((node_id, sha))
                        if sha and detail is None:
                            self.json({'error': 'Commit is not a change to this declaration in the selected window'}, 404)
                        else:
                            self.json(dict(available=True, **node, selected=detail,
                                           inspectedCommits=history['inspectedCommits']))
            elif url.path in {"/", "/index.html", "/app.js", "/layout.js", "/importance.js", "/pins.js", "/pdf.js", "/navigation.js", "/relationships.js", "/style.css", "/source.css"}:
                filename = "index.html" if url.path == "/" else url.path[1:]
                content_type = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}[Path(filename).suffix]
                self.send_bytes((WEB / filename).read_bytes(), f"{content_type}; charset=utf-8")
            elif url.path == "/favicon.ico":
                self.send_bytes(b"", "image/x-icon", 204)
            else:
                self.json({"error": "Not found"}, 404)
        except (ValueError, OSError, GitError) as error:
            self.json({"error": str(error)}, 500)

    def log_message(self, format, *args):
        if args and str(args[1] if len(args) > 1 else "") not in {"200", "204"}:
            super().log_message(format, *args)


def make_server(config: ScanConfig, port: int = 8765) -> ThreadingHTTPServer:
    store = GraphStore(config)
    return ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, store=store))


def main() -> None:
    parser = argparse.ArgumentParser(description="Explore any Lean source directory using Archon's grouped graph layout.")
    parser.add_argument("library", type=Path, help="Lean library or source directory (read only)")
    parser.add_argument("--source-root", action="append", help="Import search root relative to library, repeatable; default: .")
    parser.add_argument("--exclude", action="append", default=[], help="Exclude a relative path glob or basename, repeatable")
    parser.add_argument("--port", type=int, default=8765, help="Localhost port, 0 chooses a free port (default: 8765)")
    parser.add_argument("--open", action="store_true", help="Open the graph in the default browser")
    parser.add_argument("--export", type=Path, metavar="JSON", help="Write a full JSON graph and exit")
    args = parser.parse_args()
    try:
        config = ScanConfig(args.library, tuple(args.source_root or ["."]), tuple(args.exclude))
        if args.export:
            graph = build_graph(config)
            args.export.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Exported {graph['stats']['declarations']} declarations to {args.export}")
            return
        if not 0 <= args.port <= 65535:
            raise ValueError("Port must be between 0 and 65535")
        server = make_server(config, args.port)
    except (ValueError, OSError) as error:
        parser.exit(2, f"lean-library-graph: {error}\n")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Lean Library Graph: {config.root}\n{url}\nSource analysis; Ctrl+C to stop.", flush=True)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
