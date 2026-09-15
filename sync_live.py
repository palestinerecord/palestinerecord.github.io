#!/usr/bin/env python3
"""Carry the refreshed series into the curated files.

fetch_timeseries.py re-pulls the daily feeds. A handful of the curated figures
are not independent of those feeds: they are copies of a number in them, and
they say so, either by naming the series they track (`"live": true` with a
`"series"` path in figures.json) or by being the histogram of the named list
itself (the age bars in children.json). The moment the feed advances, the copy
disagrees with the original, and validate.py fails the run for exactly that
reason — which is the check working, but it leaves the nightly refresh unable
to publish a series it has just pulled correctly.

This script closes that gap in the only direction that is honest: the series is
the record, the curated copy is a copy, so the copy is brought to the series and
the change is committed with the rest of the refresh. Nothing here invents a
figure, rounds one, or reconciles a disagreement between two different sources.
A curated figure that names no series is never touched: those are the figures
the report itself states, and they are checked against the markdown instead.

What it will not do is accept nonsense from a feed. A recorded toll is
cumulative: it rises, and a revision of the named list occasionally moves it
down by a little when duplicate records are removed. A fall of more than a few
per cent is not a revision, it is a truncated or malformed download, and the
run stops rather than publishing it.

    python3 sync_live.py           # update the curated copies in place
    python3 sync_live.py --check   # report what would change and write nothing

Run it after fetch_timeseries.py and before validate.py. If it changes
anything, provenance.py, falsify.py and manifest.py all hold copies of the
figures it touched and should be re-run before the commit.
"""

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / 'data'

# A fall larger than this is treated as a broken download rather than as the
# Ministry's own correction of its list.
DROP_TOLERANCE = 0.02

changes = []
problems = []


def report(message):
    changes.append(message)


def problem(message):
    problems.append(message)


def load(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


def save(name, blob):
    """Write a curated file back in the shape the rest of them are kept in."""
    (DATA / name).write_text(json.dumps(blob, ensure_ascii=False, indent=1) + '\n',
                             encoding='utf-8')


def walk_series(root, path):
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


def series_value(series, path):
    """Read the figure a curated entry names out of timeseries.json.

    Three shapes are addressable. A path into the summary block names a scalar,
    as `killed.total` does. A path into one of the territory blocks names a
    whole series, as `west_bank.cumulative_killed` does, and the figure is its
    latest month, which is what a cumulative series is stating. A list of paths
    names a figure that is the sum of them, which is how the record states a
    toll running across both territories.
    """
    if isinstance(path, list):
        parts = [series_value(series, one) for one in path]
        return None if any(part is None for part in parts) else sum(parts)
    value = walk_series(series.get('summary') or {}, path)
    return value if value is not None else walk_series(series, path)


def accept(label, old, new):
    """Is the new figure a supersession of the old one, or a broken feed?"""
    if new is None:
        problem('%s names a series the feed no longer publishes' % label)
        return False
    if new <= 0:
        problem('%s came back from the feed as %s' % (label, new))
        return False
    if old and new < old * (1 - DROP_TOLERANCE):
        problem('%s falls from %s to %s, which is too far to be a revision of the list'
                % (label, f'{int(old):,}', f'{int(new):,}'))
        return False
    return True


def walk(node, path=''):
    """Yield every dict in a nested structure with the path that reaches it."""
    if isinstance(node, dict):
        yield path, node
        for key, value in node.items():
            yield from walk(value, '%s.%s' % (path, key) if path else key)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk(value, '%s[%d]' % (path, index))


def sync_curated(name, series):
    """Every figure in a curated file that declares which series it tracks."""
    figures = load(name)
    touched = 0
    for path, node in walk(figures, name):
        if not node.get('live') or not node.get('series'):
            continue
        # Almost every curated figure keeps its number in `value`; a row that
        # states two sides of a comparison keeps each in its own field and says
        # which of them the series it names is.
        field = node.get('series_field') or 'value'
        old = node.get(field)
        if not isinstance(old, (int, float)) or isinstance(old, bool):
            continue
        label = node.get('label') or path
        new = series_value(series, node['series'])
        if not accept(label, old, new):
            continue
        if int(new) != int(old):
            node[field] = int(new)
            touched += 1
            report('%s: %s to %s' % (label, f'{int(old):,}', f'{int(new):,}'))
        # A note that quotes a second figure from the feed - the children
        # inside a West Bank toll - names the series it quotes, so the sentence
        # beside the number moves with the number rather than behind it.
        if node.get('note_series'):
            inner = series_value(series, node['note_series'])
            stated = re.findall(r'(\d[\d,]*) children', node.get('note') or '')
            if inner is None or len(stated) != 1:
                problem('the note on %s does not state one figure the feed can check' % label)
            elif int(stated[0].replace(',', '')) != int(inner):
                node['note'] = replace_number(node['note'], int(stated[0].replace(',', '')),
                                              int(inner), 'the note on %s' % label)
                touched += 1
                report('%s, children in the note: %s to %s'
                       % (label, stated[0], f'{int(inner):,}'))
    return (name, figures) if touched else None


def replace_number(text, old, new, what):
    """Swap one written number for another inside a sentence that states it."""
    pattern = r'\b%s\b' % re.escape(f'{int(old):,}')
    found = len(re.findall(pattern, text))
    if found != 1:
        problem('%s states %s %d times; it cannot be updated without reading it'
                % (what, f'{int(old):,}', found))
        return text
    return re.sub(pattern, f'{int(new):,}', text)


def sync_children(demographics):
    """The age bars, and the two sentences that quote the list they come from.

    The histogram is the named list broken down by year of age, so it moves
    whenever the list does. The two notes beside it state how many records the
    list holds and what share of them are children; both are arithmetic on the
    same list, so both are recomputed rather than left to go quietly stale.
    """
    if not demographics.get('child_ages'):
        problem('timeseries.json carries no demographics.child_ages')
        return None

    blob = load('children.json')
    ages = blob['ages']
    bars = [int(n) for n in demographics['child_ages']]
    records = int(demographics.get('total_records') or 0)
    children = int(demographics.get('under_18') or 0)

    if sum(bars) != children:
        problem('the feed reports %s children on the list but age bars summing to %s'
                % (f'{children:,}', f'{sum(bars):,}'))
        return None
    if not accept('the named list', ages.get('total'), children):
        return None
    if not records:
        problem('timeseries.json carries no demographics.total_records')
        return None

    old_records = None
    for entry in blob.get('beyond', []):
        if entry.get('label') == 'Children on the named list of the dead':
            old_children = int(entry['value'])
            # The note states the size of the list and the children's share of
            # it. Both are read back out of the sentence, so a hand edit to the
            # wording does not silently stop either from being updated.
            share = re.findall(r'(\d+(?:\.\d+)?) per cent', entry['note'])
            if len(share) != 1:
                problem('the named-list note no longer states one share in per cent')
                return None
            old_records = int(re.findall(r'(\d[\d,]*) people named', entry['note'])[0].replace(',', ''))
            entry['value'] = children
            entry['note'] = replace_number(entry['note'], old_records, records, 'the named-list note')
            entry['note'] = entry['note'].replace(
                '%s per cent' % share[0],
                '%s per cent' % ('%.1f' % (100.0 * children / records)))
            if old_children != children:
                report('children on the named list: %s to %s'
                       % (f'{old_children:,}', f'{children:,}'))
            break
    else:
        problem('children.json no longer carries the named-list entry')
        return None

    if old_records is not None:
        ages['note'] = replace_number(ages['note'], old_records, records, 'the age histogram note')
    changed = ages['values'] != bars or ages['total'] != children
    if changed:
        report('the age histogram: %d bars totalling %s, was %s'
               % (len(bars), f'{children:,}', f"{int(ages['total']):,}"))
    ages['values'] = bars
    ages['total'] = children
    return ('children.json', blob) if (changed or old_records != records) else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true',
                    help='report what would change and write nothing')
    args = ap.parse_args()

    series = load('timeseries.json')
    demographics = series.get('demographics') or {}

    written = [result for result in (sync_curated('figures.json', series),
                                     sync_curated('long-record.json', series),
                                     sync_children(demographics))
               if result]

    if problems:
        for line in problems:
            print('sync: %s' % line, file=sys.stderr)
        print('sync: refusing to carry the feed into the curated files', file=sys.stderr)
        return 1

    for line in changes:
        print('sync: %s' % line)
    if not written:
        print('sync: the curated copies already match the feed')
        return 0
    if args.check:
        print('sync: %s would be rewritten' % ', '.join(name for name, _ in written))
        return 0
    for name, blob in written:
        save(name, blob)
    print('sync: rewrote %s' % ', '.join(name for name, _ in written))
    return 0


if __name__ == '__main__':
    sys.exit(main())
