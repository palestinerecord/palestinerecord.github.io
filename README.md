# Dashboard — report-final.md, visualised

An interactive reading of `../report-final.md`: every statistic plotted, every part and section reproduced without omission, and the casualty record graphed over time by war, period and place.

No build step. Open it over HTTP:

```bash
python3 -m http.server 8777
open http://localhost:8777/index.html
```

It must be served over HTTP — the views `fetch()` their data, so opening `index.html` from the filesystem fails on CORS.

## Architecture

Layered separation, following the `web3d-integration-patterns` skill: each library owns one layer and no property is animated by more than one of them.

| Layer | Owner | File |
|-------|-------|------|
| 3D scene, camera, render loop | Three.js (ESM via importmap) | `js/scene.js` |
| Scroll-driven state | GSAP + ScrollTrigger, writing only to a plain `state` object | `js/app.js` |
| Charts | ECharts + echarts-gl, each on its own canvas | `js/charts.js` |
| Markup and overlay | Plain DOM strings | `js/views.js`, `css/style.css` |

Libraries load from CDN as UMD scripts (echarts 5.5.1, echarts-gl 2.0.9, gsap 3.12.5 and its ScrollTrigger plugin), each pinned with a subresource-integrity hash and `crossorigin="anonymous"`. Three 0.160.0 is the exception: it loads as an ES module through an importmap, which SRI does not cover.

### Routing

A hash router over nine routes: `#/overview`, `#/tour`, `#/data`, `#/timeline`, `#/evidence`, `#/rebuttals`, `#/statements`, `#/legal`, `#/sources`. The data route is split into nine chapters, each its own sub-route: `#/data/gaza`, `#/data/asymmetry`, `#/data/since-1948`, `#/data/complicity`, `#/data/land`, `#/data/west-bank`, `#/data/wars`, `#/data/world`, `#/data/tables`. The tour takes a step number the same way — `#/tour/1` to `#/tour/8` — so a single step of the guided path can be linked to on its own. In-page anchors (`#part-…`, `#sec-…`) are deliberately **not** routes — `route()` scrolls to them rather than re-rendering, so a link into the middle of the evidence browser lands where it points.

### Crawlability and sharing

A hash never reaches the server, so to a crawler or a link preview every route is the same URL — `index.html`, which before any JavaScript runs is an empty `<main>`. Two mechanisms fix that without abandoning hash routing.

**The head is rewritten per route.** `Views.meta(name, sub)` holds a title and a description for each of the seventeen routes, and `setHead()` in `js/app.js` writes them into `document.title`, the description, the canonical link and the whole og/twitter block on every render, pointing the card at `assets/og/<slug>.png`. The base URL comes from the canonical tag rather than from `location`, so a page rendered on localhost still advertises the public URL.

**Each route is also written out as a static page.** `prerender.py` renders every route in headless Chrome with `?prerender=1` — a flag that turns off the charts, the scroll reveals, the counting numbers and the WebGL field, so the dump catches the text at rest rather than a page frozen mid-animation — and writes `snapshot/<slug>.html`. The snapshots keep the text, the tables, the links and the source references, and drop everything that cannot work without script: the scripts themselves, every `<button>`, the canvases and the search overlay. `<details>` stays, because the rebuttals open without JavaScript. Each empty chart container becomes a line of prose linking to the live chart through the app's own deep-link form, `#/data/gaza&chart=gaza-monthly`.

Snapshots are **self-canonical**. A canonical pointing back at a fragment URL would collapse to the site root for every search engine and leave sixteen of the seventeen routes unindexed, which is the problem the snapshots exist to solve. Nothing is served to a crawler that a reader is not also shown: each snapshot opens with a visible note saying what it is, when it was generated, and where the interactive version is.

Structured data lives in two JSON-LD blocks in `index.html` — a `ScholarlyArticle` describing the report, and a `Dataset` describing the JSON under `data/` with its distributions and measured variables, so it can be found through Google Dataset Search. `prerender.py` stamps both `dateModified` values from `data/timeseries.json`, and fails if it cannot find exactly two, so the structured data cannot drift from the data actually shipped.

### Chart registry

A view emits `<div class="chart" data-chart="name">`; `Charts.init(root, data)` scans the rendered DOM, looks each name up in the registry `R` (93 charts), and builds it. Each build is wrapped in its own `try`/`catch`, so one failing WebGL chart cannot abort the page, and charts fade in on an IntersectionObserver rather than all at once.

To add a chart: add `R['my-chart'] = () => ({ ...echarts option })` in `js/charts.js`, then `chartCard('my-chart', title, note, ref, cls)` in `js/views.js`. A name must be unique on the page it appears on — `chartCard()` emits `id="chart-<name>"`, and the PNG, CSV and table tools resolve the chart through that id.

A builder may also return a promise of an option; `init()` awaits it before calling `setOption`. The maps use this to fetch their geometry on first use. A builder that rejects leaves a note in the card rather than an empty box.

### Chart tools

Every card carries `link`, `png`, `csv` and `table`. Charts listed in `EVENTED` in `js/charts.js` carry a fifth, `events`, which draws the dated turning points in `data/chart-events.json` across the series as a `markLine`. The layer is off by default so the shape of the series is read first; `Charts.toggleEvents(name)` flips it and rebuilds the chart with `{ notMerge: true }`, which is what actually removes the markers again — a merged `setOption` would leave the previous `markLine` in place. The 11 October 2025 ceasefire is not part of that layer: it is drawn on every dated series unconditionally, which is why both it and the optional events are built by one `seriesMarks()` call. A series may hold only one `markLine`, so they cannot be separate.

### The names

The hero field draws one point per counted death and, by itself, says nothing about who any of them were. Two controls make it say something.

The boot screen cycles `names-boot.json` at 450 ms a name — Arabic, transliteration and age — and states what reading the whole list at that pace would cost: nine hours and six minutes for 72,835 names. Under `prefers-reduced-motion` it shows one name and does not cycle.

The overview carries a **Name the points** button. Turning it on fetches `names.json`, repaints the field from the list rather than from the proportional sample it starts as — amber for a person under 18, red for an adult — and raycasts the points on `pointermove` so hovering one gives that person's name, age and sex. The list is shorter than the field by roughly the share of the dead who have never been identified, and those surplus points are painted grey and say so on hover: *Counted in the toll; no name on the register.* The count in the note is computed, not written: on a display drawing 24,557 points, 24,279 carry a record, none of them twice, and the remaining 278 stand for the 835 unidentified dead. The layer turns itself off when the reader leaves the overview.

Two constraints shaped the implementation. The field's own colouring puts all the child-coloured points first, while the list is in publication order, so colour and size must be repainted from each point's own record or the label would contradict the point. And the scroll displacement used to live in the vertex shader, where a CPU raycaster cannot see it — it is now applied to `field.position.y`, so the point a reader is pointing at is the point the hit test returns. A Y-translation is unchanged by the field's Y-rotation, so the visual result is identical.

### The elements, the instruments and the states

The legal route closes with three blocks built from `data/elements.json`, all three answering the same objection: that a crime has not been made out because one part of it has not been shown.

**The element matrices** set each crime out as its instrument defines it — the five acts of Genocide Convention Article II, then the three elements of the crime of apartheid — and place the evidence that answers each part beside it under three columns: what the record counts, who has found it, and what was said. Every cell names the report section it came from and, where the figure is plotted, links to the chart through the app's deep-link form. They are HTML tables rather than drawn grids: the cells carry sentences and links, which a canvas cannot hold, and a screen reader reads a table of elements against evidence in the order the argument runs. Where nothing in the record supplies a cell, the cell says so — Article II(d) carries no statement directed at births as such, and the matrix records that rather than reaching for something adjacent.

**The instrument graph** (`R['instrument-graph']`) draws which finding rests on which instrument: thirteen instruments on one arc of a ring, the twenty-four bodies that relied on them around the rest, coloured by class, and forty-seven edges each carrying the article cited. The layout is `circular` rather than force-directed on purpose — a force simulation settles somewhere different on every load, which would make the picture uncitable and the static snapshots irreproducible.

**The scorecard** is the duty-to-prevent tracker the legal page's closing note calls for: one row per state, sortable by any column, showing whether it recognises Palestine and when, whether it has halted or restricted arms, what sanctions it has imposed, whether it is party to the ICJ case, and what share of Israel's arms imports it supplies. The rows are derived at render time rather than curated — the union of the G20, the ICJ applicant and interveners, every state on the embargo list and every state that sanctioned Israeli ministers in June 2025 — so a state added to any of those datasets appears here without a second edit. The four datasets name a handful of states differently (Türkiye and Turkey, Czechia and the Czech Republic), so `scorecardRows()` resolves every name through the alias table and the 195-entry recognition list before keying on it, or the same state would appear twice with half its record in each row. Sorting is `behaviours.legal` in `js/app.js`: cells carry a numeric `data-sort` so *Halted* sorts above *Restricted* above *Continuing* rather than alphabetically. Article 63 intervention concerns the construction of the Convention and is not support for either party — the United States and Hungary both filed, and the note under the table says so.

### The definition, the declaration and the law

The world chapter closes with the block built from `figures.json`'s `definitions` key, which holds four records that only make sense read together: the three competing definitions of antisemitism (IHRA 2016, the Jerusalem Declaration 2021, the Nexus Document 2021 revised 2024), the J50 Declaration of 11 September 2026 with its full signatory list, the two British judgments that have actually decided the question, and the counter-evidence stated at its strongest.

`R['j50-map']` is the only chart in the block. It is a choropleth of the forty countries whose Jewish communal organisations signed, shaded by the number of signatory bodies in each — one, two, or three to four — and by nothing else: it is not a population, a share, or a measure of opinion, and the card note says so, because a map of institutions reads as a map of people unless it is stopped from doing it. The tooltip names every signatory body in the country, since the list is the evidence for the declaration's claim to breadth. Country names are resolved through the same `data.positions.alias` crosswalk the other two world maps use, so the curated names match the Natural Earth geometry.

Everything else in the block is HTML rather than canvas, for the same reason the element matrices are: the cells carry citations, quotations and holdings. The J50 totals are stated as counted from the primary text — seven global and regional organisations, fifty-two national and community organisations, forty countries, fifty-nine signatories in total — and the same count is what the record shows for the forum that drafted it. The two judgments are given with their citations and their limits, including that the belief held protected in *Miller* was the bounded formulation advanced in that case rather than anti-Zionism at large, and the block ends with the counter-evidence rather than with the argument it answers.

### Cache-busting

Every local asset URL carries `?v=N` — ten in `index.html`, and one in `js/views.js`, where the overview hero writes the flag `<img>` from a template string. Bump them together on every change, or returning visitors keep the old JS and CSS:

```bash
python3 - <<'PY'
import re, pathlib
n = max(int(m) for m in re.findall(r'\?v=(\d+)', pathlib.Path('index.html').read_text())) + 1
for f in ('index.html', 'js/views.js'):
    p = pathlib.Path(f); p.write_text(re.sub(r'\?v=\d+', f'?v={n}', p.read_text()))
print('cache-bust now v=%d' % n)
PY
```

## Data

| File | Generated by | Contents |
|------|--------------|----------|
| `data/report.json` | `build.py` | The whole report: parts, sections, blocks, all 13 tables, the Appendix B chronology, the bibliography |
| `data/timeseries.json` | `fetch_timeseries.py` | Monthly Gaza / West Bank casualty series and infrastructure damage, from the Tech For Palestine daily datasets |
| `data/raw/` | `fetch_timeseries.py` | The raw upstream JSON, cached so `--offline` can rebuild without the network |
| `data/names.json` | `fetch_timeseries.py` | Every third record of the Ministry of Health identification list, in published order — Arabic name, transliteration, age, sex, and nothing else (24,279 records, 2.0 MB, 565 KB gzipped). One record per point the hero field draws |
| `data/names-boot.json` | `fetch_timeseries.py` | 260 of those records, evenly spaced through the list, for the boot screen to cycle (22 KB). A separate file so the loading screen never waits on the large one |
| `data/figures.json` | hand-curated | ~100 statistics grouped by topic, each with its note, source and originating report section. The last group, `definitions`, is not statistics: it holds the three competing definitions of antisemitism, the J50 Declaration with its forty-country signatory list, the two British judgments on the question and the counter-evidence |
| `data/statements.json` | hand-curated | Documented statements of intent: speaker, role, date, verbatim quote, context, categories, tier, legal significance |
| `data/sources.json` | hand-curated | The linked source library, grouped by kind |
| `data/history.json` | hand-curated | The pre-October-2023 baseline and the undercount layer (Lancet capture–recapture, the Gaza Mortality Survey, bodies under the rubble) |
| `data/timeline-extra.json` | hand-curated | The contextual chronology — the legal and political steps between the massacres in Appendix B |
| `data/legal.json` | hand-curated | The proceedings: ICJ orders and the advisory opinion, ICC warrants, the treaty obligations each one turns on |
| `data/long-record.json` | hand-curated | The 1948–2026 layer: the long toll by period, the asymmetry ledger, the accountability gap, displacement and demolition, mass detention, the complicity ledger, the veto record and where the land went. Constructed estimates are labelled as such and carry their method |
| `data/world-positions.json` | `build_positions.py` | Where each state stands: recognition of Palestine and its date, sanctions measures, ICJ applicant and interveners. Every country also carries the Natural Earth name the map geometry uses |
| `data/war-record.json` | hand-curated | What the suppliers authorised and what the wars beyond Gaza cost: German, US and UK arms transfers by year with the German embargo's dates and the composition of the €800m tranche; the Lebanese toll by episode 1982–2026; and every documented operation on the sovereign territory of Lebanon, Syria, Yemen and Iran. The two values no government has published — the German 2022 baseline and the Twelve-Day War toll — carry `estimate: true` and their derivation |
| `data/conduct-record.json` | hand-curated | The conduct layer the other files do not hold: the aid requirement against what crossed, the hunger caseload, what is left of Gaza's infrastructure, the AI targeting systems, who investigated the human-shields allegation and what each found, the Hannibal Directive on 7 October, the policy of keeping Hamas funded, child detention and deaths in custody, the NPT exception, the coverage and the two UK monitoring series. Every block names the report section it comes from, and each derived value carries `estimate: true` |
| `data/elements.json` | hand-curated | The legal page's three structured blocks: the two element matrices (Genocide Convention Article II(a)–(e) and the three elements of the crime of apartheid, each row carrying the evidence that answers it under three headings — what the record counts, who has found it, what was said — with the report section and, where one exists, the chart); the instrument graph (13 instruments, 24 findings, 47 citations, each node carrying its full title, date and holding); and the row set and column definitions for the duty-to-prevent scorecard. Where nothing in the record supplies a cell, the cell says so rather than being left blank |
| `data/chart-events.json` | hand-curated | The dated events the Gaza series can be annotated with: the siege order, the ICJ orders and advisory opinion, the ICC warrants, the two massacres at aid and displacement sites, the total blockade, the famine declaration, the two Commission of Inquiry findings and the closure of the last crossings. Each carries the tooltip text and the report section it comes from |
| `data/nakba.json` | `build_nakba.py` | Every town and village depopulated in 1947–50, one record each: name, sub-district, date, 1948 population and land area, the Israeli operation it fell to, what the atlas records happened there, what stands on the site now, and coordinates (456 villages, 438 placed, 95 KB). Also the monthly, sub-district, cause and site-condition tallies the charts read |
| `data/maps.json` | hand-curated | The governorate-level figures neither `build.py` nor the timeseries can derive: Gaza on the IPC scale at each of the three rounds published since the famine was confirmed, and the West Bank settler-attack, displacement, annual and Operation Iron Wall series. Every governorate is keyed by its OCHA name; a governorate no body has published a figure for is left out of the series and drawn as unreported, never given a value |
| `data/geo/world.json` | `build_geo.py` | Natural Earth 1:50m country polygons (241 features, 302 KB) for the two world choropleths |
| `data/geo/palestine.json` | `build_geo.py` | Natural Earth 1:10m polygons for Israel, the West Bank and Gaza, plus the Mandate outline derived from them |
| `data/geo/governorates.json` | `build_geo.py` | The sixteen governorates of the West Bank and Gaza Strip from the OCHA Common Operational Dataset (2,027 points, 38 KB), each carrying its P-code, its region and its area |

`app.js` fetches the fourteen non-geometry files together rather than one after another, so the boot time is the slowest single file and not the sum of all fourteen. The geometry, the names, `nakba.json` and `maps.json` are all outside that payload: `charts.js` fetches a map or data file the first time a chart needs it and keeps the promise, so the two world maps share one request, the three governorate charts share one download of `maps.json`, a reader who never opens a map chapter never pays the 302 KB, and `scene.js` fetches `names.json` only when the reader asks for it. `names-boot.json` is fetched on its own alongside the fourteen and never blocks them — if it is slow or missing, the boot screen simply does not show a name.

`app.js` merges `report.json`'s Appendix B chronology with `timeline-extra.json` into one ordered array (`D.timeline`), tagging each entry `record` or `context` so the two remain distinguishable in the UI. Appendix B entries carry no sort key, so one is derived from the date string.

## Regenerating

```bash
python3 build.py            # report-final.md  →  data/report.json
python3 verify.py           # asserts no source line was lost; must print "missing fragments: 0"
python3 fetch_timeseries.py # live casualty series and the named dead (--offline rebuilds from data/raw)
```

If `verify.py` reports missing fragments, a new markdown construct has defeated the parser. Fix `build.py`; do not ship a lossy dashboard.

`fetch_timeseries.py` writes three files: `timeseries.json` on every run, and `names.json` and `names-boot.json` only when the identification list was actually downloaded. Under `--offline` it leaves the existing pair in place rather than emitting an empty one, so a rebuild without the network cannot silently empty the hero field of its names.

Two further generators are run only when their upstream source changes, not on every pass:

```bash
python3 build_geo.py        # Natural Earth and the OCHA COD  →  data/geo/*.json
python3 build_positions.py  # recognition, sanctions and ICJ filings  →  data/world-positions.json
python3 build_nakba.py      # Abu Sitta's village list  →  data/nakba.json
```

`build_geo.py` downloads the Natural Earth vector files (public domain), keeps only the fields the maps read, rounds the coordinates and drops the smallest rings, which is what takes the world file from several megabytes to 302 KB. It also derives the Mandatory Palestine outline from the Israeli and Palestinian parts rather than carrying a hand-drawn polygon — every ring of both, as one multipolygon. That is a visual outline, not a topological union, and the land map does not draw it: painting the three parts one colour gives the same shape without a fourth polygon sitting on top of them and swallowing their tooltips. The governorate file comes from a different source, the OCHA Common Operational Dataset, because that is the boundary set the UN agencies report against and so the only one whose names join the published figures without a crosswalk; the script asserts it found exactly sixteen governorates. Both territories sit in one file, and since ECharts cannot draw part of a registered map, a chart that wants one of them registers its own filtered copy from the same download.

`build_positions.py` parses the recognition list from the Wikipedia article "International recognition of Palestine", which cites the Palestinian Ministry of Foreign Affairs list and the underlying UN documents entry by entry; the sanctions and ICJ layers are transcribed from the report, each naming the section it came from. Every country name is resolved to the name Natural Earth uses, and the script raises rather than emitting an entry that would silently fail to draw. It also asserts that the recognising and non-recognising lists sum to exactly the 193 UN member states, so a parser that half-reads a table fails loudly.

`build_nakba.py` parses the table in the Wikipedia article "List of towns and villages depopulated in the 1948 Palestine war", which is a transcription of Salman Abu Sitta's *Atlas of Palestine 1917–1966*, pp. 108–115. It raises on an unknown sub-district rather than skipping the row, and it checks the population and land-area totals it computes against the total row the table carries for itself — they agree to within four thousandths of one per cent. A village is classified as a massacre site only where the atlas uses that word; "atrocity" is the atlas's own separate term and is counted separately.

All three scripts take `--offline` to rebuild from the cached raw download in `data/raw/`.

Last, after any change to the routes, the data or the copy, regenerate the static layer:

```bash
python3 prerender.py        # snapshot/*.html, assets/og/*.png, sitemap.xml
```

It serves the folder on a free port itself, so nothing need be running, and it touches the network not at all. `--only <slug> …` re-renders named routes, `--no-cards` skips the Pillow step, `--no-snapshots` redraws the cards from the snapshots already on disk, and `--budget N` raises the virtual-time budget on a slower machine. The script fails loudly rather than shipping a hole: an empty DOM, a route reporting a data load failure, a loading screen still up when the budget expired, or a `VIEWS`/`DATA_CHAPTERS` list it could not parse all stop the run. That last check is why the route list is read out of `js/app.js` and `js/views.js` rather than kept here — a chapter cannot be added and then silently never crawled.

`sitemap.xml` lists the site root and all seventeen snapshots. GitHub Pages only honours `robots.txt` at a domain root, so for a project site the sitemap has to be submitted directly in Search Console rather than advertised from a `Sitemap:` line.

The hand-curated files are not regenerated and must be edited directly when the report gains a figure, a statement or a source. Keep their schemas exactly as they are — the chart registry reads those field names.

## Verifying

Render each route in headless Chrome with software WebGL and count what actually built. A chart that fails leaves its container empty rather than throwing, so the counts are the only honest check:

```bash
for r in overview timeline evidence rebuttals statements legal sources \
         data/gaza data/asymmetry data/since-1948 data/complicity data/land \
         data/west-bank data/wars data/world data/tables; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader \
    --virtual-time-budget=12000 --dump-dom "http://localhost:8777/index.html#/$r" 2>/dev/null \
  | python3 -c "import sys,re; h=sys.stdin.read(); c=len(re.findall(r'data-chart=',h)); v=len(re.findall(r'<canvas',h)); g=h.count('map geometry could not'); w=h.count('needs WebGL'); print('$r','bytes=%d'%len(h),'charts=%d'%c,'canvas=%d'%v,'geomfail=%d'%g,'webglfail=%d'%w,'FAIL' if (len(h)<5000 or v<c or g or w or 'Could not load' in h) else 'ok')"
done
```

`canvas` must be at least `charts` on every route, and `geomfail` and `webglfail` must both be `0` — a chart that fails to build leaves a note in its container rather than throwing, so the counts are the only honest check.

`bytes` is in the line for a reason, and the failure condition tests it first. If Chrome is killed, or exits before the route has rendered, `--dump-dom` emits nothing at all; a check that only looks for the words `Could not load` then reads that empty stream as zero charts, zero canvases and no error, and prints `ok`. A DOM under 5,000 bytes is not a passing route, it is an absent one. The heavy chapters are the ones this bites on: `data/gaza` carries twenty charts including a three.js scene, and every frame that scene draws advances the virtual clock by another 16 ms, so a generous `--virtual-time-budget` buys hundreds of software-rendered frames and minutes of real time. Give the slow chapters a smaller budget rather than a larger one, and never run two headless instances against the same Chrome profile at once.

The maps need a visual check as well as a count: the DOM check confirms a canvas exists, not that the choropleth joined. Screenshot the two chapters that carry one:

```bash
for r in data/world data/land; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader \
    --virtual-time-budget=14000 --window-size=1440,2600 \
    --screenshot="$(basename $r).png" "http://localhost:8777/index.html#/$r"
done
```

A choropleth that has lost its join renders as a uniformly grey world, which is indistinguishable from a successful render in the DOM.

The static layer has its own check. Every snapshot must carry its own title and canonical, hold no script, button or canvas, and still contain the prose — a snapshot that came out of Chrome before the route rendered is a valid HTML file with nothing in it:

```bash
python3 - <<'PY'
import pathlib, re
for p in sorted(pathlib.Path('snapshot').glob('*.html')):
    h = p.read_text()
    bad = [w for w in ('<script', '<canvas', '<button') if w in h]
    print('%-22s %7d bytes  words=%-6d %s %s' % (
        p.name, len(h), len(re.sub(r'<[^>]+>', ' ', h).split()),
        'canonical' if 'snapshot/%s' % p.name in h else 'NO CANONICAL',
        'leftover: ' + ', '.join(bad) if bad else 'clean'))
PY
```

The scorecard needs a join check of its own, for the same reason the maps do: a state whose name did not reconcile still renders, as two rows holding half a record each. Dump the legal route and read the row set:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader \
  --virtual-time-budget=14000 --dump-dom "http://localhost:8777/index.html#/legal" 2>/dev/null \
| python3 -c "
import sys, re
h = sys.stdin.read()
body = re.search(r'<table class=\"scorecard\".*?<tbody>(.*?)</tbody>', h, re.S).group(1)
rows = re.findall(r'<tr>.*?</tr>', body, re.S)
states = [re.search(r'<th scope=\"row\">(.*?)(?:<span|</th>)', r, re.S).group(1).strip() for r in rows]
print('rows', len(rows), 'matrices', len(re.findall(r'<table class=\"matrix\"', h)))
print('duplicates', sorted({s for s in states if states.count(s) > 1}) or 'none')"
```

`duplicates` must print `none`, and `matrices` must be `2`.

## Provenance

Casualty time-series: [Tech For Palestine](https://data.techforpalestine.org/) (public domain), compiled from Gaza Ministry of Health, OCHA and UN reporting. Map geometry: [Natural Earth](https://www.naturalearthdata.com/) (public domain), which draws the 1949 armistice line as the Israel/Palestine boundary and treats the West Bank and Gaza as one unit — a cartographic base, not an adjudication of any boundary, and the maps say so on the chart. Governorate boundaries: OCHA, *State of Palestine — Subnational Administrative Boundaries*, from the Common Operational Dataset, [CC BY-IGO](https://creativecommons.org/licenses/by/3.0/igo/). The 1948 village list: Salman Abu Sitta, *Atlas of Palestine 1917–1966* (Palestine Land Society, 2010), pp. 108–115. Everything else is sourced inline, and every figure carries its own source. Contested attributions carry the dispute with them rather than being resolved silently — the dashboard holds the report's evidentiary standard, not a looser one.
