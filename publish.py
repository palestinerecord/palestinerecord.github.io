#!/usr/bin/env python3
"""Validate the dashboard, then publish it to the live site.

Every local change to the dashboard is meant to reach
https://palestinerecord.github.io/ once it has passed a check of the facts, so
this script is the only thing that should ever push the site. It runs in one
direction and stops at the first thing that is wrong:

    validate.py  →  asset preflight  →  mirror  →  commit  →  push  →  Pages build  →  live fetch

`validate.py` is the gate that matters. It reads the data, not the rendered
page, because a chart can draw a wrong number perfectly: broken section
references, figures with no attribution, curated headline figures that
disagree with the live series, country names that do not join to a polygon,
cumulative series that fall, dates in the future. A failure there stops the
publication; warnings do not.

    python3 publish.py                     # validate, then publish if clean
    python3 publish.py --check             # validate and preflight only, never push
    python3 publish.py --dry-run           # everything up to the push, then stop
    python3 publish.py -m "Add the J50 map" # commit subject
    python3 publish.py --render            # also render the routes in headless Chrome

On the token
------------
The push reads `github-token` from the repository root at the moment it is
needed and passes it to git through a temporary askpass helper, which is
deleted afterwards. The token is never written into a file that survives the
run, never committed, never placed in a remote URL, and never passed as a
command-line argument, where `ps` would show it to every process on the
machine. `git remote add` with a token in the URL writes it into `.git/config`
in plain text, which is why the deploy clone has no remote at all.
"""

import argparse
import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]                      # /Users/drrobot/Desktop/hb
TOKEN_FILE = ROOT / 'github-token'
DEPLOY = ROOT / '.deploy' / 'palestinerecord.github.io'

OWNER = 'palestinerecord'
REPO = 'palestinerecord.github.io'
SITE = 'https://palestinerecord.github.io'
REMOTE = 'https://github.com/%s/%s.git' % (OWNER, REPO)

# The site is committed under the account's GitHub noreply address, so
# publishing never puts a personal email address into a public history.
AUTHOR = 'palestinerecord <328386359+palestinerecord@users.noreply.github.com>'

# rsync mirrors the folder exactly, so anything that is not part of the site
# has to be named here or it is published.
EXCLUDES = ('.git/', '__pycache__/', '.DS_Store', 'data/raw/', '*.pyc',
            # Working notes, not part of the record: this one was live at the
            # site root until it was named here.
            'dashboard_ideas.md')

# Fetched after the Pages build to prove the deployment is the one just pushed.
LIVE_CHECKS = ('/', '/data/figures.json', '/data/report.json', '/js/charts.js',
               '/sitemap.xml', '/robots.txt', '/snapshot/overview.html')

# Every route a reader can reach, checked in the order the navigation lists
# them. The `data/` ids are the chapter ids in js/views.js; a name that is not
# one of them renders an empty chapter, which is why they are kept in step.
ROUTES = ('overview', 'tour', 'timeline', 'evidence', 'rebuttals', 'statements',
          'legal', 'sources', 'api', 'changelog',
          'data/gaza', 'data/asymmetry', 'data/since-1948', 'data/complicity',
          'data/land', 'data/west-bank', 'data/wars', 'data/world', 'data/tables')

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


class Stop(Exception):
    """Raised for anything that must halt the publication."""


def say(message):
    print('  ' + message, flush=True)


def run(args, cwd=None, env=None, check=True, timeout=None):
    """Run a command and return its output, never echoing the environment."""
    try:
        result = subprocess.run(args, cwd=cwd, env=env, capture_output=True,
                                text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Stop('%s did not finish within %ds' % (args[0], timeout))
    if check and result.returncode != 0:
        raise Stop('%s failed: %s' % (args[0], (result.stderr or result.stdout).strip()[:400]))
    return (result.stdout + result.stderr).strip()


# ---------------------------------------------------------------- the gate


def validate(show_warnings):
    """Run validate.py. Its failures are the reason this script exists."""
    args = [sys.executable, str(HERE / 'validate.py')]
    if show_warnings:
        args.append('--warnings')
    result = subprocess.run(args, cwd=HERE, capture_output=True, text=True)
    print(result.stdout.rstrip())
    if result.returncode != 0:
        raise Stop('validate.py reported failures; nothing was published')


def preflight():
    """Every local asset the page asks for must exist in the folder being sent.

    A missing file is a 404 on the live site and an empty panel for the reader,
    and it is invisible locally if the browser still holds the old copy.
    """
    index = (HERE / 'index.html').read_text()
    referenced = set()
    for match in re.findall(r'(?:src|href)="([^"]+)"', index):
        if match.startswith(('http', '//', '#', 'data:', 'mailto:')):
            continue
        referenced.add(match.split('?', 1)[0].lstrip('/'))
    missing = sorted(path for path in referenced if not (HERE / path).exists())
    if missing:
        raise Stop('index.html references files that do not exist: ' + ', '.join(missing))
    for required in ('.nojekyll', 'robots.txt', 'sitemap.xml', 'index.html'):
        if not (HERE / required).exists():
            raise Stop('%s is missing from the dashboard folder; Pages needs it at the site root'
                       % required)
    say('preflight: %d referenced assets present, site files in place' % len(referenced))


def dump_dom(route, budget, wall):
    """Render one route in headless Chrome and return the DOM it wrote.

    Waiting for Chrome to exit does not work here. On a page holding an
    animation loop — the hero field, the rotating 3D bars — the browser writes
    the whole document and then stays up, so a wait on the process hangs long
    after the render it was waiting for finished. This watches the output
    instead: the dump is complete once the file has stopped growing, and the
    process group is killed as soon as it has.
    """
    profile = tempfile.mkdtemp(prefix='publish-chrome-')
    out = pathlib.Path(profile) / 'dom.html'
    # No software GL. swiftshader wedges on data/gaza: twenty charts on one
    # route stall the renderer in ReadPixels, virtual time stops advancing
    # while it waits, and the route never writes a byte however long it is
    # given (90s, 0 bytes). Without a GL backend every route settles in under
    # three seconds, and the check is unaffected: it counts the canvas each
    # chart instantiates, which ECharts creates either way. What a GPU draws
    # inside that canvas was never something a headless run could prove.
    args = [CHROME, '--headless=new', '--no-sandbox', '--disable-gpu',
            '--disable-software-rasterizer', '--virtual-time-budget=%d' % budget,
            '--user-data-dir=' + profile, '--dump-dom',
            '%s/index.html?still=1#/%s' % ('http://localhost:8777', route)]
    deadline = time.time() + wall
    settled, size = 0, -1
    with out.open('wb') as handle:
        chrome = subprocess.Popen(args, stdout=handle, stderr=subprocess.DEVNULL,
                                  start_new_session=True)
        try:
            while time.time() < deadline:
                grown = out.stat().st_size
                # Two quiet samples in a row, not one: the dump is written in
                # chunks, and a single quiet sample lands between them.
                settled = settled + 1 if grown == size and grown > 0 else 0
                size = grown
                if settled >= 2 or chrome.poll() is not None:
                    break
                time.sleep(0.4)
            else:
                raise Stop('%s wrote %d bytes in %ds and did not settle'
                           % (route, size, wall))
        finally:
            if chrome.poll() is None:
                os.killpg(os.getpgid(chrome.pid), 9)
                chrome.wait()
    return out.read_text(encoding='utf-8', errors='replace')


def render_check(budget=6000, wall=180):
    """Optionally render every route in headless Chrome before publishing.

    This is secondary to validate.py and off by default: it is slow, and a page
    that renders is not a page that is right. `--dump-dom` writes only when
    Chrome exits, so an interrupted run yields an empty document that would read
    as a pass; the byte count is checked first for exactly that reason.

    Every route also gets a wall-clock limit. Virtual time stops advancing while
    the renderer waits on something that never arrives, so a wedged Chrome does
    not expire its own budget — without `wall` the publication simply hangs, and
    a deploy that hangs silently is worse than one that fails.

    The DOM is captured to a file rather than to a pipe, which is not a
    stylistic choice: Chrome's helper processes inherit the write end of the
    pipe and outlive the browser, so reading it waits on an end-of-file that
    never comes and the run hangs after the page has already rendered. Each
    render also gets its own session, so the limit above kills the whole process
    group rather than leaving orphans behind burning a core apiece.
    """
    if not pathlib.Path(CHROME).exists():
        raise Stop('Chrome is not at %s' % CHROME)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', '8777'],
                              cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        for route in ROUTES:
            dom = dump_dom(route, budget, wall)
            charts = len(re.findall(r'data-chart=', dom))
            canvas = len(re.findall(r'<canvas', dom))
            if len(dom) < 5000:
                raise Stop('%s produced %d bytes of DOM; Chrome did not finish' % (route, len(dom)))
            if 'Could not load' in dom:
                raise Stop('%s reports a load failure' % route)
            if canvas < charts:
                raise Stop('%s drew %d canvases for %d charts' % (route, canvas, charts))
            say('render %-18s bytes=%-7d charts=%-3d canvas=%-3d ok' % (route, len(dom), charts, canvas))
    finally:
        server.terminate()


# ------------------------------------------------------------- the secrets


def token_guard():
    """Refuse to publish if the token could leak, before anything is pushed."""
    if not TOKEN_FILE.exists():
        raise Stop('%s does not exist; the push has no credentials' % TOKEN_FILE)
    ignored = subprocess.run(['git', 'check-ignore', '-q', TOKEN_FILE.name], cwd=ROOT)
    if ignored.returncode != 0:
        raise Stop('github-token is not gitignored; refusing to publish')
    tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', TOKEN_FILE.name],
                             cwd=ROOT, capture_output=True, text=True)
    if tracked.returncode == 0:
        raise Stop('github-token is tracked by git; remove it from the index before publishing')
    # The prefix on its own matches this file and the README, both of which
    # have to name it to describe the guard. A token is the prefix plus its
    # body, so the body is what is searched for.
    shape = r'ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{30,}'
    leaked = subprocess.run(['grep', '-rIlE', shape, str(HERE)],
                            capture_output=True, text=True)
    hits = [line for line in leaked.stdout.splitlines() if line.strip()]
    if hits:
        raise Stop('a token-shaped string is inside the dashboard folder: ' + ', '.join(hits[:3]))
    say('token guard: ignored, untracked, and absent from the published folder')


def read_token():
    return TOKEN_FILE.read_text().strip()


class Askpass:
    """A temporary helper that hands git the token without it touching argv.

    git calls the program named by GIT_ASKPASS once for the username and once
    for the password, passing the prompt as the first argument. The file holds
    a `cat` of the token rather than the token itself, so the secret exists in
    exactly one place on disk, the one the user already keeps.
    """

    def __enter__(self):
        handle = tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False)
        handle.write('#!/bin/sh\ncase "$1" in\n'
                     "  Username*) printf '%s' \"" + OWNER + "\" ;;\n"
                     "  *) printf '%s' \"$(cat " + str(TOKEN_FILE) + ")\" ;;\n"
                     'esac\n')
        handle.close()
        self.path = pathlib.Path(handle.name)
        self.path.chmod(stat.S_IRWXU)
        return self.path

    def __exit__(self, *exc):
        self.path.unlink(missing_ok=True)
        return False


def git_env():
    env = dict(os.environ)
    env['GIT_TERMINAL_PROMPT'] = '0'
    env['GIT_CONFIG_NOSYSTEM'] = '1'
    return env


# ------------------------------------------------------------- the publish


def ensure_clone():
    """Keep one working clone of the published site and reuse it."""
    if (DEPLOY / '.git').exists():
        return
    DEPLOY.parent.mkdir(parents=True, exist_ok=True)
    say('cloning the site repository into %s' % DEPLOY)
    with Askpass() as helper:
        env = git_env()
        env['GIT_ASKPASS'] = str(helper)
        run(['git', 'clone', '--quiet', REMOTE, str(DEPLOY)], env=env)
    # The clone writes the remote into .git/config. The URL carries no
    # credentials, so there is nothing secret in it, but drop the fetch
    # refspec's stored credentials helper anyway.
    run(['git', 'config', '--local', '--unset-all', 'credential.helper'],
        cwd=DEPLOY, check=False)


def mirror():
    """Copy the dashboard over the clone, deleting anything no longer in it.

    `--delete` is what makes the live site a mirror rather than an accumulation:
    without it, a file renamed locally stays served under its old name forever.
    """
    args = ['rsync', '-a', '--delete']
    for pattern in EXCLUDES:
        args += ['--exclude', pattern]
    args += [str(HERE) + '/', str(DEPLOY) + '/']
    run(args)
    # An excluded file is also protected from --delete, so anything that was
    # published before it was excluded stays served until it is removed here.
    # --delete-excluded is not the answer: .git/ is on the same list.
    for name in EXCLUDES:
        if '*' in name or name.endswith('/'):
            continue
        stale = DEPLOY / name
        if stale.exists():
            stale.unlink()
            say('pruned %s from the published site' % name)
    changed = run(['git', 'status', '--porcelain'], cwd=DEPLOY)
    lines = [line for line in changed.splitlines() if line.strip()]
    say('mirror: %d paths differ from the published site' % len(lines))
    return lines


def commit(message, changes):
    if not changes:
        say('nothing changed; the live site already matches this folder')
        return None
    run(['git', 'add', '--all'], cwd=DEPLOY)
    run(['git', '-c', 'user.name=%s' % AUTHOR.split(' <')[0],
         '-c', 'user.email=%s' % AUTHOR.split('<')[1].rstrip('>'),
         'commit', '--quiet', '-m', message], cwd=DEPLOY)
    sha = run(['git', 'rev-parse', '--short', 'HEAD'], cwd=DEPLOY)
    say('commit %s  %s' % (sha, message.splitlines()[0]))
    return sha


def push():
    with Askpass() as helper:
        env = git_env()
        env['GIT_ASKPASS'] = str(helper)
        out = run(['git', 'push', '--quiet', REMOTE, 'HEAD:main'], cwd=DEPLOY, env=env)
    say('pushed to %s/%s' % (OWNER, REPO))
    return out


# ---------------------------------------------------------------- the live


def api(path):
    request = urllib.request.Request('https://api.github.com/repos/%s/%s%s' % (OWNER, REPO, path))
    request.add_header('Authorization', 'Bearer ' + read_token())
    request.add_header('Accept', 'application/vnd.github+json')
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def wait_for_build(timeout=300):
    """Poll the Pages API until the build that carries this commit is done."""
    deadline = time.time() + timeout
    last = ''
    while time.time() < deadline:
        try:
            status = api('/pages')['status']
        except urllib.error.HTTPError as exc:
            raise Stop('the Pages API returned %s' % exc.code)
        if status != last:
            say('pages: %s' % status)
            last = status
        if status == 'built':
            return True
        if status == 'errored':
            raise Stop('the Pages build failed; the previous version is still live')
        time.sleep(10)
    say('pages: still %s after %ds; the checks below may show the previous build' % (last, timeout))
    return False


def wait_for_edge(expect, timeout=300):
    """Wait for the CDN to stop serving the build before this one.

    The Pages API reports `built` while the edge is still handing out the
    previous index.html, for as long as its ten-minute cache holds. That is
    not a failed deployment and should not be reported as one, so the version
    is polled through a cache-busting query — which changes the edge key
    without changing what is served — before the checks below run against it.
    """
    deadline = time.time() + timeout
    while True:
        try:
            url = '%s/?cb=%d' % (SITE.rstrip('/'), int(time.time() * 1000))
            with urllib.request.urlopen(url, timeout=30) as response:
                served = set(re.findall(rb'\?v=(\d+)', response.read()))
        except urllib.error.URLError:
            served = set()
        if expect.encode() in served:
            say('edge: serving ?v=%s' % expect)
            return True
        if time.time() >= deadline:
            say('edge: still serving ?v=%s after %ds'
                % (b', '.join(sorted(served)).decode() or 'nothing', timeout))
            return False
        time.sleep(10)


def check_live(expect_version=None):
    """Fetch the published files and confirm the site answers for itself."""
    problems = []
    for path in LIVE_CHECKS:
        url = SITE + path
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                body = response.read()
                say('live %-24s %s  %d bytes' % (path, response.status, len(body)))
                if path == '/' and expect_version:
                    served = set(re.findall(rb'\?v=(\d+)', body))
                    if served and expect_version.encode() not in served:
                        problems.append('the served index.html asks for ?v=%s, not ?v=%s'
                                        % (b', '.join(sorted(served)).decode(), expect_version))
                if path == '/' and SITE.encode() not in body:
                    problems.append('the served index.html does not name %s as its canonical host' % SITE)
        except urllib.error.HTTPError as exc:
            problems.append('%s returned %s' % (url, exc.code))
        except urllib.error.URLError as exc:
            problems.append('%s could not be fetched: %s' % (url, exc.reason))
    for problem in problems:
        say('live FAIL  ' + problem)
    return not problems


def local_version():
    versions = set(re.findall(r'\?v=(\d+)', (HERE / 'index.html').read_text()))
    return sorted(versions)[0] if len(versions) == 1 else None


# --------------------------------------------------------------------- cli


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('-m', '--message', default='Update the dashboard',
                        help='the commit subject on the site repository')
    parser.add_argument('--check', action='store_true', help='validate and preflight only')
    parser.add_argument('--dry-run', action='store_true', help='stop before the push')
    parser.add_argument('--render', action='store_true', help='also render every route')
    parser.add_argument('--warnings', action='store_true', help='show every validator warning')
    parser.add_argument('--no-wait', action='store_true', help='do not wait for the Pages build')
    args = parser.parse_args()

    try:
        print('validating')
        validate(args.warnings)
        preflight()
        if args.render:
            print('rendering')
            render_check()
        if args.check:
            print('checks passed; nothing published (--check)')
            return 0

        print('publishing')
        token_guard()
        ensure_clone()
        changes = mirror()
        if not changes:
            print('the live site is already current')
            return 0
        if args.dry_run:
            print('%d paths would be published; stopped before the push (--dry-run)' % len(changes))
            return 0
        commit(args.message, changes)
        push()

        print('deploying')
        version = local_version()
        if not args.no_wait:
            wait_for_build()
            if version:
                wait_for_edge(version)
        ok = check_live(version)
        print('published' if ok else 'published, but the live checks did not all pass')
        return 0 if ok else 1
    except Stop as stop:
        print('  STOP  %s' % stop)
        return 1


if __name__ == '__main__':
    sys.exit(main())
