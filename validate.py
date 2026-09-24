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
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / 'data'


def _find_markdown():
    """The report lives in the private `hb` repository; this site is its own
    repository, reached from `hb` through a symlink. Resolving this file
    therefore lands in the site repository, where report-final.md is not, so
    look for it rather than assuming it is one level up. Returning a path that
    does not exist would silently turn off every check that reads it.
    """
    import os
    override = os.environ.get('REPORT_SOURCE')
    if override:
        return pathlib.Path(override)
    for base in (HERE, *HERE.parents):
        for candidate in (base / 'report-final.md',
                          base / 'reports' / 'israel-palestine' / 'report-final.md'):
            if candidate.exists():
                return candidate
    return HERE.parent / 'report-final.md'


MARKDOWN = _find_markdown()
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


def _sum_paths(series, path):
    """A figure may be the sum of several series - a toll across two territories."""
    parts = [_series_value(series, one) for one in path]
    return None if any(part is None for part in parts) else sum(parts)


def _walk_series(root, path):
    """Follow a dotted path and return the figure at the end of it, or None."""
    node = root
    for key in path.split('.'):
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    if isinstance(node, dict) and isinstance(node.get('values'), list) and node['values']:
        # A cumulative series states its figure at its last month.
        node = node['values'][-1]
    return node if isinstance(node, (int, float)) and not isinstance(node, bool) else None


def _series_value(series, path):
    """Read the figure a curated entry names out of timeseries.json.

    Two shapes are addressable. A path into the summary block names a scalar,
    as `killed.total` does. A path into one of the territory blocks names a
    whole series, as `west_bank.cumulative_killed` does, and the figure is its
    latest month, which is what a cumulative series is stating.
    """
    if isinstance(path, list):
        return _sum_paths(series, path)
    value = _walk_series(series.get('summary') or {}, path)
    return value if value is not None else _walk_series(series, path)


def check_headline_agreement(files):
    """The curated live figures and the live series are two copies of one count.

    A curated figure that is a copy of something in the daily feed says so, by
    naming the series it tracks; sync_live.py carries the feed across and this
    is the check that it did. Figures kept in more than one curated file are
    all checked, because a copy is a copy wherever it is kept.
    """
    ts = files.get('timeseries')
    curated = [(name, files.get(name)) for name in ('figures', 'long-record')]
    if not ts or not all(blob for _, blob in curated):
        return
    checked = unbacked = 0
    for name, blob in curated:
        for where, node, _ in walk(blob, name):
            # Almost every curated figure keeps its number in `value`; a row
            # stating two sides of a comparison keeps each side in its own
            # field and says which of them the series it names is.
            field = node.get('series_field') or 'value'
            if not node.get('live') or not isinstance(node.get(field), (int, float)):
                continue
            label = node.get('label') or where
            path = node.get('series')
            if not path:
                # A live figure the feed does not publish at all. There are
                # none at present; the field is kept so that a figure can be
                # marked as moving without a series to move it.
                unbacked += 1
                continue
            expected = _series_value(ts, path)
            if expected is None:
                fail('agreement', '"%s" names series %r, which timeseries.json does not hold'
                     % (label, path))
                continue
            checked += 1
            if int(node[field]) != int(expected):
                fail('agreement', '"%s" is %s in %s.json but %s in the live series'
                     % (label, f'{node[field]:,}', name, f'{int(expected):,}'))
            else:
                note('agreement: %s = %s in both' % (label, f'{node[field]:,}'))
            # A note that quotes a second live figure - the children inside a
            # West Bank toll - names the series it quotes, so the sentence
            # beside the number is held to the same standard as the number.
            if node.get('note_series'):
                inner = _series_value(ts, node['note_series'])
                if inner is None:
                    fail('agreement', '"%s" names note series %r, which timeseries.json does not hold'
                         % (label, node['note_series']))
                elif f'{int(inner):,}' not in (node.get('note') or ''):
                    fail('agreement', 'the note on "%s" does not state the %s the series gives'
                         % (label, f'{int(inner):,}'))
    note('agreement: %d live figures checked against the series, %d with no series to check'
         % (checked, unbacked))


def check_live_copies(files):
    """Every second copy of a live figure has to be the same figure.

    figures.json holds the curated copy of the series; headline.json is a copy
    of figures.json, written by manifest.py so that the first screen can be
    painted from two kilobytes. The nightly refresh moves all of them together:
    it pulls the feed, runs sync_live.py to carry the new values into the
    curated files, and rebuilds everything derived from them. A copy left
    behind would put one number on the first screen and a different one on the
    page below it, so the copies are compared here rather than trusted.
    """
    figures, headline = files.get('figures'), files.get('headline')
    if not figures or not headline:
        fail('copies', 'figures.json or headline.json is missing')
        return
    curated = {row.get('label'): row.get('value') for row in figures.get('headline', [])}
    copied = headline.get('headline', [])
    for row in copied:
        label = row.get('label')
        if label not in curated:
            fail('copies', 'headline.json carries "%s", which figures.json does not' % label)
        elif curated[label] != row.get('value'):
            fail('copies', '"%s" is %s in headline.json but %s in figures.json - run manifest.py'
                 % (label, row.get('value'), curated[label]))
    if len(copied) != len(curated):
        fail('copies', 'headline.json carries %d headline figures against %d in figures.json'
             % (len(copied), len(curated)))
    note('copies: %d headline figures agree between figures.json and headline.json' % len(curated))

    # The refresh is only safe if the workflow syncs before it validates. A
    # series pulled fresh and then checked against a copy nobody updated is
    # exactly the failure this check exists to stop recurring, and it is a
    # failure of the workflow rather than of the data, so it is caught here.
    workflow = HERE / '.github' / 'workflows' / 'dashboard.yml'
    if not workflow.exists():
        return
    text = workflow.read_text()
    if 'sync_live.py' not in text:
        fail('copies', 'the refresh workflow never runs sync_live.py, so the first advance '
                       'of the series will fail the nightly run')
    elif 'python3 validate.py' in text and text.index('sync_live.py') > text.index('python3 validate.py'):
        fail('copies', 'the refresh workflow validates the data before it syncs the curated copies')


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


def check_patterns(files):
    """The answer engine can only be as honest as its phrase list.

    Three things have to hold. Every entry must point at a rebuttal the report
    actually contains, or the route offers an answer that does not exist. Every
    figure and every statement category it names must resolve, or a reply is
    assembled with a hole in it. And no phrase may be claimed by two entries,
    because the ranking is a count of matched phrases: a phrase in two lists
    would silently weight both, and the reader would have no way to see why.
    """
    blob = files.get('claim-patterns')
    if not blob:
        fail('patterns', 'data/claim-patterns.json is missing; run patterns.py')
        return
    report = files.get('report')
    statements = files.get('statements')
    views = (HERE / 'js' / 'views.js').read_text()

    numbers = set()
    if report:
        for part in report.get('parts', []):
            if 'REBUTTAL' in part.get('title', '').upper():
                for section in part.get('sections', []):
                    m = re.match(r'Rebuttal\s+(\d+)\s*:', section.get('title', ''))
                    if m:
                        numbers.add(int(m.group(1)))

    cats = {c['id'] for c in (statements or {}).get('categories', [])}
    figure_ids = set(blob['meta'].get('figure_ids', []))
    for fid in sorted(figure_ids):
        if ("'%s':" % fid) not in views and ('%s:' % fid) not in views:
            fail('patterns', 'the figure id %r is declared in the data but views.js does not resolve it' % fid)

    seen = {}
    for entry in blob.get('claims', []):
        n = entry.get('rebuttal')
        if numbers and n not in numbers:
            fail('patterns', 'entry %r answers rebuttal %s, which the report does not contain' % (entry.get('label'), n))
        if not entry.get('phrases'):
            fail('patterns', 'rebuttal %s has no phrases, so nothing can ever match it' % n)
        for phrase in entry.get('phrases', []):
            if phrase != phrase.lower().strip():
                fail('patterns', 'the phrase %r is not normalised; matching is done in lower case' % phrase)
            if phrase in seen:
                fail('patterns', 'the phrase %r is claimed by rebuttals %s and %s' % (phrase, seen[phrase], n))
            seen[phrase] = n
        for strong in entry.get('strong', []):
            if strong not in entry.get('phrases', []):
                fail('patterns', 'rebuttal %s marks %r as strong but does not list it as a phrase' % (n, strong))
        for fid in entry.get('figures', []):
            if fid not in figure_ids:
                fail('patterns', 'rebuttal %s names the figure %r, which is not declared' % (n, fid))
        for cat in entry.get('statement_cats', []):
            if cats and cat not in cats:
                fail('patterns', 'rebuttal %s names the statement category %r, which does not exist' % (n, cat))

    if numbers and len(blob.get('claims', [])) != len(numbers):
        warn('patterns', '%d rebuttals in the report, %d with patterns — the rest can only be reached by hand'
             % (len(numbers), len(blob.get('claims', []))))
    if 'answer' not in (HERE / 'js' / 'app.js').read_text():
        fail('patterns', 'the answer route has no behaviour, so the paste box does nothing')

    note('patterns: %d claims, %d phrases, %d rebuttals in the report'
         % (len(blob.get('claims', [])), len(seen), len(numbers)))


def check_entities(files):
    """The ledger names people, so it is held to the strictest joins in the file.

    Nothing the #/ledger route states originates there. The offices and the
    quotes are statements.json read by index, the sections are report.json, the
    measures are world-positions.json, and the arrest map is the Rome Statute
    party list. Every one of those joins is checked here, and the file is
    rebuilt first, because the failure that would matter most — a quotation or
    a sanction attached to the wrong person — is the one thing a reader cannot
    see on the page. The map is checked too: a state party that does not
    resolve to a polygon drops out of the obligation the map exists to show,
    and it does so in silence.
    """
    blob = files.get('entities')
    if not blob:
        fail('entities', 'data/entities.json is missing; run entities.py')
        return

    try:
        sys.path.insert(0, str(HERE))
        import entities as entities_module
        fresh = entities_module.build()
    except Exception as err:  # the rebuild is the check; it cannot be skipped
        fail('entities', 'entities.py would not rebuild: %s' % err)
        return

    for key in ('persons', 'companies', 'warrants', 'sanctioned', 'parties'):
        if blob['meta'].get(key) != fresh['meta'].get(key):
            fail('entities', 'data/entities.json states %s %s; a rebuild gives %s — run entities.py'
                 % (blob['meta'].get(key), key, fresh['meta'].get(key)))

    classes = {c['id'] for c in blob.get('classes', [])}
    ids = [p['id'] for p in blob.get('persons', [])]
    if len(set(ids)) != len(ids):
        fail('entities', 'two persons share one identifier, so a link to a page is ambiguous')
    company_ids = [c['id'] for c in blob.get('companies', [])]
    if len(set(company_ids)) != len(company_ids):
        fail('entities', 'two companies share one identifier')

    statements = (files.get('statements') or {}).get('items', [])
    report = files.get('report') or {}
    sections = {s.get('id') for part in report.get('parts', []) for s in part.get('sections', [])}
    world = files.get('geo/world') or {}
    polygons = {f['properties'].get('name') for f in world.get('features', [])}
    alias = (files.get('world-positions') or {}).get('alias', {})
    resolved = lambda name: alias.get(name, name) in polygons        # noqa: E731 - one line, one use

    quoted = 0
    for person in blob.get('persons', []):
        if person.get('class') not in classes:
            fail('entities', '%s is classified %r, which is not one of the classes on the page'
                 % (person['id'], person.get('class')))
        if not person.get('name') or not person.get('role'):
            fail('entities', '%s has no name or no role, so the page would state an office it cannot source' % person['id'])
        for index in person.get('statements', []):
            if not isinstance(index, int) or not 0 <= index < len(statements):
                fail('entities', '%s cites statement %r, which is not an entry in statements.json' % (person['id'], index))
                continue
            quoted += 1
            speaker = statements[index].get('speaker', '')
            if entities_module.slug(speaker) != person['id']:
                # The page shows this quotation under this person's name. If the
                # index moved, it would show one person's words under another's.
                fail('entities', '%s cites statement %d, which is spoken by %r' % (person['id'], index, speaker))
        for mention in person.get('mentions', []):
            if sections and mention.get('id') not in sections:
                fail('entities', '%s is said to be named in %r, which is not a section of the report'
                     % (person['id'], mention.get('id')))
        warrant = person.get('warrant')
        if warrant and not (warrant.get('court') and warrant.get('date') and warrant.get('status')):
            fail('entities', 'the warrant recorded against %s does not name a court, a date and a status' % person['id'])
        for measure in person.get('sanctions', []):
            if measure.get('direction') not in ('conduct', 'accountability'):
                fail('entities', 'the measure %r against %s is neither conduct nor accountability'
                     % (measure.get('id'), person['id']))
            for state in measure.get('by', []):
                if not resolved(state):
                    fail('entities', '%s is recorded as sanctioning %s but does not resolve to a polygon'
                         % (state, person['id']))

    for company in blob.get('companies', []):
        if not company.get('supplies'):
            fail('entities', '%s is listed with nothing said about what it supplies' % company['id'])
        if not company.get('ref') and not company.get('source'):
            # Everything else on the page carries a section of the report. A
            # company that carries neither a section nor a named source would be
            # the one entry the reader has to take on trust.
            fail('entities', '%s carries neither a report section nor a named source' % company['id'])
        for mention in company.get('mentions', []):
            if sections and mention.get('id') not in sections:
                fail('entities', '%s is said to be named in %r, which is not a section of the report'
                     % (company['id'], mention.get('id')))

    icc = blob.get('icc', {})
    parties = icc.get('parties', [])
    names = [p['name'] for p in parties]
    if len(set(names)) != len(names):
        fail('entities', 'the states parties list repeats a state, so the count on the page is wrong')
    if len(parties) != blob['meta'].get('parties'):
        fail('entities', 'the ledger states %s states parties and lists %d' % (blob['meta'].get('parties'), len(parties)))
    for party in parties:
        # A party with no polygon is recorded as such deliberately; a party whose
        # polygon name is wrong would vanish from the map without saying so.
        if party.get('map') and not resolved(party['map']):
            fail('entities', 'the state party %s does not resolve to a polygon in the world geometry' % party['name'])
    for leaving in icc.get('leaving', []):
        if leaving['name'] not in names:
            fail('entities', '%s is recorded as withdrawing but is not on the party list; under Article 127(1) '
                 'it is bound until %s' % (leaving['name'], leaving.get('effective')))
    for position in icc.get('positions', []):
        if position.get('stance') not in ('would-enforce', 'refused', 'non-party', 'other'):
            fail('entities', '%s is given the stance %r, which the map has no shading for'
                 % (position.get('name'), position.get('stance')))
        if position.get('map') and not resolved(position['map']):
            fail('entities', 'the stated position of %s does not resolve to a polygon' % position['name'])
        on_list = position['name'] in names
        if position.get('stance') == 'non-party' and on_list:
            fail('entities', '%s is shown as a non-party but is on the states parties list' % position['name'])
        if position.get('stance') in ('would-enforce', 'refused') and not on_list:
            # Those two stances are statements about the Article 86 obligation,
            # which only a party carries. A non-party saying either is saying
            # something else, and belongs under the stance that claims less.
            fail('entities', '%s is shown as having %s the warrant but is not a state party'
                 % (position['name'], 'undertaken to enforce' if position['stance'] == 'would-enforce' else 'refused'))

    if "'ledger'" not in (HERE / 'js' / 'app.js').read_text():
        fail('entities', 'the ledger route is not registered in app.js, so the page cannot be reached')
    if 'arrest-map' not in (HERE / 'js' / 'charts.js').read_text():
        fail('entities', 'the arrest map is not registered, so the route would draw an empty container')

    note('entities: %d persons, %d companies, %d quotations by index, %d states parties, %d stated positions'
         % (len(ids), len(company_ids), quoted, len(parties), len(icc.get('positions', []))))


def check_constituency(files):
    """The constituency ledger says how a named person voted, so it is checked hardest.

    Everything else on this site is a claim about a state. This file is a claim
    about 649 living people, each of whom is entitled to have it be right, and
    each of whom can be written to on the strength of it. A wrong vote here is
    not a rendering fault; it is a letter to a member accusing them of something
    they did not do.

    So: the three divisions are checked against the published counts that
    identify them, a vote is checked to be one of the six things a vote can be,
    every member who is recorded as having voted is checked to have been in the
    House at the time, the seat map is checked to resolve to a real member
    because the postcode lookup joins through it, and the money is checked to
    add up. The search terms are checked to be present and to compile, because
    the page prints them as the statement of what the ledger cannot see.
    """
    blob = files.get('constituency')
    if not blob:
        fail('constituency', 'data/constituency.json is missing; run constituency.py')
        return

    meta = blob.get('meta', {})
    members = blob.get('members', [])
    divisions = blob.get('divisions', [])
    seats = blob.get('seats', {})
    parties = blob.get('parties', [])

    if len(members) != meta.get('members'):
        fail('constituency', 'the file states %s members and carries %d'
             % (meta.get('members'), len(members)))

    # A vote is one of seven things. Anything else would render as a badge with
    # no meaning, and would silently be counted as neither for nor against. The
    # seventh is a member who told for the side they opposed so that a vote
    # could be held at all, and it may only appear where the division names them.
    casts = {'aye', 'no', 'aye-teller', 'no-teller', 'absent', 'not-a-member', 'forced-teller'}
    ids = {str(d['id']) for d in divisions}

    if not divisions:
        fail('constituency', 'the ledger carries no divisions, so every member row is empty')
    for d in divisions:
        for key in ('date', 'title', 'short', 'in_sentence', 'formal', 'moved', 'question',
                    'aye_means', 'no_means', 'result', 'ayes', 'noes', 'note', 'source', 'plain',
                    'pro_reason'):
            if not str(d.get(key, '')).strip():
                fail('constituency', 'division %s carries no %s, and the page states each of them'
                     % (d.get('id'), key))
        if not str(d.get('source', '')).startswith('http'):
            fail('constituency', 'division %s does not link to its own division list' % d.get('id'))
        if d.get('pro_side') not in ('aye', 'no', None):
            fail('constituency', 'division %s names "%s" as its pro-Palestinian side, which is not a side'
                 % (d.get('id'), d.get('pro_side')))
        # The published counts are what identify the division, since the House
        # titles it by procedural form and the title is curated here.
        cast = [m['votes'].get(str(d['id'])) for m in members]
        recorded = sum(1 for c in cast if c in ('aye', 'no', 'aye-teller', 'no-teller'))
        sat = sum(1 for c in cast if c != 'not-a-member')
        if sat != d.get('sitting'):
            fail('constituency', 'division %s states %s members sat in it; %d members carry a vote '
                                 'other than not-a-member' % (d.get('id'), d.get('sitting'), sat))
        still = d.get('still_here', {})
        for key in ('aye', 'no', 'absent'):
            want = sum(1 for c in cast if (c or '').replace('-teller', '') == key)
            if still.get(key) != want:
                fail('constituency', 'division %s states %s members still sitting voted %s; the rows give %d'
                     % (d.get('id'), still.get(key), key, want))
        if recorded > d['ayes'] + d['noes']:
            fail('constituency', 'division %s records %d votes among sitting members but was published '
                                 'as %d to %d in total' % (d.get('id'), recorded, d['ayes'], d['noes']))

    slugs = set()
    for m in members:
        if not m.get('name') or not m.get('seat'):
            fail('constituency', 'a member row carries no name or no seat')
            continue
        if m.get('slug') in slugs:
            fail('constituency', 'two members share the slug %s, so the postcode lookup would open '
                                 'the wrong row' % m.get('slug'))
        slugs.add(m.get('slug'))
        if set(m.get('votes', {})) != ids:
            fail('constituency', '%s does not carry a vote for every division; the page renders one '
                                 'badge per division and would leave a gap' % m['name'])
        for did, cast in m.get('votes', {}).items():
            if cast not in casts:
                fail('constituency', '%s is recorded as "%s" in division %s, which is not a vote'
                     % (m['name'], cast, did))
            if cast == 'forced-teller':
                named = next((d.get('procedural_tellers') or {} for d in divisions if str(d['id']) == did), {})
                if str(m.get('id')) not in named:
                    fail('constituency', '%s is shown as having told for the other side in division %s, '
                                         'which names no such teller' % (m['name'], did))
        # `since` is the start of the member's current unbroken service, so a
        # member sitting continuously since before a division must appear in
        # that division's list, as an aye, a no or a no-vote-recorded. The
        # converse does not hold: a `since` later than the division is also
        # what a member who served, left and returned by by-election looks
        # like, and at least one member of this House is exactly that.
        for d in divisions:
            cast = m['votes'].get(str(d['id']))
            if cast == 'not-a-member' and m.get('since') and m['since'] <= d['date']:
                fail('constituency', '%s has sat without a break since %s but is recorded as not a '
                                     'member in the division of %s' % (m['name'], m['since'], d['date']))
        # The pro-Palestinian tally is shown on every row and drives a filter,
        # so it is recomputed here from the votes rather than trusted.
        pro = against = 0
        for d in divisions:
            side = d.get('pro_side')
            cast = m['votes'].get(str(d['id']))
            if not side or cast in ('absent', 'not-a-member', None):
                continue
            took = side if cast == 'forced-teller' else cast.replace('-teller', '')
            if took == side:
                pro += 1
            else:
                against += 1
        if m.get('record') != [pro, against]:
            fail('constituency', '%s carries the tally %s but the votes give %s'
                 % (m['name'], m.get('record'), [pro, against]))
        # The bar under the name, recomputed the same way: the counted votes
        # plus the counted motions signed, out of chances that cannot be fewer
        # than the divisions sat for and the motions signed.
        motions = blob.get('motions', [])
        signed = m.get('signed', [])
        if any(not isinstance(i, int) or not 0 <= i < len(motions) for i in signed):
            fail('constituency', '%s carries a signed motion index outside the list' % m['name'])
        else:
            s_pro = sum(1 for i in signed if motions[i]['side'] == 'pro')
            sat = sum(1 for d in divisions if d.get('pro_side')
                      and m['votes'].get(str(d['id'])) != 'not-a-member')
            lean = m.get('lean') or [None, None, None]
            if lean[:2] != [pro + s_pro, against + len(signed) - s_pro]:
                fail('constituency', '%s carries the bar %s but the votes and motions give %s'
                     % (m['name'], lean[:2], [pro + s_pro, against + len(signed) - s_pro]))
            if not isinstance(lean[2], int) or lean[2] < sat + len(signed) or lean[2] > sat + len(motions):
                fail('constituency', '%s has %s chances, outside %d to %d'
                     % (m['name'], lean[2], sat + len(signed), sat + len(motions)))
        # The score, recomputed from its published weights and parts.
        sc = meta.get('score') or {}
        score = m.get('score')
        if not (isinstance(score, list) and len(score) == 5):
            fail('constituency', '%s carries no score' % m['name'])
        else:
            vw = sc.get('vote_weights', {})
            vp = vmax = 0
            for d in divisions:
                key = str(d['id'])
                cast = m['votes'].get(key)
                if key not in vw or cast == 'not-a-member':
                    continue
                vmax += vw[key]
                if cast in ('absent', None):
                    continue
                took = d.get('pro_side') if cast == 'forced-teller' else cast.replace('-teller', '')
                vp += vw[key] if took == d.get('pro_side') else -vw[key]
            if score[1] != vp:
                fail('constituency', '%s carries %s vote points but the votes give %s' % (m['name'], score[1], vp))
            wp = (sc.get('word_points') or {}).get((m.get('genocide') or {}).get('stance'), 0)
            if score[3] != wp:
                fail('constituency', '%s carries %s word points but the stance gives %s' % (m['name'], score[3], wp))
            credit = m.get('motion_credit') or [0, 0, 0, 0]
            against = sum(1 for i in m.get('signed', []) if 0 <= i < len(motions) and motions[i]['side'] == 'against')
            mp = (sc.get('motion_points', 0) * min(1.0, credit[0] / credit[1]) if credit[1] else 0) \
                - sc.get('against_motion', 0) * against
            if abs(score[2] - mp) > 0.6:
                fail('constituency', '%s carries %s motion points but the credit gives %.1f' % (m['name'], score[2], mp))
            if abs(score[0] - (score[1] + score[2] + score[3])) > 0.11:
                fail('constituency', '%s has a score of %s that is not the sum of its parts' % (m['name'], score[0]))
            most = vmax + (sc.get('motion_points', 0) if credit[1] else 0) + (sc.get('word_points') or {}).get('says', 0)
            if score[4] != most:
                fail('constituency', '%s has a possible score of %s, not %s' % (m['name'], score[4], most))
            g = m.get('genocide')
            if g and not (g.get('quote') and (g.get('url') or '').startswith('https://hansard.parliament.uk/')):
                fail('constituency', '%s has a genocide statement with no quotation or Hansard link' % m['name'])
        for i in m.get('interests', []):
            if not (i.get('summary') or '').strip():
                fail('constituency', 'an interest against %s carries no summary' % m['name'])
        for g in m.get('donations', []):
            if not g.get('ref'):
                fail('constituency', 'a donation to %s carries no Electoral Commission reference, so '
                                     'it cannot be looked up' % m['name'])
            if not isinstance(g.get('value'), (int, float)) or g['value'] <= 0:
                fail('constituency', 'a donation to %s carries no value' % m['name'])

    # The early day motions behind the bar. Each is a link a reader can follow
    # to the list of who signed it, and the signatures the page counts against
    # members cannot exceed the motion's own total.
    motions = blob.get('motions', [])
    if meta.get('motions') != len(motions):
        fail('constituency', 'the file states %s motions and carries %d' % (meta.get('motions'), len(motions)))
    counted_sigs = {}
    for m in members:
        for i in m.get('signed', []):
            if isinstance(i, int) and 0 <= i < len(motions):
                counted_sigs[i] = counted_sigs.get(i, 0) + 1
    for i, x in enumerate(motions):
        if x.get('side') not in ('pro', 'against'):
            fail('constituency', 'motion %s has no side' % x.get('id'))
        if x.get('url') != 'https://edm.parliament.uk/early-day-motion/%s' % x.get('id'):
            fail('constituency', 'motion %s does not link to its own page' % x.get('id'))
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', x.get('date') or '') or x['date'] < '2023-10-07':
            fail('constituency', 'motion %s carries the date %r' % (x.get('id'), x.get('date')))
        if counted_sigs.get(i, 0) > (x.get('signatures') or 0):
            fail('constituency', 'motion %s is signed by %d sitting members but has %s signatures'
                 % (x.get('id'), counted_sigs.get(i, 0), x.get('signatures')))
    # Locally, where the raw fetch is present, every motion the search found
    # must have been read and placed, so that a new one is not silently dropped.
    raw_motions = DATA / 'raw' / 'uk_motions.json'
    if raw_motions.exists():
        sys.path.insert(0, str(HERE))
        import constituency as ledger
        placed = ledger.MOTIONS_PRO | ledger.MOTIONS_AGAINST | set().union(*ledger.MOTIONS_NOT_COUNTED.values())
        unread = [x['id'] for x in json.loads(raw_motions.read_text()) if x['id'] not in placed]
        if unread:
            warn('constituency', '%d early day motions on the subject are not yet placed on a side in '
                                 'constituency.py: %s' % (len(unread), ', '.join(map(str, unread[:10]))))

    # The petitions. A seat's count is a number the page puts beside a named
    # member, so the counts for a petition must not add up to more than the
    # petition's own total, and the ranks must be a clean one to n.
    petitions = blob.get('petitions', [])
    topics = {'recognition', 'arms', 'sanctions', 'ceasefire', 'humanitarian', 'accountability', 'other'}
    if meta.get('petitions') != len(petitions):
        fail('constituency', 'the file states %s petitions and carries %d' % (meta.get('petitions'), len(petitions)))
    for pet in petitions:
        pid = str(pet.get('id'))
        if not str(pet.get('url', '')).startswith('https://petition.parliament.uk/'):
            fail('constituency', 'petition %s does not link to the petitions site' % pid)
        if not pet.get('action') or not pet.get('signatures'):
            fail('constituency', 'petition %s carries no request or no signature count' % pid)
        if pet.get('topic') not in topics:
            fail('constituency', 'petition %s has the topic "%s", which the page has no filter for'
                 % (pid, pet.get('topic')))
        if pet.get('by_seat'):
            counts = [m['signatures'][pid] for m in members if pid in (m.get('signatures') or {})]
            if sum(n for n, _r in counts) > pet['signatures']:
                fail('constituency', 'petition %s has more signatures by seat (%d) than in all (%d)'
                     % (pid, sum(n for n, _r in counts), pet['signatures']))
            if sorted(r for _n, r in counts) != list(range(1, len(counts) + 1)):
                fail('constituency', 'petition %s ranks its seats with gaps or repeats' % pid)
            if len(counts) != pet.get('seats'):
                fail('constituency', 'petition %s states %s seats and %d rows carry it'
                     % (pid, pet.get('seats'), len(counts)))
        elif any(pid in (m.get('signatures') or {}) for m in members):
            fail('constituency', 'petition %s is counted against seats but is not marked as joinable, '
                                 'so a count on old boundaries may be shown against a new seat' % pid)

    # The debates and the words. Every quotation is a named member's words, so
    # each must point at a debate that exists, and the count on the row must
    # be the number of debates the reader will find when they open it.
    debates = blob.get('debates', [])
    speeches = (files.get('constituency-speeches') or {}).get('by_member')
    if meta.get('debates') != len(debates):
        fail('constituency', 'the file states %s debates and carries %d' % (meta.get('debates'), len(debates)))
    for d in debates:
        if not str(d.get('url', '')).startswith('https://hansard.parliament.uk/'):
            fail('constituency', 'the debate of %s does not link to Hansard' % d.get('date'))
    if speeches is None:
        fail('constituency', 'data/constituency-speeches.json is missing, so every "what they said" block '
                             'would load nothing')
    else:
        ids = {str(m['id']): m for m in members}
        for mid, entries in speeches.items():
            m = ids.get(mid)
            if not m:
                fail('constituency', 'the speeches file quotes member %s, who holds no seat in the ledger' % mid)
                continue
            if m.get('spoke') != len(entries):
                fail('constituency', '%s is shown as speaking in %s debates and %d are quoted'
                     % (m['name'], m.get('spoke'), len(entries)))
            for index, n, words in entries:
                if not 0 <= index < len(debates):
                    fail('constituency', 'a quotation of %s points at debate %s, which is not in the file'
                         % (m['name'], index))
                if not words.strip() or n < 1:
                    fail('constituency', 'an empty quotation is recorded against %s' % m['name'])
        spoke = sum(1 for m in members if m.get('spoke'))
        if spoke != len(speeches) or spoke != meta.get('members_who_spoke'):
            fail('constituency', '%d rows say the member spoke, %d members are quoted, and the file states %s'
                 % (spoke, len(speeches), meta.get('members_who_spoke')))

    for act in blob.get('recognition', []):
        if not str(act.get('source', '')).startswith('https://'):
            fail('constituency', 'the recognition step of %s carries no source' % act.get('date'))
    for poll in blob.get('polls', []):
        if not poll.get('plain'):
            fail('constituency', 'the %s poll of %s has no plain-language summary'
                 % (poll.get('pollster'), poll.get('published')))
        if not str(poll.get('source', '')).startswith('https://'):
            fail('constituency', 'the %s poll of %s carries no source' % (poll.get('pollster'), poll.get('published')))
        for label, pct in poll.get('findings', []):
            if not isinstance(pct, (int, float)) or not 0 <= pct <= 100:
                fail('constituency', 'the %s poll gives %r for "%s"' % (poll.get('pollster'), pct, label))

    note('constituency: %d petitions, %d debates, %d members quoted, %d polls'
         % (len(petitions), len(debates), len(speeches or {}), len(blob.get('polls', []))))

    # The postcode lookup joins a constituency name to this map and opens the
    # row it points at. An index out of range would open nothing and say nothing.
    if len(seats) != len(members):
        fail('constituency', 'the seat map holds %d entries for %d members' % (len(seats), len(members)))
    for name, index in seats.items():
        if not isinstance(index, int) or not 0 <= index < len(members):
            fail('constituency', 'the seat %s points at member %s, which is not in the file' % (name, index))
        elif members[index]['seat'] != name:
            fail('constituency', 'the seat %s points at the row for %s' % (name, members[index]['seat']))

    with_interest = sum(1 for m in members if m.get('interests'))
    with_donation = sum(1 for m in members if m.get('donations'))
    if with_interest != meta.get('members_with_interest'):
        fail('constituency', 'the file states %s members with a registered interest and carries %d'
             % (meta.get('members_with_interest'), with_interest))
    if with_donation != meta.get('members_with_donation'):
        fail('constituency', 'the file states %s members with a reported donation and carries %d'
             % (meta.get('members_with_donation'), with_donation))

    to_members = sum(len(m.get('donations', [])) for m in members)
    if to_members != meta.get('donations_to_members'):
        fail('constituency', 'the file states %s donations reaching members and carries %d'
             % (meta.get('donations_to_members'), to_members))
    party_total = round(sum(p.get('total', 0) for p in parties), 2)
    if abs(party_total - (meta.get('party_total') or 0)) > 1:
        fail('constituency', 'the party donations total %s but the file states %s'
             % (party_total, meta.get('party_total')))
    for p in parties:
        if round(sum(d['total'] for d in p.get('donors', [])), 2) != round(p.get('total', 0), 2):
            fail('constituency', "the donors listed against %s do not add to its total" % p.get('name'))

    # The page prints these terms as the statement of what the ledger cannot
    # see. A term that does not compile would silently match nothing.
    for key in ('register_terms', 'donation_terms'):
        pattern = meta.get(key)
        if not pattern:
            fail('constituency', 'the file publishes no %s, so the page cannot state what it searched for'
                 % key)
            continue
        try:
            re.compile(pattern)
        except re.error as err:
            fail('constituency', 'the published %s will not compile: %s' % (key, err))
    lookup = str(meta.get('lookup', ''))
    if not lookup.startswith('https://'):
        fail('constituency', 'the postcode lookup is not published as an https endpoint')
    else:
        # The page carries a content security policy, and a policy that does
        # not name this host turns the postcode box into a control that does
        # nothing at all: the fetch is refused by the browser before it is
        # made, and the page reports that the service could not be reached.
        host = 'https://' + lookup.split('/')[2]
        policy = re.search(r'connect-src ([^;]+);', (HERE / 'index.html').read_text())
        if not policy or host not in policy.group(1):
            fail('constituency', "the content security policy does not allow a connection to %s, so "
                                 "the postcode lookup would be refused before it was made" % host)

    app = (HERE / 'js' / 'app.js').read_text()
    views = (HERE / 'js' / 'views.js').read_text()
    if "'constituency', 'data/constituency.json'" not in app:
        fail('constituency', 'app.js does not fetch data/constituency.json, so the route would paint '
                             'a loading line and never leave it')
    if 'behaviours.mp' not in app:
        fail('constituency', 'app.js wires no behaviour for the constituency route, so the postcode '
                             'lookup and the filters would do nothing')
    if 'mp: mpView' not in views:
        fail('constituency', 'views.js does not register the constituency view')
    if 'api.postcodes.io' not in app:
        fail('constituency', 'the postcode lookup is not wired to the published endpoint')
    # No member email address is published here, deliberately: the page offers
    # a letter and a link to the member's own contact page instead.
    for blob_text, label in ((views, 'views.js'), (json.dumps(blob), 'constituency.json')):
        if re.search(r'@parliament\.uk', blob_text):
            fail('constituency', '%s carries a parliament.uk address; this page publishes none' % label)

    note('constituency: %d seats, %d divisions, %d registered interests against %d members, '
         '%d donations reaching %d members, \u00a3%s to parties'
         % (len(members), len(divisions), sum(len(m.get('interests', [])) for m in members),
            with_interest, to_members, with_donation, format(meta.get('party_total') or 0, ',.0f')))


def check_falsification(files):
    """The register is an offer, so the check is that the offer is real.

    An entry that names a source the reader cannot look up, or states a value
    that no longer matches the file it was drawn from, or points at a statement
    index that has since moved, is worse than no entry at all: it invites a
    challenge and then cannot receive one. So the register is rebuilt from the
    provenance graph and compared, every source id is resolved, every statement
    index is checked against statements.json, and the ordering the page relies
    on — weakest first — is checked rather than assumed, because the page says
    in prose that the weakest entries are at the top.
    """
    blob = files.get('falsification')
    if not blob:
        fail('falsify', 'data/falsification.json is missing; run falsify.py')
        return

    try:
        sys.path.insert(0, str(HERE))
        import falsify as falsify_module
        fresh = falsify_module.build()
    except Exception as err:  # the rebuild is the check; it cannot be skipped
        fail('falsify', 'falsify.py would not rebuild: %s' % err)
        return

    for key in ('entries', 'single_origin', 'exposed', 'claims'):
        if blob['meta'].get(key) != fresh['meta'].get(key):
            fail('falsify', 'data/falsification.json states %s for %s; a rebuild gives %s — run falsify.py'
                 % (blob['meta'].get(key), key, fresh['meta'].get(key)))

    entries = blob.get('entries', [])
    sources = blob.get('sources', {})
    kinds = {k['id']: k for k in blob.get('kinds', [])}
    switches = {s['id']: s for s in blob.get('switches', [])}
    origins = {o['id']: o['label'] for o in blob.get('origins', [])}
    statements = files.get('statements', {}).get('items', [])
    prov_claims = {c['id']: c for c in files.get('provenance', {}).get('claims', [])}

    if not kinds:
        fail('falsify', 'the register lists no kinds of claim, so no entry can state its test')
    for kind in kinds.values():
        if not (kind.get('test') or '').strip():
            fail('falsify', 'the %s kind offers no test, so its entries ask the reader for nothing'
                 % kind['id'])

    seen = set()
    counts = {k: 0 for k in kinds}
    for entry in entries:
        eid = entry.get('id')
        if eid in seen:
            fail('falsify', 'two register entries share the identifier %s, so a challenge could not '
                            'name which one it disputes' % eid)
        seen.add(eid)
        if entry.get('kind') not in kinds:
            fail('falsify', '%s is of kind %s, which the register does not define' % (eid, entry.get('kind')))
            continue
        counts[entry['kind']] += 1
        if not (entry.get('claim') or '').strip():
            fail('falsify', '%s states no claim, so there is nothing to falsify' % eid)
        for sid in entry.get('sources', []):
            if sid not in sources:
                fail('falsify', '%s rests on source %s, which the register does not carry' % (eid, sid))
            elif sources[sid].get('origin') not in origins:
                fail('falsify', 'source %s is of class %s, which is not one the register counts'
                     % (sid, sources[sid].get('origin')))
        classes = {sources[sid]['origin'] for sid in entry.get('sources', []) if sid in sources}
        if entry.get('independence') != len(classes):
            fail('falsify', '%s claims %s independent classes of source but its sources fall into %d'
                 % (eid, entry.get('independence'), len(classes)))
        for sid in entry.get('falls', []):
            if sid not in switches:
                fail('falsify', '%s is said to fall under switch %s, which does not exist' % (eid, sid))
            elif classes and not classes.issubset(set(switches[sid]['removes'])):
                # The switch removes classes of source. An entry survives it as
                # long as one of its sources is of a class the switch keeps.
                fail('falsify', '%s is shown as removed by "%s" but rests on a class that switch keeps'
                     % (eid, switches[sid]['label']))
        index = entry.get('statement')
        if index is not None:
            if not (0 <= index < len(statements)):
                fail('falsify', '%s points at statement %s, which is past the end of statements.json'
                     % (eid, index))
            elif not statements[index].get('quote'):
                fail('falsify', '%s points at a statement carrying no quotation' % eid)
        claim = prov_claims.get(eid)
        if claim is None:
            fail('falsify', '%s is in the register but not in the provenance graph, so it was not '
                            'generated from the data' % eid)
        elif 'value' in entry and claim.get('value') != entry['value']:
            fail('falsify', '%s publishes %s but the provenance graph holds %s'
                 % (eid, entry['value'], claim.get('value')))

    for kind, seen_count in counts.items():
        if blob['meta'].get('kinds', {}).get(kind) != seen_count:
            fail('falsify', 'the register states %s %s entries but carries %d'
                 % (blob['meta'].get('kinds', {}).get(kind), kind, seen_count))

    # Weakest first. The page states this in prose beside the register, so it
    # is checked here rather than trusted to the sort in falsify.py.
    order = [(-len(e.get('falls', [])), e.get('independence', 0)) for e in entries]
    if order != sorted(order):
        fail('falsify', 'the register is not ordered weakest first, but the page says it is')

    if "'falsify', 'data/falsification.json'" not in (HERE / 'js' / 'app.js').read_text():
        fail('falsify', 'the register is not fetched at boot, so the method page would not render it')
    views = (HERE / 'js' / 'views.js').read_text()
    if 'registerSection()' not in views:
        fail('falsify', 'the method view does not draw the register')
    if blob['meta'].get('repo', '') not in views and 'F.meta.repo' not in views:
        fail('falsify', 'no challenge route is built, so the register invites a challenge with '
                        'nowhere to file it')

    note('falsify: %d entries, %d resting on one class of source, %d removed by a switch, %d kinds'
         % (len(entries), blob['meta'].get('single_origin', 0),
            blob['meta'].get('exposed', 0), len(kinds)))


def check_provenance(files):
    """The provenance graph has to be a rebuild of the data, not a file beside it.

    Everything the #/provenance route states is read out of this file: the
    claim count, the classification of each source, and the share of the record
    that still stands when a whole class of source is rejected. So the file is
    checked the only way that means anything, by rebuilding it from the curated
    data and comparing: a claim added to any of the scanned files since the last
    run, or a source string that no longer resolves to the entity it did, shows
    up here as a difference rather than as a stale number on the page. The
    switch arithmetic is then recounted independently of provenance.py's own
    loop, because a page that answers the objection "your sources are partial"
    with a figure that is wrong would be worse than not answering it at all.
    """
    blob = files.get('provenance')
    if not blob:
        fail('provenance', 'data/provenance.json is missing; run provenance.py')
        return

    try:
        sys.path.insert(0, str(HERE))
        import provenance as provenance_module
        fresh, _claims = provenance_module.build()
    except Exception as err:  # the rebuild is the check; it cannot be skipped
        fail('provenance', 'provenance.py would not rebuild: %s' % err)
        return

    for key in ('claims', 'attributed', 'sources', 'origins'):
        if blob['summary'].get(key) != fresh['summary'].get(key):
            fail('provenance', 'data/provenance.json states %d %s; a rebuild gives %d — run provenance.py'
                 % (blob['summary'].get(key, -1), key, fresh['summary'].get(key, -1)))

    ids = [c['id'] for c in blob['claims']]
    if len(set(ids)) != len(ids):
        fail('provenance', 'two claims share one identifier, so a link to a chain is ambiguous')

    known = {s['id']: s['origin'] for s in blob['sources']}
    for claim in blob['claims']:
        for sid in claim['sources']:
            if sid not in known:
                fail('provenance', 'claim %r cites source %r, which is not in the source list' % (claim['id'][:50], sid))
                break

    attributed = [c for c in blob['claims'] if c['sources']]
    for switch in blob['switches']:
        removed = set(switch['removes'])
        stands = sum(1 for c in attributed
                     if any(known.get(sid) not in removed for sid in c['sources']))
        if stands != switch['stands']:
            fail('provenance', 'the %s switch states %d claims standing; a recount gives %d'
                 % (switch['id'], switch['stands'], stands))
        if switch['stands'] + switch['falls'] != len(attributed):
            fail('provenance', 'the %s switch accounts for %d claims, not the %d attributed ones'
                 % (switch['id'], switch['stands'] + switch['falls'], len(attributed)))

    weakest = min(blob['switches'], key=lambda s: s['share'])
    note('provenance: %d claims, %d sources, %d classes; weakest setting leaves %s%% standing'
         % (blob['summary']['claims'], blob['summary']['sources'],
            blob['summary']['origins'], weakest['share']))


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
                # Every entry in the library is something a reader can go and
                # check. A print citation with no url is a claim the reader has
                # to take on trust, which is the one thing this record does not
                # ask of anybody: a library record or a digitised text is always
                # findable, so the entry is incomplete until one is named.
                fail('sources', '%r has no url' % item.get('title', '?')[:60])
            elif not url.startswith('https://'):
                warn('sources', '%r is not https' % item.get('title', '?')[:60])
            if url and url in seen and seen[url] != item.get('title'):
                # The CSV export, the deep links and this check all key on the
                # url, so one url cannot stand for two different resources.
                fail('sources', 'two different titles share one url: %s' % url[:80])
            seen[url] = item.get('title')
    note('sources: %d entries across %d groups' % (total, len(blob.get('groups', []))))


# -------------------------------------------------------------- staleness


def check_staleness(files):
    """The dashboard must not quote a version of the report that no longer exists."""
    built = DATA / 'report.json'
    if not built.exists():
        fail('staleness', 'data/report.json is missing')
        return
    if not MARKDOWN.exists():
        # The published repository carries the derived JSON but not the source
        # markdown, which lives with the documents. There is nothing to compare
        # against here, so the check does not apply rather than failing.
        note('staleness: report-final.md is not in this checkout; skipped')
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


def _spellings(value):
    """Every way the report might reasonably write a number.

    The prose rounds large figures - 1,900,000 is written "1.9 million" and
    2,400,000 sometimes "2.4m" - so a literal search alone reports phrasing as
    if it were disagreement.
    """
    value = int(value)
    out = [str(value), f'{value:,}']
    for unit, word in ((1_000_000, 'million'), (1_000, 'thousand')):
        if value >= unit and value % (unit // 100) == 0:
            short = ('%g' % (value / unit))
            out += ['%s %s' % (short, word), '%s%s' % (short, word[0])]
    return out


def check_figures_against_markdown(files):
    """Warn where a curated figure cannot be found in the report at all.

    Live figures are skipped: the report is a dated document and the dashboard
    is not, so a live figure that matched the markdown would mean the feed had
    stopped. check_headline_agreement checks those against timeseries.json.
    """
    if not MARKDOWN.exists():
        return
    text = MARKDOWN.read_text()
    plain = text.replace(',', '')
    checked = found = skipped = 0
    for where, node, _ in walk(files.get('figures', {}), 'figures'):
        value = node.get('value')
        if not isinstance(value, (int, float)) or isinstance(value, bool) or abs(value) < 100:
            continue
        if node.get('live') or node.get('approx'):
            skipped += 1
            continue
        checked += 1
        if any(s in plain or s in text for s in _spellings(value)):
            found += 1
        else:
            warn('markdown', '%s = %s is not stated in report-final.md'
                 % (node.get('label') or where, f'{int(value):,}'))
    note('figures against markdown: %d of %d located, %d live or rounded and skipped'
         % (found, checked, skipped))


# ------------------------------------------------------------ the wiring


def check_day(files):
    """The day route joins five files on one date, so the dates have to hold.

    The aid phases are the only data written for that route, and they are what
    a reader sees when they ask what was crossing on a given day. They must run
    in order, never overlap, leave no hole inside the war, name the section of
    the report each comes from, and never state a daily figure larger than the
    requirement they are measured against. The route itself must also be wired:
    a view that is not in VIEWS is unreachable, and one with no metadata has no
    title and no card when it is shared.
    """
    conduct = files.get('conduct-record')
    series = files.get('timeseries')
    if not conduct or not series:
        fail('day', 'conduct-record.json or timeseries.json is missing')
        return

    aid = conduct.get('aid') or {}
    phases = aid.get('phases') or []
    if not phases:
        fail('day', 'the aid record carries no dated phases, so the day route has nothing to show')
        return

    required = (aid.get('baseline') or {}).get('value')
    dates = series['daily']['gaza']['dates']
    first, last = dates[0], dates[-1]
    markdown = MARKDOWN.read_text() if MARKDOWN.exists() else ''

    previous = None
    for phase in phases:
        start, end = phase.get('from'), phase.get('to')
        if not start:
            fail('day', 'an aid phase has no start date')
            continue
        if end and end < start:
            fail('day', 'the aid phase %s ends on %s, before it begins' % (phase.get('label'), end))
        if previous and start <= previous:
            fail('day', 'the aid phase beginning %s overlaps the one before it' % start)
        if previous and start > _next_day(previous):
            fail('day', 'no aid phase covers the days between %s and %s'
                 % (previous, start))
        previous = end
        for field in ('label', 'detail', 'source', 'ref'):
            if not phase.get(field):
                fail('day', 'the aid phase beginning %s states no %s' % (start, field))
        value = phase.get('value')
        if value is not None:
            if not isinstance(value, (int, float)) or value < 0:
                fail('day', 'the aid phase beginning %s states a daily figure of %r' % (start, value))
            elif required and value > required:
                fail('day', 'the aid phase beginning %s states %s trucks a day against a requirement of %s'
                     % (start, value, required))
        ref = str(phase.get('ref') or '')
        if markdown and ref and not _ref_in_markdown(ref, markdown):
            warn('day', 'the aid phase beginning %s cites %s, which is not in the report' % (start, ref))

    if phases[0]['from'] > first:
        note('day: the aid phases begin on %s, after the series begins on %s; those days show no regime'
             % (phases[0]['from'], first))
    if phases[-1].get('to') is not None and phases[-1]['to'] < last:
        fail('day', 'the last aid phase ends on %s while the series runs to %s'
             % (phases[-1]['to'], last))

    app = (HERE / 'js' / 'app.js').read_text()
    views = (HERE / 'js' / 'views.js').read_text()
    declared = re.search(r'const VIEWS = \[(.*?)\]', app, re.S)
    if not declared or "'day'" not in declared.group(1):
        fail('day', 'the day route is not in the VIEWS list, so nothing can reach it')
    if not re.search(r'^\s+day: \{', views, re.M):
        fail('day', 'the day route has no metadata, so its title and its card are the default ones')
    if 'behaviours.day' not in app:
        fail('day', 'the day route has no behaviour, so the scrubber does nothing')

    note('day: %d aid phases, %s to %s' % (len(phases), phases[0]['from'], phases[-1].get('to') or 'open'))


def _ref_in_markdown(ref, markdown):
    """A phase cites either a numbered section or a lettered appendix of the report.

    The citation is written the way a reader would write it, with a section sign
    or an abbreviation, while the report writes its own headings as plain
    numbers and the word Appendix, so the two are compared on the part that
    matters: the number or the letter.
    """
    section = re.search(r'(\d+\.\d+)', ref)
    if section:
        return bool(re.search(r'^#+ .*\b%s\b' % re.escape(section.group(1)), markdown, re.M))
    appendix = re.search(r'App(?:endix)?\.?\s*([A-Z])\b', ref)
    if appendix:
        return bool(re.search(r'^#+ .*Appendix %s\b' % appendix.group(1), markdown, re.M | re.I))
    return ref in markdown


def _next_day(iso):
    return (dt.date.fromisoformat(iso) + dt.timedelta(days=1)).isoformat()


def check_dependencies():
    """A library only the workstation has is a nightly build that fails at 05:17.

    The scripts here run on a GitHub runner as well as on this machine, and the
    runner starts with nothing but the standard library. deps_check.py works
    out what is actually imported and compares it against requirements.txt, so
    an undeclared dependency stops a publish here rather than surfacing later
    as a refresh that quietly stopped writing the sitemap.
    """
    try:
        import deps_check
    except Exception as err:                     # pragma: no cover - defensive
        fail('deps', 'deps_check.py could not be loaded: %s' % err)
        return
    problems = deps_check.audit()
    # An undeclared import is a mistake in this repository and stops a publish
    # anywhere. A declared library that did not install is a property of the
    # machine, not of the data: on a runner the workflow has already retried the
    # install and skipped the only step that needs the library, so failing here
    # too would block a data refresh that is perfectly sound. It still fails on
    # the workstation, where an uninstalled library means the build being
    # published was never actually produced.
    on_runner = os.environ.get('GITHUB_ACTIONS') == 'true'
    for module, _files, problem, kind in problems:
        if kind == deps_check.UNINSTALLED and on_runner:
            warn('deps', '%s: %s' % (module, problem))
        else:
            fail('deps', '%s: %s' % (module, problem))
    note('dependencies: %d third-party imports, %d pinned, %d problems'
         % (len(deps_check.imports()), len(deps_check.declared()), len(problems)))


def check_genocide_positions(files):
    """Every government position on the genocide question is sourced and dated.

    The map colours a state by what its government has said, so an entry that
    names a position without a speaker, a date, the words and a link would be
    an assertion the page cannot back. The counts must also cover every UN
    member state exactly once: the "has not said it" list is derived as the
    complement, and a state missing from both would vanish silently.
    """
    g = (files.get('world-positions') or {}).get('genocide')
    if not g:
        fail('genocide', 'world-positions.json carries no genocide layer')
        return
    kinds = set(g.get('labels', {}))
    un = [s for s in g['states'] if s.get('un')]
    if len(un) != g.get('un_total'):
        fail('genocide', '%d UN member states carry a position, not %s' % (len(un), g.get('un_total')))
    counts = {}
    for s in un:
        counts[s['position']] = counts.get(s['position'], 0) + 1
    if counts != g.get('un_counts'):
        fail('genocide', 'the stated counts %s do not match the states %s' % (g.get('un_counts'), counts))
    seen = set()
    for s in g['states']:
        name = s.get('name')
        if name in seen:
            fail('genocide', '%s appears twice' % name)
        seen.add(name)
        if s.get('position') not in kinds:
            fail('genocide', '%s has the unknown position %r' % (name, s.get('position')))
            continue
        if s['position'] == 'none':
            continue
        if not s.get('who') or not s.get('date'):
            fail('genocide', '%s has no speaker or no date' % name)
        if not (s.get('quote') or s.get('summary')):
            fail('genocide', '%s has neither the words nor a summary of them' % name)
        if not re.match(r'^https?://', s.get('source') or ''):
            fail('genocide', '%s has no source link' % name)
        if not re.match(r'^\d{4}(-\d{2}(-\d{2})?)?$', s.get('date') or ''):
            fail('genocide', '%s carries the date %r' % (name, s.get('date')))
        elif s['date'] > TODAY.isoformat():
            fail('genocide', '%s is dated in the future' % name)
        if s['position'] == 'reversed' and not (s.get('now') and re.match(r'^https?://', s.get('now_source') or '')):
            fail('genocide', '%s is marked reversed without a sourced account of the reversal' % name)
    note('  genocide: %d UN member states, %s' % (len(un), ', '.join('%s %d' % kv for kv in sorted(counts.items()))))


def check_share_card(files):
    """The home page's share card states three figures; they should be today's.

    prerender.py draws the card and its alt text from figures.json, so the two
    agree after every unfiltered prerender. This runs before prerender in the
    refresh workflow, where the feed has just moved the figures and the card
    has not been redrawn yet, so a disagreement is a warning and not a failure:
    it says the card is behind, not that the data is wrong.
    """
    html = (HERE / 'index.html').read_text(encoding='utf-8')
    alt = re.search(r'<meta property="og:image:alt" content="([^"]*)"', html)
    if not alt:
        fail('share-card', 'index.html carries no og:image:alt, so the card is unlabelled')
        return
    by_label = {f['label']: f['value'] for f in (files.get('figures') or {}).get('headline', [])}
    for label in ('Palestinians killed in Gaza', 'Children killed in Gaza', 'States recognising Palestine'):
        value = by_label.get(label)
        if value is not None and '{:,}'.format(int(value)) not in alt.group(1):
            warn('share-card', 'the share card does not carry the current %s (%s); run prerender.py'
                 % (label.lower(), '{:,}'.format(int(value))))
    if not re.search(r'<meta property="og:image" content="https://', html):
        fail('share-card', 'og:image is not an absolute URL, which X and the Open Graph protocol require')


def check_curated_duplicates(files):
    """The same fact entered twice is a second source that does not exist.

    The curated files are hand-edited, sometimes by two people or two sessions
    on the same afternoon, and nothing about the schema stops the same event
    being appended twice. It is not a cosmetic problem: the dashboard counts
    these files, so a duplicated entry inflates the number of documented
    statements and puts the same day in the chronology twice, which reads to
    anyone checking as two independent records of one thing.

    Matching is on the fields that identify the entry rather than on the whole
    object, so a second copy that differs only in its note is still caught.
    """
    def norm(value):
        return re.sub(r'\s+', ' ', str(value or '')).strip().lower()

    checks = (
        ('timeline-extra', 'items', lambda i: (norm(i.get('sort')), norm(i.get('event'))),
         lambda i: '%s — %s' % (i.get('date'), i.get('event'))),
        ('statements', 'items',
         lambda i: (norm(i.get('speaker')), norm(i.get('sort')), norm(i.get('quote'))),
         lambda i: '%s, %s' % (i.get('speaker'), i.get('date'))),
    )
    for name, key, identity, describe in checks:
        blob = files.get(name)
        if not blob:
            continue
        seen = {}
        for item in blob.get(key, []):
            ident = identity(item)
            if ident in seen:
                fail('duplicates', '%s.json holds the same entry twice: %s'
                     % (name, describe(item)))
            seen[ident] = item
        note('%s: %d entries, %d distinct' % (name, len(blob.get(key, [])), len(seen)))

    blob = files.get('sources')
    if blob:
        seen, total = set(), 0
        for group in blob.get('groups', []):
            for item in group.get('items', []):
                total += 1
                ident = (norm(item.get('url')), norm(item.get('title')))
                if ident in seen:
                    fail('duplicates', 'sources.json holds the same entry twice: %s'
                         % item.get('title'))
                seen.add(ident)
        note('sources: %d entries, %d distinct' % (total, len(seen)))


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


def check_service_worker():
    """A worker that precaches last version's URLs serves them to every installed reader."""
    worker = HERE / 'sw.js'
    if not worker.exists():
        return
    source = worker.read_text()
    index = (HERE / 'index.html').read_text()
    served = set(re.findall(r'\?v=(\d+)', index))
    if not served:
        return

    declared = re.search(r"VERSION\s*=\s*'v(\d+)'", source)
    if not declared:
        fail('worker', "sw.js does not declare VERSION = 'vN'")
    elif declared.group(1) not in served:
        fail('worker', 'sw.js declares VERSION v%s while index.html serves ?v=%s'
             % (declared.group(1), ', '.join(sorted(served))))

    # The shell list hardcodes the query strings it precaches. If they fall
    # behind the page, every installed reader is served the previous build's
    # JavaScript from a cache the page cannot see or clear.
    for other in sorted(set(re.findall(r'\?v=(\d+)', source))):
        if other not in served:
            fail('worker', 'sw.js precaches ?v=%s while index.html serves ?v=%s'
                 % (other, ', '.join(sorted(served))))

    if 'sw.js' not in index:
        fail('worker', 'sw.js exists but index.html never registers it')

    # Without the escape hatch a bad worker has to be waited out rather than
    # cleared, and it outlives the deployment that caused it.
    if 'nosw' not in index or 'nosw' not in source:
        fail('worker', "the ?nosw=1 unregister path is missing from index.html or sw.js")

    shell = re.search(r'SHELL_FILES\s*=\s*\[(.*?)\]', source, re.S)
    listed = re.findall(r"'\./([^'?]*)", shell.group(1)) if shell else []
    for name in sorted({n for n in listed if n}):
        if not (HERE / name).exists():
            fail('worker', 'sw.js precaches %s, which is not in the repository' % name)
    note('service worker: v%s, %d shell files'
         % (declared.group(1) if declared else '?', len(listed)))


def check_manifest():
    """An installed app that opens on a dead start_url is worse than no install."""
    path = HERE / 'manifest.webmanifest'
    if not path.exists():
        return
    try:
        manifest = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail('manifest', 'manifest.webmanifest is not valid JSON: %s' % exc)
        return
    for field in ('name', 'short_name', 'start_url', 'display', 'icons'):
        if not manifest.get(field):
            fail('manifest', 'manifest.webmanifest has no %s' % field)
    for icon in manifest.get('icons', []):
        src = (icon.get('src') or '').lstrip('/').split('?')[0]
        if src and not (HERE / src).exists():
            fail('manifest', 'manifest.webmanifest names icon %s, which does not exist' % src)
    if 'manifest.webmanifest' not in (HERE / 'index.html').read_text():
        fail('manifest', 'manifest.webmanifest exists but index.html does not link it')
    note('manifest: %d icons, %d shortcuts'
         % (len(manifest.get('icons', [])), len(manifest.get('shortcuts', []))))


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


def check_children(files):
    """The children's record must add up, and every figure must name its source.

    Three things are asserted. Every window total is the sum of the year rows
    that belong to it, so a figure quoted on the page cannot drift away from
    the rows underneath it. The headline total and the ratio are the sum and
    the quotient of those windows and of nothing else, so a partial figure
    cannot leak into the comparison. And every row that states a number names
    the body that recorded it, which is the same standard the rest of the data
    is held to.
    """
    blob = files.get('children')
    if not blob:
        fail('children', 'data/children.json is missing')
        return

    windows = {w['id']: w for w in blob['windows']}
    for wid, window in windows.items():
        rows = [r for r in blob['years'] if r['window'] == wid]
        if not rows:
            fail('children', 'window %s has no year rows' % wid)
            continue
        for side in ('palestinian', 'israeli'):
            total = sum(r[side] or 0 for r in rows)
            if total != window[side]:
                fail('children', 'window %s states %s %s but its year rows sum to %s'
                     % (wid, window[side], side, total))
        if window['israeli'] and round(window['palestinian'] / window['israeli'], 1) != window['ratio']:
            fail('children', 'window %s states a ratio of %s that is not its own quotient'
                 % (wid, window['ratio']))

    counted = blob['counted']
    for side in ('palestinian', 'israeli'):
        total = sum(w[side] for w in blob['windows'])
        if total != counted[side]:
            fail('children', 'the headline states %s %s children against a window sum of %s'
                 % (counted[side], side, total))
    ratio = round(counted['palestinian'] / counted['israeli'], 1)
    if ratio != counted['ratio']:
        fail('children', 'the headline ratio %s is not the quotient %s' % (counted['ratio'], ratio))
    share = round(100.0 * counted['palestinian'] / (counted['palestinian'] + counted['israeli']), 1)
    if share != counted['share']:
        fail('children', 'the headline share %s is not the computed %s' % (counted['share'], share))

    # A partial row states one side or one territory. Nothing may be counted
    # from it, which is enforced by the window sums above: partial rows carry
    # the window id `uncounted`, which no window totals.
    for row in blob['years']:
        if row['basis'] != 'none' and (row['palestinian'] is not None or row['israeli'] is not None):
            if not (row.get('source') or row.get('israeli_source')):
                fail('children', 'the %s row states a figure with no source' % row['year'])
        if row['basis'] == 'partial' and row['window'] != 'uncounted':
            fail('children', 'the %s row is partial but sits inside a counted window' % row['year'])
    for era in blob['eras']:
        if not era.get('source'):
            fail('children', 'the era %s names no source' % era['id'])

    ages = blob['ages']
    if sum(ages['values']) != ages['total']:
        fail('children', 'the age histogram totals %s against a sum of %s'
             % (ages['total'], sum(ages['values'])))
    demographics = (files.get('timeseries') or {}).get('demographics') or {}
    if demographics.get('child_ages') and demographics['child_ages'] != ages['values']:
        fail('children', 'the age histogram has drifted from timeseries.json demographics.child_ages')

    counted_years = [r for r in blob['years'] if r['basis'] == 'counted']
    note('children: %d years counted, %d partial, %d with no figure; %s Palestinian to %s Israeli, %s:1'
         % (len(counted_years),
            len([r for r in blob['years'] if r['basis'] == 'partial']),
            len([r for r in blob['years'] if r['basis'] == 'none']),
            counted['palestinian'], counted['israeli'], counted['ratio']))


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
        check_children(files)
        check_day(files)
        check_headline_agreement(files)
        check_live_copies(files)
        check_declared_totals(files)
        check_recognition_count(files)
        check_map_joins(files)
        check_chronology(files)
        check_statements(files)
        check_sources(files)
        check_provenance(files)
        check_patterns(files)
        check_entities(files)
        check_falsification(files)
        check_constituency(files)
        check_figures_against_markdown(files)
        check_curated_duplicates(files)
        check_genocide_positions(files)
        check_share_card(files)
        check_dependencies()
        check_chart_wiring()
        check_cache_bust()
        check_service_worker()
        check_manifest()
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
