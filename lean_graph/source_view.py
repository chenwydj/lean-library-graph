"""Escaped, line-addressable views of complete scanned Lean files."""

from html import escape
from urllib.parse import urlencode


def source_page(file: str, source: str) -> str:
    rows = ''.join(
        f'<div class="source-row" id="L{i}"><a class="line-number" href="#L{i}" '
        f'aria-label="Line {i}">{i}</a><code>{escape(line) or " "}</code></div>'
        for i, line in enumerate(source.splitlines() or [''], 1))
    raw_url = escape('/source?' + urlencode({'file': file, 'raw': '1'}), quote=True)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(file)} | Lean source</title><link rel="stylesheet" href="/source.css">
</head><body><header><div><h1>{escape(file)}</h1>
<p>Complete source from the graph snapshot. Refresh sources in the graph after edits.</p></div>
<a href="{raw_url}">Raw source</a></header>
<main aria-label="Lean source file">{rows}</main></body></html>'''
