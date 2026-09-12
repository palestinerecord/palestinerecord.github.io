# Dashboard — ideas for the next level

Review date: 12 September 2026. Reviewed against the live build at `http://localhost:8777` (cache-bust `v=13`), all seven routes rendered at 1440×900 and 390×844, plus `README.md`, `js/*.js`, `css/style.css`, `build.py`, `fetch_timeseries.py` and every file under `data/`.

## 1. Where it stands

What is already strong and should be protected as the dashboard grows:

- **Lossless fidelity.** `build.py` + `verify.py` guarantee the Evidence route is the report, not a summary of it. This is the dashboard's defining property and every idea below must keep `verify.py` at zero missing fragments.
- **Every figure carries its source.** Stat cards, chart refs (`§6.3`, `Appendix B`), tooltip provenance. Contested attributions are stated, not resolved.
- **Layered architecture is clean.** Three.js, GSAP, ECharts and DOM each own one layer. Adding charts is one registry entry plus one `chartCard()` call.
- **The particle field is honest.** One point per documented death, child share exact, sampled down only for GPU load. That is a design idea worth extending rather than replacing (see §5.1).
- **Verified state.** 49 charts, 0 orphans, 3 routes tested headless with 0 console errors (apart from the favicon 404).

The dashboard is currently a very good *reference*. The gap between where it is and "a higher level" is that it does not yet *argue*, *locate*, *compare* or *travel*. The four biggest missing dimensions are: geography (no map anywhere), narrative (no guided path through 49 charts), shareability (nothing exportable), and freshness (data updates are a manual script run).

## 2. Fixes found during review

Small, concrete, and worth doing before anything else.

1. **Chart header collapses on mobile.** `.chart-head` is a flex row and the `.chart-ref` badge does not wrap, so at 390px the title "Palestinians killed for every Israeli killed" is squeezed into a 100px column and the badge overflows the card. Fix: `flex-wrap: wrap` on `.chart-head`, badge to full width below 600px.
2. **Left axis name is clipped.** `ratio-trend` shows "nians killed per Israeli killed" at both desktop and mobile — the y-axis `name` overruns `grid.left: 56`. Either shorten the axis name, raise `grid.left`, or move the name into the card note (the note already says it).
3. **Count-up shows wrong intermediate values for decimals.** `countUp()` does `Math.round(target * eased)`, so 38.5 animates as 0…30…38 then snaps to "38.5"; 15.6 shows "12", 20.5 shows "16" mid-flight. Any screenshot taken during the 1.1s animation shows a false figure. Fix: keep one decimal when `target` is non-integer, or skip animation for values under 100.
4. **Data route is 54,492px tall with 42 charts.** It works, but it is a scroll of 60 screens. See §4.1 for the structural fix; as a stopgap add a sticky in-page section nav.
5. **`favicon.ico` 404** on every load. Add an SVG favicon (the flag or a mark) and `<link rel="icon">`.
6. **No Open Graph / Twitter card metadata.** A link shared on Facebook, WhatsApp or X shows no image and a generic title. Add `og:title`, `og:description`, `og:image` (a rendered 1200×630 card of the headline figures), `twitter:card`.
7. **CDN dependency with no integrity hashes.** Four UMD scripts and one importmap from jsDelivr, no `integrity`/`crossorigin`. Either add SRI hashes or vendor the libraries under `vendor/` so the dashboard works offline and cannot be altered upstream.
8. **Hash routing is invisible to crawlers and previews.** `#/evidence` is one URL to Google and to Facebook. See §7.3.
9. **`README.md` says "five local asset URLs" carry `?v=N`; there are now nine** (eight in `index.html`, one in `views.js`). Update the doc, or better, generate the version from a single constant.

## 3. Geography — the missing dimension

Nothing in the dashboard has a map, and this subject is fundamentally about land. This is the single highest-impact addition.

### 3.1 The land, 1917–2026 (the canonical four-panel, done properly)
- The familiar "Palestinian land loss" sequence (1917 / 1947 / 1967 / 2026) as a scrubbable single map rather than four static tiles, with a year slider driven by GSAP and the same `state` object pattern as `scene.js`.
- Layers per year: Mandate boundary, 1947 Partition Plan, 1949 Armistice line, 1967 occupation, Oslo Areas A/B/C, the Wall route (ICJ 2004), settlements, East Jerusalem municipal boundary, Golan.
- Sources: UN OCHA oPt geodata, B'Tselem settlement shapefiles, Peace Now, Zochrot for depopulated villages. All open.
- Rendering: ECharts already supports `geo` + `map` series with GeoJSON; no new library is needed. For the 3D variant, echarts-gl `map3D` is already loaded.

### 3.2 Nakba — the depopulated villages
- One dot per village (Zochrot / Khalidi *All That Remains*: ~530), with date of depopulation, cause (expulsion / flight / massacre), and what stands there now. Play the dots in date order across 1947–49 alongside Plan Dalet.
- Ties directly to §2.2–2.4 and the Absentees' Property Law charts.

### 3.3 Gaza by governorate, and the shrinking "humanitarian zone"
- Deaths by governorate (Tech For Palestine daily feed carries some geographic detail; MoH reports do), overlaid with evacuation-order polygons over time (OCHA publishes these) and the ever-smaller al-Mawasi zone. This makes Rebuttal 11 ("Israel issues evacuation warnings") visual: the warned-to area shrinks while deaths inside it rise.
- Infrastructure damage points (UNOSAT damage assessments are open) as a heat layer.

### 3.4 West Bank — settlements, outposts, and settler violence
- Settlement and outpost points sized by population, coloured by legal status; settler attack incidents from the OCHA database as a time-animated layer; Iron Wall displacement from the refugee camps (Jenin, Tulkarm, Nur Shams).
- Governorate choropleth for the 1,114 killed.

### 3.5 The region — every strike outside Israel's borders
- Part VII and Part VIII (Lebanon, Syria, Yemen, Iran) have no charts at all. A regional map with strike counts by country and year (ACLED is open for research use; Airwars for Lebanon) would make "serial violator of sovereign territory" a picture.

### 3.6 Recognition and the duty to prevent — the world map
- Choropleth of the 157 states recognising Palestine, with date of recognition as the colour scale. Second toggle: which states have imposed arms embargoes, sanctions on officials, or joined the ICJ case (§15.2–15.5). Third: who still supplies arms (§13). This turns three separate lists in the report into one map with three layers.

## 4. Structure and navigation

### 4.1 Split the Data route into chapters
54k pixels is not a page. Options in order of preference:

- **Sub-routes**: `#/data/gaza`, `#/data/west-bank`, `#/data/since-1948`, `#/data/1948`, `#/data/settlements`, `#/data/uk`, `#/data/tables`. The router already supports the pattern; each chapter is its own `Views` function. Charts are initialised per chapter so `Charts.init` runs on ~6 charts, not 42.
- **Sticky chapter nav** under the topbar on Data, Evidence and Legal, with scroll-spy (the Evidence TOC already does this — generalise it).
- **A "chart index" page**: every chart as a thumbnail grid with title, source and one-line finding, searchable. Journalists and post-writers want "the chart about X" and today they have to scroll to find it.

### 4.2 Deep links to every chart and figure
- `#/data/gaza?chart=gaza-monthly` scrolls to and highlights the card. Every `chartCard()` gets a small link icon that copies the URL.
- Every stat card gets a permalink too (`?fig=headline-2`).
- Every Evidence section already has an anchor. Add a visible "§" link on hover to copy it.

### 4.3 Bidirectional chart ↔ text links
- `figures.json` items already carry `ref` (e.g. `§6.3`). Use it: in the Evidence route, render a small "Figures from this section" strip at the top of each section that has any. In the Data route, the `§6.3` badge should be a link into the Evidence section.
- Same for statements: `statements.json` entries with a report section reference get a "read in context" link.

### 4.4 A guided path ("Start here")
- Nothing on the Overview tells a first-time visitor what to read in what order. Add a 6–8 step guided tour: *the toll → the asymmetry → the intent (statements) → the finding (legal) → the machinery (accountability, detention, dispossession) → the complicity → the rebuttals*. Each step is one chart or one card with a one-sentence claim, and a "next" button. Implemented as a route (`#/tour/3`) so it is linkable.

### 4.5 The Rebuttals as a first-class route
- Part XVI ("Defeating every rebuttal") is the most shareable part of the report and it is currently buried inside Evidence. Give it its own route: an accordion of the eleven claims, each with the answer, the two or three charts that support it embedded inline, and a copy-to-clipboard of the answer text. This is the page to send someone who says "but Hamas…".

## 5. Narrative and impact

### 5.1 The names
- Tech For Palestine's `killed-in-gaza` list has 72,835 named records with age and sex. The dashboard aggregates them but never shows a name. Two ideas that respect the material:
  - **The boot screen** cycles through names (name, age) while data loads, at reading speed, and states how many it would take to read them all at that pace.
  - **The particle field becomes addressable**: hovering a point on the Overview shows a name and age. Sampling is 1-in-3 or 1-in-6 so most points still map to one real person. Under 100 lines of code on top of `scene.js`; the list would need to be shipped as a compressed names-only file (~1 MB gzipped) or streamed.
- Both are opt-in for the visitor and reduced-motion aware. The Guardian and Al Jazeera did versions of this in 2024; the difference here is that the count is live.

### 5.2 Scale translations
- The user's audience is British. A "what this would mean here" toggle on the headline cards: Gaza's population is ~2.2m, roughly Greater Manchester; 74k deaths is 3.3% of that, equal to every person in a town the size of Loughborough. 1.9m displaced is Birmingham and Leeds combined. Per-capita scalers are a standard technique (Financial Times, NYT) and land far harder than raw counts.
- Comparative bars against other conflicts by the same measures: children killed per year, journalists killed (CPJ), aid workers killed (Aid Worker Security Database), healthcare workers (WHO SSA). The record shows Gaza exceeding every comparator on each measure; the charts do the arguing.

### 5.3 Events on the time-series
- The Gaza monthly and daily charts have one annotation (the ceasefire). Add the rest as `markLine`/`markPoint`: ICJ orders (26 Jan, 28 Mar, 24 May 2024), Rafah invasion, Flour Massacre, GHF opening, the June 2026 crossings closure, each Lebanon escalation. A toggle "show events" so the chart stays clean by default. This connects the timeline and the data views, which currently do not touch.
- The `daily` series is the right place for this; `dataZoom` is already available in ECharts and would let readers zoom on a single week.

### 5.4 The accountability funnel, animated
- The Yesh Din funnel is the sharpest chart in the dashboard (2,427 complaints → 0.9% indictments). Give it a Sankey (`type: 'sankey'`, already in ECharts) from complaint → investigation opened → closed without → indictment → conviction, with the actual counts on each flow. Same for settler violence investigations.

### 5.5 "Since you last visited"
- Store the last-seen `last_daily_update` and killed total in `localStorage`. On return, one quiet line under the hero: "Since you were here on 4 September: 212 more killed, 3 more journalists." No tracking, no server.

## 6. Data and charts that the report has and the dashboard does not

Cross-referenced against the report's 34 parts. These are in the text, sourced, and not yet plotted.

| Report part | Missing visual |
|---|---|
| Part VI §6.3 | Aid trucks per day vs the 500/day pre-war baseline; famine-phase (IPC) by month |
| Part VI §6.4 | Lavender / Habsora: targets generated, seconds of human review, "acceptable" civilian ratios (15–20 per junior target, 100 per senior) as a small-multiples chart |
| Part V §5.8, Part XIX §19.5 | Human shields: the documented Israeli use (Mosquito protocol, B'Tselem/Breaking the Silence testimonies count) against the number of cases substantiated for Hamas by independent bodies |
| Part VII | Lebanon 2024–25: killed, displaced, pager casualties by hour; strikes by month |
| Part VIII | Regional strikes by country and year; Iran 2025–26 war casualties |
| Part X §10.2 | Children in detention over time (DCI-P, Military Court Watch); administrative detention monthly series (already in `long-record.json` — extend to children) |
| Part X §10.3–10.4 | Deaths in custody by month since Oct 2023 |
| Part XI §11.1 | The Qatar cash transfers to Hamas by year (the "Israel funded Hamas" record) |
| Part XII | Estimated warhead count over time (SIPRI/FAS) vs NPT status — one small chart |
| Part XIII | **Arms transfers**: US ($21.7bn), UK licences by value and category, German exports by year. This is the "complicity" chart and it is absent entirely. SIPRI and CAAT data are open. |
| Part XIII §13.6 | The MAGA/isolationist split: US public opinion by party and age (Gallup, Pew) — the `opinion` chart covers the UK; add the US series from §15.11 |
| Part XV §15.2–15.5 | Embargoes, sanctions on officials, diplomatic ruptures by date — a cumulative step chart of states taking any measure |
| Part XV §15.9 | Media trust collapse polling |
| Part XVIII | Hannibal Directive: the reconstructed 7 October Israeli casualty breakdown by cause where it is known |
| Part XXII | Anti-Muslim hate incidents (Tell MAMA) on the same axis as the CST series already plotted for `uk-antisemitism` — the report's own comparison, currently half-drawn |
| Appendix E | Healthcare and educational infrastructure table exists as a table only; plot it as a "what remains" bar (before / destroyed / functioning) |

Also: the `demographics` block already has `bands`, `male`, `female`, `child_ages`. An **age pyramid by month of death** (small multiples) would show whether the profile of the dead changes across phases of the war.

## 7. Platform, performance, discoverability

### 7.1 Automated refresh
- A GitHub Actions workflow on a nightly cron: `fetch_timeseries.py`, `build.py`, `verify.py`; commit only if `verify.py` passes and the data changed; deploy to Pages. The dashboard becomes self-updating and the "Data to 2026-09" badge stays honest without manual runs.
- Add a visible **freshness indicator** in the topbar: "Casualty data: 10 Sep 2026 · Report: 12 Sep 2026", red if the feed is more than 7 days stale.

### 7.2 Payload
- `report.json` is 861 KB uncompressed and is fetched before anything renders. It is only needed by Evidence, Legal and search. Load it lazily on first use; the Overview then needs ~200 KB.
- Nine sequential `await get()` calls in `load()` — make them `Promise.all`.
- Serve pre-compressed (`.json.gz`/`.br`) if the host supports it; GitHub Pages does gzip automatically.
- Consider an ECharts custom build; the full `echarts.min.js` + `echarts-gl` is ~1.4 MB for two 3D charts.

### 7.3 Crawlability and sharing
- Move from hash routes to path routes (`/data/gaza`) with a `404.html` redirect trick for GitHub Pages, or keep hash routes and additionally **prerender** each route to a static HTML snapshot at build time (`chrome --headless --dump-dom` is already used in the README for verification; the same command produces the snapshot). Search engines and link previews then see real content.
- Generate `sitemap.xml` and per-route `og:image` cards at build time (one Chrome screenshot per route, or a Pillow-rendered stat card).
- Schema.org `Dataset` JSON-LD for the time-series and `ScholarlyArticle` for the report, so Google Dataset Search indexes it.

### 7.4 Offline and durability
- A service worker caching the shell and data means the dashboard works offline once loaded and survives CDN outages. Pair with vendoring the libraries (§2.7).
- Archive each release with the Wayback Machine (`web.archive.org/save/`) from the deploy workflow, and add a "This version archived at …" link in the footer. For a forensic record, an independent timestamp is part of the evidentiary chain.
- `CITATION.cff` and a `LICENSE` for the data files (Tech For Palestine is public domain; the curated JSON is the author's work and needs a stated licence, CC BY 4.0 is the natural one).

### 7.5 Accessibility
- Every chart is a canvas with no text alternative. Add a "view as table" toggle to `chartCard()` that renders the series data as an HTML table (screen readers, and also copy-paste for journalists). The data is already in memory.
- `aria-label` on each chart container from the card title.
- `--muted: #7d879c` on `#05070c` is roughly 4.2:1; fine for large text, marginal for the 11px axis labels. Lift to ~4.5:1.
- Focus rings on cards, chips and nav links are not visible in the current CSS.
- A light theme is worth doing for print and for readers who cannot read light-on-dark; the CSS is already variable-driven so it is mostly a second `:root` block plus chart palette swap.

### 7.6 Print and export
- A print stylesheet (`@media print`) that hides the scene, expands all sections and renders charts at fixed size. The report already has a PDF; the dashboard's charts do not.
- **Export any chart as PNG** with an auto-generated caption strip (title, source, `§ref`, URL, date). ECharts `toolbox.saveAsImage` gives the pixels; a small canvas compositor adds the strip. This directly serves the user's Facebook post workflow — every chart becomes a citable image.
- **Export a statement as a quote card** (speaker, role, date, quote, source) in 1080×1080 and 1200×630. Same compositor.
- **Download the data**: a `data/export/` folder with CSVs of every series, and a "download CSV" link on each chart.

## 8. Search

The current search is substring match over the report only.

- Index **everything**: statements, timeline entries, sources, figures, legal determinations. Group results by type.
- Rank by term frequency and position (title hit > body hit), and support quoted phrases and `speaker:`, `year:`, `part:` prefixes.
- Fuzzy matching for names with variant spellings (Deir Yassin / Dayr Yasin, Gallant / Galant). A 6 KB library (uFuzzy or MiniSearch) covers this.
- Recent searches and "jump to section" without leaving the keyboard (arrow keys already work on results? — verify).

## 9. Statements and Legal routes

### 9.1 Statements
- A **scatter timeline**: x = date, y = category, colour = tier, size = evidentiary weight. Founding-era to present on one axis makes the report's point ("they do not begin in October 2023") in a single image.
- **Speaker pages** (`#/statements/netanyahu`): everything one person said, in date order, with their role at each date. Herzog, Netanyahu, Gallant, Smotrich, Ben-Gvir, Eliyahu would each have several entries.
- Mark statements **cited in a formal finding** (the COI's 16 Sept 2025 report names Herzog, Netanyahu, Gallant; South Africa's ICJ application quotes several). A small badge "Cited by ICJ / COI" with a link to the finding.
- Where a video or audio source exists, link to it; primary-source video is the strongest form of the record.

### 9.2 Legal
- **The elements matrix**: Genocide Convention Article II(a)–(e) as rows, the evidence categories as columns, each cell linking to the section and chart that supplies it. Same matrix for the apartheid elements (§4.2 already says "Israel meets every element" — show it as a filled grid).
- **Instrument graph**: which findings rest on which instruments (Rome Statute articles, Geneva IV, the Apartheid Convention, ICJ Statute Art 41). A small force-directed or chord diagram in ECharts; the data is in `legal.json` and Appendix A.
- **State scorecard**: for the 30 or so states that matter (arms suppliers, G20, ICJ interveners), one row each: recognises Palestine? arms embargo? sanctions on officials? intervened at ICJ? Still supplying arms? Sortable. This is the "duty to prevent" tracker the Legal page's closing note calls for.

## 10. Timeline

- The timeline is a vertical list of 213 entries. Add a **horizontal density strip** at the top (the `era-density` chart is close) that is scrubbable — drag across decades and the list scrolls to match.
- **Link entries to charts and sections**: an entry like "26 Jan 2024 ICJ provisional measures" should link to the Legal determination and the Evidence section.
- **Year markers** in the gutter, and a sticky "current year" label while scrolling.
- Casualty sparkline inline for entries after October 2023, showing that month on the Gaza series.

## 11. Longer-term ambitions

- **Embeddable charts.** `#/embed/gaza-monthly` renders one chart with no chrome, sized to its iframe, with source caption. Blogs and posts can embed the live chart rather than a screenshot.
- **A fact-sheet builder.** Tick figures and charts, get a one-page PDF with sources. Useful for MPs' letters, campaign leaflets, complaints to broadcasters.
- **Arabic and Hebrew.** The UI strings are few; the report is the hard part. Even UI-only RTL support plus Arabic labels on charts would broaden the audience materially.
- **An API.** The JSON under `data/` is already an API in all but name. Document it, version it, and add a `data/index.json` manifest with schemas and `last_updated` per file.
- **A changelog route.** Each `build.py` run diffs the previous `figures.json`/`report.json` and writes a human-readable changelog: "12 Sep 2026: Part X §10.3A added; headline toll 73,412 → 73,670." A forensic record should show its own revision history.

## 12. Suggested order

Ranked by impact against effort. The first five are each a day or less.

1. §2 fixes (mobile chart header, axis clip, count-up decimals, favicon, OG tags).
2. §4.1 split Data into chapter sub-routes with a sticky sub-nav.
3. §7.6 chart export as PNG with caption strip, and statement quote cards.
4. §7.1 nightly refresh workflow and freshness badge.
5. §4.5 Rebuttals route.
6. §3.1 + §3.6 the two maps that need no new library: land 1917–2026 and the recognition/embargo world map.
7. §6 arms transfers and the Lebanon/regional series (the largest sourced gaps).
8. §5.3 event annotations on the casualty series, with `dataZoom`.
9. §4.4 guided tour.
10. §5.1 the names, on the boot screen first, in the particle field second.
11. §3.2–3.4 the remaining maps.
12. §7.3 prerendering and path routes.
13. §9.2 elements matrix and state scorecard.
14. §7.5 accessibility pass (table toggle on every chart).
15. Everything in §11.
