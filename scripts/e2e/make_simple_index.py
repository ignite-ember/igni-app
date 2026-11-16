#!/usr/bin/env python3
"""Turn a directory of wheels into a PEP 503 "simple" package index.

The desktop E2E jobs point the app's first-launch runtime install at this
index (``UV_INDEX_URL``) instead of PyPI, so the install is deterministic —
the exact wheels the job built or downloaded — and it proves the app's
installer honours an organisation's own package mirror. Serve the output
directory with ``python -m http.server`` and use ``http://127.0.0.1:PORT/simple``.

Usage: make_simple_index.py WHEELHOUSE OUTDIR
"""

from __future__ import annotations

import html
import re
import shutil
import sys
from pathlib import Path


def normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def project_of(filename: str) -> str:
    # A wheel is name-version-...whl; an sdist is name-version.tar.gz.
    stem = filename.split("-")[0]
    return normalise(stem)


def main() -> int:
    wheelhouse, out = Path(sys.argv[1]), Path(sys.argv[2])
    files = out / "files"
    simple = out / "simple"
    files.mkdir(parents=True, exist_ok=True)
    projects: dict[str, list[str]] = {}
    for path in sorted(wheelhouse.iterdir()):
        if not (path.name.endswith(".whl") or path.name.endswith(".tar.gz")):
            continue
        shutil.copy2(path, files / path.name)
        projects.setdefault(project_of(path.name), []).append(path.name)
    for project, names in projects.items():
        page = simple / project
        page.mkdir(parents=True, exist_ok=True)
        links = "\n".join(
            f'<a href="../../files/{html.escape(n)}">{html.escape(n)}</a><br>' for n in names
        )
        (page / "index.html").write_text(f"<!doctype html><html><body>\n{links}\n</body></html>\n")
    root = "\n".join(f'<a href="{p}/">{p}</a><br>' for p in sorted(projects))
    (simple / "index.html").write_text(f"<!doctype html><html><body>\n{root}\n</body></html>\n")
    print(f"{len(projects)} projects, {sum(len(v) for v in projects.values())} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
