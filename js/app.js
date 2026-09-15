/* ============================================================
   app.js — data loading, hash router, per-view behaviour,
   GSAP scroll reveals, and full-text search.

   Layered separation: GSAP owns DOM transforms, ECharts owns its
   own canvases, Three.js (scene.js) owns #scene. No property is
   animated by more than one library.
   ============================================================ */

const App = (function () {
  const app = document.getElementById('app');
  const boot = document.getElementById('boot');
  const bootStatus = boot.querySelector('.boot-status');
  const nav = document.getElementById('nav');

  let D = null;
  let searchIndex = null;
  const triggers = [];
  /* Set when the overview has been painted from headline.json alone, and
     cleared by the first full render, which must not animate a hero and a set
     of figures the reader is already looking at. */
  let earlyPainted = false;

  if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const VIEWS = ['overview', 'tour', 'data', 'children', 'day', 'timeline', 'evidence', 'rebuttals', 'statements',
    'legal', 'sources', 'provenance', 'answer', 'ledger', 'method', 'api', 'changelog', 'embed'];

  /* index.html?prerender=1 renders the text and nothing else: no charts, no
     scroll reveals, no counting numbers, no WebGL scene. prerender.py uses it
     to dump a static snapshot of each route. Without it a dumped DOM catches
     the reveals mid-flight — elements frozen at opacity 0, headline figures
     frozen part-way through counting up — and carries forty dead canvases. */
  const STATIC = /(^|[?&])prerender=1(&|$)/.test(location.search);

  /* ---------- loading ---------- */

  /* Twenty files, fetched together rather than one after another: the boot
     time is then the slowest single file, not the sum of all nineteen. The map
     geometry is not among them — charts.js fetches that only if a map is
     actually drawn — and neither is report.json, the largest file on the site,
     which only the five routes in REPORT_ROUTES read and which is fetched on
     the first of them (see ensureReport). What the other routes need of it is
     in report-meta.json (the counts) and chronology.json (Appendix B). */
  async function load() {
    const files = [
      ['rmeta', 'data/report-meta.json'],
      ['chronology', 'data/chronology.json'],
      ['ts', 'data/timeseries.json'],
      ['fig', 'data/figures.json'],
      ['statements', 'data/statements.json'],
      ['sources', 'data/sources.json'],
      ['history', 'data/history.json'],
      ['children', 'data/children.json'],
      ['extra', 'data/timeline-extra.json'],
      ['legal', 'data/legal.json'],
      ['long', 'data/long-record.json'],
      ['positions', 'data/world-positions.json'],
      ['war', 'data/war-record.json'],
      ['conduct', 'data/conduct-record.json'],
      ['events', 'data/chart-events.json'],
      ['elements', 'data/elements.json'],
      ['prov', 'data/provenance.json'],
      ['patterns', 'data/claim-patterns.json'],
      ['entities', 'data/entities.json'],
      ['falsify', 'data/falsification.json'],
    ];
    // The open-data manifest is written by manifest.py and describes the files
    // above. It is fetched separately and never fatally: a dashboard that will
    // not load because its own index of itself is missing would be absurd.
    const manifest = fetch('data/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    let done = 0;
    bootStatus.textContent = 'Loading the documented record…';
    const parts = await Promise.all(files.map(async ([key, path]) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path} — HTTP ${res.status}`);
      const json = await res.json();
      done++;
      bootStatus.textContent = `Loading the documented record… ${done} of ${files.length}`;
      return [key, json];
    }));
    const D = {};
    parts.forEach(([key, json]) => { D[key] = json; });
    D.timeline = mergeTimeline(D.chronology.entries, D.extra);
    D.manifest = await manifest;
    return D;
  }

  /* ---------- the full report, on demand ---------- */

  /* The routes that reproduce the report itself, rather than quoting figures
     drawn from it. Everything else renders without report.json. */
  const REPORT_ROUTES = ['evidence', 'rebuttals', 'legal', 'changelog', 'answer'];

  let reportPromise = null;

  /* Promise-cached, the same pattern charts.js uses for map geometry: the
     second route to ask for the report waits on the first route's fetch rather
     than starting another one. */
  function ensureReport() {
    if (D && D.report) return Promise.resolve(D.report);
    if (!reportPromise) {
      reportPromise = fetch('data/report.json')
        .then((r) => { if (!r.ok) throw new Error(`data/report.json — HTTP ${r.status}`); return r.json(); })
        .then((json) => {
          D.report = json;
          if (Views.setData) Views.setData(D);
          return json;
        })
        .catch((err) => { reportPromise = null; throw err; });
    }
    return reportPromise;
  }

  /* `#/data/tables` reads report.tables, and the search index reads every
     paragraph of it, so both go through ensureReport as well. */
  function routeNeedsReport(name, sub) {
    return REPORT_ROUTES.indexOf(name) >= 0 || (name === 'data' && sub === 'tables');
  }

  /* ---------- the first screen ---------- */

  /* data/headline.json is under two kilobytes and carries the eight headline
     figures and the counts the hero quotes. Painting the overview from it ends
     the loading screen as soon as that one small file lands, rather than after
     the fifteen files the rest of the record needs. The full render follows and
     replaces it with the same markup plus the charts.

     Only the overview, and only a real visit: the prerenderer wants the
     finished route, and any other route would be painted and then thrown away. */
  async function earlyPaint() {
    if (STATIC) return false;
    // An in-page anchor is not a route, and currentRoute() reads it as the
    // overview; rendering the overview under it would be thrown away at once.
    if (location.hash && location.hash.indexOf('#/') !== 0) return false;
    if (currentRoute().name !== 'overview') return false;
    try {
      const res = await fetch('data/headline.json');
      if (!res.ok) return false;
      const h = await res.json();
      if (!boot.isConnected) return false;
      document.body.setAttribute('data-view', 'overview');
      app.innerHTML = Views.earlyOverview(h);
      earlyPainted = true;
      dismissBoot();
      return true;
    } catch (err) {
      console.error('early paint', err);
      return false;
    }
  }

  let bootGone = false;

  function dismissBoot() {
    if (bootGone) return;
    bootGone = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 600);
  }

  /* ---------- the names on the loading screen ---------- */

  /* The dashboard aggregates 72,835 identification records and, without this,
     never shows one of them. The loading screen cycles through a slice of the
     list while the record loads, and states what reading the whole list at that
     pace would actually cost in hours — the count is abstract, the duration is
     not. Fetched on its own so a slow or missing names file delays nothing, and
     static under prefers-reduced-motion. */
  const NAME_PACE = 450;

  function bootNames() {
    if (!boot.isConnected) return;
    fetch('data/names-boot.json').then((r) => (r.ok ? r.json() : null)).then((file) => {
      if (!file || !file.people.length || !boot.isConnected) return;
      const wrap = document.getElementById('boot-names');
      const line = document.getElementById('boot-name');
      const total = file.meta.identified;
      const hours = Math.floor(total * NAME_PACE / 3600000);
      const minutes = Math.round((total * NAME_PACE / 60000) % 60);
      document.getElementById('boot-names-note').textContent =
        `${Views.fmt(total)} of the dead have been identified by name. At this pace, reading all of them ` +
        `would take ${hours} hours and ${minutes} minutes.`;
      wrap.hidden = false;

      const show = (p) => {
        line.innerHTML = `<span class="boot-name-ar" dir="rtl" lang="ar">${Views.esc(p[0])}</span>` +
          `<span class="boot-name-en">${Views.esc(p[1])}${p[2] == null ? '' : `, ${p[2]}`}</span>`;
      };
      show(file.people[0]);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let i = 0;
      const timer = setInterval(() => {
        if (!boot.isConnected) { clearInterval(timer); return; }
        i = (i + 1) % file.people.length;
        show(file.people[i]);
      }, NAME_PACE);
    }).catch(() => {});
  }

  /* The report's chronology (Appendix B) records crimes and massacres;
     timeline-extra.json records the legal and political steps between
     them. Both are shown in one ordered list, tagged so they stay
     distinguishable. Appendix B entries carry no sort key, so derive
     one from the date string. */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function sortKey(entry) {
    if (entry.sort) {
      const p = entry.sort.split('-');
      return Number(p[0]) * 10000 + Number(p[1]) * 100 + Number(p[2]);
    }
    const d = String(entry.date || '');
    const year = entry.year || Number((d.match(/\b(1[89]|20)\d{2}\b/) || [0])[0]);
    const month = (d.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) || [])[0];
    const day = (d.match(/^(\d{1,2})\b/) || [])[1];
    return year * 10000 + (month ? MONTHS[month.toLowerCase()] * 100 : 0) + (day ? Number(day) : 0);
  }

  function mergeTimeline(reportEntries, extra) {
    const a = reportEntries.map((e) => Object.assign({}, e, { kind: 'record' }));
    const b = (extra.items || []).map((e) => Object.assign({}, e, { kind: 'context' }));
    return a.concat(b).map((e, i) => {
      e.key = sortKey(e);
      e.seq = i;
      return e;
    }).sort((x, y) => x.key - y.key || x.seq - y.seq);
  }

  /* ---------- routing ---------- */

  /* Routes are `#/name` or `#/name/sub` — the sub-route is the Data
     route's chapter, and is passed straight through to Views.render. */
  function currentRoute() {
    const path = (location.hash || '#/overview').replace(/^#\//, '').split(/[?&]/)[0].split('/');
    const name = VIEWS.indexOf(path[0]) >= 0 ? path[0] : 'overview';
    return { name, sub: path[1] || '' };
  }

  let rendered = null;
  let renderedSub = '';

  function route() {
    const hash = location.hash || '#/overview';

    // In-page anchors (#part-…, #sec-…, #legal-…) are not routes. Scroll, do not
    // re-render — unless nothing is on screen yet, which is the case when someone
    // opens or reloads a link straight into the middle of a document. Then render
    // the view that owns the anchor first, and scroll to it once it exists.
    if (hash.indexOf('#/') !== 0) {
      const id = hash.slice(1);
      const scroll = () => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: rendered ? 'smooth' : 'auto', block: 'start' });
      };
      if (rendered) { scroll(); return; }
      const owner = id.indexOf('legal-') === 0 ? 'legal' : 'evidence';
      render(owner);
      // Both owners reproduce the report, so the anchor may not exist until
      // report.json has arrived and the view has rendered a second time.
      ensureReport().then(() => requestAnimationFrame(scroll)).catch(() => {});
      return;
    }

    const r = currentRoute();
    render(r.name, r.sub);
  }

  /* ---------- per-route head ---------- */

  /* The head shipped in index.html describes the overview and nothing else.
     Rewrite it on every render so the tab, the browser history, anything that
     runs the page before reading its tags, and the static snapshots written by
     prerender.py all carry the metadata of the route actually on screen.
     `origin` is the deployed site, taken from the canonical tag rather than
     from location, so a snapshot rendered off localhost still points at the
     public URL. */
  function setHead(name, sub) {
    const m = Views.meta(name, sub);
    const canonical = document.querySelector('link[rel=canonical]');
    const origin = (canonical.getAttribute('data-site') || canonical.href)
      .replace(/[#?].*$/, '').replace(/\/*$/, '/');
    const url = origin + m.path;
    const card = origin + m.card;

    canonical.setAttribute('data-site', origin);
    canonical.href = url;
    document.title = m.title;

    const set = (selector, value) => {
      const el = document.head.querySelector(selector);
      if (el) el.setAttribute('content', value);
    };
    set('meta[name=description]', m.desc);
    set('meta[property="og:url"]', url);
    set('meta[property="og:title"]', m.title);
    set('meta[property="og:description"]', m.desc);
    set('meta[property="og:image"]', card);
    set('meta[property="og:image:alt"]', `${m.title} — a card carrying the title of this section of the record.`);
    set('meta[name="twitter:title"]', m.title);
    set('meta[name="twitter:description"]', m.desc);
    set('meta[name="twitter:image"]', card);
  }

  function render(name, sub) {
    document.body.setAttribute('data-view', name);
    try { setHead(name, sub); } catch (err) { console.error('head', err); }

    // The four routes that reproduce the report wait for it here rather than
    // making every other route wait for it at boot. One line on screen while
    // it arrives; the render then runs again with the report in hand.
    if (routeNeedsReport(name, sub) && !(D && D.report)) {
      app.innerHTML = '<div class="section"><div class="card" style="padding:26px">'
        + '<p class="chart-note">Loading the full report…</p></div></div>';
      ensureReport().then(() => {
        const now = currentRoute();
        if (now.name === name && (now.sub || '') === (sub || '')) render(name, sub);
      }).catch((err) => {
        app.innerHTML = '<div class="section"><div class="card" style="padding:26px">'
          + `<p class="chart-note">Could not load the report: ${Views.esc(err.message)}</p></div></div>`;
        console.error(err);
      });
      return;
    }

    Charts.dispose();
    while (triggers.length) triggers.pop().kill();

    app.innerHTML = Views.render(name, sub);
    window.scrollTo(0, 0);

    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    nav.classList.remove('open');

    // Chrome, motion and behaviour are all optional extras — the content is not.
    const settled = earlyPainted;
    earlyPainted = false;
    if (!STATIC) {
      try { Charts.init(app, D); } catch (err) { console.error('charts', err); }
      try { reveal(settled); countUp(settled); } catch (err) { console.error('motion', err); }
    }
    try { tableOverflow(); } catch (err) { console.error('tables', err); }
    try { behaviours[name] && behaviours[name](); } catch (err) { console.error('behaviour', name, err); }
    if (window.Scene && !STATIC) Scene.setView(name);
    try { scrollToChart(); } catch (err) { console.error('deep link', err); }
    try { citation(name, sub); } catch (err) { console.error('citation', err); }
    rendered = name;
    renderedSub = sub || '';
  }

  /* ---------- shared motion ---------- */

  /* `settled` marks the render that replaces the early overview: its hero and
     its figures are already on screen and must not animate in a second time. */
  function reveal(settled) {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const hero = settled ? [] : app.querySelectorAll('[data-hero-title], [data-hero-lede], [data-hero-meta], [data-hero-cta]');
    if (hero.length) {
      gsap.from(hero, { y: 26, opacity: 0, duration: 0.9, stagger: 0.09, ease: 'power3.out' });
    }

    app.querySelectorAll('.section').forEach((section) => {
      const items = section.querySelectorAll('.section-head, .card, .stat');
      if (!items.length) return;
      const t = gsap.from(items, {
        y: 30, opacity: 0, duration: 0.7, stagger: 0.05, ease: 'power2.out',
        scrollTrigger: { trigger: section, start: 'top 86%', once: true },
      });
      if (t.scrollTrigger) triggers.push(t.scrollTrigger);
    });
    ScrollTrigger.refresh();
  }

  // Count the headline numbers up when they scroll into view.
  function countUp(settled) {
    const nodes = app.querySelectorAll('.val[data-count]');
    if (!nodes.length) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        io.unobserve(el);
        const target = Number(el.dataset.count);
        const final = el.innerHTML;
        // Small and fractional figures are left alone: rounding 38.5 down to
        // 38 mid-flight puts a wrong number on screen, and on a screenshot.
        if (reduce || !target || Math.abs(target) < 100) return;
        const dp = Number.isInteger(target) ? 0 : 1;
        const started = performance.now();
        const suffix = el.querySelector('.suffix');
        const tail = suffix ? suffix.outerHTML : '';
        const step = (now) => {
          const p = Math.min(1, (now - started) / 1100);
          const eased = 1 - Math.pow(1 - p, 3);
          const raw = target * eased;
          const v = dp ? Math.round(raw * 10) / 10 : Math.round(raw);
          el.innerHTML = (v >= 1000000 ? (v / 1000000).toFixed(1) + 'm'
            : v >= 10000 ? Math.round(v / 1000) + 'k'
              : v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })) + tail;
          if (p < 1) requestAnimationFrame(step); else el.innerHTML = final;
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    nodes.forEach((n) => {
      if (settled) {
        // Already read, already on screen: counting it up from zero now would
        // replace a correct figure with a wrong one for a second.
        const r = n.getBoundingClientRect();
        if (r.bottom > 0 && r.top < innerHeight) return;
      }
      io.observe(n);
    });
  }

  /* ---------- freshness and return visits ---------- */

  const DAY = 86400000;

  const readableDate = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.getUTCDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  };

  /* A record that silently goes stale is worse than one that says so. The
     badge carries the date of the last casualty report and turns amber when
     the feed has not moved for a week. */
  function freshness() {
    const el = document.getElementById('freshness');
    if (!el) return;
    const feed = D.ts.meta.last_daily_update;
    const age = Math.floor((Date.now() - new Date(feed + 'T00:00:00Z').getTime()) / DAY);
    /* The label is its own element because the bar drops it before it drops
       the date: narrow, the pill is a dot and a date, and the title explains
       the rest. */
    el.innerHTML = `<span class="dot"></span><span><span class="fresh-label">Casualty data </span>` +
      `<b>${Views.esc(readableDate(feed))}</b></span>`;
    el.title = `Casualty time-series last updated ${readableDate(feed)} (${age} days ago). Report and curated figures compiled ${readableDate(D.ts.meta.generated)}.`;
    el.classList.toggle('stale', age > 7);
    el.hidden = false;
  }

  /* No tracking and no server: the last visit is a single localStorage
     record, compared against the live total on the next visit. */
  const VISIT_KEY = 'documented-record-last-visit';

  function sinceLastVisit() {
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null'); } catch (err) { prev = null; }
    const now = {
      date: new Date().toISOString().slice(0, 10),
      killed: D.ts.summary.killed.total,
      children: D.ts.summary.killed.children,
      press: D.ts.summary.killed.press,
    };
    try { localStorage.setItem(VISIT_KEY, JSON.stringify(now)); } catch (err) { /* private mode */ }
    if (!prev || !prev.killed || prev.date === now.date) return;
    const added = now.killed - prev.killed;
    if (added <= 0) return;
    returning = {
      date: prev.date,
      killed: added,
      children: Math.max(0, now.children - prev.children),
      press: Math.max(0, now.press - prev.press),
    };
  }

  let returning = null;

  function showReturning() {
    const el = document.getElementById('since-last');
    if (!el || !returning) return;
    const bits = [`<b>${Views.fmt(returning.killed)}</b> more people killed`];
    if (returning.children) bits.push(`<b>${Views.fmt(returning.children)}</b> of them children`);
    if (returning.press) bits.push(`<b>${Views.fmt(returning.press)}</b> more journalists`);
    el.innerHTML = `Since you were last here on ${Views.esc(readableDate(returning.date))}: ${bits.join(', ')}.`;
    el.hidden = false;
  }

  /* ---------- the names on the field ---------- */

  /* The hero field is one point per death. This makes it addressable: each
     point takes a record from the identification list and gives its name on
     hover. Delegated, because the hero is re-rendered on every route change. */
  function heroNames() {
    app.addEventListener('click', async (e) => {
      const btn = e.target.closest && e.target.closest('#names-toggle');
      if (!btn || !window.Scene || !window.Scene.names) return;
      const note = document.getElementById('names-note');
      const turningOn = btn.getAttribute('aria-pressed') !== 'true';
      if (turningOn) { btn.disabled = true; btn.textContent = 'Loading the names…'; }
      try {
        const r = await window.Scene.names(turningOn);
        btn.setAttribute('aria-pressed', r.on ? 'true' : 'false');
        btn.classList.toggle('on', r.on);
        btn.textContent = r.on ? 'Hide the names' : 'Name the points';
        if (note) {
          note.innerHTML = r.on
            ? `Hover any point. Amber is a person under 18, red an adult, grey one of the
               <b>${Views.fmt(r.counted - r.identified)}</b> counted dead who have never been identified.
               Of the ${Views.fmt(r.drawn)} points drawn, ${Views.fmt(r.named)} carry a record — one
               each, none used twice — and the remaining ${Views.fmt(r.drawn - r.named)} stand for the
               unidentified.`
            : `Each point behind this text is one death in Gaza. Naming them loads the
               ${Views.fmt(r.identified)}-record identification list — about two megabytes.`;
        }
      } catch (err) {
        btn.textContent = 'Name the points';
        if (note) note.textContent = 'The names could not be loaded. ' + err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- chart tools ---------- */

  /* One delegated handler for every chart card on every route: copy a deep
     link to the chart, export it as a captioned PNG or as CSV, or read the
     plotted numbers as an HTML table. */
  /* ---------- tables that are wider than the page ---------- */

  /* A source table at 390 px is 567 px wide. `.table-wrap` scrolls it, which is
     the right behaviour, but nothing on screen says a column is missing. Wrap
     each one, fade its right edge while there is more to the right, and state
     it in a line of text for a reader who cannot see the fade. Done here rather
     than in the templates because six different places emit a `.table-wrap`,
     including the chart table tool, which inserts one after the render. */
  function tableOverflow(root) {
    (root || app).querySelectorAll('.table-wrap').forEach((wrap) => {
      let shell = wrap.parentElement;
      if (!shell || !shell.classList.contains('table-scroll')) {
        shell = document.createElement('div');
        shell.className = 'table-scroll';
        wrap.parentNode.insertBefore(shell, wrap);
        shell.appendChild(wrap);
        const note = document.createElement('p');
        note.className = 'table-note';
        note.textContent = 'This table is wider than the screen — scroll it sideways to see the rest.';
        shell.parentNode.insertBefore(note, shell.nextSibling);
      }
      const update = () => {
        const over = wrap.scrollWidth - wrap.clientWidth;
        shell.dataset.overflow = over > 2 ? 'yes' : 'no';
        shell.dataset.scrolled = wrap.scrollLeft >= over - 2 ? 'end' : 'more';
      };
      if (!wrap.dataset.overflowBound) {
        wrap.addEventListener('scroll', update, { passive: true });
        wrap.dataset.overflowBound = '1';
      }
      update();
      // The first measurement runs before web fonts have settled, which changes
      // every column width; re-measure when the element next resizes.
      if (window.ResizeObserver && !wrap.dataset.overflowObserved) {
        new ResizeObserver(update).observe(wrap);
        wrap.dataset.overflowObserved = '1';
      }
    });
  }

  function chartTools() {
    app.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.chart-tool');
      if (!btn) return;
      const card = btn.closest('.chart-card');
      if (!card) return;
      const name = card.dataset.chartCard;
      const tool = btn.dataset.tool;
      const flash = (text) => {
        const was = btn.textContent;
        btn.textContent = text;
        setTimeout(() => { btn.textContent = was; }, 1400);
      };

      if (tool === 'events') {
        const on = Charts.toggleEvents(name);
        if (on === null) { flash('not available'); return; }
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('on', !!on);
        return;
      }
      if (tool === 'link') {
        const url = location.origin + location.pathname + location.hash.split('&')[0] + '&chart=' + name;
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => flash('copied'), () => flash('press ⌘C'));
        else flash(url);
        return;
      }
      if (tool === 'png') {
        flash(Charts.png(name, {
          title: card.dataset.title,
          source: card.dataset.source ? 'Source: ' + card.dataset.source : '',
          url: location.href,
        }) ? 'saved' : 'not available');
        return;
      }
      if (tool === 'csv') {
        flash(Charts.csv(name, card.dataset.title) ? 'saved' : 'not available');
        return;
      }
      if (tool === 'embed') {
        // The snippet points at the published site, not at whatever host is
        // serving this copy, so a snippet copied from a local server still works.
        const src = `${Views.origin}/#/embed/${name}`;
        const code = `<iframe src="${src}" width="100%" height="460" loading="lazy" frameborder="0" `
          + `title="${Views.esc(card.dataset.title || 'The Documented Record')}"></iframe>`;
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => flash('copied'), () => flash('press ⌘C'));
        else flash('see #/api');
        return;
      }
      if (tool === 'table') {
        const box = card.querySelector('.chart-table');
        if (!box) return;
        if (!box.hidden) {
          box.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          return;
        }
        if (!fillChartTable(card)) { flash('not available'); return; }
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* Pull a built chart back out as a table and put it in the card's table box.
     Returns false for a chart that cannot be tabulated. Shared by the `table`
     button and by the print pass, which needs the same tables without anyone
     having pressed anything. */
  function fillChartTable(card) {
    const box = card.querySelector('.chart-table');
    if (!box) return false;
    const t = Charts.table(card.dataset.chartCard);
    if (!t) return false;
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>${t.header.map((h) => `<th>${Views.esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${Views.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
    box.hidden = false;
    try { tableOverflow(box); } catch (err) { console.error('tables', err); }
    return true;
  }

  /* ---------- share cards ---------- */

  /* One delegated handler for every `card` button: read the statement or the
     figure out of the card it sits in — rather than keeping a second copy of
     the text in a data attribute — and hand it to share.js, which draws it.
     What is on screen and what lands in the image are then the same words. */
  function shareCards() {
    const text = (root, selector) => {
      const el = root.querySelector(selector);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };

    app.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.share-card');
      if (!btn) return;
      const kind = btn.dataset.share;
      const flash = (t) => {
        const was = btn.textContent;
        btn.textContent = t;
        setTimeout(() => { btn.textContent = was; }, 1400);
      };
      if (typeof Share === 'undefined') { flash('not available'); return; }

      if (kind === 'statement') {
        const box = btn.closest('.st-card');
        if (!box) return;
        flash(Share.statement({
          quote: text(box, 'blockquote').replace(/^[“"]|[”"]$/g, ''),
          speaker: text(box, '.who'),
          role: text(box, '.role'),
          date: text(box, '.st-date'),
          source: text(box, '.st-src'),
          url: location.href,
        }) ? 'saved' : 'failed');
        return;
      }

      /* A day card carries the three things the day route exists to put on one
         date: the toll, the words, and the order already standing. Each is read
         out of the panel on screen, so the card cannot say anything the page
         does not. */
      if (kind === 'day') {
        const sheet = btn.closest('.day-sheet');
        if (!sheet) return;
        const quote = sheet.querySelector('.st-card');
        const ruling = sheet.querySelector('.day-ruling');
        const stats = Array.prototype.slice.call(sheet.querySelectorAll('.stat'));
        const source = [
          quote ? text(quote, '.st-src') : '',
          'Daily series: Gaza Ministry of Health via OCHA and Tech For Palestine.',
        ].filter(Boolean).join(' ');
        flash(Share.day({
          date: text(sheet, '.day-date'),
          killed: stats[0] ? text(stats[0], '.val') : '',
          killedLabel: stats[0] ? text(stats[0], '.lbl') : '',
          total: stats[1] ? text(stats[1], '.val') + ' ' + text(stats[1], '.lbl') : '',
          quote: quote ? text(quote, 'blockquote').replace(/^[\u201c"]|[\u201d"]$/g, '') : '',
          speaker: quote ? text(quote, '.who') : '',
          role: quote ? text(quote, '.role') : '',
          ruling: ruling ? text(ruling, '.day-title') + ' \u2014 ' + text(ruling, '.day-finding') : '',
          source,
          url: location.href,
        }) ? 'saved' : 'failed');
        return;
      }

      const box = btn.closest('.stat');
      if (!box) return;
      flash(Share.figure({
        value: text(box, '.val'),
        label: text(box, '.lbl'),
        note: text(box, '.note'),
        source: text(box, '.src'),
        tone: box.dataset.tone || '',
        url: location.href,
      }) ? 'saved' : 'failed');
    });
  }

  /* ---------- theme ---------- */

  /* Dark by default, because the record is read at length and most of it is
     read at night; light because some people cannot read white-on-black at all,
     and because a page that cannot be printed legibly cannot be handed out.
     The choice is remembered, and the charts are redrawn from the CSS custom
     properties rather than from a second palette of their own. */
  function theme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const label = (mode) => {
      btn.textContent = mode === 'light' ? '☾' : '☀';
      btn.setAttribute('title', mode === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme');
      btn.setAttribute('aria-label', btn.getAttribute('title'));
      btn.setAttribute('aria-pressed', mode === 'light' ? 'true' : 'false');
    };

    // index.html sets the attribute before first paint, so there is no flash of
    // the wrong theme; all this has to do is agree with it.
    label(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('record-theme', next); } catch (err) { /* private browsing */ }
      label(next);
      // Charts read their colours once, at init, so they are rebuilt to pick
      // up the new ones. The data is already in memory; nothing is refetched.
      if (rendered) render(rendered, renderedSub);
    });
  }

  // A link of the form #/data/gaza&chart=gaza-monthly scrolls to that card.
  function scrollToChart() {
    const m = location.hash.match(/[&?]chart=([a-z0-9-]+)/i);
    if (!m) return;
    const el = document.getElementById('chart-' + m[1]);
    if (!el) return;
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 2200);
    }, 120);
  }

  /* The skip link must not become a route: it moves focus into the record
     without touching the hash the router reads. */
  function skipLink() {
    const link = document.querySelector('.skip-link');
    if (!link) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      app.focus({ preventScroll: true });
      app.scrollIntoView({ block: 'start' });
    });
  }

  /* A closed accordion would print as a list of claims with no answers, and
     CSS cannot open one. Expand everything for the print, then put it back. */
  function printExpansion() {
    const opened = [];
    const tabled = [];
    window.addEventListener('beforeprint', () => {
      // The citation block is in the footer rather than in the view, and a
      // printout without it is not citable, which is most of the reason to
      // print one.
      document.querySelectorAll('#cite:not([open]), #app details:not([open])')
        .forEach((d) => { opened.push(d); d.open = true; });
      // A chart is a canvas drawn for a dark screen; on paper it is a grey
      // slab, or nothing. Every chart can give its figures back as a table, so
      // build them all and let the stylesheet print those instead. Charts that
      // cannot be tabulated keep their canvas.
      app.querySelectorAll('.chart-card').forEach((card) => {
        const box = card.querySelector('.chart-table');
        if (!box || !box.hidden) return;
        if (!fillChartTable(card)) return;
        card.dataset.printTable = '1';
        tabled.push(card);
      });
    });
    window.addEventListener('afterprint', () => {
      while (opened.length) opened.pop().open = false;
      while (tabled.length) {
        const card = tabled.pop();
        delete card.dataset.printTable;
        const box = card.querySelector('.chart-table');
        if (box) box.hidden = true;
      }
    });
  }

  /* ---------- citation ---------- */

  /* A record assembled to be used in an argument has to be citable in one, and
     a citation of a living document is worthless without the version it names.
     So the block carries two dates: the day the data was compiled, which is the
     version, and the day the reader read it. Rebuilt on every route change, so
     what is copied cites the section on screen rather than the front page. */

  const CITE_AUTHOR = { family: 'Kayani', initials: 'U.' };

  function citeParts(name, sub) {
    const meta = Views.meta(name, sub);
    const canonical = document.querySelector('link[rel=canonical]');
    const url = canonical ? canonical.href : location.href;
    const compiled = (D && D.ts && D.ts.meta.generated) || '';
    const year = Number((compiled || '').slice(0, 4)) || new Date().getUTCFullYear();
    const today = new Date().toISOString().slice(0, 10);
    // The overview is the whole record; every other route is a section of it,
    // and a citation that does not say which section sends the reader to the
    // front door of a 96,000-word document.
    const section = name === 'overview' ? '' : String(meta.title).split(' — ')[0];
    return { url, compiled, year, today, section, title: 'The Documented Record — Israel and the Occupied Territories, 1917–2026' };
  }

  function citation(name, sub) {
    const box = document.getElementById('cite');
    if (!box || !D) return;
    const p = citeParts(name, sub);
    const A = CITE_AUTHOR;
    const accessed = readableDate(p.today);
    const compiled = p.compiled ? readableDate(p.compiled) : '';
    const section = p.section ? ` (${p.section} section)` : '';

    const text = {
      apa: `${A.family}, ${A.initials} (${p.year}). ${p.title}${section} [Data set and report]. `
        + `Retrieved ${accessed}, from ${p.url}`,
      harvard: `${A.family}, ${A.initials} (${p.year}) ${p.title}${section}. `
        + `Available at: ${p.url} (Accessed: ${accessed}).`,
      bibtex: `@misc{palestinerecord${p.year},\n`
        + `  author       = {${A.family}, Usman},\n`
        + `  title        = {{The Documented Record: Israel and the Occupied Territories, 1917--2026}${p.section ? ', ' + p.section + ' section' : ''}},\n`
        + `  year         = {${p.year}},\n`
        + `  howpublished = {\\url{${p.url}}},\n`
        + `  note         = {${compiled ? 'Data compiled ' + compiled + '; a' : 'A'}ccessed ${accessed}}\n`
        + `}`,
    };

    Object.keys(text).forEach((style) => {
      const el = document.getElementById('cite-' + style);
      if (el) el.textContent = text[style];
    });
    const note = document.getElementById('cite-note');
    if (note) {
      note.textContent = compiled
        ? `This is a living document. The figures below were compiled on ${compiled}; `
          + `the casualty series runs to ${readableDate(D.ts.meta.last_daily_update)}. `
          + 'Cite the date you read it, not only the year.'
        : 'This is a living document. Cite the date you read it, not only the year.';
    }
  }

  /* One listener for the three buttons, bound once. */
  function citeCopy() {
    const box = document.getElementById('cite');
    if (!box) return;
    box.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-copy]');
      if (!button) return;
      const source = document.getElementById(button.dataset.copy);
      if (!source) return;
      const done = () => {
        const was = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = was; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(source.textContent).then(done, () => {});
        return;
      }
      // No clipboard API (an insecure origin, or an old browser): select the
      // text instead, so it can still be copied with a keystroke.
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      done();
    });
  }

  const highlight = (text, term) => {
    if (!term) return Views.esc(text);
    const i = text.toLowerCase().indexOf(term);
    if (i < 0) return Views.esc(text);
    return Views.esc(text.slice(0, i)) + '<mark>' + Views.esc(text.slice(i, i + term.length)) + '</mark>' + Views.esc(text.slice(i + term.length));
  };

  /* ---------- per-view behaviour ---------- */

  const behaviours = {};

  behaviours.overview = function () {
    showReturning();
  };

  /* On a phone the chapter bar is one row that scrolls sideways, so the chapter
     being read can be off its left edge when the route opens. Bring it into the
     bar without scrolling the page itself. */
  behaviours.data = function () {
    const bar = document.querySelector('.subnav');
    const active = bar && bar.querySelector('a.active');
    if (!active || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
  };

  behaviours.timeline = function () {
    const input = document.getElementById('tl-search');
    const select = document.getElementById('tl-era');
    const kind = document.getElementById('tl-kind');
    const count = document.getElementById('tl-count');
    const items = Array.prototype.slice.call(document.querySelectorAll('#tl-list .tl-item'));

    const inEra = (year, era) => {
      if (era === 'all') return true;
      if (!year) return era === 'all';
      if (era === 'pre') return year < 1948;
      if (era === 'nakba') return year >= 1948 && year <= 1966;
      if (era === 'occupation') return year >= 1967 && year <= 2022;
      return year >= 2023;
    };

    function apply() {
      const term = input.value.trim().toLowerCase();
      const era = select.value;
      const k = kind.value;
      let shown = 0;
      items.forEach((el) => {
        const e = D.timeline[Number(el.dataset.i)];
        const hay = (e.date + ' ' + e.event + ' ' + (e.note || '')).toLowerCase();
        const ok = inEra(e.year, era) && (k === 'all' || e.kind === k) && (!term || hay.indexOf(term) >= 0);
        el.style.display = ok ? '' : 'none';
        if (ok) {
          shown++;
          el.querySelector('.tl-text').innerHTML = highlight(e.event, term);
          const noteEl = el.querySelector('.tl-note');
          if (noteEl && e.note) noteEl.innerHTML = highlight(e.note, term);
        }
      });
      count.textContent = `${shown} of ${items.length} events`;
    }

    input.addEventListener('input', apply);
    select.addEventListener('change', apply);
    kind.addEventListener('change', apply);
    apply();
  };

  /* The scorecard sorts in the browser rather than shipping several orders of
     the same rows. Cells carry a numeric data-sort so "Halted" sorts above
     "Restricted" above "Continuing" rather than alphabetically, and the state
     column falls back to its text. */
  behaviours.legal = function () {
    const table = document.getElementById('scorecard');
    if (!table) return;
    const body = table.tBodies[0];
    const buttons = Array.prototype.slice.call(table.querySelectorAll('.sort-btn'));

    const key = (row, col) => {
      if (col === 0) return row.cells[0].textContent.trim().toLowerCase();
      const cell = row.cells[col];
      return cell ? Number(cell.dataset.sort) : 0;
    };

    buttons.forEach((btn) => btn.addEventListener('click', () => {
      const col = Number(btn.dataset.col);
      const dir = btn.classList.contains('on') && btn.dataset.dir === 'desc' ? 'asc' : 'desc';
      btn.dataset.dir = dir;
      buttons.forEach((b) => b.classList.toggle('on', b === btn));

      const rows = Array.prototype.slice.call(body.rows);
      const sign = dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const x = key(a, col);
        const y = key(b, col);
        if (x === y) return a.cells[0].textContent.localeCompare(b.cells[0].textContent);
        return (x > y ? 1 : -1) * sign;
      });
      rows.forEach((r) => body.appendChild(r));
    }));
  };

  behaviours.evidence = function () {
    const links = Array.prototype.slice.call(document.querySelectorAll('#toc-list a'));
    const filter = document.getElementById('toc-search');

    filter.addEventListener('input', () => {
      const term = filter.value.trim().toLowerCase();
      links.forEach((a) => {
        a.style.display = !term || a.textContent.toLowerCase().indexOf(term) >= 0 ? '' : 'none';
      });
    });

    // Scroll in place and keep the route in the address bar, so a contents
    // click never looks like navigation back to the overview.
    links.forEach((a) => a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#/evidence?' + encodeURIComponent(id));
    }));

    // Scroll-spy: mark the section nearest the top of the viewport.
    const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
        const on = links.find((a) => a.classList.contains('active'));
        if (on && on.offsetTop) {
          const box = document.querySelector('.ev-toc');
          if (on.offsetTop < box.scrollTop || on.offsetTop > box.scrollTop + box.clientHeight - 40) {
            box.scrollTop = on.offsetTop - box.clientHeight / 2;
          }
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    targets.forEach((t) => spy.observe(t));

    // Deep links from search land on a hash that is not a route.
    if (location.hash.indexOf('#/evidence?') === 0) {
      const id = decodeURIComponent(location.hash.split('?')[1] || '');
      const el = id && document.getElementById(id);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };

  /* The point of the Rebuttals route is that an answer can be taken away and
     used, so copy produces plain text: the claim, the report's answer point by
     point, and a link back to the same claim on this page. */
  function rebuttalText(box) {
    const lines = [];
    box.querySelectorAll('.rebuttal-answer p, .rebuttal-answer li').forEach((el) => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text || /^refutation:?$/i.test(text)) return;
      const bullet = el.tagName === 'LI' ? (el.classList.contains('lvl1') ? '  - ' : '- ') : '';
      lines.push(bullet + text);
    });
    return `Claim: "${box.dataset.claim}"\n\n${lines.join('\n\n')}\n\n`
      + `Source: The Documented Record, Part XVI — ${rebuttalLink(box)}`;
  }

  const rebuttalLink = (box) => location.origin + location.pathname + '#/rebuttals/' + box.dataset.rebuttal;

  behaviours.rebuttals = function () {
    const list = app.querySelector('.rebuttal-list');
    if (!list) return;
    const boxes = Array.prototype.slice.call(app.querySelectorAll('details.rebuttal'));

    /* A chart built inside a closed <details> has no width to measure. The
       charts module resizes every chart it holds on a window resize, so
       opening a claim re-measures its own charts without a new API. */
    boxes.forEach((d) => {
      d.addEventListener('toggle', () => { if (d.open) window.dispatchEvent(new Event('resize')); });
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-rebuttal-copy], [data-rebuttal-link]');
      if (!btn) return;
      const box = btn.closest('details.rebuttal');
      if (!box) return;
      const was = btn.textContent;
      const flash = (text) => {
        btn.textContent = text;
        setTimeout(() => { btn.textContent = was; }, 1400);
      };
      const text = btn.hasAttribute('data-rebuttal-link') ? rebuttalLink(box) : rebuttalText(box);
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('copied'), () => flash('press ⌘C'));
      else flash('press ⌘C');
    });

    // #/rebuttals/7 opens that claim; with no number, the first one is open.
    const n = (location.hash.match(/^#\/rebuttals\/(\d+)/) || [])[1];
    const target = n ? document.getElementById('rebuttal-' + n) : null;
    if (target) {
      target.open = true;
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } else if (boxes.length) {
      boxes[0].open = true;
    }
  };

  behaviours.statements = function () {
    const input = document.getElementById('st-search');
    const count = document.getElementById('st-count');
    const chips = Array.prototype.slice.call(document.querySelectorAll('#st-chips .chip'));
    const cards = Array.prototype.slice.call(document.querySelectorAll('#st-list .st-card'));
    const hay = D.statements.items.map((x) => [x.speaker, x.role, x.date, x.tier, x.quote, x.context, x.source, x.significance]
      .join(' ').toLowerCase());
    let cat = 'all';

    function apply() {
      const term = input.value.trim().toLowerCase();
      let shown = 0;
      cards.forEach((el, i) => {
        const inCat = cat === 'all' || el.dataset.cat.split(' ').indexOf(cat) >= 0;
        const ok = inCat && (!term || hay[i].indexOf(term) >= 0);
        el.style.display = ok ? '' : 'none';
        if (ok) shown++;
      });
      count.textContent = `${shown} of ${cards.length} statements`;
    }

    chips.forEach((c) => c.addEventListener('click', () => {
      cat = c.dataset.cat;
      chips.forEach((o) => o.classList.toggle('active', o === c));
      apply();
    }));
    input.addEventListener('input', apply);
    apply();
  };

  /* ---------- said and done ---------- */

  /* One piece of state — the index of the day on screen — and five ways to move
     it: the slider, the two step buttons, the date field, a click on the chart,
     and the play button that walks the whole war. Every move redraws the panels
     from the maps views.js bucketed once, and rewrites the address with
     replaceState, which changes the link without firing hashchange and so
     without re-rendering the route underneath it. */
  behaviours.day = function () {
    const panels = document.getElementById('day-panels');
    const range = document.getElementById('day-range');
    if (!panels || !range) return;

    const dates = D.ts.daily.gaza.dates;
    const pos = document.getElementById('day-pos');
    const dateInput = document.getElementById('day-date');
    const play = document.getElementById('day-play');
    const speed = document.getElementById('day-speed');
    const copy = document.getElementById('day-copy');

    // How long each day stays on screen. The panels carry a date, a toll and
    // often a sentence someone said, and a pace that outruns the reading of
    // them turns the record into a flicker. The slider is in days a second
    // rather than milliseconds a day, so that dragging it right speeds the
    // playing up, which is the only way round a reader would expect it.
    const DAYS_PER_SECOND = 2;
    const rate = () => Number(speed && speed.value) || DAYS_PER_SECOND;
    const stepMs = () => Math.round(1000 / rate());
    let i = Math.max(0, Math.min(dates.length - 1, Number(range.value) || 0));
    let timer = null;
    let settle = null;

    /* Each day changes the height of the panels, which moves everything below
       them. The scroll reveals were measured against the first day drawn, so
       without this the cards further down the page keep waiting for a scroll
       position the document no longer reaches, and never appear. The refresh is
       debounced because autoplay redraws a few times a second. */
    function remeasure() {
      if (!window.ScrollTrigger) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        if (panels.isConnected) ScrollTrigger.refresh();
      }, 160);
    }

    function show(next, quiet) {
      i = Math.max(0, Math.min(dates.length - 1, next));
      const iso = dates[i];
      range.value = String(i);
      range.setAttribute('aria-valuetext', Views.dayLabel(iso));
      if (dateInput && dateInput.value !== iso) dateInput.value = iso;
      if (pos) pos.textContent = Views.dayLabel(iso);
      panels.innerHTML = Views.dayPanels(iso);
      try { Charts.setDay(iso); } catch (err) { console.error('day cursor', err); }
      remeasure();
      if (!quiet) history.replaceState(null, '', '#/day/' + iso);
    }

    // The button is an icon, so the state it is in has to be said rather than
    // drawn: aria-pressed swaps the glyph in CSS, the label says which action
    // the button would take next.
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (play) { play.setAttribute('aria-pressed', 'false'); play.setAttribute('aria-label', 'play'); }
    }

    function tick() {
      // The route may have been left while the timer was running; the panels
      // are then detached and the interval is the only thing still holding on.
      if (!panels.isConnected) { stop(); return; }
      if (i >= dates.length - 1) { stop(); return; }
      show(i + 1);
    }

    function start() {
      if (i >= dates.length - 1) i = 0;
      if (play) { play.setAttribute('aria-pressed', 'true'); play.setAttribute('aria-label', 'pause'); }
      timer = setInterval(tick, stepMs());
    }

    range.addEventListener('input', () => { stop(); show(Number(range.value)); });
    const prev = document.getElementById('day-prev');
    const next = document.getElementById('day-next');
    if (prev) prev.addEventListener('click', () => { stop(); show(i - 1); });
    if (next) next.addEventListener('click', () => { stop(); show(i + 1); });
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        const asked = dateInput.value;
        if (!asked) return;
        stop();
        let at = dates.indexOf(asked);
        if (at < 0) at = dates.findIndex((x) => x >= asked);
        show(at < 0 ? dates.length - 1 : at);
      });
    }
    if (play) play.addEventListener('click', () => (timer ? stop() : start()));
    // Moving the slider while it is running should be felt immediately rather
    // than at the end of the current pass, so the interval is rebuilt in place.
    // `input` rather than `change`, because a slider that only answers on
    // release cannot be tuned against what is on screen.
    if (speed) {
      const note = document.getElementById('day-speed-note');
      speed.addEventListener('input', () => {
        const said = rate() === 1 ? 'a day a second' : rate() + ' days a second';
        speed.setAttribute('aria-valuetext', said);
        if (note) note.textContent = said;
        if (!timer) return;
        clearInterval(timer);
        timer = setInterval(tick, stepMs());
      });
    }
    if (copy) {
      copy.addEventListener('click', () => {
        const url = location.origin + location.pathname + '#/day/' + dates[i];
        const was = copy.textContent;
        const flash = (t) => { copy.textContent = t; setTimeout(() => { copy.textContent = was; }, 1400); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => flash('copied'), () => flash('press \u2318C'));
        else flash(url);
      });
    }

    try { Charts.onDayPick((iso) => { stop(); show(dates.indexOf(iso)); }); } catch (err) { console.error('day pick', err); }

    // Draw the cursor where the route opened, without rewriting the address:
    // a deep link that has just been followed should stay exactly as it was.
    show(i, true);
  };

  behaviours.sources = function () {
    const input = document.getElementById('src-search');
    const count = document.getElementById('src-count');
    const chips = Array.prototype.slice.call(document.querySelectorAll('#src-chips .chip'));
    const groups = Array.prototype.slice.call(document.querySelectorAll('#src-list .src-group'));
    const total = D.sources.groups.reduce((n, g) => n + g.items.length, 0);
    let group = 'all';

    function apply() {
      const term = input.value.trim().toLowerCase();
      let shown = 0;
      groups.forEach((g) => {
        if (group !== 'all' && g.dataset.group !== group) { g.style.display = 'none'; return; }
        let any = false;
        g.querySelectorAll('li').forEach((li) => {
          const ok = !term || li.textContent.toLowerCase().indexOf(term) >= 0;
          li.style.display = ok ? '' : 'none';
          if (ok) { any = true; shown++; }
        });
        g.style.display = any ? '' : 'none';
      });
      count.textContent = `${shown} of ${total} sources`;
    }

    chips.forEach((c) => c.addEventListener('click', () => {
      group = c.dataset.group;
      chips.forEach((o) => o.classList.toggle('active', o === c));
      apply();
    }));
    input.addEventListener('input', apply);
    apply();
  };

  /* The answer engine. Deterministic by design: the same text produces the
     same answer on every machine, on every day, offline, and a reader who
     doubts a match can read the phrase that caused it in data/claim-patterns.json.

     Normalisation is the whole of the cleverness. Curly quotation marks,
     hyphens of three different widths and runs of whitespace are flattened,
     because a claim pasted out of a newspaper is typeset and a claim typed
     into a comment box is not, and they are the same claim. Offsets into the
     normalised string stay valid in the original because the normalisation is
     character-for-character: nothing is inserted and nothing is dropped. */
  const ANSWER_FOLD = [
    [/[‘’ʼ′]/g, "'"],
    [/[“”″]/g, '"'],
    [/[‐-―−]/g, '-'],
    [/ /g, ' '],
  ];

  function answerNormalise(text) {
    let out = String(text || '');
    ANSWER_FOLD.forEach(([re, ch]) => { out = out.replace(re, ch); });
    return out.toLowerCase();
  }

  const answerEscapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* A phrase matches on word boundaries at both ends, so "ipc is" does not
     fire inside "recipient" and "singled out" does not fire inside a longer
     word. Phrases that start or end in punctuation keep that edge unanchored. */
  function answerPhraseRe(phrase) {
    const body = answerEscapeRe(phrase);
    const left = /^[a-z0-9]/.test(phrase) ? '\\b' : '';
    const right = /[a-z0-9]$/.test(phrase) ? '\\b' : '';
    return new RegExp(left + body + right, 'g');
  }

  let answerPatterns = null;
  function answerCompiled() {
    if (answerPatterns) return answerPatterns;
    answerPatterns = (D.patterns.claims || []).map((c) => ({
      claim: c,
      strong: c.strong.slice(),
      phrases: c.phrases.map((p) => ({ text: p, re: answerPhraseRe(p), weight: c.strong.indexOf(p) >= 0 ? 2 : 1 })),
    }));
    return answerPatterns;
  }

  /* Returns the claims the text touches, each with the phrases that fired and
     where, ordered by weight and then by how early the claim first appears —
     the first claim made in a post is usually the one being argued. */
  function answerMatch(text) {
    const hay = answerNormalise(text);
    const hits = [];
    const spans = [];
    answerCompiled().forEach((entry) => {
      let weight = 0;
      let first = Infinity;
      const matched = [];
      entry.phrases.forEach((p) => {
        p.re.lastIndex = 0;
        let m;
        let found = false;
        while ((m = p.re.exec(hay)) !== null) {
          found = true;
          first = Math.min(first, m.index);
          spans.push([m.index, m.index + m[0].length, entry.claim.rebuttal]);
          if (m.index === p.re.lastIndex) p.re.lastIndex++;
        }
        if (found) { weight += p.weight; matched.push(p.text); }
      });
      if (weight) hits.push({ claim: entry.claim, weight: weight, first: first, phrases: matched });
    });
    hits.sort((a, b) => (b.weight - a.weight) || (a.first - b.first));
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    return { hits: hits, spans: spans };
  }

  /* The pasted text with the matched phrases marked. Overlapping matches are
     merged rather than nested, so the marking never rewrites what was pasted. */
  function answerMarked(text, spans) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const merged = [];
    spans.forEach((s) => {
      const top = merged[merged.length - 1];
      if (top && s[0] <= top[1]) { top[1] = Math.max(top[1], s[1]); return; }
      merged.push([s[0], s[1], s[2]]);
    });
    let out = '';
    let at = 0;
    merged.forEach(([from, to, n]) => {
      out += esc(text.slice(at, from));
      out += `<mark data-rebuttal="${n}">${esc(text.slice(from, to))}</mark>`;
      at = to;
    });
    return out + esc(text.slice(at));
  }

  /* One answer, built from the record: the report's own refutation, the live
     figures the pattern names, and the documented statements in its categories.
     Nothing is composed here — every line is quoted from something. */
  function answerBlock(hit, rank) {
    const n = hit.claim.rebuttal;
    const part = (D.report.parts || []).filter((p) => /DEFEATING EVERY REBUTTAL/i.test(p.title))[0];
    const section = part ? part.sections.filter((s) => new RegExp('^Rebuttal\\s+' + n + ':').test(s.title))[0] : null;
    const claimText = section ? section.title.replace(/^Rebuttal\s+\d+:\s*/i, '').replace(/^["“']|["”']$/g, '') : hit.claim.label;
    const points = [];
    if (section) {
      section.blocks.forEach((b) => {
        if (b.type !== 'list') return;
        (b.items || []).forEach((item) => {
          const text = String(item.html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          if (text) points.push(text);
        });
      });
    }
    const figures = hit.claim.figures.map((id) => Views.answerFigure(id)).filter(Boolean);
    const quotes = Views.answerStatements(hit.claim.statement_cats, 2);

    return `<article class="card answer-card" data-rebuttal="${n}">
      <div class="answer-card-top">
        <span class="answer-rank">${rank}</span>
        <div>
          <h3>“${Views.esc(claimText)}”</h3>
          <p class="small muted">Rebuttal ${n} · matched on ${hit.phrases.length}
            ${hit.phrases.length === 1 ? 'phrase' : 'phrases'}:
            ${hit.phrases.slice(0, 6).map((p) => `<code>${Views.esc(p)}</code>`).join(' ')}</p>
        </div>
      </div>
      <ol class="answer-points">${points.map((p) => `<li>${Views.esc(p)}</li>`).join('')}</ol>
      ${figures.length ? `<div class="answer-figures">${figures.map((f) => `<div class="answer-fig">
        <b>${Charts.fmt(f.value)}${f.suffix ? f.suffix : ''}</b>
        <span>${Views.esc(f.label)}</span>
        <em>${Views.esc(f.source)}${f.ref ? ' · ' + Views.esc(f.ref) : ''}</em>
      </div>`).join('')}</div>` : ''}
      ${quotes.length ? `<div class="answer-quotes">${quotes.map((q) => `<blockquote>
        “${Views.esc(q.s.quote)}”
        <cite>${Views.esc(q.s.speaker)}, ${Views.esc(q.s.role)}, ${Views.esc(q.s.date)}</cite>
      </blockquote>`).join('')}</div>` : ''}
      <div class="answer-card-tools">
        <button class="chart-tool" data-answer-copy="${n}">copy the reply</button>
        <a class="chart-tool" href="#/rebuttals/${n}">read it in full</a>
        <a class="chart-tool" href="#/statements">the statements</a>
      </div>
    </article>`;
  }

  /* The copyable reply. Plain text, because it is going into a comment box:
     the claim, the refutation, the figures with their sources, the quotes with
     their speakers, and the link to the section it all came from. */
  function answerReplyText(n) {
    const card = app.querySelector(`.answer-card[data-rebuttal="${n}"]`);
    if (!card) return '';
    const lines = [];
    lines.push('Claim: ' + card.querySelector('h3').textContent.trim());
    lines.push('');
    card.querySelectorAll('.answer-points li').forEach((li) => {
      lines.push('- ' + li.textContent.replace(/\s+/g, ' ').trim());
      lines.push('');
    });
    const figs = card.querySelectorAll('.answer-fig');
    if (figs.length) {
      lines.push('The figures, each with its source:');
      figs.forEach((f) => {
        lines.push('- ' + f.querySelector('span').textContent.trim() + ': '
          + f.querySelector('b').textContent.trim() + ' (' + f.querySelector('em').textContent.trim() + ')');
      });
      lines.push('');
    }
    const quotes = card.querySelectorAll('.answer-quotes blockquote');
    if (quotes.length) {
      lines.push('On the record, in their own words:');
      quotes.forEach((q) => {
        const cite = q.querySelector('cite').textContent.trim();
        const text = q.textContent.replace(cite, '').replace(/\s+/g, ' ').trim();
        lines.push('- ' + text + ' — ' + cite);
      });
      lines.push('');
    }
    lines.push('Sources and the full answer: ' + location.origin + location.pathname + '#/rebuttals/' + n);
    return lines.join('\n');
  }

  behaviours.answer = function () {
    const input = document.getElementById('answer-input');
    const status = document.getElementById('answer-status');
    const readWrap = document.getElementById('answer-read-wrap');
    const read = document.getElementById('answer-read');
    const resultsWrap = document.getElementById('answer-results-wrap');
    const results = document.getElementById('answer-results');
    const data = document.getElementById('answer-examples-data');
    const examples = data ? JSON.parse(data.textContent) : [];

    function run() {
      const text = input.value.trim();
      if (!text) {
        readWrap.hidden = true;
        resultsWrap.hidden = true;
        status.textContent = 'Nothing pasted yet.';
        return;
      }
      const found = answerMatch(text);
      read.innerHTML = answerMarked(text, found.spans);
      readWrap.hidden = false;
      if (!found.hits.length) {
        resultsWrap.hidden = true;
        status.textContent = 'No claim in the list was recognised. The phrase list is open data, and a claim that '
          + 'is missing from it is a gap worth reporting.';
        return;
      }
      results.innerHTML = found.hits.map((h, i) => answerBlock(h, i + 1)).join('');
      resultsWrap.hidden = false;
      status.textContent = `${found.hits.length} ${found.hits.length === 1 ? 'claim' : 'claims'} recognised, `
        + `${found.spans.length} ${found.spans.length === 1 ? 'phrase' : 'phrases'} matched.`;
    }

    document.getElementById('answer-run').addEventListener('click', run);
    document.getElementById('answer-clear').addEventListener('click', () => {
      input.value = '';
      run();
      input.focus();
    });
    // Enter runs it; the textarea keeps newlines on shift-enter, as a textarea should.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });
    app.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
      input.value = examples[Number(b.dataset.example)] || '';
      run();
    }));
    app.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-answer-copy]');
      if (!btn) return;
      const was = btn.textContent;
      const flash = (t) => { btn.textContent = t; setTimeout(() => { btn.textContent = was; }, 1400); };
      const text = answerReplyText(btn.dataset.answerCopy);
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => flash('copied'), () => flash('press ⌘C'));
      else flash('press ⌘C');
    });
  };

  /* The adversary switch. The counts it prints are the counts provenance.py
     computed and shipped; the filtering here only has to agree with them, and
     the printed line says so, because a browser-side recount that drifted from
     the published file would be the one bug this page cannot afford. A claim
     stands if any of its sources belongs to a class the setting has not
     removed; a claim with no source at all is shown but never counted. */
  /* The ledger: three filters over one list, and a link out to the report.

     The class chips, the standing chips and the search box all narrow the same
     set, so each is applied in turn rather than replacing the last — a reader
     who has picked "under sanction" and then types a name expects both to hold.
     The section links are the other half: they point at an anchor inside the
     Evidence route, which does not exist while the ledger is on screen, so the
     click changes route first and then waits for the anchor to appear. */
  /* The falsification register. The filters are the three questions a reader
     would actually put to it — what kind of claim is this, how much does it
     rest on, and which adversary switch takes it out — applied together, so
     that "figures resting on one class of source that the hostile setting
     removes" is a view of the register rather than a search anyone has to
     construct. */
  behaviours.method = function () {
    const entries = Array.prototype.slice.call(document.querySelectorAll('#fx-list .fx-entry'));
    if (!entries.length) return;
    const kindChips = Array.prototype.slice.call(document.querySelectorAll('#fx-kinds .chip'));
    const indChips = Array.prototype.slice.call(document.querySelectorAll('#fx-inds .chip'));
    const switchChips = Array.prototype.slice.call(document.querySelectorAll('#fx-switches .chip'));
    const search = document.getElementById('fx-search');
    const count = document.getElementById('fx-count');
    let kind = 'all';
    let ind = 'all';
    let sw = 'all';

    function apply() {
      const q = (search && search.value || '').trim().toLowerCase();
      const floor = ind === 'all' ? 0 : parseInt(ind, 10);
      let shown = 0;
      entries.forEach((el) => {
        // An entry filtered to "one class of source" is the weak end of the
        // scale, so that chip is a ceiling where the others are floors.
        const n = parseInt(el.dataset.ind || '0', 10);
        const standing = ind === 'all' || (floor === 1 ? n <= 1 : n >= floor);
        const ok = (kind === 'all' || el.dataset.kind === kind)
          && standing
          && (sw === 'all' || (el.dataset.falls || '').split(' ').indexOf(sw) >= 0)
          && (!q || (el.dataset.text || '').indexOf(q) >= 0);
        el.hidden = !ok;
        // A filtered-out entry left open would reopen on its own when the
        // filter was cleared, which reads as the page having been scrolled.
        if (!ok) el.open = false;
        if (ok) shown++;
      });
      if (count) {
        count.textContent = shown === entries.length
          ? `${entries.length} entries`
          : `${shown} of ${entries.length} entries`;
      }
    }

    function pick(chips, el, set) {
      chips.forEach((c) => c.classList.toggle('active', c === el));
      set();
    }

    kindChips.forEach((chip) => chip.addEventListener('click', () => {
      kind = chip.dataset.kind;
      pick(kindChips, chip, apply);
    }));
    indChips.forEach((chip) => chip.addEventListener('click', () => {
      ind = chip.dataset.ind;
      pick(indChips, chip, apply);
    }));
    switchChips.forEach((chip) => chip.addEventListener('click', () => {
      sw = chip.dataset.switch;
      pick(switchChips, chip, apply);
    }));
    if (search) search.addEventListener('input', apply);

    /* The links arrive carrying only the label and the title, which is a
       usable issue on its own and is what a reader with no JavaScript gets.
       The full prefilled body — the entry id, the published value, the
       attribution, the sources and the test — is written onto a link only when
       the reader reaches for it, because writing all 358 of them up front puts
       400kB of query string into the document for the sake of the one link
       anybody will ever follow. */
    const F = D.falsify;
    const list = document.getElementById('fx-list');
    if (F && list && Views.challengeUrl) {
      const byId = {};
      F.entries.forEach((e) => { byId[e.id] = e; });
      const kinds = {};
      F.kinds.forEach((k) => { kinds[k.id] = k; });
      const upgrade = (ev) => {
        const link = ev.target.closest && ev.target.closest('a[data-fx-id]');
        if (!link || link.dataset.fxReady) return;
        const entry = byId[link.dataset.fxId];
        if (!entry) return;
        link.href = Views.challengeUrl(entry, kinds[entry.kind]);
        link.dataset.fxReady = '1';
      };
      // Pointer and keyboard both reach the link before the click does, so the
      // href is already the full one by the time the browser reads it.
      ['pointerdown', 'focusin', 'click'].forEach((name) => list.addEventListener(name, upgrade, true));
    }

    apply();
  };

  behaviours.ledger = function () {
    const persons = Array.prototype.slice.call(document.querySelectorAll('#led-persons .led-person'));
    const companies = Array.prototype.slice.call(document.querySelectorAll('#led-companies .led-person'));
    const classChips = Array.prototype.slice.call(document.querySelectorAll('#led-classes .chip'));
    const flagChips = Array.prototype.slice.call(document.querySelectorAll('#led-flags .chip'));
    const sectorChips = Array.prototype.slice.call(document.querySelectorAll('#led-sectors .chip'));
    const search = document.getElementById('led-search');
    const count = document.getElementById('led-count');
    let cls = 'all';
    let flag = 'all';
    let sector = 'all';

    function apply() {
      const q = (search && search.value || '').trim().toLowerCase();
      let shown = 0;
      persons.forEach((el) => {
        const ok = (cls === 'all' || el.dataset.class === cls)
          && (flag === 'all' || (el.dataset.flags || '').indexOf(flag) >= 0)
          && (!q || (el.dataset.text || '').indexOf(q) >= 0);
        el.hidden = !ok;
        if (ok) shown++;
      });
      if (count) {
        count.textContent = shown === persons.length
          ? `${persons.length} persons`
          : `${shown} of ${persons.length} persons`;
      }
    }

    function applyCompanies() {
      companies.forEach((el) => {
        el.hidden = !(sector === 'all' || el.dataset.sector === sector);
      });
    }

    function pick(chips, el, set) {
      chips.forEach((c) => c.classList.toggle('active', c === el));
      set();
    }

    classChips.forEach((chip) => chip.addEventListener('click', () => {
      cls = chip.dataset.class;
      pick(classChips, chip, apply);
    }));
    flagChips.forEach((chip) => chip.addEventListener('click', () => {
      flag = chip.dataset.flag;
      pick(flagChips, chip, apply);
    }));
    sectorChips.forEach((chip) => chip.addEventListener('click', () => {
      sector = chip.dataset.sector;
      pick(sectorChips, chip, applyCompanies);
    }));
    if (search) search.addEventListener('input', apply);

    document.querySelectorAll('.led-sec').forEach((link) => {
      link.addEventListener('click', (ev) => {
        const id = link.dataset.sec;
        if (!id) return;
        ev.preventDefault();
        location.hash = '#/evidence';
        let tries = 0;
        const tick = () => {
          const el = document.getElementById(id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.add('search-target');
            setTimeout(() => el.classList.remove('search-target'), 2600);
            return;
          }
          if (tries++ < 60) setTimeout(tick, 100);
        };
        setTimeout(tick, 80);
      });
    });

    apply();
    applyCompanies();
  };

  behaviours.provenance = function () {
    const P = D.prov;
    const claims = Array.prototype.slice.call(document.querySelectorAll('#prov-claims .prov-claim'));
    const srcRows = Array.prototype.slice.call(document.querySelectorAll('#prov-sources .prov-src'));
    const originRows = Array.prototype.slice.call(document.querySelectorAll('#prov-origins tr'));
    const chips = Array.prototype.slice.call(document.querySelectorAll('#prov-switch .chip'));
    const fileChips = Array.prototype.slice.call(document.querySelectorAll('#prov-files .chip'));
    const panel = document.getElementById('prov-panel');
    const search = document.getElementById('prov-search');
    const count = document.getElementById('prov-count');
    const srcSearch = document.getElementById('prov-src-search');
    const srcCount = document.getElementById('prov-src-count');
    const switches = {};
    P.switches.forEach((s) => { switches[s.id] = s; });
    let current = 'none';
    let file = 'all';

    function removedSet() {
      const s = switches[current];
      return s ? s.removes : [];
    }

    function stands(el) {
      const removed = removedSet();
      if (!removed.length) return true;
      const origins = (el.dataset.origins || '').split(' ').filter(Boolean);
      if (!origins.length) return true;
      return origins.some((o) => removed.indexOf(o) < 0);
    }

    function paintPanel() {
      const s = switches[current];
      if (!s) {
        panel.innerHTML = `<p class="prov-panel-lede">Every source in place. <b>${D.prov.summary.attributed}</b> of
          ${D.prov.summary.claims} claims carry at least one; ${D.prov.summary.independent} of them rest on
          two or more classes of source at once.</p>`;
        return;
      }
      const labels = s.removes.map((id) => {
        const o = P.meta.origins.filter((x) => x.id === id)[0];
        return o ? o.label : id;
      });
      panel.innerHTML = `<p class="prov-panel-lede"><b>${s.stands}</b> of ${s.stands + s.falls} attributed claims still stand
          — ${s.share}% — with ${labels.join(', ').toLowerCase()} removed entirely.</p>
        <div class="prov-bar"><span style="width:${s.share}%"></span></div>
        <p class="prov-panel-note">${s.note}</p>
        <p class="prov-panel-note small muted">${s.falls} claims fall. They are greyed out below, with the bodies
          that were carrying them struck through.</p>`;
    }

    function apply() {
      const term = (search.value || '').trim().toLowerCase();
      const removed = removedSet();
      let shown = 0;
      let attributed = 0;
      let standing = 0;
      claims.forEach((el) => {
        const match = (file === 'all' || el.dataset.file === file)
          && (!term || (el.dataset.text || '').indexOf(term) >= 0);
        el.style.display = match ? '' : 'none';
        if (!match) return;
        shown++;
        const ok = stands(el);
        el.classList.toggle('fallen', !ok);
        // A claim with no source recorded is neither standing nor falling: it
        // is one of the places the record states that no source exists, and
        // counting it either way would make this line disagree with the panel.
        if (el.dataset.origins) { attributed++; if (ok) standing++; }
        el.querySelectorAll('.prov-chip').forEach((chip) => {
          chip.classList.toggle('struck', removed.indexOf(chip.dataset.origin) >= 0);
        });
      });
      count.textContent = removed.length
        ? `${standing} of the ${attributed} attributed claims shown still stand`
        : `${shown} of ${claims.length} claims`;
      srcRows.forEach((row) => row.classList.toggle('struck', removed.indexOf(row.dataset.origin) >= 0));
      originRows.forEach((row) => row.classList.toggle('struck', removed.indexOf(row.dataset.origin) >= 0));
      paintPanel();
    }

    function applySources() {
      const term = (srcSearch.value || '').trim().toLowerCase();
      let shown = 0;
      srcRows.forEach((row) => {
        const ok = !term || (row.dataset.name || '').indexOf(term) >= 0;
        row.style.display = ok ? '' : 'none';
        if (ok) shown++;
      });
      srcCount.textContent = `${shown} of ${srcRows.length} sources`;
    }

    chips.forEach((c) => c.addEventListener('click', () => {
      current = c.dataset.switch;
      chips.forEach((o) => o.classList.toggle('active', o === c));
      apply();
    }));
    fileChips.forEach((c) => c.addEventListener('click', () => {
      file = c.dataset.file;
      fileChips.forEach((o) => o.classList.toggle('active', o === c));
      apply();
    }));
    search.addEventListener('input', apply);
    srcSearch.addEventListener('input', applySources);
    apply();
    applySources();
  };

  /* ---------- search ---------- */

  /* Everything the record holds, not only the report's prose. A reader
     searching "Gallant" wants the statements he made, the determinations that
     name him and the charts that plot the conduct, not only the paragraphs
     that mention him — so statements, chronology entries, legal
     determinations, linked sources, the duty-to-prevent scorecard and every
     chart title are indexed alongside the report, grouped by kind in the
     results, with a title match ranked above a match in the body. */

  const KINDS = [
    ['report', 'The report'],
    ['statement', 'Statements'],
    ['legal', 'Legal determinations'],
    ['chart', 'Charts'],
    ['timeline', 'Chronology'],
    ['scorecard', 'Duty to prevent'],
    ['source', 'Sources'],
  ];

  function buildIndex() {
    const out = [];
    const clean = (text) => String(text == null ? '' : text)
      .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    // `title` is what the hit is called; `text` is what it says. Both are
    // searched; a match in the title sorts first.
    const push = (kind, crumb, title, text, route, anchor, url) => {
      const t = clean(title);
      const b = clean(text);
      if (t.length < 2 && b.length < 3) return;
      out.push({
        kind, crumb, title: t, text: b, route, anchor: anchor || '', url: url || '',
        lower: (t + ' ' + b).toLowerCase(), titleLower: t.toLowerCase(),
      });
    };

    // The report, when it has been loaded. Every other kind is indexed from
    // files that are always present, so search works before report.json lands.
    if (D.report) {
      const walk = (crumb, anchor, blocks) => blocks.forEach((b) => {
        if (b.type === 'paragraph' || b.type === 'subheading') push('report', crumb, crumb, b.html, 'evidence', anchor);
        else if (b.type === 'list') b.items.forEach((i) => push('report', crumb, crumb, i.html, 'evidence', anchor));
        else if (b.type === 'table') b.rows.forEach((r) => push('report', crumb, crumb, r.join(' — '), 'evidence', anchor));
      });
      D.report.parts.forEach((p) => {
        push('report', p.title, p.title, '', 'evidence', 'part-' + p.id);
        walk(p.title, 'part-' + p.id, p.blocks);
        p.sections.forEach((s) => {
          const crumb = p.title + ' › ' + s.title;
          push('report', crumb, s.title, '', 'evidence', 'sec-' + s.id);
          walk(crumb, 'sec-' + s.id, s.blocks);
        });
      });
    }

    D.statements.items.forEach((x, i) => {
      push('statement', `${x.speaker} · ${x.date}`, `${x.speaker} — ${x.role}`,
        `“${x.quote}” ${x.context} ${x.significance} ${x.source} ${x.tier}`,
        'statements', 'st-' + i);
    });

    D.timeline.forEach((e, i) => {
      push('timeline', e.date, e.event, e.note || '', 'timeline', 'tl-' + i);
    });

    (D.legal.determinations || []).forEach((d) => {
      const name = d.body || d.institution || d.name || '';
      push('legal', [name, d.date].filter(Boolean).join(' · '), name,
        [d.finding, d.note, d.terms, d.title, d.source].filter(Boolean).join(' '),
        'legal', '');
    });

    // The scorecard is built in views.js from world-positions.json rather than
    // held as a file, so it is indexed through the same function that draws it.
    try {
      Views.scorecardRows().forEach((r) => {
        push('scorecard', 'Duty to prevent · ' + r.name, r.name,
          [r.recognises ? 'recognises Palestine ' + r.recognises : 'does not recognise Palestine',
            r.arms ? 'arms transfers ' + r.arms : '', r.icj ? 'ICJ ' + r.icj : '',
            (r.measures || []).map((m) => m.label).join(' '),
            r.recogniseNote, r.armsNote, r.shareNote].filter(Boolean).join(' '),
          'legal', 'scorecard');
      });
    } catch (err) { console.error('scorecard index', err); }

    D.sources.groups.forEach((g) => {
      g.items.forEach((item) => {
        push('source', [item.org, item.date].filter(Boolean).join(' · '), item.title,
          [item.note, item.org].filter(Boolean).join(' '), 'sources', '', item.url);
      });
    });

    try {
      const charts = Views.charts();
      Object.keys(charts).forEach((name) => {
        const c = charts[name];
        // `#/data/gaza&chart=gaza-monthly` is the app's own deep-link form.
        push('chart', 'Chart · ' + c.source, c.title, [c.note, c.name].filter(Boolean).join(' '),
          c.route.replace(/^#\//, ''), '', '');
        out[out.length - 1].chart = c.name;
        out[out.length - 1].href = c.route + '&chart=' + c.name;
      });
    } catch (err) { console.error('chart index', err); }

    return out;
  }

  function initSearch() {
    const overlay = document.getElementById('search-overlay');
    const input = document.getElementById('search-input');
    const meta = document.getElementById('search-meta');
    const results = document.getElementById('search-results');

    let cursor = -1;

    const rebuild = () => { searchIndex = buildIndex(); };

    const open = () => {
      if (!searchIndex) rebuild();
      overlay.hidden = false;
      document.body.classList.add('locked');
      input.focus();
      input.select();
      describe();
      // The report is the largest part of the index and arrives on demand;
      // pull it in on the first search and re-index when it lands.
      if (!D.report) ensureReport().then(() => { rebuild(); describe(); run(); }).catch(() => {});
    };
    const close = () => { overlay.hidden = true; document.body.classList.remove('locked'); };

    const describe = () => {
      if (input.value.trim().length >= 2) return;
      meta.textContent = `Searching ${searchIndex.length.toLocaleString('en-GB')} entries — `
        + `the report, statements, the chronology, legal determinations, sources and every chart.`;
    };

    document.getElementById('search-open').addEventListener('click', open);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const move = (delta) => {
      const hits = results.querySelectorAll('.search-hit');
      if (!hits.length) return;
      cursor = (cursor + delta + hits.length) % hits.length;
      hits.forEach((h, i) => h.classList.toggle('cursor', i === cursor));
      hits[cursor].scrollIntoView({ block: 'nearest' });
      hits[cursor].focus({ preventScroll: true });
    };

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); open(); }
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); }
      if (overlay.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      // Arrow keys walk the results from the box without leaving it; Enter
      // follows the one under the cursor.
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      if (e.key === 'Enter' && cursor >= 0) {
        const hit = results.querySelectorAll('.search-hit')[cursor];
        if (hit) { e.preventDefault(); hit.click(); }
      }
    });

    /* A hit is a route, an optional anchor and an optional chart. Going to it
       may mean rendering a different route first, and the route it renders may
       be one that waits on report.json, so the scroll retries until the anchor
       exists rather than assuming it does. */
    const go = (hit) => {
      close();
      const target = hit.chart ? `#/${hit.route}&chart=${hit.chart}` : `#/${hit.route}`;
      const current = currentRoute();
      const same = current.name === hit.route.split('/')[0]
        && (current.sub || '') === (hit.route.split('/')[1] || '');
      if (!same || hit.chart) location.hash = target;
      if (!hit.anchor) return;
      let tries = 0;
      const tick = () => {
        const el = document.getElementById(hit.anchor);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('search-target');
          setTimeout(() => el.classList.remove('search-target'), 2600);
          return;
        }
        if (tries++ < 40) setTimeout(tick, 80);
      };
      setTimeout(tick, 60);
    };

    let timer = null;
    let lastHits = [];

    function run() {
      const term = input.value.trim().toLowerCase();
      cursor = -1;
      if (term.length < 2) {
        results.innerHTML = '';
        describe();
        return;
      }
      const hits = [];
      for (let i = 0; i < searchIndex.length; i++) {
        const entry = searchIndex[i];
        const inTitle = entry.titleLower.indexOf(term) >= 0;
        if (!inTitle && entry.lower.indexOf(term) < 0) continue;
        hits.push({ entry, inTitle });
        if (hits.length >= 400) break;
      }
      // Title matches first, then the order the kinds are listed in, then the
      // order the entries were indexed in — which is the order they appear on
      // the page. No relevance score beyond that: the record is not a corpus
      // to be ranked, and a stable order is easier to check.
      const rank = (h) => (h.inTitle ? 0 : 1) * 100 + KINDS.findIndex((k) => k[0] === h.entry.kind);
      hits.sort((a, b) => rank(a) - rank(b));
      const shown = hits.slice(0, 80);
      lastHits = shown.map((h) => h.entry);

      const counts = {};
      hits.forEach((h) => { counts[h.entry.kind] = (counts[h.entry.kind] || 0) + 1; });
      const summary = KINDS.filter((k) => counts[k[0]])
        .map((k) => `${counts[k[0]]} ${k[1].toLowerCase()}`).join(' · ');
      meta.textContent = `${hits.length}${hits.length >= 400 ? '+' : ''} matches for “${input.value.trim()}”`
        + (summary ? ` — ${summary}` : '')
        + (D.report ? '' : ' — the full report is still loading');

      let lastKind = null;
      results.innerHTML = shown.map((h, i) => {
        const e = h.entry;
        const at = e.lower.indexOf(term);
        const body = e.text || e.title;
        const bodyAt = body.toLowerCase().indexOf(term);
        const from = Math.max(0, (bodyAt < 0 ? 0 : bodyAt) - 90);
        const snippet = (from > 0 ? '…' : '') + body.slice(from, from + 240) + (body.length > from + 240 ? '…' : '');
        const heading = e.kind === lastKind ? ''
          : `<div class="search-group">${Views.esc((KINDS.find((k) => k[0] === e.kind) || [, e.kind])[1])}</div>`;
        lastKind = e.kind;
        const href = e.url || (e.chart ? `#/${e.route}&chart=${e.chart}` : `#/${e.route}`);
        const external = e.kind === 'source' && e.url;
        return heading + `<a class="search-hit" data-i="${i}" href="${Views.esc(href)}"
            ${external ? 'target="_blank" rel="noopener"' : ''}>
          <div class="crumb">${Views.esc(e.crumb)}${external ? ' ↗' : ''}</div>
          <div class="hit-title">${highlight(e.title, term)}</div>
          ${snippet && snippet !== e.title ? `<div class="snip">${highlight(snippet, term)}</div>` : ''}
        </a>`;
      }).join('') || '<div class="chart-note" style="padding:18px">Nothing in the record matches that term.</div>';

      results.querySelectorAll('.search-hit').forEach((a) => {
        const hit = lastHits[Number(a.dataset.i)];
        if (hit && hit.url) return;   // a source link leaves the site; let it
        a.addEventListener('click', (e) => { e.preventDefault(); go(hit); });
      });
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 110);
    });
  }

  /* ---------- boot ---------- */

  async function start() {
    bootNames();
    // Both start now: the early paint needs one small file, the rest of the
    // record needs fifteen, and neither should wait on the other.
    const full = load();
    full.catch(() => {});  // handled below; this only stops an unhandled rejection
    await earlyPaint();
    try {
      D = await full;
    } catch (err) {
      const message = `Could not load data: ${Views.esc(err.message)}<br><span style="opacity:.6">Serve this folder over HTTP, e.g. <code>python3 -m http.server</code>.</span>`;
      if (bootGone) {
        app.insertAdjacentHTML('afterbegin',
          `<div class="section wrap"><div class="card" style="padding:22px"><p class="chart-note">${message}</p></div></div>`);
      } else {
        bootStatus.innerHTML = message;
      }
      console.error(err);
      return;
    }

    Views.setData(D);

    const s = D.rmeta.stats;
    document.getElementById('footer-stats').innerHTML =
      `${Views.fmt(s.words)} words · ${s.parts} parts · ${s.sections} sections · ${s.tables} tables · ` +
      `${D.timeline.length} chronology entries · ${D.statements.items.length} documented statements · ` +
      `${D.sources.groups.reduce((n, g) => n + g.items.length, 0)} linked sources · ` +
      `${D.rmeta.bibliography_count} bibliography entries. Casualty time-series: ` +
      `<a href="https://data.techforpalestine.org/" target="_blank" rel="noopener">Tech For Palestine</a> ` +
      `(public domain), ${D.ts.meta.first_month} – ${D.ts.meta.last_month}.`;

    document.getElementById('nav-toggle').addEventListener('click', () => nav.classList.toggle('open'));
    window.addEventListener('hashchange', route);
    initSearch();
    chartTools();
    shareCards();
    theme();
    heroNames();
    skipLink();
    printExpansion();
    citeCopy();
    freshness();
    sinceLastVisit();
    route();

    dismissBoot();
  }

  return { start, get data() { return D; } };
})();

App.start();
