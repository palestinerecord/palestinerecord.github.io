#!/usr/bin/env python3
"""Build data/world-positions.json — where every state stands, country by country.

Three layers the rest of the curated data does not carry:

  recognition  which states recognise the State of Palestine, and when
  sanctions    which states have sanctioned Israeli officials, settlers or
               settlement goods
  icj          which states are party to, or have intervened in, South Africa
               v. Israel at the International Court of Justice

The recognition list is parsed from the Wikipedia article "International
recognition of Palestine", which cites the Palestinian Ministry of Foreign
Affairs list and the underlying UN documents entry by entry; the dates are as
given there. The sanctions and ICJ lists are transcribed from the report, with
the section that carries each one named in the output.

Every country name is resolved to the name Natural Earth uses in
data/geo/world.json, so the choropleth can join on it without guessing. The
script fails rather than emitting an entry that would not draw.

Run with --offline to rebuild from the previously downloaded raw copy.
"""

import argparse
import difflib
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "world-positions.json"
GEO = ROOT / "data" / "geo" / "world.json"

PAGE = "International recognition of the State of Palestine"
API = ("https://en.wikipedia.org/w/api.php?action=parse&page=%s&prop=wikitext"
       "&format=json&formatversion=2&redirects=1")
CACHE = RAW / "recognition.wiki"

# Natural Earth uses a different name for these; everything else matches. The
# build fails on any name that is not here and does not draw, so the list
# cannot silently fall behind the geometry.
ALIAS = {
    "United States": "United States of America",
    "Czech Republic": "Czechia",
    "Cape Verde": "Cabo Verde",
    "São Tomé and Príncipe": "São Tomé and Principe",
    "Eswatini": "eSwatini",
    "Ivory Coast": "Côte d'Ivoire",
    "Holy See": "Vatican",
    "Sahrawi Republic": "W. Sahara",
    "Türkiye": "Turkey",
    "Bosnia and Herzegovina": "Bosnia and Herz.",
    "Antigua and Barbuda": "Antigua and Barb.",
    "Central African Republic": "Central African Rep.",
    "Democratic Republic of the Congo": "Dem. Rep. Congo",
    "Republic of the Congo": "Congo",
    "Dominican Republic": "Dominican Rep.",
    "Equatorial Guinea": "Eq. Guinea",
    "Federated States of Micronesia": "Micronesia",
    "Marshall Islands": "Marshall Is.",
    "Saint Kitts and Nevis": "St. Kitts and Nevis",
    "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
    "Solomon Islands": "Solomon Is.",
    "South Sudan": "S. Sudan",
}

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]

# ---------------------------------------------------------------- measures

EU_27 = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
    "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
    "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta",
    "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
    "Spain", "Sweden",
]

SANCTIONS = [
    {
        "id": "officials-2025",
        "date": "June 2025",
        "ref": "§15.3",
        "label": "Sanctioned Israeli ministers Ben-Gvir and Smotrich",
        "detail": "Travel bans and asset freezes on the National Security and Finance Ministers "
                  "for incitement of settler violence and statements promoting forcible displacement.",
        "countries": ["United Kingdom", "Australia", "Canada", "New Zealand", "Norway"],
    },
    {
        "id": "eu-settlers-2026",
        "date": "11 May 2026",
        "ref": "§15.3",
        "label": "European Union settler sanctions, binding on every member state",
        "detail": "Travel bans and asset freezes on seven settlers and settler organisations — the "
                  "bloc's first such package, adopted after Hungary lifted the veto it had held for years.",
        "countries": EU_27,
    },
    {
        "id": "settlement-goods-2026",
        "date": "8 September 2026",
        "ref": "§15.3",
        "label": "Joined the twelve-country settlement sanctions",
        "detail": "Coordinated sanctions on Israeli settlements in the West Bank. The United Kingdom, "
                  "Canada and France moved immediately to ban imports of settlement goods; Denmark, "
                  "Finland, Iceland, Poland, Portugal and Sweden pledged further action.",
        "countries": ["France", "United Kingdom", "Canada", "Denmark", "Spain", "Finland",
                      "Ireland", "Iceland", "Norway", "Poland", "Portugal", "Sweden"],
    },
]

ICJ = {
    "ref": "§15.1",
    "case": "South Africa v. Israel, Application of the Genocide Convention, ICJ",
    "applicant": ["South Africa"],
    "interveners": ["Nicaragua", "Colombia", "Libya", "Mexico", "Spain", "Türkiye", "Chile",
                    "Maldives", "Bolivia", "Ireland", "Cuba", "Brazil", "Belgium", "Namibia",
                    "Iceland", "Paraguay", "Fiji", "Hungary", "Netherlands", "United States"],
    "note": "A declaration of intervention under Article 63 of the Statute concerns the construction "
            "of the Genocide Convention. It is not, in itself, support for either party: the United "
            "States and Hungary filed alongside Namibia, Fiji, the Netherlands and Iceland in March 2026. "
            "Palestine has also intervened and is not shown on the map as a third state.",
}

# --------------------------------------------------------------- wikitext

def wikitext(offline):
    if not offline:
        RAW.mkdir(parents=True, exist_ok=True)
        url = API % urllib.parse.quote(PAGE)
        request = urllib.request.Request(url, headers={
            "User-Agent": "palestinerecord/1.0 (dashboard build; contact via repository)"})
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
        CACHE.write_text(payload["parse"]["wikitext"], encoding="utf-8")
    return CACHE.read_text(encoding="utf-8")


def table_at(text, start):
    """One table, from its opening brace to the matching close."""
    depth, i = 0, start
    while i < len(text):
        if text.startswith("{|", i):
            depth += 1
            i += 2
        elif text.startswith("|}", i):
            depth -= 1
            i += 2
            if depth == 0:
                return text[start:i]
        else:
            i += 1
    raise SystemExit("unterminated table at %d" % start)


def table_after(text, heading):
    """The first sortable wikitable after a heading.

    The recognition section opens with a two-cell legend table explaining the
    shading, so the first table found is not the one wanted.
    """
    at = text.index(heading)
    while True:
        at = text.index("{|", at)
        table = table_at(text, at)
        if "wikitable" in table.split("\n", 1)[0]:
            return table
        at += 2


FLAG = re.compile(r"\{\{(?:flag|flagcountry|flagdeco|flagicon)\|([^|}]+)", re.I)


def table_rows(table):
    return [r for r in re.split(r"\n\|-", table.split("\n", 1)[1]) if r.strip()]


def countries(table, dated):
    out = []
    for row in table_rows(table):
        flag = FLAG.search(row)
        if not flag:
            continue
        entry = {"name": flag.group(1).strip()}
        if dated:
            stamp = re.search(r"\{\{dts\|([^}|]+)", row)
            if not stamp:
                raise SystemExit("no date for %s" % entry["name"])
            entry["date"] = stamp.group(1).strip()
            # The shading marks the handful of recognitions that are contested.
            entry["disputed"] = "background:#eaecf0" in row
        out.append(entry)
    return out


def iso_date(text):
    """'15 November 1988' and 'May 1989' both sort; the second has no day."""
    parts = text.split()
    if len(parts) == 3:
        day, month, year = parts
        return "%s-%02d-%02d" % (year, MONTHS.index(month) + 1, int(day))
    if len(parts) == 2:
        month, year = parts
        return "%s-%02d" % (year, MONTHS.index(month) + 1)
    return text


# ------------------------------------------------------------------ build

def build(offline):
    text = wikitext(offline)
    geo = json.loads(GEO.read_text(encoding="utf-8"))
    drawn = {f["properties"]["name"] for f in geo["features"]}

    unresolved = {}

    def resolve(name):
        mapped = ALIAS.get(name, name)
        if mapped not in drawn:
            near = difflib.get_close_matches(mapped, drawn, n=1, cutoff=0.4)
            unresolved[name] = near[0] if near else "?"
        return mapped

    recognise = countries(table_after(text, "===UN member states==="), True)
    non_un = countries(table_after(text, "===Non-UN member states==="), True)
    refuse = countries(table_after(text, "==States that do not recognize Palestine=="), False)

    if len(recognise) + len(refuse) != 193:
        raise SystemExit("UN member states parsed: %d recognising + %d not"
                         % (len(recognise), len(refuse)))

    states = []
    for entry, un in [(e, True) for e in recognise] + [(e, False) for e in non_un]:
        states.append({
            "name": entry["name"],
            "map": resolve(entry["name"]),
            "un": un,
            "recognises": True,
            "date": iso_date(entry["date"]),
            "on": entry["date"],
            "year": int(entry["date"].split()[-1]),
            "disputed": entry["disputed"],
        })
    for entry in refuse:
        states.append({
            "name": entry["name"],
            "map": resolve(entry["name"]),
            "un": True,
            "recognises": False,
        })

    sanctions = []
    for measure in SANCTIONS:
        item = dict(measure)
        item["countries"] = [{"name": c, "map": resolve(c)} for c in measure["countries"]]
        sanctions.append(item)

    icj = dict(ICJ)
    icj["applicant"] = [{"name": c, "map": resolve(c)} for c in ICJ["applicant"]]
    icj["interveners"] = [{"name": c, "map": resolve(c)} for c in ICJ["interveners"]]

    if unresolved:
        raise SystemExit("no shape in %s for these names (nearest match shown):\n%s"
                         % (GEO.name, "\n".join("  %-34s %s" % (k, v)
                                                for k, v in sorted(unresolved.items()))))

    return {
        "meta": {
            "title": "Where every state stands",
            "built": date.today().isoformat(),
            "geometry": "data/geo/world.json (Natural Earth, public domain)",
            "note": "Country names carry a 'map' field holding the name used by the map geometry, "
                    "so the choropleth joins on a value that is known to draw.",
        },
        "recognition": {
            "title": "Recognition of the State of Palestine",
            "source": "Wikipedia, \"International recognition of Palestine\", retrieved %s, which "
                      "cites the Palestinian Ministry of Foreign Affairs list and the underlying UN "
                      "documents for each entry. Dates are as given there."
                      % date.today().strftime("%d %B %Y"),
            "ref": "§15.4",
            "un_recognising": len(recognise),
            "un_total": 193,
            "note": "Two of the recognitions are contested and are marked as such: the Czech Republic, "
                    "whose government disputes that Czechoslovakia's 1988 recognition carried over, and "
                    "Papua New Guinea. States that are not UN members are shown where the map draws them; "
                    "territories that appear in neither list are left blank rather than counted as refusals.",
            "states": states,
        },
        "sanctions": {
            "title": "Sanctions on Israeli officials, settlers and settlement goods",
            "ref": "§15.3",
            "note": "Measures aimed at individuals, settler organisations or settlement commerce. "
                    "Restrictions on arms transfers are held separately, in the embargo tracker.",
            "measures": sanctions,
        },
        "icj": icj,
        "alias": ALIAS,
    }


def main(offline):
    data = build(offline)
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    reco = data["recognition"]
    print("%s: %d states, %d of %d UN members recognising, %d sanctions measures, %d ICJ filings, %.0f KB"
          % (OUT.relative_to(ROOT), len(reco["states"]), reco["un_recognising"], reco["un_total"],
             len(data["sanctions"]["measures"]),
             len(data["icj"]["applicant"]) + len(data["icj"]["interveners"]),
             OUT.stat().st_size / 1024))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="rebuild from the cached wikitext")
    main(parser.parse_args().offline)
