from http.client import HTTPConnection
from pathlib import Path
import json
import tempfile
import threading
import unittest
from urllib.parse import urlencode
from unittest.mock import patch

from lean_graph.cli import make_server
from lean_graph.scanner import ScanConfig


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        (cls.root / 'A.lean').write_text('def a := 0\n')
        cls.server = make_server(ScanConfig(cls.root), 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def get(self, path, headers=None):
        conn = HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request('GET', path, headers=headers or {})
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        return response.status, payload

    def test_graph_node_refresh_and_assets(self):
        status, payload = self.get('/api/graph')
        graph = json.loads(payload)
        self.assertEqual(status, 200)
        self.assertNotIn('body', graph['declarations'][0])
        from urllib.parse import quote
        status, payload = self.get('/api/node?id=' + quote(graph['declarations'][0]['id']))
        self.assertEqual(json.loads(payload)['body'], 'def a := 0')
        (self.root / 'B.lean').write_text('import A\ndef b := a\n')
        self.assertEqual(json.loads(self.get('/api/graph?refresh=1')[1])['stats']['files'], 2)
        for asset in ['/', '/app.js', '/layout.js', '/importance.js', '/pins.js', '/pdf.js', '/navigation.js', '/relationships.js', '/style.css', '/api/export']:
            self.assertEqual(self.get(asset)[0], 200)

    def test_history_unavailable_and_validation(self):
        self.assertFalse(json.loads(self.get('/api/history')[1])['available'])
        self.assertEqual(self.get('/api/history?window=0')[0],400)
        self.assertEqual(self.get('/api/history?window=201')[0],400)
        self.assertEqual(self.get('/api/history?window=oops')[0],400)

    def test_no_arbitrary_files_or_foreign_origins(self):
        self.assertEqual(self.get('/../../etc/passwd')[0], 404)
        self.assertEqual(self.get('/api/node?id=../../etc/passwd')[0], 404)
        self.assertEqual(self.get('/api/graph', {'Host': 'foreign.example'})[0], 403)
        self.assertEqual(self.get('/api/graph', {'Origin': 'https://foreign.example'})[0], 403)
        self.assertEqual(self.get('/source?file=../../etc/passwd')[0], 404)
        self.assertEqual(self.get('/source?file=/etc/passwd')[0], 404)
        self.assertEqual(self.get('/source?file=A.lean', {'Origin': 'https://foreign.example'})[0], 403)

    def test_source_file_lines_escaping_and_snapshot_refresh(self):
        file = 'Source & test.lean'
        path = self.root / file
        source = '-- <script>alert("test")</script>\nimport Init\n\ntheorem demo : True := by\n  trivial\n'
        try:
            path.write_text(source)
            self.get('/api/graph?refresh=1')
            route = '/source?' + urlencode({'file':file})
            status, payload = self.get(route)
            html = payload.decode()
            self.assertEqual(status,200)
            self.assertIn('Source &amp; test.lean',html)
            self.assertIn('&lt;script&gt;',html)
            self.assertNotIn('<script>',html)
            self.assertIn('id="L4"',html)
            self.assertIn('href="#L4"',html)
            self.assertIn('  trivial',html)
            self.assertEqual(self.get(route+'&raw=1')[1].decode(),source)
            path.write_text('import Init\n')
            self.assertEqual(self.get(route+'&raw=1')[1].decode(),source)
            self.get('/api/graph?refresh=1')
            self.assertEqual(self.get(route+'&raw=1')[1].decode(),'import Init\n')
            self.assertEqual(self.get('/source.css')[0],200)
        finally:
            path.unlink(missing_ok=True)
            self.get('/api/graph?refresh=1')
        self.assertEqual(self.get(route)[0],404)

    def test_open_source_redirects_and_validates_file_and_lines(self):
        def location(route):
            conn = HTTPConnection('127.0.0.1', self.server.server_port)
            conn.request('GET', route)
            response = conn.getresponse()
            result = response.status, response.getheader('Location'), response.getheader('Cache-Control')
            response.read()
            conn.close()
            return result

        self.assertEqual(location('/open-source?file=A.lean&line=1'),
                         (302, '/source?file=A.lean#L1', 'no-store'))
        self.assertEqual(location('/open-source?file=A.lean'),
                         (302, '/source?file=A.lean', 'no-store'))
        with patch('lean_graph.source_links.SourceLinks.destination',
                   return_value='https://github.com/owner/repo/blob/main/A.lean#L1') as resolve:
            status, target, cache = location('/open-source?file=A.lean&line=1&end=1')
            self.assertEqual(status, 302)
            self.assertEqual(target, 'https://github.com/owner/repo/blob/main/A.lean#L1')
            resolve.assert_called_once_with('A.lean', 1, 1)
            for query in ['file=../A.lean', 'file=/tmp/A.lean', 'file=missing.lean']:
                self.assertEqual(location('/open-source?' + query)[0], 404)
            for query in ['line=abc', 'line=-1', 'line=2', 'line=1&end=0', 'line=0&end=1']:
                self.assertEqual(location('/open-source?file=A.lean&' + query)[0], 400)
            self.assertEqual(resolve.call_count, 1)
        self.assertEqual(self.get('/open-source?file=A.lean', {'Origin': 'https://foreign.example'})[0], 403)


if __name__ == '__main__':
    unittest.main()
