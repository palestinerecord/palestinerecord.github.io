#!/usr/bin/env python3
"""Parse report-final.md into structured JSON for the dashboard.

Every heading, paragraph, list item and table in the source markdown is emitted,
so the dashboard can render the complete report with no omissions.
"""

import json
import re
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
OUT = ROOT / "data"

INLINE_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
ITALIC = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", re.S)


def to_html(text):
    text = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    text = INLINE_LINK.sub(r'<a href="\2" target="_blank" rel="noopener">\1</a>', text)
    text = BOLD.sub(r"<strong>\1</strong>", text)
    text = ITALIC.sub(r"<em>\1</em>", text)
    return text


def slugify(text):
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_]+", "-", text).strip("-")[:80]


def split_row(line):
    cells = line.strip().strip("|").split("|")
    return [to_html(c.strip()) for c in cells]


def parse_blocks(lines):
    """Turn a run of markdown lines into typed content blocks."""
    blocks = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped == "---":
            blocks.append({"type": "rule"})
            i += 1
            continue

        # Table: a pipe row followed by a separator row.
        if stripped.startswith("|") and i + 1 < n and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            header = split_row(stripped)
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i].strip()))
                i += 1
            width = len(header)
            rows = [r + [""] * (width - len(r)) if len(r) < width else r[:width] for r in rows]
            blocks.append({"type": "table", "header": header, "rows": rows})
            continue

        # List: consecutive bullet lines, with wrapped continuations.
        if re.match(r"^\s*[-*+]\s+", line):
            items = []
            while i < n:
                cur = lines[i]
                if re.match(r"^\s*[-*+]\s+", cur):
                    indent = len(cur) - len(cur.lstrip())
                    items.append({"level": 1 if indent >= 2 else 0,
                                  "text": re.sub(r"^\s*[-*+]\s+", "", cur).rstrip()})
                    i += 1
                elif cur.strip() and not cur.strip().startswith("|") and not cur.startswith("#") and items:
                    items[-1]["text"] += " " + cur.strip()
                    i += 1
                else:
                    break
            blocks.append({"type": "list",
                           "items": [{"level": it["level"], "html": to_html(it["text"])} for it in items]})
            continue

        # Paragraph: everything up to a blank line or a structural marker.
        para = []
        while i < n:
            cur = lines[i]
            if not cur.strip() or cur.startswith("#") or cur.strip().startswith("|") \
                    or re.match(r"^\s*[-*+]\s+", cur) or cur.strip() == "---":
                break
            para.append(cur.strip())
            i += 1
        if para:
            blocks.append({"type": "paragraph", "html": to_html(" ".join(para))})
    return blocks


def parse_report(text):
    lines = text.split("\n")
    doc = {"title": "", "parts": []}
    part = None
    section = None
    buffer = []

    def flush():
        if not buffer:
            return
        target = section if section is not None else part
        if target is not None:
            target["blocks"].extend(parse_blocks(buffer))
        buffer.clear()

    for line in lines:
        h = re.match(r"^(#{1,4})\s+(.*)$", line)
        if not h:
            buffer.append(line)
            continue

        level, title = len(h.group(1)), h.group(2).strip()

        # Level 1 is the document title once, then the appendix headings.
        if level == 1 and not doc["title"]:
            flush()
            doc["title"] = title
            continue

        if level <= 2:
            flush()
            section = None
            part = {"id": slugify(title), "title": title, "blocks": [], "sections": []}
            doc["parts"].append(part)
        elif level == 3:
            flush()
            if part is None:
                part = {"id": "front-matter", "title": "Front Matter", "blocks": [], "sections": []}
                doc["parts"].append(part)
            section = {"id": slugify(title), "title": title, "blocks": []}
            part["sections"].append(section)
        else:
            # Level 4 headings become emphasised blocks inside the current section.
            flush()
            target = section if section is not None else part
            if target is not None:
                target["blocks"].append({"type": "subheading", "html": to_html(title)})

    flush()
    return doc


def collect_tables(doc):
    """Every table in the document, tagged with where it came from."""
    found = []
    for part in doc["parts"]:
        containers = [(part["title"], None, part["blocks"])]
        containers += [(part["title"], s["title"], s["blocks"]) for s in part["sections"]]
        for part_title, section_title, blocks in containers:
            for block in blocks:
                if block["type"] == "table":
                    found.append({
                        "part": part_title,
                        "section": section_title,
                        "header": block["header"],
                        "rows": block["rows"],
                    })
    return found


def strip_html(value):
    return re.sub(r"<[^>]+>", "", value).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def build_timeline(tables):
    """Appendix B chronology, parsed into sortable events."""
    events = []
    for table in tables:
        if not table["part"].startswith("APPENDIX B"):
            continue
        for row in table["rows"]:
            date, event = strip_html(row[0]).strip(), strip_html(row[1]).strip()
            if not date or not event:
                continue
            year = re.search(r"\b(1[89]\d{2}|20\d{2})\b", date)
            events.append({
                "date": date,
                "event": event,
                "year": int(year.group(1)) if year else None,
            })
    events.sort(key=lambda e: (e["year"] is None, e["year"] or 0))
    return events


def build_statements(doc):
    """Appendix C genocidal statements, split into speaker / role / quote."""
    statements = []
    for part in doc["parts"]:
        if not part["title"].startswith("APPENDIX C"):
            continue
        for block in part["blocks"]:
            if block["type"] != "list":
                continue
            for item in block["items"]:
                text = strip_html(item["html"]).strip()
                quote = re.search(r"[\"“](.+?)[\"”]", text)
                speaker = re.match(r"^([^,(–:-]+)", text)
                role = re.search(r"^[^,]+,\s*([^:\"“]+)", text)
                date = re.search(r"\b(\d{1,2}\s+)?(January|February|March|April|May|June|July|August|"
                                 r"September|October|November|December)\s+(\d{4})\b", text)
                statements.append({
                    "speaker": speaker.group(1).strip() if speaker else "",
                    "role": role.group(1).strip(" ,-–") if role else "",
                    "date": date.group(0) if date else "",
                    "quote": quote.group(1).strip() if quote else "",
                    "full": text,
                })
    return [s for s in statements if s["full"]]


def build_bibliography(doc):
    entries = []
    for part in doc["parts"]:
        if part["title"] != "BIBLIOGRAPHY":
            continue
        current = "General"
        for block in part["blocks"]:
            if block["type"] == "subheading":
                current = strip_html(block["html"])
            elif block["type"] == "paragraph" and block["html"].startswith("<strong>"):
                current = strip_html(block["html"])
            elif block["type"] == "list":
                for item in block["items"]:
                    entries.append({"category": current, "html": item["html"],
                                    "text": strip_html(item["html"])})
    return entries


def stats(doc, tables):
    words = 0
    for part in doc["parts"]:
        for blocks in [part["blocks"]] + [s["blocks"] for s in part["sections"]]:
            for block in blocks:
                if block["type"] in ("paragraph", "subheading"):
                    words += len(strip_html(block["html"]).split())
                elif block["type"] == "list":
                    words += sum(len(strip_html(i["html"]).split()) for i in block["items"])
                elif block["type"] == "table":
                    words += sum(len(strip_html(c).split()) for r in block["rows"] for c in r)
    return {
        "parts": len(doc["parts"]),
        "sections": sum(len(p["sections"]) for p in doc["parts"]),
        "tables": len(tables),
        "words": words,
    }


def main():
    text = SOURCE.read_text(encoding="utf-8")
    doc = parse_report(text)
    tables = collect_tables(doc)

    doc["stats"] = stats(doc, tables)
    doc["timeline"] = build_timeline(tables)
    doc["statements"] = build_statements(doc)
    doc["bibliography"] = build_bibliography(doc)
    doc["tables"] = tables

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "report.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # report.json is the largest file on the site and only five routes read it.
    # Two small files carry what the rest need, so the first screen does not
    # wait on 880 KB of JSON it will not use: the chronology (Appendix B, which
    # the Timeline merges with timeline-extra.json) and the counts the Overview,
    # Sources and Open-data routes quote.
    chronology = {
        "meta": {
            "source": "The report, Appendix B",
            "note": "The chronology of recorded crimes and massacres, split out of "
                    "report.json so the Timeline can be read without loading the full report.",
            "count": len(doc["timeline"]),
        },
        "entries": doc["timeline"],
    }
    (OUT / "chronology.json").write_text(
        json.dumps(chronology, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    meta = {
        "title": doc["title"],
        "stats": doc["stats"],
        "bibliography_count": len(doc["bibliography"]),
        # 25 KB, and the Sources route is the one that reads it: carrying it here
        # keeps that route off report.json entirely.
        "bibliography": doc["bibliography"],
        "statement_count": len(doc["statements"]),
        "timeline_count": len(doc["timeline"]),
        "parts": [{"id": p["id"], "title": p["title"]} for p in doc["parts"]],
    }
    (OUT / "report-meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    s = doc["stats"]
    print(f"parts={s['parts']} sections={s['sections']} tables={s['tables']} words={s['words']:,}")
    print(f"timeline={len(doc['timeline'])} statements={len(doc['statements'])} "
          f"bibliography={len(doc['bibliography'])}")
    for name in ("report.json", "chronology.json", "report-meta.json"):
        print(f"wrote {name} {(OUT / name).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
