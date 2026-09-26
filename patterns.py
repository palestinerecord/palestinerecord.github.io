# -*- coding: utf-8 -*-
"""Write data/claim-patterns.json, the phrase index behind the #/answer route.

The patterns are the wording of the claim as it is actually made in public, not
the wording of the rebuttal. Nothing here is evidence: every fact the route
states is read at render time out of the report, the live figures and the
statements, so this file can never disagree with the record. What it decides is
only which of the twenty-six answers a pasted text is asking for.
"""
import json
import datetime

CLAIMS = [
    (1, 'Self-defence', ['self-defence', 'article 51', 'right to defend itself',
        'right to self-defence', 'right to self-defense'], [
        'right to defend itself', 'right to defend herself', 'right to self-defence', 'right to self defence',
        'right to self-defense', 'right to self defense', 'article 51', 'self-defence', 'self defence',
        'self-defense', 'self defense', 'any country would', 'no country would tolerate', 'what would you do if',
        'they started it', 'hamas started', 'unprovoked attack', 'israel was attacked', 'defending itself',
        'defending themselves', 'israel has every right',
    ], ['killed', 'children'], ['genocide']),

    (2, 'Human shields', ['human shields', 'human shield', 'hides behind civilians'], [
        'human shields', 'human shield', 'hamas hides', 'hides behind civilians', 'hides among civilians',
        'hamas uses civilians', 'blame hamas for', 'blood is on hamas', 'hamas is responsible for the deaths', 'if hamas surrendered',
        'embedded in civilian', 'operating out of schools',
    ], ['children', 'killed'], ['dehumanisation', 'warcrimes']),

    (3, 'Inflated numbers', ['hamas-run health ministry', 'hamas run health ministry',
        'numbers are inflated', 'inflated death toll'], [
        'hamas-run health ministry', 'hamas run health ministry', 'hamas-run ministry of health',
        'gaza health ministry figures', 'hamas figures', 'hamas numbers', 'numbers are inflated',
        'inflated casualty', 'inflated death toll', 'made-up numbers', 'made up numbers', 'pallywood',
        'they count combatants', 'includes hamas fighters', 'include hamas combatants', 'cannot trust the numbers',
        "can't trust the numbers", 'unverified figures', 'fake casualty', 'casualty figures are propaganda',
    ], ['killed', 'children', 'injured'], ['findings']),

    (4, 'Anti-Zionism is antisemitism', ['anti-zionism is antisemitism'], [
        'anti-zionism is antisemitism', 'antizionism is antisemitism', 'anti zionism is antisemitism',
        'anti-zionism is anti-semitism', 'zionism is judaism', 'anti-zionist is antisemit',
        'hating israel is hating jews', 'denying jewish self-determination', 'denies jewish self-determination',
        'ihra definition', 'antisemitic to criticise israel', 'antisemitic to criticize israel',
        'criticism of israel is antisemit', 'jew-hatred dressed', 'you are antisemitic',
    ], [], ['dissent', 'jewish-opposition']),

    (5, 'The 2005 disengagement', ['left gaza in 2005', 'gaza is not occupied'], [
        'left gaza in 2005', 'withdrew from gaza', 'disengagement', 'gaza is not occupied', 'gaza was not occupied',
        'no occupation in gaza', 'not occupied since 2005', 'gave them gaza', 'handed gaza over',
        'israel does not occupy gaza', 'they got gaza and', 'pulled out of gaza',
    ], ['displaced'], ['annexation']),

    (6, 'The UN is biased', ['un is biased'], [
        'un is biased', 'biased against israel', 'anti-israel body', 'un obsession with israel',
        'human rights council is', 'un resolutions against israel', 'kangaroo court',
        'the un hates israel', 'united nations is biased', 'un is antisemitic',
    ], ['recognising'], ['findings']),

    (7, 'Israel investigates itself', ['israel investigates', 'most moral army'], [
        'israel investigates', 'investigates itself', 'idf investigates', 'military advocate general',
        'most moral army', 'functioning judiciary', 'independent judiciary', 'complementarity',
        'israeli courts will', 'its own legal system', 'israel holds its soldiers to account',
    ], [], ['findings', 'dissent']),

    (8, 'A land without a people', ['a land without a people', 'invented people'], [
        'a land without a people', 'land without a people', 'there was no one there', 'the land was empty',
        'made the desert bloom', 'swamps and desert', 'no such thing as palestinians',
        'invented people', 'palestinians are an invention', 'there was never a palestinian state',
        'jordan is palestine', 'they are all jordanians', 'they came from egypt',
    ], ['settlers'], ['historic', 'cleansing']),

    (9, 'The only democracy', ['only democracy in the middle east'], [
        'only democracy in the middle east', 'only democracy in the region', 'bible belt', 'vibrant democracy',
        'liberal democracy', 'the only free country in', 'a beacon of democracy', 'democratic values',
    ], [], ['apartheid', 'society']),

    (10, 'But the hostages', ['but the hostages', 'release the hostages'], [
        'but the hostages', 'release the hostages', 'return the hostages', 'give back the hostages',
        'bring them home', 'hostages are still', 'hamas still holds', 'still holding hostages',
        'free the hostages', 'if hamas released', 'hand over the hostages',
    ], ['killed', 'displaced'], ['warcrimes']),

    (11, 'Evacuation warnings', ['evacuation warning', 'roof knock'], [
        'evacuation warning', 'evacuation order', 'roof knock', 'warns civilians', 'warned civilians',
        'drops leaflets', 'dropped leaflets', 'tells civilians to leave', 'told them to leave',
        'safe zone', 'humanitarian zone', 'al-mawasi', 'al mawasi', 'they were warned',
        'takes precautions', 'unprecedented precautions',
    ], ['displaced', 'children'], ['cleansing', 'warcrimes']),

    (12, 'Hamas steals the aid', ['hamas steals the aid', 'hamas steals aid', 'steals the aid'], [
        'hamas steals the aid', 'hamas steals aid', 'steals the aid', 'aid is stolen', 'hamas takes the aid',
        'hamas loots', 'loots the aid', 'israel lets the aid in', 'israel allows aid', 'trucks are waiting',
        'there is no siege', 'aid is diverted', 'unrwa is complicit', 'hamas sells the aid',
    ], ['displaced'], ['starvation']),

    (13, 'There is no famine', ['there is no famine', 'no famine in gaza', 'famine is a lie'], [
        'there is no famine', 'no famine in gaza', 'famine is a lie', 'famine hoax', 'no starvation in gaza',
        'starvation is a lie', 'markets are full', 'plenty of food in gaza', 'ipc is', 'the ipc report',
        'fake famine', 'nobody is starving', 'they look well fed',
    ], ['children'], ['starvation']),

    (14, 'The journalists were operatives', ['journalists were hamas', 'posing as a journalist'], [
        'journalists were hamas', 'journalist was hamas', 'was a hamas operative', 'posed as a journalist',
        'posing as a journalist', 'terrorist posing as', 'so-called journalist', 'press card',
        'al jazeera journalist was', 'journalists in gaza are', 'not a real journalist',
    ], ['killed'], ['warcrimes', 'findings']),

    (15, 'From the river to the sea', ['from the river to the sea'], [
        'from the river to the sea', 'river to the sea', 'call for the destruction of israel',
        'genocidal chant', 'wipe israel off the map', 'destroy the jewish state', 'globalize the intifada',
        'globalise the intifada', 'intifada revolution', 'code for genocide',
    ], [], ['genocide', 'annexation']),

    (16, 'Singling out Israel', ['singling out israel', 'why not syria'], [
        'singled out', 'singling out israel', 'why not syria', 'what about syria', 'what about yemen',
        'what about sudan', 'what about china', 'what about the uyghur', 'uyghurs', 'why only israel',
        'obsession with israel', 'double standard against israel', 'nobody protests about',
        'where are the protests for',
    ], ['recognising'], ['findings']),

    (17, 'Arab citizens of Israel', ['arab citizens of israel', 'apartheid is a lie'], [
        'arab citizens of israel', 'arab israelis', 'arabs in the knesset', 'arab members of knesset',
        'arab judge', 'sits on the supreme court', 'apartheid is a lie', 'not an apartheid state',
        'apartheid slur', 'they have equal rights', 'arabs vote in israel', 'equal citizens',
    ], ['settlers'], ['apartheid']),

    (18, 'There is no genocide', ['there is no genocide', 'no genocide in gaza', 'genocide is a lie'], [
        'there is no genocide', 'no genocide in gaza', 'genocide is a lie', 'not a genocide',
        "isn't a genocide", 'is not genocide', 'stop calling it genocide', 'genocide accusation',
        'blood libel', 'cheapens the word genocide', 'cheapens the holocaust', 'no genocidal intent',
        'genocidal intent', 'dolus specialis', 'the population has grown', 'population keeps growing',
        'worst genocide in history', 'if this were a genocide', 'misuse of the word genocide',
        'the icj has not ruled', 'no court has found',
    ], ['killed', 'children', 'displaced'], ['genocide', 'findings']),

    (19, 'Hamas broke the ceasefire', ['hamas broke the ceasefire', 'broke the ceasefire'], [
        'hamas broke the ceasefire', 'broke the ceasefire', 'broke the truce', 'violated the ceasefire',
        'ceasefire violation', 'hamas violated', 'hamas refused to release', 'hamas did not return the bodies',
        "hamas didn't return the bodies", 'israel honoured the ceasefire', 'israel honored the ceasefire',
        'hamas never keeps', 'hamas restarted the war', 'who broke the ceasefire', 'israel kept the ceasefire',
    ], ['killed', 'injured'], ['warcrimes', 'starvation']),

    (20, 'Partition and the refugees', ['rejected the partition plan', 'arab leaders told them to leave'], [
        'rejected the partition', 'rejected the partition plan', 'turned down partition', 'accepted partition',
        'the arabs said no', 'five arab armies', 'arab armies invaded', 'arab leaders told them to leave',
        'told to leave by arab', 'ordered to leave by their own', 'arab radio told them', 'they left voluntarily',
        'they chose to leave', 'nobody expelled them', 'no one was expelled', 'the nakba is a myth',
        'nakba myth', 'no ethnic cleansing in 1948', 'they started the 1948 war',
    ], ['displaced'], ['cleansing', 'historic']),

    (21, 'They were offered a state', ['offered them a state', 'camp david'], [
        'offered them a state', 'offered a state', 'camp david', 'barak offered', 'olmert offered',
        'refused every offer', 'rejected every offer', 'turned down every offer', 'never miss an opportunity',
        'missed an opportunity to miss', 'arafat walked away', 'arafat rejected', 'said no to peace',
        "they don't want peace", 'they do not want peace', 'could have had a state',
    ], ['settlers'], ['annexation', 'historic']),

    (22, 'Boycott is antisemitic', ['bds is antisemitic', 'boycott is antisemitic'], [
        'bds is antisemitic', 'bds movement is antisemitic', 'boycott is antisemitic',
        'boycotting israel is antisemitic', 'boycott the jewish state', 'bds is a hate',
        "don't buy jewish", 'do not buy from jews', 'nazis boycotted', 'nazi boycott',
        'economic warfare against israel', 'bds hurts palestinians', 'boycott only hurts palestinians',
        'sodastream', 'bds is a terrorist',
    ], ['recognising'], ['dissent', 'jewish-opposition']),

    (23, 'Jews are indigenous', ['jews are indigenous', 'cannot be colonialism'], [
        'jews are indigenous', 'indigenous to the land', 'indigenous people of israel', 'jews were there first',
        'three thousand years', '3000 years', 'ancestral homeland', 'biblical homeland',
        'judea and samaria have always', 'you cannot colonise your own', 'you cannot colonize your own',
        'cannot be colonialism', 'not settler colonialism', 'not a colonial', 'jews are not white',
        'returning to their homeland', 'archaeology proves',
    ], ['settlers', 'wb-killed'], ['historic', 'annexation']),

    (24, 'UNRWA is Hamas', ['unrwa is hamas', 'unrwa staff', 'unrwa employees'], [
        'unrwa is hamas', 'unrwa staff', 'unrwa employees', 'unrwa workers', 'unrwa is a front',
        'front for hamas', 'unrwa teachers', 'defund unrwa', 'funding unrwa', 'money to unrwa',
        'unrwa funding', 'unrwa took part', 'unrwa terrorists', 'our money to gaza', 'funds terror',
        'funding terror', 'aid money to gaza', 'confirmed as participants',
    ], ['killed'], ['findings']),

    (25, 'Hospitals as command centres', ['command centre under', 'command center under', 'al-shifa'], [
        'command centre under', 'command center under', 'al-shifa', 'al shifa', 'shifa hospital',
        'tunnels under hospitals', 'operates from hospitals', 'hamas hospitals', 'hides in hospitals',
        'hide in hospitals', 'rantisi', 'guard list', 'hostages were held in the hospital',
        'command and control centre', 'command and control center',
    ], ['killed'], ['warcrimes']),

    (26, 'The IDF has explained', ['warning shots', 'approached suspiciously', 'perceived threat'], [
        'warning shots', 'approached suspiciously', 'perceived threat', 'the idf said', 'the idf says',
        'according to the idf', 'idf denied', 'israel denied', 'stampede', 'no evidence of execution',
        'without headlights', 'hamas staged', 'staged by hamas', 'the army has explained',
        'posed a threat to the troops',
    ], ['killed'], ['warcrimes']),
]

# The ids a pattern may name, resolved to live values by views.js at render
# time. Listed here so validate.py can check the two sides against each other.
FIGURE_IDS = ['killed', 'children', 'injured', 'displaced', 'wb-killed',
              'settler-attacks', 'settlers', 'recognising']

out = {
    'meta': {
        'title': 'Claim patterns',
        'description': (
            'The phrase index behind the answer engine. Each entry maps one of the '
            'twenty-six rebuttals in Part XVI of the report to the wording the claim is '
            'made in, so a pasted text can be matched to the answer it is asking for '
            'without a language model and without a network call. The patterns carry no '
            'evidence of their own: the answer is assembled at render time from the '
            'report, the live figures and the documented statements.'
        ),
        'generated': datetime.date.today().isoformat(),
        'figure_ids': FIGURE_IDS,
        'note': (
            'Matching is case-insensitive and punctuation-insensitive, and a phrase must '
            'match on a word boundary. A phrase listed under "strong" counts double, '
            'because it names the claim rather than merely touching its subject.'
        ),
    },
    'claims': [],
}

for n, label, strong, phrases, figures, cats in CLAIMS:
    for f in figures:
        assert f in FIGURE_IDS, f
    for s in strong:
        assert s in phrases, (n, s)
    assert len(set(phrases)) == len(phrases), n
    out['claims'].append({
        'rebuttal': n, 'label': label, 'strong': strong, 'phrases': phrases,
        'figures': figures, 'statement_cats': cats,
    })

seen = {}
for c in out['claims']:
    for p in c['phrases']:
        if p in seen:
            raise SystemExit('phrase %r is claimed by both %d and %d' % (p, seen[p], c['rebuttal']))
        seen[p] = c['rebuttal']

with open('data/claim-patterns.json', 'w', encoding='utf-8') as fh:
    fh.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
print('claim-patterns.json — %d claims, %d phrases' % (len(out['claims']), len(seen)))
