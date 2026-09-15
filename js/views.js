/* ============================================================
   views.js — every route's markup. Each view returns an HTML
   string; app.js injects it and then calls Charts.init().
   ============================================================ */

const Views = (function () {
  let D = null; // { report, ts, fig }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-GB');

  const last = (series) => series.values[series.values.length - 1];

  // Palestinians killed per Israeli killed, to one decimal place.
  const ratio = (p) => Math.round(10 * p.palestinian / p.israeli) / 10;

  /* A few cards carry a documented range rather than a single figure — "80–120"
     trucks a day. Those pass through as written: rendering them as a number
     would either invent a precision the source does not have or print NaN. */
  const compact = (n) => {
    if (typeof n === 'string' && !/^-?\d+(\.\d+)?$/.test(n)) return esc(n);
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'm';
    if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
    return fmt(n);
  };

  /* A speaker's name, reduced to something that can sit in a URL. Used by the
     statement anchors and by `#/statements/<slug>`, the one-speaker view. */
  const speakerSlug = (name) => String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  /* ---------- shared fragments ---------- */

  function head(eyebrow, title, lede) {
    return `<div class="section-head">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h2>${esc(title)}</h2>
      ${lede ? `<p>${lede}</p>` : ''}
    </div>`;
  }

  /* A chart is a canvas: invisible to a screen reader, unquotable, and
     impossible to check. Every card therefore carries its own anchor, a
     captioned PNG export, a CSV of the plotted series, and a table view
     of the same numbers. */
  // Notes are written with markup in them; the attribute carries the words only.
  const plain = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  function chartCard(name, title, note, ref, cls) {
    return `<div class="card chart-card" id="chart-${name}" data-chart-card="${name}"
        data-title="${esc(title)}" data-source="${esc(ref || '')}" data-note="${esc(plain(note))}">
      <div class="chart-head">
        <div><h3>${esc(title)}</h3><p>${note || ''}</p></div>
        <div class="chart-tools">
          ${ref ? `<span class="chart-ref">${esc(ref)}</span>` : ''}
          ${/* charts.js declares Charts with const, which binds in the script
               scope and not on window, so this must test the bare name. */
            typeof Charts !== 'undefined' && Charts.hasEvents && Charts.hasEvents(name)
            ? `<button class="chart-tool" data-tool="events" title="Mark the dated events on this series" aria-label="events — mark the dated events on this chart" aria-pressed="false">events</button>`
            : ''}
          <button class="chart-tool" data-tool="link" title="Copy a link to this chart" aria-label="link — copy a link to this chart">link</button>
          <button class="chart-tool" data-tool="png" title="Download a captioned PNG" aria-label="png — download a captioned image of this chart">png</button>
          <button class="chart-tool" data-tool="csv" title="Download the plotted data" aria-label="csv — download the plotted data">csv</button>
          <button class="chart-tool" data-tool="embed" title="Copy an iframe that shows this chart on another site" aria-label="embed — copy an iframe for this chart">embed</button>
          <button class="chart-tool" data-tool="table" title="Read the numbers as a table" aria-label="table — read the numbers as a table" aria-expanded="false">table</button>
        </div>
      </div>
      <div class="chart ${cls || ''}" data-chart="${name}" role="img" aria-label="${esc(title)}"></div>
      <div class="chart-table" hidden></div>
    </div>`;
  }

  /* Every figure carries a button that saves it as a square card with its
     label, its note and its source drawn into the image. A figure screenshotted
     off the page arrives somewhere else stripped of all three. */
  function statCard(s, tone) {
    return `<div class="stat ${tone || ''}" data-tone="${esc(tone || '')}">
      <div class="val" data-count="${s.value}">${compact(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ''}${s.unit || ''}</div>
      <div class="lbl">${esc(s.label)}</div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      ${s.source ? `<div class="src">${esc(s.source)}${s.ref ? ' · ' + esc(s.ref) : ''}</div>` : ''}
      <button class="share-card" data-share="figure" title="Save this figure as a shareable card"
        aria-label="card — save this figure as an image">card</button>
    </div>`;
  }

  function tableHTML(t) {
    return `<div class="table-wrap"><table>
      <thead><tr>${t.header.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  // Blocks come from build.py already escaped and marked up.
  function blocksHTML(blocks) {
    return blocks.map((b) => {
      if (b.type === 'paragraph') return `<p>${b.html}</p>`;
      if (b.type === 'subheading') return `<h4>${b.html}</h4>`;
      if (b.type === 'rule') return '<hr>';
      if (b.type === 'table') return tableHTML(b);
      if (b.type === 'list') {
        return `<ul>${b.items.map((i) => `<li class="lvl${i.level}">${i.html}</li>`).join('')}</ul>`;
      }
      return '';
    }).join('');
  }

  /* ---------- since the ceasefire ---------- */

  const CEASEFIRE = '2025-10-11';

  /* What the register did after the ceasefire, read off the daily series. This
     is not the same quantity as the count of people killed since 10 October
     2025: the register moves when an identification is completed, so it also
     carries bodies recovered from the rubble long after the strike. Both are
     shown, and the difference between them is stated rather than smoothed. */
  function sinceCeasefire() {
    const d = D.ts.daily.gaza;
    const at = d.dates.findIndex((x) => x >= CEASEFIRE);
    if (at < 1 || at >= d.dates.length - 1) return null;
    const last = d.dates.length - 1;
    const days = last - at + 1;
    const added = Math.max(0, d.killed[last] - d.killed[at - 1]);
    const before = (d.killed[at - 1] - d.killed[0]) / Math.max(1, at - 1);
    return {
      days, added, before, from: d.dates[at], to: d.dates[last],
      perDay: added / days,
      share: d.killed[last] ? (100 * added / d.killed[last]) : 0,
    };
  }

  /* The same block on the overview and in the Gaza chapter, because the belief
     that the war ended in October 2025 is the single most common thing a reader
     arrives with. The killed, injured, child and violation counts are the
     Ministry's, UNICEF's and Genocide Watch's, carried in the conduct record;
     only the register series and the rates are computed here. */
  function ceasefireSection(cls) {
    const c = sinceCeasefire();
    const r = D.conduct.ceasefire;
    if (!c || !r) return '';
    const one = (x) => Math.round(x * 10) / 10;
    const tone = ['red', 'amber', 'red', ''];
    return `<section class="section ${cls === undefined ? 'wrap' : cls}">
      ${head('Since the ceasefire', 'What stopped and what did not',
        `${esc(r.lede)} In the ${fmt(c.days)} days since, the Ministry of Health has recorded
         <b>${fmt(r.figures[0].value)}</b> Palestinians killed under a ceasefire — and its register of the identified
         dead has risen by ${fmt(c.added)}, which is ${one(c.share)} per cent of the whole toll of the war, as bodies
         are recovered and identifications completed. The register is growing at ${one(c.perDay)} a day against
         ${one(c.before)} a day before the ceasefire; the killings the Ministry counts in the period work out at about
         ${one(r.figures[0].value / c.days)} a day. On either measure the killing slowed sharply. On neither did it
         stop.`)}
      <div class="grid c4">
        ${r.figures.map((f, i) => statCard({
          label: f.label, value: f.value, suffix: f.floor ? '+' : '',
          note: f.note, source: f.source, ref: f.ref,
        }, tone[i])).join('')}
      </div>
      ${chartCard('ceasefire-daily', 'Added to the register each day since the ceasefire',
        'Each bar is the figure the Ministry published that day, which includes bodies recovered from the rubble. '
        + 'The dashed line is the daily mean of the two years before the ceasefire, on the same scale.',
        'Tech For Palestine (Gaza Ministry of Health daily series)', 'tall')}
      <p class="chart-note">${esc(r.notes[0])}</p>
      <p class="chart-note" style="margin-top:10px">${esc(r.notes[1])} Sections 6.7 to 6.10 of the report set out the
        conduct of this period in full: the strikes that continued, the closure of every crossing on 6 June 2026, and
        the talks that ran alongside both.</p>
    </section>`;
  }

  /* ---------- overview ---------- */

  function overview() {
    const s = D.rmeta.stats;
    const h = D.fig.headline;
    const meta = D.ts.meta;

    return `<div class="view">
      <section class="hero wrap">
        <div class="hero-inner">
          <div class="hero-flag">
            <img class="flag-ps" src="assets/flag-palestine.svg?v=89" alt="Flag of Palestine" fetchpriority="high">
            <span>Palestine</span>
          </div>
          <h1 data-hero-title>The Documented<span>Record</span></h1>
          <p class="hero-lede" data-hero-lede>${esc(D.rmeta.title)}. Every heading, paragraph, table and citation of the
            source report, rendered as an interactive archive — with daily casualty data plotted month by month
            across Gaza and the West Bank.</p>
          <div class="hero-meta" data-hero-meta>
            <span><b>${fmt(s.words)}</b> words</span>
            <span><b>${s.parts}</b> parts · <b>${s.sections}</b> sections</span>
            <span><b>${s.tables}</b> tables</span>
            <span><b>${D.timeline.length}</b> chronology entries</span>
            <span><b>${D.rmeta.bibliography_count}</b> sources</span>
            <span>Data to <b>${esc(meta.last_month)}</b></span>
          </div>
          <div class="hero-cta" data-hero-cta>
            <a class="btn primary" href="#/tour/1">Start here</a>
            <a class="btn" href="#/data">Explore the data</a>
            <a class="btn" href="#/evidence">Read the full record</a>
            <a class="btn" href="#/rebuttals">Answer the arguments</a>
          </div>
          <div id="since-last" class="since-last" hidden></div>
          <div class="hero-names">
            <button class="names-toggle" id="names-toggle" aria-pressed="false">Name the points</button>
            <span class="names-note" id="names-note">Each point behind this text is one death in Gaza. Naming them
              loads the ${fmt((D.ts.demographics || {}).total_records || 0)}-record identification list — about two
              megabytes.</span>
          </div>
        </div>
        <div class="scroll-hint">Scroll</div>
      </section>

      <section class="section wrap">
        ${head('The headline figures', 'What the record establishes', 'Figures as recorded in the report and corroborated by the Tech For Palestine open datasets compiled from Gaza Ministry of Health, OCHA and UN reporting.')}
        <div class="grid c4">
          ${statCard(h[0], 'red')}${statCard(h[1], 'amber')}${statCard(h[2], 'red')}${statCard(h[3], '')}
          ${statCard(h[4], 'red')}${statCard(h[5], 'amber')}${statCard(h[6], '')}${statCard(h[7], 'blue')}
        </div>
      </section>

      <section class="section wrap">
        ${(() => {
          const a = D.long.asymmetry;
          const now = a.periods[a.periods.length - 1];
          const intifada = a.periods[1];
          return `${head('The asymmetry', 'How many die on each side', a.lede)}
        <div class="grid wide-left">
          ${chartCard('ratio-trend', 'Palestinians killed for every Israeli killed', 'Each bar is one documented period. The dashed line is parity — one death on each side. The record has never been near it.', 'B’Tselem; OCHA; Israeli Ministry of Defense', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The current ratio</h3>
            <div class="grid">
              ${statCard({ label: 'Palestinians killed per Israeli killed, now', value: ratio(now), suffix: ':1', note: `${fmt(now.palestinian)} Palestinians against ${fmt(now.israeli)} Israelis since 7 October 2023`, source: 'Gaza MoH / OCHA; Israeli Ministry of Defense' }, 'red')}
              ${statCard({ label: 'The same ratio in the Second Intifada', value: ratio(intifada), suffix: ':1', note: 'the narrowest in the record, and the period most often cited as representative of the conflict', source: 'DCI-Palestine' }, 'amber')}
              ${statCard({ label: 'Palestinian children killed before the war, per Israeli child', value: Math.round(10 * a.children.palestinian / a.children.israeli) / 10, suffix: ':1', note: `${fmt(a.children.palestinian)} Palestinian children against ${fmt(a.children.israeli)} Israeli children`, source: esc(a.children.source) }, 'blue')}
            </div>
          </div>
        </div>
        <p class="chart-note" style="margin-top:16px">${esc(a.notes[0])} ${esc(a.notes[1])}</p>`;
        })()}
      </section>

      <section class="section wrap">
        ${head('Violence over time', 'Gaza, month by month', 'Every month of the war since October 2023. The dashed line marks the ceasefire that came into force on 11 October 2025.')}
        <div class="grid">
          ${chartCard('gaza-monthly', 'Palestinians killed in Gaza, per month', 'Bars show all recorded deaths; the amber overlay is the child share of the same month.', 'Tech For Palestine', 'tall')}
          ${chartCard('gaza-cumulative', 'Cumulative toll and protected categories', 'Children, women, medical personnel and journalists tracked against the total.', '§6.3', 'tall')}
        </div>
      </section>

      ${ceasefireSection()}

      <section class="section wrap">
        ${head('Place and period', 'Deaths by month, category and territory', 'A three-dimensional reading of the same record: each bar is one month, in one category, in one territory. Drag to rotate.')}
        ${chartCard('deaths-3d', 'Killings by month, category and territory', 'Gaza and the West Bank on a shared 36-month axis.', 'Tech For Palestine', 'xtall')}
      </section>

      <section class="section wrap">
        ${head('Seventy-five years', 'Every Gaza operation on one axis', 'The report applies the same evidentiary standard to each operation. Log scale, because the 2023–2026 figure is two orders of magnitude larger than what preceded it.')}
        <div class="grid wide-left">
          ${chartCard('wars', 'Palestinian deaths by military operation, 2008–2026', 'Hover for the period, the civilian proportion and the legal finding recorded for each.', '§5.5', 'tall')}
          ${chartCard('era-density', 'Documented events per decade', 'Density of the chronology, 1917–2026: crimes and massacres stacked against the legal and political record.', 'Appendix B + context', 'tall')}
        </div>
      </section>

      <section class="section wrap">
        ${head('Where to go next', 'Seven ways into the record', '')}
        <div class="grid c3">
          ${[
            ['#/data', 'Data', 'Every statistic in the report, plotted. Casualty series, wars, infrastructure, settlements, opinion polling, and all ' + s.tables + ' source tables.'],
            ['#/timeline', 'Timeline', D.timeline.length + ' dated entries from the 1917 Balfour Declaration to September 2026 — the crimes and the legal and political steps between them, filterable by era and searchable.'],
            ['#/evidence', 'Evidence', 'The complete report — all ' + s.parts + ' parts and ' + s.sections + ' sections, reproduced without omission.'],
            ['#/statements', 'Statements', D.statements.items.length + ' statements across ' + D.statements.categories.length + ' evidentiary categories, from 1891 to 2026, quoted verbatim with speaker, role, date, source and legal significance.'],
            ['#/legal', 'Legal', 'The findings: ICJ, ICC, the UN Commission of Inquiry, and the instruments each finding rests on.'],
            ['#/sources', 'Sources', D.sources.groups.reduce((n, g) => n + g.items.length, 0) + ' linked primary sources — courts, UN bodies, NGOs, datasets and archives — plus the report\'s ' + D.rmeta.bibliography_count + ' bibliography entries.'],
          ].map(([href, title, note]) => `<a class="card lift" href="${href}" style="text-decoration:none">
            <h3 style="font-size:19px;margin-bottom:8px">${title}</h3>
            <p class="small muted" style="margin:0">${note}</p>
          </a>`).join('')}
        </div>
      </section>
    </div>`;
  }

  /* The overview, drawn from headline.json alone.

     headline.json is about two kilobytes and is fetched before anything else,
     so the record can state what it establishes while the rest of the data is
     still in flight. The markup is the real hero and the real stat cards, not a
     placeholder: when the full data lands the route re-renders over it with the
     charts and the sections that need them. */
  function earlyOverview(h) {
    const c = h.counts;
    return `<div class="view" data-early="1">
      <section class="hero wrap">
        <div class="hero-inner">
          <div class="hero-flag">
            <img class="flag-ps" src="assets/flag-palestine.svg?v=89" alt="Flag of Palestine" fetchpriority="high">
            <span>Palestine</span>
          </div>
          <h1 data-hero-title>The Documented<span>Record</span></h1>
          <p class="hero-lede" data-hero-lede>${esc(h.title)}. Every heading, paragraph, table and citation of the
            source report, rendered as an interactive archive — with daily casualty data plotted month by month
            across Gaza and the West Bank.</p>
          <div class="hero-meta" data-hero-meta>
            <span><b>${fmt(c.words)}</b> words</span>
            <span><b>${c.parts}</b> parts · <b>${c.sections}</b> sections</span>
            <span><b>${c.tables}</b> tables</span>
            <span><b>${c.timeline}</b> chronology entries</span>
            <span><b>${c.bibliography}</b> sources</span>
            <span>Data to <b>${esc(h.meta.data_to)}</b></span>
          </div>
          <div class="hero-cta" data-hero-cta>
            <a class="btn primary" href="#/tour/1">Start here</a>
            <a class="btn" href="#/data">Explore the data</a>
            <a class="btn" href="#/evidence">Read the full record</a>
            <a class="btn" href="#/rebuttals">Answer the arguments</a>
          </div>
        </div>
      </section>

      <section class="section wrap">
        ${head('The headline figures', 'What the record establishes', 'Figures as recorded in the report and corroborated by the Tech For Palestine open datasets compiled from Gaza Ministry of Health, OCHA and UN reporting.')}
        <div class="grid c4">
          ${h.headline.map((x, i) => statCard(x, ['red', 'amber', 'red', '', 'red', 'amber', '', 'blue'][i] || '')).join('')}
        </div>
        <p class="chart-note" style="margin-top:18px">The charts and the rest of the record are still loading.</p>
      </section>
    </div>`;
  }

  /* ---------- data ---------- */

  /* ---------- data route ---------- */

  /* Forty-odd charts on one page was a scroll of sixty screens, and every
     chart was built whether or not anyone ever saw it. The route is split
     into chapters: each renders, and initialises, only its own charts. */
  const DATA_CHAPTERS = [
    { id: 'gaza', label: 'Gaza' },
    { id: 'asymmetry', label: 'The asymmetry' },
    { id: 'since-1948', label: 'Since 1948' },
    { id: 'complicity', label: 'Complicity' },
    { id: 'land', label: 'The land' },
    { id: 'west-bank', label: 'West Bank' },
    { id: 'wars', label: 'Wars & 7 October' },
    { id: 'world', label: 'The world' },
    { id: 'tables', label: 'Source tables' },
  ];

  function dataNav(active) {
    return `<nav class="subnav" aria-label="Data chapters">
      ${DATA_CHAPTERS.map((c) => `<a href="#/data/${c.id}"${c.id === active ? ' class="active" aria-current="page"' : ''}>${esc(c.label)}</a>`).join('')}
    </nav>`;
  }

  const DATA_BODY = {};

  DATA_BODY['gaza'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `
      <section class="section">
        ${head('Data', 'Every figure in the record, plotted', 'Charts are drawn from two sources: the report\'s own cited figures, and the Tech For Palestine open datasets (public domain) which compile Gaza Ministry of Health, OCHA and UN daily reporting. Where both exist they corroborate one another.')}
        <div class="grid c4">${f.headline.map((x, i) => statCard(x, ['red', 'amber', 'red', '', 'red', 'amber', '', 'blue'][i])).join('')}</div>
      </section>

      <section class="section">
        ${head('Gaza', 'The killing over time',
          `The ceasefire of 11 October 2025 is drawn on every series here. Press <b>events</b> on any chart that
           offers it to mark the other ${D.events.events.length} dated turning points: the siege order, the four
           rulings of the International Court of Justice, the arrest warrants, the Flour Massacre and the Rafah tent
           camp, the total blockade, the famine declaration, the two genocide findings of the Commission of Inquiry,
           and the closure of the last crossings. Each marker names the event in its tooltip. Nothing is marked that
           the report does not date.`)}
        <div class="grid">
          ${chartCard('gaza-monthly', 'Killed per month, October 2023 – September 2026', 'All recorded deaths, with the child share overlaid.', 'Tech For Palestine', 'tall')}
          ${chartCard('gaza-cumulative', 'Cumulative toll by protected category', 'Children, women, medical personnel and journalists against the total.', '§6.3', 'tall')}
          ${chartCard('deaths-3d', 'Month × category × territory', 'Drag to rotate. Gaza and the West Bank on one 36-month axis.', 'Tech For Palestine', 'xtall')}
        </div>
      </section>

      <section class="section">
        ${head('Day by day', 'The same record at full resolution',
          `The monthly charts above collapse ${fmt(D.ts.daily.gaza.dates.length)} daily reports into ${D.ts.gaza.monthly_killed.months.length} bars.
           These two plot every reporting day published between ${esc(D.ts.daily.gaza.dates[0])} and ${esc(D.ts.daily.gaza.dates[D.ts.daily.gaza.dates.length - 1])}.
           Drag the slider beneath either chart to zoom into a period.`)}
        <div class="grid">
          ${chartCard('daily-toll', 'Cumulative deaths, every reporting day', 'Total, children, and people killed while seeking aid, on one axis.', 'Tech For Palestine', 'tall')}
          ${chartCard('daily-rate', 'Deaths added to the register each day', 'Bars are the figure reported that day; the amber line is the trailing seven-day mean. Reporting gaps appear as clusters, not as pauses in the killing.', 'Tech For Palestine', 'tall')}
        </div>
      </section>

      ${ceasefireSection('')}

      ${D.ts.demographics ? `<section class="section">
        ${head('Who the dead are', 'Age and sex of the identified dead',
          `Not a model and not an estimate: the Gaza Ministry of Health names list, ${fmt(D.ts.demographics.total_records)} individual
           identification records, each with a name, an identity number, a date of birth and a sex. Of those,
           <b>${fmt(D.ts.demographics.under_18)}</b> were under eighteen and ${fmt(D.ts.demographics.unknown_age)} carry no usable age.
           This is the dataset that makes the claim of an overwhelmingly combatant death toll checkable, and it does not survive the check.`)}
        <div class="grid c2">
          ${chartCard('age-pyramid', 'Identified dead by age band and sex', 'Male to the left, female to the right, on a shared age axis. Records without a recorded sex are excluded from this chart but counted in the totals.', 'Gaza MoH names list', 'tall')}
          ${chartCard('child-ages', 'The children, by single year of age', 'Each bar is one year of age at death, from infants at zero to seventeen-year-olds.', 'Gaza MoH names list', 'tall')}
        </div>
        <div class="grid c4" style="margin-top:22px">
          ${[
            { label: 'Named and identified', value: D.ts.demographics.total_records, note: 'individual records, each with name, ID number and date of birth', source: 'Gaza MoH' },
            { label: 'Under eighteen', value: D.ts.demographics.under_18, note: Math.round(1000 * D.ts.demographics.under_18 / D.ts.demographics.total_records) / 10 + '% of the named dead', source: 'Gaza MoH' },
            { label: 'Female', value: D.ts.demographics.sex.f, note: Math.round(1000 * D.ts.demographics.sex.f / D.ts.demographics.total_records) / 10 + '% of the named dead', source: 'Gaza MoH' },
            { label: 'Male, all ages', value: D.ts.demographics.sex.m, note: 'includes every boy under eighteen, not only men of fighting age', source: 'Gaza MoH' },
          ].map((x, i) => statCard(x, ['', 'amber', 'blue', ''][i])).join('')}
        </div>
        <p class="chart-note" style="margin-top:16px">${esc(D.ts.demographics.source)}. The named list is narrower than the
          Ministry's aggregate death toll of ${fmt(D.ts.summary.killed.total)}: it contains only those whose identification has been
          completed and published, so it lags the total and excludes the dead still under rubble entirely.</p>
      </section>` : ''}

      <section class="section">
        ${head('Heat maps', 'The war at a glance, and at full density',
          `Two views of the same ${fmt(D.ts.daily.gaza.dates.length)} reporting days. The calendar plots the figure published on each
           individual day; the matrix plots every category the Ministry counts separately, month by month, each row scaled to
           its own worst month so that a row with tens of deaths is readable beside a row with thousands.`)}
        ${chartCard('calendar-heat', 'Every day of the war', 'One cell per day. Colour is the number added to the register that day. A pale cell is a day on which no update was published, not a day on which nobody was killed.', 'Tech For Palestine', 'xtall')}
        <div class="grid" style="margin-top:22px">
          ${chartCard('harm-heat', 'Month by category', 'Each row is scaled to its own worst month. Hover for the actual figure.', 'Tech For Palestine', 'tall')}
        </div>
      </section>

      <section class="section">
        ${head('Starvation and the aid queues', 'Two categories the daily record counts separately',
          'Israel controls every crossing into Gaza. These two series track what that control produced: deaths recorded as caused by famine or malnutrition, and people killed or wounded at the points where food was being distributed.')}
        <div class="grid c2">
          ${chartCard('famine-deaths', 'Deaths from starvation and malnutrition', 'Cumulative, stepped at each reporting date. The amber line is the child share of the same count.', 'Gaza MoH', 'tall')}
          ${chartCard('aid-seekers', 'Casualties among people seeking aid', 'Bars: killed that month. Lines: cumulative killed and cumulative injured, on the right-hand axis.', 'Gaza MoH / OCHA', 'tall')}
        </div>
        <div class="grid c4" style="margin-top:22px">
          ${[
            { label: 'Dead of starvation', value: last(D.ts.gaza.cumulative_famine), note: 'recorded as famine or malnutrition deaths', source: 'Gaza MoH' },
            { label: 'of whom children', value: last(D.ts.gaza.cumulative_child_famine), note: 'deaths from a cause that requires no weapon', source: 'Gaza MoH' },
            { label: 'Aid seekers killed', value: last(D.ts.gaza.cumulative_aid_seekers_killed), note: 'killed at or near distribution points', source: 'Gaza MoH / OCHA' },
            { label: 'Aid seekers injured', value: last(D.ts.gaza.cumulative_aid_seekers_injured), note: 'wounded at or near distribution points', source: 'Gaza MoH / OCHA' },
          ].map((x, i) => statCard(x, ['red', 'amber', 'red', ''][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The siege, administered', 'What was required, and what was allowed to cross', D.conduct.aid.lede)}
        <div class="grid c2">
          ${chartCard('aid-trucks', D.conduct.aid.title, esc('The dashed line is the requirement. The zero bar is the total blockade imposed on 2 March 2025: it draws nothing because nothing crossed. The ceasefire figures are a daily average across April and May 2026.'), esc(D.conduct.aid.ref), 'tall')}
          ${chartCard('hunger-risk', D.conduct.hunger.title, esc('Amber: the May 2025 IPC assessment. Red: the projection through mid-2026. The dashed amber outline marks the one starting figure that is derived rather than published — the report gives the 2026 caseload and states it has doubled, which fixes the earlier one.'), esc(D.conduct.hunger.ref), 'tall')}
        </div>
        <div class="grid c4" style="margin-top:22px">
          ${[
            { label: 'Required each day', value: 500, note: 'trucks, the minimum for 2.1 million people and the rate before October 2023', source: 'UN OCHA' },
            { label: 'Allowed under the ceasefire', value: '80–120', note: 'a day, of which 10 to 15 carried medical supplies', source: 'UN OCHA, April–May 2026' },
            { label: 'Of expected aid actually crossing', value: 35, unit: '%', note: 'and 36 per cent of permitted travellers', source: 'Human Rights Watch, 19 May 2026' },
            { label: 'Below six litres of water a day', value: 49, unit: '%', note: 'the emergency minimum, 17 August to 5 September 2025', source: 'HRW World Report 2026' },
          ].map((x, i) => statCard(x, ['', 'amber', 'red', 'red'][i])).join('')}
        </div>
        <p class="chart-note" style="margin-top:18px">${esc(D.conduct.aid.notes[1])}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.conduct.hunger.notes[0])}</p>
        <div style="margin-top:22px">
          ${chartCard('gaza-ipc-map', 'The famine, governorate by governorate',
            'Drag the slider, or press play, to step through the three IPC rounds published since the famine was confirmed. A grey governorate is one the IPC did not classify in that round — hover it for the reason it gives. '
            + 'These are the areas civilians were ordered into, which is what makes the map an answer to the evacuation-warning defence: the warnings moved the population south, and the south is where Famine was then confirmed.',
            'IPC Famine Review Committee, 22 August 2025, 19 December 2025 and 2026; boundaries from the OCHA Common Operational Dataset', 'xtall')}
        </div>
        <ul style="margin-top:16px">
          <li class="lvl0">An IPC area classification is the condition of an area as a whole. A governorate in Phase 3 contains households in Phase 4 and Phase 5: the area phase is a floor on the worst conditions inside it, not a ceiling.</li>
          <li class="lvl0">The deaths are not drawn on this map. The Ministry of Health does not publish the Gaza toll by governorate and no other body publishes a breakdown of it, so there is nothing to map and nothing has been estimated in its place. OCHA’s evacuation-order polygons are likewise not held in this repository and have not been approximated.</li>
        </ul>
      </section>

      <section class="section">
        ${head('What is left', 'Appendix E, drawn', D.conduct.remains.lede)}
        <div class="grid">
          ${chartCard('gaza-remains', D.conduct.remains.title, esc('Each bar is a category of Gaza’s civilian infrastructure, shown as the proportion destroyed or damaged against the proportion that remains. A tilde marks a figure the sources give as approximate.'), esc(D.conduct.remains.ref), 'xtall')}
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${D.conduct.remains.functioning.map((x, i) => statCard({
            label: x.label, value: x.value, suffix: ' of ' + x.of,
            note: (x.note ? x.note + ' ' : '') + 'As of ' + x.as_of + '.',
            source: x.source || 'UN OCHA',
          }, ['red', 'red', 'amber'][i])).join('')}
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${D.conduct.remains.heritage.map((x) => statCard({
            label: x.label, value: x.value, note: x.note || '', source: 'UNESCO; PCHR',
          }, 'violet')).join('')}
        </div>
        <p class="chart-note" style="margin-top:18px">${esc(D.conduct.remains.notes[1])}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.conduct.remains.notes[2])}</p>
      </section>

      <section class="section">
        ${head('Counting the dead', 'Competing estimates and protected persons', esc(f.gaza_toll_estimates.subtitle))}
        <div class="grid c2">
          ${chartCard('estimates', f.gaza_toll_estimates.title, 'Blue: identified-body counts. Amber: peer-reviewed. Violet: modelled, including indirect deaths.', f.gaza_toll_estimates.ref, 'tall')}
          ${chartCard('protected', f.protected_categories.title, esc(f.protected_categories.subtitle), f.protected_categories.ref, 'tall')}
        </div>
      </section>

      <section class="section">
        ${head('The true toll', 'Every recorded figure is a floor, not a ceiling', esc(D.history.true_toll.lede))}
        <div class="grid">
          ${chartCard('true-toll', 'Recorded deaths against independent estimates', 'Grey: contemporaneous counts of identified bodies. Red: independent estimates over the same period.', 'The Lancet; MPIDR', 'tall')}
          ${chartCard('missing-toll', 'Not in the count at all', 'Log scale. The dead under rubble are excluded by definition: the register records bodies received.', 'Civil Defence; UNICEF', 'tall')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('recovery-lag', 'The register catching up with itself', 'Deaths added to the count long after the strike that caused them: bodies recovered from rubble, and people who died later of their wounds. Every bar here is a death that was uncounted at the time it was reported.', 'Gaza MoH', 'tall')}
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${[
            { label: 'Undercount, capture–recapture', value: 41, unit: '%', note: 'The Lancet, January 2025 — traumatic-injury deaths only, to 30 June 2024', source: 'The Lancet' },
            { label: 'Undercount, household survey', value: 35, unit: '%', note: 'Gaza Mortality Survey — an independent method reaching the same conclusion', source: 'Lancet Global Health' },
            { label: 'Estimated total mortality', value: D.history.true_toll.indirect.total, note: '75,200 violent deaths plus 16,300 non-violent excess deaths, to 5 January 2025', source: 'Gaza Mortality Survey' },
          ].map((x, i) => statCard(x, ['red', 'red', 'amber'][i])).join('')}
        </div>
        <p class="chart-note" style="margin-top:18px">${esc(D.history.true_toll.indirect.note)}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.history.true_toll.significance)}</p>
      </section>`;
  };

  DATA_BODY['asymmetry'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('The asymmetry', 'Palestinians and Israelis killed, period by period', a.lede)}
        <div class="grid">
          ${chartCard('ratio-bars', 'Both sides of the ledger, every period for which both figures exist', 'Log scale, because on a linear axis the Israeli bars would be invisible — which is itself the finding. The label on each red bar is the ratio.', 'B’Tselem; OCHA; Israel NII', 'tall')}
          ${chartCard('ratio-trend', 'Palestinians killed for every Israeli killed', 'The dashed line is parity. The ratio narrows to 4:1 in the period of the suicide bombings and widens to ' + ratio(now) + ':1 in the current war.', 'Derived from the same sources', 'tall')}
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Period</th><th>Span</th><th>Palestinians killed</th><th>Israelis killed</th><th>Ratio</th><th>Source</th></tr></thead>
            <tbody>${a.periods.map((x) => `<tr>
              <td><strong>${esc(x.label)}</strong><br><span class="small muted">${esc(x.note)}</span></td>
              <td>${esc(x.span)}</td>
              <td><strong>${fmt(x.palestinian)}</strong></td>
              <td>${fmt(x.israeli)}</td>
              <td><strong>${ratio(x)}:1</strong></td>
              <td><span class="small">${esc(x.source)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${[
            { label: 'Palestinians killed per Israeli killed, now', value: ratio(now), suffix: ':1', note: 'since 7 October 2023', source: 'Gaza MoH / OCHA; Israeli Ministry of Defense' },
            { label: 'Palestinian children killed per Israeli child', value: Math.round(10 * a.children.palestinian / a.children.israeli) / 10, suffix: ':1', note: `${fmt(a.children.palestinian)} against ${fmt(a.children.israeli)}, cumulative to 2023`, source: esc(a.children.source) },
            { label: 'Palestinians injured per Israeli injured, 2008–2020', value: 20.5, suffix: ':1', note: '115,000 Palestinians against 5,600 Israelis — the injury ratio matches the fatality ratio', source: 'UN OCHA' },
          ].map((x, i) => statCard(x, ['red', 'amber', 'blue'][i])).join('')}
        </div>
        <ul style="margin-top:18px">${a.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>`;
  };

  DATA_BODY['since-1948'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Since 1948', 'Seventy-eight years of the death toll, and the holes in it', D.long.meta.lede)}
        <div class="grid">
          ${chartCard('long-toll', 'Palestinians killed, by documented period', 'Log scale. Amber: periods documented by a named organisation. Grey: an overlapping or partial series. Red: the current war. Violet, hatched: no organisation published a figure, so one is constructed here from adjacent counts — the arithmetic is set out in the table, and the estimate is never added to the documented running total.', 'See the table below', 'tall')}
          ${chartCard('long-cumulative', 'The documented running total, against the only cumulative figure that exists', 'Bars: deaths added in each period that can be counted without double counting. Amber line: the running total. Blue dashed line: the Palestinian Central Bureau of Statistics figure for the whole period since 1948.', 'PCBS, June 2024', 'tall')}
        </div>
        <p class="chart-note" style="margin-top:16px">${esc(D.long.meta.method)}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.long.meta.caution)}</p>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Period</th><th>Span</th><th>Palestinians killed</th><th>of whom children</th><th>Source and method</th></tr></thead>
            <tbody>${D.long.toll.periods.map((x) => `<tr>
              <td><strong>${esc(x.label)}</strong><br><span class="small muted">${esc(x.note)}</span></td>
              <td>${esc(x.span)}</td>
              <td>${x.killed === null
                ? (x.estimate ? '' : '<strong style="color:#d9a441">no figure exists</strong>')
                : `<strong>${fmt(x.killed)}</strong>${x.low ? `<br><span class="small muted">estimates ${fmt(x.low)}–${fmt(x.high)}</span>` : ''}${x.overlap ? '<br><span class="small muted">overlapping series, not added</span>' : ''}${x.partial ? '<br><span class="small muted">documented incidents only</span>' : ''}`}${x.estimate
                  ? `${x.killed === null ? '' : '<br>'}<strong style="color:#9b7fd4">~${fmt(x.estimate)}</strong> <span class="small muted">estimated</span>
                     <br><span class="small muted">range ${fmt(x.estimate_low)}–${fmt(x.estimate_high)}; ${x.killed === null ? 'no published figure' : 'beyond the documented figure'}, not added to the running total</span>`
                  : ''}</td>
              <td>${x.children === null || x.children === undefined ? '<span class="muted">—</span>' : fmt(x.children)}</td>
              <td><span class="small">${esc(x.source)}</span><br><span class="small muted">${esc(x.method)}</span>${x.estimate_basis ? `<br><span class="small" style="color:#9b7fd4">${esc(x.estimate_basis)}</span>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <p class="chart-note" style="margin-top:14px">${esc(D.long.toll.gaps_note)}</p>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:6px">${fmt(D.long.toll.anchor.value)} — ${esc(D.long.toll.anchor.label)}</h3>
          <p class="small muted" style="margin-bottom:12px">${esc(D.long.toll.anchor.source)}</p>
          <p class="small">${esc(D.long.toll.anchor.note)}</p>
        </div>
      </section>

      <section class="section">
        ${head('The accountability gap', 'What happens to a complaint', D.long.accountability.lede)}
        <div class="grid wide-left">
          ${chartCard('accountability-funnel', 'Complaints, investigations and indictments, 2016–2024', 'Every stage as a share of the complaints that started it.', 'Yesh Din', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The same funnel, four ways</h3>
            <div class="table-wrap"><table>
              <thead><tr><th>Period</th><th>Complaints</th><th>Investigated</th><th>Indicted</th></tr></thead>
              <tbody>${D.long.accountability.funnels.map((x) => `<tr>
                <td><strong>${esc(x.label)}</strong><br><span class="small muted">${esc(x.note)}</span></td>
                <td>${fmt(x.complaints)}</td>
                <td>${fmt(x.investigations)}<br><span class="small muted">${Math.round(1000 * x.investigations / x.complaints) / 10}%</span></td>
                <td><strong>${fmt(x.indictments)}</strong><br><span class="small muted">${Math.round(1000 * x.indictments / x.complaints) / 10}%</span></td>
              </tr>`).join('')}</tbody>
            </table></div>
          </div>
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${[
            { label: D.long.accountability.probability.label, value: D.long.accountability.probability.value, unit: '%', note: esc(D.long.accountability.probability.detail), source: esc(D.long.accountability.probability.source) },
            { label: 'Complaints that never reach an investigation', value: 77.3, unit: '%', note: '2016–2024: 1,875 of 2,427 closed without a criminal investigation being opened', source: 'Yesh Din' },
            { label: 'Indictments in nine years', value: D.long.accountability.funnels[0].indictments, note: 'against 2,427 complaints of soldiers killing or injuring Palestinians', source: 'Yesh Din' },
          ].map((x, i) => statCard(x, ['red', 'red', 'amber'][i])).join('')}
        </div>
        <ul style="margin-top:18px">${D.long.accountability.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Displacement and demolition', 'The continuous mechanism', D.long.dispossession.lede)}
        ${chartCard('dispossession', 'People displaced and structures demolished, 1948–2026', 'Log scale. Blue: people displaced. Amber: homes and structures demolished.', 'UN; UNRWA; ICAHD; Land Research Center', 'tall')}
        <div class="grid c3" style="margin-top:22px">
          ${D.long.dispossession.displacement.slice(0, 3).map((x, i) => statCard({ label: x.label, value: x.value, suffix: x.suffix, note: esc(x.note), source: esc(x.source), ref: x.period }, ['red', 'amber', ''][i])).join('')}
        </div>
        <ul style="margin-top:18px">${D.long.dispossession.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Mass detention', 'Since 1967, without charge', D.long.detention.lede)}
        <div class="grid wide-left">
          ${chartCard('detention-series', 'Palestinians held in administrative detention, at each documented snapshot', 'Detention without charge, without trial, and on evidence the detainee may not see. The orders are renewable without limit.', 'Addameer', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The three laws</h3>
            <div class="table-wrap"><table><tbody>
              ${D.long.detention.legal.map((x) => `<tr><td><strong>${esc(x.instrument)}</strong><br><span class="small muted">${esc(x.applies)}</span><br><span class="small">${esc(x.effect)}</span></td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${[
            { label: esc(D.long.detention.cumulative.label), value: D.long.detention.cumulative.value, suffix: D.long.detention.cumulative.suffix, note: 'roughly 20% of the population of the occupied territory, and up to 40% of all Palestinian males', source: esc(D.long.detention.cumulative.source) },
            { label: 'Political prisoners, October 2025', value: 11100, suffix: '+', note: 'the highest total since the Second Intifada began in 2000, excluding army-run military camps', source: 'Addameer' },
            { label: 'Israeli settlers ever held in administrative detention', value: 9, note: 'over the entire history of the power, against more than 800,000 Palestinian detentions', source: 'Addameer' },
          ].map((x, i) => statCard(x, ['red', 'amber', 'blue'][i])).join('')}
        </div>
        <ul style="margin-top:18px">${D.long.detention.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>`;
  };

  DATA_BODY['complicity'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Complicity', 'Who supplies the war', D.long.complicity.lede)}
        <div class="grid wide-left">
          ${chartCard('arms-suppliers', 'Where Israel\'s major arms imports come from, ' + esc(D.long.complicity.suppliers.period), 'Share of major conventional arms deliveries. Two states account for ninety-nine per cent of them.', 'SIPRI', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The three suppliers</h3>
            <div class="table-wrap"><table><tbody>
              ${D.long.complicity.suppliers.items.map((x) => `<tr><td><strong>${esc(x.country)}</strong> — ${x.share}%<br><span class="small">${esc(x.note)}</span></td></tr>`).join('')}
            </tbody></table></div>
            <p class="chart-note" style="margin-top:14px">${esc(D.long.complicity.suppliers.note)}</p>
          </div>
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('us-aid', 'United States bilateral aid to Israel, cumulative', 'Each bar is a published cumulative total at the date stated. The last bar is the same aid adjusted for inflation, which is the honest comparison across eighty years.', 'Congressional Research Service; Costs of War', 'tall')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('us-aid-flows', 'The annual flows, and the war supplementals', 'The 2016 Memorandum of Understanding fixed $3.8 billion a year to 2028. The war added more in one year than the Memorandum provides in four.', 'Congressional Research Service; Public Law 118-50', '')}
        </div>
        <div class="grid c4" style="margin-top:22px">
          ${D.long.complicity.us_aid.cumulative.map((x, i) => statCard({ label: x.label, value: x.value, unit: 'bn', suffix: '$', source: esc(x.source) }, ['', '', 'red', 'amber'][i])).join('')}
        </div>
        <ul style="margin-top:18px">${D.long.complicity.us_aid.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The suppliers\' own numbers', 'What each government authorised, and when', D.war.arms.lede)}
        <div class="grid">
          ${chartCard('arms-germany', D.war.arms.germany.title,
            `The bar for 2022 is derived from the report's "tenfold increase" wording rather than separately published, and is drawn dashed for that reason. The 2026 bar is half a year. ${esc(D.war.arms.germany.embargo.detail)}`,
            D.war.arms.germany.ref, 'tall')}
        </div>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:14px">What the €800 million bought</h3>
          <div class="table-wrap"><table><tbody>
            ${D.war.arms.germany.composition.map((x) => `<tr>
              <td style="white-space:nowrap"><strong>~${x.share}%</strong></td>
              <td>${esc(x.label)}<br><span class="small">${esc(x.note)}</span></td>
            </tr>`).join('')}
          </tbody></table></div>
          <p class="chart-note" style="margin-top:14px">${esc(D.war.arms.germany.source)}</p>
        </div>
        <ul style="margin-top:18px">${D.war.arms.germany.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
        <div class="grid" style="margin-top:22px">
          ${chartCard('arms-us', D.war.arms.us.title,
            'The bars are separate announcements and standing case values; they overlap in scope and do not sum. The two dashed lines are the published totals: what Congress enacted, and what the Costs of War project counts including transfers, foreign military sales and emergency authority.',
            D.war.arms.us.ref, 'tall')}
        </div>
        <div class="grid c2" style="margin-top:22px">
          ${D.war.arms.us.totals.map((x, i) => statCard({ label: x.label, value: x.value, unit: 'bn', suffix: '$', source: x.source }, i === 0 ? 'amber' : 'red')).join('')}
        </div>
        <div class="grid wide-left" style="margin-top:22px">
          ${chartCard('arms-uk', D.war.arms.uk.title,
            esc(D.war.arms.uk.licences.note), D.war.arms.uk.ref, '')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">What the suspension left untouched</h3>
            <div class="table-wrap"><table><tbody>
              ${D.war.arms.uk.facts.map((x) => `<tr><td><strong>${fmt(x.value)}${esc(x.unit || '')}</strong> — ${esc(x.label)}<br><span class="small">${esc(x.note)}</span></td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
        <ul style="margin-top:18px">${D.war.arms.uk.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The embargo tracker', 'Who has stopped, and who has not', D.long.complicity.embargo.lede)}
        ${chartCard('embargo-tracker', 'Arms transfer restrictions by state, since October 2023', 'Green: halted. Amber: partial or court-ordered. Red: continuing without restriction. Hover for the measure and its date.', 'National export-licensing records; court judgments', 'tall')}
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>State</th><th>Status</th><th>Date</th><th>Measure</th></tr></thead>
            <tbody>${D.long.complicity.embargo.countries.map((x) => `<tr>
              <td><strong>${esc(x.country)}</strong></td>
              <td><span class="chip static ${x.status}">${esc(x.status)}</span></td>
              <td>${esc(x.date)}</td>
              <td><span class="small">${esc(x.detail)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <ul style="margin-top:18px">${D.long.complicity.embargo.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Divestment', 'The settlement-business database, and what has moved', D.long.divestment.lede)}
        <div class="grid wide-left">
          ${chartCard('settlement-business', 'Businesses listed by the United Nations as operating in the settlements', 'Three releases in five years. The 2023 fall is not a reprieve: fifteen entities were removed because they stopped.', 'OHCHR, HRC resolution 31/36', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">What listing means</h3>
            <p class="small" style="margin-bottom:12px">${esc(D.long.divestment.database.note)}</p>
            <p class="small muted">${esc(D.long.divestment.database.source)}</p>
          </div>
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Institution</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>${D.long.divestment.movements.map((x) => `<tr>
              <td><strong>${esc(x.label)}</strong></td><td>${esc(x.date)}</td>
              <td><span class="small">${esc(x.detail)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <ul style="margin-top:18px">${D.long.divestment.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The veto wall', 'One state against fourteen', D.long.vetoes.lede)}
        ${chartCard('un-vetoes', 'Security Council drafts blocked since 7 October 2023', 'Each bar is the whole Council: green voted for, grey abstained, red is the single vote that stopped it.', 'UN Security Council records', 'tall')}
        <div class="grid c3" style="margin-top:22px">
          ${D.long.vetoes.counts.map((x, i) => statCard({ label: x.label, value: x.value, unit: x.unit, note: esc(x.note) }, ['red', 'amber', 'red'][i])).join('')}
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Draft resolution</th><th>For</th><th>Abstained</th><th>Against</th></tr></thead>
            <tbody>${D.long.vetoes.war.map((x) => `<tr>
              <td><strong>${esc(x.date)}</strong></td>
              <td><span class="small">${esc(x.draft)}</span></td>
              <td><strong>${x.for}</strong></td><td>${x.abstain}</td>
              <td><strong style="color:#d2534c">${x.against} — United States</strong></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:14px">Before the war</h3>
          <div class="table-wrap"><table><tbody>
            ${D.long.vetoes.landmarks.map((x) => `<tr><td style="white-space:nowrap"><strong>${esc(x.date)}</strong></td><td><span class="small">${esc(x.detail)}</span></td></tr>`).join('')}
          </tbody></table></div>
        </div>
        <ul style="margin-top:18px">${D.long.vetoes.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Recognition', 'Thirty-seven years in one direction', D.long.recognition.lede)}
        ${chartCard('recognition-timeline', 'UN member states recognising the State of Palestine, 1988–2026', 'A step line: each step is a documented wave of recognitions. The dashed line is all 193 member states.', 'UN records; national declarations', 'tall')}
        <div class="grid c3" style="margin-top:22px">
          ${D.long.recognition.standing.map((x, i) => statCard({ label: x.label, value: x.value, note: 'of ' + x.of + ' states' }, ['amber', 'red', 'blue'][i])).join('')}
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Year</th><th>Milestone</th><th>States recognising</th><th>What happened</th></tr></thead>
            <tbody>${D.long.recognition.timeline.map((x) => `<tr>
              <td><strong>${x.year}</strong></td><td>${esc(x.label)}</td>
              <td><strong>${x.value}</strong></td><td><span class="small">${esc(x.note)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <p class="chart-note" style="margin-top:16px">${esc(D.long.recognition.holdouts)}</p>
        <ul style="margin-top:18px">${D.long.recognition.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>`;
  };

  DATA_BODY['land'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Where the land went', 'Six per cent to seventy-eight, and four per cent back', D.long.land.lede)}
        ${chartCard('land-control', 'Mandatory Palestine, by who controls it', 'Every bar is the same territory — about 26,320 square kilometres — at five dates. Red: Israeli or Jewish control. Green: Palestinian. Grey and violet: Jordanian and Egyptian administration, 1949–1967.', 'Survey of Palestine; UNGA 181; Oslo II', 'tall')}
        <div style="margin-top:22px">
          ${chartCard('land-map', 'The same territory, on the ground',
            'Drag the slider, or press play, to step through the four dates the geometry can carry. The 1947 partition plan and the Oslo Areas A, B and C are deliberately not drawn: no sourced polygon for either is held here, and their shares are in the chart above and the table below. The base map is Natural Earth, a cartographic base and not an adjudication of any boundary.',
            'Natural Earth; Survey of Palestine; Oslo II Interim Agreement', 'xtall')}
        </div>
        <div class="grid wide-left" style="margin-top:22px">
          ${chartCard('land-areas', 'The West Bank under Oslo II, thirty-one years on', 'A five-year interim arrangement signed in September 1995. Area C, under full Israeli control, holds every settlement, the Jordan Valley and the aquifers.', 'Oslo II Interim Agreement, Annex I', 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Areas A, B and C</h3>
            <div class="table-wrap"><table><tbody>
              ${D.long.land.areas.map((x) => `<tr><td><strong>${esc(x.label)}</strong> — ${x.value}% of the West Bank<br><span class="small muted">${esc(x.control)}</span><br><span class="small">${esc(x.note)}</span></td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${D.long.land.settlements.map((x, i) => statCard({ label: x.label, value: x.value, unit: x.unit === '%' ? '%' : '', suffix: x.unit === 'km²' ? ' km²' : '', note: esc(x.note), source: esc(x.source || 'B’Tselem; OCHA') }, ['amber', 'red', 'red'][i])).join('')}
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Who held what</th><th>What happened</th></tr></thead>
            <tbody>${D.long.land.control.map((x) => `<tr>
              <td><strong>${esc(x.label)}</strong><br><span class="small muted">${esc(x.sub)}</span></td>
              <td>${x.segments.map((s) => `${esc(s.name)} <strong>${s.value}%</strong>`).join('<br>')}</td>
              <td><span class="small">${esc(x.note)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <ul style="margin-top:18px">${D.long.land.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('1948', 'The Nakba, quantified', '')}
        <div class="grid wide-left">
          ${chartCard('nakba', f.nakba.title, 'Log scale.', f.nakba.ref, 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The figures in full</h3>
            <div class="table-wrap"><table><tbody>
              ${f.nakba.items.map((x) => `<tr><td>${esc(x.label)}${x.note ? `<br><span class="small muted">${esc(x.note)}</span>` : ''}</td><td style="text-align:right"><strong>${fmt(x.value)}${x.suffix || ''}${x.unit || ''}</strong></td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
      </section>

      <section class="section">
        ${head('1947–1950', 'The villages, one by one',
          'The aggregate above is the sum of a list. Abu Sitta’s <em>Atlas of Palestine 1917–1966</em> records every town and village emptied of its Arab population, '
          + 'with the date, the population it held, the land it held, the Israeli operation it fell to, whether a massacre is recorded there, and what stands on the site now. '
          + 'Four hundred and fifty-six of those rows are drawn here, four hundred and thirty-eight of them on the map.')}
        ${chartCard('nakba-map', 'Every village emptied, in the month it was emptied',
          'Drag the slider, or press play, to move through the seventeen months in which the atlas records a depopulation, from December 1947 to June 1950. Dots accumulate: what is on screen is everything emptied up to that month, '
          + 'and the white rings are the places emptied in the month itself. Size is the 1948 population. Hover any dot for the village’s own record. '
          + 'The sand outline is Mandatory Palestine; the faint lines inside it are the modern boundaries, drawn only to orient a reader who knows the present map.',
          'Salman Abu Sitta, Atlas of Palestine 1917–1966, pp. 108–115', 'xtall')}
        <div class="grid" style="margin-top:22px">
          ${chartCard('nakba-months', 'The pace of it: villages emptied each month',
            'Red bars are months in which the atlas records a massacre at one or more of the villages emptied. Two thirds of the whole list falls in April, May and July 1948. '
            + 'A month with no bar is a month in which the atlas records no depopulation.',
            'Abu Sitta, Atlas of Palestine; Plan Dalet dated from the Haganah archive', 'tall')}
        </div>
        <div class="grid c2" style="margin-top:22px">
          ${chartCard('nakba-subdistricts', 'Which sub-districts were emptied',
            'The fourteen Mandate sub-districts, by the number of towns and villages depopulated in each. The label gives the villages and the people.',
            'Abu Sitta, Atlas of Palestine', 'tall')}
          ${chartCard('nakba-fate', 'What stands on the sites now',
            'The atlas records the state of each site at the time of survey. “Rubble” and “no trace” together account for nearly half of the list. '
            + 'The violet bars are sites where Jewish families were recorded living among or on the remains.',
            'Abu Sitta, Atlas of Palestine', 'tall')}
        </div>
        <ul style="margin-top:18px">
          <li class="lvl0">The list is the atlas’s own and is not exhaustive of the Nakba: it counts towns and villages, so the Bedouin encampments of the Naqab and the emptied urban quarters are not separate rows. Other scholarly counts — Khalidi’s <em>All That Remains</em>, Zochrot’s register — run higher, to around 530.</li>
          <li class="lvl0">A village is counted as a massacre site only where the atlas uses that word against it, forty-nine of the four hundred and fifty-six. A further twenty-three are recorded as the site of an atrocity, which is the atlas’s own separate term. The absence of a record is not evidence that nothing happened.</li>
          <li class="lvl0">Eighteen villages carry no coordinates in the transcription and so appear in the charts but not on the map. The population and land figures are those of 1948, before depopulation, and the totals the rows reproduce — 804,514 people and 17,124,301 dunams — are within four thousandths of one per cent of the table’s own stated totals.</li>
        </ul>
      </section>

      <section class="section">
        ${head('1948–1953', 'The legal machinery of transfer', 'The expulsions removed the population. A separate body of peacetime legislation, enacted by a parliament and upheld by courts, converted the vacancy into permanent title. The Absentees’ Property Law is in force in 2026.')}
        <div class="grid wide-left">
          ${chartCard('land-transfer', f.land_transfer.title, 'Log scale. Dunams.', f.land_transfer.ref, 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The four statutes</h3>
            <div class="table-wrap"><table><tbody>
              ${f.land_transfer.statutes.map((s) => `<tr><td><strong>${esc(s.name)}</strong><br><span class="small muted">${esc(s.date)}</span><br><span class="small">${esc(s.effect)}</span></td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>
        <div class="grid wide-left" style="margin-top:20px">
          ${chartCard('jnf-growth', 'Jewish National Fund holdings: fifty years of purchase, two years of statute', 'Cumulative. The 1941 baseline was acquired on the open market over five decades; the 1949 and 1950 tranches were refugee land conveyed by the Development Authority.', f.land_transfer.ref, '')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">How it worked</h3>
            ${f.land_transfer.notes.map((n) => `<p class="small" style="margin-bottom:10px">${esc(n)}</p>`).join('')}
          </div>
        </div>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:6px">The Israeli Supreme Court, ${esc(f.land_transfer.supreme_court_2015.date)}</h3>
          <p class="small muted" style="margin-bottom:12px">${esc(f.land_transfer.supreme_court_2015.case)} · ${esc(f.land_transfer.supreme_court_2015.bench)}</p>
          <p class="small" style="margin-bottom:10px">${esc(f.land_transfer.supreme_court_2015.holding)}</p>
          <p class="small" style="margin-bottom:10px">${esc(f.land_transfer.supreme_court_2015.grunis_note)}</p>
          <blockquote class="small" style="margin:0">${esc(f.land_transfer.supreme_court_2015.adalah_response)}<br><span class="muted">— Adalah, the Legal Centre for Arab Minority Rights in Israel</span></blockquote>
        </div>
      </section>

      <section class="section">
        ${head('Settlements', 'The enterprise, in numbers', 'The current coalition has approved more settlements than the entire thirty years of the Oslo process.')}
        <div class="grid wide-left">
          ${chartCard('settlements', 'Settlements approved: Oslo era vs current coalition', '', f.settlements.ref, '')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Settler population</h3>
            <div class="grid">${f.settlements.population.map((x) => statCard(Object.assign({ source: 'UN Human Rights Council, 2026', ref: f.settlements.ref }, x))).join('')}</div>
          </div>
        </div>
        <div style="margin-top:18px">${chartCard('settlement-detail', 'The settlement enterprise in detail', 'Log scale — the categories differ by orders of magnitude.', f.settlements.ref, 'tall')}</div>
      </section>`;
  };

  DATA_BODY['west-bank'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Before October 2023', 'History did not begin on 7 October', esc(D.history.meta.description))}
        <div class="grid wide-left">
          ${chartCard('wb-annual', 'Palestinians killed in the West Bank, by year', 'Amber: 2022, the record year on OCHA\'s series until it was broken. Red: 2023. The child share is overlaid on each bar.', 'OCHA; Tech For Palestine', 'tall')}
          ${chartCard('settler-rate', 'Settler incidents against Palestinians, per day', 'The daily average by year. OCHA excludes harassment, trespass and intimidation, so this understates it.', 'OCHA', 'tall')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('wb-before-after', '2023 in the West Bank, either side of 7 October', 'The pre-war period was already the deadliest on record. The bar labels give the killing rate per day.', 'OCHA', '')}
        </div>
        <div class="card" style="margin-top:18px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Year</th><th>Palestinians killed</th><th>of whom children</th><th>Source</th><th>Record</th></tr></thead>
            <tbody>${D.history.west_bank.years.map((y) => `<tr>
              <td><strong>${y.year}</strong></td><td><strong>${fmt(y.killed)}</strong></td>
              <td>${fmt(y.children)}</td><td>${esc(y.source)}</td><td>${esc(y.note)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <p class="chart-note" style="margin-top:14px">${esc(D.history.west_bank.record_note)} ${esc(D.history.before_after.significance)}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.history.settler_violence.displacement_note)} ${esc(D.history.meta.note)}</p>
      </section>

      <section class="section">
        ${head('The West Bank', 'Killings, child deaths and settler attacks', 'The West Bank series runs on the same monthly axis as Gaza. Settler attacks are plotted on the right-hand axis.')}
        <div class="grid">
          ${chartCard('west-bank', 'West Bank: killed and settler attacks per month', 'Bars: Palestinians killed, with the child share. Line: recorded settler attacks.', '§9.2', 'tall')}
          ${chartCard('locations', 'Gaza and the West Bank compared', 'Cumulative deaths in each territory on independent axes — the shapes, not the magnitudes, are the comparison.', '§9.2', 'tall')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('wb-displacement', 'Displacement in the West Bank', 'Cumulative people and children driven from their homes, with displaced households on the right-hand axis. Demolition, settler violence and military operations are counted together here, as OCHA records them.', 'OCHA', 'tall')}
        </div>
        <div class="grid c4" style="margin-top:22px">
          ${[
            { label: 'People displaced', value: last(D.ts.west_bank.cumulative_displaced), note: 'West Bank, since October 2023', source: 'OCHA' },
            { label: 'of whom children', value: last(D.ts.west_bank.cumulative_displaced_children), note: 'West Bank, since October 2023', source: 'OCHA' },
            { label: 'Households displaced', value: last(D.ts.west_bank.cumulative_displaced_households), note: 'each one a family home lost', source: 'OCHA' },
            { label: 'Children injured', value: last(D.ts.west_bank.cumulative_injured_children), note: 'West Bank, since October 2023', source: 'OCHA' },
          ].map((x, i) => statCard(x, ['red', 'amber', '', 'amber'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('Governorate by governorate', 'Where the settlers attack, and where the displacement lands',
          'OCHA records every settler incident and every displacement by governorate. Al Jazeera’s July 2026 analysis of that record published the three highest governorates for each — '
          + '3,033 attacks in the eighteen months from January 2025, of which Ramallah and el-Bireh alone accounted for 881. '
          + 'The governorates OCHA has not published separately are drawn unshaded rather than as zero: they are unreported, not unharmed.')}
        ${chartCard('wb-gov-map', 'Settler attacks and displacement, by governorate',
          'Two layers on one map: step the slider to move between them. Depth of colour is the figure against the highest published one. '
          + 'Eight of the eleven governorates carry no shading because no separate figure for them has been published, not because nothing was recorded there.',
          'OCHA, via Al Jazeera, 27 July 2026; boundaries from the OCHA Common Operational Dataset', 'xtall')}
        <div class="grid c2" style="margin-top:22px">
          ${chartCard('settler-annual', 'Recorded settler attacks, per year',
            'The 2026 bar is outlined rather than filled because it covers the first four months only: 761 attacks, an average of 190 a month against 153 a month in 2025, a rise of 24 per cent.',
            'OCHA, via Al Jazeera, 27 July 2026', 'tall')}
          ${chartCard('iron-wall', 'Operation Iron Wall: what is left of the three camps',
            'Share of structures destroyed or damaged by October 2025. The operation began on 21 January 2025. '
            + 'The UN Human Rights Office found in September 2026 that Israeli forces had displaced the entire population of these camps — more than 33,000 people — and continue to prevent their return, '
            + 'displacement it described as large-scale, long-term and systematic, raising concerns of the crime against humanity of forcible transfer. '
            + '102 Palestinians were killed in the operation, 21 of them children; 46 per cent of those killed were not taking part in hostilities.',
            'OHCHR, 4 September 2026', 'tall')}
        </div>
        <ul style="margin-top:18px">
          <li class="lvl0">The 1,114 Palestinians killed in the West Bank since October 2023 are not mapped by governorate. Neither OCHA nor the Ministry of Health publishes that breakdown, and no estimate of it has been substituted here.</li>
          <li class="lvl0">OCHA’s incident count excludes harassment, trespass and intimidation where no casualty or property damage results, so every figure on this map is a floor.</li>
          <li class="lvl0">Displaced Palestinians told the UN Human Rights Office that Israeli officers said there would be “no more refugee camps” and that they should “all go to Jordan”.</li>
        </ul>
      </section>

      <section class="section">
        ${head('Children in the military courts', 'The only state that does this systematically', D.conduct.children.lede)}
        <div class="grid wide-left">
          ${chartCard('child-detention', D.conduct.children.title, esc('One cohort of ' + fmt(D.conduct.children.cohort.total) + ' children, documented by Defence for Children International–Palestine over seven years, split by what happened after the arrest.'), esc(D.conduct.children.ref), '')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">What the monitors record</h3>
            <ul>${D.conduct.children.practices.map((x) => `<li class="lvl0">${esc(x)}</li>`).join('')}</ul>
            <p class="chart-note" style="margin-top:14px">Documented as torture and cruel, inhuman or degrading treatment under the ${esc(D.conduct.children.instruments.join('; the '))}.</p>
          </div>
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${statCard({ label: 'Children prosecuted in military courts each year', value: D.conduct.children.annual.display, note: D.conduct.children.annual.note, source: 'DCI-Palestine; UNICEF' }, 'red')}
          ${statCard({ label: 'Of the documented cohort, subjected to physical violence', value: D.conduct.children.cohort.violence_pct, unit: '%', note: D.conduct.children.cohort.note, source: 'DCI-Palestine, 2016–2022' }, 'red')}
          ${statCard({ label: 'Deaths in Israeli custody since October 2023', value: 98, note: 'At least. Physicians for Human Rights–Israel states this is likely an undercount.', source: 'Physicians for Human Rights–Israel, September 2026' }, 'red')}
        </div>
      </section>

      <section class="section">
        ${head('Deaths in custody', 'Every count is a floor set by a different body', D.conduct.custody.lede)}
        <div class="grid">
          ${chartCard('custody-deaths', D.conduct.custody.title, esc('The three red bars are death counts, each the floor established by the body named on it. The amber bar is not a death toll: it is the number of prison guards charged over one of those deaths, which is the whole of the prosecution record.'), esc(D.conduct.custody.ref), 'tall')}
        </div>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:10px">${esc(D.conduct.custody.prosecution.case)}</h3>
          <p class="chart-note">${esc(D.conduct.custody.prosecution.charge)}. ${esc(D.conduct.custody.prosecution.note)}</p>
          <p class="chart-note" style="margin-top:10px">${esc(D.conduct.custody.finding.body)}, ${esc(D.conduct.custody.finding.date)}: ${esc(D.conduct.custody.finding.detail)}</p>
        </div>
        <ul style="margin-top:18px">${D.conduct.custody.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>`;
  };

  DATA_BODY['wars'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Seventy-five years of operations', 'Each Gaza campaign, and what was found', '')}
        ${chartCard('wars', 'Palestinian deaths by military operation, 2008–2026', 'Log scale. Hover for the period, civilian proportion, and legal finding.', f.pre2023_wars.ref, 'tall')}
        <div class="card" style="margin-top:18px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Operation</th><th>Period</th><th>Palestinian deaths</th><th>Civilian share</th><th>Legal finding</th></tr></thead>
            <tbody>${f.pre2023_wars.items.map((w) => `<tr>
              <td><strong>${esc(w.operation)}</strong></td><td>${esc(w.period)}</td>
              <td><strong>${fmt(w.deaths)}</strong></td><td>~${w.civilian_pct}%</td><td>${esc(w.finding)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </section>

      <section class="section">
        ${head('7 October 2023', 'The verified breakdown', esc(o.subtitle))}
        <div class="grid wide-left">
          ${chartCard('oct7', o.title, esc(o.total_note), o.ref, 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Hostages</h3>
            <div class="grid">
              ${statCard({ label: 'Taken hostage on 7 October', value: o.hostages.taken, source: 'Israeli government figures', ref: o.ref })}
              ${statCard({ label: 'Living hostages at the ceasefire', value: o.hostages.living_at_ceasefire, source: 'Ceasefire terms, October 2025' })}
              ${statCard({ label: 'Sets of remains recovered', value: o.hostages.remains_recovered, source: 'Ceasefire terms, October 2025' })}
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        ${head('The Hannibal Directive', 'What Israeli fire did on 7 October', D.conduct.hannibal.lede)}
        <div class="grid">
          ${chartCard('hannibal', D.conduct.hannibal.title, esc('Every bar is a documented count from the Israeli record — Haaretz, Channel 12, the IDF’s own statement. The grey bar at nought is the number of autopsies establishing which weapon killed each victim.'), esc(D.conduct.hannibal.ref), 'tall')}
        </div>
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:10px">${esc(D.conduct.hannibal.unknown.label)}</h3>
          <p class="chart-note">${esc(D.conduct.hannibal.unknown.detail)} The National Insurance Institute puts the total at ${fmt(D.conduct.hannibal.toll.total)}: ${esc(D.conduct.hannibal.toll.note)}</p>
        </div>
        <ul style="margin-top:18px">${D.conduct.hannibal.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Before the attack', 'The policy of keeping Hamas funded', D.conduct.funding.lede)}
        <div class="grid wide-left">
          ${chartCard('qatar-funding', D.conduct.funding.title, esc('The bars are the documented monthly rate of $15 million annualised, not a published total; they are drawn dashed for that reason, and the 2023 bar is a part year. A pin marks a year in which something is on the record beyond the money.'), esc(D.conduct.funding.ref), 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The record, in order</h3>
            <ul>${D.conduct.funding.events.map((e) => `<li class="lvl0"><strong>${esc(String(e.year))}</strong> — ${esc(e.label)}<br><span class="small">${esc(e.detail)}</span></li>`).join('')}</ul>
          </div>
        </div>
        <p class="chart-note" style="margin-top:18px">${esc(D.conduct.funding.transfers.note)}</p>
        <p class="chart-note" style="margin-top:10px">${esc(D.conduct.funding.notes[0])}</p>
      </section>

      <section class="section">
        ${head('How the targets were chosen', 'Three systems, disclosed by the officers who operated them', D.conduct.targeting.lede)}
        <div class="grid wide-left">
          ${chartCard('ai-targeting', D.conduct.targeting.title, esc('Log scale. The four rows share one unit — human beings — which is why they can sit on one axis. The dashed bar is the error rate applied to the list size: both figures are the investigation’s, the multiplication is this dashboard’s.'), esc(D.conduct.targeting.ref), 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The three systems</h3>
            <ul>${D.conduct.targeting.systems.map((s) => `<li class="lvl0"><strong>${esc(s.name)}</strong> — ${esc(s.role)}<br><span class="small">${esc(s.detail)}</span></li>`).join('')}</ul>
            <p class="chart-note" style="margin-top:14px">${esc(D.conduct.targeting.review.note)}</p>
          </div>
        </div>
        <ul style="margin-top:18px">${D.conduct.targeting.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Human shields', 'Who investigated, and what each of them found', D.conduct.shields.lede)}
        ${chartCard('shields-matrix', D.conduct.shields.title, esc('One row per investigating body, one column per allegation. A blank cell means that body did not address that column in this record — not that it cleared the conduct. Hover for the finding.'), esc(D.conduct.shields.ref), 'xtall')}
        <div class="grid c4" style="margin-top:22px">
          ${D.conduct.shields.counts.map((x, i) => statCard({
            label: x.label, value: x.value, note: (x.atleast ? 'At least this many. ' : '') + (x.note || ''), source: 'See the matrix above',
          }, ['red', 'red', 'amber', 'amber'][i])).join('')}
        </div>
        <ul style="margin-top:18px">${D.conduct.shields.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Infrastructure', 'What was destroyed, and when', esc(f.infrastructure_report.subtitle))}
        <div class="grid">
          ${chartCard('infra-share', f.infrastructure_report.title, 'Share of each category destroyed or damaged, as recorded in the report.', f.infrastructure_report.ref, 'tall')}
          ${chartCard('infra-3d', 'Destruction accumulating month by month', 'Cumulative counts per category over 36 months. Drag to rotate.', 'Tech For Palestine', 'xtall')}
        </div>
        <div class="grid c3" style="margin-top:18px">
          ${f.infrastructure_report.heritage.map((x) => statCard(x, 'amber')).join('')}
        </div>
      </section>

      <section class="section">
        ${head('Siege, starvation and detention', 'Two further bodies of documented data', '')}
        <div class="grid c2">
          ${chartCard('starvation', f.starvation.title, 'Log scale.', f.starvation.ref, '')}
          ${chartCard('detention', f.detention.title, 'Log scale.', f.detention.ref, '')}
        </div>
      </section>

      <section class="section">
        ${head('Lebanon', 'Forty-four years of the same doctrine', D.war.lebanon.lede)}
        ${chartCard('lebanon-toll', 'Lebanese killed and injured, by episode, 1982–2026',
          'Log scale: the episodes run from 42 killed to 4,321, and a linear axis would flatten everything below the 2026 campaign. Hover for the date, the injured and displaced counts where they exist, and the finding.',
          D.war.lebanon.ref, 'tall')}
        <div class="grid c3" style="margin-top:22px">
          ${statCard({ label: 'Displaced by the 2024 campaign', value: 1200000, note: 'About a quarter of Lebanon\'s population', source: 'Lebanese health ministry, November 2024' }, 'amber')}
          ${statCard({ label: 'Injured by the pager and walkie-talkie attacks', value: 4000, suffix: '', unit: '+', note: 'Lost hands, lost eyes, shrapnel wounds. 42 killed, 12 of them civilians', source: 'Lebanese government, September 2024' }, 'red')}
          ${statCard({ label: D.war.lebanon.occupation.label, value: D.war.lebanon.occupation.value, unit: ' km', note: D.war.lebanon.occupation.note, source: 'Israeli Ministry of Defence statements, April–May 2026' }, 'red')}
        </div>
        <div class="card" style="margin-top:20px;padding:0;overflow:hidden">
          <div class="table-wrap"><table>
            <thead><tr><th>Episode</th><th>Date</th><th>Killed</th><th>Injured</th><th>What is documented</th></tr></thead>
            <tbody>${D.war.lebanon.episodes.map((x) => `<tr>
              <td><strong>${esc(x.label)}</strong></td>
              <td style="white-space:nowrap">${esc(x.date)}</td>
              <td><strong>${esc(x.display || fmt(x.killed))}</strong></td>
              <td>${x.injured ? fmt(x.injured) : '—'}</td>
              <td><span class="small">${esc(x.note)}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
        <ul style="margin-top:18px">${D.war.lebanon.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('Beyond Gaza', 'Operations on other states\' territory', D.war.regional.lede)}
        ${chartCard('regional-ops', 'Military operations on the sovereign territory of other states, 1967–2026',
          'Each point is one documented operation; the size is the death toll where one has been published, and the smallest hollow points are operations with no published toll rather than operations with no dead. Diamonds mark a strike attributed to the United States rather than to Israel. Drag the slider to open out the last three years, which hold most of the record.',
          D.war.regional.ref, 'tall')}
        <ul style="margin-top:18px">${D.war.regional.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>`;
  };

  DATA_BODY['world'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    const p = D.positions;
    return `      <section class="section">
        ${head('The world, mapped', 'Who recognises Palestine, and who has done anything about it',
          `Two views of the same 193 states. The first is recognition: <b>${p.recognition.un_recognising} of ${p.recognition.un_total}</b>
           United Nations member states recognise the State of Palestine, most of them within weeks of the Algiers declaration of
           15 November 1988. The second is conduct — which states have restricted arms transfers, sanctioned officials, settlers or
           settlement goods, or filed at the International Court of Justice. Recognition is a statement. The second map is the ledger of acts.`)}
        <div class="grid">
          ${chartCard('recognition-map', 'Recognition of the State of Palestine, by date of recognition',
            `Hover any country for the date. Two recognitions are contested and are marked as such in the tooltip; territories on neither list are left blank rather than counted as refusals. The base map is Natural Earth, a cartographic base and not an adjudication of any boundary. Dates from ${esc(p.recognition.source)}`,
            p.recognition.ref, 'xtall')}
          ${chartCard('pressure-map', 'What each state has actually done',
            'Strongest measure shown where a state has taken more than one; the tooltip lists them all. A declaration of intervention under Article 63 of the ICJ Statute concerns the construction of the Genocide Convention and is not, in itself, support for either party — the United States and Hungary filed alongside Namibia, Fiji, the Netherlands and Iceland in March 2026. Grey is not neutrality: it is the absence of any measure on the record.',
            'Report §13 and §15.1–15.3; SIPRI Arms Transfers Database', 'xtall')}
        </div>
      </section>

      <section class="section">
        ${head('International standing', 'Recognition and public opinion', 'Recognition of Palestine, and the gap that has opened between Western publics and their governments.')}
        <div class="grid wide-left">
          ${chartCard('opinion', f.opinion.title, `${esc(f.opinion.uk.poll)} · ${esc(f.opinion.us.poll)}`, f.opinion.ref, 'tall')}
          ${chartCard('recognition', f.recognition.title, `Among the G20, ${f.recognition.g20_recognise} of ${f.recognition.g20_total} member states recognise Palestine.`, f.recognition.ref, 'tall')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('measures-step', D.conduct.measures.title, esc('A state joins the line on the date of its first measure and never joins it twice, so the step counts states rather than the weight of what they did. It is a floor: the ' + D.conduct.measures.ruptures.count + ' states that severed or downgraded relations are not on it, because the record names them without dating each rupture.'), esc(D.conduct.measures.ref), 'tall')}
        </div>
        <div class="grid c3" style="margin-top:22px">
          ${statCard({ label: 'States that severed or downgraded relations', value: D.conduct.measures.ruptures.count, note: D.conduct.measures.ruptures.states.join(', ') + '.', source: 'Report §15.4' }, 'green')}
          ${statCard({ label: 'ICC member states obliged to arrest', value: D.conduct.measures.icc.states, note: D.conduct.measures.icc.note, source: 'Rome Statute Articles 86 and 89(1)' }, 'amber')}
          ${statCard({ label: 'UN member states recognising Palestine', value: p.recognition.un_recognising, suffix: ' of ' + p.recognition.un_total, note: 'Recognition is a statement; the step chart above counts acts.', source: p.recognition.source }, 'green')}
        </div>
        <ul style="margin-top:18px">${D.conduct.measures.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The nuclear exception', 'One arsenal is tolerated; the other does not exist', D.conduct.nuclear.lede)}
        ${chartCard('nuclear-npt', D.conduct.nuclear.title, esc('Six rows of the non-proliferation regime, two states. Red is outside the regime and unconstrained; blue is inside it and constrained. The cell text is the answer itself, so the matrix reads as a table and hovers as a source.'), esc(D.conduct.nuclear.ref), 'tall')}
        <div class="card" style="margin-top:20px">
          <h3 style="font-size:18px;margin-bottom:10px">${esc(D.conduct.nuclear.whistleblower.name)}</h3>
          <p class="chart-note">${esc(D.conduct.nuclear.whistleblower.detail)}</p>
        </div>
        <ul style="margin-top:18px">${D.conduct.nuclear.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The coverage, and what it cost', 'Who gets named, which words are used, and who still believes it', D.conduct.media.lede)}
        <div class="grid c2">
          ${chartCard('media-attribution', 'Palestinian casualties reported without naming Israel', esc('The same events, two newsrooms. Novara Media’s April 2026 comparison of BBC and Al Jazeera reporting.'), esc(D.conduct.media.ref), '')}
          ${chartCard('media-trust', 'Trust in the news, and news avoidance', esc('Reuters Institute Digital News Report 2026, published 16 June 2026, surveying nearly 100,000 people across 48 markets.'), esc(D.conduct.media.ref), '')}
        </div>
        <div class="grid" style="margin-top:22px">
          ${chartCard('media-framing', 'The same events, two vocabularies', esc('Blue is the vocabulary used for Israeli deaths and Israeli officials; red is the vocabulary used for Palestinian ones. Counts from the Centre for Media Monitoring across a full year of coverage.'), esc(D.conduct.media.ref), 'tall')}
        </div>
        <div class="grid c2" style="margin-top:22px">
          ${D.conduct.media.dissent.map((x) => statCard({
            label: x.label, value: x.value, note: (x.atleast ? 'At least this many signatories. ' : '') + 'Internal dissent inside the corporation being described.', source: 'BBC staff open letters, 2024–2025',
          }, 'amber')).join('')}
        </div>
        <ul style="margin-top:18px">${D.conduct.media.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The United Kingdom', 'Antisemitic incidents, and the causal claim tested', 'The claim that British measures on Israel and Palestine cause antisemitic violence in Britain, set against the monitoring series and the government’s own comparative funding decisions.')}
        <div class="grid wide-left">
          ${chartCard('uk-antisemitism', f.uk_antisemitism.title, esc(f.uk_antisemitism.source), f.uk_antisemitism.ref, 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">What the series shows</h3>
            <div class="table-wrap"><table><tbody>
              ${f.uk_antisemitism.monthly_average.map((x) => `<tr><td>Monthly average, ${esc(x.label)}</td><td style="text-align:right"><strong>${fmt(x.value)}</strong></td></tr>`).join('')}
            </tbody></table></div>
            <ul style="margin-top:14px">${f.uk_antisemitism.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="grid wide-left" style="margin-top:18px">
          ${chartCard('uk-faith-security', f.uk_antisemitism.security_funding.title, esc(f.uk_antisemitism.security_funding.source), f.uk_antisemitism.security_funding.ref, '')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Delivery, not just allocation</h3>
            <ul>${f.uk_antisemitism.security_funding.context.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="grid wide-left" style="margin-top:18px">
          ${chartCard('hate-series', D.conduct.hate.title, esc('Blue is the antisemitic incident count Britain discusses; green is the anti-Muslim incident count it does not. Tell MAMA publishes an annual report rather than a continuous series, so most years carry no bar, and the 2022 bar is drawn dashed because it is derived from the published two-year rise rather than published in its own right.'), esc(D.conduct.hate.ref), 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The other series</h3>
            <div class="table-wrap"><table><tbody>
              ${D.conduct.hate.counts.map((x) => `<tr><td>${esc(x.label)}</td><td style="text-align:right"><strong>${fmt(x.value)}${esc(x.unit || '')}</strong></td></tr>`).join('')}
              ${D.conduct.hate.shares.map((x) => `<tr><td>${esc(x.label)}</td><td style="text-align:right"><strong>${x.approx ? '~' : ''}${x.value}%</strong></td></tr>`).join('')}
            </tbody></table></div>
            <p class="chart-note" style="margin-top:14px">${esc(D.conduct.hate.estimate_note)}</p>
          </div>
        </div>
        <ul style="margin-top:18px">${D.conduct.hate.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
      </section>

      <section class="section">
        ${head('The definition, the declaration and the law', f.definitions.title, f.definitions.lede)}
        <blockquote class="matrix-quote">${esc(f.definitions.j50.operative)}
          <cite>${esc(f.definitions.j50.title)}, ${esc(f.definitions.j50.place)}, ${esc(f.definitions.j50.date)}. Closing line: “${esc(f.definitions.j50.closing)}”</cite>
        </blockquote>
        <div class="grid wide-left">
          ${chartCard('j50-map', 'Where the signatory organisations are', esc('Shade is the number of signatory bodies in a country, not a population or a share of opinion. Hover a country to read every body it signed through.'), f.definitions.ref, 'tall')}
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Who signed it</h3>
            <div class="table-wrap"><table><tbody>
              <tr><td>Global and regional organisations</td><td style="text-align:right"><strong>${f.definitions.j50.totals.global}</strong></td></tr>
              <tr><td>National and community organisations</td><td style="text-align:right"><strong>${f.definitions.j50.totals.national}</strong></td></tr>
              <tr><td>Countries</td><td style="text-align:right"><strong>${f.definitions.j50.totals.countries}</strong></td></tr>
              <tr><td>Signatories in total</td><td style="text-align:right"><strong>${f.definitions.j50.totals.total}</strong></td></tr>
            </tbody></table></div>
            <ul style="margin-top:14px">${f.definitions.j50.global_orgs.map((o) => `<li class="lvl0">${esc(o)}</li>`).join('')}</ul>
            <p class="chart-note" style="margin-top:14px"><strong>${esc(f.definitions.j50.forum.label)}.</strong> ${esc(f.definitions.j50.forum.note)} <em>${esc(f.definitions.j50.forum.source)}</em></p>
          </div>
        </div>
        <ul style="margin-top:18px">${f.definitions.j50.notes.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>

        <h3 style="font-size:18px;margin:30px 0 14px">Three definitions, and what each holds</h3>
        <div class="grid c3">
          ${f.definitions.frameworks.map((x) => `<div class="card">
            <div class="chart-head" style="margin-bottom:12px">
              <div><h3 style="font-size:16px">${esc(x.name)}</h3><p>${esc(x.by)}</p></div>
              <span class="chart-ref">${esc(x.date)}</span>
            </div>
            <p class="chart-note">${esc(x.holds)}</p>
            <p class="chart-note" style="margin-top:10px"><strong>${esc(x.adopted)}</strong></p>
            <p class="chart-note" style="margin-top:10px">${esc(x.note)}</p>
          </div>`).join('')}
        </div>

        <h3 style="font-size:18px;margin:30px 0 14px">What has actually been decided, in the jurisdiction of two of the signatories</h3>
        <div class="grid c2">
          ${f.definitions.law.map((x) => `<div class="card">
            <div class="chart-head" style="margin-bottom:12px">
              <div><h3 style="font-size:16px">${esc(x.case)}</h3><p>${esc(x.court)} · ${esc(x.citation)}</p></div>
              <span class="chart-ref">${esc(x.date)}</span>
            </div>
            <p class="chart-note">${esc(x.holds)}</p>
            <p class="chart-note" style="margin-top:10px">${esc(x.note)}</p>
          </div>`).join('')}
        </div>

        <div class="grid c2" style="margin-top:22px">
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">Jewish organisations that reject the conflation</h3>
            <div class="table-wrap"><table><tbody>
              ${f.definitions.dissent.map((x) => `<tr><td><strong>${esc(x.org)}</strong><br><span class="chart-note">${esc(x.position)}</span></td><td style="text-align:right;white-space:nowrap">${esc(x.where)}</td></tr>`).join('')}
            </tbody></table></div>
          </div>
          <div class="card">
            <h3 style="font-size:18px;margin-bottom:14px">The counter-evidence, stated at its strongest</h3>
            <ul>${f.definitions.counter.map((n) => `<li class="lvl0">${esc(n)}</li>`).join('')}</ul>
          </div>
        </div>
      </section>`;
  };

  DATA_BODY['tables'] = () => {
    const f = D.fig;
    const o = f.oct7;
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    return `      <section class="section">
        ${head('Source tables', `All ${D.rmeta.stats.tables} tables from the report`, 'Reproduced exactly as they appear in the source document, with the part and section each belongs to.')}
        ${D.report.tables.map((t, i) => `<div class="card" style="padding:20px;margin-bottom:18px">
          <div class="chart-head" style="margin-bottom:14px">
            <div><h3 style="font-size:16px">${esc(t.section || t.part)}</h3>
            <p>${esc(t.section ? t.part : 'Table ' + (i + 1))}</p></div>
            <span class="chart-ref">Table ${i + 1}</span>
          </div>
          ${tableHTML(t)}
        </div>`).join('')}
      </section>`;
  };

  /* A chapter ends at the footer, which tells a reader who has just read
     twenty charts that there is nothing after them. These two links say what
     is, in the order the chapters are meant to be read. */
  function chapterEnd(id) {
    const at = DATA_CHAPTERS.findIndex((c) => c.id === id);
    const prev = DATA_CHAPTERS[at - 1];
    const next = DATA_CHAPTERS[at + 1];
    if (!prev && !next) return '';
    return `<nav class="chapter-end" aria-label="Data chapters">
      ${prev ? `<a class="card lift" href="#/data/${prev.id}" rel="prev">
        <span class="small muted">← Previous chapter</span><strong>${esc(prev.label)}</strong></a>` : '<span></span>'}
      ${next ? `<a class="card lift" href="#/data/${next.id}" rel="next">
        <span class="small muted">Next chapter →</span><strong>${esc(next.label)}</strong></a>` : '<span></span>'}
    </nav>`;
  }

  function dataView(chapter) {
    const id = DATA_BODY[chapter] ? chapter : DATA_CHAPTERS[0].id;
    return `<div class="view wrap">${dataNav(id)}${DATA_BODY[id]()}${chapterEnd(id)}</div>`;
  }

  /* ---------- timeline ---------- */

  function era(year) {
    if (!year) return 'era-mid';
    if (year < 1948) return 'era-early';
    if (year < 2023) return 'era-mid';
    return 'era-now';
  }

  function timelineView() {
    const t = D.timeline;
    const years = t.map((e) => e.year).filter(Boolean);
    const nRecord = t.filter((e) => e.kind === 'record').length;
    const nContext = t.length - nRecord;
    return `<div class="view wrap">
      <section class="section">
        ${head('Timeline', `${t.length} dated events, ${Math.min.apply(null, years)}–${Math.max.apply(null, years)}`, 'Two chronologies in one. The <b>record</b> entries are the report\'s own chronology of major crimes and massacres (Appendix B). The <b>context</b> entries are the legal and political steps between them — the mandates, laws, plans, rulings and admissions that make the pattern legible. Filter by era or kind, or search the text of every entry.')}
        ${chartCard('era-density', 'Documented events per decade', 'The density of the record itself. Crimes and massacres against the legal and political record.', 'Appendix B + contextual chronology', '')}
        <div class="tl-controls" style="margin-top:26px">
          <input type="search" id="tl-search" placeholder="Search ${t.length} events — a place, a name, a year…" autocomplete="off">
          <select id="tl-era">
            <option value="all">All eras</option>
            <option value="pre">Pre-state and Mandate (to 1947)</option>
            <option value="nakba">Nakba and after (1948–1966)</option>
            <option value="occupation">Occupation (1967–2022)</option>
            <option value="now">2023–2026</option>
          </select>
          <select id="tl-kind">
            <option value="all">Both chronologies</option>
            <option value="record">Crimes and massacres (${nRecord})</option>
            <option value="context">Legal and political context (${nContext})</option>
          </select>
          <span class="small muted" id="tl-count"></span>
        </div>
        <div class="tl" id="tl-list">
          ${t.map((e, i) => `<div class="tl-item ${era(e.year)} tl-${e.kind}" id="tl-${i}" data-year="${e.year || ''}" data-i="${i}">
            <div class="tl-date">${esc(e.date)}</div>
            <div class="tl-text">${esc(e.event)}</div>
            ${e.note ? `<div class="tl-note">${esc(e.note)}</div>` : ''}
          </div>`).join('')}
        </div>
        <p class="note small" style="margin-top:22px">The chronology is not exhaustive; it is the record the report anchors. Entries marked as context are compiled from the sources listed under <a href="#/sources">Sources</a> and are included to close the gaps between the massacres — a chronology of crimes alone would suggest the intervals were empty, and they were not.</p>
      </section>
    </div>`;
  }

  /* ---------- evidence ---------- */

  function evidenceView() {
    const parts = D.report.parts;
    const toc = parts.map((p) => `
      <a href="#part-${p.id}" data-toc="${p.id}">${esc(p.title)}</a>
      ${p.sections.map((s) => `<a class="sub" href="#sec-${s.id}" data-toc="${s.id}">${esc(s.title)}</a>`).join('')}
    `).join('');

    const body = parts.map((p) => `
      <article class="ev-part" id="part-${p.id}">
        <h2>${esc(p.title)}</h2>
        ${blocksHTML(p.blocks)}
        ${p.sections.map((s) => `<section class="ev-section" id="sec-${s.id}">
          <h3>${esc(s.title)}</h3>
          ${blocksHTML(s.blocks)}
        </section>`).join('')}
      </article>
    `).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Evidence', 'The complete report', `All ${D.rmeta.stats.parts} parts, ${D.rmeta.stats.sections} sections, ${D.rmeta.stats.tables} tables and ${fmt(D.rmeta.stats.words)} words of the report, reproduced without omission. Every heading, paragraph, list and table in the source document appears below.`)}
        <div class="ev-layout">
          <aside class="ev-toc">
            <input class="ev-toc-search" id="toc-search" type="search" placeholder="Filter sections…" autocomplete="off">
            <div class="grp">Contents</div>
            <div id="toc-list">${toc}</div>
          </aside>
          <div class="ev-body" id="ev-body">${body}</div>
        </div>
      </section>
    </div>`;
  }

  /* ---------- rebuttals ---------- */

  /* Part XVI answers the twenty-three defences that come up in every argument
     about Gaza. Inside Evidence they are twenty-three sections a long way down a very long
     document. Here each one is a claim you can open, the report's own answer
     reproduced verbatim, the charts that carry that answer, and a button that
     puts the whole thing on the clipboard — which is what the page is for. */

  /* Charts are chosen for what they settle, and the note argues the point
     rather than describing the axes. Keyed by rebuttal number so the mapping
     survives any re-wording of the claims in the markdown. */
  const REBUTTAL_CHARTS = {
    1: [
      ['ratio-bars', 'Self-defence is bounded by proportionality, distinction and precaution in every circumstance. This is the ratio the campaign produced.'],
      ['protected', 'Children, women, medical staff, journalists and UN personnel are protected persons under Geneva IV, including in a war a state is entitled to fight.'],
    ],
    2: [
      ['child-ages', 'These are the deaths the human-shields defence is offered to explain. No independent investigation has found that Hamas systematically directed civilians to shield military assets; Israel\'s own Supreme Court found in 2005 that the IDF had been doing exactly that.'],
      ['harm-heat', 'Every month of the war, by who was killed. The defence has to account for all of it, not for one incident.'],
    ],
    3: [
      ['estimates', 'Every independent estimate runs above the Ministry of Health register, not below it.'],
      ['missing-toll', 'The dead under the rubble are excluded from the headline figure by definition: the register records bodies received.'],
      ['age-pyramid', 'Named records with an age and a sex, from the Ministry\'s own list. A combatant roll does not have this shape.'],
    ],
    4: [
      ['uk-antisemitism', 'The claim is that criticism of the state is what drives attacks on Jews. The recorded series is shown against the events it is said to follow.'],
      ['opinion', 'What people in Britain and the United States actually say, item by item. A definition that classes these positions as racist is a definition with a scope problem.'],
    ],
    5: [
      ['wars', 'Seven major military operations against a territory Israel says it left in 2005.'],
      ['starvation', 'Control of the calorie supply, the water and the crossings of 2.2 million people is the clearest test of effective control there is.'],
    ],
    6: [
      ['un-vetoes', 'The body said to be biased has been stopped from acting, repeatedly and by a single vote, by the state said to be defending Israel from it.'],
      ['findings-class', 'Courts, UN machinery, genocide scholars, and Israeli, Palestinian and Jewish organisations reach the same findings separately.'],
    ],
    7: [
      ['accountability-funnel', 'Yesh Din followed the complaints through the Israeli military justice system. This is what came out of the other end.'],
      ['detention-series', 'The same system holds thousands without charge, on evidence the detainee may not see.'],
    ],
    8: [
      ['nakba', 'The land was not empty. These are the villages, the expelled and the dead.'],
      ['land-transfer', 'And this is the statutory machinery that turned their absence into title.'],
    ],
    9: [
      ['detention', 'Administrative detention without charge, military courts, and children tried in them.'],
      ['land-areas', 'Three million people living under military law, governed by a state they cannot vote for.'],
    ],
    10: [
      ['oct7', 'What is recorded about the day the hostages were taken, including the Israeli dead caused by Israeli fire, which the IDF has declined to quantify.'],
      ['daily-toll', 'And the toll accumulated afterwards. The twenty living hostages came home under a negotiated exchange, not under the bombardment.'],
    ],
    11: [
      ['dispossession', 'An evacuation order that is never followed by a return is a transfer, and forcible transfer is a war crime whether or not a warning preceded it.'],
      ['daily-rate', 'The daily toll across the whole war, including the months in which evacuation orders were in force.'],
    ],
    12: [
      ['aid-seekers', 'The distribution model the diversion claim was used to justify, measured by what happened to the people who walked to it.'],
      ['aid-trucks', 'And the volume that crossed. The argument is about who receives the aid; the series is about whether it enters at all.'],
    ],
    13: [
      ['hunger-risk', 'The IPC classifies against fixed thresholds on household surveys, child screening and mortality data. This is the population it placed in each phase.'],
      ['famine-deaths', 'Recorded deaths from starvation and malnutrition. A denial that produces no alternative dataset and no access is not a rebuttal of the finding.'],
    ],
    14: [
      ['protected', 'Journalists are civilians under Additional Protocol I, Article 79, and remain so unless and for such time as they take a direct part in hostilities.'],
      ['media-attribution', 'The same coverage that carries the accusation. Who is named as the cause of a death is itself a measurable editorial choice.'],
    ],
    15: [
      ['settlements', 'What the territorial claim looks like when a state holds the territory and acts on it, rather than when a protester chants about it.'],
      ['land-areas', 'The territory west of the Jordan as it is actually administered, thirty-one years after the interim agreement that was to be five.'],
    ],
    16: [
      ['un-vetoes', 'Seven drafts on this conflict blocked by a single vote since October 2023. Whatever this record is, it is not enforcement without fear or favour.'],
      ['findings-class', 'And the bodies that reached the findings, by class of institution. They applied the instruments they apply everywhere else.'],
    ],
    17: [
      ['detention', 'Administrative detention without charge, military courts, and children tried in them. This is the law that governs the Palestinians who cannot vote for it.'],
      ['dispossession', 'The structure the franchise inside the Green Line does not reach: displacement and demolition across the territory under one authority.'],
    ],
    18: [
      ['findings-time', 'When each body reached its determination. The question is not whether the word is contested; it is who has applied the definition, and when.'],
      ['statements-cats', 'The documented statements, by what they are evidence of. Intent is inferred from conduct under Bosnia (2007), but here it was also said aloud.'],
    ],
    19: [
      ['ceasefire-daily', 'The register since the ceasefire took effect on 10 October 2025. A ceasefire is a claim about what stopped; this is the series.'],
      ['aid-trucks', 'And the other instrument. The zero bar is the total blockade imposed on 2 March 2025, sixteen days before the bombing resumed.'],
    ],
    20: [
      ['nakba-months', 'The pace of the depopulation, month by month. The peak precedes 15 May 1948, which is the date the Arab armies crossed.'],
      ['nakba-fate', 'And what stands on the sites now. A population that left of its own accord does not have its villages levelled behind it.'],
    ],
    21: [
      ['settlements', 'What continued through every round of negotiation. A party that keeps acquiring the subject matter is not waiting for an answer.'],
      ['land-control', 'The same territory at five dates. This is the thing said to have been offered, and the share of it still available to offer.'],
    ],
    22: [
      ['embargo-tracker', 'State measures on arms transfers. A boycott is the same instrument in private hands, and the law treats the call for it as expression.'],
      ['recognition', 'And the diplomatic measure of the same argument. The claim is about a state\'s conduct, which is why states are the ones acting on it.'],
    ],
    23: [
      ['land-transfer', 'Land in Palestinian hands and land in Zionist institutional hands, on a log scale. Whatever the ancestral question, this is the transfer.'],
      ['jnf-growth', 'Fifty years of purchase on the open market, then two years of statute. The mechanism changed in 1948; the direction did not.'],
    ],
  };

  /* The charts this route borrows keep the title and source their own cards
     use. Where that title lives in figures.json it is read from there, so the
     two routes cannot drift apart, and any warning the original card gives
     about the axis is carried over — dropping it would make the chart misread. */
  function rebuttalChart(name, note) {
    const f = D.fig;
    const META = {
      'ratio-bars': ['Both sides of the ledger, every period for which both figures exist', 'B’Tselem; OCHA; Israel NII', 'Log scale, because on a linear axis the Israeli bars would be invisible. '],
      'protected': [f.protected_categories.title, f.protected_categories.ref, 'Log scale. '],
      'child-ages': ['The children, by single year of age', 'Gaza MoH names list', ''],
      'harm-heat': ['Month by category', 'Tech For Palestine', 'Each row is scaled to its own worst month. '],
      'estimates': [f.gaza_toll_estimates.title, f.gaza_toll_estimates.ref, 'Blue: identified-body counts. Amber: peer-reviewed. Violet: modelled. '],
      'missing-toll': ['Not in the count at all', 'Civil Defence; UNICEF', 'Log scale. '],
      'age-pyramid': ['Identified dead by age band and sex', 'Gaza MoH names list', ''],
      'uk-antisemitism': [f.uk_antisemitism.title, f.uk_antisemitism.ref, ''],
      'opinion': [f.opinion.title, f.opinion.ref, ''],
      'wars': ['Palestinian deaths by military operation, 2008–2026', f.pre2023_wars.ref, 'Log scale. '],
      'starvation': [f.starvation.title, f.starvation.ref, 'Log scale. '],
      'un-vetoes': ['Security Council drafts blocked since 7 October 2023', 'UN Security Council records', ''],
      'findings-class': ['Determinations by class of institution', '§15.8', ''],
      'accountability-funnel': ['Complaints, investigations and indictments, 2016–2024', 'Yesh Din', ''],
      'detention-series': ['Palestinians held in administrative detention, at each documented snapshot', 'Addameer', ''],
      'nakba': [f.nakba.title, f.nakba.ref, 'Log scale. '],
      'land-transfer': [f.land_transfer.title, f.land_transfer.ref, 'Log scale. Dunams. '],
      'detention': [f.detention.title, f.detention.ref, 'Log scale. '],
      'land-areas': ['The West Bank under Oslo II, thirty-one years on', 'Oslo II Interim Agreement, Annex I', ''],
      'oct7': [f.oct7.title, f.oct7.ref, ''],
      'daily-toll': ['Cumulative deaths, every reporting day', 'Tech For Palestine', ''],
      'dispossession': ['People displaced and structures demolished, 1948–2026', 'UN; UNRWA; ICAHD; Land Research Center', 'Log scale. '],
      'daily-rate': ['Deaths added to the register each day', 'Tech For Palestine', ''],
      'aid-seekers': ['Casualties among people seeking aid', 'Gaza MoH / OCHA', 'Bars: killed that month. Lines: cumulative, on the right-hand axis. '],
      'aid-trucks': [D.conduct.aid.title, D.conduct.aid.ref, 'The zero bar is the total blockade imposed on 2 March 2025. '],
      'hunger-risk': [D.conduct.hunger.title, D.conduct.hunger.ref, ''],
      'famine-deaths': ['Deaths from starvation and malnutrition', 'Gaza MoH', 'Cumulative, stepped at each reporting date; the amber line is the child share. '],
      'media-attribution': ['Palestinian casualties reported without naming Israel', D.conduct.media.ref, ''],
      'settlements': ['Settlements approved: Oslo era vs current coalition', f.settlements.ref, ''],
    };
    const m = META[name];
    return m ? chartCard(name, m[0], esc(m[2] + note), m[1], 'tall') : '';
  }

  function rebuttalsView() {
    const part = (D.report.parts || []).find((p) => /DEFEATING EVERY REBUTTAL/i.test(p.title));
    const items = part ? part.sections.filter((s) => /^Rebuttal\s+\d+/i.test(s.title)) : [];

    const body = items.map((s) => {
      const n = Number((s.title.match(/^Rebuttal\s+(\d+)/i) || [])[1]);
      const claim = s.title.replace(/^Rebuttal\s+\d+:\s*/i, '').replace(/^["“']|["”']$/g, '');
      const charts = REBUTTAL_CHARTS[n] || [];
      return `<details class="rebuttal" id="rebuttal-${n}" data-rebuttal="${n}" data-claim="${esc(claim)}" data-section="sec-${esc(s.id)}">
        <summary>
          <span class="rebuttal-n">${String(n).padStart(2, '0')}</span>
          <span class="rebuttal-claim">“${esc(claim)}”</span>
          <span class="rebuttal-cue" aria-hidden="true">Answer</span>
        </summary>
        <div class="rebuttal-body">
          <div class="rebuttal-answer">${blocksHTML(s.blocks)}</div>
          <div class="rebuttal-tools">
            <button class="chart-tool" data-rebuttal-copy="${n}">copy the answer</button>
            <a class="chart-tool" href="#sec-${esc(s.id)}">read it in the report</a>
            <button class="chart-tool" data-rebuttal-link="${n}">copy a link</button>
          </div>
          ${charts.length ? `<div class="grid ${charts.length > 1 ? 'c2' : ''}">
            ${charts.map(([name, note]) => rebuttalChart(name, note)).join('')}
          </div>` : ''}
        </div>
      </details>`;
    }).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Rebuttals', 'Every defence, answered',
      `The ${items.length} arguments that are made in defence of the conduct documented here, each one answered on its own legal terms and with the figures that settle it. The answers are Part XVI of the report, reproduced word for word. Open a claim, read the answer, copy it.`)}
        <div class="rebuttal-list">${body}</div>
        <p class="chart-note" style="margin-top:26px;max-width:760px">
          Nothing on this page is a paraphrase. Each answer is the corresponding section of
          the report as it stands, and the link beside it opens the same text inside the
          full report with everything around it.
        </p>
      </section>
    </div>`;
  }

  /* ---------- statements ---------- */

  function statementsView() {
    const S = D.statements;
    const cats = S.categories;
    const items = S.items;
    const catById = {};
    cats.forEach((c) => { catById[c.id] = c; });
    const countOf = (id) => items.filter((x) => x.cat.indexOf(id) >= 0).length;

    const chips = [`<button class="chip active" data-cat="all">All<span>${items.length}</span></button>`]
      .concat(cats.map((c) => `<button class="chip" data-cat="${esc(c.id)}" style="--chip:${esc(c.colour)}">
        <i style="background:${esc(c.colour)}"></i>${esc(c.label)}<span>${countOf(c.id)}</span>
      </button>`)).join('');

    const card = (x, i) => `<article class="card quote-card st-card lift" id="st-${i}" data-i="${i}" data-speaker="${esc(speakerSlug(x.speaker))}" data-cat="${esc(x.cat.join(' '))}">
      <div class="st-top">
        <span class="st-tier">${esc(x.tier)}</span>
        <span class="st-date">${esc(x.date)}</span>
        <button class="share-card" data-share="statement" title="Save this statement as a shareable card"
          aria-label="card — save this statement as an image">card</button>
      </div>
      <blockquote>“${esc(x.quote)}”</blockquote>
      <div class="who">${esc(x.speaker)}</div>
      <div class="role">${esc(x.role)}</div>
      <div class="st-cats">${x.cat.map((id) => {
        const c = catById[id];
        return c ? `<span class="st-cat" style="--chip:${esc(c.colour)}">${esc(c.label)}</span>` : '';
      }).join('')}</div>
      <div class="st-meta">
        <p><span class="st-k">Context</span> ${esc(x.context)}</p>
        <p><span class="st-k">Significance</span> ${esc(x.significance)}</p>
        <p class="st-src">${esc(x.source)}</p>
      </div>
    </article>`;

    return `<div class="view wrap">
      <section class="section">
        ${head('Statements', `${items.length} statements on the record of intent`, esc(S.meta.description) + ' They carry particular evidentiary weight in the assessment of intent. Contested attributions are marked as contested and are not relied on.')}
        <div class="grid c4">
          ${[
            { value: items.length, label: 'Statements catalogued here', note: 'each with speaker, role, date, verbatim quotation, context, source and legal significance' },
            { value: cats.length, label: 'Evidentiary categories', note: 'from genocidal intent and incitement to formal findings and internal dissent' },
            { value: countOf('genocide'), label: 'Advanced as evidence of intent', note: 'dolus specialis under Article II, or incitement under Article III(c)' },
            { value: countOf('dissent'), label: 'Israeli and Jewish dissent', note: 'the internal record, which forecloses the claim that only outside critics use these words' },
          ].map((x, i) => statCard(x, ['red', '', 'red', 'green'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('Shape of the record', 'What is being said, and since when', 'The statements below are not a selection of outliers. They cluster in defined categories, and they do not begin in October 2023.')}
        <div class="grid wide-left">
          ${chartCard('statements-cats', 'Statements by evidentiary category', 'A statement may fall into more than one category, so the categories sum to more than the total.', '§6.2, Appendix C', 'tall')}
          ${chartCard('statements-era', 'Statements by period', 'The founding-era record is on the same axis as the present one.', 'Appendix C', 'tall')}
        </div>
      </section>

      <section class="section">
        ${head('The registries', 'Where the wider record is held', 'This page carries the statements the report relies on. Four continuously updated registries hold the full corpus, which runs to more than a thousand entries.')}
        <div class="grid c2">
          ${S.meta.primary_databases.map((d) => `<a class="card lift" href="${esc(d.url)}" target="_blank" rel="noopener" style="text-decoration:none">
            <h3 style="font-size:17px;margin-bottom:8px">${esc(d.name)}</h3>
            <p class="small muted" style="margin:0">${esc(d.detail)}</p>
          </a>`).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The statements', 'In full, in date order', 'Filter by category, or search any speaker, role, quotation or note. Every entry gives the source as published.')}
        <div class="chips" id="st-chips">${chips}</div>
        <div class="tl-controls">
          <input type="search" id="st-search" placeholder="Search speakers, roles, quotations…" autocomplete="off">
          <span class="small muted" id="st-count"></span>
        </div>
        <div class="grid c2" id="st-list">${items.map(card).join('')}</div>
        <p class="chart-note" style="margin-top:22px">Compiled ${esc(S.meta.compiled)}. Quotations are reproduced as recorded in the cited source; where a translation, transcription or attribution is disputed, the dispute is stated in the entry rather than resolved silently.</p>
      </section>
    </div>`;
  }

  /* ---------- legal ---------- */

  const LEGAL_PARTS = [
    'part-vi---genocide-in-gaza-the-legal-case-20',
    'part-iv---the-crime-of-apartheid-two-peoples',
    'part-xvii---comprehensive-legal-synthesis',
    'part-xv---the-international-verdict',
    'part-xviii---hamass-october-7-2023-war-crime',
    'appendix-a---major-legal-instruments-and-aut',
  ];

  /* A crime is proved element by element, and the argument that the elements
     are not met is almost always made about one of them in isolation. The
     matrix sets all of them out at once: each row an element, each column a
     class of evidence, each cell the figure or finding that supplies it with
     the section it came from. Where nothing supplies a cell the cell says so;
     an empty place in the grid is itself part of the record. */
  function matrixCell(c) {
    if (!c) return '<td class="matrix-empty">—</td>';
    const link = c.chart && c.chapter ? `#/data/${c.chapter}&chart=${c.chart}`
      : (c.chart && c.route ? `${c.route}&chart=${c.chart}` : c.route || '');
    const label = c.chart ? 'See the chart' : 'Read the section';
    return `<td>
      <p>${esc(c.text)}</p>
      <p class="matrix-foot">${c.ref ? `<span class="matrix-ref">${esc(c.ref)}</span>` : ''}${
  link ? `<a href="${esc(link)}">${label}</a>` : ''}</p>
    </td>`;
  }

  function elementsMatrix(m) {
    return `<div class="matrix-wrap">
      <table class="matrix" aria-label="${esc(m.title)} — the elements set against the evidence for each">
        <thead>
          <tr>
            <th scope="col" class="matrix-corner">The element</th>
            ${m.columns.map((c) => `<th scope="col">${esc(c.label)}<span>${esc(c.blurb)}</span></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${m.rows.map((r) => `<tr>
            <th scope="row">
              <span class="matrix-key">${esc(r.key)}</span>
              <span class="matrix-act">${esc(r.title)}</span>
            </th>
            ${m.columns.map((c) => matrixCell(r.cells[c.id])).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="chart-note" style="margin-top:16px">${esc(m.note)}</p>`;
  }

  /* Bosnia v Serbia holds that the duty to prevent binds from the moment a
     state learns of a serious risk. The scorecard is that duty made checkable:
     one row per state, one column per thing a state can actually do. Every
     column is joined at render time from the datasets that already carry their
     own sources, so the table cannot drift from the charts drawn off the same
     records. */
  function scorecardRows() {
    const S = D.elements.scorecard;
    const P = D.positions;
    const embargo = D.long.complicity.embargo.countries;
    const suppliers = D.long.complicity.suppliers.items;

    /* The four datasets name a handful of states differently — Türkiye and
       Turkey, the Czech Republic and Czechia — and without reconciling them
       the same state appears twice with half its record in each row. The
       recognition list is all 195 states and is therefore the name authority;
       the alias table that exists so the choropleth can join on a name the
       geometry knows is reused here to reach it. */
    const canon = (name) => {
      const alias = P.alias[name] || name;
      const hit = P.recognition.states.find((s) => s.name === name || s.name === alias || s.map === alias);
      return hit ? hit.name : name;
    };

    const names = {};
    const add = (name, why) => {
      const key = canon(name);
      (names[key] = names[key] || []).push(why);
    };
    S.g20.forEach((n) => add(n, 'G20'));
    P.icj.applicant.forEach((x) => add(x.name, 'ICJ'));
    P.icj.interveners.forEach((x) => add(x.name, 'ICJ'));
    embargo.forEach((x) => add(x.country, 'arms'));
    P.sanctions.measures.forEach((m) => m.countries.forEach((x) => {
      if (m.id === 'officials-2025') add(x.name, 'sanctions');
    }));

    return Object.keys(names).map((name) => {
      const rec = P.recognition.states.find((s) => s.name === name);
      const emb = embargo.find((x) => canon(x.country) === name);
      const sup = suppliers.find((x) => canon(x.country) === name);
      const measures = P.sanctions.measures.filter((m) => m.countries.some((c) => canon(c.name) === name));
      const icj = P.icj.applicant.some((x) => canon(x.name) === name) ? 'applicant'
        : (P.icj.interveners.some((x) => canon(x.name) === name) ? 'intervened' : '');
      return {
        name,
        g20: names[name].indexOf('G20') >= 0,
        recognises: rec && rec.recognises ? (rec.year || null) : (rec ? 0 : null),
        recogniseNote: rec && rec.recognises ? rec.on : (rec ? 'Has not recognised the State of Palestine' : ''),
        arms: emb ? emb.status : '',
        armsNote: emb ? `${emb.date} — ${emb.detail}` : '',
        measures: measures.map((m) => ({ id: m.id, label: m.label, date: m.date })),
        icj,
        share: sup ? sup.share : null,
        shareNote: sup ? sup.note : '',
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  const ARMS_LABEL = { halted: 'Halted', partial: 'Restricted', continuing: 'Continuing' };

  /* The measures carry their full titles in the data; the table has room for
     the target and nothing else, and the full title stays in the tooltip. */
  const SANCTION_SHORT = {
    'officials-2025': 'Ministers',
    'eu-settlers-2026': 'Settlers',
    'settlement-goods-2026': 'Settlement goods',
  };

  function scorecardTable() {
    const S = D.elements.scorecard;
    const rows = scorecardRows();
    const shortSanction = (m) => SANCTION_SHORT[m.id] || m.label;

    const cell = (value, sort, cls, title) => `<td class="${cls || ''}"${
      title ? ` title="${esc(title)}"` : ''} data-sort="${esc(String(sort))}">${value}</td>`;

    return `<div class="matrix-wrap">
      <table class="scorecard" id="scorecard" aria-label="${esc(S.title)}">
        <thead>
          <tr>
            ${S.columns.map((c, i) => `<th scope="col">
              <button class="sort-btn" data-col="${i}" data-dir="${i === 0 ? 'asc' : 'desc'}"
                aria-label="Sort by ${esc(c.label)}">${esc(c.label)}<i aria-hidden="true"></i></button>
              <span>${esc(c.blurb)}</span>
            </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <th scope="row">${esc(r.name)}${r.g20 ? '<span class="tag">G20</span>' : ''}</th>
            ${cell(r.recognises ? `<b class="yes">Yes</b> <span class="muted">${r.recognises}</span>`
    : '<span class="no">No</span>', r.recognises || 0, '', r.recogniseNote)}
            ${cell(r.arms ? `<span class="chip static ${r.arms}">${ARMS_LABEL[r.arms]}</span>` : '',
    r.arms === 'halted' ? 3 : (r.arms === 'partial' ? 2 : (r.arms === 'continuing' ? 1 : 0)), '', r.armsNote)}
            ${cell(r.measures.map((m) => `<span class="chip static">${esc(shortSanction(m))}</span>`).join(' '),
    r.measures.length, 'wrapcell', r.measures.map((m) => `${m.date}: ${m.label}`).join(' · '))}
            ${cell(r.icj ? `<span class="chip static${r.icj === 'applicant' ? ' halted' : ''}">${
  r.icj === 'applicant' ? 'Applicant' : 'Intervened'}</span>` : '',
    r.icj === 'applicant' ? 2 : (r.icj ? 1 : 0))}
            ${cell(r.share == null ? '' : `<b>${r.share}%</b>`, r.share == null ? -1 : r.share, 'num', r.shareNote)}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="chart-note" style="margin-top:16px">${esc(S.note)} ${esc(S.g20_note)}</p>`;
  }

  function legalView() {
    const byId = {};
    D.report.parts.forEach((p) => { byId[p.id] = p; });
    const parts = LEGAL_PARTS.map((id) => byId[id]).filter(Boolean);

    return `<div class="view wrap">
      <section class="section">
        ${head('Legal', 'The findings and the instruments they rest on', 'The parts of the report that state the legal case: genocide, apartheid, the comprehensive synthesis, the international verdict, the assessment of Hamas\'s conduct on 7 October under the same standards, and the instruments cited throughout. The full text of each appears here; every other part is in <a href="#/evidence">Evidence</a>.')}
        <div class="grid c4" style="margin-bottom:38px">
          ${[
            { label: 'ICJ provisional measures', value: 3, note: '26 January, 28 March and 24 May 2024 — binding orders on the plausible risk of genocide' },
            { label: 'ICC arrest warrants', value: 2, note: 'Netanyahu and Gallant, 21 November 2024 — starvation as a method of warfare' },
            { label: 'Institutions finding genocide', value: D.legal.determinations.length, note: 'courts, UN mechanisms, genocide scholars, human-rights organisations, and Israeli, Palestinian and Jewish bodies (§15.8)' },
            { label: 'States recognising Palestine', value: 157, note: 'of 193 UN member states — 81% of the international community' },
          ].map((x) => statCard(x, 'amber')).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The determination', 'Who has found genocide, and when', 'The answer to <i>but who is actually calling it genocide?</i> is the list itself. Each finding below was reached independently, on the institution\'s own evidence and under its own procedure. Hover any point for the finding and its terms.')}
        ${chartCard('findings-time', 'Every determination on one axis', 'One dot per finding, placed on the date it was published. Institutions that have made a determination without a single dated report are counted in the chart below but not plotted here.', '§15.8', 'tall')}
        ${chartCard('findings-class', 'Determinations by class of institution', 'Counting institutions, not statements. The roster crosses courts, the UN\'s own machinery, the genocide-scholarship field, and Israeli, Palestinian and Jewish organisations.', '§15.8', '')}
        <p class="note small">The determination is not a fringe position and it is not a single body\'s view. It has been reached by the UN\'s own investigative machinery, the world\'s principal genocide-scholars\' association, the three leading global human-rights organisations, Israeli and Jewish bodies, Palestinian human-rights institutions, and major faith and humanitarian organisations. The open question is not whether serious institutions have made the finding — they have, repeatedly and independently — but whether states will act on the duty to prevent that the finding triggers.</p>
      </section>

      <section class="section">
        ${head('The elements', 'Each crime, tested element by element',
      'A crime is not proved in the round; it is proved element by element, and the defence of this conduct is almost always a defence of one element in isolation. Both crimes are set out below as the instruments define them, with the evidence that answers each part placed beside it. Every cell names the section it came from; where nothing supplies a cell, it says so.')}
        ${D.elements.matrices.map((m) => `<div class="matrix-block">
          <h3 class="matrix-title">${esc(m.title)}</h3>
          <blockquote class="matrix-quote">${esc(m.quote)}<cite>${esc(m.instrument)}</cite></blockquote>
          <p class="matrix-lede">${esc(m.lede)}</p>
          ${elementsMatrix(m)}
        </div>`).join('')}
      </section>

      <section class="section">
        ${head('The instruments', esc(D.elements.instruments.title), esc(D.elements.instruments.lede))}
        ${chartCard('instrument-graph', 'Which finding rests on which instrument',
      'Instruments on the outer ring in amber; the bodies that relied on them coloured by class. Hover any node for what it is, or any edge for the article cited.',
      'Appendix A + §15.8', 'xtall')}
        <p class="chart-note" style="margin-top:16px">${esc(D.elements.instruments.note)}</p>
      </section>

      <section class="section">
        ${head('The duty to prevent', esc(D.elements.scorecard.title), esc(D.elements.scorecard.lede))}
        ${scorecardTable()}
        <p class="note small">${esc(D.elements.scorecard.source)}</p>
      </section>

      <section class="section">
        ${head('Recognition', 'The State of Palestine, state by state', esc(D.legal.recognition.note))}
        <div class="grid wide-left">
          ${chartCard('recognition-wave', 'States recognising Palestine, 1988–2025', 'Documented waypoints. Hover each for what happened and who recognised.', '§15.1', 'tall')}
          ${chartCard('recognition', 'Where the count stands', '157 of 193 UN member states, including 14 of the 19 G20 member states.', '§15.1', 'tall')}
        </div>
        <p class="note small">${esc(D.legal.recognition.now.holdouts)}</p>
      </section>

      <section class="section">
        ${head('The full text', 'The parts that state the case', '')}
        <div class="ev-body">
          ${parts.map((p) => `<article class="ev-part" id="part-${p.id}">
            <h2>${esc(p.title)}</h2>
            ${blocksHTML(p.blocks)}
            ${p.sections.map((s) => `<section class="ev-section" id="legal-${s.id}">
              <h3>${esc(s.title)}</h3>${blocksHTML(s.blocks)}
            </section>`).join('')}
          </article>`).join('')}
        </div>
      </section>
    </div>`;
  }

  /* ---------- sources ---------- */

  function sourcesView() {
    const L = D.sources;
    const total = L.groups.reduce((n, g) => n + g.items.length, 0);
    const b = D.rmeta.bibliography;

    // The report's own bibliography, grouped as the source document groups it.
    const bib = [];
    const index = {};
    b.forEach((e) => {
      if (!(e.category in index)) { index[e.category] = bib.length; bib.push({ name: e.category, items: [] }); }
      bib[index[e.category]].items.push(e);
    });

    const chips = [`<button class="chip active" data-group="all">All<span>${total}</span></button>`]
      .concat(L.groups.map((g) => `<button class="chip" data-group="${esc(g.id)}">${esc(g.label)}<span>${g.items.length}</span></button>`)).join('');

    const entry = (e) => `<li class="src-entry">
      <div class="src-title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>
      <div class="src-org">${esc(e.org)}${e.date ? ' · ' + esc(e.date) : ''}</div>
      ${e.note ? `<div class="src-note">${esc(e.note)}</div>` : ''}
    </li>`;

    return `<div class="view wrap">
      <section class="section">
        ${head('Sources', `${total} primary sources, ${b.length} bibliography entries`, esc(L.meta.description))}
        <div class="grid c4">
          ${[
            { value: total, label: 'Linked primary sources', note: 'courts, UN bodies, human rights organisations, datasets, archives and the Israeli press' },
            { value: L.groups.length, label: 'Classes of source', note: 'grouped by the evidentiary weight each class carries' },
            { value: b.length, label: 'Bibliography entries', note: 'the report\'s own bibliography, reproduced in full below' },
            { value: 2, label: 'Independent sources required', note: 'no new statistic enters the record on a single source' },
          ].map((x, i) => statCard(x, ['blue', '', '', 'amber'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The evidentiary base', 'What the record rests on', 'Findings by courts and mandated inquiries sit at the top of this hierarchy; field documentation and the Israeli press sit alongside them because admissions against interest carry their own weight.')}
        ${chartCard('sources-groups', 'Sources by class', 'Counts are of the linked entries below, not of every citation in the report.', '', 'tall')}
      </section>

      <section class="section">
        ${head('The library', 'Every source, linked', 'Filter by class, or search titles, organisations and notes. Links open the authoritative publisher, not an aggregator.')}
        <div class="chips" id="src-chips">${chips}</div>
        <div class="tl-controls">
          <input type="search" id="src-search" placeholder="Search titles, organisations, findings…" autocomplete="off">
          <span class="small muted" id="src-count"></span>
        </div>
        <div id="src-list">
          ${L.groups.map((g) => `<div class="src-group" data-group="${esc(g.id)}">
            <h3>${esc(g.label)}</h3>
            <p class="small muted src-blurb">${esc(g.blurb)}</p>
            <ul class="src-list">${g.items.map(entry).join('')}</ul>
          </div>`).join('')}
        </div>
        <p class="chart-note" style="margin-top:22px">${esc(L.meta.note)} Compiled ${esc(L.meta.compiled)}.</p>
      </section>

      <section class="section">
        ${head('Bibliography', `The report's own bibliography, ${b.length} entries`, 'Reproduced from the report exactly as it appears there, grouped by its own categories.')}
        <details class="bib">
          <summary>Show the full bibliography</summary>
          <div id="bib-list">
            ${bib.map((g) => `<div class="src-group">
              <h3>${esc(g.name)}</h3>
              <ul class="src-list">${g.items.map((e) => `<li>${e.html}</li>`).join('')}</ul>
            </div>`).join('')}
          </div>
        </details>
      </section>

      <section class="section">
        ${head('Method', 'How this dashboard was built', '')}
        <div class="grid c3">
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">No gaps</h3>
            <p class="small muted"><code>build.py</code> parses the report into structured JSON, emitting every
            heading, paragraph, list item and table. <code>verify.py</code> then reconciles every non-blank line of the source
            against the output; it currently reports zero missing fragments. The Evidence section renders that JSON in full,
            so what you read there is the report itself, not a summary of it.</p>
          </div>
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">Time-series data</h3>
            <p class="small muted"><code>fetch_timeseries.py</code> downloads the
            <a href="https://data.techforpalestine.org/" target="_blank" rel="noopener">Tech For Palestine</a> daily datasets
            (${fmt(1070)} daily records, October 2023 – September 2026) and aggregates them to monthly series.
            Their cumulative totals corroborate the figures cited independently in the report:
            ${fmt(D.ts.summary.gaza && D.ts.summary.gaza.killed ? D.ts.summary.gaza.killed.total : D.fig.headline[0].value)} killed
            as of ${esc(D.ts.meta.last_daily_update || D.ts.meta.last_month)}.</p>
          </div>
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">Corroboration</h3>
            <p class="small muted">Every statistic must appear in at least two independent sources before it enters the record.
            Where sources disagree, the more recent and better-documented figure is used and the disagreement is stated.
            Where a figure is an estimate rather than a count — as with the mortality studies — it is labelled as one.
            <a href="#/provenance">Provenance</a> joins every claim to the bodies it rests on, and will reject any class
            of source you name and recount what is left.</p>
          </div>
        </div>
      </section>
    </div>`;
  }

  /* ---------- guided path ---------- */

  /* Small counts read as words in prose, so a sentence never opens on a numeral.
     Anything larger is a figure and stays one. */
  const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const word = (n) => (n >= 0 && n < SMALL.length ? SMALL[n] : fmt(n));

  /* Eight steps, in the order the case is actually made: the toll, the
     asymmetry, the intent, the finding, the machinery that produces the first
     four, who supplies it, and what is said in its defence. Each step is one
     claim and one chart, and each is its own route, so a step can be linked to
     and argued from. The claims are built from the same data the charts plot,
     so a step cannot drift away from the figure beneath it. */
  function tourSteps() {
    const a = D.long.asymmetry;
    const now = a.periods[a.periods.length - 1];
    const intifada = a.periods[1];
    const f = D.long.accountability.funnels[0];
    const classList = D.legal.classes || [];
    const classes = classList.length;
    /* Two of the class labels defeat the obvious formatting. "UN bodies and mechanisms" must
       not be lowercased wholesale, and "Faith, medical and humanitarian" already contains a
       comma, so a comma-separated list reads as seven classes rather than five. Lowercase only
       the first letter, and only where the label does not open on an acronym; join on
       semicolons. */
    const lowerFirst = (s) => (/^[A-Z]{2,}\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
    const classNames = classList.map((c) => esc(lowerFirst(String(c.label)))).join('; ');
    const determinations = (D.legal.determinations || []).length;
    const suppliers = D.long.complicity.suppliers;
    const standing = (D.long.recognition.standing || [])[0] || {};

    return [
      {
        title: 'Start with the count',
        claim: `${fmt(now.palestinian)} Palestinians have been killed since 7 October 2023, against ${fmt(now.israeli)}
          Israelis. Every figure in this dashboard is a floor, not a ceiling: it counts identified bodies and named
          records, and the people still under the rubble are not in it.`,
        chart: ['gaza-cumulative', 'The toll since 7 October 2023',
          'Cumulative deaths by protected category. The dashed line marks the ceasefire of 11 October 2025.', '§6.3'],
        read: ['#/data/gaza', 'The Gaza chapter in full'],
      },
      {
        title: 'The ratio is the argument',
        claim: `${ratio(now)} Palestinians have died for every Israeli killed. In the Second Intifada — the period most
          often produced as representative of this conflict — the ratio was ${ratio(intifada)} to one. It has never
          been near parity in any period for which both figures exist.`,
        chart: ['ratio-trend', 'Palestinians killed for every Israeli killed',
          'Each bar is one documented period. The dashed line is parity — one death on each side.',
          'B’Tselem; OCHA; Israeli Ministry of Defense'],
        read: ['#/data/asymmetry', 'The asymmetry chapter'],
      },
      {
        title: 'What was said while it was done',
        claim: `Intent is not inferred here; it is quoted. ${fmt(D.statements.items.length)} statements by serving
          ministers, commanders and members of the Knesset are reproduced verbatim, with speaker, role, date and
          source. They are what the International Court of Justice and the Commission of Inquiry read.`,
        chart: ['statements-cats', 'The documented statements, by what they call for',
          'A statement may fall into more than one category, so the categories sum to more than the total.',
          'Appendix C'],
        read: ['#/statements', 'Read the statements'],
      },
      {
        title: 'What the institutions found',
        claim: `The record holds ${determinations} determinations across ${word(classes)} classes of institution:
          ${classNames}. The finding is not one body’s opinion, and the Israeli and Jewish organisations that appear
          in the list are not outside critics.`,
        chart: ['findings-class', 'Determinations by class of institution',
          'Every institution that has made a finding on the record, grouped by what kind of body it is.', '§15.8'],
        read: ['#/legal', 'The proceedings and the findings'],
      },
      {
        title: 'Why nothing follows from it',
        claim: `Of ${fmt(f.complaints)} complaints about Israeli soldiers killing or injuring Palestinians between
          ${esc(f.label)}, ${fmt(f.investigations)} produced a criminal investigation and ${fmt(f.indictments)}
          produced an indictment. The system is not failing to deliver accountability. It is delivering its design.`,
        chart: ['accountability-funnel', 'Complaints, investigations and indictments',
          'Tracked by Yesh Din through the Israeli military justice system.', 'Yesh Din'],
        read: ['#/data/since-1948', 'The record since 1948'],
      },
      {
        title: 'The machinery is older than the war',
        claim: `Displacement and demolition are continuous from 1948, not a consequence of October 2023. The same
          instruments — absentee property, military orders, permit refusal, demolition — run through every decade of
          the record.`,
        chart: ['dispossession', 'People displaced and structures demolished, 1948–2026',
          'Log scale. Blue: people displaced. Amber: homes and structures demolished.',
          'UN; UNRWA; ICAHD; Land Research Center'],
        read: ['#/data/land', 'Where the land went'],
      },
      {
        title: 'Who supplies it',
        claim: `The weapons are not made in a vacuum. Over ${esc(suppliers.period)}, ${word(suppliers.items.length)}
          states supplied almost all of Israel's major conventional arms imports, and each of them publishes enough of
          its own licensing record to be held to it. This is the part of the case that is not about Israel at all.`,
        chart: ['arms-suppliers', esc(suppliers.title),
          `Share of Israel’s major conventional arms imports, ${esc(suppliers.period)}.`,
          'SIPRI Arms Transfers Database'],
        read: ['#/data/complicity', 'The complicity ledger'],
      },
      {
        title: 'And the defences',
        claim: `Every argument made in defence of this conduct is answered in the Rebuttals route, on its own legal
          terms and with the figures that settle it. Meanwhile ${standing.value ? fmt(standing.value) + ' of the '
          + fmt(standing.of) + ' UN member states have' : 'most states have'} recognised Palestine. The direction of
          the record is not in doubt; only the speed is.`,
        chart: ['recognition-timeline', 'Recognition of Palestine over time',
          'States recognising Palestine at each documented point in the record, against all 193 UN members.', '§15'],
        read: ['#/rebuttals', 'Answer the arguments'],
      },
    ];
  }

  function tourView(sub) {
    const steps = tourSteps();
    const n = Math.min(Math.max(parseInt(sub, 10) || 1, 1), steps.length);
    const s = steps[n - 1];
    const prev = n > 1 ? `#/tour/${n - 1}` : '';
    const next = n < steps.length ? `#/tour/${n + 1}` : '';

    const rail = steps.map((t, i) => `<a class="tour-dot${i === n - 1 ? ' on' : ''}" href="#/tour/${i + 1}"
      aria-label="Step ${i + 1}: ${esc(t.title)}"${i === n - 1 ? ' aria-current="step"' : ''}>
      <span>${i + 1}</span></a>`).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Start here', 'The case in eight steps',
      `A guided path through the record for a reader who has not seen it before. Each step is one claim and the chart
       that carries it, in the order the case is actually made. Every step is its own link, so a single step can be
       sent on its own. Skip it at any point — <a href="#/data">the data route</a> holds all of it and more.`)}
        <div class="tour-rail" role="navigation" aria-label="Tour steps">${rail}</div>
        <div class="tour-step">
          <div class="tour-count">Step ${n} of ${steps.length}</div>
          <h3>${esc(s.title)}</h3>
          <p class="tour-claim">${s.claim}</p>
        </div>
        <div class="grid">
          ${chartCard(s.chart[0], s.chart[1], s.chart[2], s.chart[3], 'tall')}
        </div>
        <div class="tour-nav">
          ${prev ? `<a class="btn" href="${prev}">← Step ${n - 1}</a>` : '<span></span>'}
          <a class="btn" href="${s.read[0]}">${esc(s.read[1])}</a>
          ${next ? `<a class="btn primary" href="${next}">Step ${n + 1} →</a>`
        : '<a class="btn primary" href="#/evidence">Read the whole record</a>'}
        </div>
      </section>
    </div>`;
  }

  /* ---------- the chart index ---------- */

  /* Every chart card already declares its own name, title, source and note in
     data attributes. The embed route and the open-data route both need that
     list, and a second hand-written copy of it would go stale the first time a
     chart was renamed. So build it from the markup itself: render every route
     into a string once, read the attributes back out, and keep the result. */
  const UNESC = { amp: '&', lt: '<', gt: '>', quot: '"' };
  const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot);/g, (m, name) => UNESC[name]);

  const CARD_RE = new RegExp('data-chart-card="([^"]+)"\\s+data-title="([^"]*)"'
    + '\\s+data-source="([^"]*)"\\s+data-note="([^"]*)"', 'g');

  let CHART_INDEX = null;

  function chartIndex() {
    if (CHART_INDEX) return CHART_INDEX;
    const index = {};
    const scan = (html, route) => {
      CARD_RE.lastIndex = 0;
      let m;
      while ((m = CARD_RE.exec(html))) {
        if (index[m[1]]) continue;
        index[m[1]] = {
          name: m[1], route,
          title: unesc(m[2]), source: unesc(m[3]), note: unesc(m[4]),
        };
      }
    };
    // A view that throws takes its own charts out of the index and nothing else.
    // Evidence, Legal, Rebuttals and the Tables chapter render from report.json,
    // which arrives on demand, so an index built before it lands is incomplete —
    // and an incomplete index must not be the one that gets cached.
    let complete = true;
    const safely = (fn, route) => {
      try { scan(fn(), route); } catch (err) { complete = false; console.error('index', route, err); }
    };
    DATA_CHAPTERS.forEach((c) => safely(() => dataView(c.id), `#/data/${c.id}`));
    safely(overview, '#/overview');
    safely(timelineView, '#/timeline');
    safely(rebuttalsView, '#/rebuttals');
    safely(statementsView, '#/statements');
    safely(legalView, '#/legal');
    safely(sourcesView, '#/sources');
    tourSteps().forEach((s, i) => safely(() => tourView(String(i + 1)), `#/tour/${i + 1}`));
    if (complete) CHART_INDEX = index;
    return index;
  }

  /* ---------- embed ---------- */

  /* One chart on an otherwise empty page, sized to whatever frame holds it, so
     the record can be quoted in place. A newsroom or a campaign that iframes a
     chart gets the figure, its caption, the report section it came from and a
     link back — the source travels with the number rather than being stripped
     off it, which is what happens when a chart is screenshotted instead. */
  function embedView(name) {
    const chart = chartIndex()[name];
    if (!chart) {
      return `<div class="embed-missing wrap">
        <p>No chart is registered under the name <b>${esc(name || '')}</b>.</p>
        <p><a href="#/api">See the list of embeddable charts</a>.</p>
      </div>`;
    }
    return `<div class="embed">
      <div class="embed-head">
        <h1>${esc(chart.title)}</h1>
        ${chart.note ? `<p>${esc(chart.note)}</p>` : ''}
      </div>
      <div class="chart" data-chart="${esc(chart.name)}" role="img" aria-label="${esc(chart.title)}"></div>
      <div class="embed-foot">
        <span>${chart.source ? esc(chart.source) + ' · ' : ''}Every figure carries its source.</span>
        <a href="${esc(SITE_ORIGIN + '/#' + chart.route.slice(1) + '&chart=' + chart.name)}"
           target="_blank" rel="noopener">The Documented Record ↗</a>
      </div>
    </div>`;
  }

  /* ---------- open data ---------- */

  /* The dashboard is a reader for a set of JSON files that are useful on their
     own. Publishing them as a described, addressable list — rather than leaving
     them as an implementation detail of this page — means the record can be
     checked, re-plotted and re-used by anyone, which is the whole point of
     holding it in the open. data/index.json is written by manifest.py. */
  function apiView() {
    const index = chartIndex();
    const names = Object.keys(index).sort();
    const sets = (D.manifest && D.manifest.datasets) || [];
    const bytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB');

    const embedExample = names.length ? names[0] : 'gaza-monthly';

    return `<div class="view wrap">
      <section class="section">
        ${head('Open data', 'The record as data, not just as a page',
          'Everything plotted here is held in plain JSON, served from this domain, under no login and no key. '
          + 'The files below are the same ones this page reads. Take them, check them, plot them yourself.')}
        <div class="grid c4">
          ${[
            { value: sets.length, label: 'Published datasets', note: 'each described, dated and addressable' },
            { value: names.length, label: 'Charts, individually embeddable', note: 'every one with its source attached' },
            {
              value: Math.round(((D.manifest && D.manifest.total_bytes) || 0) / 104857.6) / 10,
              unit: ' MB', label: 'Of published data', note: 'the complete set, uncompressed, over plain HTTPS',
            },
            { value: D.rmeta.bibliography_count, label: 'Sources behind it', note: 'courts, UN bodies, NGOs, datasets and academic work' },
          ].map((x, i) => statCard(x, ['', 'blue', '', 'amber'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The files', `${sets.length} datasets`, 'Licensed for re-use with attribution to the sources named in each file. '
          + 'The figures are not ours to licence — they belong to the bodies that recorded them, and each record says which.')}
        <div class="ds-list">
          ${sets.map((s) => `<div class="ds">
            <div>
              <h3><a href="${esc(s.path)}" target="_blank" rel="noopener">${esc(s.title)}</a>
                <code>${esc(s.path)}</code></h3>
              <p>${esc(s.description)}</p>
              ${s.source ? `<div class="src">${esc(s.source)}</div>` : ''}
            </div>
            <div class="ds-meta">
              ${esc(bytes(s.bytes))}${s.records ? `<br>${fmt(s.records)} records` : ''}<br>${esc(s.updated || '')}
              <a href="${esc(s.path)}" download>download ↓</a>
            </div>
            ${s.fields && s.fields.length ? `<div class="ds-fields">${s.fields.map(esc).join(' · ')}</div>` : ''}
          </div>`).join('')}
        </div>
        ${sets.length
          ? `<p class="small muted" style="margin-top:14px">${esc(D.manifest.licence)}
             The manifest itself is at <a href="data/index.json">data/index.json</a>, generated
             ${esc(D.manifest.generated)}.</p>`
          : '<p class="small muted">The manifest has not been built. Run <code>python3 manifest.py</code>.</p>'}
      </section>

      <section class="section">
        ${head('Embedding a chart', 'Any chart on this site, on any other site',
          'Each chart has its own address and renders on its own, with its caption and its source. '
          + 'The <b>embed</b> button on any chart copies the markup below with that chart’s name already in it.')}
        <div class="card">
          <pre class="code-block"><code>${esc(`<iframe src="${SITE_ORIGIN}/#/embed/${embedExample}"
        width="100%" height="460" loading="lazy" frameborder="0"
        title="${(index[embedExample] || {}).title || 'The Documented Record'}"></iframe>`)}</code></pre>
        </div>
        <div class="ds-list" style="margin-top:14px">
          ${names.map((n) => `<div class="ds">
            <div>
              <h3><a href="#/embed/${esc(n)}">${esc(index[n].title)}</a></h3>
              ${index[n].source ? `<div class="src">${esc(index[n].source)}</div>` : ''}
            </div>
            <div class="ds-meta">${esc(n)}<br><a href="${esc(index[n].route)}">on the page ↗</a></div>
          </div>`).join('')}
        </div>
      </section>
    </div>`;
  }

  /* ---------- changelog ---------- */

  /* Appendix F of the report is a dated log of every change made to it. A
     record that is revised without saying so is worth less than one that is
     not revised at all, so the log is a route of its own: what changed, when,
     and what it was changed to. */
  function changelogView() {
    const part = (D.report.parts || []).filter((p) => /revision-history/.test(p.id))[0];
    const blocks = (part ? part.blocks : []).filter((b) => b.type === 'paragraph');
    const DATED = /^\s*(?:<em>)?\s*(?:Update|Enhanced edition|[A-Z][a-z]+ \d{4} update)[^(]*\(([^)]+)\)\s*:\s*/;

    const entries = [];
    let preamble = '';
    blocks.forEach((b) => {
      const text = plain(b.html);
      const m = DATED.exec(text);
      if (!m) { if (!entries.length) preamble = b.html; return; }
      entries.push({ when: m[1], what: b.html.replace(/^(\s*<em>)?\s*[^(]*\([^)]+\)\s*:\s*/, '$1') });
    });

    // Newest first: a log is read from the present backwards.
    const key = (e) => {
      const d = Date.parse(e.when.replace(/^(\d+)\s/, '$1 '));
      return isNaN(d) ? 0 : d;
    };
    const ordered = entries.slice().sort((a, b) => key(b) - key(a));

    return `<div class="view wrap">
      <section class="section">
        ${head('Changelog', `${entries.length} dated revisions to the record`,
          'Every change to the source report, in the words of the report itself. Figures move because the '
          + 'bodies that count them publish again; findings are added as courts and commissions make them. '
          + 'Nothing is removed — the log says what was added and when.')}
        ${preamble ? `<p class="small muted">${preamble}</p>` : ''}
      </section>

      <section class="section">
        <div class="log">
          ${ordered.map((e) => `<div class="log-entry">
            <div class="log-when">${esc(e.when)}</div>
            <div class="log-what"><p>${e.what}</p></div>
          </div>`).join('')}
        </div>
      </section>

      <section class="section">
        ${head('How to check this', 'The record is auditable by design',
          'The report, the figures and the chronology are published as files, not as claims about files.')}
        <div class="grid c2">
          <a class="card lift" href="#/api" style="text-decoration:none">
            <h3 style="font-size:17px;margin-bottom:8px">The data, as data</h3>
            <p class="small muted" style="margin:0">Every dataset this page reads, described and downloadable.</p>
          </a>
          <a class="card lift" href="#/sources" style="text-decoration:none">
            <h3 style="font-size:17px;margin-bottom:8px">The sources</h3>
            <p class="small muted" style="margin:0">Courts, UN bodies, human rights organisations and open datasets, each one linked.</p>
          </a>
        </div>
      </section>
    </div>`;
  }

  /* ---------- per-route metadata ---------- */

  /* A hash route never reaches the server, so without this every route
     shares one title, one description and one social card. app.js rewrites
     the head from this table on each render, and prerender.py reads the
     result back out of the rendered DOM rather than keeping a second copy
     of it — so a static snapshot cannot disagree with the live page. */
  const SITE = 'The Documented Record';
  /* The deployed origin, taken from the canonical tag rather than from
     location, so an embed snippet copied from a local server still points a
     third-party site at the published one. */
  const SITE_ORIGIN = (function () {
    const tag = document.querySelector('link[rel=canonical]');
    const href = tag ? (tag.getAttribute('data-site') || tag.href) : location.href;
    return String(href).replace(/[#?].*$/, '').replace(/\/+$/, '');
  })();

  /* ---------- answer a claim ---------- */

  /* The rebuttals page answers a claim a reader has already identified. This
     route answers one they have only been handed: paste the post, the comment
     or the press line, and it says which of the twenty-three answers it is
     asking for and assembles a sourced reply.

     There is no language model behind it and no network call. Every phrase it
     recognises is written down in data/claim-patterns.json, the match is a
     boundary-anchored substring test, and the reply is built from the report's
     own refutation, the live headline figures with their sources, and the
     documented statements in the matching categories. Deterministic matters
     here for the same reason it matters everywhere else on this site: a reply
     a reader cannot check is worth nothing in the argument they are about to
     have, and a reply that is generated afresh each time cannot be checked at
     all. */

  // The eight live figures a pattern may name, resolved from the headline set
  // so the reply carries today's number rather than the number that was true
  // when the pattern was written. The ids are the ones claim-patterns.json
  // declares in meta.figure_ids; validate.py checks the two lists agree.
  const ANSWER_FIGURES = {
    killed: 'Palestinians killed in Gaza',
    children: 'Children killed in Gaza',
    injured: 'Injured in Gaza',
    displaced: 'Displaced in Gaza',
    'wb-killed': 'Killed in the West Bank',
    'settler-attacks': 'Settler attacks recorded',
    settlers: 'Settlers in occupied territory',
    recognising: 'States recognising Palestine',
  };

  function answerFigure(id) {
    const label = ANSWER_FIGURES[id];
    if (!label) return null;
    return (D.fig.headline || []).filter((f) => f.label === label)[0] || null;
  }

  /* Two statements per category at most, the highest tier first and the
     earliest of those, so the same claim always draws the same quotes. */
  function answerStatements(cats, limit) {
    const rank = ['Head of government', 'Head government', 'Cabinet', 'Legislature', 'Military'];
    const out = [];
    (D.statements.items || []).forEach((s, i) => {
      if (!cats.some((c) => s.cat.indexOf(c) >= 0)) return;
      out.push({ s: s, i: i, rank: rank.indexOf(s.tier) < 0 ? rank.length : rank.indexOf(s.tier) });
    });
    out.sort((a, b) => (a.rank - b.rank) || (a.s.sort < b.s.sort ? -1 : 1));
    return out.slice(0, limit || 2);
  }

  function answerView() {
    const P = D.patterns;
    const phrases = P.claims.reduce((n, c) => n + c.phrases.length, 0);

    const stats = [
      { value: P.claims.length, label: 'Claims recognised', note: 'the defences answered in Part XVI of the report, each with the wording it is actually made in' },
      { value: phrases, label: 'Phrases matched', note: 'written down in data/claim-patterns.json, not inferred — the same text always produces the same answer' },
      { value: D.statements.items.length, label: 'Statements to draw on', note: 'each with speaker, role, date and the verbatim words' },
      { value: 0, label: 'Models consulted', note: 'nothing is generated; the reply is assembled from the report, the live figures and the record' },
    ];

    const examples = [
      'The casualty numbers are inflated — they come from the Hamas-run health ministry and include combatants.',
      'Israel has the right to defend itself. Hamas hides behind civilians and uses them as human shields.',
      'There is no famine in Gaza. Israel lets the aid in and Hamas steals it.',
      'Anti-Zionism is antisemitism. From the river to the sea is a call to destroy Israel.',
      'There is no genocide. Hamas broke the ceasefire, and Israel honoured it.',
      'The Arabs rejected the partition plan, they were offered a state at Camp David, and BDS is antisemitic.',
    ];

    /* Everything it can recognise, listed on the page rather than left in the
       open-data file. A reader who pastes something and gets nothing back is
       entitled to know whether the claim is absent from the list or merely
       worded differently, and that question cannot be answered from a status
       line. The claims are in report order, which is also the order of Part XVI. */
    const catalogue = P.claims.map((c) => `<details class="answer-known">
      <summary><b>${esc(c.label)}</b>
        <span class="small muted">Rebuttal ${c.rebuttal} · ${c.phrases.length} wordings</span></summary>
      <p class="small muted">Recognised on, among others:
        ${c.strong.map((s) => `<code>${esc(s)}</code>`).join(' ')}</p>
      <p class="small"><a href="#/rebuttals/${c.rebuttal}">Read the answer in full</a></p>
    </details>`).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Answer a claim', 'Paste it, and read what the record says',
          'Paste a post, a comment, a press line or a minister’s quote. Every phrase the record recognises is '
          + 'highlighted, and the answers it is asking for are assembled underneath: the refutation from the report, '
          + 'the figures with their sources, and the documented words of the officials involved. No language model is '
          + 'used and nothing is sent anywhere — the matching runs in this page, against a list of phrases you can read.')}
        <div class="grid c4">
          ${stats.map((x, i) => statCard(x, ['blue', '', 'amber', 'green'][i])).join('')}
        </div>
      </section>

      <section class="section">
        <div class="card answer-box">
          <label class="answer-label" for="answer-input">The claim, as it was made</label>
          <textarea id="answer-input" rows="6" placeholder="Paste the post, the comment or the quote here…"></textarea>
          <div class="answer-tools">
            <button class="chart-tool primary" id="answer-run">Answer it</button>
            <button class="chart-tool" id="answer-clear">Clear</button>
            <span class="small muted" id="answer-status">Nothing pasted yet.</span>
          </div>
          <div class="answer-examples">
            <span class="small muted">Or try one:</span>
            ${examples.map((e, i) => `<button class="chip" data-example="${i}">${esc(e.slice(0, 46))}…</button>`).join('')}
          </div>
          <script type="application/json" id="answer-examples-data">${JSON.stringify(examples)}</script>
        </div>
      </section>

      <section class="section" id="answer-read-wrap" hidden>
        ${head('What was recognised', 'The text, with every matched phrase marked',
          'A phrase is matched on word boundaries and nothing else is read into it. If the marking looks wrong, the '
          + 'phrase list is published in the open data and can be corrected.')}
        <div class="card answer-read" id="answer-read"></div>
      </section>

      <section class="section" id="answer-results-wrap" hidden>
        ${head('The answer', 'Assembled from the record', 'Ranked by how much of the pasted text each one accounts for. '
          + 'Every line below is read out of the report, the live figures or the documented statements at the moment '
          + 'you press the button, so a reply copied from here carries today’s numbers. A claim marked '
          + '<b>named</b> matched a phrase that states it; one marked <b>touched on</b> matched only wording that '
          + 'surrounds it, and may be there for another reason.')}
        <div class="answer-tools">
          <button class="chart-tool primary" id="answer-copy-all">Copy every answer</button>
          <span class="small muted" id="answer-copy-note"></span>
        </div>
        <div id="answer-results"></div>
      </section>

      <section class="section">
        ${head('Everything it recognises', `The ${P.claims.length} claims, and the wording each is recognised by`,
          'The whole list, so that a claim which produced no answer can be told apart from a claim this record '
          + 'has no answer for. The full phrase set — all ' + phrases + ' of them — is in the open data.')}
        <div class="grid c3">${catalogue}</div>
      </section>

      <section class="section">
        ${head('What this is not', 'The limits, stated', '')}
        <div class="grid c3">
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">It does not read meaning</h3>
            <p class="small muted">It matches phrases. A claim made in wording nobody has written down yet will not be
            recognised, and a phrase used to make the opposite point will be. What it recognised is shown above so the
            reader can see which it was.</p>
          </div>
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">It does not write anything</h3>
            <p class="small muted">Every sentence in the reply already exists: the refutation is Part XVI of the report
            reproduced word for word, the figures are the live series with their sources attached, and the quotes are
            the documented statements with speaker, role and date.</p>
          </div>
          <div class="card">
            <h3 style="font-size:17px;margin-bottom:10px">It does not send your text anywhere</h3>
            <p class="small muted">The matching runs in this page. Nothing is uploaded, logged or stored, and the site
            has no server to send it to — the whole record is static files.
            <a href="#/api">The phrase list is open data</a> like everything else here, and the whole list of
            claims is printed above rather than left in the file.</p>
          </div>
        </div>
      </section>
    </div>`;
  }

  /* ---------- provenance ---------- */

  /* The record is a graph, not a list, and this route is where that graph is
     visible: every curated claim joined to the bodies it rests on, and every
     source string normalised to an entity with an identity of its own. The
     reason to build it is the objection it answers. The commonest argument
     against this record is not that a figure is wrong but that a class of
     source cannot be trusted — the Gaza Ministry of Health, the UN, the human
     rights organisations, the Israeli press. That argument is usually met by
     defending the source. It is met here by removing it: take a whole class
     out, recount, and read what still stands on the rest. The counts are
     computed by provenance.py and shipped in data/provenance.json, so the
     figures on this page are the same figures the open-data file carries. */

  // Where a claim lives, so a reader who pulls the thread arrives at the page
  // that states it rather than at a file name.
  const PROV_ROUTES = {
    'figures.json': '#/data',
    'statements.json': '#/statements',
    'elements.json': '#/legal',
    'legal.json': '#/legal',
    'conduct-record.json': '#/data/gaza',
    'long-record.json': '#/data/since-1948',
    'war-record.json': '#/data/wars',
    'children.json': '#/children',
    'history.json': '#/data/west-bank',
    'maps.json': '#/data/land',
    'nakba.json': '#/data/land',
    'world-positions.json': '#/data/world',
    'chronology.json': '#/timeline',
    'timeline-extra.json': '#/timeline',
  };

  const PROV_FILE_LABELS = {
    'figures.json': 'Headline figures',
    'statements.json': 'Statements of intent',
    'elements.json': 'Legal elements',
    'legal.json': 'Determinations',
    'conduct-record.json': 'Conduct of the war',
    'long-record.json': 'The long record',
    'war-record.json': 'The wars',
    'children.json': 'The children’s record',
    'history.json': 'The baseline',
    'maps.json': 'Maps',
    'nakba.json': 'The villages of 1948',
    'world-positions.json': 'World positions',
    'chronology.json': 'Chronology',
    'timeline-extra.json': 'Chronology',
  };

  function provenanceView() {
    const P = D.prov;
    const S = P.summary;
    const origins = P.meta.origins.filter((o) => o.sources);
    const byId = {};
    P.sources.forEach((s) => { byId[s.id] = s; });
    const hardest = P.switches.reduce((a, b) => (b.share < a.share ? b : a), P.switches[0]);

    const stats = [
      { value: S.claims, label: 'Curated claims', note: 'every figure, statement, determination and record entry that carries a source, across ' + P.files.length + ' data files' },
      { value: S.sources, label: 'Distinct sources', note: 'source strings normalised to entities, each with a stable identifier and a classified origin' },
      { value: S.independent, label: 'Claims on two or more classes of source', note: 'a figure attested by bodies with no common controller does not fall when one of them is rejected' },
      { value: hardest.share, unit: '<span class="suffix">%</span>', label: 'Still standing at the hardest setting', note: esc(hardest.label.toLowerCase()) + ' — ' + hardest.stands + ' of ' + S.attributed + ' attributed claims' },
    ];

    const switchChips = [`<button class="chip active" data-switch="none">Every source<span>${S.attributed}</span></button>`]
      .concat(P.switches.map((s) => `<button class="chip" data-switch="${esc(s.id)}">${esc(s.label)}<span>${s.stands}</span></button>`)).join('');

    const originRow = (o) => `<tr data-origin="${esc(o.id)}">
      <td>${esc(o.label)}</td>
      <td class="num">${o.sources}</td>
      <td class="num">${o.claims}</td>
    </tr>`;

    const sourceRow = (s) => `<tr class="prov-src" data-origin="${esc(s.origin)}" data-name="${esc((s.name + ' ' + s.origin_label).toLowerCase())}">
      <td>${esc(s.name)}</td>
      <td class="muted">${esc(s.origin_label)}</td>
      <td class="num">${s.claims}</td>
    </tr>`;

    const claimRow = (c) => {
      const originIds = [];
      c.sources.forEach((sid) => {
        const s = byId[sid];
        if (s && originIds.indexOf(s.origin) < 0) originIds.push(s.origin);
      });
      const names = c.sources.map((sid) => (byId[sid] ? byId[sid].name : sid));
      const chain = c.sources.map((sid, i) => `<span class="prov-chip" data-origin="${esc(byId[sid] ? byId[sid].origin : '')}">${esc(names[i])}</span>`).join('');
      const route = PROV_ROUTES[c.file] || '#/overview';
      const value = c.numeric ? fmt(c.value) : String(c.value || '');
      return `<li class="prov-claim" data-origins="${esc(originIds.join(' '))}" data-file="${esc(c.file)}"
          data-text="${esc((c.label + ' ' + value + ' ' + c.source_text + ' ' + names.join(' ') + ' ' + c.sources.join(' ')).toLowerCase())}" id="prov-${esc(c.id)}">
        <div class="prov-claim-head">
          <a href="${route}" class="prov-label">${esc(c.label || PROV_FILE_LABELS[c.file] || c.file)}</a>
          ${c.date ? `<span class="prov-date">${esc(c.date)}</span>` : ''}
          ${c.ref ? `<span class="prov-ref">${esc(c.ref)}</span>` : ''}
        </div>
        ${value ? `<div class="prov-value">${esc(value)}</div>` : ''}
        <div class="prov-chain">${chain || '<span class="prov-chip none">no source recorded</span>'}</div>
        <div class="prov-src-text">${esc(c.source_text || '—')}</div>
      </li>`;
    };

    const fileChips = [`<button class="chip active" data-file="all">All<span>${S.claims}</span></button>`]
      .concat(P.files.map((f) => `<button class="chip" data-file="${esc(f.file)}">${esc(PROV_FILE_LABELS[f.file] || f.file)}<span>${f.claims}</span></button>`)).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Provenance', 'Pull the thread', 'Every curated claim on this site, joined to the bodies it rests on. '
          + 'Source strings are normalised to entities with stable identifiers, and each entity is classified by who '
          + 'controls the body that published it — not by where it files its accounts. That classification is what makes '
          + 'the switch below possible: reject a whole class of source, and read what still stands on the rest.')}
        <div class="grid c4">
          ${stats.map((x, i) => statCard(x, ['blue', '', 'green', 'amber'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The adversary switch', 'Reject a class of source, and recount',
          'The commonest objection to a record like this one is not that a figure is wrong. It is that a class of source '
          + 'cannot be trusted. The answer here is not to defend the source but to remove it. Each setting deletes every '
          + 'body of that class and recounts what is left: a claim stands if it still has one source outside the classes '
          + 'removed, and falls if it does not. Nothing else on the page changes.')}
        <div class="chips" id="prov-switch">${switchChips}</div>
        <div class="card prov-panel" id="prov-panel"></div>
        ${chartCard('provenance-switch', 'What survives each rejection',
          'The share of attributed claims that still rest on at least one source outside the class removed.', 'data/provenance.json')}
      </section>

      <section class="section">
        ${head('The classes', 'Who controls the body that published it', 'Sources are classified by controller, because that is what '
          + 'the objection is actually about. A claim counts once for a class however many of that class’s bodies it cites.')}
        <div class="grid c2">
          <div class="card">
            <div class="table-wrap"><table>
              <thead><tr><th>Class of source</th><th class="num">Bodies</th><th class="num">Claims</th></tr></thead>
              <tbody id="prov-origins">${origins.map(originRow).join('')}</tbody>
            </table></div>
          </div>
          ${chartCard('provenance-origins', 'Claims by class of source',
            'A claim resting on bodies of several classes is counted under each, so these do not sum to the total.', 'data/provenance.json', 'tall')}
        </div>
      </section>

      <section class="section">
        ${head('The sources', `${S.sources} bodies, and what each one is holding up`,
          'Sorted by the number of claims that rest on it. A body removed by the current setting is struck through.')}
        <div class="tl-controls">
          <input type="search" id="prov-src-search" placeholder="Search sources…" autocomplete="off">
          <span class="small muted" id="prov-src-count"></span>
        </div>
        <div class="card">
          <div class="table-wrap"><table>
            <thead><tr><th>Source</th><th>Class</th><th class="num">Claims</th></tr></thead>
            <tbody id="prov-sources">${P.sources.map(sourceRow).join('')}</tbody>
          </table></div>
        </div>
      </section>

      <section class="section">
        ${head('The claims', `${S.claims} claims, each with its chain`,
          'Every curated record that carries a source, with the source text it was written with and the entities that text '
          + 'resolves to. Filter by where the claim lives, search the text, or set the switch above and watch the claims that '
          + 'fall grey out.')}
        <div class="chips" id="prov-files">${fileChips}</div>
        <div class="tl-controls">
          <input type="search" id="prov-search" placeholder="Search claims, values and source text…" autocomplete="off">
          <span class="small muted" id="prov-count"></span>
        </div>
        <ul class="prov-claims" id="prov-claims">${P.claims.map(claimRow).join('')}</ul>
        <p class="chart-note" style="margin-top:22px">Generated by provenance.py on ${esc(P.meta.generated)} from the curated data files.
          ${S.unattributed} claims carry no source: those are the places where the record states that no published source exists.</p>
      </section>
    </div>`;
  }

  /* ---------- the accountability ledger ----------

     States are what the rest of this site counts, and states are not what
     international criminal law punishes. A warrant names a person; a sanction
     freezes a person's assets; a divestment sells a company's shares. This view
     is the record re-cut along that axis, and it composes nothing: the offices
     and the quotes come from the statements file, the sections come from the
     report, the measures come from the world-positions file, and entities.py
     does the joining before the page is ever loaded. */

  const LEDGER_SECTORS = {
    arms: 'Arms and components',
    technology: 'Technology and data',
    finance: 'Finance',
    energy: 'Fuel',
    equipment: 'Heavy equipment',
  };

  const STANCE_LABELS = {
    'would-enforce': 'Has indicated it would execute the warrant',
    refused: 'Has acted to defeat the warrant',
    'non-party': 'Not a party to the Rome Statute',
    other: 'Has acted outside the Court',
  };

  /* A section of the report, linked so that a click lands on the text itself
     rather than on the page that summarises it. */
  function ledgerSection(m) {
    return `<a class="led-sec" href="#sec-${esc(m.id)}" data-sec="sec-${esc(m.id)}">${esc(m.title)}<span>${m.n}</span></a>`;
  }

  /* The statements are held by index, not by copy: entities.json stores the
     position of each one in data/statements.json, so the words on this page are
     the same object the statements page renders. */
  function ledgerStatement(i) {
    const s = D.statements.items[i];
    return `<blockquote class="led-quote">
      <p>${esc(s.quote)}</p>
      <cite>${esc(s.date)} · ${esc(s.role)}<span class="led-cite-src">${esc(s.source)}</span></cite>
    </blockquote>`;
  }

  function ledgerPerson(p) {
    const badges = [
      p.warrant ? '<span class="led-badge warrant">ICC arrest warrant</span>' : '',
      p.sanctions.length ? `<span class="led-badge sanction">Sanctioned by ${p.sanctions.reduce((n, s) => n + s.by.length, 0)} state${p.sanctions.reduce((n, s) => n + s.by.length, 0) === 1 ? '' : 's'}</span>` : '',
      p.statements.length ? `<span class="led-badge">${p.statements.length} documented statement${p.statements.length === 1 ? '' : 's'}</span>` : '',
      p.sections ? `<span class="led-badge">${p.sections} mention${p.sections === 1 ? '' : 's'} in the report</span>` : '',
    ].filter(Boolean).join('');

    const warrant = p.warrant ? `<div class="led-block warrant">
      <h4>Arrest warrant — ${esc(p.warrant.court)}, ${esc(p.warrant.date)}</h4>
      <p class="led-counts">${esc(p.warrant.counts)}</p>
      <p class="led-status"><b>Status.</b> ${esc(p.warrant.status)}</p>
      <span class="led-ref">${esc(p.warrant.ref)}</span>
    </div>` : '';

    const sanctions = p.sanctions.length ? `<div class="led-block">
      <h4>Measures against this person</h4>
      ${p.sanctions.map((s) => `<div class="led-measure ${s.direction === 'accountability' ? 'inverted' : ''}">
        <div class="led-measure-head"><b>${esc(s.measure)}</b><span>${esc(s.date)}</span></div>
        <div class="led-by">${s.by.map((c) => `<span class="led-state">${esc(c)}</span>`).join('')}</div>
        <p>${esc(s.reason)}</p>
        <span class="led-ref">${esc(s.ref)}</span>
      </div>`).join('')}
    </div>` : '';

    const quotes = p.statements.length ? `<div class="led-block">
      <h4>In their own words</h4>
      ${p.statements.slice().reverse().map(ledgerStatement).join('')}
    </div>` : '';

    const secs = p.mentions.length ? `<div class="led-block">
      <h4>Where the report deals with them</h4>
      <div class="led-secs">${p.mentions.map(ledgerSection).join('')}</div>
    </div>` : '';

    return `<details class="led-person" data-class="${esc(p.class)}"
        data-flags="${p.warrant ? 'warrant ' : ''}${p.sanctions.length ? 'sanctioned ' : ''}${p.statements.length ? 'quoted' : ''}"
        data-text="${esc((p.name + ' ' + p.role + ' ' + (p.country || '') + ' '
          + p.statements.map((i) => D.statements.items[i].quote).join(' ')).toLowerCase())}"
        id="led-${esc(p.id)}">
      <summary>
        <div class="led-name">${esc(p.name)}</div>
        <div class="led-role">${esc(p.role)}</div>
        <div class="led-badges">${badges}</div>
      </summary>
      <div class="led-body">${warrant}${sanctions}${quotes}${secs}</div>
    </details>`;
  }

  function ledgerCompany(c) {
    return `<details class="led-person led-company" data-sector="${esc(c.sector)}"
        data-text="${esc((c.name + ' ' + c.country + ' ' + c.supplies + ' ' + c.note).toLowerCase())}" id="led-${esc(c.id)}">
      <summary>
        <div class="led-name">${esc(c.name)}</div>
        <div class="led-role">${esc(c.country)} · ${esc(LEDGER_SECTORS[c.sector] || c.sector)}</div>
        <div class="led-badges"><span class="led-badge">${esc(c.supplies.split('. ')[0])}</span></div>
      </summary>
      <div class="led-body">
        <div class="led-block">
          <h4>What it supplies</h4>
          <p>${esc(c.supplies)}</p>
        </div>
        <div class="led-block">
          <h4>What is on the record</h4>
          <p>${esc(c.note)}</p>
          ${c.ref ? `<span class="led-ref">${esc(c.ref)}</span>` : `<span class="led-ref">${esc(c.source || '')}</span>`}
        </div>
        ${c.mentions.length ? `<div class="led-block">
          <h4>Where the report deals with it</h4>
          <div class="led-secs">${c.mentions.map(ledgerSection).join('')}</div>
        </div>` : ''}
      </div>
    </details>`;
  }

  function ledgerView() {
    const E = D.entities;
    const M = E.meta;
    const quoted = E.persons.filter((p) => p.statements.length).length;

    const stats = [
      { value: M.persons, label: 'Persons on the ledger', note: 'each named by the report, by a court, or by a documented statement of their own' },
      { value: M.warrants, label: 'ICC arrest warrants', note: 'two against Israeli ministers and one against a Hamas commander, issued on the same day to the same standard' },
      { value: M.sanctioned, label: 'Persons under sanction', note: 'and the direction runs both ways — two Israeli ministers for incitement, eight court officers and a UN mandate holder for pursuing the case' },
      { value: M.parties, label: 'States bound to arrest', note: 'every state party to the Rome Statute, under Articles 86 and 89(1)' },
    ];

    const classChips = [`<button class="chip active" data-class="all">Everyone<span>${M.persons}</span></button>`]
      .concat(E.classes.map((c) => {
        const n = E.persons.filter((p) => p.class === c.id).length;
        return n ? `<button class="chip" data-class="${esc(c.id)}">${esc(c.label)}<span>${n}</span></button>` : '';
      })).join('');

    const flagChips = [
      ['all', 'Any standing', M.persons],
      ['warrant', 'Under warrant', E.persons.filter((p) => p.warrant).length],
      ['sanctioned', 'Under sanction', E.persons.filter((p) => p.sanctions.length).length],
      ['quoted', 'Quoted in the record', quoted],
    ].map((f, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-flag="${f[0]}">${f[1]}<span>${f[2]}</span></button>`).join('');

    const sectors = Object.keys(LEDGER_SECTORS).filter((s) => E.companies.some((c) => c.sector === s));
    const sectorChips = [`<button class="chip active" data-sector="all">All${'<span>' + E.companies.length + '</span>'}</button>`]
      .concat(sectors.map((s) => `<button class="chip" data-sector="${esc(s)}">${esc(LEDGER_SECTORS[s])}<span>${E.companies.filter((c) => c.sector === s).length}</span></button>`)).join('');

    const stances = ['would-enforce', 'refused', 'non-party', 'other'];
    const positions = stances.map((st) => {
      const rows = E.icc.positions.filter((p) => p.stance === st);
      if (!rows.length) return '';
      return `<div class="led-stance ${esc(st)}">
        <h4>${esc(STANCE_LABELS[st])}<span>${rows.length}</span></h4>
        ${rows.map((r) => `<div class="led-pos"><b>${esc(r.name)}</b> ${esc(r.detail)} <span class="led-ref">${esc(r.ref)}</span></div>`).join('')}
      </div>`;
    }).join('');

    return `<div class="view wrap">
      <section class="section">
        ${head('Ledger', 'Persons and companies, not only states', 'International criminal law does not punish a state. It names a person, and it reaches a company through its shareholders and its clients. '
          + 'This page cuts the same record along that axis: who holds the office, what they said on the day, which court has issued what, which governments have acted, and which firms supply the means. '
          + 'Nothing here is new evidence — every line is joined from the statements, the report and the world-positions data already on this site.')}
        <div class="grid c4">
          ${stats.map((x, i) => statCard(x, ['red', 'amber', 'blue', 'green'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The persons', `${M.persons} named individuals`, 'Ordered by what has actually happened to them: a warrant first, then a sanction, then the weight of the record against them. '
          + 'Open any name for the warrant and its status, the measures taken by which states, the verbatim statements, and every section of the report that deals with them.')}
        <div class="chips" id="led-classes">${classChips}</div>
        <div class="chips" id="led-flags">${flagChips}</div>
        <div class="tl-controls">
          <input type="search" id="led-search" placeholder="Search names, offices and quotes…" autocomplete="off">
          <span class="small muted" id="led-count"></span>
        </div>
        <div class="led-list" id="led-persons">${E.persons.map(ledgerPerson).join('')}</div>
      </section>

      <section class="section">
        ${head('The arrest map', 'Where the warrant bites', 'A warrant is enforced by states, one border at a time. Every state party to the Rome Statute is bound by Article 86 to cooperate with the Court and by Article 89(1) to comply with a request for arrest and surrender. '
          + 'The map shades all ' + M.parties + ' of them, marks the five that have given notice of withdrawal — each still bound for the year that notice takes to run — and marks the states whose position the record actually documents.')}
        ${chartCard('arrest-map', 'The 125 states bound to execute the warrant',
          'Shaded by obligation, not by intention. A state party that has said nothing is still bound; the stated positions are listed underneath.', '§15.5', 'tall')}
        <div class="led-stances">${positions}</div>
        <p class="chart-note" style="margin-top:18px">${esc(E.icc.note)}</p>
      </section>

      <section class="section">
        ${head('The companies', `${E.companies.length} firms named in the record`, 'A listing is not a criminal charge. What each entry records is a documented commercial relationship — what the firm supplies, who reported it, and what shareholders have done about it. '
          + 'The UN database that sits behind the settlement half of this question is the only official list of its kind, and it has grown at every revision.')}
        <div class="chips" id="led-sectors">${sectorChips}</div>
        <div class="led-list" id="led-companies">${E.companies.map(ledgerCompany).join('')}</div>
        <p class="chart-note" style="margin-top:22px">Generated by entities.py from data/entities.json, joined to the statements, the report and the world-positions data. Section references point at the report text itself.</p>
      </section>

      <section class="section">
        ${head('One level down', 'The member who holds your seat', 'This page names the people a court has named. '
          + 'There is a second ledger for the people a reader elected: all 649 seats in the House of Commons, '
          + 'how each member voted the three times the House divided on Gaza, and what the Register of Members\u2019 '
          + 'Financial Interests and the Electoral Commission record against their name. It is the only part of '
          + 'this record that a constituent can put to somebody directly.')}
        <div class="led-secs">
          <a class="led-sec" href="#/mp">The constituency ledger<span>649 seats</span></a>
        </div>
      </section>
    </div>`;
  }

  const SITE_TITLE = `${SITE} — Israel and the Occupied Territories, 1917–2026`;
  const SITE_DESC = 'Every figure carries its source. A forensic survey of state conduct, alleged '
    + 'violations of international law, and the documented record — 1917 to 2026.';

  const META = {
    overview: { title: SITE_TITLE, desc: SITE_DESC },
    tour: {
      title: 'Start here — the case in eight steps',
      desc: 'A guided path through the record: the toll, the asymmetry, the stated intent, the law it '
        + 'engages, and what states have and have not done about it.',
    },
    data: {
      title: 'The data — every figure in the record, plotted',
      desc: 'Nine chapters of charts and maps, from the Gaza daily toll to the land, the wars, the arms '
        + 'and the world’s response. Every figure carries its source.',
    },
    timeline: {
      title: 'Timeline — a dated chronology, 1917–2026',
      desc: 'Two chronologies in one: the record of major crimes and massacres, set against the mandates, '
        + 'laws, plans, rulings and admissions between them.',
    },
    ledger: {
      title: 'Ledger — the persons and companies named in the record',
      desc: 'Who holds the office, what they said, which court has issued a warrant, which states have '
        + 'sanctioned whom, and which firms supply the means.',
    },
    evidence: {
      title: 'Evidence — the complete report',
      desc: 'The source report reproduced without omission — every part, section, list and table, exactly '
        + 'as it stands.',
    },
    rebuttals: {
      title: 'Rebuttals — every defence, answered',
      desc: 'Each argument made in defence of the conduct documented here, answered on its own legal terms '
        + 'and with the figures that settle it.',
    },
    statements: {
      title: 'Statements — the documented record of intent',
      desc: 'Statements by named officials, each with speaker, role, date, the verbatim quote, and the '
        + 'legal significance of what was said.',
    },
    legal: {
      title: 'Legal — the findings and the instruments they rest on',
      desc: 'The ICJ proceedings, the ICC warrants, and the findings made under the Genocide Convention, '
        + 'the Fourth Geneva Convention and the Apartheid Convention.',
    },
    answer: {
      title: 'Answer a claim — paste it, and read what the record says',
      desc: 'Paste a post or a quote and the record marks every claim it recognises, then assembles the answer '
        + 'from the report, the live figures and the documented statements.',
    },
    provenance: {
      title: 'Provenance — pull the thread',
      desc: 'Every claim joined to the bodies it rests on, with a switch that rejects a whole class of source '
        + 'and recounts what still stands without it.',
    },
    sources: {
      title: 'Sources — what the record rests on',
      desc: 'The evidentiary base: courts, UN bodies, human rights organisations, open datasets, academic '
        + 'work and Israeli sources, each one linked.',
    },
    api: {
      title: 'Open data — the record as files',
      desc: 'Every dataset behind these charts, published as plain JSON under no login and no key, with '
        + 'an embeddable address for each of the charts drawn from them.',
    },
    changelog: {
      title: 'Changelog — every revision, dated',
      desc: 'What changed in the record and when: each figure refreshed, each finding added, in the words '
        + 'of the report itself.',
    },
    children: {
      title: 'The children — every child the record can count',
      desc: 'A unit chart of the children killed on both sides, period by period, one figure drawn '
        + 'per child, with the years no one counted left as gaps and every figure carrying its source.',
    },
    day: {
      title: 'Said and done — the war, one day at a time',
      desc: 'One scrubbable axis of days. Pick any day of the war and read the toll it added, what was said that '
        + 'day, what had been ordered, what was happening, and what was allowed across the crossings.',
    },
    method: {
      title: 'Method — impartial, not neutral',
      desc: 'The standard of proof this record runs on, the distinction between impartiality and '
        + 'neutrality, three objections answered, and the conditions under which these findings would fail.',
    },
    embed: {
      title: 'Embedded chart',
      desc: 'A single chart from the documented record, with its caption and its source.',
    },
  };

  const CHAPTER_META = {
    'gaza': {
      title: 'Gaza — the toll since 7 October 2023',
      desc: 'The Gaza death toll day by day: the children, the aid seekers, the starvation deaths, the '
        + 'famine classification and the hospitals.',
    },
    'asymmetry': {
      title: 'The asymmetry — Palestinians and Israelis killed',
      desc: 'The two tolls set side by side, period by period, and the ratio between them from 1948 to 2026.',
    },
    'since-1948': {
      title: 'Since 1948 — seventy-eight years of the toll',
      desc: 'The long death toll from 1948 to 2026, and the periods for which no one kept a count.',
    },
    'complicity': {
      title: 'Complicity — who supplies the war',
      desc: 'Arms transfers, trade, Security Council vetoes, and the companies named in the UN database of '
        + 'businesses operating in the settlements.',
    },
    'land': {
      title: 'The land — six per cent to seventy-eight',
      desc: 'Where the land went, from the 1947 partition to the settlements of 2026, with the villages '
        + 'depopulated in 1948 mapped one by one.',
    },
    'west-bank': {
      title: 'The West Bank — before and after October 2023',
      desc: 'Killings, settler attacks, demolitions, displacement, and Palestinian children in the Israeli '
        + 'military courts.',
    },
    'wars': {
      title: 'Wars and 7 October — seventy-five years of operations',
      desc: 'Each Gaza campaign and what the inquiries into it found, alongside the documented record of '
        + '7 October 2023.',
    },
    'world': {
      title: 'The world — recognition, embargoes and vetoes',
      desc: 'Who recognises Palestine, who has imposed an arms embargo, who intervened at the ICJ, and who '
        + 'has vetoed.',
    },
    'tables': {
      title: 'Source tables — every table in the report',
      desc: 'Each table from the source report reproduced exactly, with the part and section it belongs to.',
    },
  };

  function meta(name, sub) {
    const chapter = name === 'data' && CHAPTER_META[sub] ? CHAPTER_META[sub] : null;
    const m = chapter || META[name] || META.overview;
    const slug = chapter ? `data-${sub}` : (META[name] ? name : 'overview');
    // An embedded chart names itself; it has no card of its own, so it borrows
    // the site card, and its canonical URL keeps the chart it is showing.
    const embedded = slug === 'embed' ? (chartIndex()[sub] || null) : null;
    const path = chapter ? `#/data/${sub}`
      : slug === 'embed' ? `#/embed/${sub || ''}`
      // The tour has no meaningful step 0, so its canonical route is step one.
      : slug === 'tour' ? '#/tour/1'
      : `#/${slug}`;
    return {
      slug,
      path,
      title: slug === 'overview' ? m.title
        : `${embedded ? embedded.title : m.title} · ${SITE}`,
      desc: embedded ? (embedded.note || m.desc) : m.desc,
      card: `assets/og/${slug === 'embed' ? 'overview' : slug}.png`,
    };
  }

  /* ---------- method ---------- */

  /* The Preamble of the report, carried onto the site as a route of its own.
     The claim being made here is narrow and it is the one most often
     misstated, so it is published where a reader can reach it without first
     opening a hundred-thousand-word document: the method is impartial, the
     conclusions are not neutral, and the difference between those two words is
     the whole of it. Everything on this page is reproduced from the Preamble
     to report-final.md, which remains the source of record. */
  /* ---------- the constituency ledger ---------- */

  /* The scorecard holds a row for the United Kingdom and Part XIII.3 sets out
     what that row rests on. Both are addressed to a state, and a state is not
     a thing a reader can write to. This view cuts the same record along the
     axis they can act on: the seat they live in, the member who holds it, how
     that member voted when the House divided on Gaza, and what the two public
     registers record against their name.

     Nothing here is an accusation. A registered interest is a disclosure the
     member made under the rules and a reported donation is a lawful, published
     gift. What the page does is put the disclosure beside the vote, which none
     of the four registers does, because each is published on its own. */

  const gbp = (n) => '\u00a3' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 });

  const VOTE_LABEL = {
    aye: 'Voted for', 'aye-teller': 'Teller for', no: 'Voted against',
    'no-teller': 'Teller against', absent: 'Did not vote', 'not-a-member': 'Not yet elected',
  };

  function mpVote(cast) {
    const kind = (cast || '').replace('-teller', '');
    return `<span class="mp-vote v-${esc(kind)}">${esc(VOTE_LABEL[cast] || cast)}</span>`;
  }

  function mpDivisionCard(d) {
    const still = d.still_here || {};
    return `<div class="card mp-div" id="division-${d.id}">
      <div class="mp-div-head">
        <h3>${esc(d.title)}</h3>
        <span class="mp-div-date">${esc(longDay(d.date))}</span>
      </div>
      <p class="mp-div-formal">${esc(d.formal)} · ${esc(d.moved)}</p>
      <blockquote class="led-quote"><p>${esc(d.question)}</p><cite>A vote for it meant: ${esc(d.aye_means)}</cite></blockquote>
      <div class="mp-tally">
        <span class="mp-count aye"><b>${fmt(d.ayes)}</b> for</span>
        <span class="mp-count no"><b>${fmt(d.noes)}</b> against</span>
        <span class="mp-result">${esc(d.result)}</span>
      </div>
      <p class="chart-note">${esc(d.note)}</p>
      <p class="mp-div-now">Of the ${fmt(d.sitting)} members who sat in that division and still hold a seat:
        <b>${fmt(still.aye || 0)}</b> voted for it, <b>${fmt(still.no || 0)}</b> against,
        and <b>${fmt(still.absent || 0)}</b> did not vote.</p>
      <a class="led-ref" href="${esc(d.source)}" target="_blank" rel="noopener noreferrer">The division list at votes.parliament.uk</a>
    </div>`;
  }

  function mpRow(m, divisions, index) {
    const extra = (m.interests || []).length + (m.donations || []).length;
    const badges = divisions.map((d) => {
      const cast = m.votes[String(d.id)];
      return `<span class="mp-cell" title="${esc(d.title)}"><b>${esc(d.short)}</b>${mpVote(cast)}</span>`;
    }).join('');
    const summary = `<div class="mp-who">
        <b>${esc(m.name)}</b>
        <span class="mp-seat">${esc(m.seat)}</span>
      </div>
      <span class="mp-party" style="--party:#${esc(m.colour || '777777')}">${esc(m.abbr || m.party)}</span>
      <div class="mp-votes">${badges}</div>
      ${extra ? `<span class="mp-flag">${extra} register ${extra === 1 ? 'entry' : 'entries'}</span>` : ''}`;
    const blocks = [];
    if (m.seats_then) {
      blocks.push(`<div class="mp-block"><h4>The seat they held then</h4>
        ${divisions.filter((d) => m.seats_then[String(d.id)]).map((d) =>
          `<p>${esc(longDay(d.date))} — ${esc(m.seats_then[String(d.id)])}</p>`).join('')}
        <p class="chart-note">The 2024 election redrew the boundaries, so a vote cast before it was
          cast for a different seat, and in some cases for one that no longer exists. The ledger
          attributes a vote to the person who cast it, never to the constituency.</p></div>`);
    }
    if (m.interests) {
      blocks.push(`<div class="mp-block"><h4>Registered interests</h4>
        ${m.interests.map((i) => `<div class="mp-interest">
          <p>${esc(i.summary)}</p>
          <div class="mp-meta">${esc(i.category)}${i.sponsor ? ` · paid for by ${esc(i.sponsor)}` : ''}${i.value ? ` · ${esc(String(i.value))}` : ''}${i.registered ? ` · registered ${esc(longDay(i.registered))}` : ''}</div>
        </div>`).join('')}</div>`);
    }
    if (m.donations) {
      const total = m.donations.reduce((sum, g) => sum + g.value, 0);
      blocks.push(`<div class="mp-block"><h4>Reported donations — ${esc(gbp(total))}</h4>
        ${m.donations.map((g) => `<div class="mp-interest">
          <p><b>${esc(gbp(g.value))}</b> from ${esc(g.donor)}</p>
          <div class="mp-meta">${esc(g.date)}${g.type ? ` · ${esc(g.type)}` : ''}${g.nature ? ` · ${esc(g.nature)}` : ''}${g.purpose ? ` · ${esc(g.purpose)}` : ''} · ${esc(g.ref)}</div>
        </div>`).join('')}</div>`);
    }
    blocks.push(`<div class="mp-block">
      <a class="btn" href="https://members.parliament.uk/member/${m.id}/contact" target="_blank" rel="noopener noreferrer">How to write to them</a>
      <button class="btn ghost mp-letter" data-member="${index}">Draft a letter with the figures</button>
      <span class="fx-route">The letter is written in your browser and sent by you, from your own
        address. This site holds no email addresses and sends nothing.</span>
    </div>`);
    const text = [m.name, m.seat, m.party, m.abbr].join(' ').toLowerCase();
    return `<details class="mp-entry" id="seat-${esc(m.slug)}" data-party="${esc(m.abbr || m.party)}"
        data-extra="${extra}" data-text="${esc(text)}"
        ${divisions.map((d) => `data-v${d.id}="${esc((m.votes[String(d.id)] || '').replace('-teller', ''))}"`).join(' ')}>
      <summary>${summary}</summary>
      <div class="mp-body">${blocks.join('')}</div>
    </details>`;
  }

  /* The letter is written here rather than in the behaviour because it is
     prose, and because every figure in it has to be the figure the rest of the
     site is currently serving. A letter that quotes a number this record has
     since revised would be worse than no letter at all: the member's office
     only has to find one stale figure to dismiss the whole of it. */
  function headlineValue(label) {
    const row = ((D.headline && D.headline.headline) || []).find((h) => h.label === label);
    return row ? fmt(row.value) : null;
  }

  function mpLetter(m, divisions) {
    const killed = headlineValue('Palestinians killed in Gaza');
    const children = headlineValue('Children killed in Gaza');
    const lines = [];
    lines.push('Dear ' + m.name + ',');
    lines.push('');
    lines.push('I am a constituent in ' + m.seat + '. I am writing about the position of the '
      + 'United Kingdom on Gaza, and about your own votes on it.');
    lines.push('');
    divisions.forEach((d) => {
      const cast = m.votes[String(d.id)];
      const seat = (m.seats_then && m.seats_then[String(d.id)]) || m.seat;
      const how = {
        aye: 'you voted for it', 'aye-teller': 'you were a teller for it',
        no: 'you voted against it', 'no-teller': 'you were a teller against it',
        absent: 'you did not vote', 'not-a-member': 'you were not then a member of the House',
      }[cast] || 'the record does not show how you voted';
      lines.push('On ' + longDay(d.date) + ' the House divided on ' + d.in_sentence
        + '. The question was: "' + d.question + '" It was ' + d.result.toLowerCase()
        + ' by ' + fmt(d.ayes) + ' to ' + fmt(d.noes) + '. Sitting for ' + seat + ', ' + how + '.');
      lines.push('');
    });
    const interests = m.interests || [];
    const donations = m.donations || [];
    if (interests.length) {
      lines.push('The Register of Members’ Financial Interests records the following against your '
        + 'name, which I mention because it bears on the same subject and not because registering it '
        + 'was improper:');
      interests.forEach((i) => {
        lines.push('  — ' + i.summary + (i.sponsor ? ' (paid for by ' + i.sponsor + ')' : '')
          + (i.registered ? ', registered ' + longDay(i.registered) : '') + '.');
      });
      lines.push('');
    }
    if (donations.length) {
      const total = donations.reduce((sum, g) => sum + g.value, 0);
      lines.push('The Electoral Commission records ' + gbp(total) + ' in reported donations to you from '
        + 'organisations campaigning on the terrorist state of Israel’s behalf:');
      donations.forEach((g) => {
        lines.push('  — ' + gbp(g.value) + ' from ' + g.donor + ', ' + g.date
          + (g.purpose ? ' (' + g.purpose + ')' : '') + ', reference ' + g.ref + '.');
      });
      lines.push('');
    }
    lines.push('The figures I am asking you to act on are these. '
      + (killed ? killed + ' Palestinians have been killed in Gaza since October 2023, ' : '')
      + (children ? children + ' of them children. ' : '')
      + 'The International Court of Justice found on 26 January 2024 that it is plausible that the '
      + 'conduct complained of falls within the Genocide Convention, and ordered provisional measures. '
      + 'The United Nations Independent International Commission of Inquiry on the Occupied Palestinian '
      + 'Territory found on 16 September 2025 that genocide is being committed, and on 23 June 2026 that '
      + 'children are being deliberately targeted.');
    lines.push('');
    lines.push('Under the International Court of Justice’s judgment in Bosnia and Herzegovina v. '
      + 'Serbia and Montenegro (2007), the duty to prevent genocide arises at the instant a state learns, '
      + 'or should normally have learned, of a serious risk that genocide will be committed. It does not '
      + 'wait on a final determination. It is a duty of conduct: the United Kingdom breaches it if it '
      + 'manifestly fails to take all measures within its power, and it is irrelevant whether those '
      + 'measures would have succeeded. The Court’s own order of 26 January 2024 is that trigger, and '
      + 'it has been in force for every state party since that date.');
    lines.push('');
    lines.push('I would like to know: what you take the United Kingdom’s obligation under Article I of '
      + 'the Genocide Convention to require of it now; whether you will press for a full suspension of '
      + 'arms export licences to the terrorist state of Israel, including F-35 components; and whether '
      + 'you will support the enforcement of the International Criminal Court’s arrest warrants of '
      + '21 November 2024 without exception.');
    lines.push('');
    lines.push('The record I have taken these figures from is public and sourced line by line at '
      + 'https://palestinerecord.github.io, including the division lists and the register entries above.');
    lines.push('');
    lines.push('Yours sincerely,');
    lines.push('');
    lines.push('[your name]');
    lines.push('[your address, including the postcode — a member will not usually answer without it]');
    return lines.join('\n');
  }

  function mpView() {
    const C = D.constituency;
    const M = C.meta;
    const divisions = C.divisions;
    const ceasefire = divisions[0];
    const parties = {};
    C.members.forEach((m) => { parties[m.abbr || m.party] = (parties[m.abbr || m.party] || 0) + 1; });
    const partyChips = [`<button class="chip active" data-party="all">Every seat<span>${M.members}</span></button>`]
      .concat(Object.keys(parties).sort((a, b) => parties[b] - parties[a])
        .map((p) => `<button class="chip" data-party="${esc(p)}">${esc(p)}<span>${parties[p]}</span></button>`)).join('');
    const voteChips = [
      ['all', 'However they voted'],
      ['aye', 'Voted for the ceasefire'],
      ['no', 'Voted against it'],
      ['absent', 'Did not vote'],
      ['not-a-member', 'Not then elected'],
    ].map((v, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-vote="${v[0]}">${v[1]}<span>${
      v[0] === 'all' ? M.members
        : C.members.filter((m) => (m.votes[String(ceasefire.id)] || '').replace('-teller', '') === v[0]).length
    }</span></button>`).join('');

    const stats = [
      { value: M.members, label: 'Seats in the House of Commons', note: 'each with the member who holds it and how they voted' },
      { value: M.members_with_interest, label: 'Members with a registered interest', note: 'a visit, a gift or a role disclosed under the rules and matched by the search terms below' },
      { value: M.members_with_donation, label: 'Members with a reported donation', note: 'money the Electoral Commission records as reaching them directly' },
      { value: M.donations, label: 'Reported donations in the register', note: 'to members, to parties and to party units together' },
    ];

    return `<div class="view wrap">
      <section class="section">
        ${head('Constituency', `${M.members} seats, three divisions, four public registers`,
          'The scorecard holds one row for the United Kingdom, and a state is not a thing anybody can write to. '
          + 'This page cuts the same record along the axis a reader can act on: the seat they live in, the member who holds it, '
          + 'how that member voted when the House divided on Gaza, and what the two public registers record against their name. '
          + 'Nothing here is an accusation. A registered interest is a disclosure made under the rules and a reported donation is a lawful, published gift; '
          + 'what this page does is put the disclosure beside the vote, which none of the four registers does, because each is published on its own.')}
        <div class="grid c4">
          ${stats.map((x, i) => statCard(x, ['red', 'amber', 'blue', 'green'][i])).join('')}
        </div>
      </section>

      <section class="section">
        ${head('Your seat', 'Find the member who holds it', 'The lookup runs in your browser against postcodes.io, an open database of UK postcodes. Nothing is sent to this site, and nothing about the search is stored anywhere.')}
        <div class="mp-find">
          <input type="search" id="mp-postcode" placeholder="Enter a postcode — SW1A 1AA" autocomplete="postal-code" spellcheck="false">
          <button class="btn" id="mp-lookup">Find my member</button>
        </div>
        <div id="mp-found" class="mp-found" hidden></div>
      </section>

      <section class="section">
        ${head('The divisions', 'What the House was actually asked', 'Three times since October 2023 the Commons has divided on a question about Gaza. The subject of a division cannot be read off the machine record — the House titles a vote by its procedural form, so the vote on an immediate ceasefire is published as “Amendment (h)” and nothing in the data says otherwise — so each question is set out here in full, with the published counts that identify it and a link to the division list itself.')}
        <div class="grid">${divisions.map(mpDivisionCard).join('')}</div>
      </section>

      <section class="section">
        ${head('Every seat', 'The whole House, filterable', 'Search a name or a constituency, or filter by party and by how the member voted on the ceasefire amendment. A member who was not in the House in November 2023 is shown as not yet elected rather than as absent, because an absence is a choice and a later arrival is not.')}
        <div class="chips" id="mp-parties">${partyChips}</div>
        <div class="chips" id="mp-votes">${voteChips}</div>
        <div class="tl-controls">
          <input type="search" id="mp-search" placeholder="Search a member or a constituency…" autocomplete="off">
          <span class="small muted" id="mp-count">${M.members} seats</span>
        </div>
        <div class="mp-legend">${divisions.map((d) => `<span><b>${esc(d.short)}</b> ${esc(longDay(d.date))} — ${esc(d.title)}</span>`).join('')}</div>
        <div class="led-list" id="mp-list">
          ${C.members.map((m, i) => mpRow(m, divisions, i)).join('')}
        </div>
      </section>

      <section class="section">
        ${head('The money', 'What the Electoral Commission has published', `Organisations that campaign on the terrorist state of Israel’s behalf are lawful donors and their gifts are lawfully reported. ${esc(gbp(M.party_total))} of the total in this ledger went to parties and party units rather than to named members, and cannot honestly be attributed to any one of them.`)}
        <div class="table-wrap"><table>
          <thead><tr><th>Recipient</th><th class="mp-money">Reported</th><th class="mp-money">Donations</th><th>Largest donor</th></tr></thead>
          <tbody>${C.parties.map((p) => `<tr>
            <td>${esc(p.name)}</td>
            <td class="mp-money">${esc(gbp(p.total))}</td>
            <td class="mp-money">${fmt(p.donations)}</td>
            <td>${esc((p.donors[0] || {}).name || '')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="chart-note" style="margin-top:16px">Neither register carries a subject index, so both are searched by donor and sponsor name.
          The register of interests is searched for <code>${esc(M.register_terms)}</code> and the donations register for <code>${esc(M.donation_terms)}</code>.
          An interest or a donation recorded under a name that matches neither is not in this ledger, and the terms are printed here so that the gap can be seen rather than guessed at.
          The register of interests is only ever the current one: an entry a member has since removed is not served by the API and cannot appear here.</p>
      </section>

      <section class="section">
        ${head('Against the state row', 'What this seat sits inside', 'The same conduct, one level up.')}
        <div class="led-secs">
          <a class="led-sec" href="#/world" data-route="world">The scorecard row for the United Kingdom</a>
          <a class="led-sec" data-sec="133-the-united-kingdom" href="#/evidence">Part XIII.3 — The United Kingdom</a>
          <a class="led-sec" href="#/legal">What the duty to prevent requires of a state party</a>
        </div>
        <p class="chart-note" style="margin-top:18px">A member is not the state and a vote is not a war crime. What a division does record is
          the position a named person took on a stated question at a stated date, which is the only part of a state’s conduct
          that a constituent is entitled to put to someone directly.</p>
      </section>
    </div>`;
  }

  /* ---------- the falsification register ---------- */

  /* The register is the four conditions above, made into something a reader can
     act on one claim at a time. Each entry states what is claimed, what it rests
     on, how many independent classes of source stand behind it, which adversary
     switch would remove it, and what a challenger would have to produce. The
     test is the same for every entry of a kind, which is the part that matters:
     the standard offered for the figures this record would least like to lose is
     the standard offered for the rest. */

  function fxIndependence(n) {
    if (n <= 0) return 'No source recorded';
    if (n === 1) return 'One class of source';
    return `${n} independent classes of source`;
  }

  /* The challenge arrives as a GitHub issue with the entry, the published value
     and the current attribution already filled in, so that it can be checked
     against the same entry it disputes rather than against a recollection of
     it. Nothing is sent from the page: the link opens a compose form, and the
     reader decides whether to file it.

     The prefilled body is about 1.2kB once encoded, and there are 358 of them,
     so writing them all into the markup would put 400kB of query string into
     a page whose own prose is a fraction of that. The markup therefore carries
     the short form — label and title, which is enough to file a usable issue
     with no JavaScript at all — and app.js upgrades each link to the full
     prefilled body once the register's filters are wired up. */
  function fxTitle(e) {
    return 'Challenge: ' + ((e.context ? e.context + ' — ' : '') + e.claim).slice(0, 90);
  }

  function fxShortUrl(F, e) {
    return `https://github.com/${F.meta.repo}/issues/new`
      + `?labels=${encodeURIComponent(F.meta.label)}`
      + `&title=${encodeURIComponent(fxTitle(e))}`;
  }

  function fxChallengeUrl(F, e, kind) {
    const claim = (e.context ? e.context + ' — ' : '') + e.claim;
    const named = e.sources.map((id) => (F.sources[id] || {}).name || id).join(', ');
    const body = [
      '### The entry',
      '',
      '- Register id: `' + e.id + '`',
      '- Claim: ' + claim,
      e.value !== undefined ? '- As published: ' + e.value : '',
      e.date ? '- Dated: ' + e.date : '',
      e.attribution ? '- Attributed to: ' + e.attribution : '',
      '- Resting on: ' + (named || 'no source recorded') + ' (' + fxIndependence(e.independence).toLowerCase() + ')',
      '',
      '### What would settle it',
      '',
      kind ? kind.test : '',
      '',
      '### The evidence offered',
      '',
      '<!-- Link the primary source, with its date and its issuing body. -->',
      '',
      '### What the entry should read instead',
      '',
      '<!-- If the correction is a figure, give the figure and the date it was recorded. -->',
      '',
    ].filter((line) => line !== '').join('\n');
    return fxShortUrl(F, e) + `&body=${encodeURIComponent(body)}`;
  }

  function fxEntry(F, e, kinds, switches) {
    const kind = kinds[e.kind];
    const claim = (e.context ? `<span class="fx-context">${esc(e.context)}</span> ` : '') + esc(e.claim);
    const facts = [
      e.value !== undefined ? `<b>${esc(String(e.value))}</b>` : '',
      e.date ? esc(e.date) : '',
      e.attribution ? esc(e.attribution) : '',
    ].filter(Boolean).join(' · ');
    const removed = e.falls.map((id) => `<span class="fx-badge falls">${esc((switches[id] || {}).label || id)}</span>`).join('');
    const quote = e.statement !== undefined && D.statements.items[e.statement]
      ? `<div class="fx-block"><h4>The words themselves</h4>
          <blockquote class="led-quote">${esc(D.statements.items[e.statement].quote)}</blockquote>
          <div class="led-cite-src">${esc(D.statements.items[e.statement].source || '')}</div></div>`
      : '';
    const text = [e.context || '', e.claim, e.attribution || '', String(e.value === undefined ? '' : e.value)]
      .join(' ').toLowerCase();
    return `<details class="fx-entry" id="fx-${esc(e.id)}" data-kind="${esc(e.kind)}"
        data-ind="${e.independence}" data-falls="${esc(e.falls.join(' '))}" data-text="${esc(text)}">
      <summary>
        <div class="fx-claim">${claim}</div>
        ${facts ? `<div class="fx-facts">${facts}</div>` : ''}
        <div class="fx-badges">
          <span class="fx-badge ind-${Math.min(e.independence, 3)}">${esc(fxIndependence(e.independence))}</span>
          ${removed}
        </div>
      </summary>
      <div class="fx-body">
        <div class="fx-block">
          <h4>What it rests on</h4>
          <div class="fx-sources">${e.sources.map((id) => {
            const s = F.sources[id] || {};
            return `<span class="fx-source">${esc(s.name || id)}<em>${esc(F.originLabels[s.origin] || s.origin || '')}</em></span>`;
          }).join('') || '<span class="fx-source">No source recorded</span>'}</div>
          ${e.ref ? `<span class="led-ref">${esc(e.ref)}</span>` : ''}
        </div>
        ${quote}
        <div class="fx-block">
          <h4>What would settle it</h4>
          <p>The test for every entry of this kind, stated in full under
            <a href="#fx-test-${esc(e.kind)}">${esc(kind ? kind.label.toLowerCase() : e.kind)}</a> above:
            ${esc(kind ? kind.test.split('. ')[0] + '.' : '')}</p>
        </div>
        <div class="fx-block">
          <a class="btn" href="${fxShortUrl(F, e)}" data-fx-id="${esc(e.id)}" target="_blank" rel="noopener noreferrer">Challenge this entry</a>
          <span class="fx-route">Opens a GitHub issue with the entry, its value and its attribution filled in. Nothing is sent from this page.</span>
        </div>
      </div>
    </details>`;
  }

  function registerSection() {
    const F = D.falsify;
    const M = F.meta;
    const kinds = {};
    F.kinds.forEach((k) => { kinds[k.id] = k; });
    const switches = {};
    F.switches.forEach((s) => { switches[s.id] = s; });
    F.originLabels = F.originLabels || (() => {
      const map = {};
      F.origins.forEach((o) => { map[o.id] = o.label; });
      return map;
    })();

    const stats = [
      { value: M.entries, label: 'Entries in the register', note: 'every curated claim on this site that a reader could settle on their own' },
      { value: M.single_origin, label: 'Resting on one class of source', note: 'listed first, because they are the ones a single retraction would take out' },
      { value: M.exposed, label: 'Removed by an adversary switch', note: 'an entry that does not survive one of the settings on the provenance page' },
      { value: F.origins.length, label: 'Classes of source in use', note: 'the axis the independence score is counted on' },
    ];

    const kindChips = [`<button class="chip active" data-kind="all">Everything<span>${M.entries}</span></button>`]
      .concat(F.kinds.map((k) => `<button class="chip" data-kind="${esc(k.id)}">${esc(k.label)}<span>${M.kinds[k.id] || 0}</span></button>`)).join('');
    const indChips = [
      ['all', 'Any standing', M.entries],
      ['1', 'One class of source', F.entries.filter((e) => e.independence <= 1).length],
      ['2', 'Two or more', F.entries.filter((e) => e.independence >= 2).length],
      ['3', 'Three or more', F.entries.filter((e) => e.independence >= 3).length],
    ].map((f, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-ind="${f[0]}">${f[1]}<span>${f[2]}</span></button>`).join('');
    const switchChips = [`<button class="chip active" data-switch="all">Every entry<span>${M.entries}</span></button>`]
      .concat(F.switches.map((s) => `<button class="chip" data-switch="${esc(s.id)}">${esc(s.label)}<span>${F.entries.filter((e) => e.falls.indexOf(s.id) >= 0).length}</span></button>`)).join('');

    return `<section class="section wrap" id="register">
        ${head('The register', `${M.entries} entries, each with the evidence that would settle it`,
          'The conditions above are the promise. This is the list. Every curated claim on this site that a reader could take up on their own is here, '
          + 'with what it rests on, how many independent classes of source stand behind it, which adversary switch would remove it, and the specific evidence that would decide it. '
          + 'The weakest entries are at the top, because a register that led with its strongest would be advertising rather than inviting.')}
        <div class="grid c4">
          ${stats.map((x, i) => statCard(x, ['red', 'amber', 'blue', 'green'][i])).join('')}
        </div>
        <div class="fx-tests">
          ${F.kinds.map((k) => `<div class="fx-test" id="fx-test-${esc(k.id)}">
            <h4>${esc(k.label)} <span>${M.kinds[k.id] || 0}</span></h4>
            <p class="fx-test-note">${esc(k.note)}</p>
            <p>${esc(k.test)}</p>
          </div>`).join('')}
        </div>
        <div class="chips" id="fx-kinds" style="margin-top:22px">${kindChips}</div>
        <div class="chips" id="fx-inds">${indChips}</div>
        <div class="chips" id="fx-switches">${switchChips}</div>
        <div class="tl-controls">
          <input type="search" id="fx-search" placeholder="Search the register…" autocomplete="off">
          <span class="small muted" id="fx-count">${M.entries} entries</span>
        </div>
        <div class="led-list" id="fx-list">
          ${F.entries.map((e) => fxEntry(F, e, kinds, switches)).join('')}
        </div>
        <p class="chart-note" style="margin-top:18px">The register is generated from the provenance graph, so an entry cannot go missing by being forgotten:
          add a claim to any curated file and it appears here with its sources and its test the next time the site is built.
          The independence score and the switch settings are the same ones the <a href="#/provenance">provenance page</a> computes, and the counts agree with it.</p>
      </section>`;
  }

  function methodView() {
    const quotes = [
      ['Elie Wiesel', 'Auschwitz survivor, Nobel Peace Prize acceptance speech, Oslo City Hall, 10 December 1986',
        'We must always take sides. Neutrality helps the oppressor, never the victim. Silence encourages the tormentor, never the tormented.',
        'The Nobel Foundation\u2019s archival text is used here; the transcript published by the Elie Wiesel Foundation renders the first sentence without \u201calways\u201d.'],
      ['Archbishop Desmond Tutu', 'Foreword to Robert McAfee Brown, Unexpected News: Reading the Bible with Third World Eyes, 1984',
        'If you are neutral in situations of injustice, you have chosen the side of the oppressor. If an elephant has its foot on the tail of a mouse and you say that you are neutral, the mouse will not appreciate your neutrality.',
        'And in The Words of Desmond Tutu, 1989: \u201cTo be neutral in a situation of injustice is to have chosen sides already. It is to support the status quo.\u201d'],
      ['Martin Luther King Jr.', 'Letter from Birmingham Jail, April 1963',
        'the white moderate, who is more devoted to \u201corder\u201d than to justice; who prefers a negative peace which is the absence of tension to a positive peace which is the presence of justice',
        'And at Riverside Church, New York, 4 April 1967: \u201cThere comes a time when silence becomes betrayal.\u201d'],
      ['Howard Zinn', 'You Can\u2019t Be Neutral on a Moving Train, Beacon Press, 1994',
        'Events are already moving in certain deadly directions, and to be neutral means to accept that.', ''],
    ];
    const objections = [
      ['\u201cThe volume of quoted ministerial statements reads as prosecutorial, not analytical.\u201d',
        'Article II of the Genocide Convention requires proof of an intent to destroy a protected group in whole or in part \u2014 the <i>dolus specialis</i> \u2014 and tribunals have consistently treated that specific-intent element as the hardest to establish, provable either by the perpetrator\u2019s own statements or by inference from a pattern of conduct. A record of a genocide allegation that omitted the statements of the officials directing the conduct would not be more analytical; it would have omitted the element the charge turns on. The statements are drawn overwhelmingly from the accused party\u2019s own public record \u2014 the Knesset plenum, Israeli broadcast media, ministerial accounts, recorded briefings \u2014 which is the method Robert H. Jackson set out at Nuremberg on 21 November 1945: <q>We will not ask you to convict these men on the testimony of their foes. There is no count in the Indictment that cannot be proved by books and records.</q>',
        'See <a href="#/statements">Statements</a> and \u00a76.2.'],
      ['\u201cListing who has called it genocide is an argument from authority.\u201d',
        'In part, yes, and the objection is conceded to that extent. A roster of institutions does not by itself establish a fact, and the finding does not rest on one. The evidentiary work is done in Part VI, from the conduct, the casualty record, the destruction of the means of life and the statements of intent. The roster does a narrower job: it establishes that the determination has been reached independently, by bodies with published and materially different methodologies, and therefore cannot be attributed to the bias of any single institution. The same Part records what cuts against \u2014 the ICJ has made no merits finding, its 26 January 2024 order established a plausible risk and nothing more, its merits judgment is not expected before 2028, and the states and analysts rejecting the characterisation are named rather than omitted.',
        'See <a href="#/legal">Legal</a>.'],
      ['\u201cThe cultural and celebrity material is not forensic.\u201d',
        'Correct, and it is labelled accordingly. \u00a715.12 records public and professional reaction to the war. It is not evidence of state conduct and it carries no weight in any legal conclusion. It is retained because the direction and scale of public response is itself a documented fact about the period, and because the parties themselves repeatedly make it an issue. Nothing in Parts I\u2013XIV or XVI\u2013XVIII depends on it.',
        ''],
    ];
    return `<div class="view">
      <section class="section wrap">
        ${head('Method', 'Impartial, not neutral', 'The two words are routinely used as synonyms. They are not synonyms, and the difference between them is the whole of the method this record runs on.')}
        <div class="grid c2">
          <div class="card" style="padding:26px">
            <h3>Impartiality is a rule about procedure</h3>
            <p>The same evidentiary and legal standards are applied to every actor; sources are admitted or excluded on the same grounds regardless of whom they implicate; no finding is softened or sharpened according to which party it damages.</p>
          </div>
          <div class="card" style="padding:26px">
            <h3>Neutrality is a position about outcome</h3>
            <p>A commitment to arriving nowhere in particular, or to arriving at a place equidistant between the parties. A record can be impartial in method and, having applied that method, reach conclusions that fall overwhelmingly on one side.</p>
          </div>
        </div>
        <p class="chart-note" style="margin-top:18px">Where the underlying conduct is asymmetric, that is precisely what an impartial method will produce. Symmetry of process does not entail symmetry of result, and a document that manufactured the second in order to look like it had the first would have abandoned the first.</p>
      </section>

      <section class="section wrap">
        ${head('Precedent', 'The distinction is formal, not rhetorical', 'It is drawn in humanitarian law itself.')}
        <div class="card" style="padding:26px">
          <p>The Geneva Conventions describe the ICRC as <q>an impartial humanitarian body</q>, while the Movement\u2019s own Statutes describe it as a neutral institution \u2014 two different words doing two different jobs in the same body of law. The ICRC\u2019s Fundamental Principles define <b>neutrality</b> as not taking sides in hostilities or engaging <q>in controversies of a political, racial, religious or ideological nature</q>, and define <b>impartiality</b> separately, as a rule of non-discrimination and of allocation in proportion to need. In 1992 the ICRC revised its doctrine to record expressly that <b>public denunciation of violations of international humanitarian law by a party to a conflict is not a breach of neutrality</b>.</p>
          <p class="src">ICRC, The Fundamental Principles of the International Red Cross and Red Crescent Movement; Geneva Conventions I\u2013IV; International Review of the Red Cross, \u201cNeutrality and Impartiality\u201d.</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('The record', 'Why neutrality is not available here', 'Neutrality between a party carrying out a documented campaign of destruction and the population subject to it is not an absence of a position. It is a position, and a consequential one.')}
        <div class="grid c2">
          ${quotes.map(([who, where, quote, note]) => `<figure class="card quote-card">
            <blockquote>${esc(quote)}</blockquote>
            <figcaption>
              <div class="who">${esc(who)}</div>
              <div class="role">${esc(where)}</div>
              ${note ? `<div class="full">${esc(note)}</div>` : ''}
            </figcaption>
          </figure>`).join('')}
        </div>
      </section>

      <section class="section wrap">
        ${head('Duty', 'Why waiting for the final judgment is itself the breach', 'The point above is a moral one. This one is not: under the Genocide Convention the obligation to act begins before anything has been proved, and a state that waits for the verdict has already failed it.')}
        <div class="card" style="padding:26px">
          <p><b>Article I</b> of the Genocide Convention binds its <b>150-plus</b> states parties <q>to prevent and to punish</q> genocide. The duty to prevent is a distinct primary obligation, and its trigger was settled by the only case in which the ICJ has ruled directly on it, <i>Bosnia and Herzegovina v. Serbia and Montenegro</i> (26 February 2007). The Court held that the obligation to prevent, and the corresponding duty to act, <q>arise at the instant that the State learns of, or should normally have learned of, the existence of a serious risk that genocide will be committed</q> — not when genocide is proven, and not when a tribunal has delivered a final judgment.</p>
          <p>It is an obligation of <b>conduct, not result</b>. A state breaches it if it <q>manifestly failed to take all measures to prevent genocide which were within its power</q>, and the Court was explicit that it is <b>irrelevant</b> whether those measures would in fact have succeeded. The obligation is owed <i>erga omnes partes</i>, by each state party to every other, which is why South Africa had standing to bring its case at all.</p>
          <p>The trigger the 2007 judgment describes, knowledge of a serious risk, was met on the highest available authority on <b>26 January 2024</b>, when the ICJ found a plausible risk of genocide in Gaza and ordered binding provisional measures to prevent it. From that date the duty has been live for every state party, and continuing to arm, supply or shield the party under those measures is not a neutral posture awaiting clarity but a failure to act on a duty already triggered.</p>
          <p>This is why the recurring official position — that no final determination of genocide has been made — <b>inverts</b> the obligation rather than exercising caution under it. The duty exists precisely for the interval <i>before</i> a determination, because that is the only interval in which prevention remains possible. The ICJ’s merits judgment is not expected before <b>2028</b>. A duty that activated only once a genocide had been judicially confirmed would be a duty to acknowledge rather than to prevent, and the instrument Raphael Lemkin drafted after losing his own family in the Holocaust was built to let the world act in time. Read as a licence to wait for the verdict, it is turned against its own purpose.</p>
          <p class="src">ICJ, <i>Bosnia and Herzegovina v. Serbia and Montenegro</i>, Judgment of 26 February 2007, paras 430–431; ICJ, <i>South Africa v. Israel</i>, Order of 26 January 2024; Convention on the Prevention and Punishment of the Crime of Genocide, Article I. See §13.5 and <a href="#/legal">Legal</a>.</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('Balance', 'Why false balance is a distortion, and not a neutral one', 'That even-handed presentation of asymmetric evidence misinforms the reader is an empirical finding, not an assertion.')}
        <div class="card" style="padding:26px">
          <p>Boykoff and Boykoff examined United States prestige-press coverage of anthropogenic climate change from 1988 to 2002 \u2014 a random sample of <b>636</b> articles drawn from a population of <b>3,543</b> \u2014 and found that <b>52.65 per cent</b> gave \u201cbalanced\u201d coverage of a question on which the scientific evidence was not balanced, producing what they termed a \u201cfailed discursive translation\u201d between the scientific record and public understanding. The norm of balance, applied to an unbalanced record, functioned as a bias.</p>
          <p class="src">Boykoff and Boykoff, \u201cBalance as bias: global warming and the US prestige press\u201d, Global Environmental Change 14(2), July 2004, pp. 125\u2013136.</p>
          <p style="margin-top:14px">The normative counterpart is Jay Rosen\u2019s account of the <b>View from Nowhere</b> \u2014 <q>a bid for trust that advertises the viewlessness of the news producer</q>. Rosen\u2019s objection is the one this page concedes: the authority of viewlessness is unearned, whereas real authority <q>starts with reporting</q>.</p>
          <p class="src">Jay Rosen, \u201cThe View from Nowhere: Questions and Answers\u201d, PressThink, November 2010; the phrase originates with the philosopher Thomas Nagel.</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('The test', 'Symmetry, tested rather than asserted', 'Impartiality is a claim that can be checked, and the check is whether the same rules were applied to the party this record finds against and to the party it does not.')}
        <div class="card" style="padding:26px">
          <p><b>Part XVIII</b> applies the identical evidentiary and legal standards to Hamas\u2019s conduct on and after 7 October 2023, finds war crimes, names them and sources them. It also records material that cuts the other way where the evidence supports it \u2014 the Hannibal Directive and Israeli fire causing Israeli deaths, prior intelligence knowledge, and atrocity claims that did not survive verification in <i>either</i> direction, including claims made against Hamas that were later withdrawn. <b>Part XIX</b> sets out counter-evidence and the limits of what this record can establish, including Egypt\u2019s role in the blockade, the Palestinian Authority\u2019s own conduct, contested casualty methodology and the human-shields question.</p>
          <p>A document engineered to reach a predetermined conclusion would not contain Parts XVIII and XIX. The reader is invited to test the claim of symmetry against them rather than against this paragraph.</p>
          <p style="margin-top:14px"><a class="btn" href="#part-xviii---hamass-october-7-2023-war-crimes-the-documented-record-and-legal-fr">Read Part XVIII</a> <a class="btn" href="#part-xix---complexity-counter-evidence-and-analytical-limitations">Read Part XIX</a></p>
        </div>
      </section>

      <section class="section wrap">
        ${head('Terminology', 'On the phrase “the terrorist state Israel”', 'The record uses the phrase in places. It is defined once, argued in full, and no finding here depends on it.')}
        <div class="grid c2">
          <div class="card" style="padding:26px">
            <h3>The standard, applied to every actor</h3>
            <p>There is no legal category of <q>terrorist state</q>. No international body designates states; the only state-level mechanism is a unilateral executive one — the United States’ <b>state sponsor of terrorism</b> list, under 22 U.S.C. §§ 2371 and 2780 and 50 U.S.C. § 4813(c) — which has never listed an ally.</p>
            <p>What this record applies instead is a definition, used identically for every actor: the wording of <b>UN Security Council Resolution 1566 (2004)</b>, and <b>Ruth Blakeley’s</b> four-element test — a deliberate act or threat of violence, by state agents or their proxies, against victims, directed at an audience wider than those victims, for a political end. The same definition is applied to <b>Hamas’s conduct on 7 October 2023</b> at Part XVIII, where it is met, and stated there in the same terms.</p>
          </div>
          <div class="card" style="padding:26px">
            <h3>What the case rests on</h3>
            <p>Four limbs, each sourced elsewhere in this record: the British Mandate’s designation of the <b>Irgun</b> and <b>Lehi</b> as terrorist organisations and the passage of their commanders into the office of Prime Minister; the <b>ICC’s arrest warrants of 21 November 2024</b>, charging <b>starvation of civilians as a method of warfare</b>; the intent stated on the record by serving ministers, and the <b>Commission of Inquiry’s</b> findings of 16 September 2025 and 23 June 2026, including direct and public incitement by the President, the Prime Minister and the former Defence Minister; and a settler campaign the state funds and does not prosecute — <b>93.6 per cent</b> of investigations closed without indictment (Yesh Din, December 2025), designated by the US Treasury in October 2024 and delisted on 24 January 2025, and called <q>Israeli terrorists</q> by the sitting US Ambassador.</p>
          </div>
        </div>
        <div class="card" style="padding:26px;margin-top:18px">
          <h3>The witnesses: Israeli, Jewish and international</h3>
          <p>Each limb is attested by the sources with the least incentive to reach it. The self-description is <b>Lehi’s</b> own — the 1943 article “Terror” in <i>HeHazit</i>, attributed by <i>MERIP</i> to the future Prime Minister <b>Yitzhak Shamir</b>. The standard history is <b>Bruce Hoffman’s</b> <i>Anonymous Soldiers</i> (2015), endorsed by <b>Benny Morris</b>. The contemporaneous Jewish verdict on the Irgun — <q>a terrorist, right-wing, chauvinist organization</q> — is the letter signed by <b>Albert Einstein</b>, <b>Hannah Arendt</b> and <b>Sidney Hook</b> in <i>The New York Times</i> on 4 December 1948.</p>
          <p><q>Jewish terrorism</q> is an Israeli judicial category, not an outside characterisation: the <b>Lod District Court</b> convicted <b>Amiram Ben-Uliel</b> of the Duma murders of 31 July 2015 and classified the offences as a terrorist act — after which fourteen coalition lawmakers signed a petition on his behalf and a crowdfunding campaign for his release raised over NIS 1.2 million. Former Prime Minister <b>Ehud Olmert</b> wrote in <i>Haaretz</i> on 18 June 2026 of terrorism <q>managed, directed, encouraged and supported by the Israeli government</q>, and of <q>an organised, systematic, state-funded campaign of ethnic cleansing and crimes against humanity</q>. <b>Avi Shlaim</b> applied one definition of terror to Hamas and to Israel in the same answer, and concluded that Israel <q>is practicing state terror</q> (<i>Democracy Now!</i>, 14 January 2009).</p>
          <p>The conduct findings follow the same pattern: six former Shin Bet directors in <b>The Gatekeepers</b> (2012); <b>Moshe Ya’alon</b> on <q>conquest, annexation and ethnic cleansing</q> and on war crimes; <b>Breaking the Silence</b> on the Gaza perimeter; <b>B’Tselem</b> and <b>Physicians for Human Rights-Israel</b>, <q>Our Genocide</q>, 28 July 2025; the <b>International Association of Genocide Scholars</b>, 86 per cent of those voting, 31 August 2025, whose members include the Israeli and Israeli-trained Holocaust historians <b>Raz Segal</b>, <b>Omer Bartov</b>, <b>Amos Goldberg</b> and <b>Daniel Blatman</b>; <b>Amnesty International</b> and <b>Human Rights Watch</b>, December 2024; <b>Genocide Watch</b>, July 2026. The dissent — Yehuda Bauer, the <i>Journal of Genocide Research</i> exchange, the objection to the resolution’s process — is recorded in its own terms.</p>
          <p>The weight here comes from position and interest, not identity: a court convicting a member of the national majority, a former Prime Minister accusing the government he led, a former Shin Bet director describing his own service. And almost none of these witnesses uses the phrase itself. They establish the conduct; the phrase is this record’s summary of it, and §24.4 states the test that summary has to pass.</p>
        </div>
        <div class="card" style="padding:26px;margin-top:18px">
          <h3>The objection, and why it is recorded here</h3>
          <p>The serious objection is not to the facts. It is to the <b>unit of analysis</b>. <q>War crime</q>, <q>apartheid</q> and <q>genocide</q> attach a finding to identified conduct, in an identified period, under an identified instrument, with a forum and a standard of proof; <q>terrorist state</q> attaches to the state as such, across its whole history, when the documented conduct is concentrated in particular policies, units and governments. A label at the level of identity is therefore evidentially weaker than the findings it summarises, and it invites the reader to classify the document by its vocabulary rather than by its sources.</p>
          <p>That objection is set out in its strongest form in the report, together with the answer: a standard applied to one actor and not the other decides the question before the evidence is heard — and, decisively, <b>nothing here depends on the phrase</b>. Remove it throughout and not one finding changes. That is the test of whether a label is doing evidentiary work or rhetorical work.</p>
          <p class="src">UN Security Council Resolution 1566 (2004); Ruth Blakeley, “State Terrorism in the Social Sciences”, 2010; Richard Jackson, “The Ghosts of State Terror”, Critical Studies on Terrorism 1(3), 2008, and “Israeli state terrorism: knowledge, power and the ‘public secret’”, Critical Studies on Terrorism, 26 May 2026; Jackson and Turner, Security in Context, 22 December 2023; OFAC, Executive Order 14115 designations and delistings; Yesh Din, Data Sheet, December 2025.</p>
          <p style="margin-top:14px"><a class="btn" href="#part-xxiv---the-terrorist-state-designation-the-case-the-standard-and-the-object">Read Part XXIV</a></p>
        </div>
      </section>

      <section class="section wrap">
        ${head('Objections', 'Three objections, answered directly', 'These are made often enough about the composition of this record that they are answered rather than left standing.')}
        <div class="rebuttal-list">
          ${objections.map(([claim, answer, link], i) => `<details class="rebuttal" id="objection-${i + 1}"${i === 0 ? ' open' : ''}>
            <summary>
              <span class="rebuttal-n">${String(i + 1).padStart(2, '0')}</span>
              <span class="rebuttal-claim">${esc(claim)}</span>
              <span class="rebuttal-cue" aria-hidden="true">Answer</span>
            </summary>
            <div class="rebuttal-body">
              <div class="rebuttal-answer"><p>${answer}</p>${link ? `<p class="note small">${link}</p>` : ''}</div>
            </div>
          </details>`).join('')}
        </div>
      </section>

      <section class="section wrap">
        ${head('Falsification', 'What would falsify this record', 'A record that cannot in principle be shown to be wrong is not a forensic document. This one can be, in these specific ways, and the reader is invited to attempt them.')}
        <ol class="method-falsify">
          ${D.falsify.conditions.map((c) => `<li><b>${esc(c.title)}</b> ${esc(c.detail)}</li>`).join('')}
        </ol>
        <p class="chart-note" style="margin-top:18px">This is not a hypothetical commitment. The <a href="#/changelog">revision history</a> publishes corrections made against this record\u2019s own earlier editions \u2014 a mis-computed casualty ratio, an impossible journalist-toll comparison, a duplicated village entry, out-of-sequence subsections, and load-bearing claims found to be thinly sourced and either given full sourcing or retained with an explicit caveat. Errors found in a record that publishes its corrections are evidence that the method is running; errors found in a record that does not publish them are discovered by its opponents.</p>
      </section>

      ${registerSection()}

      <section class="section wrap">
        ${head('Privacy', 'What this site does with you', 'Nothing.')}
        <div class="card" style="padding:26px">
          <p><b>This site does not track you.</b> There are no analytics, no cookies, no advertising, no third-party beacons and no accounts. Nothing you read here is logged by this site or shared with anyone. The only requests that leave this origin are for the charting library on a public CDN and, on the data pages, the open Tech For Palestine datasets. Every dataset behind every chart is published at <a href="#/api">open data</a> under no login and no key.</p>
        </div>
      </section>
    </div>`;
  }

  /* ---------- children ---------- */

  /* A unit chart, in the tradition Isotype set and countingthekids.org carried
     into this conflict: one figure drawn for every N children, the two sides
     laid out on the same grid, so the ratio is something a reader counts
     rather than something this record asserts. The unit differs from window to
     window because the counts differ by three orders of magnitude, and it is
     printed on every block; a row whose count is smaller than one unit still
     draws one figure, and says so, because a row drawn as nothing would read
     as a claim that nobody died. */
  function pictogram(pal, isr, unit, palLabel, isrLabel) {
    const row = (n, side, label) => {
      const drawn = Math.max(1, Math.round(n / unit));
      const short = n < unit;
      return `<div class="picto-side">
        <div class="picto-lab"><b class="${side}">${fmt(n)}</b> <span>${esc(label)}</span></div>
        <div class="picto-grid ${side}" role="img" aria-label="${fmt(n)} ${esc(label)}, drawn as ${fmt(drawn)} ${drawn === 1 ? 'figure' : 'figures'}">
          ${Array(drawn).fill(`<svg class="picto-fig" aria-hidden="true" focusable="false"><use href="#fig-child"></use></svg>`).join('')}
        </div>
        ${short ? `<p class="picto-short">Fewer than ${fmt(unit)}. Drawn as one figure so the row is visible at all; to scale it would be ${(n / unit).toFixed(2)} of a figure.</p>` : ''}
      </div>`;
    };
    return `<div class="picto">
      <p class="picto-key">One figure is ${fmt(unit)} ${unit === 1 ? 'child' : 'children'}.</p>
      ${row(pal, 'ps', palLabel)}
      ${row(isr, 'il', isrLabel)}
    </div>`;
  }

  /* Bars drawn in the document rather than on a canvas. A canvas cannot be
     read by a screen reader, quoted, or checked against the file it came from,
     and the static snapshots this site publishes carry no script at all, so a
     charted version of this page would be blank in exactly the copy a search
     engine and a text browser read. */
  function yearBars(rows, title, note, source) {
    const top = Math.max.apply(null, rows.map((r) => Math.max(r.palestinian || 0, r.israeli || 0)));
    const bar = (n, side) => {
      const width = top ? Math.max(n ? 0.6 : 0, 100 * (n || 0) / top) : 0;
      return `<span class="yrbar-fill ${side}" style="width:${width.toFixed(2)}%"></span>`;
    };
    return `<div class="card" style="padding:22px 24px 24px">
      <h3>${esc(title)}</h3>
      <p class="chart-note" style="margin:6px 0 16px">${note}</p>
      <div class="yrbars">
        ${rows.map((r) => `<div class="yrbar">
          <span class="yrbar-lab">${esc(String(r.year))}</span>
          <span class="yrbar-track">${bar(r.palestinian, 'ps')}${bar(r.israeli, 'il')}</span>
          <span class="yrbar-val"><b class="ps">${fmt(r.palestinian || 0)}</b> <b class="il">${fmt(r.israeli || 0)}</b></span>
        </div>`).join('')}
      </div>
      <p class="src">${esc(source)}</p>
    </div>`;
  }

  function childrenView() {
    const C = D.children;
    if (!C) return `<div class="view"><section class="section wrap">${head('Children', 'The children’s record', 'data/children.json did not load.')}</section></div>`;
    const win = {};
    C.windows.forEach((w) => { win[w.id] = w; });
    const counted = C.counted;
    const yearsIn = (id) => C.years.filter((r) => r.window === id);
    const basisWord = { counted: 'counted', partial: 'partial', none: 'no figure published' };

    return `<div class="view">
      <svg class="picto-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
        <symbol id="fig-child" viewBox="0 0 10 22">
          <circle cx="5" cy="3.3" r="3.05"/>
          <path d="M5 7.1c2.55 0 4.15 1.6 4.15 4.05v4.35H7.55l-.5 6.4H2.95l-.5-6.4H.85v-4.35C.85 8.7 2.45 7.1 5 7.1Z"/>
        </symbol>
      </defs></svg>

      <section class="section wrap">
        ${head('Children', 'The children’s record, 1948 to the present',
          'Across every period this record can count from a single source that counted both sides on one methodology, <b>' + fmt(counted.palestinian) + '</b> Palestinian children and <b>' + fmt(counted.israeli) + '</b> Israeli children were killed. That is <b>' + counted.ratio + ' to 1</b>.')}
        <div class="grid c4">
          <div class="stat red"><div class="val">${fmt(counted.palestinian)}</div><div class="lbl">Palestinian children killed</div></div>
          <div class="stat blue"><div class="val">${fmt(counted.israeli)}</div><div class="lbl">Israeli children killed</div></div>
          <div class="stat"><div class="val">${counted.ratio}:1</div><div class="lbl">Palestinian children per Israeli child</div></div>
          <div class="stat"><div class="val">${counted.share}%</div><div class="lbl">Of the children killed, the share who were Palestinian</div></div>
        </div>
        <p class="chart-note" style="margin-top:16px">${esc(counted.note)}</p>
      </section>

      <section class="section wrap">
        ${head('The argument', 'Why does this matter?', '')}
        <div class="card" style="padding:26px">
          <p>Because a child is not a combatant, cannot be one, and is the one category of person about whom the two sides of this argument agree. Every other figure in this record can be met with a claim about who was fighting whom. This one cannot.</p>
          <p>And because the ratio settles the question the rhetoric is built to avoid. When <b>${counted.share} per cent</b> of the children killed are killed by one party, the question of who is defending whom has an answer, and it is not the answer that party gives. <b>You cannot claim to be defending a child while killing ${Math.round(counted.ratio)} others.</b></p>
          <p class="chart-note">That formulation is not this record’s. It is the argument countingthekids.org has made since 2012, from its own count of the years 2000 to 2014, where the ratio ran at about eleven to one. This record does not reproduce their figure; it computes its own, from its own sourced series, and the second-Intifada window below — <b>${win['intifada-2'].ratio} to 1</b> — is where that earlier claim can be checked.</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('The war', win.war.span, 'One figure for every hundred children. Count them.')}
        ${pictogram(win.war.palestinian, win.war.israeli, 100, 'Palestinian children killed', 'Israeli children killed')}
        <div class="card" style="padding:22px 24px;margin-top:18px">
          <p>${fmt(win.war.palestinian)} Palestinian children in ${(function () { const a = new Date(2023, 9, 7), b = new Date(C.meta.data_through); return Math.round(10 * (b - a) / 864e5 / 365.25) / 10; })()} years: a child every <b>${(function () { const a = new Date(2023, 9, 7), b = new Date(C.meta.data_through); return Math.round(10 * 24 * (b - a) / 864e5 / win.war.palestinian) / 10; })()} hours</b>, without a pause, for three years.</p>
          <p class="chart-note">${esc(win.war.note)}</p>
          <p class="src">${esc(win.war.source)}</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('Before this war', 'The two windows a single source counted on both sides', 'The asymmetry is not a product of this war. It is what the record showed in every period anyone counted.')}
        <div class="grid c2">
          <div class="card" style="padding:22px 24px">
            <h3>${esc(win['intifada-1'].label)}</h3>
            <p class="chart-note" style="margin:4px 0 14px">${esc(win['intifada-1'].span)} — <b>${win['intifada-1'].ratio} to 1</b></p>
            ${pictogram(win['intifada-1'].palestinian, win['intifada-1'].israeli, 1, 'Palestinian children', 'Israeli children')}
            <p class="src">${esc(win['intifada-1'].source)}</p>
          </div>
          <div class="card" style="padding:22px 24px">
            <h3>${esc(win['intifada-2'].label)}</h3>
            <p class="chart-note" style="margin:4px 0 14px">${esc(win['intifada-2'].span)} — <b>${win['intifada-2'].ratio} to 1</b></p>
            ${pictogram(win['intifada-2'].palestinian, win['intifada-2'].israeli, 10, 'Palestinian children', 'Israeli children')}
            <p class="src">${esc(win['intifada-2'].source)}</p>
          </div>
        </div>
        <div class="grid c2" style="margin-top:18px">
          <div class="card" style="padding:22px 24px"><p class="chart-note">${esc(win['intifada-1'].note)}</p></div>
          <div class="card" style="padding:22px 24px"><p class="chart-note">${esc(win['intifada-2'].note)}</p></div>
        </div>
      </section>

      <section class="section wrap">
        ${head('Year by year', 'Every year the record can count', 'Two scales, because the counts differ by three orders of magnitude and one axis would render the earlier years as nothing. Red is Palestinian children, blue Israeli children.')}
        <div class="grid c2">
          ${yearBars(yearsIn('intifada-1').concat(yearsIn('intifada-2')).reduce((a, r) => { const p = a[a.length - 1]; if (p && p.year === r.year) { p.palestinian += r.palestinian; p.israeli += r.israeli; return a; } return a.concat([{ year: r.year, palestinian: r.palestinian, israeli: r.israeli }]); }, []),
            '1987 to 2012', 'B’Tselem to 28 September 2000, then Remember These Children. The two use different cut-offs — under 17 and under 18 — and the join is marked here rather than smoothed.', 'B’Tselem; Remember These Children.')}
          ${yearBars(yearsIn('war').map((r) => ({ year: r.year, palestinian: r.palestinian, israeli: r.israeli || 0 })),
            '2023 to ' + C.meta.data_through.slice(0, 4), '2023 begins on 7 October. The Israeli figure is the children killed on that day; no separate annual count is published for the years after it.', C.meta.sources[2])}
        </div>
      </section>

      <section class="section wrap">
        ${head('Ages', esc(C.ages.label), C.ages.note)}
        <div class="card" style="padding:22px 24px 24px">
          <div class="agebars">
            ${(function () {
              const top = Math.max.apply(null, C.ages.values);
              return C.ages.values.map((v, i) => `<div class="agebar" title="Age ${i}: ${fmt(v)}">
                <span class="agebar-track"><span class="agebar-fill" style="height:${(100 * v / top).toFixed(1)}%"></span></span>
                <span class="agebar-val">${fmt(v)}</span>
                <span class="agebar-lab">${i}</span>
              </div>`).join('');
            })()}
          </div>
          <p class="chart-note" style="margin-top:14px">${fmt(C.ages.total)} children in total, spread almost evenly across every year of childhood. The bars do not fall away at the ages a combatant would be found, because these were not combatants.</p>
          <p class="src">${esc(C.ages.source)}</p>
        </div>
      </section>

      <section class="section wrap">
        ${head('Beyond the killing', 'What the war did to the children it did not kill', '')}
        <div class="grid c3">
          ${C.beyond.map((b) => `<div class="card" style="padding:20px 22px">
            <div class="val" style="font-family:var(--serif);font-size:30px;color:var(--red);line-height:1.1">${fmt(b.value)}${b.unit ? esc(b.unit) : ''}</div>
            <h3 style="margin-top:6px">${esc(b.label)}</h3>
            <p class="chart-note" style="margin-top:6px">${esc(b.note)}</p>
            <p class="src">${esc(b.source)}</p>
          </div>`).join('')}
        </div>
      </section>

      <section class="section wrap">
        ${head('The long record', 'Nineteen forty-eight to the present, period by period', 'Including the periods no one counted. A blank cell is a gap in the documentation, not a period in which no child died.')}
        <div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="ch-table">
          <thead><tr><th class="col-period">Period</th><th class="col-span">Span</th><th>Palestinian children</th><th>Israeli children</th><th class="col-note">Basis</th></tr></thead>
          <tbody>${C.eras.map((e) => `<tr>
            <td><b>${esc(e.label)}</b><br><span class="small muted">${esc(e.note)}</span></td>
            <td class="small">${esc(e.span)}</td>
            <td class="num">${e.palestinian == null ? '<span class="muted">not counted</span>' : fmt(e.palestinian)}</td>
            <td class="num">${e.israeli == null ? '<span class="muted">not counted</span>' : fmt(e.israeli)}</td>
            <td class="small">${esc(basisWord[e.basis] || e.basis)}<br><span class="small muted">${esc(e.source)}</span></td>
          </tr>`).join('')}</tbody>
        </table></div></div>
      </section>

      <section class="section wrap">
        ${head('Every year', 'The full year table, including the years with no figure', 'Rows marked partial cover one side only, or one territory only. No total on this page is computed from them.')}
        <div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table class="ch-table">
          <thead><tr><th class="col-year">Year</th><th>Palestinian children</th><th>Israeli children</th><th>Basis</th><th class="col-note">Source and note</th></tr></thead>
          <tbody>${C.years.map((r) => `<tr${r.basis === 'counted' ? '' : ' class="row-partial"'}>
            <td><b>${esc(String(r.year))}</b><br><span class="small muted">${esc(r.label)}</span></td>
            <td class="num">${r.palestinian == null ? '<span class="muted">—</span>' : fmt(r.palestinian)}</td>
            <td class="num">${r.israeli == null ? '<span class="muted">—</span>' : fmt(r.israeli)}</td>
            <td class="small">${esc(basisWord[r.basis] || r.basis)}</td>
            <td class="small">${esc(r.note)}${r.source ? `<br><span class="small muted">${esc(r.source)}</span>` : ''}${r.israeli_source ? `<br><span class="small muted">${esc(r.israeli_source)}</span>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div></div>
      </section>

      <section class="section wrap">
        ${head('What is missing', 'The gaps, stated', 'A record that filled these in would be easier to read and would not be a record.')}
        <div class="grid c2">
          ${C.gaps.map((g) => `<div class="card" style="padding:20px 22px">
            <h3>${esc(g.label)}</h3>
            <p class="chart-note" style="margin-top:6px">${esc(g.what)}</p>
            <p class="src">${esc(g.source)}</p>
          </div>`).join('')}
        </div>
        <div class="card" style="padding:24px;margin-top:18px">
          <h3>How this page counts</h3>
          <p>${esc(C.meta.method)}</p>
          <p><b>Definition.</b> ${esc(C.meta.definition)}</p>
          <p class="src">${C.meta.sources.map(esc).join(' · ')}</p>
          <p class="chart-note">The whole file is published as <a href="data/children.json">data/children.json</a>, under no login and no key. Every figure above is read from it; nothing on this page is typed by hand. See <a href="#/api">open data</a>.</p>
        </div>
      </section>
    </div>`;
  }

  /* ---------- said and done ---------- */

  /* The record is normally read subject by subject: the toll in one place, the
     statements in another, the rulings in a third. Special intent is not shown
     that way. Under Article II of the Genocide Convention the intent and the
     act have to be contemporaneous, which means the only honest way to display
     the question is on a single axis of days: what was said on the day the
     killing was done, and what had already been ordered while it went on.

     So this route holds one day at a time. Nothing on it is new. Every item is
     the same item the rest of the site carries — the daily series, the
     statements, the determinations, the dated events, the chronology and the
     aid record — joined on the one field they have in common. */

  const DAY_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const longDay = (iso) => `${+iso.slice(8, 10)} ${DAY_MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  const longMonth = (iso) => `${DAY_MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  const weekdayOf = (iso) => WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  /* statements.json and legal.json state the date as the source stated it, so
     the precision has to be read off that prose and not off the sort key, which
     always looks like a day even where the source gave only a month. Three
     outcomes: a day the source named, a month it named, or neither — and an
     entry the record dates only to a year, or to a span of years, is left off
     this axis altogether rather than pinned to a day nobody claimed. */
  const DAY_PROSE = /^(?:c\.\s*)?\d{1,2}\s*(?:[–—-]\s*\d{1,2}\s*)?\s*[A-Za-z]/;
  const MONTH_PROSE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i;

  function datePrecision(prose) {
    const s = String(prose || '').trim();
    if (!MONTH_PROSE.test(s)) return 'none';
    return DAY_PROSE.test(s) ? 'day' : 'month';
  }

  /* Everything pinned to its date, once, at first render. The panels are then
     redrawn from these maps on every step of the scrubber, which is what makes
     the autoplay affordable. */
  let dayCache = null;

  function dayData() {
    if (dayCache) return dayCache;
    const dates = D.ts.daily.gaza.dates;
    const first = dates[0];
    const last = dates[dates.length - 1];
    const at = {};
    dates.forEach((iso, i) => { at[iso] = i; });

    const push = (into, key, value) => { (into[key] || (into[key] = [])).push(value); };
    const said = { day: {}, month: {} };
    const ordered = { day: {}, month: {} };
    const happened = { day: {}, month: {} };
    let unpinned = 0;

    (D.statements.items || []).forEach((x) => {
      if (!x.sort || x.sort < first || x.sort > last) return;
      const p = datePrecision(x.date);
      if (p === 'none') { unpinned++; return; }
      if (p === 'day') push(said.day, x.sort, x);
      else push(said.month, x.sort.slice(0, 7), x);
    });

    (D.legal.determinations || []).forEach((x) => {
      if (!x.sort || x.sort < first || x.sort > last) return;
      const p = datePrecision(x.date);
      if (p === 'none') return;
      if (p === 'day') push(ordered.day, x.sort, x);
      else push(ordered.month, x.sort.slice(0, 7), x);
    });

    ((D.events && D.events.events) || []).forEach((e) => {
      if (e.date < first || e.date > last) return;
      push(happened.day, e.date, {
        when: longDay(e.date), title: e.label, detail: e.detail, tone: e.tone, ref: e.ref, marked: true,
      });
    });

    /* The chronology dates itself in prose — "2 Mar 2025", "Nov 2023",
       "Sept–Nov 2024" — and app.js has already reduced each entry to the
       YYYYMMDD key it could parse. A zero day means the source gave a month
       and no more; a zero month means a year and no more, and that entry
       cannot go on a day axis at all. */
    (D.timeline || []).forEach((e) => {
      const key = e.key || 0;
      const year = Math.floor(key / 10000);
      const month = Math.floor(key / 100) % 100;
      const day = key % 100;
      if (!month || year < 2023) return;
      const iso = day ? `${year}-${pad2(month)}-${pad2(day)}` : `${year}-${pad2(month)}`;
      if (iso.slice(0, 7) < first.slice(0, 7) || iso.slice(0, 7) > last.slice(0, 7)) return;
      const item = {
        when: e.date, title: e.event, detail: e.note || '', tone: e.kind === 'context' ? 'muted' : 'red',
        ref: e.kind === 'context' ? 'Chronology' : 'Appendix B', marked: false,
      };
      if (day) push(happened.day, iso, item);
      else push(happened.month, iso, item);
    });

    dayCache = {
      dates, at, first, last, said, ordered, happened, unpinned,
      phases: (D.conduct && D.conduct.aid && D.conduct.aid.phases) || [],
      required: (D.conduct && D.conduct.aid && D.conduct.aid.baseline && D.conduct.aid.baseline.value) || 500,
    };
    return dayCache;
  }

  /* The daily series are cumulative totals as reported, so a day's own figure
     is the step between one report and the next. */
  function dayToll(i) {
    const g = D.ts.daily.gaza;
    const w = D.ts.daily.west_bank;
    const step = (s) => (i === 0 ? s[0] : Math.max(0, s[i] - s[i - 1]));
    return {
      killed: step(g.killed), injured: step(g.injured), children: step(g.children),
      women: step(g.women), aidSeekers: step(g.aid_seekers),
      wbKilled: step(w.killed), wbChildren: step(w.children), attacks: step(w.settler_attacks),
      total: g.killed[i], totalChildren: g.children[i], totalWomen: g.women[i],
      totalAidSeekers: g.aid_seekers[i], wbTotal: w.killed[i],
      share: g.killed[i] ? Math.round(1000 * g.children[i] / g.killed[i]) / 10 : 0,
      number: i + 1,
    };
  }

  const aidPhaseOn = (iso) => dayData().phases.find((p) => iso >= p.from && (!p.to || iso <= p.to)) || null;

  /* The day the route opens on: the one asked for, if the record covers it,
     and otherwise the last day the record has. A date outside the series is
     answered with the nearest day inside it rather than with an error, because
     a link that lands on nothing teaches the reader nothing. */
  function dayFor(sub) {
    const d = dayData();
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(sub || '')) ? sub : '';
    if (!asked) return d.last;
    if (d.at[asked] != null) return asked;
    if (asked < d.first) return d.first;
    if (asked > d.last) return d.last;
    // A gap in the reporting: take the first day on or after the one asked for.
    return d.dates.find((x) => x >= asked) || d.last;
  }

  /* ---- the panels ---- */

  function dayStatement(x, approximate) {
    return `<article class="quote-card st-card day-item">
      <div class="st-top">
        <span class="st-tier">${esc(x.tier || 'Statement')}</span>
        <span class="st-date">${esc(x.date)}${approximate ? ' — month only' : ''}</span>
        <button class="share-card" data-share="statement" title="Save this statement as a shareable card"
          aria-label="card — save this statement as an image">card</button>
      </div>
      <blockquote>“${esc(x.quote)}”</blockquote>
      <div class="who">${esc(x.speaker)}</div>
      <div class="role">${esc(x.role)}</div>
      <p class="st-src">${esc(x.source)}</p>
    </article>`;
  }

  function dayRuling(x, approximate) {
    return `<div class="day-item day-ruling">
      <div class="day-when">${esc(x.date)}${approximate ? ' — month only' : ''}</div>
      <p class="day-title">${esc(x.body)}</p>
      <p class="day-finding">${esc(x.finding)}</p>
      ${x.note ? `<p class="small muted">${esc(x.note)}</p>` : ''}
      <p class="src">${esc(x.ref || '')} — <a href="#/legal">the findings in full</a></p>
    </div>`;
  }

  function dayEvent(x, approximate) {
    return `<div class="day-item day-event tone-${esc(x.tone || 'muted')}">
      <div class="day-when">${esc(x.when)}${approximate ? ' — month only' : ''}</div>
      <p class="day-title">${esc(x.title)}</p>
      ${x.detail ? `<p class="small muted">${esc(x.detail)}</p>` : ''}
      <p class="src">${esc(x.ref || '')}</p>
    </div>`;
  }

  const dayEmpty = (what) => `<p class="chart-note day-none">${esc(what)}</p>`;

  function dayPanel(title, exact, approx, render, emptyText, monthLabel) {
    const body = exact.map((x) => render(x, false)).join('')
      + (approx.length
        ? `<p class="day-approx">${esc(monthLabel)}</p>` + approx.map((x) => render(x, true)).join('')
        : '');
    return `<div class="card day-panel">
      <h3>${esc(title)}</h3>
      ${body || dayEmpty(emptyText)}
    </div>`;
  }

  function dayAidPanel(iso) {
    const d = dayData();
    const phase = aidPhaseOn(iso);
    if (!phase) {
      return `<div class="card day-panel">
        <h3>What was crossing</h3>
        ${dayEmpty('This record dates no aid regime to this day.')}
      </div>`;
    }
    const shown = phase.display || (phase.value == null ? null : fmt(phase.value));
    const pct = phase.value == null ? null : Math.min(100, Math.round(100 * phase.value / d.required));
    return `<div class="card day-panel day-aid">
      <h3>What was crossing</h3>
      <p class="day-title">${esc(phase.label)}</p>
      ${shown == null
        ? `<p class="day-aid-none">No daily figure is published for this period.</p>`
        : `<div class="day-aid-val"><b>${esc(shown)}</b> <span>trucks a day, against ${fmt(d.required)} required</span></div>
           <div class="day-aid-bar"><span style="width:${pct}%"></span></div>`}
      <p class="small muted">${esc(phase.detail)}</p>
      <p class="src">${esc(phase.source)} — ${esc(phase.ref)}</p>
    </div>`;
  }

  /* Everything below the chart, rebuilt whenever the day changes. app.js
     replaces the contents of #day-panels with this string and nothing else. */
  function dayPanels(iso) {
    const d = dayData();
    const i = d.at[iso];
    const t = dayToll(i);
    const month = iso.slice(0, 7);
    const said = d.said.day[iso] || [];
    const saidMonth = d.said.month[month] || [];
    const ordered = d.ordered.day[iso] || [];
    const orderedMonth = d.ordered.month[month] || [];
    const happened = d.happened.day[iso] || [];
    const happenedMonth = d.happened.month[month] || [];

    return `<section class="section wrap day-sheet">
      <div class="day-head">
        <div>
          <div class="eyebrow">Day ${fmt(t.number)} of ${fmt(d.dates.length)}</div>
          <h2 class="day-date">${esc(weekdayOf(iso))}, ${esc(longDay(iso))}</h2>
        </div>
        <button class="share-card" data-share="day" title="Save this day as a shareable card"
          aria-label="card — save this day as an image">card</button>
      </div>

      <div class="grid c4">
        <div class="stat red"><div class="val">${fmt(t.killed)}</div><div class="lbl">Added to the reported Gaza toll that day</div></div>
        <div class="stat"><div class="val">${fmt(t.total)}</div><div class="lbl">Gaza dead reported by that day</div></div>
        <div class="stat"><div class="val">${fmt(t.totalChildren)}</div><div class="lbl">Children among them — ${t.share}% of the toll</div></div>
        <div class="stat blue"><div class="val">${fmt(t.wbTotal)}</div><div class="lbl">West Bank dead reported by that day</div></div>
      </div>
      <p class="chart-note day-toll-note">${t.killed === 0
        ? 'No new figure was published for Gaza on this day. A step of zero is a gap in the reporting, not a day on which nobody was killed.'
        : `Also that day: <b>${fmt(t.children)}</b> children, <b>${fmt(t.women)}</b> women and <b>${fmt(t.aidSeekers)}</b> people killed while seeking aid were added to the reported totals, along with <b>${fmt(t.injured)}</b> injured. In the West Bank, <b>${fmt(t.wbKilled)}</b> killed and <b>${fmt(t.attacks)}</b> settler attack${t.attacks === 1 ? '' : 's'}.${
          t.children === 0 && t.women === 0 && t.aidSeekers === 0
            ? ' The breakdown by category is published less often than the headline total, so a zero in those three records a day with no new breakdown, not a day on which no child or woman was killed.'
            : ''}`}</p>

      <div class="grid c2 day-panels-grid">
        ${dayPanel('What was said', said, saidMonth, dayStatement,
          'No statement in this record is dated to this day.',
          'And said this month, where the source gave a month and no day:')}
        ${dayPanel('What was ordered', ordered, orderedMonth, dayRuling,
          'No court, commission or inquiry recorded a finding on this day.',
          'And found this month, where the source gave a month and no day:')}
        ${dayPanel('What was happening', happened, happenedMonth, dayEvent,
          'Nothing in the chronology is dated to this day.',
          'And this month, where the chronology gives a month and no day:')}
        ${dayAidPanel(iso)}
      </div>
    </section>`;
  }

  function dayView(sub) {
    if (!D.ts || !D.ts.daily || !D.ts.daily.gaza) {
      return `<div class="view"><section class="section wrap">${head('Said and done', 'One day at a time', 'The daily series did not load.')}</section></div>`;
    }
    const d = dayData();
    const iso = dayFor(sub);
    const i = d.at[iso];

    return `<div class="view">
      <section class="section wrap">
        ${head('Said and done', 'The war, one day at a time',
          'Special intent is not proved by a quotation and it is not proved by a body count. It is proved by the two of them '
          + 'standing on the same date. This page puts them there: pick any day between 7 October 2023 and '
          + esc(longDay(d.last)) + ', and it reports what the toll did that day, what was said, what had been ordered, what '
          + 'was happening and what was being allowed across the crossings. Nothing here is new. It is the record the rest of '
          + 'this site already holds, joined on the one field every part of it shares.')}

        <div class="card day-bar">
          <div class="day-controls">
            <button class="chart-tool" id="day-prev" title="The day before" aria-label="the day before">◀ back</button>
            <input type="range" id="day-range" min="0" max="${d.dates.length - 1}" step="1" value="${i}"
              aria-label="Day of the war" aria-valuetext="${esc(longDay(iso))}">
            <button class="chart-tool" id="day-next" title="The day after" aria-label="the day after">on ▶</button>
          </div>
          <div class="day-controls day-controls-2">
            <label class="small muted" for="day-date">Go to</label>
            <input type="date" id="day-date" value="${iso}" min="${d.first}" max="${d.last}">
            <button class="chart-tool day-play" id="day-play" aria-pressed="false"
              title="Run the whole war, day by day" aria-label="play">
              <svg class="day-icon day-icon-play" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
                <path d="M1.5 1.2 10.8 7l-9.3 5.8z"/></svg>
              <svg class="day-icon day-icon-pause" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
                <path d="M1.6 1.4h3.1v11.2H1.6zM7.3 1.4h3.1v11.2H7.3z"/></svg>
            </button>
            <input type="range" id="day-speed" class="day-speed" min="1" max="10" step="1" value="2"
              title="How many days play walks in a second"
              aria-label="Playing speed" aria-valuetext="2 days a second">
            <span class="small muted" id="day-speed-note">2 days a second</span>
            <button class="chart-tool" id="day-copy" title="Copy a link to this day">link</button>
            <span class="small muted" id="day-pos">${esc(longDay(iso))}</span>
          </div>
        </div>

        ${chartCard('day-spine', 'The spine — Gaza deaths added to the reported toll, day by day',
          'The upright line is the day this page is standing on. Click anywhere on the chart to move it. '
          + 'Switch on <b>events</b> to mark the dated turning points against the same axis.',
          '§6.1, Appendix B')}
      </section>

      <div id="day-panels">${dayPanels(iso)}</div>

      <section class="section wrap">
        ${head('How to read it', 'What this page can and cannot pin to a day', '')}
        <div class="card" style="padding:24px 26px">
          <p>The daily figures are the totals as they were reported, so a day's own number is the step between one report and the next. On <b>${fmt(d.dates.filter((x, n) => (n === 0 ? false : D.ts.daily.gaza.killed[n] === D.ts.daily.gaza.killed[n - 1])).length)}</b> of the ${fmt(d.dates.length)} days on this axis that step is zero, which records a day on which no new figure was published, not a day on which nobody was killed.</p>
          <p>Statements and findings are placed on the date their own source gives them. Where the source named a day, the entry sits on that day. Where it named only a month, the entry is shown under the month and labelled as such, so that nothing on this page asserts a precision the record does not have. ${d.unpinned ? `<b>${fmt(d.unpinned)}</b> statements in the record are dated to a year or a span of years and cannot be placed on a day at all; they are on the <a href="#/statements">statements page</a> and are not shown here.` : ''}</p>
          <p>The aid record works the same way. A phase states a daily figure only where the report publishes one for that span; elsewhere the page says no figure is published, which is not the same as saying the crossings were open. Every phase names the section of the report it comes from.</p>
          <p class="src">Daily series: ${esc(D.ts.meta.source)}. Statements: §6.2 and Appendix C. Findings: Part VI and Part XV. Chronology: Appendix B and the contextual chronology. Aid: §6.3 and §6.8.</p>
        </div>
      </section>
    </div>`;
  }

  /* ---------- api ---------- */

  const routes = {
    overview, data: dataView, timeline: timelineView,
    evidence: evidenceView, rebuttals: rebuttalsView,
    statements: statementsView, legal: legalView, sources: sourcesView,
    tour: tourView, api: apiView, changelog: changelogView, embed: embedView,
    method: methodView, children: childrenView, day: dayView,
    provenance: provenanceView, answer: answerView, ledger: ledgerView,
    mp: mpView,
  };

  return {
    setData(d) { D = d; },
    render(name, sub) { return (routes[name] || overview)(sub); },
    has(name) { return !!routes[name]; },
    dataChapters: DATA_CHAPTERS,
    earlyOverview,
    charts: chartIndex,
    scorecardRows,
    speakerSlug,
    dayPanels,
    dayLabel: longDay,
    origin: SITE_ORIGIN,
    meta,
    blocksHTML, esc, fmt,
    answerFigure, answerStatements,
    constituencyLetter(index) {
      const C = D.constituency;
      return mpLetter(C.members[index], C.divisions);
    },
    challengeUrl(entry, kind) { return fxChallengeUrl(D.falsify, entry, kind); },
  };
})();
