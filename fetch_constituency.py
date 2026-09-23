#!/usr/bin/env python3
"""Pull the raw UK parliamentary record for the constituency ledger.

Seven sources, all open and none of them requiring a key:

    api.postcodes.io            postcode to constituency (used in the browser,
                                not here; recorded so the page can say where
                                the lookup goes)
    members-api.parliament.uk   every sitting MP, the seat they hold, and when
                                they have sat before
    commonsvotes-api...         who voted which way in a named division
    hansard-api.parliament.uk   the divisions older than the votes API, and the
                                debates, contribution by contribution
    interests-api.parliament.uk the Register of Members' Financial Interests
    search.electoralcommission  the register of political donations
    petition.parliament.uk      the petitions, with signatures by constituency

Everything is written to data/raw and nothing is interpreted here, because the
interpretation belongs in constituency.py where it can be read beside what it
claims. The one interpretive act in this file is the list of search terms for
the donations register, which is stated in the open below rather than buried in
a URL.

    python3 fetch_constituency.py            # refresh every source
    python3 fetch_constituency.py --offline  # report what is already cached

The debate transcripts are cached one file per debate under data/raw/hansard,
which is not committed: it is tens of megabytes of text that the fetch can
always rebuild, and only what constituency.py derives from it is published.
A transcript already cached is not fetched again unless the sitting was in the
last thirty days, since Hansard corrects the record for a few weeks and then
stops.

The register of interests is only ever the *current* register: the API does not
serve entries a member has since removed, so the ledger states a position as it
stands today and cannot state one that has been withdrawn.
"""

import csv
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'data', 'raw')
HANSARD = os.path.join(RAW, 'hansard')

AGENT = 'palestinerecord.github.io dashboard build (https://palestinerecord.github.io)'

# The divisions this record carries. The subject of a division cannot be taken
# from the API: the House titles them by procedural form, so the Commons vote on
# an immediate ceasefire in Gaza is published as "King's Speech Motion for an
# Address: Amendment (h)" and nothing in the machine record says otherwise. So
# the subject is curated here, each with the published count that identifies it
# beyond doubt, and the votes themselves are pulled rather than typed.
DIVISIONS = [1586, 1665, 1666, 1705, 2078]

# Divisions older than the votes API, which begins in 2016, are read from the
# Hansard API by their external id. The 2014 motion to recognise the State of
# Palestine is the only one this ledger carries.
HANSARD_DIVISIONS = ['1410142000423']

# What makes a petition or a debate part of this ledger. The petitions site and
# Hansard both search their text loosely, so every result is tested against
# this expression and kept only if it matches. Stated here, and printed on the
# page, for the same reason as the donation terms: what the ledger cannot see
# should be visible rather than guessed at.
SUBJECT = re.compile(r'palestin|\bgaza|israel|west bank|\bzionis|\bhamas|netanyahu|'
                     r'occupied territor|golan|\bunrwa\b|\brafah\b|\be1\b', re.I)

PETITION_SEARCHES = ['Palestine', 'Palestinian', 'Gaza', 'Israel', 'ceasefire']
# A petition is carried if the government had to answer it or MPs debated it.
PETITION_THRESHOLD = 10000

DEBATE_SEARCHES = ['Gaza', 'Israel', 'Palestine', 'Palestinian', 'Middle East', 'West Bank']
DEBATES_SINCE = '2023-10-07'

MOTION_SEARCHES = ['Gaza', 'Palestine', 'Palestinian', 'Israel', 'Israeli', 'West Bank', 'UNRWA',
                   'Nakba', 'Rafah', 'Occupied', 'flotilla', 'Elbit', 'genocide', 'Hamas', 'Netanyahu']

# What the donations register is searched for. The register has no subject
# index, so an organisation that gives to a party under a name not on this list
# is not in the ledger — which is why the page says the search terms out loud.
DONATION_TERMS = [
    'israel',
    'elnet',
    'palestine',
    'conservative friends of israel',
    'labour friends of israel',
    'liberal democrat friends of israel',
    'zionist',
]

DONATIONS_URL = (
    'https://search.electoralcommission.org.uk/api/csv/Donations'
    '?start=0&rows=2000&query=%s&sort=AcceptedDate&order=desc'
    '&et=pp&et=ppm&et=tp&et=perpar&et=rd'
    '&isIrishSourceYes=true&isIrishSourceNo=true&includeOutsideSection75=true'
)


def get(url, tries=4):
    request = urllib.request.Request(url, headers={'User-Agent': AGENT})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(request, timeout=90) as fh:
                return fh.read()
        except Exception as err:  # the APIs rate-limit rather than fail outright
            if attempt == tries - 1:
                raise
            print('  retry %d/%d after %s' % (attempt + 1, tries - 1, err))
            time.sleep(3 * (attempt + 1))


def get_json(url):
    return json.loads(get(url).decode('utf-8'))


def write(name, blob):
    path = os.path.join(RAW, name)
    with open(path, 'w') as fh:
        fh.write(json.dumps(blob, ensure_ascii=False) + '\n')
    print('  %-28s %8d bytes' % (name, os.path.getsize(path)))
    return blob


def paged(url, take, total_cap):
    """Both Parliament APIs cap `take` well below what they advertise."""
    items, skip = [], 0
    while skip < total_cap:
        page = get_json(url % (skip, take)).get('items') or []
        if not page:
            break
        items += page
        skip += len(page)
    return items


def fetch_members():
    url = ('https://members-api.parliament.uk/api/Members/Search'
           '?House=1&IsCurrentMember=true&skip=%d&take=%d')
    rows = [x['value'] for x in paged(url, 20, 800)]
    return write('uk_members.json', rows)


def fetch_divisions():
    out = []
    for division in DIVISIONS:
        out.append(get_json('https://commonsvotes-api.parliament.uk/data/division/%d.json' % division))
    return write('uk_divisions.json', out)


def fetch_hansard_divisions():
    return write('uk_divisions_hansard.json',
                 [get_json('https://hansard-api.parliament.uk/debates/division/%s.json' % ext)
                  for ext in HANSARD_DIVISIONS])


def fetch_history(members):
    """Every earlier stretch of service for members whose current one is recent.

    The votes API lists every sitting member in a division, voting or not, so
    an absence there is exact. Hansard's older division records list only the
    members who voted, so telling an absence from a later arrival needs the
    member's own history: a member who sat in 2014, lost the seat and came back
    at a by-election is absent from the 2014 list for a different reason from a
    member first elected in 2024.
    """
    oldest = '2014-10-13'  # the oldest division the ledger carries
    out = {}
    for m in members:
        since = ((m.get('latestHouseMembership') or {}).get('membershipStartDate') or '')[:10]
        if since and since <= oldest:
            continue
        spells = get_json('https://members-api.parliament.uk/api/Members/%d/Biography' % m['id'])
        out[str(m['id'])] = [
            {'from': (h.get('startDate') or '')[:10], 'to': (h.get('endDate') or '')[:10],
             'seat': h.get('name') or ''}
            for h in (spells.get('value') or {}).get('houseMemberships') or []
            if h.get('house') == 1]
    return write('uk_member_history.json', out)


def fetch_petitions():
    """Every petition on the subject that reached a response or a debate."""
    ids = {}
    for kind, base in (('current', 'https://petition.parliament.uk/petitions.json'),
                       ('archived', 'https://petition.parliament.uk/archived/petitions.json')):
        for term in PETITION_SEARCHES:
            for page in range(1, 40):
                listing = get_json('%s?q=%s&state=all&page=%d' % (base, urllib.parse.quote(term), page))
                for item in listing.get('data') or []:
                    a = item['attributes']
                    text = (a.get('action') or '') + ' ' + (a.get('background') or '')
                    if not SUBJECT.search(text):
                        continue
                    if (a.get('signature_count') or 0) >= PETITION_THRESHOLD or a.get('debate'):
                        ids[(kind, item['id'])] = True
                if not (listing.get('links') or {}).get('next'):
                    break
    out = []
    for kind, pid in sorted(ids):
        url = ('https://petition.parliament.uk/%spetitions/%d.json'
               % ('archived/' if kind == 'archived' else '', pid))
        a = get_json(url)['data']['attributes']
        # Country and region breakdowns are not used, and are most of the size.
        for key in ('signatures_by_country', 'signatures_by_region'):
            a.pop(key, None)
        a['id'], a['parliament'] = pid, kind
        out.append(a)
    return write('uk_petitions.json', out)


def fetch_debates():
    """The Commons and Westminster Hall debates on the subject, one file each."""
    os.makedirs(HANSARD, exist_ok=True)
    today = datetime.date.today().isoformat()
    found = {}
    for term in DEBATE_SEARCHES:
        for skip in range(0, 2000, 100):
            url = ('https://hansard-api.parliament.uk/search/debates.json'
                   '?queryParameters.searchTerm=%s&queryParameters.startDate=%s'
                   '&queryParameters.endDate=%s&queryParameters.house=Commons'
                   '&queryParameters.skip=%d&queryParameters.take=100'
                   % (urllib.parse.quote(term), DEBATES_SINCE, today, skip))
            results = get_json(url).get('Results') or []
            for r in results:
                if SUBJECT.search(r.get('Title') or '') or 'middle east' in (r.get('Title') or '').lower():
                    found[r['DebateSectionExtId']] = (r.get('SittingDate') or '')[:10]
            if len(results) < 100:
                break
    recent = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
    fetched = 0
    for ext, sitting in sorted(found.items(), key=lambda kv: kv[1]):
        path = os.path.join(HANSARD, '%s.json' % ext)
        if os.path.exists(path) and sitting < recent:
            continue
        blob = get_json('https://hansard-api.parliament.uk/debates/debate/%s.json' % ext)
        with open(path, 'w') as fh:
            fh.write(json.dumps(blob, ensure_ascii=False))
        fetched += 1
    index = [{'ext': ext, 'date': sitting} for ext, sitting in sorted(found.items(), key=lambda kv: kv[1])]
    write('uk_debates.json', index)
    print('  %d debates, %d fetched now, the rest cached' % (len(index), fetched))
    return index


def fetch_motions():
    """Every early day motion on the subject since 7 October 2023, with who signed it.

    An early day motion is a statement a member puts their name to: it is almost
    never debated, and signing one is the most direct record the House keeps of
    what a backbencher says they want done. The API's search is loose, so each
    result is kept only if its title or text matches SUBJECT, and amendments to a
    motion are left out: the motion is what members signed.
    """
    base = 'https://oralquestionsandmotions-api.parliament.uk'
    found = {}
    for term in MOTION_SEARCHES:
        for skip in range(0, 3000, 100):
            url = ('%s/EarlyDayMotions/list?parameters.searchTerm=%s'
                   '&parameters.tabledStartDate=%s&parameters.take=100&parameters.skip=%d'
                   % (base, urllib.parse.quote(term), DEBATES_SINCE, skip))
            results = get_json(url).get('Response') or []
            for r in results:
                if r.get('AmendmentToMotionId'):
                    continue
                if SUBJECT.search((r.get('Title') or '') + ' ' + (r.get('MotionText') or '')):
                    found[r['Id']] = r
            if len(results) < 100:
                break
    out = []
    for mid, r in sorted(found.items()):
        detail = get_json('%s/EarlyDayMotion/%d' % (base, mid)).get('Response') or {}
        out.append({
            'id': mid,
            'date': (r.get('DateTabled') or '')[:10],
            'title': r.get('Title') or '',
            'text': r.get('MotionText') or '',
            'sponsor': (r.get('PrimarySponsor') or {}).get('Name') or '',
            # A withdrawn signature is kept apart with its date: constituency.py
            # decides whether the withdrawal was the member's own.
            'signed': sorted(s['MemberId'] for s in detail.get('Sponsors') or []
                             if not s.get('IsWithdrawn')),
            'withdrawn': sorted([s['MemberId'], (s.get('WithdrawnDate') or '')[:10]]
                                for s in detail.get('Sponsors') or [] if s.get('IsWithdrawn')),
        })
        time.sleep(0.2)
    write('uk_motions.json', out)
    print('  %d motions, %d signatures' % (len(out), sum(len(m['signed']) for m in out)))
    return out


def fetch_interests():
    url = 'https://interests-api.parliament.uk/api/v1/Interests?Skip=%d&Take=%d'
    return write('uk_interests.json', paged(url, 20, 8000))


def fetch_donations():
    rows = {}
    for term in DONATION_TERMS:
        text = get(DONATIONS_URL % urllib.parse.quote(term)).decode('utf-8-sig')
        found = list(csv.DictReader(io.StringIO(text)))
        print('  %-40s %5d rows' % (term, len(found)))
        for row in found:
            # ECRef is the Commission's own reference for a reported donation,
            # so it is what de-duplicates a donation found by two search terms.
            rows[row['ECRef']] = row
    return write('uk_donations.json', list(rows.values()))


def main():
    if '--offline' in sys.argv:
        for name in ('uk_members.json', 'uk_divisions.json', 'uk_divisions_hansard.json',
                     'uk_member_history.json', 'uk_interests.json', 'uk_donations.json',
                     'uk_petitions.json', 'uk_debates.json', 'uk_motions.json'):
            path = os.path.join(RAW, name)
            print('  %-28s %s' % (name, '%d bytes' % os.path.getsize(path)
                                  if os.path.exists(path) else 'missing'))
        return
    print('members')
    members = fetch_members()
    print('divisions')
    divisions = fetch_divisions() + fetch_hansard_divisions()
    print('history')
    fetch_history(members)
    print('petitions')
    petitions = fetch_petitions()
    print('debates')
    debates = fetch_debates()
    print('motions')
    motions = fetch_motions()
    print('interests')
    interests = fetch_interests()
    print('donations')
    donations = fetch_donations()
    print('fetched %d sitting MPs, %d divisions, %d petitions, %d debates, %d motions, '
          '%d registered interests, %d reported donations'
          % (len(members), len(divisions), len(petitions), len(debates), len(motions),
             len(interests), len(donations)))


if __name__ == '__main__':
    main()
