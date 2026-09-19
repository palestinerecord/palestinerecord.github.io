"""The accountability ledger — the people and the companies named in the record.

Every other page on this dashboard counts states, incidents or figures. This one
counts persons and companies, because that is the level at which international
criminal law actually operates: a state cannot be arrested, and a treaty binds a
government while a contract binds a firm.

Nothing here is asserted independently of the rest of the record. A person is on
the ledger because the report or the statements file names them; their statements
are joined from data/statements.json by name, the sections that discuss them are
found by scanning data/report.json, and the sanctions against them are joined from
data/world-positions.json. The curated layer below adds only what the data cannot
express: which office someone holds, whether a court has issued a warrant, and
which measure names them. Every curated line carries the report section it comes
from, so a reader can check it against the source document in one click.

Run after build.py, and before manifest.py:

    python3 entities.py     # → data/entities.json
"""

import json
import pathlib
import re
import unicodedata

DATA = pathlib.Path(__file__).resolve().parent / 'data'


def load(name):
    return json.loads((DATA / name).read_text())


def slug(name):
    n = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-zA-Z0-9]+', '-', n).strip('-').lower()


# ---------------------------------------------------------------- the classes

CLASSES = [
    ('government', 'Israeli government', 'Ministers, the President and members of the Knesset — the level at which the specific intent for genocide has to be proved, and the level at which it was spoken aloud.'),
    ('military', 'Israeli military command', 'Officers who commanded, spoke for or administered the campaign. Command responsibility under Article 28 of the Rome Statute attaches to what a commander knew and failed to prevent, not only to what he ordered.'),
    ('allied', 'Allied governments', 'Officials of the states that supply the weapons, the money and the diplomatic cover, whose own words are part of the record.'),
    ('accountability', 'The accountability machinery', 'Judges, prosecutors and mandate holders who pursued the case — and who were sanctioned by a permanent member of the Security Council for doing so.'),
    ('armed-group', 'Palestinian armed groups', 'Those against whom the same court sought warrants for the crimes of 7 October, held to the same standard and listed in the same place.'),
    ('dissent', 'Israeli and Jewish dissent', 'Former prime ministers, former security chiefs, historians and writers who put the finding on the record from inside the community it is said to injure.'),
    ('historic', 'The founding record', 'Figures of the movement and of the state before 2023, quoted because the pattern they describe is the one the report documents continuing.'),
]

# Speakers in data/statements.json that are institutions, surveys or collective
# testimony rather than a person. Listed exhaustively rather than guessed at, and
# asserted below: a new speaker must be classified before the file will build.
ORG_SPEAKERS = {
    '104-human-rights-organisations',
    'achord-center-hebrew-university-of-jerusalem',
    'al-haq-forensic-architecture-investigation-unit',
    'albert-einstein-hannah-arendt-sidney-hook-and-others',
    'american-council-for-judaism',
    'amnesty-international',
    'anonymous-idf-officer',
    'b-tselem',
    'breaking-the-silence',
    'central-conference-of-american-rabbis',
    'genocide-watch',
    'geocartography-knowledge-group-penn-state-university',
    'human-rights-watch',
    'international-association-of-genocide-scholars',
    'international-court-of-justice',
    'international-criminal-court-pre-trial-chamber-i',
    'israeli-public-opinion',
    'jewish-council-of-australia',
    'jewish-federations-of-north-america-burson',
    'law-for-palestine',
    'lemkin-institute-for-genocide-prevention',
    'lod-district-court-israel',
    'nachala-settler-movement-march-28-ministers-and-mks',
    'ohchr',
    'physicians-for-human-rights-israel',
    'rossing-center-for-education-and-dialogue-federica-sasso',
    'supreme-court-of-new-south-wales-fagan-j',
    'un-committee-on-the-elimination-of-racial-discrimination',
    'un-independent-international-commission-of-inquiry-on-the-opt',
    'yesh-din',
}

# The class of every person who speaks in the statements file. The office in the
# ledger is taken from the statement itself, so only the classification is here.
PERSON_CLASS = {
    'benjamin-netanyahu': 'government',
    'isaac-herzog': 'government',
    'itamar-ben-gvir': 'government',
    'bezalel-smotrich': 'government',
    'israel-katz': 'government',
    'yoav-gallant': 'government',
    'amichai-eliyahu': 'government',
    'may-golan': 'government',
    'galit-distel-atbaryan': 'government',
    'miki-zohar': 'government',
    'shlomo-karhi': 'government',
    'yoav-kisch': 'government',
    'avi-dichter': 'government',
    'yitzhak-wasserlauf': 'government',
    'avigdor-lieberman': 'government',
    'tally-gotliv': 'government',
    'ariel-kallner': 'government',
    'nissim-vaturi': 'government',
    'almog-cohen': 'government',
    'ohad-tal': 'government',
    'michal-waldiger': 'government',
    'hanoch-milwidsky': 'government',
    'yitzhak-kroizer': 'government',
    'meirav-ben-ari': 'government',
    'moshe-feiglin': 'government',
    'yair-lapid': 'government',
    'lieutenant-general-eyal-zamir': 'military',
    'maj-gen-aharon-haliva': 'military',
    'maj-gen-avi-bluth': 'military',
    'maj-gen-gadi-eisenkot': 'military',
    'maj-gen-ghassan-alian': 'military',
    'maj-gen-res-giora-eiland': 'military',
    'rear-admiral-daniel-hagari': 'military',
    'moshe-ya-alon': 'military',
    'ezra-yachin': 'military',
    'lt-gen-rafael-eitan': 'military',
    'donald-j-trump': 'allied',
    'mike-huckabee': 'allied',
    'francesca-albanese': 'accountability',
    'ehud-olmert': 'dissent',
    'ehud-barak': 'dissent',
    'avraham-shalom': 'dissent',
    'meir-dagan': 'dissent',
    'michael-ben-yair': 'dissent',
    'avi-shlaim': 'dissent',
    'ilan-pappe': 'dissent',
    'yuli-novak': 'dissent',
    'hana-bendcowsky': 'dissent',
    'yuval-abraham': 'dissent',
    'naomi-klein': 'dissent',
    'peter-beinart': 'dissent',
    'masha-gessen': 'dissent',
    'gabor-mate': 'dissent',
    'jonathan-glazer': 'dissent',
    'hannah-einbinder': 'dissent',
    'ahad-ha-am-asher-ginsberg': 'historic',
    'theodor-herzl': 'historic',
    'vladimir-jabotinsky': 'historic',
    'david-ben-gurion': 'historic',
    'arthur-ruppin': 'historic',
    'yitzhak-yezernitzky-yitzhak-shamir': 'historic',
    'moshe-dayan': 'historic',
    'golda-meir': 'historic',
    'yitzhak-rabin': 'historic',
}

# People the record turns on who do not appear in the statements file, either
# because a court rather than a microphone put them there, or because what is
# recorded about them is a measure taken against them.
EXTRA_PERSONS = [
    {'id': 'mohammed-deif', 'name': 'Mohammed Deif', 'role': 'Commander of the al-Qassam Brigades, the armed wing of Hamas',
     'class': 'armed-group', 'country': 'Palestine'},
    {'id': 'karim-khan', 'name': 'Karim Khan KC', 'role': 'Chief Prosecutor of the International Criminal Court until his removal on 24 July 2026',
     'class': 'accountability', 'country': 'United Kingdom'},
    {'id': 'mame-mandiaye-niang', 'name': 'Mame Mandiaye Niang', 'role': 'Deputy Prosecutor, and Chief Prosecutor of the International Criminal Court from July 2026',
     'class': 'accountability', 'country': 'Senegal'},
    {'id': 'nazhat-shameem-khan', 'name': 'Nazhat Shameem Khan', 'role': 'Deputy Prosecutor of the International Criminal Court',
     'class': 'accountability', 'country': 'Fiji'},
    {'id': 'kimberly-prost', 'name': 'Kimberly Prost', 'role': 'Judge of the International Criminal Court',
     'class': 'accountability', 'country': 'Canada'},
    {'id': 'nicolas-guillou', 'name': 'Nicolas Guillou', 'role': 'Judge of the International Criminal Court',
     'class': 'accountability', 'country': 'France'},
    {'id': 'tomoko-akane', 'name': 'Tomoko Akane', 'role': 'President of the International Criminal Court',
     'class': 'accountability', 'country': 'Japan'},
    {'id': 'abdoulaye-seye', 'name': 'Abdoulaye Seye', 'role': 'Senior trial lawyer at the International Criminal Court',
     'class': 'accountability', 'country': 'Senegal'},
]

# What a court has done about a person, in the court's own terms. Status is the
# present legal position, which is the only thing a reader can act on.
WARRANTS = {
    'benjamin-netanyahu': {
        'court': 'International Criminal Court, Pre-Trial Chamber I',
        'date': '21 November 2024',
        'counts': 'The war crime of starvation of civilians as a method of warfare, and the crimes against humanity of murder, persecution and other inhumane acts, over the period from at least 8 October 2023 to 20 May 2024.',
        'status': 'In force. The Appeals Chamber rejected the jurisdictional challenge on 15–16 December 2025 by three votes to two, and a separate request to withdraw the warrants outright was refused.',
        'ref': '§15.5',
    },
    'yoav-gallant': {
        'court': 'International Criminal Court, Pre-Trial Chamber I',
        'date': '21 November 2024',
        'counts': 'The same counts as the warrant against the Prime Minister: starvation as a method of warfare, murder, persecution and other inhumane acts.',
        'status': 'In force, on the same two rulings that upheld the warrant against Netanyahu.',
        'ref': '§15.5',
    },
    'mohammed-deif': {
        'court': 'International Criminal Court, Pre-Trial Chamber I',
        'date': '21 November 2024',
        'counts': 'The crimes against humanity of murder, extermination, torture, rape and other forms of sexual violence, hostage-taking and other inhumane acts, and the war crimes of murder, cruel treatment, torture, rape, hostage-taking and outrages upon personal dignity, committed on and after 7 October 2023.',
        'status': 'Withdrawn on 27 February 2025, when the Chamber accepted evidence of his death. The Chamber issued the warrant against him on the same day as the two against Israeli ministers, on the same standard of proof, which is the answer to the claim that the Court applies one law to one side.',
        'ref': '§18.3',
    },
}

# Measures aimed at a named individual. The country lists join to
# world-positions.json so the same names are used on the ledger and on the maps.
SANCTIONS = [
    {'id': 'officials-2025', 'persons': ['itamar-ben-gvir', 'bezalel-smotrich'],
     'date': 'June 2025', 'measure': 'Travel bans and asset freezes',
     'by': ['United Kingdom', 'Australia', 'Canada', 'New Zealand', 'Norway'],
     'reason': 'Incitement of settler violence and statements promoting the forcible displacement of Palestinians.',
     'ref': '§15.3', 'direction': 'conduct'},
    {'id': 'france-bengvir-2026', 'persons': ['itamar-ben-gvir'],
     'date': 'May 2026', 'measure': 'Entry ban',
     'by': ['France'],
     'reason': 'Barred from entry by France.',
     'ref': '§15.5', 'direction': 'conduct'},
    {'id': 'ireland-ministers-2026', 'persons': ['itamar-ben-gvir', 'bezalel-smotrich'],
     'date': '5 June 2026', 'measure': 'Travel bans',
     'by': ['Ireland'],
     'reason': 'Imposed by the Justice Minister, Jim O\'Callaghan.',
     'ref': '§15.5', 'direction': 'conduct'},
    {'id': 'eo-14203-khan', 'persons': ['karim-khan'],
     'date': '6 February 2025', 'measure': 'Asset freeze and entry ban under Executive Order 14203',
     'by': ['United States'],
     'reason': 'Designated for seeking the arrest warrants against Netanyahu and Gallant.',
     'ref': '§15.13', 'direction': 'accountability'},
    {'id': 'eo-14203-albanese', 'persons': ['francesca-albanese'],
     'date': '9 July 2025', 'measure': 'Designation under Executive Order 14203',
     'by': ['United States'],
     'reason': 'The first time a serving holder of a UN special procedures mandate has been sanctioned by a member state — characterised by UN independent experts as a violation of the 1946 Convention on the Privileges and Immunities of the United Nations. A United States District Court suspended the designation on 13 May 2026 pending a ruling on the merits.',
     'ref': '§15.13', 'direction': 'accountability'},
    {'id': 'eo-14203-deputies', 'persons': ['nazhat-shameem-khan', 'mame-mandiaye-niang', 'kimberly-prost', 'nicolas-guillou'],
     'date': '20 August 2025', 'measure': 'Designation under Executive Order 14203',
     'by': ['United States'],
     'reason': 'Both Deputy Prosecutors and two judges, designated together. Judge Prost has described being unable to use her credit card or reach her Google and Amazon accounts.',
     'ref': '§15.13', 'direction': 'accountability'},
    {'id': 'eo-14203-president', 'persons': ['tomoko-akane', 'abdoulaye-seye'],
     'date': '18 August 2026', 'measure': 'Designation under Executive Order 14203',
     'by': ['United States'],
     'reason': 'The Court\'s serving President and a senior trial lawyer reported to have worked on the team that sought the Netanyahu warrant. The Court called the measures a flagrant attack on the independence of an impartial judicial institution.',
     'ref': '§15.13', 'direction': 'accountability'},
]

# Names as they are written in the report, where that differs from the name in
# the statements file, so the section scan finds every mention.
ALIASES = {
    'benjamin-netanyahu': ['Netanyahu'],
    'yoav-gallant': ['Gallant'],
    'itamar-ben-gvir': ['Ben-Gvir', 'Ben Gvir'],
    'bezalel-smotrich': ['Smotrich'],
    'isaac-herzog': ['Herzog'],
    'israel-katz': ['Katz'],
    'ehud-olmert': ['Olmert'],
    'lieutenant-general-eyal-zamir': ['Eyal Zamir', 'Zamir'],
    'maj-gen-aharon-haliva': ['Aharon Haliva', 'Haliva'],
    'maj-gen-avi-bluth': ['Avi Bluth', 'Bluth'],
    'maj-gen-gadi-eisenkot': ['Gadi Eisenkot', 'Eisenkot'],
    'maj-gen-ghassan-alian': ['Ghassan Alian', 'Alian'],
    'maj-gen-res-giora-eiland': ['Giora Eiland', 'Eiland'],
    'rear-admiral-daniel-hagari': ['Daniel Hagari', 'Hagari'],
    'lt-gen-rafael-eitan': ['Rafael Eitan'],
    'moshe-ya-alon': ["Ya'alon"],
    'yitzhak-yezernitzky-yitzhak-shamir': ['Yitzhak Shamir', 'Shamir'],
    'ahad-ha-am-asher-ginsberg': ["Ahad Ha'am"],
    'karim-khan': ['Karim Khan'],
    'francesca-albanese': ['Albanese'],
    'donald-j-trump': ['Donald Trump', 'Trump'],
    'mohammed-deif': ['Deif'],
    'gabor-mate': ['Gabor Mate'],
    'ilan-pappe': ['Ilan Pappe'],
}


# --------------------------------------------------------------- the companies

# Every company below is named in the report, at the section given, and the
# supply line is the one the report documents. A listing is not a criminal
# charge: the UN database records that an entity carries on one of ten activities
# the Human Rights Council identified in the settlements, and the arms and
# services entries record a commercial relationship, not a finding of guilt.
COMPANIES = [
    {'id': 'elbit-systems', 'name': 'Elbit Systems', 'country': 'Israel', 'sector': 'arms',
     'supplies': 'Israel\'s largest weapons manufacturer, supplying drones, artillery systems and munitions used in the campaign, with research and production sites in the United Kingdom.',
     'note': 'On 4 February 2026 a jury acquitted six Palestine Action defendants on every count, including aggravated burglary, arising from the August 2024 action at Elbit\'s Filton site in Bristol. They had been held on remand for seventeen months and argued they acted to prevent the facility\'s output being used in the conduct this report documents.',
     'ref': '§13.8'},
    {'id': 'lockheed-martin', 'name': 'Lockheed Martin', 'country': 'United States', 'sector': 'arms',
     'supplies': 'Prime contractor for the F-35, the aircraft at the centre of the United Kingdom\'s component exemption and of the deliveries recorded in the SIPRI series.',
     'note': 'Named by Amnesty International on 18 September 2025, in POL 40/0289/2025, among the corporations enabling the documented conduct.',
     'ref': '§13.8'},
    {'id': 'boeing', 'name': 'Boeing', 'country': 'United States', 'sector': 'arms',
     'supplies': 'Supplier of munitions and aircraft to the Israeli air force, including the guidance kits used in Gaza.',
     'note': 'Named in the same Amnesty analysis of 18 September 2025.',
     'ref': '§13.8'},
    {'id': 'bae-systems', 'name': 'BAE Systems', 'country': 'United Kingdom', 'sector': 'arms',
     'supplies': 'Produces around 15% of every F-35 built, the aircraft used to bomb Gaza, and holds strategic partnerships with four of the universities in the Defence Universities Alliance.',
     'note': 'An openDemocracy investigation found British universities accepted almost £100 million from defence companies arming Israel over five years, more than £20 million of it from BAE Systems alone.',
     'ref': '§13.7'},
    {'id': 'palantir', 'name': 'Palantir Technologies', 'country': 'United States', 'sector': 'technology',
     'supplies': 'Signed a strategic partnership with the Israeli Ministry of Defence in January 2024 to supply data-analytics software for what the company described as war-related missions.',
     'note': 'The chief executive, Alex Karp, has said publicly that the product is used, on occasion, to kill people. Palantir disputed Amnesty\'s characterisation.',
     'ref': '§13.8'},
    {'id': 'microsoft', 'name': 'Microsoft', 'country': 'United States', 'sector': 'technology',
     'supplies': 'A $125.4 million software agreement with the Israeli state entered in 2024, disclosed only inside a budget-execution report; separately, Azure was used by Unit 8200 to store recordings of millions of Palestinian phone calls.',
     'note': 'Middle East Eye revealed the contract in September 2026; the Guardian, +972 Magazine and Local Call revealed the Azure storage in August 2025. Microsoft said it had nothing to add.',
     'ref': '§13.8'},
    {'id': 'nextvision', 'name': 'NextVision', 'country': 'Israel', 'sector': 'arms',
     'supplies': 'Manufactures the cameras carried by Israeli military drones.',
     'note': 'The Bureau of Investigative Journalism reported on 3 September 2026 that Barclays had approved NextVision as a future corporate client, a decision the Bureau said undercuts the bank\'s own public distancing from companies supplying the Israeli military.',
     'ref': '§13.8'},
    {'id': 'barclays', 'name': 'Barclays', 'country': 'United Kingdom', 'sector': 'finance',
     'supplies': 'Holds and trades shares in defence companies supplying Israel, and in September 2026 approved a supplier of Israeli drone components as a client.',
     'note': 'Barclays states publicly that it does not itself invest in the nine defence companies campaigners have identified, and characterises its role as trading shares on behalf of clients.',
     'ref': '§13.8'},
    {'id': 'chevron', 'name': 'Chevron', 'country': 'United States', 'sector': 'energy',
     'supplies': 'One of six oil majors that Oil Change International found supply more than a third of Israel\'s oil between them; Chevron accounts for about 8%.',
     'note': 'Fuel is a material input to an air campaign in the same sense as munitions, which is why the complicity question raised over arms exports is raised over fuel too.',
     'ref': '§13.8'},
    {'id': 'vitol', 'name': 'Vitol', 'country': 'Switzerland', 'sector': 'energy',
     'supplies': 'Identified by Oil Change International and SOMO as one of the two largest crude traders supplying Israel during the war, together shipping about 22 million barrels, roughly 11% of Israel\'s crude imports between October 2023 and June 2026.',
     'note': 'The majority moved through the Turkish port of Ceyhan, despite Türkiye\'s own declared embargo.',
     'ref': '§13.8'},
    {'id': 'caterpillar', 'name': 'Caterpillar', 'country': 'United States', 'sector': 'equipment',
     'supplies': 'Armoured bulldozers used in demolitions in the occupied territory.',
     'note': 'KLP, Norway\'s largest pension company, sold its stake in June 2024, finding an unacceptable risk that the bulldozers were used in violations of international law.',
     'ref': None, 'source': 'The divestment ledger — KLP exclusion, June 2024'},
]

DIVEST_TARGETS = {
    'caterpillar': ['KLP'],
}


# ------------------------------------------------------------------ the states

# The 125 states parties to the Rome Statute, each of which is bound by Articles
# 86 and 89(1) to cooperate with the Court and to execute a request for arrest
# and surrender. The map name is the Natural Earth name the world geometry uses;
# where it differs from the name in the report, world-positions.json carries the
# crosswalk and validate.py checks that every one of them joins to a polygon.
# Two of the 125 need a note rather than a polygon: the geometry names the
# Gambia without its article, and the Cook Islands are below the resolution of
# the 241-polygon world file, so the map cannot shade them and says so.
ICC_MAP = {
    'The Gambia': 'Gambia',
    'Cook Islands': None,
}

ICC_PARTIES = [
    'Afghanistan', 'Albania', 'Andorra', 'Antigua and Barbuda', 'Argentina', 'Armenia',
    'Australia', 'Austria', 'Bangladesh', 'Barbados', 'Belgium', 'Belize', 'Benin',
    'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Bulgaria', 'Burkina Faso',
    'Cambodia', 'Canada', 'Cape Verde', 'Central African Republic', 'Chad', 'Chile',
    'Colombia', 'Comoros', 'Democratic Republic of the Congo', 'Republic of the Congo',
    'Cook Islands', 'Costa Rica', "Côte d'Ivoire", 'Croatia', 'Cyprus', 'Czech Republic',
    'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'El Salvador',
    'Estonia', 'Fiji', 'Finland', 'France', 'Gabon', 'The Gambia', 'Georgia', 'Germany',
    'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guyana', 'Honduras', 'Hungary',
    'Iceland', 'Ireland', 'Italy', 'Japan', 'Jordan', 'Kenya', 'Kiribati', 'Latvia',
    'Lesotho', 'Liberia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
    'Malawi', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritius', 'Mexico',
    'Moldova', 'Mongolia', 'Montenegro', 'Namibia', 'Nauru', 'Netherlands', 'New Zealand',
    'Niger', 'Nigeria', 'North Macedonia', 'Norway', 'Palestine', 'Panama', 'Paraguay',
    'Peru', 'Poland', 'Portugal', 'Romania', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Senegal', 'Serbia',
    'Seychelles', 'Sierra Leone', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea',
    'Spain', 'Suriname', 'Sweden', 'Switzerland', 'Tajikistan', 'Tanzania', 'Timor-Leste',
    'Trinidad and Tobago', 'Tunisia', 'Uganda', 'Ukraine', 'United Kingdom', 'Uruguay',
    'Vanuatu', 'Venezuela', 'Zambia',
]

# Withdrawal takes a year to bite under Article 127(1), so each of these states
# is still a party, and still bound, for the whole of that year.
ICC_LEAVING = [
    {'name': 'Niger', 'notified': '18 June 2026', 'effective': '18 June 2027'},
    {'name': 'Burkina Faso', 'notified': '24 June 2026', 'effective': '24 June 2027'},
    {'name': 'Mali', 'notified': '24 June 2026', 'effective': '24 June 2027'},
    {'name': 'Venezuela', 'notified': '24 July 2026', 'effective': '24 July 2027'},
    {'name': 'Chad', 'notified': '27 July 2026', 'effective': '27 July 2027'},
]

# What states have actually said or done about executing the warrant. Positions
# are only recorded where the report records them; silence is not counted either
# way, and the map says so.
ICC_POSITIONS = [
    {'name': 'Belgium', 'stance': 'would-enforce', 'detail': 'Among the states giving the strongest indications that the warrant would be executed.', 'ref': '§15.5'},
    {'name': 'Netherlands', 'stance': 'would-enforce', 'detail': 'Among the states giving the strongest indications that the warrant would be executed.', 'ref': '§15.5'},
    {'name': 'Ireland', 'stance': 'would-enforce', 'detail': 'Among the strongest indications of enforcement, and the Justice Minister imposed travel bans on Ben-Gvir and Smotrich on 5 June 2026.', 'ref': '§15.5'},
    {'name': 'Lithuania', 'stance': 'would-enforce', 'detail': 'Among the states giving the strongest indications that the warrant would be executed.', 'ref': '§15.5'},
    {'name': 'Slovenia', 'stance': 'would-enforce', 'detail': 'Among the states giving the strongest indications that the warrant would be executed.', 'ref': '§15.5'},
    {'name': 'Spain', 'stance': 'would-enforce', 'detail': 'Among the states giving the strongest indications that the warrant would be executed.', 'ref': '§15.5'},
    {'name': 'Canada', 'stance': 'would-enforce', 'detail': 'Prime Minister Mark Carney reaffirmed in October 2025 that Canada would arrest Netanyahu if he entered Canadian territory.', 'ref': '§15.5'},
    {'name': 'Hungary', 'stance': 'would-enforce', 'detail': 'Hosted Netanyahu in April 2025 in breach of its obligation to cooperate, a non-compliance finding referred to the Assembly of States Parties, then reversed course: the National Assembly voted 133–37 on 27 May 2026 to repeal the exit law, and Prime Minister Péter Magyar committed to arresting Netanyahu if he visits.', 'ref': '§15.5'},
    {'name': 'Switzerland', 'stance': 'would-enforce', 'detail': 'Netanyahu skipped Davos in 2026 rather than enter a state party.', 'ref': '§15.5'},
    {'name': 'South Korea', 'stance': 'would-enforce', 'detail': 'President Lee Jae Myung called Netanyahu a war criminal in May 2026 and ordered the government to assess issuing an arrest warrant in line with the ICC\'s.', 'ref': '§15.5'},
    {'name': 'France', 'stance': 'would-enforce', 'detail': 'Barred Ben-Gvir from entry in May 2026.', 'ref': '§15.5'},
    {'name': 'Poland', 'stance': 'refused', 'detail': 'Passed a government resolution guaranteeing Netanyahu safe entry for the Auschwitz commemoration — itself a breach of the Rome Statute.', 'ref': '§15.5'},
    {'name': 'United States', 'stance': 'non-party', 'detail': 'Not a party to the Rome Statute. The American Service-Members\' Protection Act of 2002 bars federal and state cooperation with the Court, and President Trump stated on 20 July 2026 that Netanyahu "will not be arrested, in any way, shape, or form" in the United States.', 'ref': '§15.5'},
    {'name': 'Türkiye', 'stance': 'other', 'detail': 'Not a party, but submitted a request to Interpol on 21 August 2026 for a Red Notice against Netanyahu. Interpol\'s constitution bars acting on requests of a predominantly political character, and no notice had issued.', 'ref': '§15.5'},
]


# ---------------------------------------------------------------------- build

TAG = re.compile(r'<[^>]+>')


def plain(html):
    return TAG.sub('', html).replace('&amp;', '&').replace('&nbsp;', ' ')


def section_text(report):
    """Every section of the report as one searchable string, with its heading."""
    out = []
    for part in report['parts']:
        for sec in part['sections']:
            text = ' '.join(plain(b.get('html', '')) for b in sec['blocks'] if b.get('html'))
            out.append({'part': part['title'], 'id': sec['id'], 'title': sec['title'], 'text': text})
    return out


def mentions(sections, names):
    """Which sections name this person, and how often. Ordered by weight, because
    a section that names someone nine times is about them and one that names them
    once is not."""
    pats = [re.compile(r'\b' + re.escape(n) + r'\b') for n in names]
    hits = []
    for sec in sections:
        n = sum(len(p.findall(sec['text'])) for p in pats)
        if n:
            hits.append({'id': sec['id'], 'title': sec['title'], 'part': sec['part'], 'n': n})
    hits.sort(key=lambda h: (-h['n'], h['title']))
    return hits


def build():
    statements = load('statements.json')
    report = load('report.json')
    sections = section_text(report)

    by_speaker = {}
    for i, item in enumerate(statements['items']):
        by_speaker.setdefault(slug(item['speaker']), []).append((i, item))

    unknown = set(by_speaker) - ORG_SPEAKERS - set(PERSON_CLASS)
    assert not unknown, 'unclassified speakers: %s' % sorted(unknown)
    stale = (ORG_SPEAKERS | set(PERSON_CLASS)) - set(by_speaker)
    assert not stale, 'classified speakers no longer in the statements file: %s' % sorted(stale)

    persons = []
    for sid, cls in PERSON_CLASS.items():
        items = by_speaker[sid]
        latest = max(items, key=lambda x: x[1]['sort'])[1]
        persons.append({
            'id': sid,
            'name': latest['speaker'],
            'role': latest['role'],
            'class': cls,
            'tier': latest['tier'],
            # Indices into data/statements.json rather than copies of it. The
            # quote a reader sees on this page is then the same object the
            # statements page reads, and the two cannot drift apart.
            'statements': [i for i, it in sorted(items, key=lambda x: x[1]['sort'])],
        })
    for extra in EXTRA_PERSONS:
        person = dict(extra)
        person['statements'] = []
        persons.append(person)

    ids = {p['id'] for p in persons}
    for sid in WARRANTS:
        assert sid in ids, 'warrant for an unknown person: %s' % sid
    for measure in SANCTIONS:
        for sid in measure['persons']:
            assert sid in ids, 'sanction against an unknown person: %s' % sid

    for person in persons:
        names = [person['name']] + ALIASES.get(person['id'], [])
        person['mentions'] = mentions(sections, names)[:14]
        person['sections'] = sum(m['n'] for m in person['mentions'])
        person['warrant'] = WARRANTS.get(person['id'])
        person['sanctions'] = [
            {k: v for k, v in m.items() if k != 'persons'}
            for m in SANCTIONS if person['id'] in m['persons']
        ]

    # The ordering is the page's argument: a warrant outranks a sanction, a
    # sanction outranks a statement, and within each the loudest comes first.
    def weight(p):
        return (0 if p['warrant'] else 1, 0 if p['sanctions'] else 1,
                -len(p['statements']), -p['sections'], p['name'])
    persons.sort(key=weight)

    companies = []
    for entry in COMPANIES:
        company = dict(entry)
        company['mentions'] = mentions(sections, [company['name']])[:8]
        company['divestment'] = DIVEST_TARGETS.get(company['id'], [])
        companies.append(company)

    positions_alias = load('world-positions.json')['alias']
    geo = json.loads((DATA / 'geo' / 'world.json').read_text())
    polygons = {f['properties'].get('name') for f in geo['features']}
    parties_out = []
    for name in ICC_PARTIES:
        on_map = ICC_MAP.get(name, positions_alias.get(name, name)) if name in ICC_MAP \
            else positions_alias.get(name, name)
        assert on_map is None or on_map in polygons, 'no polygon for %s' % name
        parties_out.append({'name': name, 'map': on_map})

    leaving = {x['name'] for x in ICC_LEAVING}
    assert leaving <= set(ICC_PARTIES), 'a leaving state is not on the party list'
    assert len(ICC_PARTIES) == len(set(ICC_PARTIES)) == 125, 'the states-parties list is not 125 distinct states'

    parties = set(ICC_PARTIES)
    positions_out = []
    for pos in ICC_POSITIONS:
        entry = dict(pos)
        entry['map'] = positions_alias.get(pos['name'], pos['name'])
        assert entry['map'] in polygons, 'no polygon for %s' % pos['name']
        positions_out.append(entry)
    for pos in ICC_POSITIONS:
        if pos['stance'] == 'non-party' or pos['name'] == 'Türkiye':
            assert pos['name'] not in parties, '%s is a state party' % pos['name']
        else:
            assert pos['name'] in parties, '%s is not a state party' % pos['name']

    out = {
        'meta': {
            'title': 'The accountability ledger',
            'note': 'Persons and companies named in the record, with what a court, a government or a shareholder has actually done about them. Statements are joined from the statements file, the sections are found in the report itself, and the sanctions are the measures on the world-positions file. Nothing on this page is asserted that is not already somewhere else on this site.',
            'source': 'report-final.md; data/statements.json; data/world-positions.json; Rome Statute of the International Criminal Court, Articles 86, 89(1) and 127(1)',
            'persons': len(persons),
            'companies': len(companies),
            'warrants': len(WARRANTS),
            'sanctioned': len({sid for m in SANCTIONS for sid in m['persons']}),
            'parties': len(ICC_PARTIES),
        },
        'classes': [{'id': c, 'label': l, 'note': n} for c, l, n in CLASSES],
        'persons': persons,
        'companies': companies,
        'icc': {
            'parties': parties_out,
            'leaving': ICC_LEAVING,
            'positions': positions_out,
            'note': 'All 125 states parties are bound by Article 86 to cooperate fully with the Court and by Article 89(1) to comply with a request for arrest and surrender. A withdrawal notified under Article 127(1) takes effect one year later, so each of the five states that has given notice remains bound throughout that year.',
        },
    }
    return out


if __name__ == '__main__':
    data = build()
    path = DATA / 'entities.json'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
    m = data['meta']
    print('entities.json — %d persons, %d companies, %d warrants, %d sanctioned, %d states parties'
          % (m['persons'], m['companies'], m['warrants'], m['sanctioned'], m['parties']))
