#!/usr/bin/env python3
"""render_check.py — open every route in a real browser and fail on a broken one.

`validate.py` checks the data and `prerender.py` writes the snapshots; neither
one can tell whether a chart actually drew. A chart that throws leaves its
container empty rather than stopping the page, so a route can look perfectly
healthy in the snapshot and be missing half its content in a browser.

The check is therefore the honest one: render each route in headless Chrome and
require that every chart container on the page has a canvas inside it, that no
container fell back to the "could not load" plate, and that nothing was written
to the console as an error. The routes come from `prerender.discover_routes`,
so a chapter added to the application is checked without being named here.

    python3 render_check.py                      # find Chrome, check every route
    python3 render_check.py --chrome /path/to/chrome
    python3 render_check.py --only day data-gaza
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

import prerender

CHROME_NAMES = (
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium',
)

# Chrome writes its own operating-system complaints to the same stream as the
# page's console — display links, GCM registration, sandbox policy — and none of
# them are the site. Only lines the renderer tags as CONSOLE are the page
# talking, and of those the worker and the favicon are noise: a headless run has
# no service worker registration and no tab to put an icon in.
PAGE_CONSOLE = re.compile(r':ERROR:CONSOLE')
IGNORED_CONSOLE = re.compile(
    r'favicon|ServiceWorker|service worker|sw\.js|net::ERR_ABORTED',
    re.I)


def find_chrome(given):
    if given:
        return given
    for name in CHROME_NAMES:
        if name.startswith('/'):
            if os.path.exists(name):
                return name
        elif shutil.which(name):
            return shutil.which(name)
    raise SystemExit('render_check: no Chrome found; pass --chrome')


def render(chrome, url, budget):
    """Return the DOM and the console log for one route.

    Chrome writes console messages to stderr under `--enable-logging=stderr`,
    which is the only way to see a page's own errors without driving it over
    the DevTools protocol.
    """
    out = subprocess.run(
        [chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--enable-logging=stderr', '--v=0',
         '--virtual-time-budget=%d' % budget, '--dump-dom', url],
        capture_output=True, timeout=600)
    return out.stdout.decode('utf-8', 'replace'), out.stderr.decode('utf-8', 'replace')


def check(html, log):
    """The three things that mean a route is broken, as a list of messages."""
    problems = []

    charts = len(re.findall(r'data-chart=', html))
    canvases = len(re.findall(r'<canvas', html))
    if charts and canvases < charts:
        problems.append('%d chart containers but %d canvases' % (charts, canvases))
    if 'Could not load' in html:
        problems.append('a chart fell back to the failure plate')

    for line in log.splitlines():
        if not PAGE_CONSOLE.search(line) or IGNORED_CONSOLE.search(line):
            continue
        problems.append('console: ' + line.strip()[:160])

    return problems, charts, canvases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chrome')
    ap.add_argument('--budget', type=int, default=12000)
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--json', action='store_true', help='write the result as JSON as well')
    args = ap.parse_args()

    chrome = find_chrome(args.chrome)
    routes = prerender.discover_routes()
    if args.only:
        routes = [r for r in routes if r[0] in args.only]
        if not routes:
            raise SystemExit('render_check: --only matched no route')

    httpd, port = prerender.serve()
    failures = 0
    results = []
    try:
        for slug, hash_path in routes:
            url = 'http://127.0.0.1:%d/index.html%s' % (port, hash_path)
            html, log = render(chrome, url, args.budget)
            problems, charts, canvases = check(html, log)
            results.append({'route': slug, 'charts': charts, 'canvases': canvases,
                            'problems': problems})
            status = 'ok' if not problems else 'FAIL'
            print('  %-18s charts=%-3d canvas=%-3d %s' % (slug, charts, canvases, status))
            for p in problems:
                print('      %s' % p)
            failures += bool(problems)
    finally:
        httpd.shutdown()

    print('render_check: %d routes, %d broken' % (len(results), failures))
    if args.json:
        (prerender.ROOT / 'render-check.json').write_text(
            json.dumps(results, indent=2) + '\n', encoding='utf-8')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
