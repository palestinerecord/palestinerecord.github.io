#!/usr/bin/env python3
"""prerender.py — static snapshots, per-route social cards and a sitemap.

The dashboard is a hash-routed single-page application. A hash never reaches
the server, so every route shares one URL as far as a crawler or a link
preview is concerned: they all see index.html, which before any JavaScript
runs is an empty `<main>`. Ninety-odd charts, a hundred and twenty-seven
sections and forty thousand words of reproduced report are invisible.

This script renders each route in headless Chrome with `?prerender=1` (which
turns off the charts, the scroll reveals, the counting numbers and the WebGL
field, leaving the text at rest), dumps the resulting DOM, strips everything
that cannot work without JavaScript, and writes it to `snapshot/<route>.html`.
Each snapshot is self-canonical and carries a link back to the interactive
route it was taken from, so nothing here is served to a crawler that a reader
is not also shown.

It then draws a 1200x630 social card per route, writes `sitemap.xml`, and
stamps the `dateModified` of the two JSON-LD blocks in index.html from the
generation date recorded in data/timeseries.json.

    python3 prerender.py                 # snapshots, cards, sitemap
    python3 prerender.py --no-cards      # skip the Pillow step
    python3 prerender.py --only data-gaza overview
    python3 prerender.py --budget 14000  # a slower machine

Requires Google Chrome for the snapshots and Pillow for the cards; either step
can be skipped independently, and neither touches the network.
"""

import argparse
import datetime
import functools
import http.server
import json
import pathlib
import re
import socketserver
import subprocess
import sys
import threading
import xml.sax.saxutils as saxutils

ROOT = pathlib.Path(__file__).resolve().parent
SNAPSHOT_DIR = ROOT / 'snapshot'
CARD_DIR = ROOT / 'assets' / 'og'

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# The text of a route settles long before the charts would have; with
# ?prerender=1 there are no charts to wait for at all.
BUDGET = 9000

CARD_W, CARD_H = 1200, 630

# The palette is css/style.css's, so a card and the page it points at agree.
INK = (233, 237, 246)
INK_2 = (185, 194, 212)
MUTED = (125, 135, 156)
AMBER = (217, 164, 65)
RED = (210, 83, 76)
GREEN = (79, 174, 130)
RULE = (42, 50, 69)

SERIF = '/System/Library/Fonts/Supplemental/Georgia.ttf'
SERIF_BOLD = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'
SANS = '/System/Library/Fonts/Supplemental/Arial.ttf'
SANS_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'


# ---------------------------------------------------------------- routes

# `#/embed/<chart>` is a route with no page of its own: it renders one chart for
# an iframe on somebody else's site, and there are ninety-odd of them. It is a
# view, so it lives in VIEWS, but it is not a document, so it gets no snapshot,
# no social card and no sitemap entry.
UNCRAWLED = ('embed',)


def discover_routes():
    """The route list, read from the application rather than kept in step with it.

    `VIEWS` in app.js and `DATA_CHAPTERS` in views.js are the only definitions
    of what routes exist; duplicating them here would mean a chapter could be
    added and silently never crawled. A failure to find either is fatal — a
    sitemap that quietly lost half its routes is worse than no sitemap.
    """
    app = (ROOT / 'js' / 'app.js').read_text(encoding='utf-8')
    views = (ROOT / 'js' / 'views.js').read_text(encoding='utf-8')

    m = re.search(r'const VIEWS = \[(.*?)\];', app, re.S)
    if not m:
        raise SystemExit('prerender: could not find VIEWS in js/app.js')
    top = re.findall(r"'([a-z0-9-]+)'", m.group(1))

    m = re.search(r'const DATA_CHAPTERS = \[(.*?)\];', views, re.S)
    if not m:
        raise SystemExit('prerender: could not find DATA_CHAPTERS in js/views.js')
    chapters = re.findall(r"id: '([a-z0-9-]+)'", m.group(1))
    if not top or not chapters:
        raise SystemExit('prerender: route lists parsed but empty')

    # `#/data` with no chapter renders the first chapter, so snapshotting both
    # would publish the same page twice under two URLs. The chapters win.
    routes = []
    for name in top:
        if name in UNCRAWLED:
            continue
        if name == 'data':
            routes.extend(('data-%s' % c, '#/data/%s' % c) for c in chapters)
        elif name == 'tour':
            routes.append(('tour', '#/tour/1'))
        else:
            routes.append((name, '#/%s' % name))
    return routes


def site_base():
    """The deployed base URL, taken from the canonical tag in index.html."""
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'<link rel="canonical" href="([^"]+)"', html)
    if not m:
        raise SystemExit('prerender: no canonical URL in index.html')
    return m.group(1).split('#')[0].rstrip('/') + '/'


def data_date():
    """The date the shipped data was generated, for lastmod and dateModified."""
    meta = json.loads((ROOT / 'data' / 'timeseries.json').read_text(encoding='utf-8'))['meta']
    return meta['generated']


def in_prose(iso):
    """1948-05-15 → 15 May 1948, for the one place a reader sees the date."""
    d = datetime.date.fromisoformat(iso)
    return '%d %s %d' % (d.day, d.strftime('%B'), d.year)


# ---------------------------------------------------------------- serving

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    """A throwaway server on a free port, so the script needs nothing running."""
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def dump_dom(chrome, url, budget):
    out = subprocess.run(
        [chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
         '--virtual-time-budget=%d' % budget, '--dump-dom', url],
        capture_output=True, timeout=600)
    return out.stdout.decode('utf-8', 'replace')


# ---------------------------------------------------------------- stripping

def strip_element(html, opening, tag='div'):
    """Remove an element and its children, matching nesting by depth.

    A regex cannot do this for a container that holds more of its own tag, and
    the search overlay holds three nested divs.
    """
    i = html.find(opening)
    if i < 0:
        return html
    open_re = re.compile(r'<%s\b' % tag, re.I)
    close_re = re.compile(r'</%s\s*>' % tag, re.I)
    depth, pos = 0, i
    while pos < len(html):
        o = open_re.search(html, pos)
        c = close_re.search(html, pos)
        if not c:
            return html
        if o and o.start() < c.start():
            depth += 1
            pos = o.end()
        else:
            depth -= 1
            pos = c.end()
            if depth == 0:
                return html[:i] + html[pos:]
    return html


SNAPSHOT_CSS = """
.snapshot-note { max-width: 1280px; margin: 0 auto 28px; padding: 16px 20px;
  border: 1px solid rgba(217,164,65,.35); border-left: 3px solid #d9a441;
  border-radius: 12px; background: rgba(217,164,65,.07); font-size: 14px; line-height: 1.6; }
.snapshot-note a { color: #d9a441; }
.chart-missing { margin: 0; padding: 18px 20px; border: 1px dashed rgba(255,255,255,.16);
  border-radius: 12px; color: #7d879c; font-size: 13.5px; }
.snapshot-links { max-width: 1280px; margin: 48px auto 0; padding: 24px 20px;
  border-top: 1px solid rgba(255,255,255,.12); }
.snapshot-links h2 { font-size: 15px; letter-spacing: .04em; text-transform: uppercase;
  color: #7d879c; margin: 0 0 14px; }
.snapshot-links ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.snapshot-links a { color: #d9a441; text-decoration: none; }
.snapshot-links a:hover { text-decoration: underline; }
.snapshot-links p { margin: 4px 0 0; color: #7d879c; font-size: 13px; line-height: 1.55; }
"""


def clean(html, snapshot_url, route_url, generated, depth_prefix='../'):
    """Turn a dumped DOM into a standalone page.

    Everything that needs JavaScript comes out: the scripts themselves, the
    buttons (chart tools, filter chips, the search box — all inert without
    them), the canvases and the WebGL veil. `<details>` elements stay, because
    the rebuttals open without script. What is left is the text, the tables,
    the links and the source references, which is the part worth crawling.
    """
    if 'Could not load data' in html:
        raise SystemExit('prerender: the route reported a data load failure')
    if 'id="boot"' in html:
        raise SystemExit('prerender: the loading screen was still up — raise --budget')

    # Every script goes, except the structured data: a JSON-LD block is not
    # executable, and it is the one thing in the head a crawler reads closely.
    html = re.sub(r'<script\b(?![^>]*application/ld\+json)[^>]*>.*?</script>', '',
                  html, flags=re.S | re.I)
    # The theme attribute records what the rendering browser's own
    # prefers-color-scheme happened to be, so leaving it in makes the snapshot
    # depend on the machine that built it — this workstation renders dark and
    # the CI runner renders light, and every build then rewrites all twenty
    # files. Stripping it hands the choice back to the reader's browser.
    html = re.sub(r'(<html\b[^>]*?)\s+data-theme="[^"]*"', r'\1', html, flags=re.I)
    html = re.sub(r'<canvas\b[^>]*>.*?</canvas>', '', html, flags=re.S | re.I)
    html = re.sub(r'<button\b[^>]*>.*?</button>', '', html, flags=re.S | re.I)
    html = html.replace('<div id="scene-veil" aria-hidden="true"></div>', '')
    html = strip_element(html, '<div class="search-overlay"')

    # An empty chart container is a 320-pixel hole to a reader and nothing at
    # all to a crawler; say what is missing and where to see it.
    # `#/data/gaza&chart=gaza-monthly` is the app's own deep-link form; a second
    # `#` would be swallowed into the first fragment and scroll to nothing.
    html = re.sub(
        r'<div class="chart[^"]*" data-chart="([a-z0-9-]+)"[^>]*></div>',
        lambda m: ('<p class="chart-missing">Interactive chart — '
                   '<a href="%s&chart=%s">open it in the live record</a>.</p>'
                   % (route_url, m.group(1))),
        html)

    # The snapshot sits one directory down, and its route links must leave it.
    html = re.sub(r'(href|src)="(assets/|css/|js/|data/)', r'\1="%s\2' % depth_prefix, html)
    html = html.replace('href="#/', 'href="%sindex.html#/' % depth_prefix)

    # Self-canonical: a canonical pointing at a fragment collapses to the site
    # root for every search engine, which would leave sixteen of seventeen
    # routes unindexed — the exact problem this script exists to fix.
    html = re.sub(r'<link rel="canonical"[^>]*>',
                  '<link rel="canonical" href="%s">' % snapshot_url, html)
    html = re.sub(r'<meta property="og:url" content="[^"]*">',
                  '<meta property="og:url" content="%s">' % snapshot_url, html)
    html = html.replace('<link rel="canonical"',
                        '<style>%s</style>\n<link rel="canonical"' % SNAPSHOT_CSS.strip(), 1)

    note = ('<div class="snapshot-note"><strong>This is a static snapshot</strong>, generated on %s '
            'so that this section of the record can be read, linked and indexed without JavaScript. '
            'The charts, maps, filters and search are in the '
            '<a href="%s">interactive version of this page</a>.</div>' % (in_prose(generated), route_url))
    html = re.sub(r'(<main id="app"[^>]*>)', r'\1' + note, html, count=1)

    return html


def link_snapshots(titles, routes):
    """Give every snapshot a crawlable link to every other one.

    A crawler reaches a snapshot only through a link. The site's own navigation
    is hash-routed and therefore invisible to one, so without this pass each
    snapshot is an orphan discoverable through the sitemap alone, and a sitemap
    is a hint rather than a path. Run after every page is written, because the
    link text is each page's own title.
    """
    labels = [(slug, (titles.get(slug, ('', ''))[0] or slug).split(' \u00b7 ')[0])
              for slug, _ in routes]
    for slug, _ in routes:
        path = SNAPSHOT_DIR / ('%s.html' % slug)
        if not path.exists():
            continue
        items = ''.join(
            '<li><a href="%s.html">%s</a></li>' % (other, saxutils.escape(label))
            for other, label in labels if other != slug)
        nav = ('<nav class="snapshot-links" aria-label="Other sections">'
               '<h2>Every other section, without JavaScript</h2>'
               '<ul>%s</ul></nav>' % items)
        html = path.read_text(encoding='utf-8')
        html = re.sub(r'<nav class="snapshot-links".*?</nav>', '', html, flags=re.S)
        path.write_text(html.replace('</main>', nav + '</main>', 1), encoding='utf-8')
    return len(labels)


def faq_json_ld(html, page_url):
    """A FAQPage block for the rebuttals snapshot.

    Each rebuttal is literally a claim and its answer, which is the shape
    schema.org describes, and the one that lets a search engine show the answer
    to somebody who typed the claim in rather than the site name.
    """
    pairs = []
    for block in re.findall(r'<details class="rebuttal".*?</details>', html, re.S):
        q = re.search(r'<span class="rebuttal-claim">(.*?)</span>', block, re.S)
        a = re.search(r'<div class="rebuttal-answer">(.*?)</div>\s*(?:<div|</div>)', block, re.S)
        if not q or not a:
            continue
        question = plain(q.group(1)).strip().strip('\u201c\u201d"')
        # Block tags carry the word break in HTML, so stripping them without
        # putting one back runs "Refutation:" into the sentence after it.
        answer = re.sub(r'\s+', ' ', plain(re.sub(r'</(p|li|h[1-6]|div|tr|td|th)>', ' ', a.group(1)))).strip()
        if question and answer:
            pairs.append({'@type': 'Question', 'name': question,
                          'acceptedAnswer': {'@type': 'Answer', 'text': answer[:1200]}})
    if not pairs:
        return html
    block = json.dumps({'@context': 'https://schema.org', '@type': 'FAQPage',
                        'url': page_url, 'mainEntity': pairs}, ensure_ascii=False)
    return html.replace('</head>',
                        '<script type="application/ld+json">%s</script>\n</head>' % block, 1)


def snapshot_index(titles, routes, base, generated):
    """One crawlable page listing every snapshot, linked from the site footer."""
    items = ''.join(
        '<li><a href="%s.html">%s</a><p>%s</p></li>'
        % (slug, saxutils.escape(titles.get(slug, ('', ''))[0].split(' \u00b7 ')[0] or slug),
           saxutils.escape(titles.get(slug, ('', ''))[1]))
        for slug, _ in routes)
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Every section, without JavaScript \u00b7 The Documented Record</title>
<meta name="description" content="Static, text-only snapshots of every section of The Documented Record, readable and linkable without JavaScript.">
<meta name="robots" content="index, follow, max-snippet:-1">
<link rel="canonical" href="%ssnapshot/">
<link rel="stylesheet" href="../css/style.css">
<style>%s</style>
</head>
<body>
<main id="app">
<div class="snapshot-note"><strong>Text-only versions</strong>, generated on %s. Each page below is the
same content as the interactive record with the charts, filters and search removed. The
<a href="../index.html">full record is here</a>.</div>
<nav class="snapshot-links" aria-label="Every section">
<h2>Every section of the record</h2>
<ul>%s</ul>
</nav>
</main>
</body>
</html>
""" % (base, SNAPSHOT_CSS.strip(), in_prose(generated), items)


# ---------------------------------------------------------------- cards

def load_font(path, size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def wrap(draw, text, font, width):
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def tracked(draw, xy, text, font, fill, tracking):
    """Letter-spaced text. Pillow has no tracking, so place each glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


def blend(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    """The share card's diagonal gradient, built small and scaled up."""
    from PIL import Image
    stops = [(0.0, (13, 18, 32)), (0.55, (11, 15, 23)), (1.0, (20, 26, 43))]
    small = Image.new('RGB', (64, 34))
    px = small.load()
    for y in range(34):
        for x in range(64):
            t = (x / 63 + y / 33) / 2
            for i in range(len(stops) - 1):
                t0, c0 = stops[i]
                t1, c1 = stops[i + 1]
                if t <= t1 or i == len(stops) - 2:
                    px[x, y] = blend(c0, c1, min(1.0, max(0.0, (t - t0) / (t1 - t0))))
                    break
    return small.resize((CARD_W, CARD_H), Image.BICUBIC)


STRAPLINE = 'Every figure carries its source.'


def card(path, eyebrow, title, desc, footer):
    from PIL import Image, ImageDraw
    # The overview's description opens with the strapline the card already
    # carries at the foot; printing it twice reads as an error.
    if desc.startswith(STRAPLINE):
        desc = desc[len(STRAPLINE):].strip()
    img = background()
    d = ImageDraw.Draw(img)

    # The tricolour rule across the top, red through amber to green.
    for x in range(CARD_W):
        t = x / (CARD_W - 1)
        colour = blend(RED, AMBER, t / 0.5) if t < 0.5 else blend(AMBER, GREEN, (t - 0.5) / 0.5)
        d.line([(x, 0), (x, 5)], fill=colour)

    # The flag, drawn rather than loaded: three bars and the hoist triangle.
    fx, fy, fw, fb = 72, 92, 132, 30
    d.rectangle([fx, fy, fx + fw, fy + fb], fill=(0, 0, 0))
    d.rectangle([fx, fy + fb, fx + fw, fy + 2 * fb], fill=(255, 255, 255))
    d.rectangle([fx, fy + 2 * fb, fx + fw, fy + 3 * fb], fill=(0, 151, 54))
    d.polygon([(fx, fy), (fx + 54, fy + 45), (fx, fy + 90)], fill=(238, 42, 53))

    tracked(d, (72, 212), eyebrow.upper(), load_font(SANS_BOLD, 17), AMBER, 3.6)

    title_font = load_font(SERIF_BOLD, 58)
    lines = wrap(d, title, title_font, CARD_W - 144)
    if len(lines) > 3:
        title_font = load_font(SERIF_BOLD, 46)
        lines = wrap(d, title, title_font, CARD_W - 144)[:3]
    y = 252
    for line in lines:
        d.text((72, y), line, font=title_font, fill=INK)
        y += title_font.size + 12

    y = max(y + 14, 432)
    d.line([(72, y - 26), (CARD_W - 72, y - 26)], fill=RULE)
    desc_font = load_font(SANS, 23)
    for line in wrap(d, desc, desc_font, CARD_W - 144)[:2]:
        d.text((72, y), line, font=desc_font, fill=INK_2)
        y += 33

    d.line([(72, CARD_H - 92), (CARD_W - 72, CARD_H - 92)], fill=RULE)
    d.text((72, CARD_H - 70), STRAPLINE, font=load_font(SANS, 22), fill=INK)
    d.text((72, CARD_H - 40), footer, font=load_font(SANS, 18), fill=MUTED)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    return path.stat().st_size


# ---------------------------------------------------------------- sitemap

def sitemap(base, urls, lastmod):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, priority in urls:
        lines += ['  <url>',
                  '    <loc>%s</loc>' % saxutils.escape(url),
                  '    <lastmod>%s</lastmod>' % lastmod,
                  '    <changefreq>weekly</changefreq>',
                  '    <priority>%.1f</priority>' % priority,
                  '  </url>']
    lines.append('</urlset>')
    (ROOT / 'sitemap.xml').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return len(urls)


# ---------------------------------------------------------------- feed

# Appendix F of the report is a dated log of every revision made to it, and the
# Changelog route reads it straight out of data/report.json. The same log makes
# a feed: a record that is revised should be followable without anyone having to
# come back and check whether it was.

DATED = re.compile(r'^\s*(?:Update|Enhanced edition|[A-Z][a-z]+\s+\d{4}\s+update)[^(]*\(([^)]+)\)\s*:\s*')
TAGS = re.compile(r'<[^>]+>')
FEED_MAX = 40


def plain(html):
    return saxutils.unescape(TAGS.sub('', html or '')).strip()


def revisions():
    """The revision log, newest first, as (date, title, html) triples."""
    report = json.loads((ROOT / 'data' / 'report.json').read_text(encoding='utf-8'))
    part = next((p for p in report.get('parts', []) if 'revision-history' in p.get('id', '')), None)
    if not part:
        return []

    out = []
    for block in part.get('blocks', []):
        if block.get('type') != 'paragraph':
            continue
        text = plain(block.get('html', ''))
        m = DATED.match(text)
        if not m:
            continue
        try:
            when = datetime.datetime.strptime(m.group(1).strip(), '%d %B %Y').date()
        except ValueError:
            try:
                when = datetime.datetime.strptime(m.group(1).strip(), '%B %Y').date()
            except ValueError:
                continue
        body = text[m.end():].strip()
        # The title is the first clause of the entry: enough to tell a reader
        # scanning a feed reader whether this revision concerns them.
        title = re.split(r'(?<=[.;])\s', body)[0].strip().rstrip(';')
        out.append((when, title[:140], body))
    out.sort(key=lambda e: e[0], reverse=True)
    return out


def feed(base, generated):
    entries = revisions()[:FEED_MAX]
    host = base.replace('https://', '').replace('http://', '').rstrip('/')
    stamp = lambda d: d.strftime('%Y-%m-%dT00:00:00Z')
    newest = stamp(entries[0][0]) if entries else generated + 'T00:00:00Z'

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-GB">',
             '  <title>The Documented Record — revisions</title>',
             '  <subtitle>Every dated change to the record, in the words of the record itself. '
             'Figures move because the bodies that count them publish again; findings are added as '
             'courts and commissions make them.</subtitle>',
             '  <id>tag:%s,2026:feed</id>' % host,
             '  <updated>%s</updated>' % newest,
             '  <link rel="self" type="application/atom+xml" href="%sfeed.xml"/>' % base,
             '  <link rel="alternate" type="text/html" href="%s#/changelog"/>' % base,
             '  <author><name>Dr. Usman Kayani</name></author>',
             '  <rights>The record cites its sources; each source carries its own terms.</rights>',
             '  <generator uri="%s">prerender.py</generator>' % base]

    for i, (when, title, body) in enumerate(entries):
        lines += ['  <entry>',
                  '    <title>%s</title>' % saxutils.escape(title),
                  '    <id>tag:%s,%s:revision-%d</id>' % (host, when.isoformat(), i),
                  '    <updated>%s</updated>' % stamp(when),
                  '    <published>%s</published>' % stamp(when),
                  '    <link rel="alternate" type="text/html" href="%s#/changelog"/>' % base,
                  '    <content type="text">%s</content>' % saxutils.escape(body),
                  '  </entry>']
    lines.append('</feed>')
    (ROOT / 'feed.xml').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return len(entries)


def stamp_json_ld(generated):
    """Keep the structured data honest without hand-editing it.

    dateModified and wordCount are the two fields that go stale silently: a
    search engine reads them, a reader never does, so nothing here would show
    that the article claims a length the report stopped having.
    """
    path = ROOT / 'index.html'
    html = path.read_text(encoding='utf-8')
    new, n = re.subn(r'"dateModified": "\d{4}-\d{2}-\d{2}"',
                     '"dateModified": "%s"' % generated, html)
    if n != 2:
        raise SystemExit('prerender: expected 2 dateModified fields in index.html, found %d' % n)
    report = json.loads((ROOT / 'data' / 'report.json').read_text(encoding='utf-8'))
    words = (report.get('stats') or {}).get('words')
    if words:
        new, w = re.subn(r'"wordCount": \d+', '"wordCount": %d' % int(words), new)
        if w != 1:
            raise SystemExit('prerender: expected 1 wordCount field in index.html, found %d' % w)
    if new != html:
        path.write_text(new, encoding='utf-8')
    return n


# ---------------------------------------------------------------- main

def head_of(html, pattern):
    m = re.search(pattern, html)
    return m.group(1) if m else ''


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--chrome', default=CHROME)
    ap.add_argument('--budget', type=int, default=BUDGET)
    ap.add_argument('--only', nargs='*', help='snapshot only these route slugs')
    ap.add_argument('--no-cards', action='store_true')
    ap.add_argument('--no-snapshots', action='store_true')
    args = ap.parse_args()

    base = site_base()
    generated = data_date()
    routes = discover_routes()
    if args.only:
        routes = [r for r in routes if r[0] in args.only]
        if not routes:
            raise SystemExit('prerender: --only matched no route')

    print('base %s · data generated %s · %d routes' % (base, generated, len(routes)))
    stamp_json_ld(generated)

    SNAPSHOT_DIR.mkdir(exist_ok=True)
    titles = {}

    if not args.no_snapshots:
        if not pathlib.Path(args.chrome).exists():
            raise SystemExit('prerender: Chrome not found at %s' % args.chrome)
        httpd, port = serve()
        try:
            for slug, route in routes:
                url = 'http://127.0.0.1:%d/index.html?prerender=1%s' % (port, route)
                html = dump_dom(args.chrome, url, args.budget)
                if not html.strip():
                    raise SystemExit('prerender: %s produced an empty DOM' % slug)
                snapshot_url = '%ssnapshot/%s.html' % (base, slug)
                out = clean(html, snapshot_url, base + route, generated)
                # A rebuttal is a claim and its answer, which is the shape
                # schema.org's FAQPage describes, and the one that lets a search
                # engine answer the claim rather than merely name the site.
                if slug == 'rebuttals':
                    out = faq_json_ld(out, snapshot_url)
                (SNAPSHOT_DIR / ('%s.html' % slug)).write_text(out, encoding='utf-8')
                titles[slug] = (head_of(out, r'<title>(.*?)</title>'),
                                head_of(out, r'<meta name="description" content="([^"]*)"'))
                print('  %-16s %6d bytes  %s' % (slug, len(out), titles[slug][0][:58]))
        finally:
            httpd.shutdown()
        print('  cross-links:     %d snapshots linked to one another' % link_snapshots(titles, routes))
        (SNAPSHOT_DIR / 'index.html').write_text(
            snapshot_index(titles, routes, base, generated), encoding='utf-8')
        print('  snapshot/index.html written')

    if not args.no_cards:
        for slug, route in routes:
            title, desc = titles.get(slug, ('', ''))
            if not title:
                page = SNAPSHOT_DIR / ('%s.html' % slug)
                if not page.exists():
                    raise SystemExit('prerender: no snapshot for %s; run without --no-snapshots' % slug)
                html = page.read_text(encoding='utf-8')
                title = head_of(html, r'<title>(.*?)</title>')
                desc = head_of(html, r'<meta name="description" content="([^"]*)"')
            # The document title carries the site name for the tab; the card
            # already says it in the eyebrow, so take it off the headline.
            headline = title.split(' · ')[0]
            eyebrow = 'The Documented Record' if slug != 'overview' else 'Israel and the Occupied Territories'
            if slug == 'overview':
                headline = 'The Documented Record'
            size = card(CARD_DIR / ('%s.png' % slug), eyebrow, headline, desc,
                        base.replace('https://', '').rstrip('/') + '/' + route)
            print('  card %-16s %5.1f KB' % (slug, size / 1024))

    urls = ([(base, 1.0), ('%ssnapshot/' % base, 0.6)]
            + [('%ssnapshot/%s.html' % (base, slug), 0.8) for slug, _ in routes])
    n = sitemap(base, urls, generated)
    print('sitemap.xml: %d URLs' % n)
    print('feed.xml: %d revisions' % feed(base, generated))


if __name__ == '__main__':
    sys.exit(main())
