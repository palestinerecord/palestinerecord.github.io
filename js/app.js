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

  if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  const VIEWS = ['overview', 'tour', 'data', 'timeline', 'evidence', 'rebuttals', 'statements', 'legal', 'sources'];

  /* index.html?prerender=1 renders the text and nothing else: no charts, no
     scroll reveals, no counting numbers, no WebGL scene. prerender.py uses it
     to dump a static snapshot of each route. Without it a dumped DOM catches
     the reveals mid-flight — elements frozen at opacity 0, headline figures
     frozen part-way through counting up — and carries forty dead canvases. */
  const STATIC = /(^|[?&])prerender=1(&|$)/.test(location.search);

  /* ---------- loading ---------- */

  /* Fourteen files, fetched together rather than one after another: the boot
     time is then the slowest single file, not the sum of all fourteen. The map
     geometry is not among them — charts.js fetches that only if a map is
     actually drawn. */
  async function load() {
    const files = [
      ['report', 'data/report.json'],
      ['ts', 'data/timeseries.json'],
      ['fig', 'data/figures.json'],
      ['statements', 'data/statements.json'],
      ['sources', 'data/sources.json'],
      ['history', 'data/history.json'],
      ['extra', 'data/timeline-extra.json'],
      ['legal', 'data/legal.json'],
      ['long', 'data/long-record.json'],
      ['positions', 'data/world-positions.json'],
      ['war', 'data/war-record.json'],
      ['conduct', 'data/conduct-record.json'],
      ['events', 'data/chart-events.json'],
      ['elements', 'data/elements.json'],
    ];
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
    D.timeline = mergeTimeline(D.report.timeline, D.extra);
    return D;
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
      render(id.indexOf('legal-') === 0 ? 'legal' : 'evidence');
      requestAnimationFrame(scroll);
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

    Charts.dispose();
    while (triggers.length) triggers.pop().kill();

    app.innerHTML = Views.render(name, sub);
    window.scrollTo(0, 0);

    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    nav.classList.remove('open');

    // Chrome, motion and behaviour are all optional extras — the content is not.
    if (!STATIC) {
      try { Charts.init(app, D); } catch (err) { console.error('charts', err); }
      try { reveal(); countUp(); } catch (err) { console.error('motion', err); }
    }
    try { behaviours[name] && behaviours[name](); } catch (err) { console.error('behaviour', name, err); }
    if (window.Scene && !STATIC) Scene.setView(name);
    try { scrollToChart(); } catch (err) { console.error('deep link', err); }
    rendered = name;
    renderedSub = sub || '';
  }

  /* ---------- shared motion ---------- */

  function reveal() {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const hero = app.querySelectorAll('[data-hero-title], [data-hero-lede], [data-hero-meta], [data-hero-cta]');
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
  function countUp() {
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
    nodes.forEach((n) => io.observe(n));
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
    el.innerHTML = `<span class="dot"></span><span>Casualty data <b>${Views.esc(readableDate(feed))}</b></span>`;
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
      if (tool === 'table') {
        const box = card.querySelector('.chart-table');
        if (!box) return;
        if (!box.hidden) {
          box.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          return;
        }
        const t = Charts.table(name);
        if (!t) { flash('not available'); return; }
        box.innerHTML = `<div class="table-wrap"><table>
          <thead><tr>${t.header.map((h) => `<th>${Views.esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${Views.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
        box.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
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
    window.addEventListener('beforeprint', () => {
      app.querySelectorAll('details:not([open])').forEach((d) => { opened.push(d); d.open = true; });
    });
    window.addEventListener('afterprint', () => { while (opened.length) opened.pop().open = false; });
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

  /* ---------- search ---------- */

  function buildIndex() {
    const out = [];
    const push = (crumb, anchor, text) => {
      const clean = text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      if (clean.length > 2) out.push({ crumb, anchor, text: clean, lower: clean.toLowerCase() });
    };
    const walk = (crumb, anchor, blocks) => blocks.forEach((b) => {
      if (b.type === 'paragraph' || b.type === 'subheading') push(crumb, anchor, b.html);
      else if (b.type === 'list') b.items.forEach((i) => push(crumb, anchor, i.html));
      else if (b.type === 'table') b.rows.forEach((r) => push(crumb, anchor, r.join(' — ')));
    });
    D.report.parts.forEach((p) => {
      push(p.title, 'part-' + p.id, p.title);
      walk(p.title, 'part-' + p.id, p.blocks);
      p.sections.forEach((s) => {
        push(p.title + ' › ' + s.title, 'sec-' + s.id, s.title);
        walk(p.title + ' › ' + s.title, 'sec-' + s.id, s.blocks);
      });
    });
    return out;
  }

  function initSearch() {
    const overlay = document.getElementById('search-overlay');
    const input = document.getElementById('search-input');
    const meta = document.getElementById('search-meta');
    const results = document.getElementById('search-results');

    const open = () => {
      if (!searchIndex) searchIndex = buildIndex();
      overlay.hidden = false;
      document.body.classList.add('locked');
      input.focus();
      input.select();
      meta.textContent = `Searching ${searchIndex.length.toLocaleString('en-GB')} passages from the full report.`;
    };
    const close = () => { overlay.hidden = true; document.body.classList.remove('locked'); };

    document.getElementById('search-open').addEventListener('click', open);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); open(); }
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); open(); }
      if (e.key === 'Escape' && !overlay.hidden) close();
    });

    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const term = input.value.trim().toLowerCase();
        if (term.length < 2) {
          results.innerHTML = '';
          meta.textContent = 'Type at least two characters.';
          return;
        }
        const hits = [];
        for (let i = 0; i < searchIndex.length && hits.length < 60; i++) {
          if (searchIndex[i].lower.indexOf(term) >= 0) hits.push(searchIndex[i]);
        }
        meta.textContent = `${hits.length}${hits.length === 60 ? '+' : ''} passages matching “${input.value.trim()}”`;
        results.innerHTML = hits.map((h) => {
          const at = h.lower.indexOf(term);
          const from = Math.max(0, at - 90);
          const snippet = (from > 0 ? '…' : '') + h.text.slice(from, at + term.length + 150) + '…';
          return `<a class="search-hit" href="#/evidence?${encodeURIComponent(h.anchor)}">
            <div class="crumb">${Views.esc(h.crumb)}</div>
            <div class="snip">${highlight(snippet, term)}</div>
          </a>`;
        }).join('') || '<div class="chart-note" style="padding:18px">No passage matches that term.</div>';

        results.querySelectorAll('.search-hit').forEach((a) => a.addEventListener('click', () => {
          close();
          // Same-route deep link: the hashchange may not fire, so scroll manually.
          setTimeout(() => {
            const id = decodeURIComponent(a.getAttribute('href').split('?')[1]);
            const el = document.getElementById(id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }));
      }, 110);
    });
  }

  /* ---------- boot ---------- */

  async function start() {
    bootNames();
    try {
      D = await load();
    } catch (err) {
      bootStatus.innerHTML = `Could not load data: ${Views.esc(err.message)}<br><span style="opacity:.6">Serve this folder over HTTP, e.g. <code>python3 -m http.server</code>.</span>`;
      console.error(err);
      return;
    }

    Views.setData(D);

    const s = D.report.stats;
    document.getElementById('footer-stats').innerHTML =
      `${Views.fmt(s.words)} words · ${s.parts} parts · ${s.sections} sections · ${s.tables} tables · ` +
      `${D.timeline.length} chronology entries · ${D.statements.items.length} documented statements · ` +
      `${D.sources.groups.reduce((n, g) => n + g.items.length, 0)} linked sources · ` +
      `${D.report.bibliography.length} bibliography entries. Casualty time-series: ` +
      `<a href="https://data.techforpalestine.org/" target="_blank" rel="noopener">Tech For Palestine</a> ` +
      `(public domain), ${D.ts.meta.first_month} – ${D.ts.meta.last_month}.`;

    document.getElementById('nav-toggle').addEventListener('click', () => nav.classList.toggle('open'));
    window.addEventListener('hashchange', route);
    initSearch();
    chartTools();
    heroNames();
    skipLink();
    printExpansion();
    freshness();
    sinceLastVisit();
    route();

    boot.classList.add('done');
    setTimeout(() => boot.remove(), 600);
  }

  return { start, get data() { return D; } };
})();

App.start();
