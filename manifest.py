#!/usr/bin/env python3
"""manifest.py — describe the published data as data.

The dashboard is a reader for a set of JSON files that are useful on their own:
the daily casualty series, the curated figures with their sources, the catalogue
of documented statements, the depopulated villages of 1948. Leaving them as an
implementation detail of one page wastes them. This writes data/index.json — a
described, dated, addressable list of every published file — which the `#/api`
route renders and which anyone else can read directly.

The descriptions live here because they are editorial, not derivable; the sizes,
the record counts and the top-level fields are read from the files themselves, so
they cannot drift. A file present on disk but absent from DESCRIPTIONS is a
failure, not a warning: an undescribed file in a published manifest is worse than
no manifest, because it claims completeness it does not have.

    python3 manifest.py            # write data/index.json
    python3 manifest.py --check    # report what would change, write nothing
"""

import argparse
import datetime
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / 'data'
OUT = DATA / 'index.json'

LICENCE = (
    'The compilation is published for re-use with attribution to The Documented Record. '
    'The underlying figures are not ours to licence: each record names the body that '
    'recorded it, and that body\'s terms govern the figure itself.'
)

# path -> (title, description, source)
DESCRIPTIONS = {
    'report.json': (
        'The source report, parsed',
        'Every part, section, paragraph, list, table, chronology entry and bibliography '
        'entry of the report, converted losslessly by build.py and checked by '
        'verify.py. This is the whole document as structured data.',
        'The report — A Forensic Academic Survey of State Conduct, Alleged Violations '
        'of International Law, and the Documented Record (1917–2026).',
    ),
    'chronology.json': (
        'The chronology of recorded crimes',
        'Appendix B of the report: every dated crime and massacre in the record, split out '
        'of report.json so the Timeline can be read without loading the full report.',
        'The report, Appendix B.',
    ),
    'report-meta.json': (
        'The report, described',
        'The title, the counts (words, parts, sections, tables) and the full bibliography '
        'of the report, without the text — what a page needs to quote the report '
        'accurately when it is not reproducing it.',
        'Derived from the report by build.py.',
    ),
    'headline.json': (
        'The first screen',
        'The eight headline figures, the current ratio and the counts, in one small file '
        'so the record can state what it establishes before the rest of the data arrives.',
        'A subset of figures.json, timeseries.json and report-meta.json; each figure keeps '
        'its own source field.',
    ),
    'timeseries.json': (
        'Daily and monthly casualty series',
        'Killed and injured in Gaza and the West Bank, day by day and aggregated by month, '
        'with the reporting gaps left as gaps rather than interpolated.',
        'Tech For Palestine, from Gaza Ministry of Health and OCHA reporting (public domain).',
    ),
    'figures.json': (
        'The curated statistics',
        'The headline figures and the topic groups behind them — each with its label, its '
        'value, the note that qualifies it, and the report section it came from.',
        'Each record carries its own source field.',
    ),
    'statements.json': (
        'Documented statements of intent',
        'Statements by named officials with speaker, role, date, the verbatim quotation, its '
        'context, its evidentiary categories, its tier and its legal significance. Contested '
        'attributions are marked contested.',
        'Primary reporting as cited per record; §6.2 and Appendix C of the report.',
    ),
    'sources.json': (
        'The linked source library',
        'The evidentiary base grouped by kind: courts and tribunals, UN bodies, human rights '
        'organisations, open datasets, academic work, Israeli sources, journalism and archives.',
        'Each entry links to the publisher.',
    ),
    'provenance.json': (
        'The provenance graph',
        'Every curated claim on this site joined to the bodies it rests on: 416 claims, each '
        'with the source strings it carries normalised to stable source identifiers, and each '
        'source classified by who controls the body that published it. The five switches '
        'record what share of the record still stands when a whole class of source is removed.',
        'Derived by provenance.py from the source field of every curated record; each claim '
        'keeps the source text it was written with.',
    ),
    'children.json': (
        'The children\u2019s record, 1948 to the present',
        'Every child this record can count, on both sides, period by period and year by year: '
        'three windows counted in full from a single source that counted both sides on one '
        'methodology, the partial figures that cover only one side or one territory marked as '
        'such, and the periods nobody counted published as gaps rather than estimated.',
        'B\u2019Tselem, Remember These Children, Defence for Children International \u2013 Palestine, '
        'OCHA, the Gaza Ministry of Health via Tech For Palestine, and the Israel National '
        'Council for the Child; each row names the one that recorded it.',
    ),
    'history.json': (
        'The pre-October-2023 baseline and the undercount',
        'West Bank annual tolls and settler violence rates before October 2023, together with '
        'the undercount layer: the Lancet capture–recapture estimate, the Gaza Mortality '
        'Survey, and the bodies under the rubble.',
        'B\'Tselem, OCHA, The Lancet, and the Gaza Mortality Survey.',
    ),
    'timeline-extra.json': (
        'The contextual chronology',
        'The legal and political steps between the massacres recorded in Appendix B — mandates, '
        'partitions, laws, plans, rulings, resolutions and admissions.',
        'Primary documents as cited per entry.',
    ),
    'legal.json': (
        'Proceedings, findings and instruments',
        'The ICJ cases and their orders, the ICC warrants, the treaty provisions engaged, and '
        'the findings made under the Genocide, Fourth Geneva and Apartheid Conventions.',
        'ICJ and ICC filings and orders; UN Commission of Inquiry reports.',
    ),
    'long-record.json': (
        'The long record, 1917–2026',
        'Dispossession, detention, demolition, recognition and complicity across the whole '
        'period, as series rather than as single figures.',
        'Each record carries its own source field.',
    ),
    'world-positions.json': (
        'State positions',
        'Recognition of Palestine, arms embargoes, ICJ interventions, sanctions and Security '
        'Council vetoes, by state, with the date each position was taken.',
        'UN records; national foreign ministry statements.',
    ),
    'war-record.json': (
        'The wars and 7 October',
        'Each Gaza campaign, what it was called, what it killed, and what the inquiries into it '
        'found — alongside the documented record of 7 October 2023.',
        'UN Commission of Inquiry, OCHA, B\'Tselem and Israeli state inquiries.',
    ),
    'conduct-record.json': (
        'Conduct of the war',
        'Aid, hospitals, schools, heritage, journalists, medics and what remains functioning, '
        'measured against the obligations each engages.',
        'WHO, UNRWA, UNESCO, OCHA, CPJ and Physicians for Human Rights.',
    ),
    'elements.json': (
        'The elements of the legal tests',
        'The elements of genocide, apartheid and the grave breaches, each set against the '
        'evidence advanced for it and the body that made the finding.',
        'Genocide Convention, Apartheid Convention, Rome Statute, Fourth Geneva Convention.',
    ),
    'chart-events.json': (
        'Dated events for the series',
        'The events marked on the time series — ceasefires, offensives, crossings closed and '
        'reopened — so a change in a line can be read against what happened.',
        'OCHA situation reports and contemporaneous reporting.',
    ),
    'maps.json': (
        'Map geometry',
        'The boundaries, governorates and place points the maps are drawn from, joined to the '
        'data by name with the aliases resolved.',
        'Public-domain and openly licensed boundary data.',
    ),
    'nakba.json': (
        'The depopulated villages of 1948',
        'Each village depopulated in 1948 with its district, its population, the date and the '
        'means, mapped point by point.',
        'Walid Khalidi, All That Remains; Salman Abu Sitta, Atlas of Palestine.',
    ),
    'names.json': (
        'The identification list',
        'The named dead of Gaza as published by the Ministry of Health: name in Arabic and in '
        'English, age, sex and date of record. Two megabytes; loaded only on request.',
        'Gaza Ministry of Health, via Tech For Palestine (public domain).',
    ),
    'names-boot.json': (
        'A slice of the identification list',
        'A short excerpt of names.json, loaded while the record loads, so the count is not the '
        'only thing on screen.',
        'Gaza Ministry of Health, via Tech For Palestine (public domain).',
    ),
}

# Written by this script; not itself a dataset.
SKIP = {'index.json'}


def shape(blob):
    """Top-level field names, and a record count where one is meaningful."""
    if isinstance(blob, dict):
        fields = [k for k in blob.keys() if not k.startswith('_')]
        records = None
        for key in ('items', 'states', 'entries', 'villages', 'people', 'records'):
            if isinstance(blob.get(key), list):
                records = len(blob[key])
                break
        return fields[:12], records
    if isinstance(blob, list):
        first = blob[0] if blob else {}
        fields = list(first.keys())[:12] if isinstance(first, dict) else []
        return fields, len(blob)
    return [], None


def build():
    datasets = []
    missing = []
    for path in sorted(DATA.glob('*.json')):
        if path.name in SKIP:
            continue
        if path.name not in DESCRIPTIONS:
            missing.append(path.name)
            continue
        title, description, source = DESCRIPTIONS[path.name]
        raw = path.read_bytes()
        try:
            blob = json.loads(raw)
        except ValueError as err:
            raise SystemExit('manifest: %s is not valid JSON — %s' % (path.name, err))
        fields, records = shape(blob)
        datasets.append({
            'path': 'data/%s' % path.name,
            'title': title,
            'description': description,
            'source': source,
            'bytes': len(raw),
            'records': records,
            'fields': fields,
            'updated': datetime.date.fromtimestamp(path.stat().st_mtime).isoformat(),
        })

    if missing:
        raise SystemExit('manifest: no description for %s — add one to DESCRIPTIONS'
                         % ', '.join(missing))

    stale = [name for name in DESCRIPTIONS if not (DATA / name).exists()]
    if stale:
        raise SystemExit('manifest: DESCRIPTIONS names files that do not exist: %s'
                         % ', '.join(sorted(stale)))

    return {
        'name': 'The Documented Record — published data',
        'description': 'Every dataset behind the charts at palestinerecord.github.io, as plain '
                       'JSON over HTTPS, with no login and no key.',
        'site': 'https://palestinerecord.github.io/',
        'licence': LICENCE,
        'generated': datetime.date.today().isoformat(),
        'total_bytes': sum(d['bytes'] for d in datasets),
        'datasets': datasets,
    }


HEADLINE = DATA / 'headline.json'


def headline():
    """The eight figures on the first screen, in a file small enough to paint from.

    The overview used to wait for every dataset before it could put a number on
    screen. This file is about two kilobytes: it is fetched on its own, before
    anything else, so the record states what it establishes within a second and
    fills in behind that.
    """
    figures = json.loads((DATA / 'figures.json').read_text(encoding='utf-8'))
    series = json.loads((DATA / 'timeseries.json').read_text(encoding='utf-8'))
    meta = json.loads((DATA / 'report-meta.json').read_text(encoding='utf-8'))
    long_record = json.loads((DATA / 'long-record.json').read_text(encoding='utf-8'))
    chronology = json.loads((DATA / 'chronology.json').read_text(encoding='utf-8'))
    extra = json.loads((DATA / 'timeline-extra.json').read_text(encoding='utf-8'))
    sources = json.loads((DATA / 'sources.json').read_text(encoding='utf-8'))

    periods = long_record['asymmetry']['periods']
    now = periods[-1]
    timeline_count = chronology['meta']['count'] + len(extra['items'])

    return {
        'meta': {
            'generated': datetime.date.today().isoformat(),
            'data_to': series['meta']['last_month'],
            'last_daily_update': series['meta'].get('last_daily_update'),
            'note': 'The first screen, in one small file. Every figure here is repeated, '
                    'with its full note and source, in figures.json.',
        },
        'title': meta['title'],
        'headline': figures['headline'],
        'ratio': {
            'palestinian': now['palestinian'],
            'israeli': now['israeli'],
            'value': round(10 * now['palestinian'] / now['israeli']) / 10,
            'label': now.get('label', ''),
        },
        'counts': {
            'words': meta['stats']['words'],
            'parts': meta['stats']['parts'],
            'sections': meta['stats']['sections'],
            'tables': meta['stats']['tables'],
            'timeline': timeline_count,
            'sources': sum(len(g['items']) for g in sources['groups']),
            'bibliography': meta['bibliography_count'],
            'statements': meta['statement_count'],
        },
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true',
                    help='report what would change and write nothing')
    args = ap.parse_args()

    manifest = build()
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + '\n'

    if args.check:
        current = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
        # The generated date changes every day and says nothing about the data.
        same = json.loads(current or '{}').get('datasets') == manifest['datasets']
        print('manifest: %d datasets, %s bytes — %s'
              % (len(manifest['datasets']), format(manifest['total_bytes'], ','),
                 'unchanged' if same else 'would be rewritten'))
        return 0

    OUT.write_text(text, encoding='utf-8')
    head = json.dumps(headline(), ensure_ascii=False, separators=(',', ':')) + '\n'
    HEADLINE.write_text(head, encoding='utf-8')
    print('manifest: wrote %s — %d bytes' % (HEADLINE.relative_to(HERE), len(head)))
    print('manifest: wrote %s — %d datasets, %s bytes'
          % (OUT.relative_to(HERE), len(manifest['datasets']),
             format(manifest['total_bytes'], ',')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
