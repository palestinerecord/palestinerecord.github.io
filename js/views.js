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
  function chartCard(name, title, note, ref, cls) {
    return `<div class="card chart-card" id="chart-${name}" data-chart-card="${name}"
        data-title="${esc(title)}" data-source="${esc(ref || '')}">
      <div class="chart-head">
        <div><h3>${esc(title)}</h3><p>${note || ''}</p></div>
        <div class="chart-tools">
          ${ref ? `<span class="chart-ref">${esc(ref)}</span>` : ''}
          ${/* charts.js declares Charts with const, which binds in the script
               scope and not on window, so this must test the bare name. */
            typeof Charts !== 'undefined' && Charts.hasEvents && Charts.hasEvents(name)
            ? `<button class="chart-tool" data-tool="events" title="Mark the dated events on this series" aria-label="Show dated events on this chart" aria-pressed="false">events</button>`
            : ''}
          <button class="chart-tool" data-tool="link" title="Copy a link to this chart" aria-label="Copy a link to this chart">link</button>
          <button class="chart-tool" data-tool="png" title="Download a captioned PNG" aria-label="Download this chart as a PNG">png</button>
          <button class="chart-tool" data-tool="csv" title="Download the plotted data" aria-label="Download this chart's data as CSV">csv</button>
          <button class="chart-tool" data-tool="table" title="Read the numbers as a table" aria-label="Show this chart as a table" aria-expanded="false">table</button>
        </div>
      </div>
      <div class="chart ${cls || ''}" data-chart="${name}" role="img" aria-label="${esc(title)}"></div>
      <div class="chart-table" hidden></div>
    </div>`;
  }

  function statCard(s, tone) {
    return `<div class="stat ${tone || ''}">
      <div class="val" data-count="${s.value}">${compact(s.value)}${s.suffix ? `<span class="suffix">${esc(s.suffix)}</span>` : ''}${s.unit || ''}</div>
      <div class="lbl">${esc(s.label)}</div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      ${s.source ? `<div class="src">${esc(s.source)}${s.ref ? ' · ' + esc(s.ref) : ''}</div>` : ''}
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

  /* ---------- overview ---------- */

  function overview() {
    const s = D.report.stats;
    const h = D.fig.headline;
    const meta = D.ts.meta;

    return `<div class="view">
      <section class="hero wrap">
        <div class="hero-inner">
          <div class="hero-flag">
            <img class="flag-ps" src="assets/flag-palestine.svg?v=28" alt="Flag of Palestine">
            <span>Palestine</span>
          </div>
          <h1 data-hero-title>The Documented<span>Record</span></h1>
          <p class="hero-lede" data-hero-lede>${esc(D.report.title)}. Every heading, paragraph, table and citation of the
            source report, rendered as an interactive archive — with daily casualty data plotted month by month
            across Gaza and the West Bank.</p>
          <div class="hero-meta" data-hero-meta>
            <span><b>${fmt(s.words)}</b> words</span>
            <span><b>${s.parts}</b> parts · <b>${s.sections}</b> sections</span>
            <span><b>${s.tables}</b> tables</span>
            <span><b>${D.timeline.length}</b> chronology entries</span>
            <span><b>${D.report.bibliography.length}</b> sources</span>
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
            ['#/sources', 'Sources', D.sources.groups.reduce((n, g) => n + g.items.length, 0) + ' linked primary sources — courts, UN bodies, NGOs, datasets and archives — plus the report\'s ' + D.report.bibliography.length + ' bibliography entries.'],
          ].map(([href, title, note]) => `<a class="card lift" href="${href}" style="text-decoration:none">
            <h3 style="font-size:19px;margin-bottom:8px">${title}</h3>
            <p class="small muted" style="margin:0">${note}</p>
          </a>`).join('')}
        </div>
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
        ${head('Source tables', `All ${D.report.stats.tables} tables from the report`, 'Reproduced exactly as they appear in the source document, with the part and section each belongs to.')}
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

  function dataView(chapter) {
    const id = DATA_BODY[chapter] ? chapter : DATA_CHAPTERS[0].id;
    return `<div class="view wrap">${dataNav(id)}${DATA_BODY[id]()}</div>`;
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
          ${t.map((e, i) => `<div class="tl-item ${era(e.year)} tl-${e.kind}" data-year="${e.year || ''}" data-i="${i}">
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
        ${head('Evidence', 'The complete report', `All ${D.report.stats.parts} parts, ${D.report.stats.sections} sections, ${D.report.stats.tables} tables and ${fmt(D.report.stats.words)} words of <code>report-final.md</code>, reproduced without omission. Every heading, paragraph, list and table in the source document appears below.`)}
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

  /* Part XVI answers the eleven defences that come up in every argument about
     Gaza. Inside Evidence they are eleven sections a long way down a very long
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
          <code>report-final.md</code> as it stands, and the link beside it opens the same text inside the
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

    const card = (x, i) => `<article class="card quote-card st-card lift" data-i="${i}" data-cat="${esc(x.cat.join(' '))}">
      <div class="st-top">
        <span class="st-tier">${esc(x.tier)}</span>
        <span class="st-date">${esc(x.date)}</span>
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
        ${head('Statements', `${items.length} statements on the record of intent`, esc(S.meta.description) + ' Statements by serving officials carry particular evidentiary weight in the assessment of intent: they are admissions, not allegations. Contested attributions are marked as contested and are not relied on.')}
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
    const b = D.report.bibliography;

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
        ${head('Bibliography', `The report's own bibliography, ${b.length} entries`, 'Reproduced from <code>report-final.md</code> exactly as it appears there, grouped by its own categories.')}
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
            <p class="small muted"><code>build.py</code> parses <code>report-final.md</code> into structured JSON, emitting every
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
            Where a figure is an estimate rather than a count — as with the mortality studies — it is labelled as one.</p>
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

  /* ---------- per-route metadata ---------- */

  /* A hash route never reaches the server, so without this every route
     shares one title, one description and one social card. app.js rewrites
     the head from this table on each render, and prerender.py reads the
     result back out of the rendered DOM rather than keeping a second copy
     of it — so a static snapshot cannot disagree with the live page. */
  const SITE = 'The Documented Record';
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
    sources: {
      title: 'Sources — what the record rests on',
      desc: 'The evidentiary base: courts, UN bodies, human rights organisations, open datasets, academic '
        + 'work and Israeli sources, each one linked.',
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
    return {
      slug,
      // The tour has no meaningful step 0, so its canonical route is step one.
      path: chapter ? `#/data/${sub}` : (slug === 'tour' ? '#/tour/1' : `#/${slug}`),
      title: slug === 'overview' ? m.title : `${m.title} · ${SITE}`,
      desc: m.desc,
      card: `assets/og/${slug}.png`,
    };
  }

  /* ---------- api ---------- */

  const routes = {
    overview, data: dataView, timeline: timelineView,
    evidence: evidenceView, rebuttals: rebuttalsView,
    statements: statementsView, legal: legalView, sources: sourcesView,
    tour: tourView,
  };

  return {
    setData(d) { D = d; },
    render(name, sub) { return (routes[name] || overview)(sub); },
    has(name) { return !!routes[name]; },
    dataChapters: DATA_CHAPTERS,
    meta,
    blocksHTML, esc, fmt,
  };
})();
