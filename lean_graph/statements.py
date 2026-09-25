"""Prepare the Statement inspector content without invoking Lean.

Only lemma/theorem tactic proofs are omitted; other declarations stay complete.
The masked shadow has the same offsets as the source, so delimiters inside
comments, strings, quoted identifiers, attributes and binders are ignored.
"""

import re


def extract_statement(body: str, shadow: str, kind: str) -> str:
    if kind not in {"lemma", "theorem"}:
        return body
    return before_tactic_proof(body, shadow)


def before_tactic_proof(body: str, shadow: str) -> str:
    """Module previews omit a top-level tactic body for any declaration kind."""
    depth = 0
    i = 0
    while i < len(shadow):
        char = shadow[i]
        if char == "«":
            end = shadow.find("»", i + 1)
            i = len(shadow) if end < 0 else end + 1
            continue
        if char in "([{⦃⟨":
            depth += 1
        elif char in ")] }⦄⟩".replace(" ", ""):
            depth = max(0, depth - 1)
        if depth == 0 and shadow.startswith(":=", i):
            if re.match(r":=\s*by\b", shadow[i:]):
                return body[:i].rstrip()
            # A term-style proof has no := by boundary. Keep it intact, and
            # do not mistake a later assignment inside its body for the header.
            return body
        i += 1
    return body
