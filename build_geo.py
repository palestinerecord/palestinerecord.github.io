#!/usr/bin/env python3
"""Build the map geometry the dashboard draws on.

Three files are produced:

  data/geo/world.json         every country at 1:50m, for the recognition and
                              pressure choropleths
  data/geo/palestine.json     Israel, the West Bank and Gaza at 1:10m, plus the
                              outline of Mandatory Palestine derived from them,
                              for the regional map and the 1948 village map
  data/geo/governorates.json  the sixteen governorates of the State of
                              Palestine, for the Gaza and West Bank choropleths

The first two come from Natural Earth (naturalearthdata.com), public domain,
via the natural-earth-vector repository. Natural Earth draws the 1949
armistice line as the Israel/Palestine boundary and labels the whole of the
West Bank and Gaza as one unit; it is a base map, not an adjudication of any
boundary, and the dashboard says so on the chart.

The third is the official OCHA Common Operational Dataset for the State of
Palestine, published on the Humanitarian Data Exchange under CC BY-IGO. It is
the boundary set the UN agencies themselves report against, which is what
makes an OCHA or IPC figure and a polygon on this map the same unit.

Run with --offline to rebuild from the previously downloaded raw files.
"""

import argparse
import io
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "geo"
RAW = ROOT / "data" / "raw"

BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
FEEDS = {
    "world": "ne_50m_admin_0_countries.geojson",
    "region": "ne_10m_admin_0_countries.geojson",
}

# OCHA Common Operational Dataset, State of Palestine — Subnational
# Administrative Boundaries, CC BY-IGO. The archive carries admin levels 0 to
# 2; only the governorates are used, and the extracted files are kept so
# --offline can rebuild without the download.
COD_URL = ("https://data.humdata.org/dataset/2caf8373-816f-458c-9913-71bddb9cab7c/resource/"
           "ca372385-4c79-4378-abf1-cb506fb98023/download/pse_admin_boundaries.geojson.zip")
COD_ZIP = RAW / "pse_admin_boundaries.geojson.zip"
COD_DIR = RAW / "pse_cod"
COD_MEMBER = "pse_admin2.geojson"

# Coordinates are rounded to this many decimal places, then thinned. The world
# map is drawn a few hundred pixels wide, where a degree is roughly two pixels,
# so detail below the tolerance below cannot be seen; the regional map is drawn
# at about a thousand times that scale and keeps everything.
WORLD_DP = 2
WORLD_TOLERANCE = 0.09   # degrees, Douglas–Peucker
WORLD_MIN_SPAN = 0.22    # degrees; rings smaller than this in both axes are dropped
REGION_DP = 3

# The governorate map is drawn about seven hundred pixels wide across the two
# and a half degrees of longitude the territory spans, so a pixel is roughly
# 0.0035°. The tolerance below is under half of that: everything the reader
# could see survives, and the survey's sub-metre vertices do not.
GOV_DP = 4
GOV_TOLERANCE = 0.0015
GOV_MIN_SPAN = 0.004

REGION_NAMES = {"Israel", "Palestine"}


def fetch(name, offline):
    path = RAW / FEEDS[name]
    if not offline:
        RAW.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(BASE + FEEDS[name], headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(request, timeout=300) as response:
            path.write_bytes(response.read())
    return json.loads(path.read_text(encoding="utf-8"))


def thin(points, tolerance):
    """Douglas–Peucker, iterative so a long coastline cannot blow the stack."""
    if tolerance <= 0 or len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        worst, at = -1.0, first
        for i in range(first + 1, last):
            px, py = points[i]
            if span == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                # Perpendicular distance, squared and scaled by the span, which
                # keeps the comparison exact without a square root per point.
                cross = dx * (py - ay) - dy * (px - ax)
                d = cross * cross / span
            if d > worst:
                worst, at = d, i
        if worst > tolerance * tolerance:
            keep[at] = True
            stack.append((first, at))
            stack.append((at, last))
    return [p for p, k in zip(points, keep) if k]


def round_ring(ring, dp, tolerance=0.0, min_span=0.0):
    """Round, thin, and drop rings too small or too degenerate to draw."""
    out = []
    for x, y in ring:
        point = [round(x, dp), round(y, dp)]
        if not out or point != out[-1]:
            out.append(point)
    if len(out) < 4:
        return None
    if min_span:
        xs = [p[0] for p in out]
        ys = [p[1] for p in out]
        if max(xs) - min(xs) < min_span and max(ys) - min(ys) < min_span:
            return None
    if tolerance:
        out = thin(out, tolerance)
    # A ring needs four points to close; anything less is a rounding artefact.
    if len(out) < 4:
        return None
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def simplify(geometry, dp, tolerance=0.0, min_span=0.0):
    def rings_of(polygon):
        rings = []
        for index, ring in enumerate(polygon):
            # Only the outer ring of a part decides whether the part survives;
            # a hole is dropped on its own merits without taking the part away.
            r = round_ring(ring, dp, tolerance, min_span if index == 0 else 0.0)
            if r:
                rings.append(r)
            elif index == 0:
                return []
        return rings

    kind = geometry["type"]
    if kind == "Polygon":
        rings = rings_of(geometry["coordinates"])
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if kind == "MultiPolygon":
        polygons = [r for r in (rings_of(p) for p in geometry["coordinates"]) if r]
        return {"type": "MultiPolygon", "coordinates": polygons} if polygons else None
    return None


def feature(name, geometry, extra=None):
    properties = {"name": name}
    if extra:
        properties.update(extra)
    return {"type": "Feature", "properties": properties, "geometry": geometry}


def build_world(offline):
    source = fetch("world", offline)
    features = []
    for f in source["features"]:
        p = f["properties"]
        name = p.get("NAME_LONG") or p.get("NAME")
        if name == "Antarctica":
            continue  # no state, and it distorts every projection
        geometry = simplify(f["geometry"], WORLD_DP, WORLD_TOLERANCE, WORLD_MIN_SPAN)
        if not geometry:
            # A state too small to draw at this scale still has to appear, so
            # it keeps its shape unthinned rather than dropping off the map.
            geometry = simplify(f["geometry"], WORLD_DP)
        if not geometry:
            continue
        iso = p.get("ISO_A3_EH") or p.get("ISO_A3") or ""
        features.append(feature(p.get("NAME") or name, geometry, {
            "iso": iso if iso != "-99" else "",
            "long": name,
        }))
    return {"type": "FeatureCollection", "features": features}


def union_outline(geometries):
    """Every ring of every part, as one multipolygon.

    This is a visual outline, not a topological union: the parts are adjacent,
    so drawing them together as one filled shape gives the Mandate territory.
    """
    polygons = []
    for geometry in geometries:
        if geometry["type"] == "Polygon":
            polygons.append(geometry["coordinates"])
        else:
            polygons.extend(geometry["coordinates"])
    return {"type": "MultiPolygon", "coordinates": polygons}


def build_region(offline):
    source = fetch("region", offline)
    parts = {}
    for f in source["features"]:
        name = f["properties"].get("NAME")
        if name in REGION_NAMES:
            geometry = simplify(f["geometry"], REGION_DP)
            if geometry:
                parts[name] = geometry
    missing = REGION_NAMES - set(parts)
    if missing:
        raise SystemExit("region geometry missing: %s" % ", ".join(sorted(missing)))

    # Natural Earth carries Gaza and the West Bank as one "Palestine" feature.
    # They are split here on longitude: Gaza lies west of 34.6°E, the West Bank
    # east of 34.9°E, and nothing of either lies between.
    gaza, west_bank = [], []
    for polygon in parts["Palestine"]["coordinates"]:
        west = min(x for x, _ in polygon[0])
        (gaza if west < 34.6 else west_bank).append(polygon)

    features = [
        feature("Israel", parts["Israel"], {"id": "israel"}),
        feature("West Bank", {"type": "MultiPolygon", "coordinates": west_bank}, {"id": "west-bank"}),
        feature("Gaza Strip", {"type": "MultiPolygon", "coordinates": gaza}, {"id": "gaza"}),
        feature("Mandatory Palestine", union_outline([parts["Israel"], parts["Palestine"]]),
                {"id": "mandate"}),
    ]
    return {"type": "FeatureCollection", "features": features}


def fetch_cod(offline):
    """The governorate layer of the OCHA boundary archive.

    The download is a zip of five GeoJSON files. All five are kept, because the
    archive is republished as a whole and re-downloading it to reach a second
    layer later would be wasteful; only the governorates are read here.
    """
    if not offline:
        RAW.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(COD_URL, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(request, timeout=300) as response:
            COD_ZIP.write_bytes(response.read())
        COD_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(COD_ZIP.read_bytes())) as archive:
            for member in archive.namelist():
                if member.endswith(".geojson"):
                    (COD_DIR / Path(member).name).write_bytes(archive.read(member))
    path = COD_DIR / COD_MEMBER
    if not path.exists():
        raise SystemExit("%s is missing — run once without --offline" % path)
    return json.loads(path.read_text(encoding="utf-8"))


def build_governorates(offline):
    source = fetch_cod(offline)
    features = []
    for f in source["features"]:
        p = f["properties"]
        name = p.get("adm2_name")
        if not name:
            continue
        geometry = simplify(f["geometry"], GOV_DP, GOV_TOLERANCE, GOV_MIN_SPAN)
        if not geometry:
            continue
        features.append(feature(name, geometry, {
            "id": p.get("adm2_pcode"),
            # Which of the two territories the governorate belongs to, so a
            # chart can draw one of them without a hard-coded list of names.
            "region": p.get("adm1_name"),
            "km2": round(float(p.get("area_sqkm") or 0), 1),
            "at": [round(float(p["center_lon"]), 4), round(float(p["center_lat"]), 4)]
                  if p.get("center_lon") and p.get("center_lat") else None,
        }))
    if len(features) != 16:
        raise SystemExit("%d governorates, expected 16 — the boundary set has changed" % len(features))
    return {"type": "FeatureCollection", "features": features}


def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    points = sum(
        len(ring)
        for f in data["features"]
        for polygon in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"])
        for ring in polygon
    )
    print(f"{path.relative_to(ROOT)}: {len(data['features'])} features, "
          f"{points:,} points, {path.stat().st_size / 1024:.0f} KB")


def main(offline):
    write("world.json", build_world(offline))
    write("palestine.json", build_region(offline))
    write("governorates.json", build_governorates(offline))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="rebuild from cached raw files")
    main(parser.parse_args().offline)
