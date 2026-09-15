#!/usr/bin/env python3
"""Build the falsification register: data/falsification.json.

The method page has always ended with four conditions under which this record
would be wrong. Four conditions stated in prose are a promise; they are not
something a reader can act on. This script turns the promise into a register:
one entry for every curated claim the provenance graph knows about, each
carrying the claim itself, the bodies it rests on, how many independent classes
of source those bodies fall into, which of the adversary switches would knock
it out, and the specific evidence that would settle it.

Nothing here is a new assertion. The claims, the sources and the origin classes
are read out of data/provenance.json, which is itself a rebuild of the curated
files; the quotations are left in data/statements.json and referred to by
index. What this script adds is the test — what a challenger would have to
produce — which is a function of the kind of claim, not of its content, and is
therefore written once per kind rather than invented per entry.

The challenge route is a GitHub issue against the site's own repository. The
page builds the prefilled link; this file carries the repository, the label and
the fields the issue asks for, so that a challenge arrives with the entry id
and the source already attached instead of as an unplaceable complaint.

Run it after provenance.py and before manifest.py:

    python3 falsify.py            # writes data/falsification.json
    python3 falsify.py --report   # writes nothing, prints the weakest entries
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

REPO = 'palestinerecord/palestinerecord.github.io'
LABEL = 'challenge'

# The four standing conditions. They were prose on the method page and are
# moved here so that the page and the register state the same four things, and
# so that each one can name the part of the register that implements it.
CONDITIONS = [
    {
        'id': 'figure',
        'title': 'A load-bearing figure shown to be wrong',
        'detail': 'from a source of equal or better standing. Casualty figures, settlement counts, '
                  'detention numbers and destruction totals are attributed to the body that recorded '
                  'them, with the date of the record, precisely so that a superseding figure can be '
                  'identified and substituted.',
    },
    {
        'id': 'statement',
        'title': 'A quotation shown to be fabricated, mistranslated or materially decontextualised',
        'detail': 'Every statement carries a named speaker, a role, a date and a source; where a widely '
                  'circulated paraphrase differs from the sourced verbatim wording, both are recorded and '
                  'the difference is stated; a weakly sourced item carries that caveat inline rather than '
                  'being quietly retained.',
    },
    {
        'id': 'record',
        'title': 'A finding withdrawn or reversed by the body that issued it',
        'detail': 'The findings relied on here are institutional, not anonymous, and each is therefore '
                  'capable of being retracted by an identifiable author.',
    },
    {
        'id': 'judgment',
        'title': 'The ICJ’s merits judgment in South Africa v. Israel',
        'detail': 'which is the one authority that could displace rather than merely dispute the central '
                  'legal characterisation, and which this record expressly does not pre-empt. It is not '
                  'in the register below because no entry can anticipate it: it is the one test this '
                  'record cannot run on itself.',
    },
]

# What a challenger would have to produce. The test is a property of the kind
# of claim rather than of the claim, which is the point: the same standard is
# offered for every entry of a kind, including the entries this record would
# least like to lose.
KINDS = {
    'figure': {
        'label': 'Figures',
        'note': 'A number attributed to the body that recorded it, on the date it recorded it.',
        'test': 'Produce a figure for the same quantity, at the same date or later, from a body of equal '
                'or better standing than the one named here. The figure on this page is then superseded '
                'and replaced, and the change is published in the revision history.',
    },
    'statement': {
        'label': 'Statements',
        'note': 'Something a named person or body said, on a named date, in a named place.',
        'test': 'Produce the recording, transcript or original publication showing that the words were '
                'not said, that the translation is wrong, or that the surrounding text changes their '
                'meaning. The entry is then withdrawn or corrected on its face, and the correction is '
                'published rather than made silently.',
    },
    'record': {
        'label': 'Findings and records',
        'note': 'A finding, a ruling or a documented fact carried from an identified body.',
        'test': 'Show that the body named has withdrawn, corrected or reversed the finding, or produce a '
                'record of equal standing that contradicts it. A finding retracted by its own author is '
                'removed here; a finding merely disputed is kept with the dispute recorded beside it.',
    },
}

# The files whose claims are worth putting to a reader as separate entries.
# report.json is excluded upstream in provenance.py, and the two files that
# carry a single source for their whole contents are excluded here, because an
# entry a reader cannot act on individually is not a test of anything.
SKIP_FILES = {'names.json', 'timeseries.json'}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def kind_of(claim):
    if claim['file'] == 'statements.json':
        return 'statement'
    if claim.get('numeric'):
        return 'figure'
    return 'record'


# Some rows label themselves with nothing but a date — "Dec 2018", "1967" —
# because on their own page the table they sit in supplies the rest. Lifted out
# of that table and into a register, such a label states nothing a reader could
# agree or disagree with, so the container the row came from is walked back to
# and its own title used as the context.
TITLE_KEYS = ('title', 'label', 'heading', 'name')


def path_steps(path):
    """Split a provenance path such as `detention.series[0]` into its steps."""
    steps = []
    for part in path.split('.'):
        while '[' in part:
            head, rest = part.split('[', 1)
            if head:
                steps.append(head)
            index, part = rest.split(']', 1)
            steps.append(int(index))
            part = part.lstrip('.')
        if part:
            steps.append(part)
    return steps


def context_of(claim, curated):
    """The title of the nearest container above the row the claim came from."""
    blob = curated.get(claim['file'])
    if blob is None:
        return ''
    node, found = blob, ''
    for step in path_steps(claim.get('path', '')):
        try:
            node = node[step]
        except (KeyError, IndexError, TypeError):
            return found
        if isinstance(node, dict):
            for key in TITLE_KEYS:
                value = node.get(key)
                # The row's own title is the claim's label already; only a
                # container's title adds anything.
                if isinstance(value, str) and value.strip() and value.strip() != (claim.get('label') or '').strip():
                    found = value.strip()
                    break
    return found


def statement_index(claim):
    """Statement claims keep their quotation in statements.json, not here."""
    path = claim.get('path', '')
    if claim['file'] != 'statements.json' or not path.startswith('items['):
        return None
    try:
        return int(path[len('items['):path.index(']')])
    except ValueError:
        return None


def build():
    prov = load('provenance.json')
    statements = load('statements.json')['items']
    curated = {name: load(name) for name in sorted({c['file'] for c in prov['claims']})
               if os.path.exists(os.path.join(DATA, name))}

    origins = {}
    sources = {}
    for source in prov['sources']:
        sources[source['id']] = {
            'name': source['name'],
            'origin': source['origin'],
        }
        origins[source['origin']] = source['origin_label']

    switches = [{
        'id': s['id'],
        'label': s['label'],
        'removes': s['removes'],
        'note': s['note'],
        'stands': s['stands'],
        'falls': s['falls'],
        'share': s['share'],
    } for s in prov['switches']]

    entries = []
    for claim in prov['claims']:
        if claim['file'] in SKIP_FILES:
            continue
        label = (claim.get('label') or '').strip()
        if not label:
            # A row with no label of its own cannot be put to a reader as a
            # separate question. It is still counted in the provenance graph;
            # it is simply not a test anybody could run.
            continue
        kind = kind_of(claim)
        ids = [sid for sid in claim['sources'] if sid in sources]
        classes = sorted({sources[sid]['origin'] for sid in ids})
        falls = [s['id'] for s in switches
                 if ids and all(sources[sid]['origin'] in s['removes'] for sid in ids)]
        entry = {
            'id': claim['id'],
            'claim': label,
            'kind': kind,
            'file': claim['file'],
            'sources': ids,
            'origins': classes,
            'independence': len(classes),
            'falls': falls,
        }
        if claim.get('ref'):
            entry['ref'] = claim['ref']
        if claim.get('date'):
            entry['date'] = claim['date']
        if claim.get('numeric') and claim.get('value') not in (None, ''):
            entry['value'] = claim['value']
        if claim.get('source_text'):
            entry['attribution'] = claim['source_text']
        context = context_of(claim, curated)
        if context and context.lower() != label.lower():
            entry['context'] = context
        index = statement_index(claim)
        if index is not None and 0 <= index < len(statements):
            entry['statement'] = index
        entries.append(entry)

    # Weakest first. The register is a list of the ways this record could be
    # broken, so it is ordered by how easily each entry could be broken: an
    # entry that no adversary switch survives, then one resting on a single
    # class of source, then the rest. A page that led with its strongest
    # entries would be advertising rather than inviting.
    order = {'figure': 0, 'statement': 1, 'record': 2}
    entries.sort(key=lambda e: (-len(e['falls']), e['independence'], order[e['kind']], e['claim'].lower()))

    counts = {kind: sum(1 for e in entries if e['kind'] == kind) for kind in KINDS}
    single = sum(1 for e in entries if e['independence'] <= 1)
    exposed = sum(1 for e in entries if e['falls'])

    data = {
        'meta': {
            'title': 'The falsification register',
            'note': 'One entry for every curated claim on this site that a reader could settle on their '
                    'own: what is claimed, what it rests on, how many independent classes of source stand '
                    'behind it, which adversary switch would remove it, and the evidence that would '
                    'decide it. The register is generated from the provenance graph, so an entry cannot '
                    'go missing by being forgotten.',
            'source': 'data/provenance.json; data/statements.json',
            'repo': REPO,
            'label': LABEL,
            'entries': len(entries),
            'kinds': counts,
            'single_origin': single,
            'exposed': exposed,
            'claims': prov['summary']['claims'],
        },
        'conditions': CONDITIONS,
        'kinds': [{'id': k, 'label': v['label'], 'note': v['note'], 'test': v['test']}
                  for k, v in KINDS.items()],
        'origins': [{'id': k, 'label': v} for k, v in sorted(origins.items())],
        'sources': sources,
        'switches': switches,
        'entries': entries,
    }

    assert all(e['kind'] in KINDS for e in entries)
    assert len({e['id'] for e in entries}) == len(entries), 'two entries share one identifier'
    assert all(all(sid in sources for sid in e['sources']) for e in entries)
    return data


def main():
    data = build()
    if '--report' in sys.argv:
        for entry in data['entries'][:25]:
            print('%-2d %-9s %-48s %s' % (entry['independence'], entry['kind'],
                                          entry['claim'][:48], ', '.join(entry['falls']) or '—'))
        return
    path = os.path.join(DATA, 'falsification.json')
    with open(path, 'w') as fh:
        fh.write(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    meta = data['meta']
    print('falsification.json — %d entries, %d resting on one class of source, %d removed by a switch'
          % (meta['entries'], meta['single_origin'], meta['exposed']))


if __name__ == '__main__':
    main()
