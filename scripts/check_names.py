#!/usr/bin/env python3
"""Fail when the tracked text names a brand, product or earlier project name that must not appear here.

This repository is public. Names of third-party products and platforms (and earlier names of this project)
stay out of code, comments, texts and documentation. The list below holds only SHA-256 hashes, so the check
itself does not spell any of the names it forbids.

Each line is cut into lowercase alphanumeric words; every word and every run of two or three adjacent words
(joined without spaces) is hashed and looked up. "foo-bar", "FooBar" and "foo_bar" therefore all match "foobar".

Exempt: THIRD_PARTY.md and LICENSE (licence notices must name their authors), this script, binary files, and
lines carrying the marker "names-ok" or "Kennung" (a technical identifier that has to keep its spelling, for
example a MIDI port name or a setting key read from an older install).

    python3 scripts/check_names.py                 # whole tree (tracked files)
    python3 scripts/check_names.py FILE ...        # only these files
    python3 scripts/check_names.py --hash "Some Name"   # print the hash to add to HASHES

Only the place is reported (file:line), never the name.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys

SALT = "manuwave-names:"
HASHES = frozenset([
    "004bf4667c9312c656c7d5c4d526d1ce4e5418b2f78fba1b49a2088a29cb3794",
    "0797cc99c77fa0ff5b0bad7234a3a05828f7c7a6c8ce50b7363a9421c660500e",
    "088b9933c7d98f73068b6e72a0430d6b93053018dc01300cffc0661978892956",
    "0d86ddc95c66aeab6d033fb065e2c359d8ee514820d2142138e2887c5b43453d",
    "0e62e3d261e095aec9819c5da7adda6fae83a6da1c6daee744d137e5648cf3e9",
    "17484fdc68851020f0f3566b46059b31e7ece8499727def883ab13e490fb880e",
    "25043dca4b25cea9da6de450439e7d93f7708ccb9c8dd792d124aaa4bd1cc565",
    "2bcfe7faa320bbc33fabae62bd8eb6c86ef7e4d282ee9a9a33dd6ade084696a5",
    "4fba1b664a3ac8e770eef5088b5da9d458f38f2549b49cff52326d5db965e5ba",
    "52809efd69294883097dbcd9c50e7ef5fc416969e2f06ee1bc8627918b4212a6",
    "5526e9e3260ce1103f01184fb50556bd28f15f5d8c67eb2b7c163fb28bc091a7",
    "588935506a4050519033be22b295018c6aeaf8781d85708ebc3e3f596155c363",
    "597a298466fd80107ce58b51f7a1db5cb462b848db6757f2bfda53d969d6d92a",
    "5ec708ebafe619c1eea1d854be952fd10bcd6956c789f0d838d5e5b8cad0336d",
    "63b60dfafbbc1f298af7d03c7df9a029097633f5e7ad2f815d61a0c584d88ef4",
    "7048de3bd47c166eaaffaaff4827f29b100d606f2932d8eba66192ed13747409",
    "70aef92175db01c28dabfc8a4e1f2ab9bad1d03034e13d624a52497b8cc6857d",
    "7bf95aa55d23a65979e515a3eb31a6f6ce2343375d8a947a027d069289673faf",
    "80a151452e671b562b1d1e211eb9ca5997cd2acfa401a24cf7725d24b6ba2a2d",
    "862235acc8bbda15a95b2068bc172eed3eeaa21edca1f040db640213522c2648",
    "91d9f3d2a4b10932eda12041a4814f2edc5ca19cf91189c0d2543431095db510",
    "a51ac765d007df31bb4aa1cdeef2250ccb4759229b37a8bd21942eedb32bd081",
    "ad52530a4bae58f7fdb9041050df7a4c739106c18476abb5caa02eb0ccf98ad1",
    "b4f67a70caf1aaf3d065e68ea4f455c99c8edc7c050bd7d4ce53e72358e8d88e",
    "b7fc7cd10427c428d44dd497f95298b9f56d2cdec9f6e15c4ae5ead1226208f3",
    "c0bbb3ff5b5844aea27678194a6fe7c888c9f605c5acf3e53acb280f78e52580",
    "c1bdd6f36c1feae3658f9daa9bfa9ed2c7ccc84f1807bcc58fcb9cc148014086",
    "c5e35979fa87c89918a328f149e0ffb63de29887cfa52f2eb490cf9a5047e91f",
    "d0f699803d0a60eb6a9a6cfec3bc9b3606569af1b747c38700d358f9d0b18fb3",
    "d174380a07aceb83cebe6e24af379c51305c2625336aa08a04f7bdc2f894287d",
    "e59b3cbff1147cda5b74743773b4b0a084a26c049a961576bf53bcba715fa236",
    "e939aa93c8770bbacfc030a4f3f3546540595f5d58ee49f31e5e416c005a6e55",
    "f4fd48149fb585f05044048846f0f43946e10b77ff82cee2bfb1d006a79a3b8f",
    "f9fa6ed48bad7b3c026bc09dee3013c8636763aaad9b5e1c8bd67f1b949f477e",
])
EXEMPT = {"THIRD_PARTY.md", "LICENSE", "scripts/check_names.py"}
WORD = re.compile(r"[a-z0-9]+")


def digest(term: str) -> str:
    return hashlib.sha256((SALT + re.sub(r"[^a-z0-9]", "", term.lower())).encode()).hexdigest()


def line_hits(line: str) -> bool:
    words = WORD.findall(line.lower())
    for i in range(len(words)):
        joined = ""
        for w in words[i:i + 3]:
            joined += w
            if digest(joined) in HASHES:
                return True
    return False


def tracked_files() -> list:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout.decode("utf-8")
    return [p for p in out.split("\0") if p]


def main(argv: list) -> int:
    if argv[:1] == ["--hash"]:
        print(digest(" ".join(argv[1:])))
        return 0
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    files = argv or tracked_files()
    bad = []
    for path in files:
        rel = os.path.relpath(path, root) if os.path.isabs(path) else path
        if rel in EXEMPT:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                for n, line in enumerate(f, 1):
                    if "names-ok" not in line and "Kennung" not in line and line_hits(line):
                        bad.append("%s:%d" % (rel, n))
        except (UnicodeDecodeError, OSError):
            continue                                      # binary file or gone
    if bad:
        print("Names that must not appear in this repository found at:")
        for b in bad[:100]:
            print("  " + b)
        return 1
    print("No forbidden names in %d files." % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
