#!/usr/bin/env python3
"""Fail when a code comment looks like a quoted wish, request or feedback from a person.

This repository is public. Comments explain *why the code is the way it is* in technical terms (measurements,
constraints, behaviour). They do not quote what somebody said or asked for, and they do not credit feedback to
"the user" or "the owner". This is a heuristic, not a proof: it flags a comment when it contains

  * typographic (curly or German) quotation marks,
  * a quotation of five or more words in straight quotes (a spoken or written sentence rather than an identifier),
  * a quotation that contains first person words (I, my, me, we, our) or an ellipsis,
  * a phrase that attributes something to a person ("user feedback", "user request", "the owner wants", ...).

A line that really needs such a quotation (for example the exact wording of a documented upstream message) carries
the marker "quote-ok". Only the place is reported (file:line), the text is not repeated.

    python3 scripts/check_comments.py                # whole tree (tracked files)
    python3 scripts/check_comments.py FILE ...       # only these files
"""
from __future__ import annotations

import ast
import io
import os
import re
import subprocess
import sys
import tokenize

OK_MARK = "quote-ok"
EXTS = {".py", ".js", ".css", ".html", ".sh", ".command", ".ps1", ".yml", ".yaml"}
CURLY = re.compile("[„“”‚‘»«]")
STRAIGHT = re.compile(r'"([^"\n]{3,})"')
FIRST_PERSON = re.compile(r"\b(?:I|I'd|I'll|I'm|my|me|mine|we|we'd|our|ours)\b", re.I)
ELLIPSIS = re.compile(r"\S\s+(?:…|\.\.\.)\s+\S")      # an ellipsis in the middle of a quotation
ATTRIBUTION = re.compile(
    r"\b(?:user|customer|owner|maintainer|someone|somebody|they)\s+(?:feedback|request(?:ed)?|wish(?:es)?|wanted|wants|said|asked|complained|reported|heard|remarked)\b"
    r"|\b(?:feedback|request|wish|complaint)\s+(?:from|by)\s+(?:the\s+)?(?:user|customer|owner|maintainer)\b"
    r"|\bas\s+(?:the\s+)?(?:user|customer|owner)\s+(?:put it|said|wrote)\b"
    r"|\(\s*(?:user|customer|owner)\s+(?:feedback|request|wish)",
    re.I)


def py_comments(text):
    out = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                out.append((tok.start[0], tok.string))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return out


def py_docstrings(text):
    out = []
    try:
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                body = getattr(node, "body", [])
                if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
                        and isinstance(body[0].value.value, str):
                    out.append((body[0].lineno, body[0].value.value))
    except SyntaxError:
        pass
    return out


def line_comments(text, ext):
    out = []
    for n, line in enumerate(text.split("\n"), 1):
        if ext in (".js", ".css"):
            m = re.search(r"(?:^|\s)(//\s.*|//$|/\*.*|\*\s.*)$", line)
            if m and (m.group(1).startswith(("//", "/*")) or line.strip().startswith("*")):
                out.append((n, m.group(1)))
        elif ext == ".html":
            m = re.search(r"<!--.*?(?:-->|$)", line)
            if m:
                out.append((n, m.group(0)))
        else:
            m = re.search(r"(?:^|\s)(#(?!!).*)$", line)
            if m:
                out.append((n, m.group(1)))
    return out


def judge(comment, short_ok=False):
    if OK_MARK in comment:
        return None
    if CURLY.search(comment) and not short_ok:
        return "typographic quotation marks"
    if ATTRIBUTION.search(comment):
        return "attributes something to a person"
    if comment.count('"') % 2 == 1 and not short_ok:
        # a lone quotation mark that closes a sentence: the rest of a quotation whose first line was removed
        m = re.search(r'(\w+(?:[\s,]+\w+){3,})[.!?,]?"[.,;:]?(?:\s|$)', comment)
        if m and '"' not in comment[:m.start()]:
            return "dangling end of a quotation"
    for m in STRAIGHT.finditer(comment):
        q = m.group(1)
        words = re.findall(r"[A-Za-zÀ-ɏ']+", q)
        if len(words) >= 5 and not short_ok:
            return "quotation of five or more words"
        if len(words) >= 2 and FIRST_PERSON.search(q):
            return "quotation with first person words"
        if len(words) >= 2 and ELLIPSIS.search(q):
            return "quotation with an ellipsis"
    return None


def check_file(path, text=None):
    ext = os.path.splitext(path)[1].lower()
    if ext not in EXTS:
        return []
    if text is None:
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            return []
    comments = py_comments(text) if ext == ".py" else line_comments(text, ext)
    if ext == ".py":
        # comments inside embedded scripts (triple-quoted strings) are not tokens; scan those lines as text too
        comments += [(n, c) for n, c in line_comments(text, ".sh") if (n, c) not in comments and re.match(r"^\s*#", text.split("\n")[n - 1])]
    bad, seen = [], set()
    for n, c in comments:
        if n in seen:
            continue
        why = judge(c)
        if why:
            seen.add(n)
            bad.append((path, n, why))
    # a quotation can run over several comment lines: judge each block of consecutive comment lines as one text
    block, start, last = [], 0, -9
    for n, c in sorted(comments) + [(10 ** 9, "")]:
        if n != last + 1 and block:
            joined = " ".join(re.sub(r"^\W*?(?:#|//|/\*|\*|<!--)+\s*", "", b) for b in block)
            if OK_MARK not in joined and not any(s in seen for s in range(start, last + 1)):
                why = judge(joined, short_ok=True)
                if why:
                    seen.add(start)
                    bad.append((path, start, why + " (across lines)"))
            block = []
        if not block:
            start = n
        block.append(c)
        last = n
    if ext == ".py":
        for n, s in py_docstrings(text):
            if n not in seen and OK_MARK not in s and ATTRIBUTION.search(s):
                bad.append((path, n, "attributes something to a person (docstring)"))
    return bad


def main(argv):
    me = os.path.relpath(__file__)
    if argv:
        files = argv
    else:
        files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    bad = []
    for f in files:
        if not f or os.path.relpath(f) == me or not os.path.isfile(f):
            continue
        bad += check_file(f)
    for p, n, why in bad:
        print("%s:%d  %s" % (p, n, why))
    if bad:
        print("\n%d comment(s) read like quoted feedback. Rewrite them as a technical reason, or mark a deliberate quotation with '%s'." % (len(bad), OK_MARK))
        return 1
    print("comments ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
