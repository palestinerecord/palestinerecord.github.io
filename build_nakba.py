#!/usr/bin/env python3
"""Build the 1948 depopulation layer: one record per village.

Source: the Wikipedia article "List of towns and villages depopulated in the
1948 Palestine war", whose table is transcribed from Salman Abu Sitta's
*Atlas of Palestine 1917–1966* (Palestine Land Society, 2010), pp. 108–115.
Each row carries the village name, the Mandate sub-district it stood in, the
date it was depopulated, its Arab population and land area in 1948, the
Israeli military operation it fell to, whether a massacre is recorded there,
what stands on the site now, and its coordinates.

The article is parsed rather than transcribed for the same reason
`build_positions.py` parses its list: a hand-copied table of 457 rows drifts
from its source, and a parser that raises on a row it cannot read fails
loudly instead.

Run with --offline to rebuild from the previously downloaded raw file.
"""

import argparse
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data"
RAW = ROOT / "data" / "raw"

ARTICLE = "List of towns and villages depopulated in the 1948 Palestine war"
URL = "https://en.wikipedia.org/w/index.php?title=%s&action=raw" % ARTICLE.replace(" ", "_")
CACHE = RAW / "nakba.wiki"

# The fifteen sub-districts of Mandatory Palestine that lost villages. A row
# naming anything else means the article has been restructured.
SUBDISTRICTS = {
    "Acre", "Beersheba", "Beisan", "Gaza", "Haifa", "Hebron", "Jaffa", "Jenin",
    "Jerusalem", "Nazareth", "Ramle", "Safad", "Tiberias", "Tulkarm",
    "Ramallah",
}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"])}


def fetch(offline):
    if not offline:
        RAW.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(request, timeout=120) as response:
            CACHE.write_bytes(response.read())
    return CACHE.read_text(encoding="utf-8")


def plain(text):
    """Wiki markup down to the words a reader would see."""
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"\{\{sfn\|[^}]*\}\}", "", text)
    text = re.sub(r"\{\{Date table sorting\|([^|}]*)[^}]*\}\}", r"\1", text, flags=re.I)
    text = re.sub(r"\[\[File:[^\]]*\]\]", "", text)
    text = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", text).strip(" |*!")


def number(text):
    text = plain(text).replace(",", "")
    match = re.search(r"\d+(?:\.\d+)?", text)
    return int(float(match.group())) if match else None


def date_of(text):
    """The article dates rows day-month-year; a few give a month or a year only."""
    text = plain(text)
    day = re.search(r"\b(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})\b", text)
    if day and day.group(2) in MONTHS:
        return "%s-%02d-%02d" % (day.group(3), MONTHS[day.group(2)], int(day.group(1)))
    month = re.search(r"\b([A-Z][a-z]+)\s+(\d{4})\b", text)
    if month and month.group(1) in MONTHS:
        return "%s-%02d" % (month.group(2), MONTHS[month.group(1)])
    year = re.search(r"\b(19\d\d)\b", text)
    return year.group(1) if year else None


# What the atlas records against each village, strongest first: a row naming
# both a massacre and an expulsion is counted as a massacre. "Atrocity" is the
# atlas's own separate term for killings that it does not class as a massacre.
CAUSES = [
    ("massacre", "massacre"),
    ("atrocity", "atrocity"),
    ("assault", "military assault"),
    ("expulsion", "expulsion"),
    ("evacuation", "evacuation"),
]


def cause_of(text):
    """The strongest cause of depopulation the atlas records for a village."""
    lower = plain(text).lower()
    for key, needle in CAUSES:
        if needle in lower:
            return key
    return None


def coordinates(cell):
    """Both coordinate forms the article uses, as [longitude, latitude].

    Degrees-minutes-seconds (`coord|32|03|08|N|34|45|11|E`) and decimal
    (`coord|31.761|N|35.207|E`) both appear, and a handful of rows carry none.
    """
    match = re.search(r"coord\|([^}]*)", cell)
    if not match:
        return None
    parts = [p.strip() for p in match.group(1).split("|")]
    values, hemispheres = [], []
    for part in parts:
        if part in ("N", "S", "E", "W"):
            hemispheres.append(part)
        elif re.fullmatch(r"-?\d+(?:\.\d+)?", part) and len(hemispheres) < 2:
            values.append(float(part))
    if len(hemispheres) < 2 or not values:
        return None
    half = len(values) // 2
    if len(values) in (2, 4, 6) and half:
        def degrees(group):
            total = group[0]
            if len(group) > 1:
                total += group[1] / 60
            if len(group) > 2:
                total += group[2] / 3600
            return total
        latitude = degrees(values[:half]) * (-1 if hemispheres[0] == "S" else 1)
        longitude = degrees(values[half:]) * (-1 if hemispheres[1] == "W" else 1)
        # Mandatory Palestine sits inside this box; anything outside it is a
        # misparse rather than a village.
        if 29 < latitude < 34 and 33 < longitude < 36.5:
            return [round(longitude, 4), round(latitude, 4)]
    return None


def parse(source):
    body = source.split("==Table==", 1)[1].split("==Other villages", 1)[0]
    villages, skipped, totals = [], 0, {}
    for block in body.split("|-")[1:]:
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if not lines or not lines[0].startswith("!"):
            skipped += 1
            continue
        # The sub-district and the thumbnail each open a new line rather than a
        # new `||` cell, so the first field of the split carries both and every
        # later column sits one place earlier than the header suggests.
        cells = [c.strip() for c in "\n".join(lines[1:]).split("||")]
        if len(cells) < 8:
            skipped += 1
            continue
        # The table closes on its own total row, which is the checksum the
        # parsed rows are measured against rather than a village.
        if plain(lines[0]).lower() == "total":
            totals = {"people": number(cells[2]), "dunams": number(cells[3])}
            continue
        subdistrict = plain(cells[0])
        if subdistrict not in SUBDISTRICTS:
            raise SystemExit("unknown sub-district %r — the article's table has changed" % subdistrict)
        village = {
            "name": plain(lines[0]),
            "subdistrict": subdistrict,
            "date": date_of(cells[1]),
            "people": number(cells[2]),
            "dunams": number(cells[3]),
            "operation": plain(cells[4]) or None,
            "cause": cause_of(cells[5]),
            # The verbatim entry as well as the classification: several rows
            # name the massacre ("Deir Yassin massacre") or list more than one
            # cause, and the tooltip should say what the atlas says.
            "recorded": plain(cells[5]) or None,
            "massacre": "massacre" in plain(cells[5]).lower(),
            "remains": plain(cells[6]) or None,
            "at": coordinates(cells[7]),
        }
        villages.append(village)
    if skipped > 2:
        raise SystemExit("%d rows could not be read — the article's table has changed" % skipped)
    if not totals:
        raise SystemExit("the table's total row is missing — the article's table has changed")
    return villages, totals


def build(offline):
    villages, totals = parse(fetch(offline))
    if len(villages) < 400:
        raise SystemExit("only %d villages parsed; the article's table has changed" % len(villages))

    dated = [v for v in villages if v["date"]]
    placed = [v for v in villages if v["at"]]
    people = sum(v["people"] or 0 for v in villages)
    dunams = sum(v["dunams"] or 0 for v in villages)
    massacres = sum(1 for v in villages if v["massacre"])

    by_subdistrict = {}
    for v in villages:
        entry = by_subdistrict.setdefault(v["subdistrict"], {"villages": 0, "people": 0, "massacres": 0})
        entry["villages"] += 1
        entry["people"] += v["people"] or 0
        entry["massacres"] += 1 if v["massacre"] else 0

    # The rows are dated to the day, so the monthly curve is a count, not an
    # estimate: how many villages were emptied in each month of the war.
    by_month = {}
    for v in dated:
        entry = by_month.setdefault(v["date"][:7], {"villages": 0, "people": 0, "massacres": 0})
        entry["villages"] += 1
        entry["people"] += v["people"] or 0
        entry["massacres"] += 1 if v["massacre"] else 0

    def tally(key, order=None):
        counts = {}
        for v in villages:
            counts[v[key]] = counts.get(v[key], 0) + 1
        items = [{"label": k, "villages": n} for k, n in counts.items()]
        if order:
            items.sort(key=lambda x: order.index(x["label"]) if x["label"] in order else len(order))
        else:
            items.sort(key=lambda x: -x["villages"])
        return items

    return {
        "meta": {
            "title": "The villages depopulated in 1948",
            "source": ("Salman Abu Sitta, *Atlas of Palestine 1917–1966* (Palestine Land Society, 2010), "
                       "pp. 108–115, as transcribed in the Wikipedia article "
                       "\"List of towns and villages depopulated in the 1948 Palestine war\""),
            "url": "https://en.wikipedia.org/wiki/" + ARTICLE.replace(" ", "_"),
            "villages": len(villages),
            "dated": len(dated),
            "placed": len(placed),
            "people": people,
            "dunams": dunams,
            "massacres": massacres,
            # The table carries its own totals, which the rows should reproduce.
            "people_total": totals["people"],
            "dunams_total": totals["dunams"],
            "note": ("Every row is one town or village emptied of its Arab population between 1947 and 1950. "
                     "The population and land-area figures are those of 1948, before depopulation. "
                     "A village counts as a massacre site where the atlas uses the word massacre against it. "
                     "A further group of villages is recorded as the site of an atrocity, which is the atlas's "
                     "own separate term, and those are counted under causes rather than here. The absence of a "
                     "record is not evidence that nothing happened."),
        },
        "subdistricts": [dict(name=k, **v) for k, v in sorted(
            by_subdistrict.items(), key=lambda kv: -kv[1]["villages"])],
        "months": [dict(month=m, **by_month[m]) for m in sorted(by_month)],
        "causes": tally("cause", [key for key, _ in CAUSES]),
        "remains": tally("remains"),
        "villages": villages,
    }


def main(offline):
    data = build(offline)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "nakba.json"
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = data["meta"]
    print(f"{path.relative_to(ROOT)}: {meta['villages']} villages "
          f"({meta['placed']} with coordinates, {meta['dated']} dated), "
          f"{meta['people']:,} people, {meta['dunams']:,} dunams, "
          f"{meta['massacres']} massacre sites, {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="rebuild from the cached raw file")
    main(parser.parse_args().offline)
