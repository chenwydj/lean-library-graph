"""Conservative local context for source references, without Lean elaboration.

The supported subset is deliberately explicit: named binder types and typed
have/let/set bindings. Unknown bindings still shadow global names. No theorem
suffix lookup or inference from tactic results is performed.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


IDENT = r"(?:«[^»\n]+»|[^\W\d][\w'!?]*)"
NAME = rf"{IDENT}(?:\.{IDENT})*"
NAMES = re.compile(NAME)
LEX = re.compile(rf"{NAME}|:=|=>|->|[^\s]", re.UNICODE)
PAIRS = {'(': ')', '[': ']', '{': '}', '⦃': '⦄', '⟨': '⟩'}


@dataclass(frozen=True)
class Binding:
    head: str | None
    refs: tuple[str, ...]
    namespace: str
    opens: tuple[str, ...]
    line: int
    column: int
    local_names: frozenset[str]


class Syntax:
    """Tokens and matched delimiters retain source locations and layout."""

    def __init__(self, code: str, first_line: int = 1):
        self.tokens = list(LEX.finditer(code))
        self.words = [m[0] for m in self.tokens]
        self.locations = []
        self.indents = []
        self.parents = []
        self.close = {}
        stack = []
        line, start, offset = first_line, 0, 0
        for i, m in enumerate(self.tokens):
            while (newline := code.find('\n', offset, m.start())) >= 0:
                line += 1
                start = newline + 1
                offset = start
            self.locations.append((line, m.start() - start + 1))
            prefix = code[start:m.start()]
            indent = len(prefix) - len(prefix.lstrip())
            # A bullet starts a sibling tactic scope, even on the same line.
            if '·' in prefix:
                indent = max(indent, prefix.rfind('·') + 2)
            self.indents.append(indent)
            self.parents.append(stack[-1] if stack else None)
            word = m[0]
            if word in PAIRS:
                stack.append(i)
            elif stack and word == PAIRS[self.words[stack[-1]]]:
                self.close[stack.pop()] = i

    def top(self, start: int, end: int):
        i = start
        while i < end:
            yield i
            i = self.close.get(i, i) + 1

    def scope_end(self, i: int) -> int:
        end = self.close.get(self.parents[i], len(self.words))
        line = self.locations[i][0]
        indent = self.indents[i]
        for j in range(i + 1, end):
            if self.locations[j][0] <= line:
                continue
            if self.indents[j] < indent:
                return j
            if self.indents[j] == indent and self.words[j] in {'·', '|'}:
                return j
        return end

    def value_end(self, assignment: int, command: int, end: int) -> int:
        """A local name is available after its initializer, never inside it."""
        line, indent = self.locations[command][0], self.indents[command]
        for j in self.top(assignment + 1, end):
            if self.words[j] in {';', 'in'}:
                return j + 1
            if self.locations[j][0] > line and self.indents[j] <= indent:
                return j
        return end

    def binding(self, start, end, namespace, opens, locals_):
        while start < end and self.words[start] == '(' and self.close.get(start) == end - 1:
            start, end = start + 1, end - 1
        top = list(self.top(start, end))
        head = self.words[start] if start < end and NAMES.fullmatch(self.words[start]) else None
        # Recognize a named type application, not an arrow, proposition operator,
        # or notation whose first operand happens to be a known declaration.
        if any(not (NAMES.fullmatch(self.words[j]) or self.words[j].isdigit()
                    or self.words[j] in {'(', '[', '{', '⦃'}) for j in top):
            head = None
        if head in {'forall', 'fun', 'Type', 'Prop', 'Sort'}:
            head = None
        if head and head.split('.')[0] in locals_:
            head = None
        refs = tuple(dict.fromkeys(w for w in self.words[start:end] if NAMES.fullmatch(w)))
        line, column = self.locations[start] if start < len(self.words) else (1, 1)
        return Binding(head, refs, namespace, tuple(opens), line, column, frozenset(locals_))

    def binder_group(self, i):
        end = self.close.get(i)
        if end is None or self.words[i] not in {'(', '{', '[', '⦃'}:
            return None
        colon = next((j for j in self.top(i + 1, end) if self.words[j] == ':'), None)
        if colon is None:
            return None
        names = list(range(i + 1, colon))
        if not names or any(not re.fullmatch(IDENT, self.words[j]) for j in names):
            return None
        default = next((j for j in self.top(colon + 1, end) if self.words[j] == ':='), end)
        return names, colon + 1, default, end


def read_variables(code, variables, namespace, opens, line):
    """Read a complete, possibly multiline variable command into its scope."""
    syntax = Syntax(code, line)
    result = variables.copy()
    for i in syntax.top(1, len(syntax.words)):
        group = syntax.binder_group(i)
        if group:
            names, start, end, _ = group
            binding = syntax.binding(start, end, namespace, opens, result)
            for j in names:
                result[syntax.words[j]] = binding
    return result


def source_references(code, header_end, *, variables, included, namespace, opens,
                      first_line, theorem=False):
    """Return positioned references with the receiver's context at that use.

    Explicit binder, lambda/forall, and layout-delimited tactic scopes use token
    intervals. Unsupported untyped locals shadow with an unknown type instead
    of inheriting an unrelated outer/global receiver.
    """
    syntax = Syntax(code, first_line)
    words, total = syntax.words, len(syntax.words)
    header = next((i for i, m in enumerate(syntax.tokens) if m.start() >= header_end), total)
    body = next((i for i in syntax.top(header, total) if words[i] in {':=', 'where'}), total)
    ranges = {}
    ignored = set(range(header))
    parameter_names = set()

    def local(name, pos):
        for start, end, binding in reversed(ranges.get(name, [])):
            if start <= pos < end:
                return True, binding
        return False, None

    def local_names(pos):
        return {name for name in ranges if local(name, pos)[0]}

    def bind(name, start, end, binding=None):
        ranges.setdefault(name, []).append((start, end, binding))

    # Only included/header-dependent section variables enter a theorem's proof.
    used = set(included) if theorem else set()
    relevant = words[header:body] if theorem else words[header:]
    used.update(w.split('.')[0] for w in relevant if NAMES.fullmatch(w))
    pending = list(used & variables.keys())
    used_variables = set()
    while pending:
        name = pending.pop()
        if name in used_variables:
            continue
        used_variables.add(name)
        pending.extend(r.split('.')[0] for r in variables[name].refs
                       if r.split('.')[0] in variables)
    for name in used_variables:
        bind(name, 0, total, variables[name])

    # Declaration parameters, in order. Nested type binders must not leak out.
    for i in syntax.top(header, body):
        if words[i] == ':':
            break
        group = syntax.binder_group(i)
        if group:
            names, start, end, close = group
            binding = syntax.binding(start, end, namespace, opens, local_names(i))
            ignored.update(names)
            for j in names:
                bind(words[j], close + 1, total, binding)
                parameter_names.add(words[j])

    for i in range(header, total):
        word = words[i]
        if word in {'fun', '∀', 'forall', '∃'}:
            end = syntax.scope_end(i)
            if i < body:
                end = min(end, body)
            arrow = next((j for j in syntax.top(i + 1, end) if words[j] in {'=>', ','}), None)
            if arrow is None:
                continue
            colon = next((j for j in syntax.top(i + 1, arrow) if words[j] == ':'), arrow)
            for j in syntax.top(i + 1, colon):
                group = syntax.binder_group(j)
                if group:
                    names, start, stop, close = group
                    binding = syntax.binding(start, stop, namespace, opens, local_names(j))
                    ignored.update(names)
                    for k in names:
                        bind(words[k], close + 1, end, binding)
                elif re.fullmatch(IDENT, words[j]):
                    ignored.add(j)
                    binding = (syntax.binding(colon + 1, arrow, namespace, opens, local_names(j))
                               if colon < arrow else None)
                    bind(words[j], arrow + 1, end, binding)
        elif i > body and word in {'have', 'let', 'set'} and i + 1 < total:
            name = i + 1
            if not re.fullmatch(IDENT, words[name]):
                continue
            end = syntax.scope_end(i)
            assignment = next((j for j in syntax.top(name + 1, end) if words[j] == ':='), None)
            if assignment is None:
                continue
            ignored.add(name)
            binding = None
            if name + 1 < assignment and words[name + 1] == ':':
                binding = syntax.binding(name + 2, assignment, namespace, opens, local_names(i))
            bind(words[name], syntax.value_end(assignment, i, end), end, binding)
        elif i > body and word in {'intro', 'intros'}:
            end = syntax.scope_end(i)
            j = i + 1
            while j < end and syntax.locations[j][0] == syntax.locations[i][0] and re.fullmatch(IDENT, words[j]):
                ignored.add(j)
                bind(words[j], j + 1, end)
                j += 1
        elif i > body and (word == 'case' or word == '|' and syntax.locations[i][1] == syntax.indents[i] + 1):
            end = syntax.scope_end(i)
            arrow = next((j for j in syntax.top(i + 1, end) if words[j] == '=>'), None)
            if arrow is None:
                continue
            # The first name is a constructor/case label; subsequent pattern
            # names are unknown locals, not receivers inherited from outside.
            for j in range(i + 2, arrow):
                if re.fullmatch(IDENT, words[j]):
                    ignored.add(j)
                    bind(words[j], arrow + 1, end)
        elif i > body and word in {'obtain', 'rcases'}:
            end = syntax.scope_end(i)
            marker = next((j for j in syntax.top(i + 1, end) if words[j] in {':=', 'with'}), None)
            if marker is None:
                continue
            if words[marker] == ':=':
                start, stop = i + 1, marker
                active = syntax.value_end(marker, i, end)
            else:
                start = marker + 1
                stop = next((j for j in range(start, end) if syntax.locations[j][0] > syntax.locations[marker][0]), end)
                active = stop
            for j in range(start, stop):
                if re.fullmatch(IDENT, words[j]):
                    ignored.add(j)
                    bind(words[j], active, end)

    references = []
    seen = set()
    actual_section_uses = (set(included) - parameter_names) & variables.keys() if theorem else set()
    for i in range(header, total):
        ref = words[i]
        if i in ignored or not NAMES.fullmatch(ref):
            continue
        root, dot, member = ref.partition('.')
        is_local, binding = local(root, i)
        if is_local and binding is variables.get(root) and root in variables:
            actual_section_uses.add(root)
        # An ordinary local use is not a global declaration reference.
        if is_local and not dot:
            continue
        key = (ref, is_local, binding)
        if key in seen:
            continue
        seen.add(key)
        line, column = syntax.locations[i]
        references.append(dict(name=ref, line=line, column=column,
                               local=is_local, receiver=binding if dot else None))
    # Types of used/included section variables are outside declaration source.
    pending = list(actual_section_uses)
    while pending:
        name = pending.pop()
        for ref in variables[name].refs:
            root = ref.split('.')[0]
            if root in variables and root not in actual_section_uses:
                actual_section_uses.add(root)
                pending.append(root)
    for name in sorted(actual_section_uses):
        binding = variables[name]
        for ref in binding.refs:
            if ref.split('.')[0] not in binding.local_names:
                references.append(dict(name=ref, line=binding.line, column=binding.column,
                                       local=False, receiver=None, context=binding,
                                       sectionVariable=name))
    return references
