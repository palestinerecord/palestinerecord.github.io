#!/usr/bin/env python3
"""Check that every line of report-final.md survives into report.json."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# The report lives in the private `hb` repository; the dashboard lives in the
# published site repository, and `hb` reaches it through a symlink. Resolving
# this file therefore lands in the site repository, where the report is not, so
# look for the report rather than assuming it is one level up. REPORT_SOURCE
# overrides, for a checkout somewhere else entirely.
def _find_source():
    import os
    override = os.environ.get('REPORT_SOURCE')
    if override:
        return Path(override)
    for base in (ROOT, *ROOT.parents):
        for candidate in (base / 'report-final.md',
                          base / 'reports' / 'israel-palestine' / 'report-final.md'):
            if candidate.exists():
                return candidate
    raise SystemExit('report-final.md not found; set REPORT_SOURCE')


SOURCE = _find_source()
DATA = ROOT / "data" / "report.json"


def normalise(text):
    # Reorder both link spellings to "url label" so markdown and HTML compare equal.
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r" \2 \1 ", text)
    text = re.sub(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', r" \1 \2 ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    text = re.sub(r"[^\w]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def harvest(doc):
    out = []

    def blocks(bs):
        for b in bs:
            t = b["type"]
            if t in ("paragraph", "subheading"):
                out.append(b["html"])
            elif t == "list":
                out.extend(i["html"] for i in b["items"])
            elif t == "table":
                out.extend(b["header"])
                out.extend(c for r in b["rows"] for c in r)

    out.append(doc["title"])
    for part in doc["parts"]:
        out.append(part["title"])
        blocks(part["blocks"])
        for section in part["sections"]:
            out.append(section["title"])
            blocks(section["blocks"])
    return out


def main():
    doc = json.loads(DATA.read_text(encoding="utf-8"))
    haystack = " ␟ ".join(normalise(x) for x in harvest(doc))

    missing = []
    for number, raw in enumerate(SOURCE.read_text(encoding="utf-8").split("\n"), start=1):
        line = raw.strip()
        if not line or line == "---" or re.match(r"^\|[\s:|-]+\|$", line):
            continue
        # Compare in fragments so line-joining and cell-splitting do not cause false misses.
        fragments = [normalise(f) for f in re.split(r"\|", line)] if line.startswith("|") else [normalise(line)]
        for fragment in fragments:
            if len(fragment) < 3:
                continue
            if fragment not in haystack:
                missing.append((number, fragment[:110]))

    print(f"source lines checked, missing fragments: {len(missing)}")
    for number, fragment in missing[:25]:
        print(f"  L{number}: {fragment}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
