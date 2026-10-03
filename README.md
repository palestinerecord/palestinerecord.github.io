# The Documented Record

**Israel and the Occupied Territories, 1917–2026: an interactive forensic survey of state conduct, alleged violations of international law, and the documented record.**

**Live site: https://palestinerecord.github.io/**

The Documented Record is a free, open website that sets out the record of Israel's conduct towards the Palestinian people from the British Mandate to the present. It holds every figure, finding, statement and source in that record, and it shows each one with the body that recorded it. Each figure is plotted, each quotation names its speaker, and each finding names the court, commission or organisation that made it. The data behind every chart is published as plain JSON that anyone can download.

The record rests on a written survey: *The State of Israel and Occupied Territories: A Forensic Academic Survey of State Conduct, Alleged Violations of International Law, and the Documented Record (1917–2026)*. As of October 2026 it runs to about 231,000 words in 36 parts and 205 sections, with 15 tables and a bibliography of 101 works. The site reproduces it in full and builds everything else on it: 108 charts and maps, 29 datasets, a chronology of nearly 470 dated entries and a catalogue of 151 statements and findings.

The casualty figures refresh automatically every night from the public feeds they come from. Everything else is revised by hand as courts, commissions and monitoring bodies publish.

This repository *is* the website. GitHub Pages serves the `main` branch as it stands, with no build step.

---

## Contents

- [What is on the site](#what-is-on-the-site)
- [The standard the record holds itself to](#the-standard-the-record-holds-itself-to)
- [Using the record](#using-the-record): open data, embedding charts, citing, following changes, offline use
- [Terms of re-use](#terms-of-re-use)
- [Challenging a claim](#challenging-a-claim)
- [Running the site locally](#running-the-site-locally)
- [How the site is built](#how-the-site-is-built)
- [The data pipeline](#the-data-pipeline)
- [Checks](#checks)
- [Automation](#automation)
- [Publishing](#publishing)
- [Base data and credits](#base-data-and-credits)

---

## What is on the site

The site is a single page with a hash router. Every route below can be linked to directly, and every route also exists as a static, script-free snapshot under `snapshot/`.

| Route | What it holds |
|---|---|
| [`#/overview`](https://palestinerecord.github.io/#/overview) | The headline figures, the ratio of Palestinians to Israelis killed since 7 October 2023, and a field of points with one point per counted death. A **Name the points** control repaints the field from the Ministry of Health identification list, so hovering a point gives that person's name, age and sex. |
| [`#/tour/1`](https://palestinerecord.github.io/#/tour/1) | *Start here.* The case in eight steps: the toll, the asymmetry, the stated intent, the law it engages, and what states have and have not done. Each step has its own address, `#/tour/1` to `#/tour/8`. |
| [`#/data`](https://palestinerecord.github.io/#/data/gaza) | Every figure in the record, plotted, in nine chapters (see below). |
| [`#/children`](https://palestinerecord.github.io/#/children) | A unit chart of the children killed on both sides, period by period, one figure per child. Years no one counted are shown as gaps. |
| [`#/day`](https://palestinerecord.github.io/#/day) | *Said and done.* One axis of days you can scrub through. Pick any day of the war to see the deaths recorded that day, what was said and ordered, what was happening, and what crossed into Gaza. |
| [`#/timeline`](https://palestinerecord.github.io/#/timeline) | Two chronologies, 1917–2026: the recorded crimes and massacres, and between them the mandates, laws, plans, rulings and admissions. |
| [`#/evidence`](https://palestinerecord.github.io/#/evidence) | The complete survey, reproduced without omission: every part, section, list and table. |
| [`#/rebuttals`](https://palestinerecord.github.io/#/rebuttals) | Each argument made in defence of the documented conduct, answered on its own legal terms with the figures that settle it. |
| [`#/statements`](https://palestinerecord.github.io/#/statements) | Statements by named officials, each with speaker, role, date, verbatim quotation, context, evidentiary tier and legal significance. |
| [`#/legal`](https://palestinerecord.github.io/#/legal) | The ICJ proceedings, the ICC warrants and the findings under the Genocide, Fourth Geneva and Apartheid Conventions. It also holds the element matrices (each element of genocide and of apartheid set against the evidence for it), a graph of which finding rests on which instrument, and a sortable state-by-state duty-to-prevent scorecard. |
| [`#/ledger`](https://palestinerecord.github.io/#/ledger) | The persons and companies named in the record: office held, statements made, arrest warrants and their status, sanctions imposed and by whom, and what each firm supplies. |
| [`#/mp`](https://palestinerecord.github.io/#/mp) | *The constituency ledger*, for readers in Britain. Enter a postcode to find your MP. The page shows how they voted in every Commons division on Palestine, the early day motions they signed, what they have said in Parliament (including whether they called the conduct in Gaza genocide), petition signatures in the seat, and what the Register of Members' Financial Interests and the Electoral Commission record against their name. |
| [`#/answer`](https://palestinerecord.github.io/#/answer) | *Answer a claim.* Paste a post or a quotation. The page marks each claim it recognises and builds the answer from the report, the live figures and the documented statements. |
| [`#/provenance`](https://palestinerecord.github.io/#/provenance) | Every claim joined to the bodies it rests on, with switches that remove a whole class of source (all Palestinian sources, all Israeli sources, the UN, every human rights organisation) and recount what still stands. |
| [`#/tests`](https://palestinerecord.github.io/#/tests) | Statistical hypothesis tests on the published data, each with its null hypothesis, test, effect size, interval and adjusted p-value. |
| [`#/method`](https://palestinerecord.github.io/#/method) | The standard of proof: why the method is impartial but the conclusions are not neutral, three objections answered, the conditions under which the findings would fail, and the falsification register. |
| [`#/sources`](https://palestinerecord.github.io/#/sources) | The evidence base, every item linked: courts and tribunals, UN bodies, human rights organisations, open datasets, academic work, Israeli sources, journalism and archives. |
| [`#/api`](https://palestinerecord.github.io/#/api) | The open-data page: every dataset with its download link, and every chart with its embed address. |
| [`#/changelog`](https://palestinerecord.github.io/#/changelog) | Every dated revision to the record, newest first. |
| `#/embed/<chart>` | One chart alone, with its caption and source, for use in an iframe (see [Embedding charts](#embedding-charts)). |

The nine data chapters:

| Chapter | Covers |
|---|---|
| `#/data/gaza` | The Gaza death toll day by day: children, aid seekers, deaths from starvation, the famine classification, the hospitals |
| `#/data/asymmetry` | Palestinian and Israeli deaths side by side, period by period, and the ratio between them since 1948 |
| `#/data/since-1948` | The long toll from 1948 to 2026, and the periods no one counted |
| `#/data/complicity` | Arms transfers, trade, Security Council vetoes, and the companies in the UN database of businesses in the settlements |
| `#/data/land` | Where the land went, from the 1947 partition to the settlements of 2026, with the 456 villages depopulated in 1947–50 mapped one by one |
| `#/data/west-bank` | Killings, settler attacks, demolitions, displacement, and Palestinian children in Israeli military courts |
| `#/data/wars` | Each Gaza campaign and what inquiries found, the wars in Lebanon, Syria, Yemen and Iran, and the documented record of 7 October 2023 |
| `#/data/world` | Recognition of Palestine, arms embargoes, sanctions, ICJ interventions, vetoes, and which governments have called the conduct in Gaza genocide |
| `#/data/tables` | Every table in the survey, reproduced exactly, with the part and section it belongs to |

Two standalone pages sit alongside the app. [`nazi-comparison.html`](https://palestinerecord.github.io/nazi-comparison.html) is a companion essay on the Nazi comparison: who makes it, the documented parallels, the strongest objection, and the arguments for it that this record rejects. [`licence.html`](https://palestinerecord.github.io/licence.html) sets out the terms of re-use.

The search box (`/` or `Ctrl`/`⌘`+`K`) searches the whole record from any page. A sun/moon button switches between the dark and light themes, and the choice is remembered.

---

## The standard the record holds itself to

- **Every figure names its source.** Each curated figure, statement, finding and record row carries the body that recorded it, the date, and the section of the survey it comes from. A figure without an attribution fails the build.
- **Disputes are shown, not settled quietly.** Where an attribution is contested, the record marks it contested. Where a widely shared paraphrase differs from the sourced wording, both are given and the difference is stated.
- **Gaps stay gaps.** Days with no report are left empty, not interpolated. Periods no one counted are published as gaps, not estimates. Estimates that the record makes itself are labelled as estimates, with their method.
- **Impartial, not neutral.** The same evidential standard applies to every party. The record includes Hamas's crimes of 7 October 2023, and Part XIX of the survey sets out the counter-evidence and the limits of the analysis. Impartial method does not oblige the record to reach a balanced conclusion. The [method page](https://palestinerecord.github.io/#/method) sets out this distinction.
- **Removing a class of source.** The provenance graph joins each claim to the bodies it rests on and sorts those bodies by who controls them. Its switches show how much of the record survives without each class. As of 3 October 2026, 93.5 per cent of attributed claims still stand with every Palestinian source removed, 86.0 per cent without the United Nations, 83.6 per cent without Israeli sources, and 78.2 per cent without any human rights organisation.
- **Stating what would make it wrong.** The falsification register has one entry for each claim a reader could check for themselves, ordered weakest first. Each entry names the claim, what it rests on, how many independent kinds of source support it, and what evidence would break it. The record states four conditions under which it would fail:
  1. a load-bearing figure is shown to be wrong by a source of equal or better standing;
  2. a quotation is shown to be fabricated, mistranslated or materially taken out of context;
  3. the body that issued a finding withdraws or reverses it;
  4. the ICJ rules on the merits in *South Africa v. Israel*. The record does not pre-empt that judgment.
- **Testing the record statistically.** The [tests page](https://palestinerecord.github.io/#/tests) puts the data to hypothesis tests:
  - the integrity of the named list of the dead (identity-number check digits, duplicates, ages against dates of birth);
  - who is killed;
  - whether each ceasefire and each ICJ order changed the daily death rate;
  - the West Bank before and after October 2023;
  - settler prosecutions, Area C permits and demolitions, food prices under blockade, administrative detention, journalists killed and destroyed buildings.

  p-values are adjusted for the false discovery rate (Benjamini–Hochberg, 5 per cent) across every test run. A change at a dated event is reported as an association, not as proof of cause.

---

## Using the record

### Open data

Every dataset behind the site is published as plain JSON over HTTPS, with no login and no key. Responses carry `Access-Control-Allow-Origin: *`, so a page on any other site can fetch them directly.

```
https://palestinerecord.github.io/data/<file>.json
```

The manifest at [`data/index.json`](https://palestinerecord.github.io/data/index.json) lists each dataset with a title, description, source, size in bytes, top-level fields, record count and last-updated date. It is the machine-readable entry point, and the [`#/api`](https://palestinerecord.github.io/#/api) page shows it in readable form.

```bash
curl -s https://palestinerecord.github.io/data/index.json | python3 -m json.tool
curl -s https://palestinerecord.github.io/data/timeseries.json -o timeseries.json
```

| File | Contents | Source |
|---|---|---|
| `timeseries.json` | Killed and injured in Gaza and the West Bank, daily and monthly, plus infrastructure damage. Reporting gaps are left as gaps. **Refreshed nightly.** | Tech For Palestine, from Gaza Ministry of Health and OCHA reporting (public domain) |
| `names.json` | The Ministry of Health identification list: name in Arabic and English, age and sex. Every third record (24,279 people, about 2 MB). | Gaza Ministry of Health, via Tech For Palestine (public domain) |
| `names-boot.json` | 260 records spread evenly through that list, shown on the loading screen | as above |
| `headline.json` | The eight headline figures, the current ratio and the record's counts, in one small file | subset of `figures.json`, `timeseries.json`, `report-meta.json` |
| `figures.json` | The curated statistics in topic groups, each with label, value, qualifying note, source and survey section. Also holds the three competing definitions of antisemitism, the J50 Declaration and the British judgments on the question. | per record |
| `statements.json` | 151 statements and findings by named officials: speaker, role, date, verbatim quotation, context, categories, tier, legal significance. Contested attributions are marked. | primary reporting, cited per record |
| `chronology.json` | 142 dated crimes and massacres | the survey, Appendix B |
| `timeline-extra.json` | 327 entries giving the legal and political context: mandates, partitions, laws, plans, rulings, resolutions, admissions | primary documents, cited per entry |
| `legal.json` | ICJ cases and orders, ICC warrants, treaty provisions engaged, findings under the Genocide, Fourth Geneva and Apartheid Conventions | ICJ, ICC, UN Commission of Inquiry |
| `elements.json` | The element matrices for genocide and apartheid, the instrument graph, and the duty-to-prevent scorecard definitions | the conventions and the findings made under them |
| `children.json` | Children killed on both sides, period by period and year by year, with uncounted periods published as gaps | B'Tselem, DCI–Palestine, OCHA, Gaza MoH, Israel National Council for the Child and others; named per row |
| `history.json` | The pre-October-2023 baseline, and how far the count falls short of the true toll (Lancet capture–recapture estimate, Gaza Mortality Survey, bodies under rubble) | B'Tselem, OCHA, *The Lancet*, Gaza Mortality Survey |
| `long-record.json` | 1917–2026 as series: the long toll, the asymmetry ledger, the accountability gap, dispossession, detention, complicity, divestment, vetoes, recognition, land | per record |
| `conduct-record.json` | Conduct of the war: aid against need, hunger, what remains of infrastructure, AI targeting systems, human-shields investigations, the Hannibal Directive, child detention and deaths in custody, and other topics | WHO, UNRWA, UNESCO, OCHA, CPJ, Physicians for Human Rights and others |
| `war-record.json` | Arms transfers by supplier and year, the Lebanese toll 1982–2026, and operations in Lebanon, Syria, Yemen and Iran | UN Commission of Inquiry, OCHA, B'Tselem, government records |
| `world-positions.json` | For every state: recognition of Palestine and its date, sanctions, ICJ interventions, and whether its government has called the conduct in Gaza genocide (with speaker, date, words and source) | UN records, foreign ministries, General Assembly addresses |
| `nakba.json` | The 456 towns and villages depopulated in 1947–50: sub-district, date, 1948 population and land area, the military operation, what happened there, what stands on the site now, coordinates | Salman Abu Sitta, *Atlas of Palestine 1917–1966* |
| `maps.json` | Governorate-level figures: Gaza on the IPC famine scale at each round since famine was confirmed, and the West Bank settler-attack and displacement series | IPC, OCHA |
| `entities.json` | The accountability ledger: named persons and companies, warrants, sanctions, and the 125 states parties to the Rome Statute with their duty to cooperate | joined from `statements.json`, `report.json`, `world-positions.json` |
| `constituency.json` | Every Commons seat and its MP: votes on Palestine, early day motions, words on genocide, petition signatures by seat, polls, registered interests and donations, and a stated score | UK Parliament APIs, Electoral Commission |
| `constituency-speeches.json` | A verbatim excerpt of each sitting MP's contributions to every debate on the subject since 7 October 2023 | Hansard (Open Parliament Licence) |
| `provenance.json` | The provenance graph: each claim, the source bodies it rests on, how each body is classified, and the results of the switches | derived from every record's `source` field |
| `falsification.json` | The falsification register, ordered weakest first | derived from `provenance.json` and `statements.json` |
| `tests.json` | The statistical tests: null hypothesis, test, effect size, interval, raw and adjusted p-value, sources and the series plotted | `data/`, plus PCBS, UNOSAT, B'Tselem, Yesh Din, CPJ, Peace Now |
| `claim-patterns.json` | The phrase index behind `#/answer`: how each claim is worded in public, mapped to the rebuttal that answers it | the survey, Part XVI |
| `chart-events.json` | Dated events that can be drawn on the time series: ceasefires, ICJ orders, ICC warrants, the total blockade, the famine declaration, closures of crossings | OCHA and contemporaneous reporting |
| `sources.json` | The linked source library, grouped by kind | each entry links to its publisher |
| `report.json` | The whole survey as structured data: every part, section, paragraph, list, table, chronology entry and bibliography entry | the survey |
| `report-meta.json` | The survey's title, counts and full bibliography, without the text | the survey |

The map geometry under `data/geo/` (`world.json`, `palestine.json`, `governorates.json`) is published as well. Each dataset's `meta` block records when it was generated and what it covers.

### Embedding charts

Every chart can be placed on another site, together with its title, caption and source. The `embed` button on any chart copies a ready-made snippet:

```html
<iframe src="https://palestinerecord.github.io/#/embed/gaza-monthly"
        width="100%" height="460" loading="lazy" frameborder="0"
        title="Palestinians killed in Gaza, per month"></iframe>
```

An embedded chart keeps drawing from the live data, so it stays current, and the attribution goes wherever the chart goes. Add `?theme=light` before the `#` for a light page. Every chart's embed address is listed on [`#/api`](https://palestinerecord.github.io/#/api).

Each chart card also has these tools:

- `link`: a deep link to the chart in place, such as `#/data/gaza&chart=gaza-monthly`
- `png`: a downloadable image of the chart
- `csv`: the plotted values
- `table`: the same values as an accessible table

Dated series also carry an `events` toggle, which overlays the turning points from `chart-events.json`.

### Share cards

Every statement and every headline figure has a `card` button. It draws a 1080×1080 image in the browser, with no network request, carrying the speaker, date, source and the site's address. A long quotation is set in smaller type rather than cut short.

### Citing

The footer of every page generates a citation in APA, Harvard and BibTeX form. Each citation names the route and the date of the data on screen. The site also carries `ScholarlyArticle` and `Dataset` structured data, so the datasets can be found through Google Dataset Search.

### Following changes

- [`#/changelog`](https://palestinerecord.github.io/#/changelog) lists every dated revision.
- [`feed.xml`](https://palestinerecord.github.io/feed.xml) is an Atom feed of the same revisions for feed readers.
- Every publication, whether the nightly refresh or a change pushed by hand, asks the Internet Archive's Wayback Machine to save a copy. That gives an independent timestamp for anyone who does not want to rely on this repository's history.

### Offline use and installing

The site is a progressive web app, so it can be installed to a phone's home screen. A service worker (`sw.js`) keeps a copy of everything already loaded, so the record still opens on a poor connection or none.

- Pages are fetched from the network first and fall back to the cached copy.
- Data files are served from the cache at once and refreshed in the background.
- Versioned assets are served from the cache.

Load any page with `?nosw=1` to unregister the worker and clear its caches.

---

## Terms of re-use

There are two layers, and they carry different terms. [`licence.html`](https://palestinerecord.github.io/licence.html) has the full text.

- **The compilation:** the selection and arrangement of the record, the written survey, the derived JSON under `data/` and the charts drawn from it. You may copy, quote, redistribute and build on it for any purpose, including commercial use, with attribution to *The Documented Record* (https://palestinerecord.github.io/). No permission is needed.
- **The underlying figures** are not ours to licence. Each record names the body that recorded it, and that body's terms govern the figure. The two external datasets the site is built on are Tech For Palestine's casualty series (public domain, under the Unlicense) and OCHA's subnational boundaries for the State of Palestine (CC BY 3.0 IGO).

---

## Challenging a claim

The record is meant to be tested. To challenge a figure, quotation or finding, open an issue in this repository with the `challenge` label. Each entry in the falsification register, on the [method page](https://palestinerecord.github.io/#/method), has a button that opens a pre-filled issue naming the entry, its published value, its date and the sources it rests on.

A challenge succeeds on evidence, and the register states what evidence would settle each kind of claim. A superseding figure from a source of equal or better standing replaces the old one. A quotation shown to be fabricated or materially taken out of context is withdrawn. A finding withdrawn by the body that made it is removed. The correction is dated in the changelog.

Corrections to errors in the site itself (broken charts, accessibility problems, wrong links) are welcome as ordinary issues, using the `bug` or `accessibility` labels.

---

## Running the site locally

Nothing needs building. Clone the repository and serve the folder over HTTP:

```bash
git clone https://github.com/palestinerecord/palestinerecord.github.io.git
cd palestinerecord.github.io
python3 -m http.server 8777
open http://localhost:8777/          # or visit it in any browser
```

The site must be served over HTTP. Opening `index.html` straight from the filesystem fails, because the views `fetch()` their data and browsers block that for `file://` pages.

These URL flags are useful during development:

| Flag | Effect |
|---|---|
| `?nosw=1` | Unregisters the service worker and clears its caches. Use this if you keep seeing old files. |
| `?theme=light` / `?theme=dark` | Forces a theme |
| `?still=1` | Stops the 3D charts rotating (used by headless checks) |
| `?prerender=1` | Renders text only: no charts, animations or WebGL. `prerender.py` uses this to take snapshots. |

---

## How the site is built

### Front end

The front end is plain HTML, CSS and JavaScript, with no bundler and no framework. Each library owns one layer, and no property is animated by more than one of them:

| Layer | Library | File |
|---|---|---|
| 3D scene, camera, render loop | Three.js 0.160.0 (ES module via an import map) | `js/scene.js` |
| Scroll-driven state | GSAP 3.12.5 and ScrollTrigger, writing only to a plain `state` object | `js/app.js` |
| Charts and maps | ECharts 5.5.1 and ECharts-GL 2.0.9, each chart on its own canvas | `js/charts.js` |
| Markup | Plain DOM strings | `js/views.js`, `css/style.css` |
| Share cards | Canvas, no dependencies | `js/share.js` |

Every third-party script loads from jsDelivr at an exact version, with a subresource-integrity hash and `crossorigin="anonymous"`. Three.js is pinned through the import map's own `integrity` field. A Content-Security-Policy restricts scripts to the site itself and jsDelivr. Network requests may only go to the site, jsDelivr, the Tech For Palestine feed and `api.postcodes.io`, which handles the MP page's postcode lookup.

**Routing.** `js/app.js` holds the hash router, with the route list in `VIEWS`. In-page anchors (`#part-…`, `#sec-…`) are not routes: the router scrolls to them rather than re-rendering, so a link into the middle of the survey lands where it points.

**Charts.** A view writes `<div class="chart" data-chart="name">`. `Charts.init()` then finds each name in the registry `R` in `js/charts.js` and builds the chart. Each build is wrapped in its own `try`/`catch`, so one failing chart cannot take down the page; a failed chart leaves a note in its card. A builder may return a promise, which is how the maps fetch their geometry on first use. To add a chart:

1. Register it: `R['my-chart'] = () => ({ /* ECharts option */ })` in `js/charts.js`.
2. Place it: `chartCard('my-chart', title, note, ref)` in `js/views.js`. The name must be unique on its page.

The embed index (`Views.charts()`) is built by scanning what the views actually render, not from a separate list, so it cannot fall out of step with the page.

**Themes.** `data-theme="light"` on `<html>` switches the palette. A small inline script applies the stored choice before first paint. The charts read their colours from CSS custom properties when they are built, so both themes come from a single palette definition. The light palette meets 4.5:1 contrast against white.

**Making the site visible to search engines.** A URL hash never reaches the server, so every route looks like the same empty page to a crawler. Two mechanisms deal with this:

- `setHead()` rewrites the title, description, canonical link and Open Graph/Twitter tags for each route.
- `prerender.py` writes a static, script-free snapshot of every route to `snapshot/`, plus a 1200×630 social card per route in `assets/og/`.

Each snapshot links to itself as canonical, opens with a visible note saying what it is, and links back to the interactive version. Crawlers are never shown anything a reader is not. `sitemap.xml` lists every snapshot, and each nightly publish notifies IndexNow (Bing, Yandex, Seznam, Naver). The hex-named `.txt` file at the root is the IndexNow key and must not be renamed. `google8cbf6aea08d3b76d.html` verifies the site for Search Console.

**Cache-busting.** Local asset URLs carry `?v=N`, in `index.html`, `js/views.js` and `sw.js`, and `sw.js` also declares `const VERSION = 'vN'`. Bump all of them together on every front-end change; `validate.py` fails if they disagree. Do it **before** running `prerender.py`, because the snapshots embed the stylesheet URL.

### Repository layout

```
index.html            the app shell: CSP, pinned libraries, JSON-LD, theme script
js/                   app.js (router, loading, behaviour), views.js (every page),
                      charts.js (chart registry), scene.js (3D field), share.js (cards)
css/style.css         all styles, both themes
data/                 the published datasets (see "Open data")
data/geo/             map geometry
data/raw/             cached upstream downloads, so builds can run offline
snapshot/             static, script-free copy of every route
assets/               icons, the flag, share and social cards (assets/og/)
sw.js                 service worker (offline support)
feed.xml              Atom feed of revisions
sitemap.xml           every snapshot, for search engines
licence.html          terms of re-use
nazi-comparison.html  companion essay, generated by companion.py
*.py                  the build, check and publish scripts (below)
.github/workflows/    nightly data refresh; monthly dependency check
```

---

## The data pipeline

Most of the published data is built by scripts in this repository from open upstream sources. The rest is curated by hand and edited directly.

### Generated files

| Script | Writes | From |
|---|---|---|
| `fetch_timeseries.py` | `timeseries.json`, `names.json`, `names-boot.json` | Tech For Palestine daily datasets. `--offline` rebuilds from `data/raw/`. The names files are rewritten only when the list was actually downloaded. |
| `sync_live.py` | updates curated figures marked `"live": true` | `timeseries.json`. It copies a refreshed figure into the curated files, and stops rather than publish a series that has fallen by more than a few per cent, which would mean a truncated or broken download. |
| `fetch_constituency.py` | `data/raw/` | UK Parliament members, votes, Hansard, interests and petitions APIs, and the Electoral Commission register. No API keys are needed. |
| `constituency.py` | `constituency.json`, `constituency-speeches.json` | the cached parliamentary record. `--report` prints the joins and writes nothing. |
| `build_positions.py` | `world-positions.json` | Wikipedia's recognition list (which cites the Palestinian foreign ministry and UN documents), the curated genocide positions in `genocide_positions.py`, and the sanctions and ICJ lists. It checks that the result covers exactly 193 UN member states. |
| `build_nakba.py` | `nakba.json` | Abu Sitta's village table, checked against the table's own totals |
| `build_geo.py` | `data/geo/*.json` | Natural Earth 1:50m and 1:10m, and the OCHA Common Operational Dataset (it asserts exactly 16 governorates) |
| `entities.py` | `entities.json` | joins statements, the survey and state positions; no new claims are added here |
| `patterns.py` | `claim-patterns.json` | the phrase index for `#/answer` |
| `provenance.py` | `provenance.json` | the `source` field of every curated record |
| `falsify.py` | `falsification.json` | the provenance graph and the statements |
| `manifest.py` | `index.json` | every file in `data/`. It fails if a file has no description or a description has no file. `--check` compares without rewriting. |
| `prerender.py` | `snapshot/`, `assets/og/`, `sitemap.xml`, JSON-LD dates | the running site in headless Chrome. `--only <slug>` re-renders named routes (never write the sitemap from a filtered run), `--no-cards` skips Pillow, `--budget N` gives a slow machine more time. |
| `companion.py` | `nazi-comparison.html` | a companion essay in Markdown |
| `build_icons.py` | `assets/icon-*.png` | draws the flag; only needs rerunning if the mark changes |

`data/report.json` and `data/report-meta.json` come from the survey's source manuscript, and `data/tests.json` from the statistical analysis. Both are kept in a separate, private working repository. `build.py` (in this repository) converts the manuscript into `report.json` losslessly, and `verify.py` checks that every line of the manuscript reached the JSON. Both scripts read the manuscript from that working repository, so they only run where it is checked out, never in the nightly job. Everything else in the pipeline runs from this repository alone.

### Curated files

`figures.json`, `statements.json`, `sources.json`, `history.json`, `timeline-extra.json`, `legal.json`, `long-record.json`, `war-record.json`, `conduct-record.json`, `elements.json`, `children.json`, `chart-events.json` and `maps.json` are edited by hand when the record gains a figure, statement, finding or source. Keep their field names exactly as they are, because the views and charts read them by name. Every record needs a `source` field, and a `§` reference where it comes from the survey.

### Regenerating after a change

```bash
python3 fetch_timeseries.py   # the live series (--offline to use the cache)
python3 sync_live.py          # carry it into the curated figures
python3 provenance.py         # then rebuild everything that holds a copy
python3 falsify.py
python3 validate.py           # must report 0 failures
python3 manifest.py
# bump ?v=N and the service-worker VERSION here if the front end changed
python3 prerender.py          # unfiltered, so the sitemap keeps every route
python3 render_check.py
```

---

## Checks

The checks test the facts first and the rendering second, because a chart can draw a wrong number perfectly.

- **`validate.py`** controls publication: failures block it, warnings do not. It reads the data, never the rendered page, and checks:
  - **Provenance:** every figure, statement, source and finding has an attribution, and every section reference points to a section that exists.
  - **Agreement:** headline figures match the live series, and monthly series add up to their cumulative series.
  - **Map joins:** every country and governorate named in the data resolves to a shape on the map. Otherwise ECharts silently drops it.
  - **Arithmetic:** declared totals equal the lists they count.
  - **Dates:** nothing is dated in the future, and sorted records are actually sorted.
  - **Wiring:** every registered chart is drawn by some view.
  - **Cache-busting:** the version number is the same everywhere.

  `--quiet` prints only failures; `--warnings` prints everything.
- **`render_check.py`** opens every route in headless Chrome. It fails if a chart container has no canvas in it, if a chart fell back to its failure note, or if the page logged an error. `--only <route> …` checks a subset.
- **`deps_check.py`** compares every third-party Python import in the repository with `requirements.txt`, so an undeclared dependency is caught on a workstation before it breaks the nightly run on a clean machine.
- **`manifest.py --check`** confirms that the open-data index matches the files in `data/`.

Two things still need a person to look:

- **Maps:** a choropleth whose data has not matched its shapes draws as a uniformly grey map, which a DOM check cannot catch. Screenshot `#/data/world` and `#/data/land` after any change to country names or geometry.
- **The duty-to-prevent scorecard:** a state whose name did not match across datasets appears as two half-rows. Check `#/legal` for duplicate rows.

### Requirements

- Python 3; the CI runner uses 3.12. Almost everything uses only the standard library. The two exceptions are pinned in `requirements.txt`: `Markdown==3.4.1` for `companion.py`, and `Pillow==10.4.0` for the share cards and icons.
- Google Chrome, for `prerender.py` and `render_check.py`.

```bash
python3 -m pip install -r requirements.txt
python3 deps_check.py
```

---

## Automation

**Nightly data refresh** (`.github/workflows/dashboard.yml`) runs at 05:17 UTC, again at 13:43 UTC in case GitHub drops the first run, and on any push that touches the data, front end or build scripts. In order, it:

1. installs the pinned libraries and runs the dependency check;
2. pulls the casualty series, retrying three times and falling back to the cached copy;
3. runs `sync_live.py`, then rebuilds the provenance graph, the falsification register and the manifest if anything moved;
4. runs `validate.py`;
5. rebuilds the snapshots and sitemap, and runs `render_check.py`;
6. commits and pushes, with the commit itself serving as the deployment;
7. asks the Internet Archive to save a copy and notifies IndexNow.

The failure policy works as follows:

- **Infrastructure problems never stop a refresh.** A slow package index, an upstream outage, a runner without Chrome or a push race are retried, then worked around, and the data still goes out.
- **Wrong data always stops a refresh.** If `validate.py` fails, nothing is committed and the last good figures stay live.
- **If the snapshots fail to render,** they are thrown away and the validated data is published on its own.
- **Runs do not end red.** Anything that needs a person opens or updates a single issue titled *Dashboard refresh needs attention*, and the next clean run closes it. A green tick means the workflow completed, not that data was published. An open issue is the signal that something needs attention.

**Monthly dependency check** (`.github/workflows/dependencies.yml`) runs on the first of each month. It compares each pinned front-end library with its latest release on jsDelivr and opens an issue if one has moved. Updating a pin is left to a person, because it means recomputing the integrity hash, bumping the cache version and re-rendering every route.

---

## Publishing

GitHub Pages serves `main` at the site root, so a push to `main` is a deployment. Every change made on a workstation goes out through `publish.py`, and only after it passes the checks:

```bash
python3 publish.py -m "What changed"   # validate → preflight → commit → push → wait for Pages → fetch the live site
python3 publish.py --check             # validate and preflight only; never pushes
python3 publish.py --dry-run           # everything up to the push
python3 publish.py --render            # also run the headless render first
```

After pushing, it waits for the Pages build and then fetches the live site to confirm the served `index.html` asks for the new `?v=` version. The edge cache can hold the old page for up to ten minutes, so it polls through a cache-busting query.

The nightly job often pushes too, so fetch and rebase before publishing. Conflicts appear only in generated files such as snapshots, the sitemap and the manifest. Take the incoming version and rerun the generators; do not merge by hand.

The site's commits are authored as `palestinerecord`, using GitHub's no-reply address. The publishing token is read from an untracked, gitignored file only at the moment of the push, and handed to git through a temporary helper that is then deleted. It never appears in a commit, a remote URL or a command line, and `publish.py` refuses to run if it could leak.

---

## Base data and credits

- **Casualty series and the identification list:** [Tech For Palestine](https://data.techforpalestine.org/), compiled from Gaza Ministry of Health, OCHA and UN reporting (public domain).
- **Map geometry:** [Natural Earth](https://www.naturalearthdata.com/) (public domain). Natural Earth draws the 1949 armistice line as the boundary and treats the West Bank and Gaza as one unit. That is a cartographic base, not a ruling on any boundary, and the maps say so.
- **Governorate boundaries:** OCHA, *State of Palestine: Subnational Administrative Boundaries*, Common Operational Dataset, [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/).
- **The 1948 villages:** Salman Abu Sitta, *Atlas of Palestine 1917–1966* (Palestine Land Society, 2010), pp. 108–115.
- **The parliamentary record:** UK Parliament (Members, Commons Votes, Hansard, Register of Interests and Petitions APIs), under the [Open Parliament Licence](https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/), and the Electoral Commission's register of donations.
- **Everything else** is sourced inline: every figure, statement and finding on the site names the body that recorded it, and the [sources page](https://palestinerecord.github.io/#/sources) links to each one.
