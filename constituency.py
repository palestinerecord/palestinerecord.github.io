#!/usr/bin/env python3
"""Build the constituency ledger: data/constituency.json.

The scorecard on this site holds a row for the United Kingdom, and Part XIII.3
of the report sets out what that row rests on. Both are addressed to a state.
This file cuts the same record along the axis a reader in Britain can actually
act on: the seat they live in, the member who holds it, how that member voted
each time the House divided on Palestine, what they said when it debated it,
how many people in the seat signed the petitions that reached Parliament, what
the Register of Members' Financial Interests records against their name, and
what the Electoral Commission has published about money reaching their party
from organisations that campaign on Israel's behalf.

It writes two files. data/constituency.json is everything the page needs to
draw the list and filter it. data/constituency-speeches.json holds the words:
an excerpt of every contribution a sitting member made to a debate on the
subject, which is several times the size of the rest and is only fetched when a
reader opens a member's row.

Nothing here is an accusation. A registered interest is a disclosure the member
made under the rules, and a reported donation is a lawful, published gift. What
the ledger does is put the disclosure beside the vote, which is the one thing
the four registers cannot do for themselves because each is published on its
own.

    python3 constituency.py            # writes both files
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
        'topic': 'ceasefire',
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
                'the amendment against a whip to abstain, and ten Labour frontbenchers left their posts '
                'over it: four shadow ministers resigned beforehand in order to vote for it, four were '
                'sacked afterwards, and two parliamentary aides stood down. That is why this division, '
                'rather than the one taken with it, is the one the parties have been answering for since.',
        'plain': 'MPs were asked whether the United Kingdom should call for an immediate ceasefire. A vote '
                 '\u201cfor\u201d was a vote for a ceasefire. It lost by 125 to 293, so the House of '
                 'Commons did not call for one.',
        'pro_side': 'aye',
        'pro_reason': 'A vote for an immediate ceasefire.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1666',
    },
    {
        'id': 1665,
        'topic': 'ceasefire',
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
                'one. It is in the ledger because the pair is the point. Of the 183 members who voted '
                'for pauses, 62 also voted for the ceasefire and 121 did not vote on it; none voted '
                'against it. The 290 against pauses were almost all Conservatives voting down an '
                'opposition amendment, not members who wanted less aid.',
        'plain': 'Labour\u2019s alternative to a ceasefire: longer pauses in the fighting so that more aid '
                 'could get in. It also lost. Because supporters of a ceasefire and opponents of one both '
                 'voted for it, a vote here does not show which side a member took on the war, and this '
                 'ledger does not count it either way.',
        'pro_side': None,
        'pro_reason': 'Not counted: ceasefire supporters and opponents voted on both sides of it.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1665',
    },
    {
        'id': 2078,
        'topic': 'proscription',
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
        'plain': 'This made it a crime to belong to or support Palestine Action, a direct-action group '
                 'that broke into and damaged sites of Elbit Systems, Israel\u2019s largest arms maker, and '
                 'RAF aircraft at Brize Norton, using the same law as for terrorist groups. Since then, '
                 'people holding signs in its support have been arrested under that law. Because two '
                 'violent neo-Nazi groups were banned in the same vote, voting \u201cagainst\u201d also meant '
                 'voting not to ban them.',
        'pro_side': 'no',
        'pro_reason': 'A vote against treating a Palestine solidarity direct-action group as terrorist. '
                      'Weaker evidence than the others, because of the two groups banned with it.',
        'source': 'https://votes.parliament.uk/votes/commons/division/2078',
    },
    {
        'id': 'h2014',
        'hansard': '1410142000423',
        'topic': 'recognition',
        'date': '2014-10-13',
        'title': 'Recognising the State of Palestine alongside Israel',
        'short': 'Recognition',
        'in_sentence': 'recognising the State of Palestine alongside the State of Israel',
        'formal': 'Palestine and Israel (Backbench Business motion), Division 54',
        'moved': 'Moved by Grahame Morris, from the Labour back benches',
        'question': 'That this House believes that the Government should recognise the state of '
                    'Palestine alongside the state of Israel, as a contribution to securing a '
                    'negotiated two state solution.',
        'aye_means': 'for recognising the State of Palestine',
        'no_means': 'against recognition',
        'result': 'Agreed',
        'ayes': 274,
        'noes': 12,
        'note': 'A backbench motion, which does not bind the government, and the government did not '
                'act on it for eleven years: the United Kingdom recognised the State of Palestine on '
                '21 September 2025. Those opposed to the motion declined to put up tellers, so two '
                'of its supporters, Jeremy Corbyn and Mike Wood, told for the Noes so that the vote '
                'could be recorded by name at all; Corbyn said so from the floor immediately '
                'afterwards. The division list therefore names him on the side he opposed, and this '
                'ledger shows him as a teller who forced the vote rather than as a vote against. '
                'The Commons votes service does not carry a division this old, so it is read from '
                'Hansard, which lists only those who voted; a member is shown as not voting only where '
                'their own record of service puts them in the House that day.',
        'plain': 'MPs told the government, by a large majority, that it should recognise Palestine as a '
                 'state. The vote was advice, not law, so nothing changed until the government decided '
                 'to do it itself eleven years later.',
        'pro_side': 'aye',
        'pro_reason': 'A vote for recognising the State of Palestine.',
        'source': 'https://hansard.parliament.uk/Commons/2014-10-13/debates/14101322000001/PalestineAndIsrael',
        # Members who told for a side they did not hold, on the record, so that
        # a division could take place. Keyed by member id.
        'procedural_tellers': {185: 'Told for the Noes so that the vote could be recorded; supported the motion'},
    },
    {
        'id': 1586,
        'topic': 'boycott',
        'date': '2023-07-03',
        'title': 'The anti-boycott Bill: second reading',
        'short': 'Boycott Bill',
        'in_sentence': 'the second reading of the Economic Activity of Public Bodies (Overseas Matters) '
                       'Bill, which would have barred public bodies from boycotting Israel or the '
                       'settlements',
        'formal': 'Economic Activity of Public Bodies (Overseas Matters) Bill: Second Reading',
        'moved': 'Moved by the Conservative government',
        'question': 'That the Bill be now read a second time.',
        'aye_means': 'for the Bill',
        'no_means': 'against the Bill',
        'result': 'Agreed',
        'ayes': 268,
        'noes': 70,
        'note': 'The Bill barred public bodies from purchasing and investment decisions influenced '
                'by political or moral disapproval of a foreign state, and its clause 3(7) named '
                'Israel, the Occupied Palestinian Territories and the occupied Golan Heights as the '
                'only places a minister could not exempt by regulation. The vote was taken straight '
                'after a reasoned amendment declining the Bill a second reading, moved '
                'from the Labour benches, fell by 212 to 272. The Bill itself then passed by 268 to '
                '70 because most Labour members did not vote on it: the division list records 184 '
                'Labour members with no vote. On this division an absence was the party\u2019s '
                'position rather than a member\u2019s own choice, and is weaker evidence of a view '
                'than an absence on the others.',
        'plain': 'The Bill would have stopped councils, universities, pension funds and other public bodies '
                 'from refusing, on ethical grounds, to buy from or invest in Israel or the illegal '
                 'settlements. A vote \u201cfor\u201d supported that ban on boycotts.',
        'pro_side': 'no',
        'pro_reason': 'A vote against barring public bodies from boycotting Israel and the settlements.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1586',
    },
    {
        'id': 1705,
        'topic': 'boycott',
        'date': '2024-01-10',
        'title': 'The anti-boycott Bill: third reading',
        'short': 'Boycott Bill, 3rd',
        'in_sentence': 'the third reading of the Economic Activity of Public Bodies (Overseas Matters) '
                       'Bill',
        'formal': 'Economic Activity of Public Bodies (Overseas Matters) Bill: Third Reading',
        'moved': 'Moved by the Conservative government',
        'question': 'That the Bill be now read the third time.',
        'aye_means': 'for the Bill',
        'no_means': 'against the Bill',
        'result': 'Agreed',
        'ayes': 282,
        'noes': 235,
        'note': 'The last Commons vote on the Bill, and the one on which the Labour front bench voted '
                'against it. The Bill went to the Lords, was still in committee there when Parliament '
                'was dissolved for the 2024 election, and was lost in the wash-up; it never became '
                'law.',
        'plain': 'The final Commons vote on the same anti-boycott Bill. It passed the Commons, then ran '
                 'out of time in the House of Lords before the 2024 election, so it never became law.',
        'pro_side': 'no',
        'pro_reason': 'A vote against barring public bodies from boycotting Israel and the settlements.',
        'source': 'https://votes.parliament.uk/votes/commons/division/1705',
    },
]

# The order the divisions are shown in: newest first, since the newest is the
# one a sitting member is most likely to be asked about.
DIVISION_ORDER = ['2078', '1666', '1665', '1705', '1586', 'h2014']

# The one day the House was asked about a ceasefire and no division list exists.
# Recorded so that the page does not imply that silence means no vote was held.
UNRECORDED = [
    {
        'date': '2024-02-21',
        'title': 'The SNP opposition day motion for an immediate ceasefire',
        'note': 'Against the convention that only a government amendment is selected on an '
                'opposition day, the Speaker selected a Labour amendment as well. The government '
                'withdrew from the proceedings, the Labour amendment calling for an immediate '
                'humanitarian ceasefire was agreed without a division, and the motion as amended was '
                'then agreed without one, so the SNP\u2019s own wording was never voted on and no '
                'member\u2019s position that day is on the record. The only division was a motion to '
                'sit in private, moved in protest, which was not a vote on Gaza and is not carried here.',
        'plain': 'The House of Commons did call for an immediate humanitarian ceasefire that day, but '
                 'without a recorded vote, so there is no list of who supported it.',
        'source': 'https://hansard.parliament.uk/Commons/2024-02-21/debates/610A4D12-A333-4885-9D0B-0A225C35C043/CeasefireInGaza',
    },
]

# The same subject test the fetch applies, used here to decide which
# contributions to a debate were about it: a "Middle East" statement in March
# 2026 was mostly about Iran, and only the contributions that mention the
# subject belong in this ledger.
SUBJECT = re.compile(r'palestin|\bgaza|israel|west bank|\bzionis|\bhamas|netanyahu|'
                     r'occupied territor|golan|\bunrwa\b|\brafah\b|\be1\b', re.I)

# Words that mark a contribution from the chair rather than from a member.
CHAIR = re.compile(r'speaker|in the chair|chairman|\bchair\b', re.I)

# What a petition is about, for the filter on the page. First match wins, so
# the order runs from the most specific to the least.
PETITION_TOPICS = [
    ('recognition', re.compile(r'recognis|recogniz|montevideo', re.I)),
    ('arms', re.compile(r'\barms\b|weapon|military|f-35|embargo', re.I)),
    ('sanctions', re.compile(r'sanction|trade|boycott|import|product|roadmap|sever', re.I)),
    ('ceasefire', re.compile(r'ceasefire|cease-fire|surrender|hostage|neutral|withdraw support', re.I)),
    ('humanitarian', re.compile(r'aid|humanitarian|blockade|visa|evacuat|refuge|children|family|'
                                r'fuel|electricity|food|homes for|scholarship', re.I)),
    ('accountability', re.compile(r'inquiry|condemn|genocide|execution|prisoner|apartheid|'
                                  r'law|influence|racism|balfour', re.I)),
]

# Opinion polls, transcribed from the pollster or the commissioning body's own
# publication. A poll is carried with its population, because a poll of Labour
# members and a poll of the adult population are different instruments, and
# with its commissioner, because who asked is part of what was asked.
POLLS = [
    {
        'published': '2025-06-18',
        'fieldwork': '4\u20135 June 2025',
        'pollster': 'YouGov',
        'commissioner': 'Action For Humanity and the International Centre of Justice for Palestinians',
        'population': 'UK adults',
        'sample': 2010,
        'findings': [
            ['Oppose Israel\u2019s actions in Gaza', 55],
            ['Support them', 15],
            ['Want the UK to enforce the ICC arrest warrant if Netanyahu visits', 65],
            ['Recognise Palestine now', 30],
            ['Recognise it eventually', 19],
            ['Oppose recognition', 10],
        ],
        'source': 'https://www.middleeasteye.net/news/poll-nearly-half-uk-believe-israel-committing-genocide-gaza-two-thirds-support-arresting',
        'note': 'Commissioned by organisations that campaign on the question, which offered more answer '
                'options than the pollster\u2019s own series and is why the recognition figures are '
                'split three ways.',
        'plain': 'More than three times as many people opposed Israel\u2019s actions in Gaza as supported '
                 'them, and two in three wanted Netanyahu arrested if he came to the UK.',
    },
    {
        'published': '2025-07-29',
        'fieldwork': '24\u201325 July 2025',
        'pollster': 'YouGov',
        'commissioner': 'The Times',
        'population': 'GB adults',
        'sample': 2013,
        'findings': [
            ['The UK should recognise Palestine as an independent state', 45],
            ['It should not', 14],
            ['Unsure', 41],
        ],
        'source': 'https://yougov.com/en-gb/articles/52679-britons-support-palestinian-statehood-by-45-to-14',
        'note': 'Published the day the Prime Minister announced that the United Kingdom would '
                'recognise Palestine in September unless conditions were met.',
        'plain': 'Supporters of recognition outnumbered opponents by about three to one; many people had '
                 'no view.',
    },
    {
        'published': '2025-09-19',
        'fieldwork': '17\u201318 September 2025',
        'pollster': 'YouGov',
        'commissioner': 'YouGov\u2019s own series',
        'population': 'GB adults',
        'sample': None,
        'findings': [
            ['The UK should recognise Palestine as an independent state', 44],
            ['It should not', 18],
            ['Unsure', 37],
        ],
        'source': 'https://yougov.com/en-gb/articles/53016-britons-support-recognising-palestinian-statehood-by-44-to-18',
        'note': 'Taken in the week before recognition. Opposition rose by four points on July, and '
                'was highest among Conservative and Reform UK voters.',
        'plain': 'Just before the government acted, supporters of recognition still outnumbered '
                 'opponents by more than two to one.',
    },
    {
        'published': '2026-06-05',
        'fieldwork': '22\u201326 May 2026',
        'pollster': 'Survation',
        'commissioner': 'Save the Children, Christian Aid and Medical Aid for Palestinians',
        'population': 'Labour Party members (LabourList readers)',
        'sample': 1036,
        'findings': [
            ['Support an arms embargo on Israel, including F-35 parts', 78],
            ['Back a ban on trade with the illegal settlements', 87],
            ['Back suspending the UK-Israel trade agreement', 68],
            ['Disapprove of the government\u2019s approach to Palestine', 62],
            ['Approve of it', 19],
        ],
        'source': 'https://labourlist.org/2026/06/palestine-labour-members-survation-polling/',
        'note': 'A poll of one party\u2019s members, drawn from readers of a party website and '
                'weighted to the party\u2019s own contests. It measures what the governing party\u2019s '
                'membership wanted, not what the public did.',
        'plain': 'Most members of the party in government wanted it to go further than it had: nearly '
                 'four in five backed a full arms embargo.',
    },
    {
        'published': '2026-07-07',
        'fieldwork': '2\u20133 July 2026',
        'pollster': 'YouGov',
        'commissioner': 'The Council for Arab-British Understanding (Caabu)',
        'population': 'GB adults',
        'sample': 2125,
        'findings': [
            ['Israel is committing genocide in Gaza', 50],
            ['It is not', 17],
            ['The UK should no longer consider Israel an ally', 55],
            ['It should', 15],
            ['Support a ban on trade with the settlements', 48],
        ],
        'source': 'https://caabu.org/news/press-release/caabu-press-release-50-british-population-believe-israel-committing-genocide',
        'note': 'Among 2024 Labour voters, 67 per cent said Israel is committing genocide, 62 per cent '
                'backed the settlement trade ban and 72 per cent supported suspending arms sales to Israel. '
                'Recorded in the report at \u00a715.10.',
        'plain': 'Half of British adults said Israel is committing genocide in Gaza; fewer than one in '
                 'five said it is not.',
    },
]

# What the United Kingdom did, as distinct from what the House voted for. The
# division above and the petitions below are the rest of the recognition record.
RECOGNITION_ACTS = [
    {
        'date': '2025-09-21',
        'title': 'The United Kingdom recognises the State of Palestine',
        'note': 'Announced by the Prime Minister, Keir Starmer, alongside Canada and Australia, eleven '
                'years after the Commons voted 274 to 12 for it: “Today, to revive the hope of '
                'peace for the Palestinians and Israelis, and a two state solution, the United Kingdom '
                'formally recognizes the State of Palestine.” Recognition was on the basis of the '
                'provisional 1967 borders. A decision of the government under the prerogative; the '
                'House was not asked to vote on it.',
        'source': 'https://www.gov.uk/government/speeches/pm-statement-on-the-recognition-of-palestine-21-september-2025',
    },
    {
        'date': '2026-01-05',
        'title': 'Full diplomatic relations: the Palestinian mission in London becomes an embassy',
        'note': 'The second step, and the one often remembered as the date. The Palestinian Mission in '
                'London became the Embassy of the State of Palestine, headed by Husam Zomlot, and the '
                'Foreign Office minister Hamish Falconer said: \u201cWe welcome the establishment of full '
                'diplomatic relations with the state of Palestine.\u201d The United Kingdom kept its own '
                'representation as a Consulate-General in Jerusalem rather than an embassy.',
        'source': 'https://www.thenationalnews.com/news/uk/2026/01/04/palestinians-celebrate-official-upgrade-as-embassy-in-london-to-open/',
    },
]

# Early day motions on the subject since 7 October 2023, each read in full and
# placed on one side. A motion counts as pro-Palestinian when it takes the side
# of Palestinians or of the people campaigning for them: it asks for a
# ceasefire, aid, evacuation or visas, an end to arms sales or settlement trade,
# recognition, sanctions, accountability under international law, or the
# protection of Palestinian civilians, detainees, journalists, medics or
# protesters, or it condemns conduct against them. It counts against when it
# asks for the reverse: no refuge for Palestinians, no boycott of Israel or of
# goods from its settlements, or the treatment of a Palestinian solidarity
# slogan as evidence of a hate crime. Every other motion the search returns
# is listed below it with the reason it is not counted, so that a new motion
# is noticed rather than silently dropped (validate.py warns on one).
MOTIONS_PRO = {
    61423, 61430, 61466, 61468, 61526, 61630, 61654, 61661, 61714, 61735, 61736, 61746,
    61749, 61755, 61769, 61771, 61800, 61804, 61810, 61815, 61833, 61869, 61873, 62001,
    62002, 62029, 62214, 62247, 62251, 62252, 62324, 62330, 62346, 62347, 62372, 62386,
    62454, 62538, 62551, 62671, 62678, 62681, 62704, 62777, 62795, 62906, 62928, 62950,
    62984, 63037, 63055, 63122, 63125, 63158, 63224, 63231, 63311, 63321, 63425, 63568,
    63607, 63644, 63689, 63690, 63768, 63775, 63809, 63843, 63862, 63888, 63973, 64020,
    64079, 64142, 64152, 64154, 64205, 64210, 64212, 64218, 64252, 64272, 64279, 64295,
    64387, 64589, 64733, 64800, 64865, 64879, 64922, 65017, 65057, 65236, 65286, 65406,
    65474, 65488, 65491, 65566, 65580, 65614, 65741, 65742, 65753, 65769, 65865, 65886,
    65892, 65964, 65965, 66053, 66183, 66186, 66221, 66235, 66252, 66364, 66371, 66384,
    66469, 66565,
}
MOTIONS_AGAINST = {
    63988,  # asks the government to refuse any resettlement of Palestinians from Gaza
    64031,  # opposes Ireland's ban on goods from Israeli settlements
    66163,  # asks that "From the river to the sea" be treated as evidence of antisemitic hostility
    66489,  # condemns anti-Israel demonstrations in Derry
    66503,  # condemns the withdrawal of Israeli athletes and asks that it never recur
}
MOTIONS_NOT_COUNTED = {
    'about Lebanon, Syria or Iran rather than Palestine': {
        62537, 62539, 62575, 62927, 63886, 63979, 64816, 64833, 65329, 65440, 65451, 65616,
        65794},
    'about the hostages or antisemitism, without a position on Palestinians': {
        62034, 62709, 62874, 63225, 63526, 63646, 64550, 64941},
    'a tribute or a commemoration without a call for action': {
        62233, 62244, 63467, 63480, 63495, 63507, 64235, 64832, 65353},
    'on another subject, and matched only because it mentions one of the search terms': {
        61505, 61880, 61890, 61923, 61952, 62140, 62221, 62358, 62463, 62485, 62515,
        63154, 63432, 63964, 64314, 65227, 65383, 66207},
}
MOTION_URL = 'https://edm.parliament.uk/early-day-motion/%d'

# A signature withdrawn by the member is not counted. One withdrawn by the House
# is: when the Speaker named and suspended Zarah Sultana on 20 April 2026, every
# signature she had on the order paper was withdrawn the same day, 28 of them on
# this subject alone, and none of them was withdrawn by the member's own act.
SUSPENSIONS = {
    4786: ('2026-04-20', 'https://www.lbc.co.uk/article/yourparty-mp-zarah-sultana-removed-from-commons-after-branding-starmer-a-bare-fa-5HjdY2g_2/'),
}

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
VOTE_FORCED = 'forced-teller'


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


def plain_text(html):
    text = re.sub(r'<[^>]+>', ' ', html or '')
    for a, b in (('&amp;', '&'), ('&quot;', '"'), ('&#39;', "'"), ('&lt;', '<'), ('&gt;', '>'),
                 ('&nbsp;', ' ')):
        text = text.replace(a, b)
    return re.sub(r'\s+', ' ', text).strip()


# Abbreviations Hansard uses mid-sentence. A full stop after one of these does
# not end the sentence, or "Does the hon. Member agree" is cut at "hon.".
ABBREVIATIONS = re.compile(r'(?:\b(?:hon|Hon|Mr|Mrs|Ms|Dr|Rt|St|No|Nos|Gen|Lt|Col|Sgt|Prof|Rev|'
                           r'Co|Ltd|vs|cf|al|approx|para|paras|Vol|Art|Arts|p|pp)|\b[A-Z])\.$')


def split_sentences(text):
    out, start = [], 0
    for m in re.finditer(r'[.!?][\u201d"\')]*\s+(?=[\u201c"(A-Z0-9\u2018])', text):
        piece = text[start:m.start() + 1]
        if ABBREVIATIONS.search(piece):
            continue
        out.append(text[start:m.end()].strip())
        start = m.end()
    out.append(text[start:].strip())
    return [s for s in out if s]


def excerpt(text, limit=340):
    """The part of a contribution that is about the subject, in the member's words.

    The sentence that first names the subject, and the one after it if there is
    room. Cut on a word and marked with an ellipsis where it is cut, so that a
    shortened quotation never reads as a whole one.
    """
    sentences = split_sentences(text)
    start = next((i for i, s in enumerate(sentences) if SUBJECT.search(s)), 0)
    out = sentences[start]
    if start + 1 < len(sentences) and len(out) + len(sentences[start + 1]) < limit:
        out += ' ' + sentences[start + 1]
    lead = '\u2026 ' if start else ''
    if len(out) > limit:
        out = out[:limit].rsplit(' ', 1)[0].rstrip(',;:') + ' \u2026'
    return lead + out


def hansard_url(date, ext, title):
    words = re.findall(r'[A-Za-z0-9]+', title or '')
    return 'https://hansard.parliament.uk/Commons/%s/debates/%s/%s' % (
        date, ext, ''.join(w[:1].upper() + w[1:] for w in words))


def debate_items(blob):
    """Every contribution in a debate, including those in its sub-debates."""
    out = list(blob.get('Items') or [])
    for child in blob.get('ChildDebates') or []:
        out += debate_items(child)
    return out


def petition_topic(action, background=''):
    """The petition's own request decides its topic; its background only if that is silent."""
    for text in (action, background):
        for name, pattern in PETITION_TOPICS:
            if pattern.search(text or ''):
                return name
    return 'other'


def hansard_division(raw, spec, history):
    """Read a Hansard division record into the shape of a votes-API one.

    Hansard lists who voted and who told. It does not list who was in the House
    and did not vote, so that is worked out from each member's record of
    service, and a member who cannot be placed in the House on the day is
    shown as not then a member rather than as absent.
    """
    ayes = [m for m in raw.get('AyeMembers') or [] if not m.get('IsTeller')]
    noes = [m for m in raw.get('NoeMembers') or [] if not m.get('IsTeller')]
    return {
        'DivisionId': spec['id'],
        'AyeCount': raw.get('AyesCount'),
        'NoCount': raw.get('NoesCount'),
        'Ayes': [{'MemberId': m['MemberId'], 'MemberFrom': m.get('MemberFrom') or ''} for m in ayes],
        'Noes': [{'MemberId': m['MemberId'], 'MemberFrom': m.get('MemberFrom') or ''} for m in noes],
        'AyeTellers': [{'MemberId': m['MemberId']} for m in raw.get('AyeMembers') or [] if m.get('IsTeller')],
        'NoTellers': [{'MemberId': m['MemberId']} for m in raw.get('NoeMembers') or [] if m.get('IsTeller')],
        'NoVoteRecorded': None,
    }


def sat_on(member, day, history):
    """Whether a member was in the House on a given day, from their record."""
    since = ((member.get('latestHouseMembership') or {}).get('membershipStartDate') or '')[:10]
    if since and since <= day:
        return True
    for spell in history.get(str(member['id']), []):
        if spell['from'] and spell['from'] <= day and (not spell['to'] or spell['to'] >= day):
            return True
    return False


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
    history = load_raw('uk_member_history.json')
    hansard = {d['ExternalId']: d for d in load_raw('uk_divisions_hansard.json')}
    for spec in DIVISIONS:
        if spec.get('hansard'):
            if spec['hansard'] not in hansard:
                raise SystemExit('Hansard division %s is not in the cache' % spec['hansard'])
            divisions[spec['id']] = hansard_division(hansard[spec['hansard']], spec, history)
    petitions_raw = load_raw('uk_petitions.json')
    debate_index = load_raw('uk_debates.json')
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
                # A teller does not vote but is normally on that side. The
                # exception is recorded against the division, by name, from the
                # member's own statement in the House.
                if member['MemberId'] in (spec.get('procedural_tellers') or {}):
                    cast[member['MemberId']] = VOTE_FORCED
                else:
                    cast.setdefault(member['MemberId'], name + '-teller')
                seats_then.setdefault((member['MemberId'], spec['id']), member.get('MemberFrom') or '')
        if got.get('NoVoteRecorded') is None:
            # A Hansard division: everyone in the House that day who is not in
            # the lists above did not vote. Worked out member by member.
            for member in members:
                if member['id'] not in cast and sat_on(member, spec['date'], history):
                    cast[member['id']] = VOTE_ABSENT
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

    # The petitions. Signatures by constituency are only joined to a seat for
    # petitions of this Parliament: the petitions of 2019-2024 were counted on
    # the old boundaries, and a count for a seat that no longer exists cannot
    # honestly be given to the member for the seat that replaced it.
    petitions = []
    by_seat_signatures = defaultdict(dict)
    seat_names = {slug((m.get('latestHouseMembership') or {}).get('membershipFrom') or ''): m['id']
                  for m in members}
    for a in sorted(petitions_raw, key=lambda a: -(a.get('signature_count') or 0)):
        debate = a.get('debate') or {}
        response = a.get('government_response') or {}
        row = {
            'id': a['id'],
            'parliament': a['parliament'],
            'action': (a.get('action') or '').strip(),
            'background': (a.get('background') or '').strip(),
            'signatures': a.get('signature_count') or 0,
            'state': a.get('state') or '',
            'opened': (a.get('opened_at') or '')[:10],
            'closed': (a.get('closed_at') or '')[:10],
            'topic': petition_topic(a.get('action'), a.get('background')),
            'url': 'https://petition.parliament.uk/%spetitions/%d' % (
                'archived/' if a['parliament'] == 'archived' else '', a['id']),
        }
        if response.get('summary'):
            row['response'] = {'date': response.get('responded_on') or '',
                               'summary': response['summary'].strip()}
        if debate.get('debated_on'):
            row['debate'] = {'date': debate['debated_on'], 'url': debate.get('transcript_url') or '',
                             'video': debate.get('video_url') or '', 'pack': debate.get('debate_pack_url') or ''}
            found = re.search(r'debates/([0-9A-Fa-f-]{36})', debate.get('transcript_url') or '')
            if found:
                row['debate']['ext'] = found.group(1).upper()
        counts = a.get('signatures_by_constituency') or []
        if a['parliament'] == 'current' and counts:
            matched = [(seat_names.get(slug(c['name'])), c['signature_count']) for c in counts]
            joined = [(mid, n) for mid, n in matched if mid]
            # A petition whose constituency names do not join is on boundaries
            # this ledger does not hold. Better no counts than wrong ones.
            if len(joined) >= 0.97 * len(members):
                ranked = sorted(joined, key=lambda x: -x[1])
                for rank, (mid, n) in enumerate(ranked, 1):
                    by_seat_signatures[mid][str(a['id'])] = [n, rank]
                row['by_seat'] = True
                row['seats'] = len(ranked)
        petitions.append(row)

    # The early day motions that count, oldest first. `_signed` is dropped
    # before the file is written: the page reads signatures from each member.
    motions = []
    for m in sorted(load_raw('uk_motions.json'), key=lambda m: (m['date'], m['id'])):
        side = ('pro' if m['id'] in MOTIONS_PRO else
                'against' if m['id'] in MOTIONS_AGAINST else None)
        if not side:
            continue
        signed = set(m['signed']) | {mid for mid, day in m.get('withdrawn', [])
                                     if SUSPENSIONS.get(mid, ('',))[0] == day}
        motions.append({'id': m['id'], 'date': m['date'], 'title': m['title'], 'side': side,
                        'sponsor': m['sponsor'], 'signatures': len(signed),
                        'url': MOTION_URL % m['id'], '_signed': signed})
    motions_reviewed = len(load_raw('uk_motions.json'))

    # The debates. A contribution belongs in the ledger if it is about the
    # subject in its own words; the debate's title is not enough, because the
    # "Middle East" statements of 2026 were mostly about Iran.
    petition_debates = defaultdict(list)
    for row in petitions:
        if row.get('debate', {}).get('ext'):
            petition_debates[row['debate']['ext']].append(row['id'])
    debates = []
    spoke = defaultdict(list)
    ids_now = {m['id'] for m in members}
    for entry in debate_index:
        path = os.path.join(RAW, 'hansard', '%s.json' % entry['ext'])
        if not os.path.exists(path):
            continue
        with open(path) as fh:
            blob = json.load(fh)
        overview = blob.get('Overview') or {}
        title = re.sub(r'\s+', ' ', overview.get('Title') or '').strip()
        said = defaultdict(list)
        for item in debate_items(blob):
            if item.get('ItemType') != 'Contribution' or not item.get('MemberId'):
                continue
            if CHAIR.search(item.get('AttributedTo') or ''):
                continue
            text = plain_text(item.get('Value'))
            if len(text) < 40 or not SUBJECT.search(text):
                continue
            said[item['MemberId']].append(text)
        if not said:
            continue
        index = len(debates)
        ext = entry['ext'].upper()
        debates.append({
            'ext': ext,
            'date': entry['date'],
            'title': title,
            'where': overview.get('Location') or '',
            'url': hansard_url(entry['date'], entry['ext'], title),
            'petitions': petition_debates.get(ext, []),
            'members': sum(1 for mid in said if mid in ids_now),
        })
        for mid, texts in said.items():
            if mid not in ids_now:
                continue
            # The longest contribution is the one most likely to state a view
            # rather than ask a question or thank a colleague.
            best = max(texts, key=len)
            spoke[mid].append([index, len(texts), excerpt(best)])

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
        if member['id'] in by_seat_signatures:
            row['signatures'] = by_seat_signatures[member['id']]
        if spoke.get(member['id']):
            row['spoke'] = len(spoke[member['id']])
            row['contributions'] = sum(n for _i, n, _x in spoke[member['id']])
        # How often the member took the side each division's `pro_side` names,
        # counting only the votes they actually cast. A teller counts with the
        # side they told for; a member who told for the other side only so that
        # a vote could be held counts with the side they held.
        pro = against = 0
        for spec in DIVISIONS:
            side = spec.get('pro_side')
            cast = row['votes'][str(spec['id'])]
            if not side or cast in (VOTE_ABSENT, VOTE_AWAY):
                continue
            took = side if cast == VOTE_FORCED else cast.replace('-teller', '')
            if took == side:
                pro += 1
            else:
                against += 1
        row['record'] = [pro, against]
        # The motions the member signed, and the whole of the record put
        # together: pro-Palestinian acts, acts against, and the number of
        # chances the member had, which is every counted division they sat for
        # and every counted motion tabled while they were in the House. Not
        # signing is not an act either way: ministers and whips do not sign
        # motions, and many members sign none at all.
        signed = [i for i, m in enumerate(motions) if member['id'] in m['_signed']]
        if signed:
            row['signed'] = signed
        chances = sum(1 for spec in DIVISIONS if spec.get('pro_side')
                      and row['votes'][str(spec['id'])] != VOTE_AWAY)
        chances += sum(1 for i, m in enumerate(motions)
                       if i in signed or sat_on(member, m['date'], history))
        signed_pro = sum(1 for i in signed if motions[i]['side'] == 'pro')
        row['lean'] = [pro + signed_pro, against + len(signed) - signed_pro, chances]
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
        clean = {k: v for k, v in spec.items() if k != 'procedural_tellers'}
        if spec.get('procedural_tellers'):
            clean['procedural_tellers'] = {str(k): v for k, v in spec['procedural_tellers'].items()}
        tallies.append(dict(clean, id=str(spec['id']), sitting=len(sitting), still_here=dict(counted)))
    order = {d: i for i, d in enumerate(DIVISION_ORDER)}
    tallies.sort(key=lambda d: order.get(d['id'], 99))

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
            'subject_terms': SUBJECT.pattern,
            'petitions': len(petitions),
            'petition_signatures': sum(p['signatures'] for p in petitions),
            'debates': len(debates),
            'members_who_spoke': sum(1 for r in rows if r.get('spoke')),
            'motions': len(motions),
            'motions_reviewed': motions_reviewed,
            'motions_not_counted': {why: len(ids) for why, ids in MOTIONS_NOT_COUNTED.items()},
            'members_who_signed': sum(1 for r in rows if r.get('signed')),
            'suspensions': [{'name': next((r['name'] for r in rows if r['id'] == mid), ''),
                             'date': day, 'source': src} for mid, (day, src) in SUSPENSIONS.items()],
        },
        'motions': [{k: v for k, v in m.items() if k != '_signed'} for m in motions],
        'divisions': tallies,
        'unrecorded': UNRECORDED,
        'petitions': petitions,
        'debates': debates,
        'polls': POLLS,
        'recognition': RECOGNITION_ACTS,
        'members': rows,
        'seats': constituencies,
        'parties': parties,
    }

    assert len({r['seat'] for r in rows}) == len(rows), 'two members hold the same seat'
    assert all(r['seat'] for r in rows), 'a member holds no named seat'

    # Newest first within each member, so the row opens on what they said last.
    speeches = {
        'meta': {
            'note': 'An excerpt of each contribution a sitting member made to a Commons or Westminster '
                    'Hall debate about Gaza, Israel or Palestine since 7 October 2023, taken verbatim '
                    'from Hansard under the Open Parliament Licence. The excerpt is the part of the '
                    'member\u2019s longest contribution to that debate that first names the subject; '
                    'the link is to the whole debate.',
            'subject_terms': SUBJECT.pattern,
        },
        'by_member': {str(mid): sorted(entries, key=lambda e: debates[e[0]]['date'], reverse=True)
                      for mid, entries in spoke.items()},
    }
    return data, speeches


def main():
    data, speeches = build()
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
    # Compact, because it is only ever read by the page and it is the large one.
    with open(os.path.join(DATA, 'constituency-speeches.json'), 'w') as fh:
        fh.write(json.dumps(speeches, ensure_ascii=False, separators=(',', ':')) + '\n')
    meta = data['meta']
    print('constituency.json — %d seats, %d divisions, %d petitions, %d debates with %d members '
          'speaking, %d registered interests against %d members, %d reported donations'
          % (meta['seats'], meta['divisions'], meta['petitions'], meta['debates'],
             meta['members_who_spoke'], meta['interests'], meta['members_with_interest'],
             meta['donations']))


if __name__ == '__main__':
    main()
