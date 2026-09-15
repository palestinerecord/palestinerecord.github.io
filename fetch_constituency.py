#!/usr/bin/env python3
"""Pull the raw UK parliamentary record for the constituency ledger.

Five sources, all open and none of them requiring a key:

    api.postcodes.io            postcode to constituency (used in the browser,
                                not here; recorded so the page can say where
                                the lookup goes)
    members-api.parliament.uk   every sitting MP and the seat they hold
    commonsvotes-api...         who voted which way in a named division
    interests-api.parliament.uk the Register of Members' Financial Interests
    search.electoralcommission  the register of political donations

Everything is written to data/raw and nothing is interpreted here, because the
interpretation belongs in constituency.py where it can be read beside what it
claims. The one interpretive act in this file is the list of search terms for
the donations register, which is stated in the open below rather than buried in
a URL.

    python3 fetch_constituency.py            # refresh every source
    python3 fetch_constituency.py --offline  # report what is already cached

The register of interests is only ever the *current* register: the API does not
serve entries a member has since removed, so the ledger states a position as it
stands today and cannot state one that has been withdrawn.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'data', 'raw')

AGENT = 'palestinerecord.github.io dashboard build (https://palestinerecord.github.io)'

# The divisions this record carries. The subject of a division cannot be taken
# from the API: the House titles them by procedural form, so the Commons vote on
# an immediate ceasefire in Gaza is published as "King's Speech Motion for an
# Address: Amendment (h)" and nothing in the machine record says otherwise. So
# the subject is curated here, each with the published count that identifies it
# beyond doubt, and the votes themselves are pulled rather than typed.
DIVISIONS = [1665, 1666, 2078]

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
        for name in ('uk_members.json', 'uk_divisions.json', 'uk_interests.json', 'uk_donations.json'):
            path = os.path.join(RAW, name)
            print('  %-28s %s' % (name, '%d bytes' % os.path.getsize(path)
                                  if os.path.exists(path) else 'missing'))
        return
    print('members')
    members = fetch_members()
    print('divisions')
    divisions = fetch_divisions()
    print('interests')
    interests = fetch_interests()
    print('donations')
    donations = fetch_donations()
    print('fetched %d sitting MPs, %d divisions, %d registered interests, %d reported donations'
          % (len(members), len(divisions), len(interests), len(donations)))


if __name__ == '__main__':
    main()
