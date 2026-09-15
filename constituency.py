#!/usr/bin/env python3
"""Build the constituency ledger: data/constituency.json.

The scorecard on this site holds a row for the United Kingdom, and Part XIII.3
of the report sets out what that row rests on. Both are addressed to a state.
This file cuts the same record along the axis a reader in Britain can actually
act on: the seat they live in, the member who holds it, how that member voted
when the House divided on Gaza, what the Register of Members' Financial
Interests records against their name, and what the Electoral Commission has
published about money reaching their party from organisations that campaign on
Israel's behalf.

Nothing here is an accusation. A registered interest is a disclosure the member
made under the rules, and a reported donation is a lawful, published gift. What
the ledger does is put the disclosure beside the vote, which is the one thing
the four registers cannot do for themselves because each is published on its
own.

    python3 constituency.py            # writes data/constituency.json
    python3 constituency.py --report   # writes nothing, prints the joins

Run fetch_constituency.py first; this file reads only the cache, so a build is
reproducible and does not depend on five services being up at once.
"""

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
RAW = os.path.join(DATA, 'raw')

# The subject of a division is curated because it cannot be taken from the
# machine record: the House titles a division by its procedural form, so the
# vote on an immediate ceasefire in Gaza is published under the title "King's
# Speech Motion for an Address: Amendment (h)" and nothing in the API says
# otherwise. Each entry therefore carries the counts that identify it beyond
# doubt, and the counts are checked against the pulled division on every build.
DIVISIONS = [
    {
        'id': 1666,
        'date': '2023-11-15',
        'title': 'An immediate ceasefire in Gaza',
        # A one-word name for the vote, so that a badge in a list of 649 rows
        # can say which division it belongs to without the reader counting
        # columns. It names the subject, never the side.
        'short': 'Ceasefire',
        # The title as it reads inside a sentence. A title lowercased in code
        # would lowercase Gaza with it, and the letter this page drafts is
        # sent to a member's office under the reader's own name.
        'in_sentence': 'an immediate ceasefire in Gaza',
        'formal': "King's Speech Motion for an Address: Amendment (h)",
        'moved': 'Moved by the Scottish National Party',
        'question': 'That the House call on the government to join the international community in '
                    'pressing all parties to agree to an immediate ceasefire.',
        'aye_means': 'for an immediate ceasefire',
        'no_means': 'against an immediate ceasefire',
        'result': 'Defeated',
        'ayes': 125,
        'noes': 293,
        'note': 'The first time the House divided on a ceasefire. Fifty-six Labour members voted for '
                'the amendment against the whip and ten of them left the front bench to do it, which '
                'is why this division, rather than the one that followed it, is the one the parties '
                'have been answering for since.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1666',
    },
    {
        'id': 1665,
        'date': '2023-11-15',
        'title': 'Extended humanitarian pauses, short of a ceasefire',
        'short': 'Pauses',
        'in_sentence': 'extending the humanitarian pauses, short of a ceasefire',
        'formal': "King's Speech Motion for an Address: Amendment (r)",
        'moved': 'Moved by the Labour front bench',
        'question': 'That the existing daily humanitarian pauses be extended to allow aid in at '
                    'sufficient scale, as a step towards an enduring cessation of fighting as soon '
                    'as possible.',
        'aye_means': 'for extended pauses rather than a ceasefire',
        'no_means': 'against extended pauses',
        'result': 'Defeated',
        'ayes': 183,
        'noes': 290,
        'note': 'Taken on the same afternoon as the ceasefire amendment and worded to stop short of '
                'one. It is in the ledger because the pair is the point: a member could vote for '
                'pauses and against a ceasefire on the same day, and 183 did.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1665',
    },
    {
        'id': 2078,
        'date': '2025-07-02',
        'title': 'Proscribing Palestine Action as a terrorist organisation',
        'short': 'Proscription',
        'in_sentence': 'proscribing Palestine Action as a terrorist organisation',
        'formal': 'Terrorism Act 2000 (Proscribed Organisations) (Amendment) Order 2025',
        'moved': 'Moved by the Home Secretary',
        'question': 'That the draft Order, proscribing Palestine Action alongside the Russian '
                    'Imperial Movement and Maniacs Murder Cult, be approved.',
        'aye_means': 'for the proscription',
        'no_means': 'against the proscription',
        'result': 'Approved',
        'ayes': 385,
        'noes': 26,
        'note': 'The Order did not put Palestine Action to the House on its own. It proscribed the '
                'group in one instrument with two violent neo-Nazi organisations, so that a member '
                'who objected to treating a non-violent direct-action group as terrorist could not '
                'say so without also voting to leave the other two unproscribed. A vote here is '
                'therefore weaker evidence of a view than a vote on the ceasefire, and the ledger '
                'says so rather than counting it as though it were clean.',
        'source': 'https://votes.parliament.uk/votes/commons/division/2078',
    },
]

# What is looked for in the Register of Members' Financial Interests. The
# register has no subject index, so this list is the whole of what the ledger
# can see: an interest recorded under a name not matched here is not in it.
INTEREST_TERMS = re.compile(
    r'\bisrael|\bpalestin|friends of israel|jewish national fund|\bzionis|elbit|\bbicom\b|elnet',
    re.I)

# The same for the donations register. Both lists are published on the page.
DONATION_TERMS = re.compile(
    r'\bisrael|friends of israel|\bzionis|elnet|jewish national fund|\bbicom\b', re.I)

VOTE_ABSENT = 'absent'
VOTE_AWAY = 'not-a-member'


def load_raw(name):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        raise SystemExit('missing %s — run fetch_constituency.py first' % path)
    with open(path) as fh:
        return json.load(fh)


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def slug(text):
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(c for c in text if not unicodedata.combining(c))
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', text.lower())).strip('-')


def money(text):
    """The Commission publishes a value as '£15,673.00'."""
    digits = re.sub(r'[^0-9.]', '', text or '')
    try:
        return float(digits)
    except ValueError:
        return 0.0


def field(interest, name):
    for f in interest.get('fields') or []:
        if f.get('name') == name:
            return f.get('value')
    return None


def interest_row(interest):
    """One registered interest, reduced to what the ledger states about it."""
    row = {
        'category': interest['category']['name'],
        'number': interest['category']['number'],
        'summary': (interest.get('summary') or '').strip(),
        'registered': (interest.get('registrationDate') or '')[:10],
    }
    for key, name in (('sponsor', 'DonorName'), ('purpose', 'VisitPurpose'),
                      ('destination', 'VisitDestination'), ('value', 'Value'),
                      ('start', 'VisitStartDate'), ('end', 'VisitEndDate')):
        value = field(interest, name)
        if value not in (None, '', False):
            row[key] = value
    return row


def donation_row(row):
    return {
        'ref': row['ECRef'],
        'donor': row['DonorName'],
        'to': row['RegulatedEntityName'],
        'unit': row.get('AccountingUnitName') or '',
        'entity': row['RegulatedEntityType'],
        'value': money(row['Value']),
        'date': row['AcceptedDate'],
        'type': row.get('DonationType') or '',
        'nature': row.get('NatureOfDonation') or '',
        'purpose': row.get('PurposeOfVisit') or '',
    }


def build():
    members = load_raw('uk_members.json')
    divisions = {d['DivisionId']: d for d in load_raw('uk_divisions.json')}
    interests = load_raw('uk_interests.json')
    donations = load_raw('uk_donations.json')
    statements = load('statements.json')['items']

    # A division is identified by its published counts, not by its title, so a
    # renumbering upstream fails the build rather than silently relabelling a
    # vote — which is the one error in this file a reader could not detect.
    for spec in DIVISIONS:
        got = divisions.get(spec['id'])
        if got is None:
            raise SystemExit('division %d is not in the cache' % spec['id'])
        if (got['AyeCount'], got['NoCount']) != (spec['ayes'], spec['noes']):
            raise SystemExit('division %d now reads %d/%d, not the %d/%d this file describes'
                             % (spec['id'], got['AyeCount'], got['NoCount'],
                                spec['ayes'], spec['noes']))

    # Who voted how, by member id rather than by seat: the 2024 election redrew
    # the boundaries, so a member who voted in 2023 did so for a constituency
    # that in several cases no longer exists. Attributing a vote to a person and
    # naming the seat they held at the time is the only way to carry a
    # pre-election division into a present-day ledger honestly.
    votes = {}
    seats_then = {}
    for spec in DIVISIONS:
        got = divisions[spec['id']]
        cast = {}
        for side, name in (('Ayes', 'aye'), ('Noes', 'no'), ('NoVoteRecorded', VOTE_ABSENT)):
            for member in got.get(side) or []:
                cast[member['MemberId']] = name
                seats_then.setdefault((member['MemberId'], spec['id']), member.get('MemberFrom') or '')
        for teller_side, name in (('AyeTellers', 'aye'), ('NoTellers', 'no')):
            for member in got.get(teller_side) or []:
                # A teller does not vote but is unambiguously on that side.
                cast.setdefault(member['MemberId'], name + '-teller')
                seats_then.setdefault((member['MemberId'], spec['id']), member.get('MemberFrom') or '')
        votes[spec['id']] = cast

    by_member_interests = defaultdict(list)
    for interest in interests:
        blob = (interest.get('summary') or '') + ' ' + json.dumps(interest.get('fields') or [],
                                                                  ensure_ascii=False)
        if INTEREST_TERMS.search(blob):
            by_member_interests[interest['member']['id']].append(interest_row(interest))

    # Donations reach a member in two ways: directly, where the Commission
    # records the member as the regulated entity, and through the party, where
    # they do not. Only the first can be put against a name; the second is
    # carried as a party total and labelled as such, because attributing a
    # party donation to an individual member would be an invention.
    to_member = defaultdict(list)
    by_party = defaultdict(lambda: {'total': 0.0, 'count': 0, 'donors': defaultdict(float)})
    all_rows = []
    for row in donations:
        if not DONATION_TERMS.search(row['DonorName'] or ''):
            continue
        clean = donation_row(row)
        all_rows.append(clean)
        if clean['entity'] in ('Regulated Donee', 'Permitted Participant', 'Members Association'):
            to_member[slug(re.sub(r'\s*\(.*?\)\s*', ' ', clean['to']))].append(clean)
        else:
            bucket = by_party[clean['to']]
            bucket['total'] += clean['value']
            bucket['count'] += 1
            bucket['donors'][clean['donor']] += clean['value']

    # A member who is quoted in the record is shown their own words. The join is
    # the speaker slug, the same one the statements route uses.
    by_speaker = defaultdict(list)
    for index, item in enumerate(statements):
        by_speaker[slug(item['speaker'])].append(index)

    rows = []
    constituencies = {}
    for member in members:
        seat = (member.get('latestHouseMembership') or {}).get('membershipFrom') or ''
        party = (member.get('latestParty') or {})
        name = member['nameDisplayAs']
        # The Commission and the House write a member's name differently: one
        # keeps the honorific, the other does not. Matching on the bare name is
        # what joins them.
        bare = re.sub(r'^(rt hon |sir |dame |dr |mr |mrs |ms |miss |lord |baroness )+', '',
                      name.lower()).strip()
        row = {
            'id': member['id'],
            'name': name,
            'party': party.get('name') or '',
            'abbr': party.get('abbreviation') or '',
            'colour': party.get('backgroundColour') or '',
            'seat': seat,
            'slug': slug(seat),
            # The start of the member's current unbroken service, which is
            # what the API returns and is not the same as the date they first
            # entered the House: a member who served, left and won a later
            # by-election carries the by-election date here, and this House
            # contains one. It is recorded so that the ledger can be checked,
            # not so that a vote can be inferred from it. The division lists
            # are the authority for who was there, and they are what the votes
            # below are read from.
            'since': ((member.get('latestHouseMembership') or {}).get('membershipStartDate') or '')[:10],
            'votes': {},
        }
        for spec in DIVISIONS:
            cast = votes[spec['id']].get(member['id'])
            if cast is None:
                # Not in the House on the day. The distinction matters: an
                # absence is a choice and a later arrival is not, and a ledger
                # that showed them the same way would be accusing members of
                # missing votes taken before they were elected.
                row['votes'][str(spec['id'])] = VOTE_AWAY
            else:
                row['votes'][str(spec['id'])] = cast
                held = seats_then.get((member['id'], spec['id']), '')
                if held and held != seat:
                    row.setdefault('seats_then', {})[str(spec['id'])] = held
        found = by_member_interests.get(member['id'])
        if found:
            row['interests'] = found
        gifts = to_member.get(slug(bare))
        if gifts:
            row['donations'] = sorted(gifts, key=lambda g: g['date'], reverse=True)
        quoted = by_speaker.get(slug(bare)) or by_speaker.get(slug(name))
        if quoted:
            row['statements'] = quoted
        rows.append(row)
        constituencies[seat] = len(rows) - 1

    rows.sort(key=lambda r: r['seat'])
    constituencies = {r['seat']: i for i, r in enumerate(rows)}

    tallies = []
    for spec in DIVISIONS:
        cast = votes[spec['id']]
        sitting = [r for r in rows if not r['votes'][str(spec['id'])] == VOTE_AWAY]
        counted = defaultdict(int)
        for row in sitting:
            counted[row['votes'][str(spec['id'])].replace('-teller', '')] += 1
        tallies.append(dict(spec, sitting=len(sitting), still_here=dict(counted)))

    parties = sorted(({'name': name, 'total': round(v['total'], 2), 'donations': v['count'],
                       'donors': sorted(({'name': d, 'total': round(t, 2)}
                                         for d, t in v['donors'].items()),
                                        key=lambda d: -d['total'])}
                      for name, v in by_party.items()), key=lambda p: -p['total'])

    with_interest = sum(1 for r in rows if r.get('interests'))
    with_donation = sum(1 for r in rows if r.get('donations'))

    data = {
        'meta': {
            'title': 'The constituency ledger',
            'note': 'Every seat in the House of Commons, the member who holds it, how they voted '
                    'when the House divided on Gaza, what the Register of Members’ Financial '
                    'Interests records against their name, and what the Electoral Commission has '
                    'published about money reaching their party from organisations that campaign '
                    'on Israel’s behalf. Four public registers, none of which is published '
                    'beside the others.',
            'source': 'members-api.parliament.uk; commonsvotes-api.parliament.uk; '
                      'interests-api.parliament.uk; search.electoralcommission.org.uk',
            'lookup': 'https://api.postcodes.io/postcodes/',
            'members': len(rows),
            'seats': len(constituencies),
            'divisions': len(DIVISIONS),
            'interests': sum(len(r.get('interests') or []) for r in rows),
            'members_with_interest': with_interest,
            'donations': len(all_rows),
            'donations_to_members': sum(len(r.get('donations') or []) for r in rows),
            'members_with_donation': with_donation,
            'party_total': round(sum(p['total'] for p in parties), 2),
            'register_terms': INTEREST_TERMS.pattern,
            'donation_terms': DONATION_TERMS.pattern,
        },
        'divisions': tallies,
        'members': rows,
        'seats': constituencies,
        'parties': parties,
    }

    assert len({r['seat'] for r in rows}) == len(rows), 'two members hold the same seat'
    assert all(r['seat'] for r in rows), 'a member holds no named seat'
    return data


def main():
    data = build()
    if '--report' in sys.argv:
        meta = data['meta']
        for spec in data['divisions']:
            print('%s  %-52s %4d/%-4d  %d still sitting %s'
                  % (spec['date'], spec['title'][:52], spec['ayes'], spec['noes'],
                     spec['sitting'], spec['still_here']))
        print('%d members, %d with a registered interest, %d with a reported donation'
              % (meta['members'], meta['members_with_interest'], meta['members_with_donation']))
        for party in data['parties'][:6]:
            print('  £%12s  %-40s %d donations' % ('{:,.0f}'.format(party['total']),
                                                   party['name'][:40], party['donations']))
        return
    path = os.path.join(DATA, 'constituency.json')
    with open(path, 'w') as fh:
        fh.write(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    meta = data['meta']
    print('constituency.json — %d seats, %d divisions, %d registered interests against %d members, '
          '%d reported donations' % (meta['seats'], meta['divisions'], meta['interests'],
                                     meta['members_with_interest'], meta['donations']))


if __name__ == '__main__':
    main()
