#!/usr/bin/env python3
"""Build the provenance graph: data/provenance.json.

Every curated figure, statement, element and record row on this site carries a
`source` field, but until now that field was a string. A string cannot be
counted, joined or filtered, so the site could assert that a number had a
source without ever showing what rested on what, and a reader who wanted to
know whether the record survives the removal of any one body had no way to ask.

This script normalises those strings into source entities with stable
identifiers, attaches each claim to the entities it rests on, and classifies
every entity by origin — Palestinian, Israeli, United Nations, international
court, international NGO, academic, Western state, media, open data project,
archive. The classification is what makes the adversary switch possible: with
origins attached, the site can drop a whole class of source and recount what
still stands.

The output is a graph, not a report:

    sources[]   one entity per body, with id, name, kind, origin, weight
    claims[]    one node per curated assertion, with the source ids it rests on
    files[]     the curated files the claims came from, for grouping
    summary     counts, coverage, and the standing survival figures

Run it after any curated JSON edit and before manifest.py:

    python3 provenance.py            # writes data/provenance.json
    python3 provenance.py --report   # writes nothing, prints the unmatched strings
"""

import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')

# Files scanned for source-bearing objects. report.json is excluded because it
# is derived from the markdown and carries its citations inside prose rather
# than in a field; names.json and timeseries.json carry one source for the whole
# file, recorded here as a file-level claim instead.
SCAN = [
    'figures.json', 'statements.json', 'elements.json', 'conduct-record.json',
    'long-record.json', 'war-record.json', 'children.json', 'history.json',
    'maps.json', 'legal.json', 'nakba.json', 'world-positions.json',
    'chronology.json', 'timeline-extra.json',
]

# ---------------------------------------------------------------------------
# The source registry.
#
# Each entry is (id, display name, kind, origin, patterns). A source string is
# matched against every pattern in order; all matching entities are attached,
# because a string naming three bodies is a claim resting on three bodies.
#
# `origin` is the axis the adversary switch turns on. It answers one question:
# if a reader refuses to accept anything this class of body says, does the
# claim still stand? The classes are deliberately coarse, and a body is placed
# by who controls it rather than by where it files its accounts.
# ---------------------------------------------------------------------------

PAL_STATE = 'palestinian-official'
PAL_NGO = 'palestinian-ngo'
ISR_STATE = 'israeli-official'
ISR_COURT = 'israeli-court'
ISR_NGO = 'israeli-ngo'
ISR_MEDIA = 'israeli-media'
UN = 'un'
COURT = 'international-court'
NGO = 'international-ngo'
ACADEMIC = 'academic'
STATE = 'western-state'
MEDIA = 'media'
DATA_PROJECT = 'data-project'
ARCHIVE = 'archive'

REGISTRY = [
    # --- Palestinian official ------------------------------------------------
    ('gaza-moh', 'Gaza Ministry of Health', 'ministry', PAL_STATE,
     [r'\bgaza (ministry of health|moh)\b', r'\bministry of health in gaza\b',
      r'\bpalestinian ministry of health\b', r'\bgaza mo ?h\b', r'\bmoh\b']),
    ('pal-civil-defence', 'Gaza Civil Defence', 'agency', PAL_STATE,
     [r'\bcivil defence\b', r'\bcivil defense\b']),
    ('pcbs', 'Palestinian Central Bureau of Statistics', 'agency', PAL_STATE,
     [r'\bpalestinian central bureau of statistics\b', r'\bpcbs\b']),
    ('pal-mfa', 'Palestinian Ministry of Foreign Affairs', 'ministry', PAL_STATE,
     [r'\bpalestinian ministry of foreign affairs\b']),
    ('wafa', 'WAFA (Palestinian news agency)', 'agency', PAL_STATE, [r'\bwafa\b']),

    # --- Palestinian civil society -------------------------------------------
    ('al-haq', 'Al-Haq', 'ngo', PAL_NGO, [r'\bal[- ]haq\b']),
    ('al-mezan', 'Al Mezan Centre for Human Rights', 'ngo', PAL_NGO, [r'\bal mezan\b']),
    ('pchr', 'Palestinian Centre for Human Rights', 'ngo', PAL_NGO, [r'\bpchr\b', r'palestinian centre for human rights']),
    ('dci-p', 'Defence for Children International – Palestine', 'ngo', PAL_NGO,
     [r'defence for children international', r'defense for children international', r'\bdci[- ]p\b']),
    ('addameer', 'Addameer', 'ngo', PAL_NGO, [r'\baddameer\b']),
    ('badil', 'BADIL Resource Center', 'ngo', PAL_NGO, [r'\bbadil\b']),
    ('law-for-palestine', 'Law for Palestine', 'ngo', PAL_NGO, [r'law for palestine']),
    ('palquest', 'Palquest / Institute for Palestine Studies', 'archive', PAL_NGO,
     [r'\bpalquest\b', r'institute (for|of) palestine studies']),
    ('abu-sitta', 'Salman Abu Sitta, Atlas of Palestine', 'research', PAL_NGO,
     [r'abu ?sitta', r'palestine land society']),
    ('land-research', 'Land Research Center', 'ngo', PAL_NGO, [r'land research cent']),

    # --- United Nations -------------------------------------------------------
    ('ocha', 'UN OCHA', 'un', UN, [r'\bocha\b', r'office for the coordination of humanitarian affairs']),
    ('unrwa', 'UNRWA', 'un', UN, [r'\bunrwa\b']),
    ('unicef', 'UNICEF', 'un', UN, [r'\bunicef\b']),
    ('who', 'World Health Organization', 'un', UN, [r'\bwho\b', r'world health organization']),
    ('wfp', 'World Food Programme', 'un', UN, [r'world food programme', r'\bwfp\b']),
    ('ohchr', 'OHCHR', 'un', UN,
     [r'\bohchr\b', r'office of the high commissioner for human rights',
      r'un human rights office']),
    ('goldstone', 'UN Goldstone Report (2009)', 'un', UN, [r'goldstone']),
    ('un-coi', 'UN Commission of Inquiry on the OPT', 'un', UN,
     [r'commission of inquiry', r'\bcoi\b', r'a/hrc/60/crp', r'a/hrc/62/crp']),
    ('un-hrc', 'UN Human Rights Council', 'un', UN, [r'human rights council', r'\ba/hrc/']),
    ('un-sr', 'UN Special Rapporteurs', 'un', UN,
     [r'special rapporteur', r'\balbanese\b', r'\bfakhri\b', r'\blynk\b']),
    ('un-ga', 'UN General Assembly', 'un', UN, [r'general assembly', r'resolution 181', r'\bunga\b']),
    ('un-sc', 'UN Security Council', 'un', UN, [r'security council', r'\bveto list\b', r'242 \(1967\)']),
    ('un-sg', 'UN Secretary-General', 'un', UN, [r'secretary[- ]general']),
    ('un-special-cttee', 'UN Special Committee on Israeli Practices', 'un', UN, [r'special committee']),
    ('unesco', 'UNESCO', 'un', UN, [r'\bunesco\b']),
    ('ipc', 'IPC Famine Review Committee', 'un', UN, [r'\bipc\b', r'famine review committee']),
    ('un-crpd', 'UN Committee on the Rights of Persons with Disabilities', 'un', UN,
     [r'rights of persons with disabilities']),
    ('un-library', 'UN Dag Hammarskjöld Library', 'un', UN, [r'hammarskj']),
    ('unccp', 'UN Conciliation Commission for Palestine', 'un', UN, [r'conciliation commission']),
    ('escwa', 'UN ESCWA', 'un', UN, [r'\bescwa\b']),
    ('un-membership', 'UN membership and treaty records', 'un', UN,
     [r'un membership', r'united nations membership', r'treaty records']),
    ('un-news', 'UN News', 'un', UN, [r'\bun news\b']),

    # --- International courts --------------------------------------------------
    ('icj', 'International Court of Justice', 'court', COURT,
     [r'international court of justice', r'\bicj\b', r'south africa v\.? israel', r'advisory opinion']),
    ('icc', 'International Criminal Court', 'court', COURT,
     [r'international criminal court', r'\bicc\b', r'pre[- ]trial chamber']),

    # --- Israeli state, courts, military ---------------------------------------
    ('israel-mod', 'Israeli Ministry of Defense', 'ministry', ISR_STATE,
     [r'ministry of defen[sc]e', r'israeli ministry of defence']),
    ('idf', 'Israel Defense Forces', 'military', ISR_STATE,
     [r'\bidf\b', r'israeli military', r'israel defense forces', r'army radio']),
    ('cogat', 'COGAT', 'agency', ISR_STATE, [r'\bcogat\b']),
    ('knesset', 'Knesset', 'legislature', ISR_STATE, [r'\bknesset\b']),
    ('israel-cbs', 'Israeli Central Bureau of Statistics', 'agency', ISR_STATE,
     [r'israeli central bureau', r'national insurance institute']),
    ('israel-mfa', 'Israeli Ministry of Foreign Affairs', 'ministry', ISR_STATE,
     [r'israeli ministry of foreign affairs', r'israel mfa']),
    ('israel-hcj', 'High Court of Justice (Israel)', 'court', ISR_COURT,
     [r'\bhcj\b', r'high court of justice', r"israel'?s supreme court", r'supreme court of israel',
      r'lod district court',
      r'israeli military court', r'kahan commission']),
    ('israel-archives', 'Israel State Archives and cabinet records', 'archive', ISR_STATE,
     [r'ben[- ]gurion diaries', r'jewish agency executive', r'israel state archives',
      r'cabinet (minutes|records)']),

    # --- Israeli civil society --------------------------------------------------
    ('btselem', "B'Tselem", 'ngo', ISR_NGO, [r"b[’']?tselem"]),
    ('yesh-din', 'Yesh Din', 'ngo', ISR_NGO, [r'yesh din']),
    ('breaking-silence', 'Breaking the Silence', 'ngo', ISR_NGO, [r'breaking the silence', r'breaking silence']),
    ('phr-israel', 'Physicians for Human Rights Israel', 'ngo', ISR_NGO,
     [r'physicians for human rights']),
    ('adalah', 'Adalah', 'ngo', ISR_NGO, [r'\badalah\b']),
    ('gisha', 'Gisha', 'ngo', ISR_NGO, [r'\bgisha\b']),
    ('acri', 'Association for Civil Rights in Israel', 'ngo', ISR_NGO, [r'\bacri\b']),
    ('peace-now', 'Peace Now', 'ngo', ISR_NGO, [r'peace now']),
    ('icahd', 'Israeli Committee Against House Demolitions', 'ngo', ISR_NGO, [r'\bicahd\b']),
    ('zochrot', 'Zochrot', 'ngo', ISR_NGO, [r'\bzochrot\b']),

    # --- Israeli press -----------------------------------------------------------
    ('haaretz', 'Haaretz', 'press', ISR_MEDIA, [r'\bhaaretz\b']),
    ('972', '+972 Magazine and Local Call', 'press', ISR_MEDIA,
     [r'\+ ?972', r'local call', r'sicha mekomit']),
    ('israel-europe-press', 'Israeli and European press reporting', 'press', ISR_MEDIA,
     [r'israeli and european press']),
    ('times-of-israel', 'The Times of Israel', 'press', ISR_MEDIA, [r'times of israel']),
    ('jpost', 'The Jerusalem Post', 'press', ISR_MEDIA, [r'jerusalem post']),
    ('ynet', 'Ynet and Yedioth Ahronoth', 'press', ISR_MEDIA,
     [r'\bynet', r'yedioth', r'yediot']),
    ('maariv', 'Maariv', 'press', ISR_MEDIA, [r'\bmaariv\b']),
    ('israel-tv', 'Israeli broadcast media', 'press', ISR_MEDIA,
     [r'channel 1[234]', r'\bkan\b', r'galey israel', r'israel national news', r'\b103fm\b',
      r'israeli (television|radio|press|media|outlets)', r'israeli and lebanese media',
      r'contemporaneous israeli press']),
    ('jns', 'JNS', 'press', ISR_MEDIA, [r'\bjns\b']),

    # --- International NGOs --------------------------------------------------------
    ('amnesty', 'Amnesty International', 'ngo', NGO, [r'amnesty']),
    ('hrw', 'Human Rights Watch', 'ngo', NGO, [r'human rights watch', r'\bhrw\b']),
    ('msf', 'Médecins Sans Frontières', 'ngo', NGO, [r'm[ée]decins sans fronti', r'\bmsf\b']),
    ('save-children', 'Save the Children', 'ngo', NGO, [r'save the children', r'save children']),
    ('oxfam', 'Oxfam', 'ngo', NGO, [r'\boxfam\b']),
    ('cpj', 'Committee to Protect Journalists', 'ngo', NGO, [r'\bcpj\b', r'committee to protect journalists']),
    ('euromed', 'Euro-Mediterranean Human Rights Monitor', 'ngo', NGO, [r'euro[- ]med']),
    ('lemkin', 'Lemkin Institute for Genocide Prevention', 'ngo', NGO, [r'lemkin']),
    ('genocide-watch', 'Genocide Watch', 'ngo', NGO, [r'genocide watch']),
    ('iags', 'International Association of Genocide Scholars', 'academic', NGO, [r'\biags\b', r'genocide scholars']),
    ('forensic-arch', 'Forensic Architecture', 'research', NGO, [r'forensic architecture']),
    ('airwars', 'Airwars', 'research', NGO, [r'\bairwars\b']),
    ('icj-jurists', 'International Commission of Jurists', 'ngo', NGO, [r'commission of jurists']),
    ('omct', 'World Organisation Against Torture', 'ngo', NGO, [r'\bomct\b']),
    ('cst', 'Community Security Trust', 'ngo', NGO, [r'\bcst\b', r'community security trust']),
    ('tell-mama', 'Tell MAMA', 'ngo', NGO, [r'tell mama']),
    ('adl', 'Anti-Defamation League', 'ngo', NGO, [r'anti[- ]defamation', r'\badl\b']),
    ('jfna', 'Jewish Federations of North America', 'ngo', NGO, [r'jewish federations']),
    ('rossing', 'Rossing Center for Education and Dialogue', 'ngo', NGO, [r'rossing']),
    ('j-street', 'J Street', 'ngo', NGO, [r'j street']),
    ('fidh', 'International Federation for Human Rights', 'ngo', NGO, [r'\bfidh\b', r'federation for human rights']),
    ('ecchr', 'European Center for Constitutional and Human Rights', 'ngo', NGO, [r'\becchr\b', r'constitutional and human rights']),
    ('wcc', 'World Council of Churches', 'ngo', NGO, [r'world council of churches']),
    ('jvp', 'Jewish Voice for Peace', 'ngo', NGO, [r'jewish voice for peace']),

    # --- Academic and research ------------------------------------------------------
    ('lancet', 'The Lancet and Lancet Global Health', 'journal', ACADEMIC, [r'\blancet\b']),
    ('max-planck', 'Max Planck Institute for Demographic Research', 'research', ACADEMIC, [r'max planck']),
    ('costs-of-war', 'Brown University Costs of War', 'research', ACADEMIC,
     [r'costs of war', r'brown university']),
    ('quincy', 'Quincy Institute', 'research', ACADEMIC, [r'quincy']),
    ('sipri', 'SIPRI', 'research', ACADEMIC,
     [r'\bsipri\b', r'stockholm international peace research']),
    ('fas', 'Federation of American Scientists', 'research', ACADEMIC,
     [r'federation of american scientists']),
    ('lshtm', 'London School of Hygiene and Tropical Medicine', 'research', ACADEMIC,
     [r'london school of hygiene', r'\byale\b']),
    ('morris', 'Benny Morris and the Israeli New Historians', 'scholarship', ACADEMIC,
     [r'benny morris', r'\bshlaim\b', r'\bpapp[ée]\b', r'raz segal', r'omer bartov', r'amos goldberg']),
    ('khalidi', 'Rashid Khalidi, The Hundred Years War on Palestine', 'scholarship', ACADEMIC,
     [r'khalidi']),
    ('merip', 'MERIP', 'scholarship', ACADEMIC, [r'\bmerip\b']),
    ('chatham', 'Chatham House', 'research', ACADEMIC, [r'chatham house']),
    ('reuters-institute', 'Reuters Institute for the Study of Journalism', 'research', ACADEMIC,
     [r'reuters institute']),
    ('journal', 'Peer-reviewed journals and university presses', 'journal', ACADEMIC,
     [r'journal of', r'university press', r'\bjacobin\b', r'posen library', r'american jewish archives']),

    # --- States and parliaments -------------------------------------------------------
    ('us-congress', 'US Congress and the Congressional Research Service', 'state', STATE,
     [r'congressional research service', r'\brl33222\b', r'library of congress', r'us congress',
      r'\b118-50\b']),
    ('uk-gov', 'UK Government records', 'state', STATE,
     [r'gov\.uk', r'export[- ]licensing', r'home office', r'high court of justice \(uk\)']),
    ('germany', 'German Federal Ministry for Economic Affairs and Energy', 'state', STATE,
     [r'german federal ministry']),
    ('uk-courts', 'UK courts', 'court', STATE, [r'\beat 84\b', r'employment appeal tribunal']),
    ('founding-texts', 'Founding Zionist texts and primary documents', 'archive', ARCHIVE,
     [r'der judenstaat', r'ahad ha', r'truth from eretz', r'iron wall', r'herzl',
      r'j50 declaration', r'european jewish congress']),
    ('documentary', 'Documentary film and broadcast interviews', 'press', MEDIA,
     [r'the gatekeepers', r'dror moreh', r'democracy now', r'the real news',
      r'shihab[- ]eldin', r'interview with']),
    ('cia-archive', 'Declassified state archives', 'archive', ARCHIVE,
     [r'\bcia\b', r'declassified', r'anglo[- ]american committee', r'survey of palestine',
      r'armistice agreement']),

    # --- Media ----------------------------------------------------------------------------
    ('reuters', 'Reuters', 'press', MEDIA, [r'\breuters\b(?! institute)']),
    ('ap', 'Associated Press', 'press', MEDIA, [r'associated press', r'\bap\b']),
    ('bbc', 'BBC', 'press', MEDIA, [r'\bbbc\b']),
    ('guardian', 'The Guardian', 'press', MEDIA, [r'\bguardian\b']),
    ('nyt', 'The New York Times', 'press', MEDIA, [r'new york times']),
    ('wapo', 'The Washington Post', 'press', MEDIA, [r'washington post']),
    ('wsj', 'The Wall Street Journal', 'press', MEDIA, [r'wall street journal']),
    ('cnn', 'CNN', 'press', MEDIA, [r'\bcnn\b']),
    ('npr', 'NPR', 'press', MEDIA, [r'\bnpr\b']),
    ('aljazeera', 'Al Jazeera', 'press', MEDIA, [r'al jazeera']),
    ('mee', 'Middle East Eye', 'press', MEDIA, [r'middle east eye']),
    ('new-arab', 'The New Arab', 'press', MEDIA, [r'new arab', r'al[- ]quds', r'\bsiasat\b']),
    ('trt', 'TRT World', 'press', MEDIA, [r'\btrt\b']),
    ('france24', 'France 24 and Euronews', 'press', MEDIA, [r'france 24', r'euronews']),
    ('sunday-times', 'The Sunday Times', 'press', MEDIA, [r'sunday times']),
    ('nbc', 'NBC News', 'press', MEDIA, [r'\bnbc\b']),
    ('cbs', 'CBS News', 'press', MEDIA, [r'\bcbs\b']),
    ('abc', 'ABC News', 'press', MEDIA, [r'\babc news\b']),
    ('fortune', 'Fortune', 'press', MEDIA, [r'\bfortune\b']),
    ('newyorker', 'The New Yorker', 'press', MEDIA, [r'new yorker']),
    ('trade-press', 'Entertainment and trade press', 'press', MEDIA,
     [r'hollywood reporter', r'\bvariety\b', r'\bdeadline\b', r'rolling stone', r'\bbillboard\b',
      r'jewish insider', r'\bjta\b', r'common dreams', r'\btruthout\b', r'mediaite',
      r'daily caller', r'taipei times', r'press tv', r'geopolitical economy', r'novara',
      r'declassified uk', r'the recount', r'relief ?web', r'\bimeu\b', r'\bafp\b', r'wire coverage',
      r'international (wire )?(press|coverage)', r'\bjoe\b', r'stereogum', r'\btmz\b', r'\bgbh\b',
      r'usa today', r'boston globe', r'\bcnbc\b', r'fox business', r'\bconsequence\b']),

    # --- Open data projects ---------------------------------------------------------------
    ('tfp', 'Tech For Palestine open datasets', 'dataset', DATA_PROJECT,
     [r'tech for palestine']),
    ('remember-children', 'Remember These Children', 'dataset', DATA_PROJECT,
     [r'remember (these )?children', r'american educational trust', r'washington report']),
    ('wikipedia', 'Wikipedia (with its own cited sources)', 'reference', DATA_PROJECT,
     [r'wikipedia']),
    ('site-derived', 'Derived within this record', 'derived', DATA_PROJECT,
     [r'^derived\b', r'\bderived (from|embargo)', r'this record', r'the report,? (§|part|appendix)',
      r'^report,? ', r'\breport §', r'\bsee §', r'cited at §', r'survey data cited',
      r'independent modelling', r'^reported \w+ 20\d\d$']),
]

COMPILED = [(sid, name, kind, origin, [re.compile(p, re.I) for p in pats])
            for sid, name, kind, origin, pats in REGISTRY]

# Human-readable description of each origin class, shown beside the switch.
ORIGIN_LABELS = OrderedDict([
    (PAL_STATE, 'Palestinian official bodies'),
    (PAL_NGO, 'Palestinian human rights organisations'),
    (ISR_STATE, 'Israeli state, military and ministries'),
    (ISR_COURT, 'Israeli courts and commissions'),
    (ISR_NGO, 'Israeli human rights organisations'),
    (ISR_MEDIA, 'Israeli press'),
    (UN, 'United Nations bodies'),
    (COURT, 'International courts'),
    (NGO, 'International human rights organisations'),
    (ACADEMIC, 'Academic and peer-reviewed research'),
    (STATE, 'Western states and parliaments'),
    (MEDIA, 'International press'),
    (DATA_PROJECT, 'Open datasets and derived figures'),
    (ARCHIVE, 'Declassified archives'),
])

# The switches offered on the page. Each names the classes it removes and the
# question it answers. The order is the order they are drawn in.
SWITCHES = [
    ('no-palestinian', 'Remove every Palestinian source',
     [PAL_STATE, PAL_NGO],
     'The commonest objection to this record is that the casualty figures come from '
     'the Gaza Ministry of Health. This removes the ministry, the Palestinian Central '
     'Bureau of Statistics, WAFA and every Palestinian human rights organisation.'),
    ('no-israeli', 'Remove every Israeli source',
     [ISR_STATE, ISR_COURT, ISR_NGO, ISR_MEDIA],
     'The mirror objection, that Israeli critics of the state are unrepresentative. '
     "This removes B'Tselem, Yesh Din, Breaking the Silence, Haaretz, the Israeli "
     'courts and the military’s own statements.'),
    ('no-un', 'Remove the United Nations',
     [UN],
     'The objection that UN bodies are institutionally hostile. This removes OCHA, '
     'UNRWA, the WHO, the Commission of Inquiry, the Special Rapporteurs and the IPC.'),
    ('no-ngo', 'Remove every human rights organisation',
     [NGO, PAL_NGO, ISR_NGO],
     'The objection that the NGO sector campaigns rather than reports. This removes '
     'Amnesty, Human Rights Watch and every organisation of that kind on any side.'),
    ('israeli-western-only', 'Keep only Israeli and Western sources',
     [PAL_STATE, PAL_NGO, UN, NGO, DATA_PROJECT],
     'The hardest test the record can be put to: nothing Palestinian, nothing from the '
     'UN, nothing from an NGO. What is left is the Israeli state, the Israeli press, '
     'Israeli human rights organisations, Western states, Western courts, Western '
     'universities and the Western press.'),
]


def classify(text):
    """Return the ordered list of source ids a free-text source string names."""
    if not text:
        return []
    hits = []
    for sid, _name, _kind, _origin, pats in COMPILED:
        for pat in pats:
            if pat.search(text):
                hits.append(sid)
                break
    return hits


def short(text, limit=150):
    text = re.sub(r'\s+', ' ', (text or '')).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'


def walk(node, path, out, filename):
    """Collect every object carrying a non-empty `source` string."""
    if isinstance(node, dict):
        # elements.json draws an instrument graph whose edges are {source, target}
        # pairs. Those are node ids, not citations, and must not be read as one.
        src = None if 'target' in node else (node.get('source') or node.get('body'))
        if isinstance(src, str) and src.strip():
            label = (node.get('label') or node.get('title') or node.get('speaker')
                     or node.get('event') or node.get('name') or node.get('claim') or '')
            value = node.get('value')
            if value is None:
                value = node.get('quote') or node.get('note') or node.get('text') or ''
            out.append({
                'file': filename,
                'path': path,
                'label': short(str(label), 180),
                'value': value if isinstance(value, (int, float)) else short(str(value), 240),
                'numeric': isinstance(value, (int, float)),
                'ref': node.get('ref') or node.get('section') or '',
                'date': node.get('date') or node.get('sort') or '',
                'source_text': short(src, 400),
                'sources': classify(src),
            })
        for key, val in node.items():
            walk(val, '%s.%s' % (path, key) if path else key, out, filename)
    elif isinstance(node, list):
        for i, val in enumerate(node):
            walk(val, '%s[%d]' % (path, i), out, filename)


def build():
    claims = []
    for name in SCAN:
        fp = os.path.join(DATA, name)
        if not os.path.exists(fp):
            continue
        with open(fp, encoding='utf-8') as fh:
            walk(json.load(fh), '', claims, name)

    # Give every claim a stable id, so a link to a chain survives a rebuild as
    # long as the claim itself does.
    seen = Counter()
    for claim in claims:
        base = re.sub(r'[^a-z0-9]+', '-', (claim['file'].split('.')[0] + '-' + claim['label']).lower()).strip('-')
        base = base[:70] or 'claim'
        seen[base] += 1
        claim['id'] = base if seen[base] == 1 else '%s-%d' % (base, seen[base])

    used = Counter()
    for claim in claims:
        for sid in claim['sources']:
            used[sid] += 1

    sources = []
    for sid, name, kind, origin, _pats in REGISTRY:
        if not used[sid]:
            continue
        sources.append({
            'id': sid, 'name': name, 'kind': kind, 'origin': origin,
            'origin_label': ORIGIN_LABELS[origin], 'claims': used[sid],
        })
    sources.sort(key=lambda s: (-s['claims'], s['name']))

    by_origin = Counter(s['origin'] for s in sources)
    origin_of = {s['id']: s['origin'] for s in sources}

    # A claim counts once for an origin however many of that origin's bodies it
    # cites: the question the page answers is how many claims a whole class of
    # source is holding up, not how many citations it supplies.
    origin_claims = Counter()
    for claim in claims:
        for origin in {origin_of[sid] for sid in claim['sources'] if sid in origin_of}:
            origin_claims[origin] += 1

    # The adversary switch, computed here rather than in the browser so the
    # figures on the page are the same figures the open-data file carries.
    switches = []
    attributed = [c for c in claims if c['sources']]
    for key, label, removed, blurb in SWITCHES:
        stands = 0
        for claim in attributed:
            if any(origin_of.get(sid) not in removed for sid in claim['sources']):
                stands += 1
        switches.append({
            'id': key, 'label': label, 'removes': removed, 'note': blurb,
            'stands': stands, 'falls': len(attributed) - stands,
            'share': round(100.0 * stands / len(attributed), 1) if attributed else 0.0,
        })

    files = []
    per_file = Counter(c['file'] for c in claims)
    for name in SCAN:
        if per_file[name]:
            files.append({'file': name, 'claims': per_file[name]})

    out = {
        'meta': {
            'title': 'Provenance graph',
            'description': (
                'Every curated claim on this site, joined to the bodies it rests on. '
                'Source strings are normalised to entities with stable identifiers, and '
                'each entity is classified by origin so that a whole class of source can '
                'be removed and the remainder recounted.'
            ),
            'generated': __import__('datetime').date.today().isoformat(),
            'origins': [{'id': k, 'label': v, 'sources': by_origin[k], 'claims': origin_claims[k]}
                        for k, v in ORIGIN_LABELS.items()],
        },
        'summary': {
            'claims': len(claims),
            'attributed': len(attributed),
            'unattributed': len(claims) - len(attributed),
            'sources': len(sources),
            'origins': len(by_origin),
            'multi_source': sum(1 for c in attributed if len(c['sources']) > 1),
            'independent': sum(1 for c in attributed
                               if len({origin_of.get(s) for s in c['sources']}) > 1),
        },
        'switches': switches,
        'sources': sources,
        'files': files,
        'claims': claims,
    }
    return out, claims


def main():
    out, claims = build()
    if '--report' in sys.argv:
        misses = Counter(c['source_text'] for c in claims if not c['sources'])
        print('claims %d, unmatched %d, distinct unmatched strings %d'
              % (len(claims), sum(misses.values()), len(misses)))
        for text, count in misses.most_common(60):
            print('%3d  %s' % (count, text[:110]))
        return
    path = os.path.join(DATA, 'provenance.json')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    s = out['summary']
    print('provenance.json — %d claims, %d attributed, %d sources, %d origins'
          % (s['claims'], s['attributed'], s['sources'], s['origins']))
    for sw in out['switches']:
        print('  %-22s %d of %d still stand (%.1f%%)'
              % (sw['id'], sw['stands'], s['attributed'], sw['share']))


if __name__ == '__main__':
    main()
