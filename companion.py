#!/usr/bin/env python3
"""Publish the companion documents as pages on the site.

`report-final.md` becomes the dashboard itself, through build.py. The other
documents in `reports/israel-palestine/` are separate arguments that the report
refers to by filename and that nobody outside this machine could read, because
the working repository is private. A reference to a document a reader cannot
open is worth very little, so the ones the report actually leans on are
published here as ordinary pages, styled like the rest of the site and listed
in the sitemap alongside it.

The conversion is deliberately plain: python-markdown with tables, the site
stylesheet, a canonical URL and a description. No charts, no JavaScript, no
search. These are documents, and they should read as documents.

    python3 companion.py          # → one HTML page per entry in DOCUMENTS

Run it before prerender.py, which adds the pages it finds to the sitemap.
"""

import pathlib
import re
import xml.sax.saxutils as saxutils

# `markdown` is imported inside build() rather than here. prerender.py imports
# this module only to read DOCUMENTS, which is a list of filenames and titles
# and needs no library at all; importing a third-party package at module level
# to hand over a constant meant that a runner without it could not write a
# sitemap. The dependency is real, it is pinned in requirements.txt and
# deps_check.py still sees it — it is simply not paid for by a caller that is
# not converting anything.

ROOT = pathlib.Path(__file__).resolve().parent
SOURCE_DIR = ROOT.parent.parent / 'reports' / 'israel-palestine'

# Each entry is the markdown file, the page it becomes, and the description a
# search engine and a reader see before opening it. Only documents the report
# itself cites are listed: a companion page exists to make a reference
# followable, not to publish everything in the folder.
DOCUMENTS = [
    {
        'source': 'nazi-germany-comparison.md',
        'page': 'nazi-comparison.html',
        'title': 'The Nazi comparison, examined',
        'description': ('Why Holocaust survivors, Israeli Holocaust scholars and the institute named for '
                        'the man who coined the word genocide make the comparison, what the documented '
                        'parallels are, the strongest objection answered in full, and the arguments made '
                        'for the comparison that this record rejects.'),
    },
]

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s · The Documented Record</title>
<meta name="description" content="%(description)s">
<meta name="robots" content="index, follow, max-snippet:-1">
<link rel="canonical" href="%(base)s%(page)s">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/style.css?v=%(version)s">
<style>
.doc { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; }
.doc h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; }
.doc h2 { font-size: 21px; margin: 40px 0 12px; padding-top: 18px;
  border-top: 1px solid rgba(255,255,255,.12); }
.doc h3 { font-size: 17px; margin: 28px 0 10px; color: #d9a441; }
.doc p, .doc li { font-size: 16px; line-height: 1.75; }
.doc ul, .doc ol { padding-left: 22px; }
.doc li { margin-bottom: 8px; }
.doc blockquote { margin: 18px 0; padding: 12px 18px; border-left: 3px solid #d9a441;
  background: rgba(217,164,65,.07); border-radius: 0 10px 10px 0; }
.doc table { width: 100%%; border-collapse: collapse; margin: 18px 0; font-size: 14.5px; }
.doc th, .doc td { border: 1px solid rgba(255,255,255,.14); padding: 8px 10px;
  text-align: left; vertical-align: top; }
.doc hr { border: none; border-top: 1px solid rgba(255,255,255,.12); margin: 32px 0; }
.doc-note { max-width: 860px; margin: 0 auto 24px; padding: 16px 20px;
  border: 1px solid rgba(217,164,65,.35); border-left: 3px solid #d9a441;
  border-radius: 12px; background: rgba(217,164,65,.07); font-size: 14px; line-height: 1.6; }
.doc-note a { color: #d9a441; }
</style>
</head>
<body>
<main id="app">
<div class="doc-note"><strong>A companion document</strong> to The Documented Record. It is referred to
by name in the record's own text and is published here so that the reference can be followed. The
<a href="index.html">full record is here</a>, and its sources are at
<a href="index.html#/sources">the source library</a>.</div>
<article class="doc">
%(body)s
</article>
</main>
</body>
</html>
"""


def version():
    """The cache-bust the rest of the site is on, so the stylesheet matches."""
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    found = re.findall(r'\?v=(\d+)', html)
    if not found:
        raise SystemExit('companion: no ?v= found in index.html')
    return max(int(v) for v in found)


def site_base():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'<link rel="canonical" href="([^"]+)"', html)
    if not m:
        raise SystemExit('companion: no canonical URL in index.html')
    return m.group(1).split('#')[0].rstrip('/') + '/'


def build():
    import markdown

    base, v = site_base(), version()
    written = []
    for doc in DOCUMENTS:
        src = SOURCE_DIR / doc['source']
        if not src.exists():
            raise SystemExit('companion: %s not found' % src)
        md = markdown.Markdown(extensions=['tables', 'toc'])
        body = md.convert(src.read_text(encoding='utf-8'))
        page = PAGE % {
            'title': saxutils.escape(doc['title']),
            'description': saxutils.escape(doc['description']),
            'base': base,
            'page': doc['page'],
            'version': v,
            'body': body,
        }
        (ROOT / doc['page']).write_text(page, encoding='utf-8')
        written.append((doc['page'], len(page)))
        print('  %-24s %7d bytes  %s' % (doc['page'], len(page), doc['title']))
    return written


if __name__ == '__main__':
    build()
