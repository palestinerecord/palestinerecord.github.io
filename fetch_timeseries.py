#!/usr/bin/env python3
"""Download daily casualty data and aggregate it into chart-ready series.

Source: Tech For Palestine open datasets (data.techforpalestine.org), which
compile Gaza Ministry of Health, OCHA and UN figures. Run with --offline to
rebuild from the previously downloaded raw files without hitting the network.
"""

import argparse
import json
import urllib.request
from collections import OrderedDict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data"
RAW = ROOT / "data" / "raw"

# Public domain datasets (see repo LICENSE); infrastructure is only published on v3.
FEEDS = {
    "gaza_daily": "v2/casualties_daily.min.json",
    "west_bank_daily": "v2/west_bank_daily.min.json",
    "summary": "v2/summary.json",
    "press_killed": "v2/press_killed_in_gaza.min.json",
    "infrastructure": "v3/infrastructure-damaged.json",
    # The named list of the identified dead, one record per person with age and
    # sex. Roughly 12 MB, so it is aggregated here and never stored whole.
    "killed_in_gaza": "v2/killed-in-gaza.min.json",
}

# Feeds too large to keep on disk: fetched, reduced, and discarded.
NO_CACHE = {"killed_in_gaza"}


def fetch(name):
    url = "https://data.techforpalestine.org/api/" + FEEDS[name]
    request = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def load(name, offline):
    if name in NO_CACHE:
        return json.loads(fetch(name)) if not offline else None
    path = RAW / FEEDS[name].replace("/", "_")
    if not offline:
        RAW.mkdir(parents=True, exist_ok=True)
        path.write_bytes(fetch(name))
    return json.loads(path.read_text(encoding="utf-8"))


def month_key(day):
    return day[:7]


def last_of_each_month(rows, field):
    """Latest cumulative value seen in each month, forward-filled."""
    months = OrderedDict()
    running = 0
    for row in rows:
        value = row.get(field)
        if isinstance(value, (int, float)) and value >= running:
            running = value
        months[month_key(row["report_date"])] = running
    return months


def monthly_new(rows, field):
    """Per-month increase in a cumulative field (never negative)."""
    cumulative = last_of_each_month(rows, field)
    out = OrderedDict()
    previous = 0
    for month, value in cumulative.items():
        out[month] = max(0, value - previous)
        previous = value
    return out


def monthly_sum(rows, field):
    """Month totals for a field reported per day rather than cumulatively."""
    out = OrderedDict()
    for row in rows:
        month = month_key(row["report_date"])
        value = row.get(field)
        out[month] = out.get(month, 0) + (value if isinstance(value, (int, float)) else 0)
    return out


def series(months, label):
    return {"label": label, "months": list(months.keys()), "values": list(months.values())}


def daily(rows, fields):
    """Full daily resolution: one shared date axis, forward-filled cumulatives.

    The monthly series above collapse 1,000-plus daily reports into 36 points.
    This keeps every reporting day, which is what the shape of the killing
    actually looks like.
    """
    out = {"dates": [r["report_date"] for r in rows]}
    for field, key in fields:
        values, running = [], 0
        for row in rows:
            value = row.get(field)
            if isinstance(value, (int, float)) and value >= running:
                running = value
            values.append(running)
        out[key] = values
    return out


AGE_BANDS = [(0, 4), (5, 9), (10, 14), (15, 17), (18, 24), (25, 34),
             (35, 44), (45, 54), (55, 64), (65, 74), (75, 200)]


def band_label(low, high):
    return f"{low}+" if high > 120 else (f"{low}–{high}" if low != high else str(low))


def demographics(people):
    """Age and sex distribution of the named dead.

    Reduces the ~73,000-record identified-victim list to a histogram. Records
    with a missing or implausible age are counted separately rather than
    dropped, so the totals still reconcile with the list length.
    """
    bands = OrderedDict((band_label(lo, hi), {"m": 0, "f": 0}) for lo, hi in AGE_BANDS)
    single = OrderedDict()
    sex_total = {"m": 0, "f": 0, "unknown": 0}
    unknown_age = 0
    children = 0

    for person in people:
        age = person.get("age")
        sex = person.get("sex") if person.get("sex") in ("m", "f") else "unknown"
        sex_total[sex] += 1
        if not isinstance(age, (int, float)) or age < 0 or age > 120:
            unknown_age += 1
            continue
        age = int(age)
        if age < 18:
            children += 1
            single[age] = single.get(age, 0) + 1
        if sex == "unknown":
            continue
        for low, high in AGE_BANDS:
            if low <= age <= high:
                bands[band_label(low, high)][sex] += 1
                break

    return {
        "label": "Identified dead by age and sex",
        "source": "Tech For Palestine, killed-in-gaza named list (Gaza Ministry of Health identification records)",
        "total_records": len(people),
        "unknown_age": unknown_age,
        "under_18": children,
        "sex": sex_total,
        "bands": list(bands.keys()),
        "male": [bands[b]["m"] for b in bands],
        "female": [bands[b]["f"] for b in bands],
        "child_ages": [single.get(a, 0) for a in range(18)],
    }


# One particle is drawn per death in the hero field, sampled down by 3 on a
# standard display. Naming every drawn particle therefore needs every third
# record of the identified list, in the list's own order.
NAME_INTERVAL = 3
BOOT_NAMES = 260


def names(people, total_dead):
    """The named dead, reduced to what the hero field and the boot screen show.

    Two files rather than one: the boot screen needs a handful of names while
    the record loads, and must not wait on the megabyte the addressable field
    needs. Each record keeps the Arabic name as registered, the transliteration,
    the age and the sex, and nothing else — no identifier, no date of birth.

    The sample is every third record in the order the Ministry of Health
    published them, not a filtered or hand-picked selection: the file states the
    interval so the reader can check that for themselves.
    """
    def record(person):
        age = person.get("age")
        return [
            person.get("name") or "",
            person.get("en_name") or "",
            int(age) if isinstance(age, (int, float)) and 0 <= age <= 120 else None,
            person.get("sex") if person.get("sex") in ("m", "f") else None,
        ]

    sample = [record(p) for p in people[::NAME_INTERVAL]]
    step = max(1, len(sample) // BOOT_NAMES)
    meta = {
        "source": "Tech For Palestine, killed-in-gaza named list "
                  "(Gaza Ministry of Health identification records)",
        "url": "https://data.techforpalestine.org/docs/killed-in-gaza/",
        "fetched": date.today().isoformat(),
        "identified": len(people),
        "counted_dead": total_dead,
        "interval": NAME_INTERVAL,
        "fields": ["name", "en_name", "age", "sex"],
        "note": (
            f"Every {NAME_INTERVAL}rd record of the identified list, in published order. "
            f"{len(people):,} of the {total_dead:,} counted dead have been identified by name; "
            "the rest are counted but not named, and are shown unnamed."
        ),
    }
    return (
        {"meta": meta, "people": sample},
        {"meta": dict(meta, note=meta["note"] + f" This file carries every {step * NAME_INTERVAL}th "
                                                "record of the list, for the loading screen."),
         "people": sample[::step][:BOOT_NAMES]},
    )


INFRASTRUCTURE_FIELDS = [
    ("residential", "ext_destroyed", "Residential units destroyed"),
    ("educational_buildings", "ext_destroyed", "Schools destroyed"),
    ("educational_buildings", "ext_damaged", "Schools damaged"),
    ("places_of_worship", "ext_mosques_destroyed", "Mosques destroyed"),
    ("places_of_worship", "ext_mosques_damaged", "Mosques damaged"),
    ("places_of_worship", "ext_churches_destroyed", "Churches destroyed"),
    ("civic_buildings", "ext_destroyed", "Civic buildings destroyed"),
]


def flatten_infrastructure(rows):
    """Monthly latest cumulative value for each infrastructure category."""
    out = {}
    for group, field, label in INFRASTRUCTURE_FIELDS:
        flat = [{"report_date": r["report_date"], "value": (r.get(group) or {}).get(field)} for r in rows]
        out[f"{group}.{field}"] = series(last_of_each_month(flat, "value"), label)
    return out


def build(offline):
    gaza = load("gaza_daily", offline)
    west_bank = load("west_bank_daily", offline)
    summary = load("summary", offline)
    press = load("press_killed", offline)
    infrastructure = load("infrastructure", offline)
    people = load("killed_in_gaza", offline)
    infrastructure.sort(key=lambda r: r["report_date"])

    gaza.sort(key=lambda r: r["report_date"])
    west_bank.sort(key=lambda r: r["report_date"])

    gaza_killed_cum = last_of_each_month(gaza, "ext_killed_cum")
    gaza_injured_cum = last_of_each_month(gaza, "ext_injured_cum")
    children_cum = last_of_each_month(gaza, "ext_killed_children_cum")
    women_cum = last_of_each_month(gaza, "ext_killed_women_cum")
    medical_cum = last_of_each_month(gaza, "ext_med_killed_cum")
    press_cum = last_of_each_month(gaza, "ext_press_killed_cum")
    civdef_cum = last_of_each_month(gaza, "ext_civdef_killed_cum")

    aid_killed_cum = last_of_each_month(gaza, "aid_seeker_killed_cum")
    aid_injured_cum = last_of_each_month(gaza, "aid_seeker_injured_cum")
    famine_cum = last_of_each_month(gaza, "famine_cum")
    child_famine_cum = last_of_each_month(gaza, "child_famine_cum")
    massacres_cum = last_of_each_month(gaza, "ext_massacres_cum")

    wb_killed_cum = last_of_each_month(west_bank, "killed_cum")
    wb_children_cum = last_of_each_month(west_bank, "killed_children_cum")
    wb_injured_cum = last_of_each_month(west_bank, "injured_cum")
    wb_injured_children_cum = last_of_each_month(west_bank, "injured_children_cum")
    wb_attacks_cum = last_of_each_month(west_bank, "settler_attacks_cum")
    wb_displaced_cum = last_of_each_month(west_bank, "displaced_persons_cum")
    wb_displaced_children_cum = last_of_each_month(west_bank, "displaced_children_cum")
    wb_displaced_households_cum = last_of_each_month(west_bank, "displaced_households_cum")

    months = list(gaza_killed_cum.keys())

    # Ceasefire came into force 11 October 2025; used to split the series.
    ceasefire_month = "2025-10"

    data = {
        "meta": {
            "source": "Tech For Palestine open datasets (Gaza Ministry of Health, OCHA, UN)",
            "url": "https://data.techforpalestine.org/",
            "generated": date.today().isoformat(),
            "first_month": months[0],
            "last_month": months[-1],
            "last_daily_update": summary.get("lastDailyUpdate"),
            "ceasefire_month": ceasefire_month,
        },
        "summary": summary,
        "gaza": {
            "monthly_killed": series(monthly_new(gaza, "ext_killed_cum"), "Killed per month"),
            "monthly_injured": series(monthly_new(gaza, "ext_injured_cum"), "Injured per month"),
            "cumulative_killed": series(gaza_killed_cum, "Cumulative killed"),
            "cumulative_injured": series(gaza_injured_cum, "Cumulative injured"),
            "cumulative_children": series(children_cum, "Children killed"),
            "cumulative_women": series(women_cum, "Women killed"),
            "cumulative_medical": series(medical_cum, "Medical personnel killed"),
            "cumulative_press": series(press_cum, "Journalists killed"),
            "cumulative_civdef": series(civdef_cum, "Civil defence killed"),
            "monthly_children": series(monthly_new(gaza, "ext_killed_children_cum"), "Children killed per month"),
            "monthly_women": series(monthly_new(gaza, "ext_killed_women_cum"), "Women killed per month"),
            "monthly_press": series(monthly_new(gaza, "ext_press_killed_cum"), "Journalists killed per month"),
            "monthly_medical": series(monthly_new(gaza, "ext_med_killed_cum"), "Medical personnel killed per month"),
            "monthly_aid_seekers": series(monthly_new(gaza, "aid_seeker_killed_cum"), "Aid seekers killed per month"),
            "monthly_massacres": series(monthly_new(gaza, "ext_massacres_cum"), "Recorded massacres per month"),
            "monthly_recovered": series(monthly_sum(gaza, "killed_recovered"), "Bodies recovered from rubble"),
            "monthly_succumbed": series(monthly_sum(gaza, "killed_succumbed"), "Died later of wounds"),
            "cumulative_aid_seekers_killed": series(aid_killed_cum, "Aid seekers killed"),
            "cumulative_aid_seekers_injured": series(aid_injured_cum, "Aid seekers injured"),
            "cumulative_famine": series(famine_cum, "Deaths from starvation and malnutrition"),
            "cumulative_child_famine": series(child_famine_cum, "Children dead of starvation and malnutrition"),
            "cumulative_massacres": series(massacres_cum, "Recorded massacres"),
        },
        "west_bank": {
            "monthly_killed": series(monthly_new(west_bank, "killed_cum"), "Killed per month"),
            "monthly_children": series(monthly_new(west_bank, "killed_children_cum"), "Children killed per month"),
            "monthly_settler_attacks": series(monthly_new(west_bank, "settler_attacks_cum"), "Settler attacks per month"),
            "monthly_displaced": series(monthly_new(west_bank, "displaced_persons_cum"), "Displaced per month"),
            "monthly_injured": series(monthly_new(west_bank, "injured_cum"), "Injured per month"),
            "cumulative_killed": series(wb_killed_cum, "Cumulative killed"),
            "cumulative_children": series(wb_children_cum, "Children killed"),
            "cumulative_injured": series(wb_injured_cum, "Cumulative injured"),
            "cumulative_injured_children": series(wb_injured_children_cum, "Children injured"),
            "cumulative_settler_attacks": series(wb_attacks_cum, "Settler attacks"),
            "cumulative_displaced": series(wb_displaced_cum, "Displaced persons"),
            "cumulative_displaced_children": series(wb_displaced_children_cum, "Children displaced"),
            "cumulative_displaced_households": series(wb_displaced_households_cum, "Households displaced"),
        },
        "daily": {
            "gaza": daily(gaza, [
                ("ext_killed_cum", "killed"),
                ("ext_injured_cum", "injured"),
                ("ext_killed_children_cum", "children"),
                ("ext_killed_women_cum", "women"),
                ("aid_seeker_killed_cum", "aid_seekers"),
            ]),
            "west_bank": daily(west_bank, [
                ("killed_cum", "killed"),
                ("killed_children_cum", "children"),
                ("settler_attacks_cum", "settler_attacks"),
            ]),
        },
        "infrastructure": flatten_infrastructure(infrastructure),
        "press_killed_count": len(press),
    }

    if people is not None:
        data["demographics"] = demographics(people)
    else:  # --offline: keep the aggregate from the previous run rather than lose it
        previous = OUT / "timeseries.json"
        if previous.exists():
            prior = json.loads(previous.read_text(encoding="utf-8")).get("demographics")
            if prior:
                data["demographics"] = prior

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "timeseries.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    gaza_total = list(gaza_killed_cum.values())[-1]
    wb_total = list(wb_killed_cum.values())[-1]

    # Written only when the named list was actually downloaded; --offline leaves
    # the previous pair in place rather than emitting an empty one.
    if people is not None:
        full, boot = names(people, gaza_total)
        for name, payload in (("names.json", full), ("names-boot.json", boot)):
            (OUT / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                                    encoding="utf-8")
        print(f"names {len(full['people']):,} (every {NAME_INTERVAL}rd of {len(people):,}) | "
              f"boot slice {len(boot['people'])} | "
              f"wrote {(OUT / 'names.json').stat().st_size / 1024:.0f} KB")

    points = sum(len(s["values"]) for group in ("gaza", "west_bank") for s in data[group].values())
    points += sum(len(v) for block in data["daily"].values() for v in block.values())
    print(f"months {months[0]} to {months[-1]} ({len(months)}) | daily reports {len(gaza)}")
    print(f"gaza killed {gaza_total:,} | west bank killed {wb_total:,} | "
          f"settler attacks {list(wb_attacks_cum.values())[-1]:,}")
    print(f"aid seekers killed {list(aid_killed_cum.values())[-1]:,} | "
          f"starvation deaths {list(famine_cum.values())[-1]:,} "
          f"(children {list(child_famine_cum.values())[-1]:,}) | "
          f"massacres {list(massacres_cum.values())[-1]:,}")
    if "demographics" in data:
        demo = data["demographics"]
        print(f"named dead {demo['total_records']:,} | under 18 {demo['under_18']:,} | "
              f"male {demo['sex']['m']:,} female {demo['sex']['f']:,}")
    print(f"{points:,} data points | wrote {(OUT / 'timeseries.json').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="rebuild from cached raw files")
    build(parser.parse_args().offline)
