#!/usr/bin/env python3
"""Check the dashboard's facts before it is published.

`verify.py` asks whether the conversion from the markdown lost a line.
This script asks the harder question: whether what the dashboard states is
true of the record it claims to be drawn from. It reads only the data, never
the rendered page, because a chart can draw a wrong number perfectly.

What it checks, in order of how badly it would embarrass the record:

  * Provenance. Every curated figure, statement, source and determination
    carries an attribution, and every `§` reference resolves to a section
    that actually exists in report-final.md. A figure whose section reference
    has gone stale is a figure no reader can check.
  * Agreement. The headline figures and the live time series are two
    independent copies of the same counts; they must not disagree. The
    monthly series must also sum to its own cumulative series.
  * Joins. Every country named in the curated map data must resolve, through
    the alias table, to a polygon in the geometry. A name that does not match
    is dropped silently by ECharts: the state simply vanishes from the map.
  * Staleness. `report.json` must be newer than the markdown it derives from,
    or the dashboard is quoting a version of the report that no longer exists.
  * Arithmetic. Declared totals must equal the lists they count.
  * Chronology. Nothing may be dated in the future, and sorted records must
    actually be sorted.

Failures block publication. Warnings do not: they mark figures that could not
be located verbatim in the markdown, which is often legitimate — a figure may
be derived, rounded, or written differently in prose than in a table.

    python3 validate.py              # check, print a report, exit non-zero on failure
    python3 validate.py --quiet      # only print failures and the verdict
    python3 validate.py --warnings   # include the full warning list
"""

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / 'data'
MARKDOWN = HERE.parent / 'report-final.md'
TODAY = dt.date.today()

FAILURES = []
WARNINGS = []
NOTES = []


def fail(check, message):
    FAILURES.append((check, message))


def warn(check, message):
    WARNINGS.append((check, message))


def note(message):
    NOTES.append(message)


# ---------------------------------------------------------------- loading


def load_all():
    """Parse every data file. A file that will not parse stops the run."""
    files = {}
    for path in sorted(DATA.glob('*.json')):
        try:
            files[path.stem] = json.loads(path.read_text())
        except Exception as exc:                       # noqa: BLE001 - report and stop
            fail('parse', '%s does not parse: %s' % (path.name, exc))
    for path in sorted((DATA / 'geo').glob('*.json')):
        try:
            files['geo/' + path.stem] = json.loads(path.read_text())
        except Exception as exc:                       # noqa: BLE001
            fail('parse', 'geo/%s does not parse: %s' % (path.name, exc))
    return files


def walk(node, path='', chain=()):
    """Yield every (path, dict, ancestors) in a nested structure, parents first.

    `ancestors` is every enclosing dict, outermost first. Attribution is
    inherited: a block that names its source covers the rows beneath it, which
    is how the curated files are actually written.
    """
    if isinstance(node, dict):
        yield path, node, chain
        for key, value in node.items():
            yield from walk(value, '%s.%s' % (path, key) if path else key, chain + (node,))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from walk(value, '%s[%d]' % (path, i), chain)


# ------------------------------------------------------------- provenance


def section_keys(report):
    """The set of section numbers the report actually contains.

    Section ids are slugs of their headings, so 6.3 arrives as `63-the-...`.
    Reduce each to its leading digits and compare on that.
    """
    keys = set()
    for part in report.get('parts', []):
        for section in part.get('sections', []):
            head = re.match(r'^(\d+[a-z]?)-', section.get('id', ''))
            if head:
                keys.add(head.group(1))
    return keys


def check_references(files):
    """Every `§x.y` in the curated data must name a section that exists."""
    report = files.get('report')
    if not report:
        fail('references', 'data/report.json is missing; run build.py')
        return
    known = section_keys(report)
    if not known:
        fail('references', 'no section ids parsed out of report.json')
        return
    seen, broken = 0, 0
    for name, blob in files.items():
        if name in ('report', 'names', 'names-boot') or name.startswith('geo/'):
            continue
        for where, node, _ in walk(blob, name):
            ref = node.get('ref')
            if not isinstance(ref, str):
                continue
            for token in re.findall(r'§\s*(\d+\.\d+[a-z]?|\d+[a-z]?)', ref):
                seen += 1
                if token.replace('.', '') not in known:
                    broken += 1
                    fail('references', '%s cites §%s, which is not a section of the report' % (where, token))
    note('%d section references checked, %d broken' % (seen, broken))


# Fields that carry a structured attribution. `ref` counts: every `§` is
# checked against the report by check_references, and the section it names
# carries the citation itself.
SOURCE_FIELDS = ('source', 'sources', 'url', 'ref')

# Fields that carry prose, which in these files sometimes holds the
# attribution instead — "the Survey of Palestine recorded", "under the 2016
# Memorandum of Understanding". Weaker than a `source` field, but not
# unsourced.
PROSE_FIELDS = ('note', 'notes', 'lede', 'method', 'subtitle', 'description',
                'record_note', 'significance', 'caution', 'blurb', 'context')

# The bodies whose names, appearing in that prose, identify where a figure
# came from. Deliberately a list of institutions rather than a guess at
# sentence structure: a row that names none of these names nobody.
SOURCE_NAMES = re.compile(
    r"OCHA|B'Tselem|UNRWA|UNICEF|UNESCO|WHO|WFP|OHCHR|UNCTAD|United Nations|"
    r"Ministry of Health|International Court|International Criminal|ICJ|ICC|"
    r"Amnesty|Human Rights Watch|Peace Now|Yesh Din|HaMoked|Addameer|"
    r"Al[- ]Haq|Al Mezan|Defence for Children|Physicians for Human Rights|"
    r"Central Bureau of Statistics|PCBS|SIPRI|Lancet|IPC|Save the Children|"
    r"Abu Sitta|Survey of Palestine|Anglo-American Committee|Knesset|"
    r"Haaretz|Al Jazeera|Wikipedia|Security Council|General Assembly|S/\d{4,5}|"
    r"Memorandum of Understanding|Foreign Assistance Act|Leahy|Oslo|"
    r"Commission of Inquiry|Shin Bet|Israel Prison Service|Tech For Palestine|"
    r"Geneva Convention|Rome Statute|§\s*\d")


def prose(node):
    """Every free-text string a node carries, including lists of them."""
    for key in PROSE_FIELDS:
        value = node.get(key)
        if isinstance(value, str):
            yield value
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    yield item


def check_attribution(files):
    """Anything that states a number states where the number came from.

    Attribution is inherited and may be structured or written out. A `source`
    or a `§` reference on the block covers the rows beneath it; a row whose
    only attribution is a sentence naming the body that published the figure
    warns, because prose cannot be checked mechanically; a row that names
    nobody anywhere above it fails.
    """
    named = prosed = missing = 0
    for name in ('figures', 'history', 'legal', 'long-record', 'conduct-record',
                 'war-record', 'maps', 'elements', 'world-positions'):
        blob = files.get(name)
        if not blob:
            continue
        for where, node, ancestors in walk(blob, name):
            if 'value' not in node and 'killed' not in node:
                continue
            chain = (node,) + ancestors
            if any(anc.get(field) for anc in chain for field in SOURCE_FIELDS):
                named += 1
            elif any(SOURCE_NAMES.search(text) for anc in chain for text in prose(anc)):
                prosed += 1
                warn('attribution', '%s is attributed in prose only, with no source field' % where)
            else:
                missing += 1
                fail('attribution', '%s states a figure with no source anywhere above it' % where)
    note('attribution: %d figures sourced, %d attributed in prose only, %d unsourced'
         % (named, prosed, missing))


# ------------------------------------------------------------- agreement


def check_timeseries(files):
    """The series must be internally consistent before anything is drawn."""
    ts = files.get('timeseries')
    if not ts:
        fail('timeseries', 'data/timeseries.json is missing; run fetch_timeseries.py')
        return
    for territory in ('gaza', 'west_bank'):
        block = ts.get(territory, {})
        for key, series in block.items():
            if not isinstance(series, dict) or 'months' not in series:
                continue
            months, values = series.get('months', []), series.get('values', [])
            if len(months) != len(values):
                fail('timeseries', '%s.%s has %d months against %d values'
                     % (territory, key, len(months), len(values)))
                continue
            if months != sorted(months):
                fail('timeseries', '%s.%s months are not in order' % (territory, key))
            if key.startswith('cumulative'):
                drops = [months[i] for i in range(1, len(values)) if values[i] < values[i - 1]]
                if drops:
                    fail('timeseries', '%s.%s falls at %s; a cumulative series cannot decrease'
                         % (territory, key, ', '.join(drops[:3])))
            latest = months[-1] if months else ''
            if latest and latest > TODAY.strftime('%Y-%m'):
                fail('timeseries', '%s.%s runs to %s, which is in the future' % (territory, key, latest))
        monthly, cumulative = block.get('monthly_killed'), block.get('cumulative_killed')
        if monthly and cumulative:
            total, final = sum(monthly['values']), cumulative['values'][-1]
            if final and abs(total - final) / final > 0.02:
                fail('timeseries', '%s monthly killed sums to %s but the cumulative series ends at %s'
                     % (territory, f'{total:,}', f'{final:,}'))
            else:
                note('%s: monthly sum %s against cumulative %s' % (territory, f'{total:,}', f'{final:,}'))


def check_headline_agreement(files):
    """The curated headline figures and the live series are two copies of one count."""
    figures, ts = files.get('figures'), files.get('timeseries')
    if not figures or not ts:
        return
    live = {
        'Palestinians killed in Gaza': ts['summary']['killed']['total'],
        'Children killed in Gaza': ts['summary']['killed']['children'],
        'Named and identified dead': ts['summary']['killedInGazaListCount'],
    }
    for item in figures.get('headline', []):
        expected = live.get(item.get('label'))
        if expected is None or not isinstance(item.get('value'), (int, float)):
            continue
        if int(item['value']) != int(expected):
            fail('agreement', '"%s" is %s in figures.json but %s in the live series'
                 % (item['label'], f"{item['value']:,}", f'{int(expected):,}'))
        else:
            note('agreement: %s = %s in both' % (item['label'], f"{item['value']:,}"))


def check_declared_totals(files):
    """A declared total must equal the list it counts."""
    figures = files.get('figures', {})
    j50 = (figures.get('definitions') or {}).get('j50')
    if j50:
        totals, countries = j50.get('totals', {}), j50.get('countries', [])
        national = sum(len(c.get('orgs', [])) for c in countries)
        checks = [('countries', len(countries)), ('national', national),
                  ('global', len(j50.get('global_orgs', []))),
                  ('total', national + len(j50.get('global_orgs', [])))]
        for key, actual in checks:
            if key in totals and totals[key] != actual:
                fail('totals', 'j50.totals.%s says %s, the list holds %s' % (key, totals[key], actual))
        note('j50: %d countries, %d national bodies, %d global, %d total'
             % (len(countries), national, len(j50.get('global_orgs', [])), national + len(j50.get('global_orgs', []))))
    nakba = files.get('nakba', {}).get('meta')
    if nakba and 'villages' in nakba:
        listed = len(files['nakba'].get('villages', []))
        if int(nakba['villages']) != listed:
            fail('totals', 'nakba.meta.villages says %s, the list holds %d' % (nakba['villages'], listed))


def check_recognition_count(files):
    """Four files state how many states recognise Palestine. It is one number.

    The map, the legal record, the long record and the map's own state list are
    each maintained by hand. If one is updated after a recognition and another
    is not, both keep drawing, and the dashboard quietly contradicts itself on
    the figure a reader is most likely to quote.
    """
    positions = files.get('world-positions', {}).get('recognition', {})
    legal = files.get('legal', {}).get('recognition', {})
    long_record = files.get('long-record', {}).get('recognition', {})
    if not positions or not legal or not long_record:
        return

    counted = sum(1 for s in positions.get('states', []) if s.get('un') and s.get('recognises'))
    stated = {
        'world-positions.recognition.un_recognising': positions.get('un_recognising'),
        'world-positions state list': counted,
        'legal.recognition.now.recognise': legal.get('now', {}).get('recognise'),
        'legal.recognition.points[-1]': (legal.get('points') or [{}])[-1].get('value'),
        'long-record.recognition.standing[0]': (long_record.get('standing') or [{}])[0].get('value'),
        'long-record.recognition.timeline[-1]': (long_record.get('timeline') or [{}])[-1].get('value'),
    }
    values = {k: v for k, v in stated.items() if isinstance(v, int)}
    distinct = set(values.values())
    if len(distinct) > 1:
        for where, value in sorted(values.items()):
            fail('recognition', '%s says %d recognising states' % (where, value))
    else:
        note('recognition: %d recognising states, agreed across %d places'
             % (distinct.pop() if distinct else 0, len(values)))

    total = legal.get('now', {}).get('total') or positions.get('un_total')
    refusing = next((s.get('value') for s in long_record.get('standing', [])
                     if 'not recognising' in str(s.get('label', ''))), None)
    if isinstance(total, int) and isinstance(refusing, int) and values:
        expected = total - max(values.values())
        if refusing != expected:
            fail('recognition', 'long-record says %d states do not recognise; %d of %d do, so it is %d'
                 % (refusing, max(values.values()), total, expected))


# ------------------------------------------------------------------ joins


def check_map_joins(files):
    """A country that does not match a polygon disappears from the map in silence."""
    world = files.get('geo/world')
    positions = files.get('world-positions')
    if not world or not positions:
        fail('joins', 'world geometry or world-positions.json is missing')
        return
    polygons = {f['properties'].get('name') for f in world.get('features', [])}
    alias = positions.get('alias', {})
    resolved = lambda name: alias.get(name, name) in polygons        # noqa: E731 - one line, one use

    unmatched = []
    for state in positions.get('recognition', {}).get('states', []):
        name = state.get('map') or state.get('name')
        if name and not resolved(name):
            unmatched.append('recognition: ' + name)
    for group in ('sanctions', 'icj'):
        for where, node, _ in walk(positions.get(group, {}), group):
            name = node.get('map') or node.get('state') or node.get('name')
            if isinstance(name, str) and name and name not in ('', None):
                if not resolved(name) and name[0].isupper():
                    unmatched.append('%s: %s' % (group, name))
    j50 = (files.get('figures', {}).get('definitions') or {}).get('j50', {})
    for country in j50.get('countries', []):
        if not resolved(country.get('name', '')):
            unmatched.append('j50: ' + country.get('name', ''))

    for item in sorted(set(unmatched)):
        fail('joins', '%s does not resolve to a polygon in the world geometry' % item)
    note('map joins: %d polygons, %d aliases, %d unresolved' % (len(polygons), len(alias), len(set(unmatched))))


# ------------------------------------------------------------- chronology


def parse_date(value):
    for pattern in ('%Y-%m-%d', '%Y-%m', '%Y'):
        try:
            return dt.datetime.strptime(value, pattern).date()
        except (ValueError, TypeError):
            continue
    return None


def check_chronology(files):
    """Nothing is dated after today, and sorted records are sorted."""
    future = 0
    for name, blob in files.items():
        if name.startswith('geo/') or name in ('names', 'names-boot'):
            continue
        for where, node, _ in walk(blob, name):
            for key in ('sort', 'date'):
                stamp = parse_date(node.get(key)) if isinstance(node.get(key), str) else None
                if stamp and stamp > TODAY:
                    future += 1
                    fail('chronology', '%s.%s is %s, which is in the future' % (where, key, node[key]))

    timeline = files.get('timeline-extra', {}).get('items', [])
    order = [item.get('sort', '') for item in timeline]
    if order != sorted(order):
        fail('chronology', 'timeline-extra.json is not in date order')
    for item in timeline:
        stamp = parse_date(item.get('sort', ''))
        if stamp and item.get('year') and int(item['year']) != stamp.year:
            fail('chronology', 'timeline entry "%s" is dated %s but filed under %s'
                 % (item.get('event', '')[:48], item['sort'], item['year']))
    note('chronology: %d entries dated after today' % future)


def check_statements(files):
    """Every statement of intent carries the attribution that makes it evidence."""
    blob = files.get('statements')
    if not blob:
        return
    categories = {c['id'] for c in blob.get('categories', [])}
    required = ('speaker', 'role', 'date', 'quote', 'source', 'significance')
    for i, item in enumerate(blob.get('items', [])):
        for field in required:
            if not str(item.get(field, '')).strip():
                fail('statements', 'statements[%d] (%s) has no %s' % (i, item.get('speaker', '?'), field))
        cats = item.get('cat')
        for cat in (cats if isinstance(cats, list) else [cats]):
            if cat not in categories:
                fail('statements', 'statements[%d] is filed under unknown category %r' % (i, cat))
        if not parse_date(item.get('sort', '')):
            fail('statements', 'statements[%d] has an unparseable sort date %r' % (i, item.get('sort')))
    note('statements: %d entries, %d categories' % (len(blob.get('items', [])), len(categories)))


def check_sources(files):
    """The source library is the record's spine; a dead entry is a dead claim."""
    blob = files.get('sources')
    if not blob:
        return
    seen, total = {}, 0
    for group in blob.get('groups', []):
        for item in group.get('items', []):
            total += 1
            if not item.get('title'):
                fail('sources', 'an entry in group %r has no title' % group.get('id'))
            url = item.get('url', '')
            if not url:
                # A book or a founding text has no url and needs none, provided
                # the entry still says who published it and when.
                if item.get('org') and item.get('date'):
                    warn('sources', '%r is cited in print, with no url' % item.get('title', '?')[:60])
                else:
                    fail('sources', '%r has neither a url nor a publisher and date'
                         % item.get('title', '?')[:60])
            elif not url.startswith('https://'):
                warn('sources', '%r is not https' % item.get('title', '?')[:60])
            if url in seen and seen[url] != item.get('title'):
                warn('sources', 'two different titles share one url: %s' % url[:80])
            seen[url] = item.get('title')
    note('sources: %d entries across %d groups' % (total, len(blob.get('groups', []))))


# -------------------------------------------------------------- staleness


def check_staleness(files):
    """The dashboard must not quote a version of the report that no longer exists."""
    built = DATA / 'report.json'
    if not MARKDOWN.exists() or not built.exists():
        fail('staleness', 'report-final.md or data/report.json is missing')
        return
    if MARKDOWN.stat().st_mtime > built.stat().st_mtime:
        fail('staleness', 'report-final.md is newer than data/report.json; run build.py')
    # build.py counts the words it actually rendered into blocks, so it sits a
    # few per cent under a raw split of the markdown, which still holds the
    # headings and the syntax. Only a wide gap means a rebuild was skipped.
    words = int(files.get('report', {}).get('stats', {}).get('words', 0))
    actual = len(MARKDOWN.read_text().split())
    if words and abs(words - actual) / actual > 0.10:
        warn('staleness', 'report.json counts %s words against %s in the markdown; check build.py ran'
             % (f'{words:,}', f'{actual:,}'))
    note('staleness: report.json holds %s words against %s in the markdown, built %s'
         % (f'{words:,}', f'{actual:,}',
            dt.datetime.fromtimestamp(built.stat().st_mtime).strftime('%d %b %H:%M')))


def check_figures_against_markdown(files):
    """Warn where a curated figure cannot be found verbatim in the report."""
    if not MARKDOWN.exists():
        return
    text = MARKDOWN.read_text()
    plain = text.replace(',', '')
    checked = found = 0
    for where, node, _ in walk(files.get('figures', {}), 'figures'):
        value = node.get('value')
        if not isinstance(value, (int, float)) or isinstance(value, bool) or abs(value) < 100:
            continue
        checked += 1
        needle = str(int(value))
        if needle in plain or f'{int(value):,}' in text:
            found += 1
        else:
            warn('markdown', '%s = %s is not stated verbatim in report-final.md'
                 % (node.get('label') or where, f'{int(value):,}'))
    note('figures against markdown: %d of %d located verbatim' % (found, checked))


# ------------------------------------------------------------ the wiring


def check_chart_wiring():
    """A chapter that names a chart the registry does not hold renders an empty card."""
    charts = (HERE / 'js' / 'charts.js').read_text()
    views = (HERE / 'js' / 'views.js').read_text()
    registered = set(re.findall(r"R\['([a-z0-9-]+)'\]\s*=", charts))
    used = set(re.findall(r"chartCard\('([a-z0-9-]+)'", views))
    for name in sorted(used - registered):
        fail('wiring', 'a view draws chart %r, which the registry does not define' % name)
    note('wiring: %d charts registered, %d drawn, %d registered but unused'
         % (len(registered), len(used), len(registered - used)))


def check_cache_bust():
    """One stale asset URL serves last week's JavaScript to every returning reader."""
    index = (HERE / 'index.html').read_text()
    versions = set(re.findall(r'\?v=(\d+)', index))
    if len(versions) > 1:
        fail('cache', 'index.html carries mixed cache-bust versions: %s' % ', '.join(sorted(versions)))
    for path in (HERE / 'js').glob('*.js'):
        for other in set(re.findall(r'\?v=(\d+)', path.read_text())):
            if versions and other not in versions:
                fail('cache', '%s asks for ?v=%s while index.html serves ?v=%s'
                     % (path.name, other, ', '.join(versions)))
    note('cache-bust: ?v=%s' % ', '.join(sorted(versions)) if versions else 'cache-bust: none found')


def check_canonical(host='palestinerecord.github.io'):
    """Canonical, og:url and JSON-LD all advertise the site's own address."""
    index = (HERE / 'index.html').read_text()
    strays = {m for m in re.findall(r'https://([a-z0-9.-]+\.github\.io)', index) if m != host}
    for stray in sorted(strays):
        fail('canonical', 'index.html still advertises %s' % stray)
    sitemap = HERE / 'sitemap.xml'
    if sitemap.exists():
        urls = re.findall(r'<loc>([^<]+)</loc>', sitemap.read_text())
        wrong = [u for u in urls if host not in u]
        for url in wrong[:5]:
            fail('canonical', 'sitemap.xml lists %s' % url)
        note('canonical: %d sitemap urls, host %s' % (len(urls), host))


# ----------------------------------------------------------------- report


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--quiet', action='store_true', help='print only failures and the verdict')
    parser.add_argument('--warnings', action='store_true', help='print the full warning list')
    parser.add_argument('--host', default='palestinerecord.github.io', help='the host the site is published at')
    args = parser.parse_args()

    files = load_all()
    if not FAILURES:
        check_staleness(files)
        check_references(files)
        check_attribution(files)
        check_timeseries(files)
        check_headline_agreement(files)
        check_declared_totals(files)
        check_recognition_count(files)
        check_map_joins(files)
        check_chronology(files)
        check_statements(files)
        check_sources(files)
        check_figures_against_markdown(files)
        check_chart_wiring()
        check_cache_bust()
        check_canonical(args.host)

    if not args.quiet:
        for line in NOTES:
            print('  ' + line)
        print()
    if WARNINGS and (args.warnings or not args.quiet):
        shown = WARNINGS if args.warnings else WARNINGS[:8]
        for check, message in shown:
            print('  warning [%s] %s' % (check, message))
        if len(WARNINGS) > len(shown):
            print('  ... and %d more warnings (--warnings for all)' % (len(WARNINGS) - len(shown)))
        print()
    for check, message in FAILURES:
        print('  FAIL [%s] %s' % (check, message))

    print('validate: %d failures, %d warnings' % (len(FAILURES), len(WARNINGS)))
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())
