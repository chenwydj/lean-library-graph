"""Source-level Lean graph extraction. No Lean installation or project writes.

Adapted from Archon's proofgraph.ts scanner (Apache-2.0). This scanner is
deliberately not an elaborator: declaration edges are inferred lexical references.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path
import os
import re

from .statements import extract_statement, before_tactic_proof
from .source_context import IDENT as CONTEXT_IDENT, read_variables, source_references


IDENT = r"(?:«[^»\n]+»|[^\W\d][\w'!?]*)"
NAME = rf"{IDENT}(?:\.{IDENT})*"
TOKEN = re.compile(NAME)
RAW_STRING = re.compile(r'r(#+)?"')
CHAR = re.compile(r"'(?:\\(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)|[^'\n\\])'")
MODIFIERS = r"(?:(?:private|public|protected|noncomputable|irreducible|unsafe|scoped|local|partial|nonrec|meta)\s+)*"
DECL = re.compile(rf"^{MODIFIERS}(theorem|lemma|def|instance|class|structure|inductive|abbrev|example|axiom|opaque|constant)\b\s*({NAME})?")
SCOPE = re.compile(rf"^{MODIFIERS}(namespace|section|end)\b\s*({NAME})?")
IMPORT = re.compile(r"^(?:(?:public|private|meta)\s+)*import\s+(?:all\s+)?(.+)$")
OUTSIDE = re.compile(r"^(?:open|variable|variables|universe|universes|attribute|include|omit|export|set_option|syntax|macro|macro_rules|elab|notation|infix[lr]?|prefix|postfix|initialize|builtin_initialize|deriving|#\w+)\b")
SKIP_DIRS = {".lake", "_lake", ".git", ".archon", "node_modules", "__pycache__", ".venv", "venv", "build", "dist"}
KEYWORDS = set("import open namespace section end variable universe theorem lemma def instance class structure inductive abbrev example axiom opaque constant by where fun match with if then else let in have show from intro simp rw rfl exact apply constructor cases induction sorry admit calc do return pure true false Type Prop Sort noncomputable private protected partial unsafe mutual public all scoped local".split())


def mask_noncode(text: str) -> str:
    """Blank nested comments, strings, and character literals, retaining offsets.

    Quoted identifiers stay intact, including comment-looking text inside them.
    Lean raw strings (r#"..."#) and escaped regular strings are both supported.
    """
    result = list(text)
    i, n = 0, len(text)

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if text[k] != "\n":
                result[k] = " "

    while i < n:
        start = i
        if text[i] == "«":
            close = text.find("»", i + 1)
            i = n if close < 0 else close + 1
            continue
        if text.startswith("--", i):
            stop = text.find("\n", i)
            i = n if stop < 0 else stop
        elif text.startswith("/-", i):
            i += 2
            depth = 1
            while i < n and depth:
                if text.startswith("/-", i):
                    depth += 1
                    i += 2
                elif text.startswith("-/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
        elif text[i] == "r" and (raw := RAW_STRING.match(text, i)) and (i == 0 or not re.match(r"[\w']", text[i - 1])):
            terminator = '"' + (raw[1] or "")
            stop = text.find(terminator, i + len(raw[0]))
            i = n if stop < 0 else stop + len(terminator)
        elif text[i] == '"':
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                elif text[i] == '"':
                    i += 1
                    break
                else:
                    i += 1
            i = min(i, n)
        elif text[i] == "'" and (i == 0 or not re.match(r"[\w']", text[i - 1])) and (char := CHAR.match(text, i)):
            i += len(char[0])
        else:
            i += 1
            continue
        blank(start, i)
    return "".join(result)


def strip_attributes(code: str) -> str:
    """Mask attribute blocks, including multiline and nested brackets."""
    chars = list(code)
    i = 0
    while i < len(code) - 1:
        if code[i:i + 2] != "@[":
            i += 1
            continue
        start, depth = i, 1
        i += 2
        while i < len(code) and depth:
            depth += (code[i] == "[") - (code[i] == "]")
            i += 1
        for j in range(start, i):
            if chars[j] != "\n":
                chars[j] = " "
    return "".join(chars)


def qualify(namespace: str, name: str) -> str:
    if name.startswith("_root_."):
        return name[7:]
    return f"{namespace}.{name}" if namespace else name


def parse_source(text: str, file: str, module: str) -> tuple[list[dict], list[str]]:
    lines = text.splitlines()
    masked = mask_noncode(text)
    code = strip_attributes(masked).splitlines()
    original_code = masked.splitlines()
    declarations: list[dict] = []
    imports: list[str] = []
    # Section variables and include/omit state obey namespace/section lifetimes.
    scopes = []
    namespace = ""
    opened: list[str] = []
    variables = {}
    included: set[str] = set()
    variable_command = None
    command_inclusion = None
    active: dict | None = None

    def finish(end: int) -> None:
        nonlocal active
        if active is None:
            return
        start = active.pop("_start")
        active.pop("_indent")
        # Trailing masked doc comments/attributes belong to the following command.
        while end > start + 1 and not code[end - 1].strip():
            end -= 1
        body = "\n".join(lines[start:end])
        shadow = "\n".join(original_code[start:end])
        tokens = [m[0] for m in TOKEN.finditer(shadow)]
        active.update(endLine=end, body=body,
                      sorryCount=sum(t in {"sorry", "admit"} for t in tokens))
        active["hasSorry"] = active["sorryCount"] > 0
        # Exclude the header name itself, but retain references in its type.
        ref_code = "\n".join(code[start:end])
        header_end = active.pop('_headerEnd')
        active["_refs"] = source_references(ref_code, header_end,
            variables=active.pop("_variables"), included=active.pop("_included"),
            namespace=active["namespace"], opens=active["_opens"], first_line=start + 1,
            theorem=active["kind"] in {"theorem", "lemma", "example"})
        statement = extract_statement(body, strip_attributes(shadow), active["kind"])
        active["statement"] = statement
        active["previewStatement"] = before_tactic_proof(body, strip_attributes(shadow))
        active["signature"] = statement[:2000]
        declarations.append(active)
        active = None

    for i, line in enumerate(code):
        stripped = line.strip()
        if not stripped:
            if variable_command is not None:
                variable_command[1].append(line)
            continue
        # Attribute masking must not increase the declaration's indentation.
        indent = len(lines[i]) - len(lines[i].lstrip())
        declaration_code = stripped
        inline_inclusion = re.match(r'(include|omit)\s+(.+?)\s+in\s+', stripped)
        if inline_inclusion and DECL.match(stripped[inline_inclusion.end():]):
            declaration_code = stripped[inline_inclusion.end():]
        else:
            inline_inclusion = None
        dm, sm, im = DECL.match(declaration_code), SCOPE.match(stripped), IMPORT.match(stripped)
        outside = OUTSIDE.match(stripped)
        boundary = dm or sm or im or outside
        if active and boundary and indent > active["_indent"]:
            continue
        if variable_command is not None:
            if not boundary:
                variable_command[1].append(line)
                continue
            variables = read_variables("\n".join(variable_command[1]), variables,
                                       namespace, opened, variable_command[0] + 1)
            variable_command = None
        if boundary:
            finish(i)
        if im:
            imports.extend(TOKEN.findall(im[1]))
        elif sm:
            kind, name = sm.groups()
            if kind == "end":
                if scopes:
                    namespace, opened, variables, included = scopes.pop()
            else:
                scopes.append((namespace, opened.copy(), variables.copy(), included.copy()))
                if kind == "namespace" and name:
                    namespace = qualify(namespace, name)
        elif re.match(r"variables?\b", stripped):
            variable_command = [i, [line]]
        elif not dm and (inclusion := re.match(r"(include|omit)\s+(.+)$", stripped)):
            names = TOKEN.findall(inclusion[2])
            local_command = bool(names and names[-1] == 'in')
            if local_command:
                names.pop()
            target = included.copy()
            if inclusion[1] == 'include':
                target.update(names)
            else:
                target.difference_update(names)
            if local_command:
                command_inclusion = target
            else:
                included = target
        elif re.match(r"open\s+", stripped):
            rest = stripped[5:].strip()
            # Restricted/renamed and command-local opens need elaboration.
            if not rest.startswith("scoped ") and not re.search(r"[()]|\bin\b", rest):
                for name in TOKEN.findall(rest):
                    opened.extend(dict.fromkeys([qualify(namespace, name), name]))
        elif dm:
            kind, name = dm.groups()
            if kind == "example" or not name:
                name = f"({kind} at line {i + 1})"
                anonymous = True
            else:
                anonymous = False
            full_name = qualify(namespace, name)
            declaration_included = (included if command_inclusion is None else command_inclusion).copy()
            if inline_inclusion:
                names = TOKEN.findall(inline_inclusion[2])
                if inline_inclusion[1] == 'include':
                    declaration_included.update(names)
                else:
                    declaration_included.difference_update(names)
            # Source coordinates distinguish private names and duplicate examples.
            active = dict(id=f"{file}:{i + 1}:{full_name}", name=name,
                          fullName=full_name, kind=kind, file=file, module=module,
                          line=i + 1, namespace=namespace, anonymous=anonymous,
                          private=bool(re.search(r"\bprivate\b", declaration_code[:dm.start(1)])),
                          protected=bool(re.search(r"\bprotected\b", declaration_code[:dm.start(1)])),
                          _opens=opened.copy(), _variables=variables.copy(),
                          _included=declaration_included,
                          _headerEnd=len(line)-len(line.lstrip())+len(stripped)-len(declaration_code)+dm.end(),
                          _start=i, _indent=indent)
            command_inclusion = None
    finish(len(lines))
    return declarations, list(dict.fromkeys(imports))


@dataclass
class ScanConfig:
    root: Path
    source_roots: tuple[str, ...] = (".",)
    excludes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        self.root = self.root.expanduser().resolve()
        if not self.root.is_dir():
            raise ValueError(f"Not a library directory: {self.root}")
        for source in self.source_roots:
            candidate = (self.root / source).resolve()
            if not candidate.is_relative_to(self.root) or not candidate.is_dir():
                raise ValueError(f"Source root must be a directory inside the library: {source}")


def source_files(config: ScanConfig) -> list[tuple[Path, str, str]]:
    found: dict[Path, tuple[Path, str, str]] = {}
    for source in config.source_roots:
        base = (config.root / source).resolve()
        def excluded(p: Path) -> bool:
            rel = p.relative_to(config.root).as_posix()
            return any(fnmatch(rel, pattern) or fnmatch(p.name, pattern) for pattern in config.excludes)
        def walk_error(error: OSError) -> None:
            raise error
        for directory, dirs, names in os.walk(base, onerror=walk_error, followlinks=False):
            parent = Path(directory)
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")
                             and not (parent / d).is_symlink() and not excluded(parent / d))
            for name in sorted(names):
                p = parent / name
                if p.suffix != ".lean" or name == "lakefile.lean" or p.is_symlink() or excluded(p):
                    continue
                rel = p.relative_to(config.root).as_posix()
                # source-root is a Lean import search root, e.g. src/ -> Foo.Bar.
                module = ".".join(p.relative_to(base).with_suffix("").parts)
                if p in found and found[p][2] != module:
                    raise ValueError(f"Overlapping source roots assign different module names to {rel}")
                found[p] = (p, rel, module)
    return sorted(found.values(), key=lambda item: item[1])


def build_graph(config: ScanConfig, *, source_contents: dict[str, str] | None = None) -> dict:
    declarations: list[dict] = []
    files: list[dict] = []
    warnings: list[str] = []
    for path, rel, module in source_files(config):
        try:
            text = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as error:
            warnings.append(f"Could not read {rel}: {error}")
            continue
        ds, imports = parse_source(text, rel, module)
        if source_contents is not None:
            source_contents[rel] = text
        declarations.extend(ds)
        files.append(dict(id=module, file=rel, module=module, imports=imports,
                          declarations=[d["id"] for d in ds], lineCount=len(text.splitlines()),
                          sorryCount=sum(t in {"sorry", "admit"} for t in TOKEN.findall(mask_noncode(text)))))
    modules: dict[str, dict] = {}
    for f in files:
        if f["module"] in modules:
            raise ValueError(f"Duplicate module {f['module']}; choose nonoverlapping source roots")
        modules[f["module"]] = f

    module_edges = [dict(from_=f["module"], to=m) for f in files for m in f["imports"]]
    module_edges = [{"from": e["from_"], "to": e["to"]} for e in module_edges]
    external = sorted({e["to"] for e in module_edges} - modules.keys())
    closure: dict[str, set[str]] = {}
    for module in modules:
        seen: set[str] = set()
        pending = [module]
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            pending.extend(m for m in modules.get(current, {}).get("imports", []) if m in modules)
        closure[module] = seen

    by_name: dict[str, list[dict]] = defaultdict(list)
    for d in declarations:
        if not d["anonymous"]:
            by_name[d["fullName"]].append(d)

    edges: list[dict] = []
    ambiguous = 0
    unresolved_fields = 0

    def resolve(ref, declaration, namespace, opens, before_line):
        """Resolve a global name in its original lexical/import context."""
        nonlocal ambiguous
        prefixes = [".".join(namespace.split(".")[:n])
                    for n in range(len(namespace.split(".")), 0, -1)] if namespace else []
        if ref.startswith('_root_.'):
            tiers = [([ref[7:]], True)]
        else:
            tiers = [([qualify(prefix, ref)], True) for prefix in prefixes]
            tiers += [([ref], True), ([qualify(op, ref) for op in opens], False)]
        for names, protected_allowed in tiers:
            matches = {}
            for name in names:
                for target in by_name.get(name, []):
                    visible = target['module'] in closure[declaration['module']]
                    visible &= not target['private'] or target['file'] == declaration['file']
                    visible &= target['file'] != declaration['file'] or target['line'] < before_line
                    visible &= protected_allowed or not target['protected']
                    if visible:
                        matches[target['id']] = target
            if len(matches) > 1:
                ambiguous += 1
                return None
            if matches:
                return next(iter(matches.values()))
        return None

    for d in declarations:
        target_edges = {}
        unresolved = []
        ns = d["fullName"].rsplit(".", 1)[0] if "." in d["fullName"] else ""
        for occurrence in d.pop('_refs'):
            ref = occurrence['name']
            if ref in KEYWORDS:
                continue
            evidence = {k: occurrence[k] for k in ('line', 'column')}
            evidence.update(reference=ref, resolution='lexical')
            target = None
            if occurrence['local']:
                binding = occurrence['receiver']
                receiver_type = (resolve(binding.head, d, binding.namespace, binding.opens, binding.line)
                                 if binding and binding.head else None)
                root, _, access = ref.partition('.')
                # Later fields operate on the first member's result. Retain
                # that known dependency without guessing the result's type or
                # treating the whole chain as a name under the receiver type.
                parts = re.fullmatch(rf'({CONTEXT_IDENT})(?:\.(.*))?', access)
                member, suffix = parts.groups() if parts else ('', None)
                if receiver_type and member:
                    target = resolve('_root_.' + receiver_type['fullName'] + '.' + member,
                                     d, '', (), d['line'])
                    evidence.update(resolution='receiver-type', receiverType=receiver_type['fullName'])
                if not target:
                    reason = ('No unique visible member for the explicit receiver type' if receiver_type
                              else 'Receiver type is unknown, unsupported, or not uniquely resolved')
                    unresolved.append(dict(reference=ref, line=occurrence['line'],
                                           column=occurrence['column'], reason=reason))
                    continue
                if suffix:
                    prefix = root + '.' + member
                    evidence.update(resolvedPrefix=prefix, unresolvedSuffix=suffix)
                    unresolved.append(dict(reference=ref, line=occurrence['line'],
                                           column=occurrence['column'], resolvedPrefix=prefix,
                                           unresolvedSuffix=suffix,
                                           reason='First member resolved; remaining chain needs intermediate type inference'))
            else:
                context = occurrence.get('context')
                target = resolve(ref, d, context.namespace if context else ns,
                                 context.opens if context else d['_opens'],
                                 context.line if context else d['line'])
                if context:
                    evidence.update(resolution='section-variable-type', sectionVariable=occurrence['sectionVariable'])
            if target:
                edge = target_edges.get(target['id'])
                if edge is None:
                    edge = {'from': d['id'], 'to': target['id'], 'kind': 'inferred-reference', 'evidence': []}
                    target_edges[target['id']] = edge
                    edges.append(edge)
                if evidence not in edge['evidence']:
                    edge['evidence'].append(evidence)
        if unresolved:
            d['unresolvedReferences'] = unresolved
            unresolved_fields += len(unresolved)
        d.pop("_opens")

    return dict(schemaVersion=1, project=dict(name=config.root.name, root=str(config.root),
                sourceRoots=list(config.source_roots), excludes=list(config.excludes)),
                generatedAt=datetime.now(timezone.utc).isoformat(),
                analysis=dict(mode="source", declarationEdges="inferred", moduleEdges="explicit imports",
                              ambiguousReferencesSkipped=ambiguous,
                              unresolvedFieldReferences=unresolved_fields,
                              note="Source analysis only. References are inferred, and no-sorry does not mean Lean-verified."),
                stats=dict(files=len(files), declarations=len(declarations), edges=len(edges),
                           imports=len(module_edges), externalModules=len(external),
                           sorryCount=sum(f["sorryCount"] for f in files),
                           declarationsWithSorry=sum(d["hasSorry"] for d in declarations)),
                declarations=declarations, edges=edges, files=files,
                moduleEdges=module_edges, externalModules=external, warnings=warnings)
