/* ============================================================
   charts.js — ECharts + echarts-gl chart registry.
   Views emit <div class="chart" data-chart="name"></div>;
   Charts.init(root, data) finds them and builds each one.
   ============================================================ */

const Charts = (function () {
  /* Every data file is asked for with the build number this script was loaded
     under, for the reason given at the same constant in app.js. */
  const BUILD = ((document.currentScript && document.currentScript.src) || '').match(/[?&]v=(\d+)/);
  const dataUrl = (path) => (BUILD ? `${path}?v=${BUILD[1]}` : path);

  /* index.html?still=1 stops the two 3D charts rotating. A headless render
     dumps the page once virtual time runs out, and virtual time advances one
     animation frame at a time, so a scene that asks for frames forever costs
     minutes of software rendering before the check can read the result. The
     flag is for the render checks in publish.py; nothing a reader sees uses it. */
  const STILL = /(^|[?&])still=1(&|$)/.test(location.search);
  /* A 3D scene reserves fixed pixels for its scale bars and cannot reflow them,
     so the few charts that need it read the viewport width at build time. The
     resize handler re-applies their options when the breakpoint is crossed. */
  const NARROW = () => (window.innerWidth || 1200) < 760;

  /* The greys, and the neutral the charts lay over the background, are read
     from the stylesheet rather than held here a second time, so the light
     theme and the dark theme are described in exactly one place. `ink` is that
     neutral at whatever opacity the caller asks for: white on the dark theme,
     near-black on the light one. The hues are read the same way, so the light
     theme can carry versions that hold their contrast against white. */
  const C = {
    red: '#d2534c',
    amber: '#d9a441',
    blue: '#56a8e0',
    green: '#4fae82',
    violet: '#9b7fd4',
    muted: '#7d879c',
    text: '#e9edf6',
    text2: '#b9c2d4',
    line: 'rgba(255,255,255,0.08)',
    inkRGB: '255,255,255',
    plate: 'rgba(10,14,23,0.96)',
    ink(alpha) { return 'rgba(' + C.inkRGB + ',' + alpha + ')'; },
  };

  /* The day the ceasefire came into force. Several charts divide their axis on
     it, so it is written once. */
  const CEASEFIRE = '2025-10-11';

  /* Re-read the palette and repaint the shared option base. Called before
     every build, so switching theme and re-rendering is all it takes. */
  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
    C.text = pick('--text', C.text);
    C.text2 = pick('--text-2', C.text2);
    C.muted = pick('--chart-muted', pick('--muted', C.muted));
    /* The hues come from the stylesheet too. They are the same five in both
       themes, but the light theme darkens each one: a series label set in the
       dark red reads at 4.1:1 on white, which is under what small text needs,
       and a chart whose labels cannot be read is not a chart. */
    C.red = pick('--red', C.red);
    C.amber = pick('--accent', C.amber);
    C.blue = pick('--blue', C.blue);
    C.green = pick('--green', C.green);
    C.violet = pick('--violet', C.violet);
    C.inkRGB = pick('--ink-rgb', C.inkRGB);
    C.plate = pick('--chart-plate', C.plate);
    C.line = C.ink(0.08);
    base.textStyle.color = C.text2;
    base.tooltip.backgroundColor = C.plate;
    base.tooltip.borderColor = C.ink(0.14);
    base.tooltip.textStyle.color = C.text;
    base.legend.textStyle.color = C.text2;
    base.legend.inactiveColor = C.ink(0.22);
  }

  const live = [];
  let data = null;

  const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-GB'));

  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: C.text2, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif' },
    animationDuration: 900,
    animationEasing: 'cubicOut',
    tooltip: {
      backgroundColor: C.plate,
      borderColor: C.ink(0.14),
      borderWidth: 1,
      textStyle: { color: C.text, fontSize: 12.5 },
      extraCssText: 'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.55);backdrop-filter:blur(8px);',
    },
    legend: { textStyle: { color: C.text2, fontSize: 12 }, inactiveColor: C.ink(.22), top: 0 },
  };

  const axisX = (extra) => Object.assign({
    type: 'category',
    axisLine: { lineStyle: { color: C.ink(.16) } },
    axisTick: { show: false },
    axisLabel: { color: C.muted, fontSize: 11 },
  }, extra || {});

  const axisY = (extra) => Object.assign({
    type: 'value',
    splitLine: { lineStyle: { color: C.line } },
    axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => (Math.abs(v) >= 1000 ? (v / 1000) + 'k' : v) },
  }, extra || {});

  // Vertical gradient fill, used by every area series.
  const fade = (colour, top, bottom) => ({
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: colour.replace(')', `,${top})`).replace('rgb', 'rgba') },
      { offset: 1, color: colour.replace(')', `,${bottom})`).replace('rgb', 'rgba') },
    ],
  });

  const hexToRgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const areaFill = (hex) => ({
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [{ offset: 0, color: hexToRgba(hex, 0.45) }, { offset: 1, color: hexToRgba(hex, 0.02) }],
  });

  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo - 1] + " '" + y.slice(2);
  };

  const dayLabel = (d) => {
    const [y, m, day] = d.split('-');
    return +day + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + " '" + y.slice(2);
  };

  /* The dated events of data/chart-events.json, drawn on the Gaza series as a
     second layer that is off by default. Which charts can carry them, and at
     what resolution, is declared here rather than inside each builder, because
     views.js has to know before a chart is built whether to emit the toggle. */
  const EVENTED = {
    'gaza-monthly': 'month',
    'gaza-cumulative': 'month',
    'aid-seekers': 'month',
    'famine-deaths': 'month',
    'recovery-lag': 'month',
    'daily-toll': 'day',
    'daily-rate': 'day',
    'day-spine': 'day',
  };

  /* Which charts currently have the layer switched on. Keyed by chart name, so
     the state survives a re-render of the same route. */
  const eventsOn = {};

  // Read at call time, not at load time: the palette changes with the theme.
  const eventTone = (tone) => C[tone] || C.amber;

  /* Marker labels stand upright and on one line: thirteen horizontal two-line
     labels across thirty-five months run together into an unreadable band. They
     carry their own dark backing because a rotated label crosses the bars and
     the filled areas, and coloured text on a red bar cannot be read. */
  const MARK_LABEL = {
    fontSize: 9.5, rotate: 90, align: 'left', verticalAlign: 'middle',
    position: 'insideStartTop', distance: 6,
    backgroundColor: 'rgba(11,15,24,.78)', padding: [2, 3], borderRadius: 2,
  };

  /* Map a YYYY-MM-DD event onto a category axis. A month axis takes the index of
     its YYYY-MM; a day axis takes the first reporting day on or after the event,
     because the daily series has gaps and an exact match is not guaranteed. */
  const eventIndex = (event, axis, kind) => {
    if (kind === 'month') return axis.indexOf(event.date.slice(0, 7));
    let i = axis.indexOf(event.date);
    if (i >= 0) return i;
    i = axis.findIndex((d) => d > event.date);
    return i;
  };

  /* One markLine per series, carrying the ceasefire — which is always drawn —
     and, when the layer is switched on, every dated event that falls inside the
     axis. The two have to share a markLine because a series only has one. */
  const seriesMarks = (name, axis, kind) => {
    const items = [];
    const on = !!eventsOn[name];
    const cf = kind === 'day' ? axis.findIndex((d) => d >= CEASEFIRE) : axis.indexOf(CEASEFIRE.slice(0, 7));
    if (cf >= 0) {
      items.push({
        xAxis: cf, name: 'Ceasefire', detail: 'In force from 11 October 2025.',
        lineStyle: { color: C.green, type: 'dashed', width: 1.4 },
        /* Alone the label reads across the top of the plot; with the event layer
           on it has neighbours a month away and has to stand up like they do. */
        label: on
          ? Object.assign({ formatter: 'Ceasefire', color: C.green }, MARK_LABEL)
          : { formatter: 'Ceasefire\nOct 2025', color: C.green, fontSize: 10.5, position: 'insideEndTop' },
      });
    }
    if (on && data.events && data.events.events) {
      /* Events that land too close together are drawn as one marker naming both.
         Two fall in the same month — the Rafah order and the tent camp in May
         2024, the closure and the second finding in June 2026 — and on the daily
         axis the Rafah order and the tent camp are two days apart, which is a
         single pixel. The threshold is a fraction of the axis rather than a
         fixed number of points, because the same events are drawn on a 36-point
         axis and on a 1,070-point one. */
      const gap = Math.max(1, Math.round(axis.length / 120));
      const groups = [];
      data.events.events
        .map((e) => ({ e, i: eventIndex(e, axis, kind) }))
        .filter((x) => x.i >= 0)
        .sort((a, b) => a.i - b.i)
        .forEach((x) => {
          const last = groups[groups.length - 1];
          if (last && x.i - last.i < gap) { last.list.push(x.e); return; }
          groups.push({ i: x.i, list: [x.e] });
        });
      groups.forEach((g) => {
        const colour = eventTone(g.list[0].tone) || C.muted;
        items.push({
          xAxis: g.i,
          name: g.list.map((e) => e.label).join(' · '),
          detail: g.list.map((e) => e.detail).join('<br><br>'),
          lineStyle: { color: hexToRgba(colour, 0.7), type: 'dashed', width: 1.2 },
          label: Object.assign({
            formatter: g.list.map((e) => e.short.replace(/\n/g, ' ')).join(' · '),
            color: colour,
          }, MARK_LABEL),
        });
      });
    }
    if (!items.length) return {};
    return {
      markLine: {
        symbol: 'none', animation: false, emphasis: { disabled: true },
        data: items,
        tooltip: {
          show: true, backgroundColor: 'rgba(11,15,24,.96)', borderColor: C.ink(.12),
          textStyle: { color: C.text, fontSize: 12 },
          formatter: (t) => `<b>${t.name}</b><br><span style="opacity:.75;font-size:11.5px">${(t.data || {}).detail || ''}</span>`,
        },
      },
    };
  };

  /* ---------------- registry ---------------- */

  const R = {};

  /* Gaza — killed per month, whole war */
  R['gaza-monthly'] = () => {
    const s = data.ts.gaza.monthly_killed;
    const c = data.ts.gaza.monthly_children;
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 40, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['All killed', 'of whom children'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => `<b>${monthLabel(s.months[p[0].dataIndex])}</b><br>` +
          p.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(x.value)}</b>`).join('<br>'),
      }),
      xAxis: axisX({ data: s.months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: axisY({ name: 'killed per month', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign({
          name: 'All killed', type: 'bar', data: s.values, barMaxWidth: 22,
          itemStyle: { color: fade('rgb(210,83,76)', 0.95, 0.35), borderRadius: [3, 3, 0, 0] },
        }, seriesMarks('gaza-monthly', s.months, 'month')),
        {
          name: 'of whom children', type: 'bar', data: c.values, barMaxWidth: 22, barGap: '-100%',
          itemStyle: { color: hexToRgba(C.amber, 0.85), borderRadius: [3, 3, 0, 0] },
        },
      ],
    });
  };

  /* Gaza — cumulative toll, stacked protected categories */
  R['gaza-cumulative'] = () => {
    const g = data.ts.gaza;
    const months = g.cumulative_killed.months;
    const line = (src, colour, name) => ({
      name, type: 'line', smooth: 0.32, showSymbol: false,
      data: src.values, lineStyle: { width: 2.4, color: colour },
      itemStyle: { color: colour }, areaStyle: { color: areaFill(colour) },
    });
    return Object.assign({}, base, {
      grid: { left: 58, right: 20, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Cumulative killed', 'Children', 'Women', 'Medical personnel', 'Journalists'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis' }),
      xAxis: axisX({ data: months.map(monthLabel), boundaryGap: false, axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: axisY({}),
      series: [
        Object.assign(line(g.cumulative_killed, C.red, 'Cumulative killed'), seriesMarks('gaza-cumulative', months, 'month')),
        line(g.cumulative_children, C.amber, 'Children'),
        line(g.cumulative_women, C.violet, 'Women'),
        line(g.cumulative_medical, C.blue, 'Medical personnel'),
        line(g.cumulative_press, C.green, 'Journalists'),
      ],
    });
  };

  /* Daily resolution — every reporting day, not the monthly collapse */
  R['daily-toll'] = () => {
    const d = data.ts.daily.gaza;
    const labels = d.dates.map(dayLabel);
    const line = (values, colour, name) => ({
      name, type: 'line', smooth: 0.15, showSymbol: false, sampling: 'lttb',
      data: values, lineStyle: { width: 2, color: colour },
      itemStyle: { color: colour }, areaStyle: { color: areaFill(colour) },
    });
    return Object.assign({}, base, {
      grid: { left: 58, right: 20, top: 42, bottom: 74 },
      legend: Object.assign({}, base.legend, { data: ['Killed', 'Children killed', 'Aid seekers killed'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis' }),
      dataZoom: [
        { type: 'inside', throttle: 60 },
        {
          type: 'slider', height: 20, bottom: 12,
          borderColor: C.ink(.12), backgroundColor: C.ink(.03),
          fillerColor: hexToRgba(C.amber, 0.1), handleStyle: { color: C.amber },
          textStyle: { color: C.muted, fontSize: 10 },
          dataBackground: { lineStyle: { color: C.muted }, areaStyle: { color: hexToRgba(C.muted, 0.2) } },
        },
      ],
      xAxis: axisX({ data: labels, boundaryGap: false, axisLabel: { color: C.muted, fontSize: 10 } }),
      yAxis: axisY({ name: 'cumulative', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign(line(d.killed, C.red, 'Killed'), seriesMarks('daily-toll', d.dates, 'day')),
        line(d.children, C.amber, 'Children killed'),
        line(d.aid_seekers, C.violet, 'Aid seekers killed'),
      ],
    });
  };

  /* Daily rate — new deaths per reporting day, with a 7-day mean over the top */
  R['daily-rate'] = () => {
    const d = data.ts.daily.gaza;
    const labels = d.dates.map(dayLabel);
    const newDaily = d.killed.map((v, i) => (i === 0 ? v : Math.max(0, v - d.killed[i - 1])));
    const mean = newDaily.map((_, i) => {
      const window = newDaily.slice(Math.max(0, i - 6), i + 1);
      return +(window.reduce((a, b) => a + b, 0) / window.length).toFixed(1);
    });
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 42, bottom: 74 },
      legend: Object.assign({}, base.legend, { data: ['Reported that day', '7-day mean'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      dataZoom: [
        { type: 'inside', throttle: 60 },
        {
          type: 'slider', height: 20, bottom: 12,
          borderColor: C.ink(.12), backgroundColor: C.ink(.03),
          fillerColor: hexToRgba(C.amber, 0.1), handleStyle: { color: C.amber },
          textStyle: { color: C.muted, fontSize: 10 },
        },
      ],
      xAxis: axisX({ data: labels, axisLabel: { color: C.muted, fontSize: 10 } }),
      yAxis: axisY({ name: 'killed per day', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign({ name: 'Reported that day', type: 'bar', data: newDaily, barMaxWidth: 6, large: true,
          itemStyle: { color: hexToRgba(C.red, 0.55) } }, seriesMarks('daily-rate', d.dates, 'day')),
        { name: '7-day mean', type: 'line', data: mean, smooth: 0.3, showSymbol: false, sampling: 'lttb',
          lineStyle: { color: C.amber, width: 2.2 }, itemStyle: { color: C.amber } },
      ],
    });
  };

  /* ---- the day route's spine ----

     The same per-day deltas as the daily rate chart, carrying one extra mark:
     the day the reader is standing on. Everything else on that route — the
     toll, the statements, the rulings, the aid regime — is pinned to the day
     this line marks, so the line is the page's cursor and not decoration. It
     is kept in a module variable rather than passed in, because the registry
     builds every chart from a nullary function. */
  let dayCursor = null;

  /* The cursor is merged into the markLine the series already carries, because
     a series has only one. Rebuilding the whole option on every step of the
     scrubber would redraw a 1,070-point bar chart several times a second; a
     partial setOption on this one object does not. */
  const dayMarks = () => {
    const dates = data.ts.daily.gaza.dates;
    const existing = seriesMarks('day-spine', dates, 'day').markLine;
    const mark = existing
      ? Object.assign({}, existing, { data: existing.data.slice() })
      : { symbol: 'none', animation: false, emphasis: { disabled: true }, data: [] };
    const i = dayCursor == null ? -1 : dates.indexOf(dayCursor);
    if (i >= 0) {
      mark.data = mark.data.concat([{
        xAxis: i,
        name: dayLabel(dayCursor),
        detail: 'The day this page is standing on.',
        lineStyle: { color: C.text, width: 2, type: 'solid' },
        label: {
          /* The backing is read from the theme: a fixed dark chip carries
             near-black text on the light theme and reads as a solid block. */
          formatter: dayLabel(dayCursor), color: C.text, fontSize: 11,
          position: 'insideEndTop', distance: 5,
          backgroundColor: C.plate, borderColor: C.ink(0.14), borderWidth: 1,
          padding: [3, 5], borderRadius: 3,
        },
      }]);
    }
    return mark;
  };

  R['day-spine'] = () => {
    const d = data.ts.daily.gaza;
    const labels = d.dates.map(dayLabel);
    const newDaily = d.killed.map((v, i) => (i === 0 ? v : Math.max(0, v - d.killed[i - 1])));
    const mean = newDaily.map((_, i) => {
      const window = newDaily.slice(Math.max(0, i - 6), i + 1);
      return +(window.reduce((a, b) => a + b, 0) / window.length).toFixed(1);
    });
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 40, bottom: 74 },
      legend: Object.assign({}, base.legend, { data: ['Reported that day', '7-day mean'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (p) => `<b>${dayLabel(d.dates[p[0].dataIndex])}</b><br>`
          + p.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(x.value)}</b>`).join('<br>')
          + '<br><span style="opacity:.7;font-size:11px">Click to stand on this day.</span>',
      }),
      dataZoom: [
        { type: 'inside', throttle: 60 },
        {
          type: 'slider', height: 20, bottom: 12,
          borderColor: C.ink(.12), backgroundColor: C.ink(.03),
          fillerColor: hexToRgba(C.amber, 0.1), handleStyle: { color: C.amber },
          textStyle: { color: C.muted, fontSize: 10 },
        },
      ],
      xAxis: axisX({ data: labels, axisLabel: { color: C.muted, fontSize: 10 } }),
      yAxis: axisY({ name: 'killed per day', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        { name: 'Reported that day', type: 'bar', data: newDaily, barMaxWidth: 6, large: true,
          itemStyle: { color: hexToRgba(C.red, 0.5) }, markLine: dayMarks() },
        { name: '7-day mean', type: 'line', data: mean, smooth: 0.3, showSymbol: false, sampling: 'lttb',
          lineStyle: { color: C.amber, width: 2.2 }, itemStyle: { color: C.amber } },
      ],
    });
  };

  /* The killing after the ceasefire of 11 October 2025, on its own axis.
     Drawn against the war's own mean rather than against zero, because the
     question the chart answers is not whether the killing stopped — it did
     not — but what a ceasefire changed about its rate. */
  R['ceasefire-daily'] = () => {
    const d = data.ts.daily.gaza;
    const at = d.dates.findIndex((x) => x >= CEASEFIRE);
    if (at < 1) return null;
    const added = (i) => Math.max(0, d.killed[i] - d.killed[i - 1]);
    const before = d.killed.slice(1, at).reduce((a, _, i) => a + added(i + 1), 0) / Math.max(1, at - 1);
    const dates = d.dates.slice(at);
    const daily = dates.map((_, i) => added(at + i));
    const mean = daily.map((_, i) => {
      const window = daily.slice(Math.max(0, i - 6), i + 1);
      return +(window.reduce((a, b) => a + b, 0) / window.length).toFixed(1);
    });
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 40, bottom: 52 },
      legend: Object.assign({}, base.legend, { data: ['Reported that day', '7-day mean'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (p) => `<b>${dayLabel(dates[p[0].dataIndex])}</b><br>`
          + p.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(x.value)}</b>`).join('<br>'),
      }),
      xAxis: axisX({ data: dates.map(dayLabel), axisLabel: { color: C.muted, fontSize: 10 } }),
      yAxis: axisY({ name: 'killed per day', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        { name: 'Reported that day', type: 'bar', data: daily, barMaxWidth: 7, large: true,
          itemStyle: { color: hexToRgba(C.red, 0.55) },
          markLine: {
            silent: true, symbol: 'none',
            data: [{
              yAxis: +before.toFixed(1), name: 'Daily mean before the ceasefire',
              lineStyle: { color: C.amber, type: 'dashed', width: 1.4 },
              label: {
                formatter: 'Mean before the ceasefire: ' + before.toFixed(0) + ' a day',
                color: C.amber, fontSize: 10.5, position: 'insideEndTop',
              },
            }],
          } },
        { name: '7-day mean', type: 'line', data: mean, smooth: 0.3, showSymbol: false,
          lineStyle: { color: C.blue, width: 2.2 }, itemStyle: { color: C.blue } },
      ],
    });
  };

  /* Move the cursor. Returns the date it settled on, or null when the spine is
     not on screen, so the caller can tell a no-op from a move. */
  function setDay(iso) {
    dayCursor = iso;
    const chart = built['day-spine'];
    if (!chart) return null;
    chart.setOption({ series: [{ markLine: dayMarks() }] });
    return iso;
  }

  /* A click anywhere inside the plot picks the day under the pointer, which is
     how a reader who can see the spike expects to reach it. The handler is on
     the renderer rather than on the series, because the bars are one pixel wide
     and nobody can hit one. */
  function onDayPick(fn) {
    const chart = built['day-spine'];
    if (!chart || !data) return false;
    const dates = data.ts.daily.gaza.dates;
    chart.getZr().on('click', (e) => {
      const point = [e.offsetX, e.offsetY];
      if (!chart.containPixel({ gridIndex: 0 }, point)) return;
      const i = Math.round(chart.convertFromPixel({ seriesIndex: 0 }, point)[0]);
      if (dates[i]) fn(dates[i]);
    });
    return true;
  }

  /* Age and sex of the identified dead — the named list, not an estimate */
  R['age-pyramid'] = () => {
    const d = data.ts.demographics;
    return Object.assign({}, base, {
      grid: { left: 66, right: 30, top: 42, bottom: 40 },
      legend: Object.assign({}, base.legend, { data: ['Male', 'Female'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => `<b>Age ${d.bands[p[0].dataIndex]}</b><br>` +
          p.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(Math.abs(x.value))}</b>`).join('<br>'),
      }),
      xAxis: axisY({ axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => fmt(Math.abs(v)) } }),
      yAxis: axisX({ data: d.bands, name: 'age', nameGap: 20, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        { name: 'Male', type: 'bar', stack: 'x', data: d.male.map((v) => -v), barMaxWidth: 22,
          itemStyle: { color: hexToRgba(C.blue, 0.8), borderRadius: [4, 0, 0, 4] } },
        { name: 'Female', type: 'bar', stack: 'x', data: d.female, barMaxWidth: 22,
          itemStyle: { color: hexToRgba(C.violet, 0.8), borderRadius: [0, 4, 4, 0] } },
      ],
    });
  };

  /* Every year of childhood, counted separately */
  R['child-ages'] = () => {
    const d = data.ts.demographics;
    return Object.assign({}, base, {
      grid: { left: 56, right: 20, top: 20, bottom: 42 },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => `<b>Age ${p[0].dataIndex}</b>: ${fmt(p[0].value)} identified dead`,
      }),
      xAxis: axisX({ data: d.child_ages.map((_, i) => i), name: 'age at death', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisY({}),
      series: [{
        type: 'bar', data: d.child_ages, barMaxWidth: 26,
        itemStyle: { color: fade('rgb(217,164,65)', 0.95, 0.3), borderRadius: [4, 4, 0, 0] },
      }],
    });
  };

  /* Aid seekers — people shot while queuing for food */
  R['aid-seekers'] = () => {
    const g = data.ts.gaza;
    const months = g.monthly_aid_seekers.months;
    return Object.assign({}, base, {
      grid: { left: 50, right: 60, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Killed that month', 'Cumulative killed', 'Cumulative injured'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      xAxis: axisX({ data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: [
        axisY({ name: 'per month', nameTextStyle: { color: C.muted, fontSize: 11 } }),
        axisY({ name: 'cumulative', splitLine: { show: false }, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      ],
      series: [
        Object.assign({
          name: 'Killed that month', type: 'bar', data: g.monthly_aid_seekers.values, barMaxWidth: 20,
          itemStyle: { color: fade('rgb(210,83,76)', 0.92, 0.32), borderRadius: [3, 3, 0, 0] },
        }, seriesMarks('aid-seekers', months, 'month')),
        { name: 'Cumulative killed', type: 'line', yAxisIndex: 1, smooth: 0.3, showSymbol: false,
          data: g.cumulative_aid_seekers_killed.values, lineStyle: { color: C.amber, width: 2.4 }, itemStyle: { color: C.amber } },
        { name: 'Cumulative injured', type: 'line', yAxisIndex: 1, smooth: 0.3, showSymbol: false,
          data: g.cumulative_aid_seekers_injured.values, lineStyle: { color: C.blue, width: 2, type: 'dashed' }, itemStyle: { color: C.blue } },
      ],
    });
  };

  /* Starvation — deaths recorded as famine or malnutrition */
  R['famine-deaths'] = () => {
    const g = data.ts.gaza;
    const months = g.cumulative_famine.months;
    const line = (src, colour, name) => ({
      name, type: 'line', step: 'end', showSymbol: false, data: src.values,
      lineStyle: { width: 2.4, color: colour }, itemStyle: { color: colour }, areaStyle: { color: areaFill(colour) },
    });
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['All ages', 'Children'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis' }),
      xAxis: axisX({ data: months.map(monthLabel), boundaryGap: false, axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: axisY({ name: 'cumulative deaths', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign(line(g.cumulative_famine, C.red, 'All ages'), seriesMarks('famine-deaths', months, 'month')),
        line(g.cumulative_child_famine, C.amber, 'Children'),
      ],
    });
  };

  /* The count catching up with itself — rubble recoveries and later deaths */
  R['recovery-lag'] = () => {
    const g = data.ts.gaza;
    const months = g.monthly_recovered.months;
    return Object.assign({}, base, {
      grid: { left: 52, right: 20, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Recovered from rubble', 'Died later of wounds'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      xAxis: axisX({ data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: axisY({ name: 'added to the register', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign({
          name: 'Recovered from rubble', type: 'bar', stack: 'a', data: g.monthly_recovered.values, barMaxWidth: 22,
          itemStyle: { color: hexToRgba(C.muted, 0.75) },
        }, seriesMarks('recovery-lag', months, 'month')),
        { name: 'Died later of wounds', type: 'bar', stack: 'a', data: g.monthly_succumbed.values, barMaxWidth: 22,
          itemStyle: { color: hexToRgba(C.red, 0.8), borderRadius: [3, 3, 0, 0] } },
      ],
    });
  };

  /* West Bank displacement — people, children and households put out of their homes */
  R['wb-displacement'] = () => {
    const w = data.ts.west_bank;
    const months = w.cumulative_displaced.months;
    const line = (src, colour, name, axis) => ({
      name, type: 'line', smooth: 0.3, showSymbol: false, yAxisIndex: axis || 0, data: src.values,
      lineStyle: { width: 2.4, color: colour }, itemStyle: { color: colour },
      areaStyle: axis ? undefined : { color: areaFill(colour) },
    });
    return Object.assign({}, base, {
      grid: { left: 56, right: 60, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['People displaced', 'of whom children', 'Households'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis' }),
      xAxis: axisX({ data: months.map(monthLabel), boundaryGap: false, axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: [
        axisY({ name: 'people', nameTextStyle: { color: C.muted, fontSize: 11 } }),
        axisY({ name: 'households', splitLine: { show: false }, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      ],
      series: [
        line(w.cumulative_displaced, C.red, 'People displaced'),
        line(w.cumulative_displaced_children, C.amber, 'of whom children'),
        line(w.cumulative_displaced_households, C.blue, 'Households', 1),
      ],
    });
  };

  /* ---------------- the long record, 1948–2026 ----------------
     These read data.long (data/long-record.json), curated period
     blocks rather than a continuous series, because no continuous
     Palestinian death register has ever existed. Periods with no
     figure carry null and are drawn as gaps, not as zeroes. */

  /* Palestinians killed, period by period. Log scale: the blocks span
     435 to 74,784, two and a half orders of magnitude. */
  R['long-toll'] = () => {
    const p = data.long.toll.periods;
    const colour = (x) => (x.id === 'gaza-war' ? C.red : x.partial || x.overlap ? C.muted : C.amber);
    return Object.assign({}, base, {
      grid: { left: 196, right: 96, top: 40, bottom: 46 },
      // The documented series colours each bar individually, so the legend
      // would otherwise fall back to the palette default and mislabel both.
      legend: Object.assign({}, base.legend, {
        data: [
          { name: 'Documented', itemStyle: { color: C.amber, borderWidth: 0 } },
          { name: 'Estimated', itemStyle: { color: hexToRgba(C.violet, 0.24), borderColor: C.violet, borderWidth: 1, borderType: 'dashed' } },
        ],
      }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = p[t[0].dataIndex];
          return `<b>${x.label}</b><br>${x.span}<br>` +
            (x.killed === null ? '' :
              `Documented: <b>${fmt(x.killed)}</b>${x.partial ? ' (partial coverage)' : ''}<br>` +
              (x.low ? `estimates range ${fmt(x.low)}–${fmt(x.high)}<br>` : '') +
              (x.children ? `of whom children: <b>${fmt(x.children)}</b><br>` : '')) +
            (x.estimate ? `Estimated: <b>${fmt(x.estimate)}</b> (${fmt(x.estimate_low)}–${fmt(x.estimate_high)})<br>` : '') +
            `<span style="opacity:.7;font-size:11.5px">${x.source}</span>`;
        },
      }),
      xAxis: axisY({ type: 'log', min: 100, name: 'Palestinians killed (log scale)', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: p.map((x) => x.label),
        inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 180, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [
        {
          name: 'Documented', type: 'bar', barMaxWidth: 14, barGap: '10%',
          data: p.map((x) => ({ value: x.killed, itemStyle: { color: colour(x), borderRadius: [0, 3, 3, 0] } })),
          label: {
            show: true, position: 'right', color: C.text2, fontSize: 11.5,
            formatter: (t) => (p[t.dataIndex].killed === null ? '' : fmt(p[t.dataIndex].killed)),
          },
        },
        {
          name: 'Estimated', type: 'bar', barMaxWidth: 14,
          data: p.map((x) => ({
            value: x.estimate || null,
            itemStyle: { color: hexToRgba(C.violet, 0.24), borderColor: C.violet, borderWidth: 1, borderType: 'dashed', borderRadius: [0, 3, 3, 0] },
          })),
          label: {
            show: true, position: 'right', color: C.violet, fontSize: 11,
            formatter: (t) => (p[t.dataIndex].estimate ? '~' + fmt(p[t.dataIndex].estimate) : ''),
          },
        },
      ],
    });
  };

  /* The running floor: the documented periods stacked into one total,
     against the PCBS cumulative figure the periods cannot reach. */
  R['long-cumulative'] = () => {
    const p = data.long.toll.periods.filter((x) => x.counted);
    const anchor = data.long.toll.anchor;
    let run = 0;
    const steps = p.map((x) => { run += x.killed; return { label: x.label, span: x.span, add: x.killed, total: run }; });
    return Object.assign({}, base, {
      grid: { left: 64, right: 24, top: 46, bottom: 92 },
      legend: Object.assign({}, base.legend, { data: ['Added in this period', 'Documented running total'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const s = steps[t[0].dataIndex];
          return `<b>${s.label}</b><br>${s.span}<br>Added: <b>${fmt(s.add)}</b><br>Running documented total: <b>${fmt(s.total)}</b>`;
        },
      }),
      xAxis: axisX({ data: steps.map((s) => s.span), axisLabel: { color: C.muted, fontSize: 10.5, rotate: 30, interval: 0 } }),
      yAxis: axisY({ name: 'Palestinians killed', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        {
          name: 'Added in this period', type: 'bar', barMaxWidth: 40, data: steps.map((s) => s.add),
          itemStyle: { color: fade('rgb(210,83,76)', 0.9, 0.3), borderRadius: [3, 3, 0, 0] },
        },
        {
          name: 'Documented running total', type: 'line', smooth: 0.25, symbol: 'circle', symbolSize: 7,
          data: steps.map((s) => s.total),
          lineStyle: { width: 2.6, color: C.amber }, itemStyle: { color: C.amber },
          markLine: {
            symbol: 'none', silent: true,
            lineStyle: { color: C.blue, type: 'dashed', width: 1.4 },
            label: { formatter: 'PCBS: ' + fmt(anchor.value) + ' since 1948', color: C.blue, fontSize: 10.5, position: 'insideStartTop' },
            data: [{ yAxis: anchor.value }],
          },
        },
      ],
    });
  };

  /* The ratio, period by period: Palestinians and Israelis killed on
     the same log axis, so the bars are comparable at all. */
  R['ratio-bars'] = () => {
    const a = data.long.asymmetry.periods;
    return Object.assign({}, base, {
      grid: { left: 150, right: 96, top: 40, bottom: 50 },
      legend: Object.assign({}, base.legend, { data: ['Palestinians killed', 'Israelis killed'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = a[t[0].dataIndex];
          const r = Math.round(10 * x.palestinian / x.israeli) / 10;
          return `<b>${x.label}</b><br>${x.span}<br>` +
            t.map((s) => `${s.marker} ${s.seriesName}: <b>${fmt(s.value)}</b>`).join('<br>') +
            `<br>Ratio: <b>${r} to 1</b><br><span style="opacity:.7;font-size:11.5px">${x.source}</span>`;
        },
      }),
      xAxis: axisY({ type: 'log', min: 10, name: 'people killed (log scale)', nameLocation: 'middle', nameGap: 32, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: a.map((x) => x.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 140, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [
        {
          name: 'Palestinians killed', type: 'bar', barMaxWidth: 13, data: a.map((x) => x.palestinian),
          itemStyle: { color: C.red, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true, position: 'right', color: C.red, fontSize: 11.5, fontWeight: 600,
            formatter: (t) => fmt(a[t.dataIndex].palestinian) + '  ·  ' + (Math.round(10 * a[t.dataIndex].palestinian / a[t.dataIndex].israeli) / 10) + ':1',
          },
        },
        {
          name: 'Israelis killed', type: 'bar', barMaxWidth: 13, data: a.map((x) => x.israeli),
          itemStyle: { color: C.blue, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: C.blue, fontSize: 11, formatter: (t) => fmt(a[t.dataIndex].israeli) },
        },
      ],
    });
  };

  /* The ratio on its own axis — how many Palestinians are killed for
     every one Israeli, period by period. */
  R['ratio-trend'] = () => {
    const a = data.long.asymmetry.periods;
    const r = a.map((x) => Math.round(10 * x.palestinian / x.israeli) / 10);
    return Object.assign({}, base, {
      grid: { left: 82, right: 26, top: 30, bottom: 92 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const x = a[t[0].dataIndex];
          return `<b>${x.label}</b><br>${x.span}<br><b>${r[t[0].dataIndex]}</b> Palestinians killed per Israeli killed<br>` +
            `${fmt(x.palestinian)} against ${fmt(x.israeli)}`;
        },
      }),
      xAxis: axisX({ data: a.map((x) => x.span), axisLabel: { color: C.muted, fontSize: 10.5, rotate: 30, interval: 0 } }),
      // The name sits rotated along the axis: at 'end' it is centred on the
      // axis line and a label this long is clipped by the left edge.
      yAxis: axisY({
        name: 'Palestinians killed per Israeli killed',
        nameLocation: 'middle', nameGap: 58, nameRotate: 90,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      }),
      series: [
        {
          type: 'bar', barMaxWidth: 46, data: r,
          itemStyle: { color: fade('rgb(210,83,76)', 0.92, 0.28), borderRadius: [3, 3, 0, 0] },
          label: { show: true, position: 'top', color: C.text2, fontSize: 12, fontWeight: 600, formatter: (t) => t.value + ':1' },
          markLine: {
            symbol: 'none', silent: true,
            lineStyle: { color: C.muted, type: 'dashed', width: 1.2 },
            label: { formatter: 'parity', color: C.muted, fontSize: 10.5, position: 'insideStartTop' },
            data: [{ yAxis: 1 }],
          },
        },
      ],
    });
  };

  /* Yesh Din's funnel: complaint, investigation, indictment. */
  R['accountability-funnel'] = () => {
    const f = data.long.accountability.funnels[0];
    const stages = [
      { name: 'Complaints filed', value: f.complaints },
      { name: 'Criminal investigations opened', value: f.investigations },
      { name: 'Indictments', value: f.indictments },
    ];
    return Object.assign({}, base, {
      legend: Object.assign({}, base.legend, { data: stages.map((s) => s.name) }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => `<b>${t.name}</b><br>${fmt(t.value)} of ${fmt(f.complaints)}<br>` +
          `<b>${Math.round(1000 * t.value / f.complaints) / 10}%</b> of complaints`,
      }),
      series: [{
        type: 'funnel', left: '8%', right: '8%', top: 46, bottom: 16,
        minSize: '6%', sort: 'descending', gap: 4,
        label: { position: 'inside', color: '#0b0f18', fontSize: 12.5, fontWeight: 600, formatter: (t) => `${fmt(t.value)}  (${Math.round(1000 * t.value / f.complaints) / 10}%)` },
        itemStyle: { borderWidth: 0 },
        color: [C.blue, C.amber, C.red],
        data: stages,
      }],
    });
  };

  /* Demolition and displacement, 1948 to now. Log scale. */
  R['dispossession'] = () => {
    const d = data.long.dispossession;
    const rows = d.demolitions.map((x) => Object.assign({ kind: 'Demolition' }, x))
      .concat(d.displacement.map((x) => Object.assign({ kind: 'Displacement' }, x)))
      .sort((a, b) => a.value - b.value);
    return Object.assign({}, base, {
      grid: { left: 214, right: 96, top: 20, bottom: 48 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = rows[t.dataIndex];
          return `<b>${x.label}</b><br>${x.period} · ${x.kind}<br><b>${fmt(x.value)}${x.suffix || ''}</b><br>` +
            `<span style="opacity:.7;font-size:11.5px">${x.source}</span>`;
        },
      }),
      xAxis: axisY({ type: 'log', min: 1000, name: 'people or structures (log scale)', nameLocation: 'middle', nameGap: 32, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: rows.map((x) => x.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 202, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: rows.map((x) => ({ value: x.value, itemStyle: { color: x.kind === 'Demolition' ? C.amber : C.blue, borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: C.text2, fontSize: 11.5, formatter: (t) => fmt(rows[t.dataIndex].value) + (rows[t.dataIndex].suffix || '') },
      }],
    });
  };

  /* Administrative detainees held at each documented snapshot. */
  R['detention-series'] = () => {
    const s = data.long.detention.series;
    return Object.assign({}, base, {
      grid: { left: 60, right: 24, top: 30, bottom: 52 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const x = s[t[0].dataIndex];
          return `<b>${x.label}</b><br>Held without charge: <b>${fmt(x.value)}${x.suffix || ''}</b><br>` +
            `<span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisX({ data: s.map((x) => x.label), axisLabel: { color: C.muted, fontSize: 11, interval: 0 } }),
      yAxis: axisY({ name: 'administrative detainees', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 54, data: s.map((x) => x.value),
        itemStyle: { color: fade('rgb(155,127,212)', 0.92, 0.28), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: C.text2, fontSize: 11.5, formatter: (t) => fmt(t.value) + (s[t.dataIndex].suffix || '') },
      }],
    });
  };

  /* ---- heat maps ---- */

  /* Every day of the war on a calendar. The published series is cumulative,
     so the daily figure is the increase on the day before; a flat day means
     the Ministry of Health published no update, not that nobody was killed. */
  R['calendar-heat'] = () => {
    const d = data.ts.daily.gaza;
    const cells = [];
    let peak = 0;
    for (let i = 1; i < d.dates.length; i++) {
      const v = Math.max(0, d.killed[i] - d.killed[i - 1]);
      if (v > peak) peak = v;
      cells.push([d.dates[i], v]);
    }
    const years = [];
    for (let y = +d.dates[0].slice(0, 4); y <= +d.dates[d.dates.length - 1].slice(0, 4); y++) years.push(String(y));
    const top = 58, gap = 132;
    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${dayLabel(t.value[0])}</b><br>Reported killed that day: <b>${fmt(t.value[1])}</b>`,
      }),
      visualMap: {
        min: 0, max: Math.min(peak, 600), calculable: true, orient: 'horizontal',
        left: 'center', top: 8, itemWidth: 12, itemHeight: 120,
        textStyle: { color: C.muted, fontSize: 11 },
        text: ['600+ killed in a day', 'none reported'],
        inRange: { color: [C.ink(.06), hexToRgba(C.amber, .55), C.red, '#7a1f1c'] },
      },
      calendar: years.map((y, i) => ({
        top: top + i * gap, left: 62, right: 26, cellSize: ['auto', 15], range: y,
        splitLine: { show: false },
        itemStyle: { color: C.ink(.02), borderColor: C.ink(.06), borderWidth: 1 },
        yearLabel: { show: true, color: C.text2, fontSize: 13, margin: 34 },
        monthLabel: { color: C.muted, fontSize: 10.5 },
        dayLabel: { color: C.muted, fontSize: 9.5, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
      })),
      series: years.map((y, i) => ({
        type: 'heatmap', coordinateSystem: 'calendar', calendarIndex: i,
        data: cells.filter((c) => c[0].slice(0, 4) === y),
      })),
    });
  };

  /* Month by category. Each row is scaled to its own worst month, so a
     row is readable against itself rather than drowned by the death toll. */
  R['harm-heat'] = () => {
    const g = data.ts.gaza;
    const rows = [
      { key: 'monthly_killed', name: 'Killed' },
      { key: 'monthly_children', name: 'Children killed' },
      { key: 'monthly_women', name: 'Women killed' },
      { key: 'monthly_injured', name: 'Injured' },
      { key: 'monthly_medical', name: 'Medical workers killed' },
      { key: 'monthly_press', name: 'Journalists killed' },
      { key: 'monthly_aid_seekers', name: 'Killed seeking aid' },
      { key: 'monthly_massacres', name: 'Massacres recorded' },
    ].filter((r) => g[r.key]);
    const months = g.monthly_killed.months;
    const cells = [];
    rows.forEach((r, y) => {
      const v = g[r.key].values;
      const max = Math.max.apply(null, v) || 1;
      months.forEach((m, x) => {
        const raw = v[x] || 0;
        cells.push({ value: [x, y, Math.round(1000 * raw / max) / 10], raw: raw });
      });
    });
    return Object.assign({}, base, {
      grid: { left: 168, right: 24, top: 58, bottom: 74 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${rows[t.value[1]].name}</b><br>${monthLabel(months[t.value[0]])}<br>` +
          `<b>${fmt(t.data.raw)}</b><br><span style="opacity:.7;font-size:11.5px">${t.value[2]}% of this row's worst month</span>`,
      }),
      visualMap: {
        min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', top: 8,
        itemWidth: 12, itemHeight: 150, textStyle: { color: C.muted, fontSize: 11 },
        text: ['worst month for this category', 'none'],
        inRange: { color: [C.ink(.05), hexToRgba(C.blue, .4), C.amber, C.red] },
      },
      xAxis: axisX({ data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, rotate: 60, interval: 1 }, splitArea: { show: false } }),
      yAxis: axisX({ data: rows.map((r) => r.name), inverse: true, axisLabel: { color: C.text2, fontSize: 11.5, interval: 0 } }),
      series: [{ type: 'heatmap', data: cells, itemStyle: { borderColor: 'rgba(11,15,24,.9)', borderWidth: 1 } }],
    });
  };

  /* ---- where the land went ---- */

  const landColour = (n) =>
    /Area A|Palestinian control|Palestinian and state|Arab state/.test(n) ? C.green
      : /Gaza/.test(n) ? C.violet
        : /under Jordan/.test(n) ? C.muted
          : /Jerusalem/.test(n) ? C.blue
            : /Area B/.test(n) ? C.amber
              : C.red;

  /* Five dates, each bar the whole of Mandatory Palestine. */
  R['land-control'] = () => {
    const rows = data.long.land.control;
    const depth = Math.max.apply(null, rows.map((r) => r.segments.length));
    return Object.assign({}, base, {
      grid: { left: 96, right: 30, top: 20, bottom: 40 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const r = rows[t[0].dataIndex];
          return `<b>${r.label}</b> — ${r.sub}<br>` +
            r.segments.map((s) => `<span style="color:${landColour(s.name)}">■</span> ${s.name}: <b>${s.value}%</b>`).join('<br>') +
            `<br><span style="opacity:.7;font-size:11.5px">${r.note}</span>`;
        },
      }),
      xAxis: axisY({ max: 100, axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + '%' } }),
      yAxis: axisX({
        data: rows.map((r) => r.label), inverse: true,
        axisLabel: { color: C.text, fontSize: 13, fontWeight: 600, interval: 0 },
      }),
      series: Array.from({ length: depth }, (unused, k) => ({
        name: 'seg' + k, type: 'bar', stack: 'land', barMaxWidth: 46,
        data: rows.map((r) => {
          const s = r.segments[k];
          return s ? { value: s.value, name: s.name, itemStyle: { color: hexToRgba(landColour(s.name), 0.82), borderColor: 'rgba(11,15,24,.85)', borderWidth: 1 } } : 0;
        }),
        label: {
          show: true, color: '#0b0f18', fontSize: 10.5, fontWeight: 600,
          formatter: (t) => (t.data && t.data.value >= 6 ? t.data.value + '%' : ''),
        },
      })),
    });
  };

  /* Oslo II, thirty-one years on: what share of the West Bank is under whose control. */
  R['land-areas'] = () => {
    const a = data.long.land.areas;
    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = a[t.dataIndex];
          return `<b>${x.label}</b> — ${x.value}% of the West Bank<br>${x.control}<br>` +
            `<span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      series: [{
        type: 'pie', radius: ['42%', '72%'], center: ['50%', '54%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#0b0f18', borderWidth: 2 },
        label: { color: C.text2, fontSize: 11.5, formatter: '{b}\n{c}%' },
        labelLine: { lineStyle: { color: C.ink(.22) } },
        data: a.map((x) => ({
          name: x.label, value: x.value,
          itemStyle: { color: x.label === 'Area A' ? C.green : x.label === 'Area B' ? C.amber : C.red },
        })),
      }],
    });
  };

  /* ---- the complicity ledger ---- */

  /* Who supplies the weapons. */
  R['arms-suppliers'] = () => {
    const s = data.long.complicity.suppliers;
    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = s.items[t.dataIndex];
          return `<b>${x.country}</b><br><b>${x.share}%</b> of Israel's major arms imports, ${s.period}<br>` +
            `<span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      series: [{
        type: 'pie', radius: ['40%', '70%'], center: ['50%', '52%'], startAngle: 90,
        itemStyle: { borderColor: '#0b0f18', borderWidth: 2 },
        label: { color: C.text2, fontSize: 12, formatter: '{b}\n{c}%' },
        labelLine: { lineStyle: { color: C.ink(.22) } },
        data: s.items.map((x, i) => ({ name: x.country, value: x.share, itemStyle: { color: [C.red, C.amber, C.blue][i] || C.muted } })),
      }],
    });
  };

  /* Cumulative United States aid, at each published total. */
  R['us-aid'] = () => {
    const c = data.long.complicity.us_aid.cumulative;
    return Object.assign({}, base, {
      grid: { left: 236, right: 84, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = c[t.dataIndex];
          return `<b>${x.label}</b><br><b>$${x.value} billion</b><br><span style="opacity:.7;font-size:11.5px">${x.source}</span>`;
        },
      }),
      xAxis: axisY({ name: 'US dollars, billions', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: c.map((x) => x.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 224, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 24,
        data: c.map((x, i) => ({ value: x.value, itemStyle: { color: i === c.length - 1 ? C.amber : C.red, borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: C.text2, fontSize: 12, fontWeight: 600, formatter: (t) => '$' + t.value + 'bn' },
      }],
    });
  };

  /* The annual flows and the war supplementals. */
  R['us-aid-flows'] = () => {
    const f = data.long.complicity.us_aid.flows;
    return Object.assign({}, base, {
      grid: { left: 56, right: 24, top: 24, bottom: 92 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const x = f[t[0].dataIndex];
          return `<b>${x.label}</b><br><b>$${x.value} billion</b>` +
            (x.note ? `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>` : '') +
            (x.source ? `<br><span style="opacity:.7;font-size:11.5px">${x.source}</span>` : '');
        },
      }),
      xAxis: axisX({ data: f.map((x) => x.label), axisLabel: { color: C.muted, fontSize: 10.5, rotate: 24, interval: 0, width: 130, overflow: 'break' } }),
      yAxis: axisY({ name: 'US dollars, billions', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 56, data: f.map((x) => x.value),
        itemStyle: { color: fade('rgb(217,164,65)', 0.92, 0.26), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: C.text2, fontSize: 12, formatter: (t) => '$' + t.value + 'bn' },
      }],
    });
  };

  /* German export licences by year, from the ministry's own answer to a
     parliamentary question. The embargo year is marked on the axis rather
     than shaded: it ran for fifteen weeks inside a single category. */
  R['arms-germany'] = () => {
    const g = data.war.arms.germany;
    const idx = g.items.findIndex((x) => x.period === '2025');
    return Object.assign({}, base, {
      grid: { left: 60, right: 24, top: 30, bottom: 78 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const x = g.items[t[0].dataIndex];
          return `<b>${x.period}</b><br><b>€${fmt(x.value)} million</b>` +
            (x.estimate ? ' <span style="opacity:.75">(derived)</span>' : '') +
            (x.partial ? ' <span style="opacity:.75">(half year)</span>' : '') +
            `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisX({
        data: g.items.map((x) => x.period),
        axisLabel: { color: C.muted, fontSize: 11, interval: 0, width: 88, overflow: 'break', lineHeight: 14 },
      }),
      yAxis: axisY({ name: 'licences approved, € millions', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 58,
        data: g.items.map((x) => ({
          value: x.value,
          itemStyle: {
            color: x.estimate ? hexToRgba(C.muted, 0.42) : fade(x.partial ? 'rgb(210,83,76)' : 'rgb(217,164,65)', 0.92, 0.26),
            borderRadius: [3, 3, 0, 0],
            borderColor: x.estimate ? hexToRgba(C.muted, 0.8) : 'transparent',
            borderWidth: x.estimate ? 1 : 0,
            borderType: x.estimate ? 'dashed' : 'solid',
          },
        })),
        label: { show: true, position: 'top', color: C.text2, fontSize: 11.5, formatter: (t) => '€' + fmt(t.value) + 'm' },
        markLine: idx < 0 ? undefined : {
          symbol: 'none', silent: true,
          lineStyle: { color: C.green, type: 'dashed', width: 1.4 },
          /* A markLine on a category axis is drawn vertically, and its label
             rotates to follow the line unless told otherwise. */
          label: {
            formatter: 'Partial embargo\nAug–Nov 2025',
            color: C.green, fontSize: 10, lineHeight: 13,
            position: 'end', rotate: 0, align: 'center', distance: 6,
          },
          data: [{ xAxis: idx }],
        },
      }],
    });
  };

  /* American authorisations since October 2023. The bars are separate
     announcements that overlap in scope, so the two published totals are
     drawn as reference lines rather than as a summing bar. */
  R['arms-us'] = () => {
    const u = data.war.arms.us;
    const rows = u.items.slice().sort((a, b) => a.value - b.value);
    const tint = { Biden: C.blue, Trump: C.red, standing: C.muted };
    return Object.assign({}, base, {
      grid: { left: 250, right: 96, top: 20, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = rows[t.dataIndex];
          return `<b>${x.label}</b><br><b>$${x.value} billion</b><br>` +
            `<span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisY({ name: 'US dollars, billions', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: rows.map((x) => x.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 238, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: rows.map((x) => ({ value: x.value, itemStyle: { color: hexToRgba(tint[x.admin] || C.muted, 0.85), borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: C.text2, fontSize: 12, fontWeight: 600, formatter: (t) => '$' + t.value + 'bn' },
        /* The two published totals, drawn vertically. The label is pinned
           horizontal and to the top, clear of the bars it crosses. */
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: C.amber, type: 'dashed', width: 1.3 },
          label: { color: C.amber, fontSize: 10, lineHeight: 13, position: 'end', rotate: 0, align: 'center', distance: 6 },
          data: u.totals.map((x, i) => ({
            xAxis: x.value,
            label: { formatter: `$${x.value}bn\n${i === 0 ? 'enacted' : 'all-in'}` },
          })),
        },
      }],
    });
  };

  /* The UK's September 2024 licence review, as a proportion of the licences
     it was reviewing. */
  R['arms-uk'] = () => {
    const l = data.war.arms.uk.licences;
    const row = ['Standing export licences, ' + l.date];
    const pct = (n) => Math.round((n / l.total) * 1000) / 10;
    /* The suspended segment is 8.6% of the bar and cannot hold its own
       label, so that one is set above the bar rather than inside it. */
    const seg = (name, value, colour, radius, inside) => ({
      name, type: 'bar', stack: 'licences', barMaxWidth: 54,
      data: [value],
      itemStyle: { color: hexToRgba(colour, 0.85), borderRadius: radius },
      label: {
        show: true, position: inside ? 'inside' : 'top',
        color: inside ? '#0b0f18' : C.text2, fontSize: 12, fontWeight: 600,
        formatter: `${value} — ${pct(value)}%`,
      },
    });
    return Object.assign({}, base, {
      grid: { left: 210, right: 30, top: 34, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Suspended', 'Left in force'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => `<b>${t.seriesName}: ${fmt(t.value)}</b> of ${l.total} licences<br>` +
          `<span style="opacity:.7;font-size:11.5px">${l.note}</span>`,
      }),
      xAxis: axisY({ name: 'export licences', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: row, axisLabel: { color: C.text2, fontSize: 11.5, width: 200, overflow: 'break', lineHeight: 14, interval: 0 } }),
      series: [
        seg('Suspended', l.suspended, C.green, [3, 0, 0, 3], false),
        seg('Left in force', l.in_force, C.red, [0, 3, 3, 0], true),
      ],
    });
  };

  /* Lebanon, episode by episode. Log scale: the range runs from 42 to 4,321
     and a linear axis would flatten everything below the 2026 campaign. */
  R['lebanon-toll'] = () => {
    const e = data.war.lebanon.episodes;
    return Object.assign({}, base, {
      grid: { left: 190, right: 96, top: 34, bottom: 52 },
      legend: Object.assign({}, base.legend, { data: ['Killed', 'Injured'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = e[t[0].dataIndex];
          return `<b>${x.label}</b><br>${x.date}<br>` +
            `Killed: <b>${x.display || fmt(x.killed)}</b>` +
            (x.injured ? `<br>Injured: <b>${fmt(x.injured)}</b>` : '') +
            (x.displaced ? `<br>Displaced: <b>${fmt(x.displaced)}</b>` : '') +
            `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: Object.assign(axisY({
        type: 'log', min: 10, name: 'people (log scale)', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      })),
      yAxis: axisX({
        data: e.map((x) => x.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 178, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [
        {
          name: 'Killed', type: 'bar', barMaxWidth: 15,
          data: e.map((x) => x.killed),
          itemStyle: { color: hexToRgba(C.red, 0.88), borderRadius: [0, 3, 3, 0] },
          label: {
            show: true, position: 'right', color: C.text2, fontSize: 11.5, fontWeight: 600,
            formatter: (t) => e[t.dataIndex].display || fmt(t.value),
          },
        },
        {
          name: 'Injured', type: 'bar', barMaxWidth: 15,
          data: e.map((x) => x.injured || null),
          itemStyle: { color: hexToRgba(C.amber, 0.72), borderRadius: [0, 3, 3, 0] },
        },
      ],
    });
  };

  /* Operations on other states' territory, plotted on one time axis. The
     slider is there because sixteen of the eighteen events fall in the last
     three years of a sixty-year span. */
  R['regional-ops'] = () => {
    const g = data.war.regional;
    const tint = { Lebanon: C.red, Syria: C.amber, Yemen: C.violet, Iran: C.blue };
    const size = (k) => (k ? Math.max(11, Math.min(50, 8 + Math.sqrt(k) * 0.85)) : 9);
    return Object.assign({}, base, {
      grid: { left: 82, right: 34, top: 34, bottom: 84 },
      legend: Object.assign({}, base.legend, { data: g.states }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = t.data.ev;
          return `<b>${x.label}</b><br>${x.state} — ${x.date}<br>` +
            (x.killed ? `Killed: <b>${fmt(x.killed)}</b>${x.estimate ? ' <span style="opacity:.75">(estimate)</span>' : ''}<br>` : '') +
            (x.actor ? `<span style="color:${C.amber}">Strike attributed to: ${x.actor}</span><br>` : '') +
            `<span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisY({
        min: 1965, max: 2028, interval: 5,
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => String(Math.round(v)) },
        splitLine: { lineStyle: { color: C.line } },
      }),
      yAxis: axisX({
        data: g.states, inverse: true,
        axisLabel: { color: C.text2, fontSize: 12, interval: 0 },
        splitLine: { show: true, lineStyle: { color: C.line } },
      }),
      dataZoom: [{
        type: 'slider', xAxisIndex: 0, bottom: 18, height: 20,
        borderColor: C.ink(.14), fillerColor: 'rgba(86,168,224,.16)',
        handleStyle: { color: C.blue }, textStyle: { color: C.muted, fontSize: 10 },
        labelFormatter: (v) => String(Math.round(v)),
      }],
      series: g.states.map((st) => ({
        name: st, type: 'scatter',
        // The per-item colours below do not reach the legend; the series
        // colour does, and without it the key names the wrong states.
        color: tint[st] || C.muted,
        data: g.events.filter((x) => x.state === st).map((x) => ({
          value: [x.year, st],
          ev: x,
          symbol: x.actor ? 'diamond' : 'circle',
          symbolSize: size(x.killed),
          itemStyle: {
            color: hexToRgba(tint[st] || C.muted, x.killed ? 0.72 : 0.22),
            borderColor: tint[st] || C.muted,
            borderWidth: x.killed ? 0 : 1.4,
          },
        })),
      })),
    });
  };

  /* ---- the conduct record ---- */

  /* Aid against the requirement. The zero bar is the point: it draws nothing,
     and its label sits on the axis where the reader can see that nothing is
     what crossed. */
  R['aid-trucks'] = () => {
    const it = data.conduct.aid.items;
    const tint = { requirement: C.blue, blockade: C.red, actual: C.amber };
    return Object.assign({}, base, {
      grid: { left: 224, right: 96, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it[t.dataIndex];
          return `<b>${x.label}</b>: ${x.display || fmt(x.value)} trucks a day` +
            `<br><span style="opacity:.7;font-size:11.5px">${x.detail}</span>`;
        },
      }),
      xAxis: axisY({
        max: 520, name: 'trucks a day', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 214, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: { color: hexToRgba(tint[x.kind] || C.muted, x.kind === 'requirement' ? 0.4 : 0.85), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (t) => it.slice().reverse()[t.dataIndex].display || fmt(t.value),
        },
        markLine: {
          silent: true, symbol: 'none',
          data: [{ xAxis: data.conduct.aid.baseline.value }],
          lineStyle: { color: hexToRgba(C.blue, 0.55), type: 'dashed', width: 1.4 },
          label: { show: false },
        },
      }],
    });
  };

  /* Every malnutrition caseload the IPC tracks, before and after. */
  R['hunger-risk'] = () => {
    const it = data.conduct.hunger.items;
    return Object.assign({}, base, {
      grid: { left: 250, right: 88, top: 42, bottom: 40 },
      legend: Object.assign({}, base.legend, { data: ['May 2025 assessment', 'Projected through mid-2026'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = it.slice().reverse()[t[0].dataIndex];
          return `<b>${x.group}</b><br>` +
            `${x.from_label}: <b>${fmt(x.from)}</b><br>${x.to_label}: <b>${fmt(x.to)}</b><br>` +
            `<span style="color:${C.amber}">${x.factor}</span>` +
            (x.note ? `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>` : '');
        },
      }),
      xAxis: axisY({ name: 'people', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: it.map((x) => x.group).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 238, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [
        {
          /* The per-item colours below do not reach the legend; the series colour
             does, and without it the key swatch is the wrong colour. */
          name: 'May 2025 assessment', type: 'bar', barMaxWidth: 15, color: C.amber,
          data: it.slice().reverse().map((x) => ({
            value: x.from,
            itemStyle: {
              color: hexToRgba(C.amber, 0.7), borderRadius: [0, 3, 3, 0],
              borderColor: x.estimate ? C.amber : 'transparent', borderWidth: x.estimate ? 1 : 0, borderType: 'dashed',
            },
          })),
          label: { show: true, position: 'right', color: C.text2, fontSize: 11.5, formatter: (t) => fmt(t.value) },
        },
        {
          name: 'Projected through mid-2026', type: 'bar', barMaxWidth: 15,
          data: it.map((x) => x.to).reverse(),
          itemStyle: { color: hexToRgba(C.red, 0.88), borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (t) => fmt(t.value) },
        },
      ],
    });
  };

  /* Appendix E, drawn as proportions of what existed. */
  R['gaza-remains'] = () => {
    const it = data.conduct.remains.items.slice().sort((a, b) => b.destroyed - a.destroyed);
    return Object.assign({}, base, {
      grid: { left: 232, right: 72, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.label}</b>: ${x.approx ? 'about ' : ''}${x.destroyed}% destroyed or damaged` +
            (x.detail ? `<br><span style="opacity:.7;font-size:11.5px">${x.detail}</span>` : '');
        },
      }),
      xAxis: axisY({
        max: 100, name: '% destroyed or damaged', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + '%' },
      }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 222, overflow: 'break', interval: 0 },
      }),
      series: [
        {
          type: 'bar', stack: 'all', barMaxWidth: 18,
          data: it.map((x) => x.destroyed).reverse(),
          itemStyle: { color: (t) => hexToRgba(C.red, 0.45 + 0.005 * t.value) },
          label: {
            show: true, position: 'insideLeft', color: C.text, fontSize: 11.5, fontWeight: 600,
            formatter: (t) => (it.slice().reverse()[t.dataIndex].approx ? '~' : '') + t.value + '%',
          },
        },
        {
          type: 'bar', stack: 'all', barMaxWidth: 18, silent: true,
          data: it.map((x) => 100 - x.destroyed).reverse(),
          itemStyle: { color: C.ink(.06), borderRadius: [0, 3, 3, 0] },
        },
      ],
    });
  };

  /* The targeting systems, counted in people. The twenty-second review and
     the three system names sit in the tooltip and the card note; what is
     plotted is the only thing the four rows share, which is human beings. */
  R['ai-targeting'] = () => {
    const t = data.conduct.targeting;
    const it = [
      { label: 'Palestinian men placed on Lavender kill lists', value: t.systems[0].value, note: t.systems[0].detail, tone: C.red },
      { label: 'Of them, listed in error at the system’s known 10% error rate', value: t.error_rate.implied, note: t.error_rate.note, tone: C.amber, estimate: true },
      { label: 'Civilian deaths authorised for one senior commander', value: t.thresholds[1].high, display: t.thresholds[1].display, note: t.thresholds[1].detail, tone: C.violet },
      { label: 'Civilian deaths authorised for one junior operative', value: t.thresholds[0].high, display: t.thresholds[0].display, note: t.thresholds[0].detail, tone: C.blue },
    ];
    return Object.assign({}, base, {
      grid: { left: 250, right: 92, top: 16, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const x = it.slice().reverse()[p.dataIndex];
          return `<b>${x.label}</b>: ${x.display || fmt(x.value)} people` +
            (x.estimate ? ' <span style="opacity:.75">(derived)</span>' : '') +
            `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisY({
        type: 'log', min: 10, name: 'people (log scale)', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 238, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: {
            color: hexToRgba(x.tone, x.estimate ? 0.45 : 0.85), borderRadius: [0, 4, 4, 0],
            borderColor: x.estimate ? x.tone : 'transparent', borderWidth: x.estimate ? 1 : 0, borderType: 'dashed',
          },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (p) => it.slice().reverse()[p.dataIndex].display || fmt(p.value),
        },
      }],
    });
  };

  /* Who investigated human shields, and what each of them found. */
  R['shields-matrix'] = () => {
    const s = data.conduct.shields;
    const cells = [];
    s.rows.forEach((r, y) => {
      s.columns.forEach((c, x) => {
        const st = r[c.key];
        cells.push({ value: [x, y, s.states[st].value], st: st, row: r, col: c });
      });
    });
    return Object.assign({}, base, {
      /* The column labels wrap onto a second line, so the bottom margin has to
         hold two lines or the wrapped half is clipped by the card. */
      grid: { left: 264, right: 26, top: 62, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${t.data.row.body}</b><br>${t.data.col.label}: ` +
          `<span style="color:${t.data.st === 'found' ? C.red : t.data.st === 'none' ? C.green : C.muted}">${s.states[t.data.st].label}</span>` +
          `<br><span style="opacity:.7;font-size:11.5px">${t.data.row.detail}</span>`,
      }),
      visualMap: {
        type: 'piecewise', show: true, orient: 'horizontal', left: 'center', top: 6,
        itemWidth: 13, itemHeight: 13, itemGap: 14, textStyle: { color: C.muted, fontSize: 11 },
        pieces: [
          { value: 2, label: s.states.found.label, color: hexToRgba(C.red, 0.8) },
          { value: 1, label: s.states.none.label, color: hexToRgba(C.green, 0.7) },
          { value: 0, label: s.states.na.label, color: C.ink(.07) },
        ],
      },
      xAxis: axisX({
        data: s.columns.map((c) => c.label),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 190, overflow: 'break', lineHeight: 14, interval: 0 },
        splitArea: { show: false },
      }),
      yAxis: axisX({
        data: s.rows.map((r) => r.body), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 252, overflow: 'break', interval: 0 },
        splitArea: { show: false },
      }),
      series: [{
        type: 'heatmap', data: cells,
        itemStyle: { borderColor: 'rgba(11,15,24,.9)', borderWidth: 2 },
        label: {
          show: true, color: C.text, fontSize: 11, fontWeight: 600,
          formatter: (t) => (t.data.st === 'found' ? 'found' : t.data.st === 'none' ? 'no evidence' : ''),
        },
      }],
    });
  };

  /* What Israeli fire did on 7 October. The zero at the bottom is the reason
     every other number on this chart is the whole of the record. */
  R['hannibal'] = () => {
    const it = data.conduct.hannibal.items.slice().sort((a, b) => b.value - a.value);
    return Object.assign({}, base, {
      grid: { left: 250, right: 78, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.label}</b>: ${x.approx ? 'about ' : ''}${fmt(x.value)}` +
            `<br><span style="opacity:.7;font-size:11.5px">${x.detail}</span>`;
        },
      }),
      xAxis: axisY({ name: 'documented count', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 238, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: { color: hexToRgba(x.value === 0 ? C.muted : C.red, x.value === 0 ? 0.5 : 0.85), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (t) => (it.slice().reverse()[t.dataIndex].approx ? '~' : '') + fmt(t.value),
        },
      }],
    });
  };

  /* The money Israel approved, annualised from the documented monthly rate. */
  R['qatar-funding'] = () => {
    const f = data.conduct.funding.transfers;
    /* A year can carry more than one event — 2023 holds both the request to
       Qatar to raise the payments and the warnings that arrived in the same
       month — so the index is a list per year, not one event per year. */
    const ev = {};
    data.conduct.funding.events.forEach((e) => { (ev[e.year] = ev[e.year] || []).push(e); });
    return Object.assign({}, base, {
      grid: { left: 70, right: 26, top: 86, bottom: 40 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        /* The event notes run to several sentences and two of them land on the
           same bar, so the box is capped rather than left to stretch across the
           chart. */
        extraCssText: base.tooltip.extraCssText + 'max-width:min(420px,84vw);white-space:normal;',
        formatter: (t) => {
          const x = f.years[t[0].dataIndex];
          return `<b>${x.year}</b>: $${x.value}m approved` +
            (x.partial ? ` <span style="opacity:.75">(part year)</span>` : '') +
            (x.note ? `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>` : '') +
            (ev[x.year] || []).map((e) => `<br><span style="color:${C.amber}">${e.label}</span>` +
              `<br><span style="opacity:.7;font-size:11.5px">${e.detail}</span>`).join('');
        },
      }),
      xAxis: axisX({ data: f.years.map((x) => x.year), axisLabel: { color: C.text2, fontSize: 12 } }),
      /* The name sits rotated in the gutter: printed above the axis it collides
         with the value label on the first bar. */
      yAxis: axisY({
        name: '$m a year', nameLocation: 'middle', nameGap: 48, nameRotate: 90,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 52,
        data: f.years.map((x) => ({
          value: x.value,
          itemStyle: {
            color: hexToRgba(C.amber, x.partial ? 0.42 : 0.78), borderRadius: [4, 4, 0, 0],
            borderColor: C.amber, borderWidth: 1, borderType: 'dashed',
          },
        })),
        label: { show: true, position: 'top', color: C.text, fontSize: 11.5, formatter: (t) => '$' + t.value + 'm' },
        markPoint: {
          /* Lifted clear of the bar's own value label, which sits just above the bar. */
          symbol: 'pin', symbolSize: 46, symbolOffset: [0, -24],
          data: f.years.map((x, i) => (ev[x.year] ? { coord: [i, x.value], value: '!' } : null)).filter(Boolean),
          itemStyle: { color: hexToRgba(C.red, 0.85) },
          label: { color: '#fff', fontSize: 13, fontWeight: 700 },
        },
      }],
    });
  };

  /* The 2016–2022 cohort, split by what happened after the arrest. */
  R['child-detention'] = () => {
    const c = data.conduct.children.cohort;
    const seg = [
      { name: 'Experienced physical violence after arrest', value: c.violence, tone: C.red },
      { name: 'Did not', value: c.no_violence, tone: C.muted },
    ];
    return Object.assign({}, base, {
      grid: { left: 210, right: 24, top: 52, bottom: 56 },
      legend: Object.assign({}, base.legend, { data: seg.map((s) => s.name) }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (t) => `<b>${fmt(c.total)} children documented, ${c.period}</b><br>` +
          t.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(x.value)}</b> (${Math.round(1000 * x.value / c.total) / 10}%)`).join('<br>') +
          `<br><span style="opacity:.7;font-size:11.5px">${c.note}</span>`,
      }),
      xAxis: axisY({ max: c.total, show: false }),
      yAxis: axisX({
        data: [`${fmt(c.total)} children, ${c.period}`],
        axisLabel: { color: C.text2, fontSize: 12, width: 200, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: seg.map((s, i) => ({
        name: s.name, type: 'bar', stack: 'cohort', barMaxWidth: 74,
        data: [s.value],
        itemStyle: { color: hexToRgba(s.tone, i ? 0.34 : 0.85), borderRadius: i ? [0, 5, 5, 0] : [5, 0, 0, 5] },
        label: {
          show: true, position: i ? 'insideRight' : 'insideLeft', color: C.text, fontSize: 12, fontWeight: 600,
          formatter: () => `${fmt(s.value)} — ${Math.round(1000 * s.value / c.total) / 10}%`,
        },
      })),
    });
  };

  /* Every count is a floor set by a different body on a different date. The
     last bar is not a death toll: it is the number of people charged. */
  R['custody-deaths'] = () => {
    const p = data.conduct.custody.prosecution;
    const it = data.conduct.custody.counts.map((x) => ({
      label: `${x.label} — ${x.source}`,
      value: x.value, atleast: x.atleast, tone: C.red,
      note: `${x.period}. ${x.note || ''}`.trim(),
    })).concat([{
      label: `Prison guards indicted over a death in custody — ${p.date}`,
      value: p.indicted, tone: C.amber,
      note: `${p.case}. ${p.questioned} were questioned; ${p.indicted} were charged. ${p.note}`,
    }]);
    return Object.assign({}, base, {
      grid: { left: 262, right: 78, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.label}</b>: ${x.atleast ? 'at least ' : ''}${fmt(x.value)} people` +
            `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisY({ name: 'people', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 250, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: { color: hexToRgba(x.tone, 0.85), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (t) => {
            const x = it.slice().reverse()[t.dataIndex];
            return (x.atleast ? '≥' : '') + fmt(x.value);
          },
        },
      }],
    });
  };

  /* One state holds the arsenal; the other was bombed over not having one. */
  R['nuclear-npt'] = () => {
    const n = data.conduct.nuclear;
    const tone = { exempt: 2, constrained: 0, unknown: 1 };
    const cells = [];
    n.rows.forEach((r, y) => {
      n.columns.forEach((c, x) => {
        cells.push({ value: [x, y, tone[r[c.key + '_state']]], row: r, col: c, text: r[c.key] });
      });
    });
    return Object.assign({}, base, {
      grid: { left: 250, right: 26, top: 56, bottom: 30 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${t.data.col.label} — ${t.data.row.label}</b><br><b>${t.data.text}</b>` +
          `<br><span style="opacity:.7;font-size:11.5px">${t.data.row.detail}</span>`,
      }),
      visualMap: {
        type: 'piecewise', show: true, orient: 'horizontal', left: 'center', top: 6,
        itemWidth: 13, itemHeight: 13, itemGap: 14, textStyle: { color: C.muted, fontSize: 11 },
        pieces: [
          { value: 2, label: 'Outside the regime, unconstrained', color: hexToRgba(C.red, 0.72) },
          { value: 0, label: 'Inside the regime, constrained', color: hexToRgba(C.blue, 0.55) },
          { value: 1, label: 'Not stated in this record', color: C.ink(.07) },
        ],
      },
      xAxis: axisX({
        data: n.columns.map((c) => c.label),
        axisLabel: { color: C.text, fontSize: 13, fontWeight: 600, interval: 0 },
        splitArea: { show: false },
      }),
      yAxis: axisX({
        data: n.rows.map((r) => r.label), inverse: true,
        axisLabel: { color: C.text2, fontSize: 11.5, width: 238, overflow: 'break', interval: 0 },
        splitArea: { show: false },
      }),
      series: [{
        type: 'heatmap', data: cells,
        itemStyle: { borderColor: 'rgba(11,15,24,.9)', borderWidth: 2 },
        label: { show: true, color: C.text, fontSize: 12, fontWeight: 600, formatter: (t) => t.data.text },
      }],
    });
  };

  /* Who gets named as the perpetrator, and who does not. */
  R['media-attribution'] = () => {
    const it = data.conduct.media.attribution;
    return Object.assign({}, base, {
      grid: { left: 110, right: 78, top: 40, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.outlet}</b>: ${x.approx ? 'about ' : ''}${x.value}%` +
            `<br><span style="opacity:.7;font-size:11.5px">${x.label}</span>`;
        },
      }),
      xAxis: axisY({
        max: 60, name: '% of reports of Palestinian casualties that do not name Israel',
        nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 },
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + '%' },
      }),
      yAxis: axisX({ data: it.map((x) => x.outlet).reverse(), axisLabel: { color: C.text, fontSize: 13, interval: 0 } }),
      series: [{
        type: 'bar', barMaxWidth: 42,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: { color: hexToRgba(x.value > 30 ? C.red : C.green, 0.82), borderRadius: [0, 5, 5, 0] },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 13, fontWeight: 600,
          formatter: (t) => (it.slice().reverse()[t.dataIndex].approx ? '~' : '') + t.value + '%',
        },
      }],
    });
  };

  /* The same events, two vocabularies. */
  R['media-framing'] = () => {
    const it = data.conduct.media.words;
    return Object.assign({}, base, {
      grid: { left: 268, right: 74, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.label}</b>: ${x.atleast ? 'at least ' : ''}${fmt(x.value)}`;
        },
      }),
      xAxis: axisY({ name: 'occurrences', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 256, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: it.slice().reverse().map((x) => ({
          value: x.value,
          itemStyle: { color: hexToRgba(x.tone === 'israeli' ? C.blue : C.red, x.value === 0 ? 0.4 : 0.82), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (t) => (it.slice().reverse()[t.dataIndex].atleast ? '≥' : '') + fmt(t.value),
        },
      }],
    });
  };

  /* What the coverage cost the outlets that produced it. */
  R['media-trust'] = () => {
    const it = data.conduct.media.trust;
    return Object.assign({}, base, {
      grid: { left: 254, right: 74, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it.slice().reverse()[t.dataIndex];
          return `<b>${x.label}</b>: ${x.value}%` + (x.note ? `<br><span style="opacity:.7;font-size:11.5px">${x.note}</span>` : '');
        },
      }),
      xAxis: axisY({
        max: 60, name: '% of respondents', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + '%' },
      }),
      yAxis: axisX({
        data: it.map((x) => x.label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 242, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: it.map((x) => x.value).reverse(),
        itemStyle: { color: fade('rgb(86,168,224)', 0.85, 0.35), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: C.text, fontSize: 12, fontWeight: 600, formatter: (t) => t.value + '%' },
      }],
    });
  };

  /* The step counts states, not the weight of what they did, and it only
     counts the measures the record dates. Both limits understate it. */
  R['measures-step'] = () => {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    /* Dates arrive as "May 2024", "11 May 2026" or "October 2023, formalised
       September 2025". The first month-year in the string is the one that
       counts: a state acted when it first acted. */
    const parse = (s) => {
      const m = /([A-Z][a-z]+)\s+(\d{4})/.exec(String(s || ''));
      if (!m || MONTHS.indexOf(m[1]) < 0) return null;
      return { t: Number(m[2]) * 12 + MONTHS.indexOf(m[1]), label: m[1] + ' ' + m[2] };
    };
    const first = {};
    const record = (country, date, what) => {
      const d = parse(date);
      if (!d) return;
      if (!first[country] || d.t < first[country].t) first[country] = { t: d.t, label: d.label, what: what };
    };
    data.long.complicity.embargo.countries
      .filter((c) => c.status === 'halted' || c.status === 'partial')
      .forEach((c) => record(c.country, c.date, (c.status === 'halted' ? 'arms transfers halted' : 'arms transfers partially restricted')));
    (data.positions.sanctions.measures || []).forEach((m) => {
      (m.countries || []).forEach((c) => record(c.name, m.date, m.label));
    });

    const entries = Object.keys(first).map((k) => Object.assign({ country: k }, first[k])).sort((a, b) => a.t - b.t);
    const steps = [];
    entries.forEach((e, i) => {
      const last = steps[steps.length - 1];
      if (last && last.t === e.t) { last.n = i + 1; last.states.push(e); } else {
        steps.push({ t: e.t, label: e.label, n: i + 1, states: [e] });
      }
    });
    const stamp = (t) => MONTHS[t % 12].slice(0, 3) + ' ' + Math.floor(t / 12);
    return Object.assign({}, base, {
      grid: { left: 58, right: 30, top: 34, bottom: 48 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (p) => {
          const s = steps[p[0].dataIndex];
          return `<b>${s.label}</b><br>States having taken at least one measure: <b>${s.n}</b><br>` +
            s.states.map((x) => `<span style="color:${C.green}">+ ${x.country}</span> <span style="opacity:.7;font-size:11.5px">— ${x.what}</span>`).join('<br>');
        },
      }),
      xAxis: axisX({
        data: steps.map((s) => stamp(s.t)),
        axisLabel: { color: C.muted, fontSize: 11, rotate: 40, interval: 0 },
      }),
      yAxis: axisY({ name: 'states', nameTextStyle: { color: C.muted, fontSize: 11 }, minInterval: 1 }),
      series: [{
        type: 'line', step: 'end', symbol: 'circle', symbolSize: 7, smooth: false,
        data: steps.map((s) => s.n),
        lineStyle: { color: C.green, width: 2.4 },
        itemStyle: { color: C.green },
        areaStyle: { color: areaFill('rgb(79,174,130)') },
        label: { show: true, position: 'top', color: C.text2, fontSize: 11 },
      }],
    });
  };

  /* The series Britain discusses, and the series it does not, on one axis. */
  R['hate-series'] = () => {
    const it = data.conduct.hate.series;
    return Object.assign({}, base, {
      grid: { left: 66, right: 26, top: 46, bottom: 40 },
      legend: Object.assign({}, base.legend, { data: ['Antisemitic incidents (CST)', 'Anti-Muslim incidents (Tell MAMA)'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const x = it[p[0].dataIndex];
          return `<b>${x.year}</b><br>` +
            p.filter((y) => y.value !== null && y.value !== undefined)
              .map((y) => `${y.marker} ${y.seriesName}: <b>${fmt(y.value)}</b>`).join('<br>') +
            (x.tellmama_estimate ? `<br><span style="color:${C.amber}">${data.conduct.hate.estimate_note}</span>` : '') +
            (x.tellmama === null ? `<br><span style="opacity:.7;font-size:11.5px">Tell MAMA publishes an annual report, not a continuous series; no figure is carried for this year.</span>` : '');
        },
      }),
      xAxis: axisX({ data: it.map((x) => x.year), axisLabel: { color: C.text2, fontSize: 12 } }),
      /* Rotated into the gutter: printed above the axis it sits under the legend. */
      yAxis: axisY({
        name: 'incidents recorded', nameLocation: 'middle', nameGap: 44, nameRotate: 90,
        nameTextStyle: { color: C.muted, fontSize: 11 },
      }),
      series: [
        {
          name: 'Antisemitic incidents (CST)', type: 'bar', barMaxWidth: 34,
          // The per-item colours below do not reach the legend; the series
          // colour does, and without it the key names the wrong series.
          color: C.blue,
          data: it.map((x) => x.cst),
          itemStyle: { color: hexToRgba(C.blue, 0.8), borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', color: C.text2, fontSize: 11, formatter: (t) => fmt(t.value) },
        },
        {
          name: 'Anti-Muslim incidents (Tell MAMA)', type: 'bar', barMaxWidth: 34,
          color: C.green,
          data: it.map((x) => ({
            value: x.tellmama,
            itemStyle: {
              color: hexToRgba(C.green, x.tellmama_estimate ? 0.3 : 0.8), borderRadius: [4, 4, 0, 0],
              borderColor: x.tellmama_estimate ? C.green : 'transparent',
              borderWidth: x.tellmama_estimate ? 1.4 : 0, borderType: 'dashed',
            },
          })),
          label: {
            show: true, position: 'top', color: C.text2, fontSize: 11,
            formatter: (t) => (t.value === null || t.value === undefined ? '' : fmt(t.value) + (it[t.dataIndex].tellmama_estimate ? ' (derived)' : '')),
          },
        },
      ],
    });
  };

  /* Who has stopped supplying and who has not. */
  R['embargo-tracker'] = () => {
    const score = { halted: 3, partial: 2, continuing: 1 };
    const tint = { halted: C.green, partial: C.amber, continuing: C.red };
    const rows = data.long.complicity.embargo.countries.slice().sort((a, b) => score[b.status] - score[a.status]);
    return Object.assign({}, base, {
      grid: { left: 132, right: 30, top: 16, bottom: 44 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const x = rows[t.dataIndex];
          return `<b>${x.country}</b> — ${x.status}<br>${x.date}<br>` +
            `<span style="opacity:.8;font-size:11.5px">${x.detail}</span>`;
        },
      }),
      xAxis: axisY({
        max: 3, min: 0, interval: 1,
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => ['', 'Continuing', 'Partial', 'Halted'][v] || '' },
      }),
      yAxis: axisX({
        data: rows.map((x) => x.country), inverse: true,
        axisLabel: { color: C.text2, fontSize: 12, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: rows.map((x) => ({ value: score[x.status], itemStyle: { color: hexToRgba(tint[x.status], 0.85), borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'insideRight', color: '#0b0f18', fontSize: 10.5, fontWeight: 600, formatter: (t) => rows[t.dataIndex].status },
      }],
    });
  };

  /* ---- divestment ---- */

  /* The only official list of businesses operating in the settlements. */
  R['settlement-business'] = () => {
    const s = data.long.divestment.database.series;
    return Object.assign({}, base, {
      grid: { left: 56, right: 30, top: 26, bottom: 52 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (t) => {
          const x = s[t[0].dataIndex];
          return `<b>${x.label}</b><br>Businesses listed: <b>${fmt(x.value)}</b><br>` +
            `<span style="opacity:.8;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisX({ data: s.map((x) => x.label), axisLabel: { color: C.muted, fontSize: 11.5, interval: 0 } }),
      yAxis: axisY({ name: 'businesses listed', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 62, data: s.map((x) => x.value),
        itemStyle: { color: fade('rgb(86,168,224)', 0.92, 0.26), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: C.text2, fontSize: 13, fontWeight: 600 },
      }],
    });
  };

  /* ---- the veto wall ---- */

  /* Every draft blocked since the war began, with the vote that was overridden. */
  R['un-vetoes'] = () => {
    const v = data.long.vetoes.war;
    return Object.assign({}, base, {
      grid: { left: 96, right: 34, top: 40, bottom: 44 },
      legend: Object.assign({}, base.legend, { data: ['Voted for', 'Abstained', 'United States veto'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = v[t[0].dataIndex];
          return `<b>${x.date}</b><br>${x.draft}<br>` +
            `For: <b>${x.for}</b> · Abstained: <b>${x.abstain}</b> · Against: <b>${x.against}</b> (United States)`;
        },
      }),
      xAxis: axisY({ max: 15, interval: 5, name: 'Security Council members', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: v.map((x) => x.date), inverse: true, axisLabel: { color: C.text2, fontSize: 11.5, interval: 0 } }),
      series: [
        {
          name: 'Voted for', type: 'bar', stack: 'sc', barMaxWidth: 22, data: v.map((x) => x.for),
          itemStyle: { color: hexToRgba(C.green, 0.8) },
          label: { show: true, color: '#0b0f18', fontSize: 11, fontWeight: 600, formatter: '{c}' },
        },
        {
          name: 'Abstained', type: 'bar', stack: 'sc', barMaxWidth: 22, data: v.map((x) => x.abstain),
          itemStyle: { color: hexToRgba(C.muted, 0.55) },
        },
        {
          name: 'United States veto', type: 'bar', stack: 'sc', barMaxWidth: 22, data: v.map((x) => x.against),
          itemStyle: { color: C.red, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: C.red, fontSize: 11, fontWeight: 600, formatter: 'vetoed' },
        },
      ],
    });
  };

  /* ---- recognition ---- */

  /* States recognising the State of Palestine, 1988 to now. */
  R['recognition-timeline'] = () => {
    const t = data.long.recognition.timeline;
    return Object.assign({}, base, {
      grid: { left: 56, right: 30, top: 30, bottom: 52 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        formatter: (s) => {
          const x = t[s[0].dataIndex];
          return `<b>${x.year} — ${x.label}</b><br>States recognising: <b>${x.value}</b> of 193<br>` +
            `<span style="opacity:.8;font-size:11.5px">${x.note}</span>`;
        },
      }),
      xAxis: axisX({ data: t.map((x) => x.year), axisLabel: { color: C.muted, fontSize: 11.5, interval: 0 } }),
      yAxis: axisY({ max: 193, name: 'UN member states recognising Palestine', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'line', step: 'end', smooth: false, symbol: 'circle', symbolSize: 9,
        data: t.map((x) => x.value),
        lineStyle: { width: 2.8, color: C.green }, itemStyle: { color: C.green },
        areaStyle: { color: areaFill(C.green) },
        label: { show: true, position: 'top', color: C.text2, fontSize: 12, fontWeight: 600 },
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: C.muted, type: 'dashed', width: 1.2 },
          label: { formatter: 'all 193 UN member states', color: C.muted, fontSize: 10.5, position: 'insideStartTop' },
          data: [{ yAxis: 193 }],
        },
      }],
    });
  };

  /* 3D — deaths by month and category (the flagship time/place chart) */
  R['deaths-3d'] = () => {
    const g = data.ts.gaza, w = data.ts.west_bank;
    const months = g.monthly_killed.months;
    const rows = [
      ['Gaza — all', g.monthly_killed],
      ['Gaza — children', g.monthly_children],
      ['West Bank — all', w.monthly_killed],
      ['West Bank — children', w.monthly_children],
    ];
    /* Heights stay on one z-axis, because the asymmetry between the two territories
       is the finding and rescaling it away would be a lie. Colour is split instead:
       one ramp per territory, each running to its own maximum, so the West Bank
       months are legible as a series rather than four rows of the darkest blue.
       The two ramps therefore do not mean the same number, which is why each
       carries its own maximum in its label. */
    const pts = [];
    rows.forEach((r, y) => {
      const byMonth = {};
      r[1].months.forEach((m, i) => { byMonth[m] = r[1].values[i]; });
      months.forEach((m, x) => pts.push([x, y, byMonth[m] || 0]));
    });
    const gazaPts = pts.filter((p) => p[1] < 2);
    const wbPts = pts.filter((p) => p[1] >= 2);
    const gazaMax = Math.max.apply(null, gazaPts.map((p) => p[2]));
    const wbMax = Math.max.apply(null, wbPts.map((p) => p[2]));
    /* The two scale bars anchor to opposite ends of the canvas rather than
       stacking, because stacked continuous ramps put one ramp's zero label
       directly against the other's maximum and the pair reads as one scale. */
    const narrow = NARROW();
    const ramp = (opts) => Object.assign({
      type: 'continuous', dimension: 2, min: 0, calculable: false,
      textStyle: { color: C.muted, fontSize: narrow ? 9 : 10, lineHeight: narrow ? 12 : 14 },
      left: narrow ? 2 : 6, itemWidth: narrow ? 8 : 10, itemHeight: narrow ? 54 : 78, precision: 0,
    }, opts);
    return {
      backgroundColor: 'transparent',
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const gaza = p.value[1] < 2;
          const other = gaza ? null : (function () {
            const x = p.value[0];
            const peer = pts.find((q) => q[0] === x && q[1] === p.value[1] - 2);
            return peer ? peer[2] : null;
          })();
          return `<b>${monthLabel(months[p.value[0]])}</b><br>${rows[p.value[1]][0]}: <b>${fmt(p.value[2])}</b> killed`
            + (other ? `<br><span style="color:${C.muted}">Gaza, same month and category: ${fmt(other)}</span>` : '');
        },
      }),
      visualMap: [
        ramp({
          seriesIndex: 0, max: gazaMax, top: narrow ? 8 : 18,
          text: ['Gaza\n' + fmt(gazaMax), '0'],
          inRange: { color: ['#1d2637', '#3b6ea5', '#d9a441', '#d2534c', '#8f1d18'] },
        }),
        ramp({
          seriesIndex: 1, max: wbMax, bottom: narrow ? 8 : 18,
          text: ['West Bank\n' + fmt(wbMax), '0'],
          inRange: { color: ['#1b2a24', '#2f6f5a', '#5fae7d', '#a8cf6b', '#e4e06a'] },
        }),
      ],
      xAxis3D: { type: 'category', data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: narrow ? 8 : 9, interval: narrow ? 5 : 2 }, name: '' },
      yAxis3D: {
        type: 'category',
        /* The full pair does not fit beside a phone-width box, and the tooltip
           carries the row name in full, so the separator goes on narrow screens. */
        data: rows.map((r) => (narrow ? r[0].replace(' — ', ' ') : r[0])),
        axisLabel: { color: C.text2, fontSize: narrow ? 8 : 10 }, name: '',
      },
      zAxis3D: { type: 'value', axisLabel: { color: C.muted, fontSize: 10 }, name: 'killed' },
      grid3D: {
        left: narrow ? 36 : 72, right: narrow ? 70 : 24, top: 8, bottom: narrow ? 10 : 18,
        boxWidth: narrow ? 108 : 198, boxDepth: narrow ? 44 : 74, boxHeight: narrow ? 70 : 84,
        viewControl: { alpha: 22, beta: 34, distance: narrow ? 252 : 248, autoRotate: !STILL, autoRotateSpeed: 3, rotateSensitivity: 1.4 },
        light: { main: { intensity: 1.25, shadow: true, alpha: 40, beta: 40 }, ambient: { intensity: 0.42 } },
        axisLine: { lineStyle: { color: C.ink(.25) } },
        axisPointer: { lineStyle: { color: C.amber } },
        splitLine: { lineStyle: { color: C.ink(.06) } },
        environment: 'transparent',
      },
      series: [
        {
          name: 'Gaza', type: 'bar3D', data: gazaPts, shading: 'lambert', barSize: 1.7,
          itemStyle: { opacity: 0.94 },
          emphasis: { label: { show: false }, itemStyle: { color: '#fff' } },
        },
        {
          name: 'West Bank', type: 'bar3D', data: wbPts, shading: 'lambert', barSize: 2.2,
          itemStyle: { opacity: 0.94 },
          emphasis: { label: { show: false }, itemStyle: { color: '#fff' } },
        },
      ],
    };
  };

  /* The West Bank on its own scale — the companion to the 3D scene above.
     At the peak the ratio is roughly 69 to 1, so on a shared height axis the
     West Bank is a flat band. Here the same months are read on their own axis,
     with the Gaza figure for each month printed in the tooltip so the
     comparison is not lost by separating them. */
  R['west-bank-scale'] = () => {
    const w = data.ts.west_bank, g = data.ts.gaza;
    const months = w.monthly_killed.months;
    const gazaBy = {};
    g.monthly_killed.months.forEach((m, i) => { gazaBy[m] = g.monthly_killed.values[i]; });
    return Object.assign({}, base, {
      grid: { left: 46, right: 20, top: 42, bottom: 48 },
      legend: Object.assign({}, base.legend, { data: ['Palestinians killed', 'Children killed'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps) => {
          const m = months[ps[0].dataIndex];
          const gz = gazaBy[m] || 0;
          return `<b>${monthLabel(m)}</b><br>`
            + ps.map((p) => `${p.seriesName}: <b>${fmt(p.value)}</b>`).join('<br>')
            + `<br><span style="color:${C.muted}">Gaza, all, same month: ${fmt(gz)}`
            + (ps[0].value ? ` (${(gz / ps[0].value).toFixed(0)}×)` : '') + '</span>';
        },
      }),
      xAxis: axisX({ data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: axisY({ name: 'killed, West Bank', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        Object.assign({
          name: 'Palestinians killed', type: 'bar', data: w.monthly_killed.values, barMaxWidth: 18,
          itemStyle: { color: fade('rgb(95,174,125)', 0.95, 0.4), borderRadius: [3, 3, 0, 0] },
        }, seriesMarks('west-bank', months, 'month')),
        {
          name: 'Children killed', type: 'bar', data: w.monthly_children.values, barMaxWidth: 18, barGap: '-100%',
          itemStyle: { color: hexToRgba(C.amber, 0.92), borderRadius: [3, 3, 0, 0] },
        },
      ],
    });
  };

  /* Wars — every Gaza operation since 2008 on one comparable axis */
  R['wars'] = () => {
    const w = data.fig.pre2023_wars.items;
    return Object.assign({}, base, {
      grid: { left: 160, right: 90, top: 16, bottom: 36 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const it = w[p.dataIndex];
          return `<b>${it.operation}</b><br>${it.period}<br>Palestinian deaths: <b>${fmt(it.deaths)}</b><br>` +
            `Civilians: ~${it.civilian_pct}%<br><span style="color:${C.amber}">${it.finding}</span>`;
        },
      }),
      xAxis: axisY({ type: 'log', min: 40, name: 'Palestinian deaths (log scale)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: w.map((x) => x.operation).reverse(), axisLabel: { color: C.text2, fontSize: 12 } }),
      series: [{
        type: 'bar', data: w.map((x) => x.deaths).reverse(), barMaxWidth: 24,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: (p) => (p.dataIndex === w.length - 1 ? C.red : hexToRgba(C.blue, 0.55 + p.dataIndex * 0.05)),
        },
      }],
    });
  };

  /* Toll estimates — count vs peer-reviewed vs modelled */
  R['estimates'] = () => {
    const it = data.fig.gaza_toll_estimates.items;
    const colour = { count: C.blue, 'peer-reviewed': C.amber, modelled: C.violet };
    return Object.assign({}, base, {
      grid: { left: 210, right: 80, top: 16, bottom: 34 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].source}</b><br>${fmt(p.value)}<br><span style="color:${C.muted}">${it[p.dataIndex].kind}</span>`,
      }),
      xAxis: axisY({ name: 'deaths', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: it.map((x) => x.source).reverse(), axisLabel: { color: C.text2, fontSize: 11.5 } }),
      series: [{
        type: 'bar', data: it.map((x) => ({ value: x.value, itemStyle: { color: colour[x.kind] } })).reverse(),
        barMaxWidth: 22,
        label: { show: true, position: 'right', color: C.text, fontSize: 11, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      }],
    });
  };

  /* Protected persons — categories with specific IHL protection */
  R['protected'] = () => {
    const it = data.fig.protected_categories.items;
    return Object.assign({}, base, {
      grid: { left: 140, right: 80, top: 12, bottom: 30 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)}<br><span style="color:${C.muted}">${it[p.dataIndex].source}</span>`,
      }),
      xAxis: axisY({ type: 'log', min: 80 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 12 } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 20,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade('rgb(217,164,65)', 0.9, 0.4) },
      }],
    });
  };

  /* West Bank — killings and settler attacks on a shared timeline */
  R['west-bank'] = () => {
    const w = data.ts.west_bank;
    const months = w.monthly_killed.months;
    return Object.assign({}, base, {
      grid: { left: 50, right: 56, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Palestinians killed', 'Children killed', 'Settler attacks'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      xAxis: axisX({ data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: [
        axisY({ name: 'killed', nameTextStyle: { color: C.muted, fontSize: 11 } }),
        axisY({ name: 'attacks', splitLine: { show: false }, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      ],
      series: [
        Object.assign({
          name: 'Palestinians killed', type: 'bar', data: w.monthly_killed.values, barMaxWidth: 18,
          itemStyle: { color: fade('rgb(210,83,76)', 0.9, 0.35), borderRadius: [3, 3, 0, 0] },
        }, seriesMarks('west-bank', months, 'month')),
        {
          name: 'Children killed', type: 'bar', data: w.monthly_children.values, barMaxWidth: 18, barGap: '-100%',
          itemStyle: { color: hexToRgba(C.amber, 0.9), borderRadius: [3, 3, 0, 0] },
        },
        {
          name: 'Settler attacks', type: 'line', yAxisIndex: 1, smooth: 0.3, showSymbol: false,
          data: w.monthly_settler_attacks.values,
          lineStyle: { color: C.violet, width: 2.4 }, itemStyle: { color: C.violet },
        },
      ],
    });
  };

  /* Location comparison — Gaza vs West Bank cumulative */
  R['locations'] = () => {
    const g = data.ts.gaza.cumulative_killed, w = data.ts.west_bank.cumulative_killed;
    return Object.assign({}, base, {
      grid: { left: 58, right: 58, top: 42, bottom: 46 },
      legend: Object.assign({}, base.legend, { data: ['Gaza (left axis)', 'West Bank (right axis)'] }),
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis' }),
      xAxis: axisX({ data: g.months.map(monthLabel), boundaryGap: false, axisLabel: { color: C.muted, fontSize: 10, interval: 2, rotate: 45 } }),
      yAxis: [axisY({}), axisY({ splitLine: { show: false } })],
      series: [
        {
          name: 'Gaza (left axis)', type: 'line', smooth: 0.3, showSymbol: false, data: g.values,
          lineStyle: { width: 2.6, color: C.red }, itemStyle: { color: C.red }, areaStyle: { color: areaFill(C.red) },
        },
        {
          name: 'West Bank (right axis)', type: 'line', yAxisIndex: 1, smooth: 0.3, showSymbol: false, data: w.values,
          lineStyle: { width: 2.6, color: C.blue }, itemStyle: { color: C.blue }, areaStyle: { color: areaFill(C.blue) },
        },
      ],
    });
  };

  /* Infrastructure destroyed over time (3D) */
  R['infra-3d'] = () => {
    const keys = Object.keys(data.ts.infrastructure);
    const rows = keys.map((k) => data.ts.infrastructure[k]);
    const months = rows[0].months;
    const pts = [];
    rows.forEach((r, y) => r.values.forEach((v, x) => pts.push([x, y, v || 0])));
    return {
      backgroundColor: 'transparent',
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${monthLabel(months[p.value[0]])}</b><br>${rows[p.value[1]].label}: <b>${fmt(p.value[2])}</b>`,
      }),
      visualMap: {
        max: Math.max.apply(null, pts.map((p) => p[2])),
        inRange: { color: ['#161d2b', '#3b6ea5', '#4fae82', '#d9a441', '#d2534c'] },
        textStyle: { color: C.muted, fontSize: 11 }, left: 0, bottom: 10, itemWidth: 12, itemHeight: 110,
      },
      xAxis3D: { type: 'category', data: months.map(monthLabel), axisLabel: { color: C.muted, fontSize: 9, interval: 3 } },
      yAxis3D: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: C.text2, fontSize: 9.5 } },
      zAxis3D: { type: 'value', axisLabel: { color: C.muted, fontSize: 10 } },
      grid3D: {
        boxWidth: 190, boxDepth: 80, boxHeight: 70,
        viewControl: { alpha: 24, beta: 38, distance: 250, autoRotate: !STILL, autoRotateSpeed: 2.5 },
        light: { main: { intensity: 1.2, shadow: true, alpha: 40, beta: 40 }, ambient: { intensity: 0.45 } },
        axisLine: { lineStyle: { color: C.ink(.22) } },
        splitLine: { lineStyle: { color: C.ink(.05) } },
        environment: 'transparent',
      },
      series: [{ type: 'bar3D', data: pts, shading: 'lambert', barSize: 1.5, itemStyle: { opacity: 0.93 } }],
    };
  };

  /* Infrastructure — share of each category destroyed (report figures) */
  R['infra-share'] = () => {
    const it = data.fig.infrastructure_report.items;
    return Object.assign({}, base, {
      grid: { left: 190, right: 66, top: 12, bottom: 34 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b><br>${it[p.dataIndex].detail}`,
      }),
      xAxis: axisY({ max: 100, axisLabel: { color: C.muted, fontSize: 11, formatter: '{value}%' } }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11.5 } }),
      series: [{
        type: 'bar', data: it.map((x) => x.pct).reverse(), barMaxWidth: 18,
        showBackground: true, backgroundStyle: { color: C.ink(.04), borderRadius: 4 },
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: '{c}%' },
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: (p) => (p.value >= 90 ? C.red : p.value >= 80 ? C.amber : C.blue),
        },
      }],
    });
  };

  /* 7 October 2023 — the verified Israeli breakdown */
  R['oct7'] = () => {
    const o = data.fig.oct7;
    return Object.assign({}, base, {
      tooltip: Object.assign({}, base.tooltip, { formatter: (p) => `<b>${p.name}</b>: ${fmt(p.value)} (${p.percent}%)` }),
      legend: Object.assign({}, base.legend, { orient: 'vertical', right: 6, top: 'middle', itemGap: 12 }),
      series: [{
        type: 'pie', radius: ['46%', '74%'], center: ['36%', '52%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: '#0a0e17', borderWidth: 2, borderRadius: 5 },
        label: {
          show: true, position: 'center', formatter: `{a|${fmt(o.total)}}\n{b|killed on 7 Oct}`,
          rich: {
            a: { color: C.text, fontSize: 30, fontFamily: 'Georgia, serif', fontWeight: 600 },
            b: { color: C.muted, fontSize: 12, padding: [6, 0, 0, 0] },
          },
        },
        emphasis: { label: { show: true, formatter: '{b|{b}}\n{a|{c}}', rich: { a: { color: C.text, fontSize: 26, fontFamily: 'Georgia, serif' }, b: { color: C.amber, fontSize: 12 } } } },
        data: o.items.map((x, i) => ({
          name: x.label, value: x.value,
          itemStyle: { color: [C.red, C.blue, C.amber, C.violet, C.green][i] },
        })),
      }],
    });
  };

  /* Settlement approvals — Oslo era vs current coalition */
  R['settlements'] = () => {
    const o = data.fig.settlements.oslo_comparison;
    return Object.assign({}, base, {
      grid: { left: 30, right: 30, top: 30, bottom: 60 },
      tooltip: Object.assign({}, base.tooltip, { formatter: (p) => `<b>${p.name}</b>: ${fmt(p.value)} settlements` }),
      xAxis: axisX({ data: o.map((x) => x.label), axisLabel: { color: C.text2, fontSize: 11.5, interval: 0, width: 150, overflow: 'break' } }),
      yAxis: axisY({ name: 'settlements approved', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', data: o.map((x, i) => ({ value: x.value, itemStyle: { color: i ? C.red : hexToRgba(C.blue, 0.7) } })),
        barMaxWidth: 92,
        label: { show: true, position: 'top', color: C.text, fontSize: 20, fontFamily: 'Georgia, serif' },
        itemStyle: { borderRadius: [6, 6, 0, 0] },
      }],
    });
  };

  /* Settlement enterprise — the component figures */
  R['settlement-detail'] = () => {
    const it = data.fig.settlements.items;
    return Object.assign({}, base, {
      grid: { left: 260, right: 80, top: 12, bottom: 32 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)}` + (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ type: 'log', min: 1 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11, width: 250, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 16,
        label: { show: true, position: 'right', color: C.text, fontSize: 11, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade('rgb(155,127,212)', 0.9, 0.4) },
      }],
    });
  };

  /* Recognition of Palestine */
  R['recognition'] = () => {
    const r = data.fig.recognition;
    return Object.assign({}, base, {
      tooltip: Object.assign({}, base.tooltip, { formatter: (p) => `<b>${p.name}</b>: ${p.value} states (${p.percent}%)` }),
      legend: Object.assign({}, base.legend, { bottom: 0, left: 'center' }),
      series: [{
        type: 'pie', radius: ['52%', '76%'], center: ['50%', '46%'],
        itemStyle: { borderColor: '#0a0e17', borderWidth: 3, borderRadius: 6 },
        label: {
          show: true, position: 'center',
          formatter: `{a|${r.recognise}}\n{b|of ${r.total} UN member states}\n{c|recognise Palestine}`,
          rich: {
            a: { color: C.green, fontSize: 40, fontFamily: 'Georgia, serif', fontWeight: 600 },
            b: { color: C.muted, fontSize: 12, padding: [6, 0, 0, 0] },
            c: { color: C.text2, fontSize: 12.5, padding: [2, 0, 0, 0] },
          },
        },
        emphasis: { scale: false },
        data: [
          { name: 'Recognise Palestine', value: r.recognise, itemStyle: { color: C.green } },
          { name: 'Do not recognise', value: r.do_not_recognise, itemStyle: { color: C.ink(.13) } },
        ],
      }],
    });
  };

  /* Public opinion — agree vs disagree, diverging */
  R['opinion'] = () => {
    const rows = data.fig.opinion.uk.items.map((x) => Object.assign({ pool: 'UK' }, x))
      .concat(data.fig.opinion.us.items.map((x) => Object.assign({ pool: 'US' }, x)));
    return Object.assign({}, base, {
      grid: { left: 246, right: 62, top: 34, bottom: 34 },
      legend: Object.assign({}, base.legend, { data: ['Agree', 'Disagree'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const r = rows[p[0].dataIndex];
          return `<b>${r.pool} — ${r.label}</b><br>` + p.map((x) => `${x.marker} ${x.seriesName}: <b>${Math.abs(x.value)}%</b>`).join('<br>') +
            (r.note ? `<br><span style="color:${C.muted}">${r.note}</span>` : '');
        },
      }),
      xAxis: axisY({ axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true, formatter: (v) => Math.abs(v) + '%' } }),
      yAxis: axisX({ data: rows.map((x) => `${x.pool} · ${x.label}`).reverse(), axisLabel: { color: C.text2, fontSize: 11, width: 234, overflow: 'break', lineHeight: 14, interval: 0 } }),
      series: [
        {
          name: 'Agree', type: 'bar', stack: 'o', barMaxWidth: 18,
          data: rows.map((x) => x.agree).reverse(),
          label: { show: true, position: 'right', color: C.text, fontSize: 11, formatter: '{c}%' },
          itemStyle: { color: fade('rgb(79,174,130)', 0.95, 0.45), borderRadius: [0, 4, 4, 0] },
        },
        {
          name: 'Disagree', type: 'bar', stack: 'o', barMaxWidth: 18,
          data: rows.map((x) => (x.disagree === null || x.disagree === undefined ? 0 : -x.disagree)).reverse(),
          itemStyle: { color: hexToRgba(C.red, 0.6), borderRadius: [4, 0, 0, 4] },
        },
      ],
    });
  };

  /* Nakba 1948 */
  R['nakba'] = () => {
    const it = data.fig.nakba.items.filter((x) => x.value > 100);
    return Object.assign({}, base, {
      grid: { left: 250, right: 90, top: 12, bottom: 32 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)}` + (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ type: 'log', min: 5 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11, width: 240, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 18,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade('rgb(86,168,224)', 0.9, 0.35) },
      }],
    });
  };

  /* Timeline density — documented events per decade, crimes against context */
  R['era-density'] = () => {
    const buckets = {};
    data.timeline.forEach((e) => {
      if (!e.year) return;
      const d = Math.floor(e.year / 10) * 10;
      if (!buckets[d]) buckets[d] = { record: 0, context: 0 };
      buckets[d][e.kind === 'context' ? 'context' : 'record']++;
    });
    const decades = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    return Object.assign({}, base, {
      grid: { left: 44, right: 20, top: 34, bottom: 40 },
      legend: { data: ['Crimes and massacres', 'Legal and political context'], top: 0, textStyle: { color: C.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      xAxis: axisX({ data: decades.map((d) => d + 's'), axisLabel: { color: C.muted, fontSize: 10, rotate: 45 } }),
      yAxis: axisY({ name: 'events', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        {
          name: 'Crimes and massacres', type: 'bar', stack: 'e', barMaxWidth: 26,
          data: decades.map((d) => buckets[d].record),
          itemStyle: { color: fade('rgb(210,83,76)', 0.92, 0.32) },
        },
        {
          name: 'Legal and political context', type: 'bar', stack: 'e', barMaxWidth: 26,
          data: decades.map((d) => buckets[d].context),
          itemStyle: { borderRadius: [4, 4, 0, 0], color: fade('rgb(217,164,65)', 0.9, 0.3) },
          // The 2020s bar dwarfs the rest, so print the decade total above each.
          label: {
            show: true, position: 'top', color: C.text2, fontSize: 10.5,
            formatter: (p) => buckets[decades[p.dataIndex]].record + buckets[decades[p.dataIndex]].context,
          },
        },
      ],
    });
  };

  /* Starvation and siege */
  R['starvation'] = () => {
    const it = data.fig.starvation.items;
    return Object.assign({}, base, {
      grid: { left: 210, right: 90, top: 12, bottom: 30 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)}` + (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ type: 'log', min: 100 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11.5, width: 200, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 20,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade('rgb(210,83,76)', 0.9, 0.35) },
      }],
    });
  };

  /* Detention */
  R['detention'] = () => {
    const it = data.fig.detention.items;
    return Object.assign({}, base, {
      grid: { left: 230, right: 90, top: 12, bottom: 30 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)}` + (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ type: 'log', min: 10 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11.5, width: 220, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 20,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade('rgb(155,127,212)', 0.9, 0.35) },
      }],
    });
  };

  /* UK antisemitic incidents — annual series, with the recognition and 7 October markers */
  R['uk-antisemitism'] = () => {
    const u = data.fig.uk_antisemitism;
    const it = u.series;
    const peak = Math.max.apply(null, it.map((x) => x.value));
    return Object.assign({}, base, {
      grid: { left: 58, right: 24, top: 54, bottom: 40 },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const x = it[p[0].dataIndex];
          return `<b>${x.year}</b>: ${fmt(x.value)} incidents` + (x.note ? `<br><span style="color:${C.muted}">${x.note}</span>` : '');
        },
      }),
      xAxis: axisX({ data: it.map((x) => x.year), axisLabel: { color: C.text2, fontSize: 12 } }),
      yAxis: axisY({ name: 'incidents recorded', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value), barMaxWidth: 54,
        label: { show: true, position: 'top', color: C.text, fontSize: 12, formatter: (p) => fmt(p.value) },
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: (p) => (it[p.dataIndex].value === peak ? fade('rgb(210,83,76)', 0.95, 0.35) : fade('rgb(86,168,224)', 0.8, 0.2)),
        },
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: C.amber, type: 'dashed', width: 1.4 },
          label: { formatter: '7 Oct 2023', color: C.amber, fontSize: 10.5, position: 'insideEndTop' },
          data: [{ xAxis: 1.5 }],
        },
        markArea: {
          silent: true,
          itemStyle: { color: hexToRgba(C.green, 0.06) },
          label: { show: true, formatter: 'UK recognises Palestine,\n21 Sep 2025', color: C.green, fontSize: 10.5, position: 'insideTop' },
          data: [[{ xAxis: 3.5 }, { xAxis: 4.5 }]],
        },
      }],
    });
  };

  /* UK protective security funding for faith sites, 2026/27 */
  R['uk-faith-security'] = () => {
    const s = data.fig.uk_antisemitism.security_funding;
    const it = s.items;
    const colours = [C.green, C.blue, C.violet];
    return Object.assign({}, base, {
      grid: { left: 250, right: 90, top: 12, bottom: 48 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: £${it[p.dataIndex].value}m` +
          (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ name: '£m', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11.5, width: 240, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 24,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => '£' + p.value + 'm' },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: (p) => hexToRgba(colours.slice().reverse()[p.dataIndex], 0.75) },
      }],
    });
  };

  /* Land transfer — the dunam record of the 1950 and 1953 statutes */
  R['land-transfer'] = () => {
    const it = data.fig.land_transfer.items.filter((x) => x.unit === 'dunams');
    return Object.assign({}, base, {
      grid: { left: 250, right: 100, top: 12, bottom: 50 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${it[p.dataIndex].label}</b>: ${fmt(p.value)} dunams` +
          (it[p.dataIndex].note ? `<br><span style="color:${C.muted}">${it[p.dataIndex].note}</span>` : ''),
      }),
      xAxis: axisY({ type: 'log', min: 100000, name: 'dunams', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11, width: 240, overflow: 'break' } }),
      series: [{
        type: 'bar', data: it.map((x) => x.value).reverse(), barMaxWidth: 20,
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
        itemStyle: { borderRadius: [0, 4, 4, 0], color: fade(C.amber, 0.85, 0.35) },
      }],
    });
  };

  /* JNF holdings — fifty years of purchase against two years of statute */
  R['jnf-growth'] = () => {
    const h = data.fig.land_transfer.jnf_holdings;
    const labels = h.map((x) => x.label);
    const vals = h.map((x) => x.value);
    const running = [];
    vals.reduce((a, v) => { running.push(a); return a + v; }, 0);
    return Object.assign({}, base, {
      grid: { left: 60, right: 24, top: 30, bottom: 80 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const i = p[0].dataIndex;
          return `<b>${labels[i]}</b><br>${fmt(vals[i])} dunams<br>` +
            `<span style="color:${C.muted}">cumulative: ${fmt(running[i] + vals[i])}</span>` +
            (h[i].note ? `<br><span style="color:${C.muted}">${h[i].note}</span>` : '');
        },
      }),
      xAxis: axisX({ data: labels, axisLabel: { color: C.text2, fontSize: 11, width: 130, overflow: 'break', interval: 0 } }),
      yAxis: axisY({ name: 'dunams', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        { type: 'bar', stack: 'j', silent: true, data: running, itemStyle: { color: 'transparent' } },
        {
          type: 'bar', stack: 'j', data: vals, barMaxWidth: 64,
          label: { show: true, position: 'top', color: C.text, fontSize: 11.5, formatter: (p) => fmt(vals[p.dataIndex]) },
          itemStyle: { borderRadius: [4, 4, 0, 0], color: (p) => hexToRgba(p.dataIndex === 0 ? C.blue : C.amber, 0.8) },
        },
      ],
    });
  };

  /* West Bank — annual killings, 2022 onward */
  R['wb-annual'] = () => {
    const ys = data.history.west_bank.years;
    const tone = (y) => (y.year === 2023 ? C.red : y.year === 2022 ? C.amber : hexToRgba(C.red, 0.55));
    return Object.assign({}, base, {
      grid: { left: 56, right: 20, top: 40, bottom: 40 },
      legend: Object.assign({}, base.legend, { data: ['Palestinians killed', 'of whom children'] }),
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p) => {
          const y = ys[p[0].dataIndex];
          return `<b>${y.year}</b><br>` + p.map((x) => `${x.marker} ${x.seriesName}: <b>${fmt(x.value)}</b>`).join('<br>') +
            `<div style="max-width:340px;white-space:normal;color:${C.muted};margin-top:6px">${y.note}</div>` +
            `<div style="color:${C.muted};margin-top:4px">Source: ${y.source}</div>`;
        },
      }),
      xAxis: axisX({ data: ys.map((y) => y.year) }),
      yAxis: axisY({ name: 'killed', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [
        {
          name: 'Palestinians killed', type: 'bar', barMaxWidth: 46,
          data: ys.map((y) => ({ value: y.killed, itemStyle: { color: tone(y), borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: 'top', color: C.text, fontSize: 12 },
        },
        {
          name: 'of whom children', type: 'bar', barMaxWidth: 46, barGap: '-100%',
          data: ys.map((y) => y.children),
          itemStyle: { color: hexToRgba(C.amber, 0.9), borderRadius: [3, 3, 0, 0] },
        },
      ],
    });
  };

  /* West Bank — 2023 either side of 7 October */
  R['wb-before-after'] = () => {
    const seg = data.history.before_after.segments;
    const rate = seg.map((s) => +(s.killed / s.days).toFixed(2));
    return Object.assign({}, base, {
      grid: { left: 160, right: 90, top: 12, bottom: 52 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const s = seg[p.dataIndex];
          return `<b>${s.label}</b><br>${fmt(s.killed)} killed over ${s.days} days — ${rate[p.dataIndex]} a day` +
            `<div style="max-width:340px;white-space:normal;color:${C.muted};margin-top:6px">${s.note}</div>`;
        },
      }),
      xAxis: axisY({ name: 'killed', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: seg.map((s) => s.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 150, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 34,
        data: seg.map((s, i) => ({
          value: s.killed,
          itemStyle: { color: i === 0 ? hexToRgba(C.amber, 0.85) : hexToRgba(C.red, 0.9), borderRadius: [0, 5, 5, 0] },
        })),
        label: { show: true, position: 'right', color: C.text, fontSize: 12, formatter: (p) => `${fmt(p.value)}  ·  ${rate[p.dataIndex]}/day` },
      }],
    });
  };

  /* Settler incidents per day, by year */
  R['settler-rate'] = () => {
    const ys = data.history.settler_violence.years;
    return Object.assign({}, base, {
      grid: { left: 50, right: 20, top: 22, bottom: 36 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const y = ys[p.dataIndex];
          return `<b>${y.year}</b>: ${y.per_day} settler incidents a day` +
            (y.note ? `<div style="max-width:320px;white-space:normal;color:${C.muted};margin-top:6px">${y.note}</div>` : '');
        },
      }),
      xAxis: axisX({ data: ys.map((y) => y.year) }),
      yAxis: axisY({ name: 'incidents a day', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 40,
        data: ys.map((y) => y.per_day),
        itemStyle: { color: fade('rgb(217,164,65)', 0.9, 0.3), borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: C.text, fontSize: 12, formatter: (p) => p.value + '/day' },
      }],
    });
  };

  /* The recorded toll against the independent estimates */
  R['true-toll'] = () => {
    const e = data.history.true_toll.estimates;
    const label = (x) => `${x.name}\n${x.period}`;
    return Object.assign({}, base, {
      grid: { left: 250, right: 96, top: 12, bottom: 54 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const x = e[p.dataIndex];
          return `<b>${x.name}</b><br>${fmt(x.value)}${x.low ? ` (95% CI ${fmt(x.low)}–${fmt(x.high)})` : ''}` +
            `<br><span style="color:${C.muted}">${x.period} · ${x.kind === 'count' ? 'recorded count' : 'independent estimate'}</span>` +
            `<div style="max-width:360px;white-space:normal;color:${C.muted};margin-top:6px">${x.note}</div>` +
            `<div style="color:${C.muted};margin-top:4px">Source: ${x.source}</div>`;
        },
      }),
      xAxis: axisY({ name: 'deaths', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: e.map(label).reverse(),
        axisLabel: { color: C.text2, fontSize: 11, width: 240, overflow: 'break', lineHeight: 14 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 24,
        data: e.map((x) => ({
          value: x.value,
          itemStyle: {
            color: x.kind === 'count' ? hexToRgba(C.muted, 0.75) : hexToRgba(C.red, 0.9),
            borderRadius: [0, 4, 4, 0],
          },
        })).reverse(),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
      }],
    });
  };

  /* Who is missing from the count */
  R['missing-toll'] = () => {
    const it = data.history.true_toll.missing.items;
    return Object.assign({}, base, {
      grid: { left: 220, right: 90, top: 12, bottom: 34 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const x = it[p.dataIndex];
          return `<b>${x.label}</b>: ${x.range || fmt(x.value)}` +
            `<div style="max-width:340px;white-space:normal;color:${C.muted};margin-top:6px">${x.note}</div>` +
            `<div style="color:${C.muted};margin-top:4px">Source: ${x.source}</div>`;
        },
      }),
      xAxis: axisY({ type: 'log', min: 100 }),
      yAxis: axisX({ data: it.map((x) => x.label).reverse(), axisLabel: { color: C.text2, fontSize: 11.5, width: 210, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: it.map((x) => x.value).reverse(),
        itemStyle: { color: fade('rgb(155,127,212)', 0.9, 0.35), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => fmt(p.value) },
      }],
    });
  };

  /* Statements — how many in each evidentiary category */
  R['statements-cats'] = () => {
    const cats = data.statements.categories.map((c) => {
      const n = data.statements.items.filter((i) => i.cat.indexOf(c.id) >= 0).length;
      return { label: c.label, colour: c.colour, n: n, blurb: c.blurb };
    }).sort((a, b) => a.n - b.n);
    return Object.assign({}, base, {
      grid: { left: 210, right: 70, top: 10, bottom: 46 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${cats[p.dataIndex].label}</b>: ${p.value} statements` +
          `<div style="max-width:320px;white-space:normal;color:${C.muted};margin-top:6px">${cats[p.dataIndex].blurb}</div>`,
      }),
      xAxis: axisY({ name: 'statements', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: cats.map((c) => c.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 200, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: cats.map((c) => ({ value: c.n, itemStyle: { color: hexToRgba(c.colour, 0.85), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5 },
      }],
    });
  };

  /* Statements — the record is not new */
  R['statements-era'] = () => {
    const eras = [
      { label: 'Founding era\n1891–1948', from: 1891, to: 1948, colour: '#8a8272' },
      { label: 'State-building\n1949–1999', from: 1949, to: 1999, colour: '#a86f9b' },
      { label: 'Second Intifada\nto 6 Oct 2023', from: 2000, to: 2023.75, colour: '#56a8e0' },
      { label: 'Since 7 Oct 2023', from: 2023.76, to: 2100, colour: '#d2534c' },
    ];
    const yearOf = (i) => {
      const y = +String(i.sort).slice(0, 4);
      const m = +String(i.sort).slice(5, 7) || 1;
      return y + (m - 1) / 12;
    };
    const counts = eras.map((e) => data.statements.items.filter((i) => {
      const y = yearOf(i);
      return y >= e.from && y <= e.to;
    }).length);
    return Object.assign({}, base, {
      grid: { left: 46, right: 20, top: 22, bottom: 62 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${eras[p.dataIndex].label.replace('\n', ' · ')}</b><br>${p.value} statements on record`,
      }),
      xAxis: axisX({ data: eras.map((e) => e.label), axisLabel: { color: C.text2, fontSize: 11, lineHeight: 15 } }),
      yAxis: axisY({ name: 'statements', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 54,
        data: counts.map((n, i) => ({ value: n, itemStyle: { color: hexToRgba(eras[i].colour, 0.85), borderRadius: [4, 4, 0, 0] } })),
        label: { show: true, position: 'top', color: C.text, fontSize: 12 },
      }],
    });
  };

  /* Provenance — what survives each rejection of a class of source */

  /* Both bars are read straight out of data/provenance.json rather than
     recounted here, so the chart, the panel and the published file cannot
     disagree with one another. */
  R['provenance-switch'] = () => {
    const rows = data.prov.switches.slice().sort((a, b) => a.share - b.share);
    return Object.assign({}, base, {
      grid: { left: 210, right: 76, top: 10, bottom: 46 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${rows[p.dataIndex].label}</b>: ${rows[p.dataIndex].stands} of `
          + `${rows[p.dataIndex].stands + rows[p.dataIndex].falls} claims still stand`
          + `<div style="max-width:320px;white-space:normal;color:${C.muted};margin-top:6px">${rows[p.dataIndex].note}</div>`,
      }),
      xAxis: axisY({ name: '% of claims standing', max: 100, nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: rows.map((r) => r.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 200, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: rows.map((r) => ({
          value: r.share,
          itemStyle: { color: hexToRgba(r.share >= 75 ? C.green : r.share >= 50 ? C.amber : C.red, 0.85), borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, formatter: (p) => p.value + '%' },
      }],
    });
  };

  /* Provenance — claims by class of source */
  R['provenance-origins'] = () => {
    const rows = data.prov.meta.origins.filter((o) => o.claims).sort((a, b) => a.claims - b.claims);
    const palette = [C.red, C.amber, C.blue, C.green, C.violet, '#7f9bd4', '#a86f9b', '#8a8272', '#c98b4b', '#c0c6d4'];
    return Object.assign({}, base, {
      grid: { left: 200, right: 70, top: 10, bottom: 46 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${rows[p.dataIndex].label}</b>: ${p.value} claims, `
          + `${rows[p.dataIndex].sources} ${rows[p.dataIndex].sources === 1 ? 'body' : 'bodies'}`,
      }),
      xAxis: axisY({ name: 'claims', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: rows.map((r) => r.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 190, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: rows.map((r, i) => ({ value: r.claims, itemStyle: { color: hexToRgba(palette[i % palette.length], 0.85), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5 },
      }],
    });
  };

  /* Sources — the evidentiary base by class */
  R['sources-groups'] = () => {
    const g = data.sources.groups.map((x) => ({ label: x.label, n: x.items.length, blurb: x.blurb }))
      .sort((a, b) => a.n - b.n);
    const palette = ['#c0c6d4', '#56a8e0', '#4fae82', '#9b7fd4', '#d9a441', '#d2534c', '#7f9bd4', '#a86f9b', '#8a8272', '#c98b4b'];
    return Object.assign({}, base, {
      grid: { left: 200, right: 70, top: 10, bottom: 46 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${g[p.dataIndex].label}</b>: ${p.value} sources` +
          `<div style="max-width:320px;white-space:normal;color:${C.muted};margin-top:6px">${g[p.dataIndex].blurb}</div>`,
      }),
      xAxis: axisY({ name: 'sources', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: g.map((x) => x.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 190, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: g.map((x, i) => ({ value: x.n, itemStyle: { color: hexToRgba(palette[i % palette.length], 0.85), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5 },
      }],
    });
  };

  /* Determinations by class of institution */
  R['findings-class'] = () => {
    const L = data.legal;
    const rows = L.classes.map((c) => ({
      c,
      n: L.determinations.filter((d) => d.class === c.id).length,
    })).filter((r) => r.n).reverse();
    return Object.assign({}, base, {
      grid: { left: 190, right: 60, top: 10, bottom: 26 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => `<b>${rows[p.dataIndex].c.label}</b>: ${p.value} findings<br><span style="color:${C.muted}">${rows[p.dataIndex].c.blurb}</span>`,
      }),
      xAxis: axisY({ max: 12 }),
      yAxis: axisX({ data: rows.map((r) => r.c.label), axisLabel: { color: C.text2, fontSize: 11.5, width: 176, overflow: 'break' } }),
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: rows.map((r) => ({ value: r.n, itemStyle: { color: fade(r.c.colour, 0.92, 0.35), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 12 },
      }],
    });
  };

  /* Determinations on a time axis, one dot per finding */
  R['findings-time'] = () => {
    const L = data.legal;
    const dated = L.determinations.filter((d) => d.date !== '—');
    // Classes with no dated finding would otherwise draw an empty lane.
    const cls = L.classes.filter((c) => dated.some((d) => d.class === c.id)).reverse();
    const yOf = {};
    cls.forEach((c, i) => { yOf[c.id] = i; });
    const series = cls.map((c) => ({
      name: c.label, type: 'scatter', symbolSize: 15,
      itemStyle: { color: c.colour, opacity: 0.85, borderColor: C.ink(.35), borderWidth: 1 },
      data: dated.filter((d) => d.class === c.id).map((d) => ({ value: [d.sort, yOf[d.class]], d })),
    }));
    return Object.assign({}, base, {
      grid: { left: 190, right: 30, top: 34, bottom: 46 },
      legend: Object.assign({}, base.legend, { top: 0, itemWidth: 11, itemHeight: 8 }),
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          const d = p.data.d;
          return `<b>${d.body}</b><br><span style="color:${C.amber}">${d.date}</span> · ${d.finding}` +
            `<br><span style="color:${C.muted};display:block;max-width:330px;white-space:normal">${d.note}</span>`;
        },
      }),
      xAxis: {
        type: 'time', min: '2023-11-01', max: '2026-09-30',
        axisLine: { lineStyle: { color: C.ink(.16) } },
        axisLabel: { color: C.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: C.line } },
      },
      yAxis: {
        type: 'category', data: cls.map((c) => c.label),
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: C.line } },
        axisLabel: { color: C.text2, fontSize: 11.5, width: 176, overflow: 'break' },
      },
      series,
    });
  };

  /* Which finding rests on which instrument.

     A circular layout rather than a force layout: with thirty-seven nodes a
     force simulation settles somewhere different on every load, which makes
     the picture unciteable and the static snapshots non-reproducible. The ring
     is deterministic, every label is readable, and the instruments are placed
     together on one arc so the edges fan towards them rather than crossing the
     middle at random. */
  R['instrument-graph'] = () => {
    const g = data.elements.instruments;
    const kindOf = {};
    g.kinds.forEach((k, i) => { kindOf[k.id] = i; });
    const degree = {};
    g.links.forEach((l) => {
      degree[l.source] = (degree[l.source] || 0) + 1;
      degree[l.target] = (degree[l.target] || 0) + 1;
    });

    // Instruments first, so they occupy one continuous arc of the ring.
    const ordered = g.nodes.filter((n) => n.kind === 'instrument')
      .concat(g.nodes.filter((n) => n.kind !== 'instrument'));

    const nodes = ordered.map((n) => ({
      id: n.id, name: n.name, n,
      category: kindOf[n.kind],
      symbolSize: 10 + Math.min(degree[n.id] || 0, 9) * 2.4,
      label: { color: n.kind === 'instrument' ? C.text : C.text2, fontSize: 11 },
    }));

    return Object.assign({}, base, {
      legend: Object.assign({}, base.legend, {
        top: 0, itemWidth: 11, itemHeight: 8, data: g.kinds.map((k) => k.label),
      }),
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (p) => {
          if (p.dataType === 'edge') {
            const from = g.nodes.find((n) => n.id === p.data.source);
            const to = g.nodes.find((n) => n.id === p.data.target);
            return `<b>${from.name}</b> cites <b>${to.name}</b>` +
              (p.data.article ? `<br><span style="color:${C.amber}">${p.data.article}</span>` : '');
          }
          const n = p.data.n;
          if (n.kind === 'instrument') {
            return `<b>${n.name}</b> · <span style="color:${C.amber}">${n.year}</span>` +
              `<br><span style="color:${C.muted};display:block;max-width:320px;white-space:normal">${n.full}</span>` +
              `<br><span style="color:${C.text2}">${n.branch}</span>`;
          }
          return `<b>${n.body}</b><br><span style="color:${C.amber}">${n.date}</span>` +
            `<br><span style="color:${C.muted};display:block;max-width:320px;white-space:normal">${n.finding}</span>` +
            `<br><span style="color:${C.text2}">${n.ref}</span>`;
        },
      }),
      series: [{
        type: 'graph', layout: 'circular', top: 40, bottom: 20,
        circular: { rotateLabel: true },
        roam: true,
        categories: g.kinds.map((k) => ({ name: k.label, itemStyle: { color: k.colour } })),
        data: nodes,
        links: g.links.map((l) => Object.assign({}, l, {
          lineStyle: { color: 'source', opacity: 0.28, curveness: 0.28, width: 1 },
        })),
        label: { show: true, position: 'right', formatter: '{b}' },
        emphasis: { focus: 'adjacency', lineStyle: { width: 2.4, opacity: 0.9 }, label: { color: C.text } },
        itemStyle: { borderColor: C.ink(.25), borderWidth: 1 },
      }],
    });
  };

  /* Recognition of Palestine — documented waypoints */
  R['recognition-wave'] = () => {
    const r = data.legal.recognition;
    const p = r.points;
    return Object.assign({}, base, {
      grid: { left: 48, right: 26, top: 24, bottom: 52 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = p[t.dataIndex];
          return `<b>${x.date} — ${x.label}</b><br>${x.value} of 193 UN member states` +
            `<br><span style="color:${C.muted};display:block;max-width:330px;white-space:normal">${x.note}</span>`;
        },
      }),
      xAxis: axisX({ data: p.map((x) => x.date), axisLabel: { color: C.muted, fontSize: 10.5, rotate: 30 }, boundaryGap: false }),
      yAxis: axisY({ min: 60, max: 193, name: 'states', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'line', step: 'end', smooth: false, symbol: 'circle', symbolSize: 8,
        data: p.map((x) => x.value),
        lineStyle: { color: C.green, width: 2.4 },
        itemStyle: { color: C.green },
        areaStyle: { color: areaFill(C.green) },
        label: { show: true, position: 'top', color: C.text, fontSize: 11.5 },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: C.ink(.28), type: 'dashed', width: 1 },
          label: { color: C.muted, fontSize: 10.5, formatter: 'all 193 UN member states', position: 'insideEndTop' },
          data: [{ yAxis: 193 }],
        },
      }],
    });
  };

  /* ---------------- maps ----------------

     ECharts draws a choropleth from a GeoJSON registered by name. The world
     geometry is 300 KB and only one chapter draws it, so it is fetched the
     first time a map is built rather than with the rest of the payload, and
     kept in a promise so two maps on one page share a single request.
     A builder that returns a promise is awaited by init(). */

  const geoCache = {};

  function geoMap(name) {
    if (!geoCache[name]) {
      geoCache[name] = fetch(dataUrl(`data/geo/${name}.json`))
        .then((res) => {
          if (!res.ok) throw new Error(`data/geo/${name}.json — HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          echarts.registerMap(name, json);
          return json;
        });
    }
    return geoCache[name];
  }

  /* Data files that belong to one chart rather than to the dashboard. The
     1948 village list is 95 KB and the governorate figures are read by three
     charts on two chapters; neither is worth carrying in the boot payload, so
     both are fetched the first time a chart that needs them is built, and
     cached the same way the geometry is. */
  const fileCache = {};

  function dataFile(name) {
    if (!fileCache[name]) {
      fileCache[name] = fetch(dataUrl(`data/${name}.json`)).then((res) => {
        if (!res.ok) throw new Error(`data/${name}.json — HTTP ${res.status}`);
        return res.json();
      });
    }
    return fileCache[name];
  }

  // The curated data names countries the way the report does; the geometry
  // uses Natural Earth's names. world-positions.json carries the crosswalk.
  const onMap = (name) => data.positions.alias[name] || name;

  const MAP_BASE = {
    type: 'map',
    // Pan but do not zoom: a wheel-zoom on a full-width map would swallow
    // the page scroll on the way past it.
    roam: 'move',
    // A map series otherwise stamps its legend symbol on the centre of every
    // region it draws, which on a world map is 241 identical dots.
    showLegendSymbol: false,
    itemStyle: { areaColor: C.ink(.05), borderColor: C.ink(.20), borderWidth: 0.5 },
    emphasis: { itemStyle: { areaColor: C.ink(.40) }, label: { show: false } },
  };

  const mapNote = (s) => `<span style="color:${C.muted};display:block;max-width:320px;white-space:normal;margin-top:2px">${s}</span>`;

  /* The slider under every map that steps through dates. Shared because four
     of them now carry one and a reader should not have to learn a second
     control halfway down the page. */
  const timelineAxis = (labels, interval) => ({
    axisType: 'category',
    data: labels,
    autoPlay: false,
    playInterval: interval || 2600,
    bottom: 4, left: 40, right: 40,
    symbolSize: 8,
    lineStyle: { color: C.ink(.22) },
    label: { color: C.muted, fontSize: 11 },
    itemStyle: { color: C.muted },
    checkpointStyle: { color: C.red, borderColor: 'rgba(210,83,76,.35)', borderWidth: 6 },
    controlStyle: { color: C.text2, borderColor: C.text2, itemSize: 13 },
    emphasis: { label: { color: C.text }, itemStyle: { color: C.red }, controlStyle: { color: C.text, borderColor: C.text } },
  });

  /* A map title and its standfirst, in the place every timeline map puts them. */
  const mapTitle = (text, subtext) => ({
    text, subtext,
    left: 'center', top: 4,
    textStyle: { color: C.text, fontSize: 15, fontWeight: 600 },
    subtextStyle: { color: C.muted, fontSize: 11.5, width: 640, overflow: 'break', lineHeight: 16 },
  });

  /* Who recognises the State of Palestine, and when they did it */
  R['recognition-map'] = () => geoMap('world').then(() => {
    const r = data.positions.recognition;
    // Boundaries are half-open, [min, max), so a year falls in exactly one band.
    const bands = [
      { min: 1988, max: 1990, label: '1988–1989 · the Algiers declaration', colour: '#a8dcc0' },
      { min: 1990, max: 2000, label: '1990–1999', colour: '#7ac9a2' },
      { min: 2000, max: 2010, label: '2000–2009', colour: '#4fae82' },
      { min: 2010, max: 2020, label: '2010–2019', colour: '#347f61' },
      { min: 2020, max: 2100, label: '2020–2026 · the recent wave', colour: '#1d5a44' },
    ];
    const by = {};
    r.states.forEach((s) => { by[s.map] = s; });
    return Object.assign({}, base, {
      // The piecewise scale below names every colour; a one-series legend on
      // top of it would say nothing and take a line of height to say it.
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const s = by[t.name];
          if (!s) return `<b>${t.name}</b>${mapNote('On neither list.')}`;
          if (!s.recognises) {
            return `<b>${s.name}</b><br><span style="color:${C.red}">Does not recognise the State of Palestine</span>`;
          }
          return `<b>${s.name}</b><br>Recognised <b>${s.on}</b>`
            + (s.un ? '' : mapNote('Not a member state of the United Nations.'))
            + (s.disputed ? mapNote('This recognition is contested.') : '');
        },
      }),
      visualMap: {
        type: 'piecewise',
        left: 10, bottom: 8, itemWidth: 13, itemHeight: 10, itemGap: 6,
        textStyle: { color: C.text2, fontSize: 11 },
        pieces: bands.map((b) => ({ min: b.min, max: b.max, label: b.label, color: b.colour }))
          .concat([{ value: 0, label: 'Does not recognise', color: C.red }]),
      },
      series: [Object.assign({}, MAP_BASE, {
        map: 'world',
        name: 'Recognition of Palestine',
        data: r.states.map((s) => ({
          name: s.map,
          value: s.recognises ? s.year : 0,
          text: s.recognises ? 'Recognised ' + s.on : 'Does not recognise',
        })),
      })],
    });
  });

  /* Whether each government has called it genocide, and in whose words */
  R['genocide-map'] = () => geoMap('world').then(() => {
    const g = data.positions.genocide;
    // The same greens as the recognition map for the two ways of saying it,
    // red for saying the opposite, and grey for silence, which is the largest
    // group and must not read as a position.
    const ORDER = [
      { key: 'says', value: 7, colour: '#1d5a44' },
      { key: 'joint', value: 6, colour: '#7ac9a2' },
      { key: 'reversed', value: 5, colour: C.amber },
      { key: 'defers', value: 4, colour: C.blue },
      { key: 'unclear', value: 3, colour: C.violet },
      { key: 'rejects', value: 2, colour: C.red },
    ];
    const valueOf = {};
    ORDER.forEach((o) => { valueOf[o.key] = o.value; });
    const by = {};
    g.states.forEach((s) => { by[s.map] = s; });
    const clean = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const clip = (t) => clean(t && t.length > 170 ? t.slice(0, 168) + '…' : t);
    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const s = by[t.name];
          if (!s) return `<b>${t.name}</b>${mapNote('Not on the list of states.')}`;
          if (s.position === 'none') return `<b>${s.name}</b><br>${g.labels.none}`;
          const words = s.quote ? `“${clip(s.quote)}”` : clip(s.summary);
          return `<b>${clean(s.name)}</b><br><b>${g.labels[s.position]}</b><br>${clean(s.who)}${s.role ? ', ' + clean(s.role) : ''} · ${clean(s.date)}`
            + mapNote(words)
            + (s.now ? mapNote('Now: ' + clip(s.now)) : '')
            + (s.un ? '' : mapNote('Not a member state of the United Nations.'));
        },
      }),
      visualMap: {
        type: 'piecewise',
        left: 10, bottom: 8, itemWidth: 13, itemHeight: 10, itemGap: 6,
        textStyle: { color: C.text2, fontSize: 11 },
        pieces: ORDER.map((o) => ({ value: o.value, label: g.labels[o.key], color: o.colour }))
          .concat([{ value: 0, label: g.labels.none, color: C.muted }]),
      },
      series: [Object.assign({}, MAP_BASE, {
        map: 'world',
        name: g.title,
        data: g.states.map((s) => ({ name: s.map, value: valueOf[s.position] || 0 })),
      })],
    });
  });

  /* What each state has actually done: arms, sanctions, the ICJ */
  R['pressure-map'] = () => geoMap('world').then((world) => {
    const c = data.long.complicity;
    const pos = data.positions;
    // Strongest first: a state that still supplies the weapons is shown as a
    // supplier whatever else it has signed.
    const RANK = [
      { key: 'supplying', value: 5, label: 'Supplies the arms, no restriction', colour: C.red },
      { key: 'halted', value: 1, label: 'Halted arms transfers', colour: C.green },
      { key: 'partial', value: 2, label: 'Partial arms restriction', colour: C.blue },
      { key: 'sanctions', value: 3, label: 'Sanctions on officials, settlers or settlement goods', colour: C.amber },
      { key: 'icj', value: 4, label: 'Filed at the International Court of Justice', colour: C.violet },
    ];
    const order = RANK.map((x) => x.key);
    const rec = {};

    const entry = (name, mapped) => {
      const key = mapped || onMap(name);
      if (!rec[key]) rec[key] = { label: name, notes: [], rank: null };
      return rec[key];
    };
    const mark = (e, key) => {
      if (e.rank === null || order.indexOf(key) < order.indexOf(e.rank)) e.rank = key;
    };

    const STATUS = { halted: 'Halted arms transfers', partial: 'Partial restriction', continuing: 'No restriction' };
    c.embargo.countries.forEach((x) => {
      const e = entry(x.country);
      mark(e, x.status === 'continuing' ? 'supplying' : x.status);
      e.notes.push(`<b>${STATUS[x.status]}</b>${x.date && x.date !== '—' ? ' · ' + x.date : ''}${mapNote(x.detail)}`);
    });
    c.suppliers.items.forEach((x) => {
      entry(x.country).notes.push(`<b>${x.share}%</b> of Israel’s major arms imports, ${c.suppliers.period}`);
    });
    pos.sanctions.measures.forEach((m) => m.countries.forEach((x) => {
      const e = entry(x.name, x.map);
      mark(e, 'sanctions');
      e.notes.push(`<b>${m.label}</b> · ${m.date}`);
    }));
    pos.icj.applicant.forEach((x) => {
      const e = entry(x.name, x.map);
      mark(e, 'icj');
      e.notes.push('<b>Brought the case</b> at the International Court of Justice');
    });
    pos.icj.interveners.forEach((x) => {
      const e = entry(x.name, x.map);
      mark(e, 'icj');
      e.notes.push('<b>Filed a declaration of intervention</b> at the International Court of Justice');
    });

    const valueOf = (key) => RANK.filter((x) => x.key === key)[0].value;
    const rows = world.features.map((f) => {
      const name = f.properties.name;
      const e = rec[name];
      return {
        name,
        value: e ? valueOf(e.rank) : 0,
        text: e ? RANK.filter((x) => x.key === e.rank)[0].label : 'No documented measure',
      };
    });

    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const e = rec[t.name];
          if (!e) return `<b>${t.name}</b>${mapNote('No measure on the record.')}`;
          return `<b>${e.label}</b><br>` + e.notes.join('<br>');
        },
      }),
      visualMap: {
        type: 'piecewise',
        left: 10, bottom: 8, itemWidth: 13, itemHeight: 10, itemGap: 6,
        textStyle: { color: C.text2, fontSize: 11 },
        pieces: RANK.slice(1).concat([RANK[0]])
          .map((x) => ({ value: x.value, label: x.label, color: x.colour }))
          .concat([{ value: 0, label: 'No documented measure', color: C.ink(.07) }]),
      },
      series: [Object.assign({}, MAP_BASE, { map: 'world', name: 'Measures taken', data: rows })],
    });
  });

  /* Where the J50 signatories are. The declaration is a list of institutions,
     not of people, so the shade is the number of signatory bodies in a country
     and nothing else: it is not a population, a share, or a measure of support.
     The tooltip names every body, because the list is the evidence. */
  R['j50-map'] = () => geoMap('world').then(() => {
    const j = data.fig.definitions.j50;
    const by = {};
    j.countries.forEach((c) => { by[onMap(c.name)] = c; });
    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const c = by[t.name];
          if (!c) return `<b>${t.name}</b>${mapNote('No signatory organisation.')}`;
          return `<b>${c.name}</b>${mapNote(c.orgs.join('<br>'))}`;
        },
      }),
      visualMap: {
        type: 'piecewise',
        left: 10, bottom: 8, itemWidth: 13, itemHeight: 10, itemGap: 6,
        textStyle: { color: C.text2, fontSize: 11 },
        pieces: [
          { value: 1, label: 'One signatory organisation', color: '#3c6b93' },
          { value: 2, label: 'Two', color: '#56a8e0' },
          { min: 3, label: 'Three or four', color: '#8ecbf0' },
        ],
      },
      series: [Object.assign({}, MAP_BASE, {
        map: 'world',
        name: 'J50 signatories',
        data: j.countries.map((c) => ({ name: onMap(c.name), value: c.orgs.length })),
      })],
    });
  });

  /* Where the arrest warrant actually bites.

     The obligation is not a matter of sympathy: Article 86 of the Rome Statute
     binds every state party to cooperate with the Court, and Article 89(1)
     binds it to comply with a request for arrest and surrender. So the shading
     is the legal position, not the political one — a state party that has said
     nothing is still bound, and a state that has given notice of withdrawal is
     bound for the whole year that notice takes to run under Article 127(1).
     Where the record documents what a state has said or done, the tooltip says
     it; where it does not, the tooltip says that instead of guessing. */
  R['arrest-map'] = () => geoMap('world').then(() => {
    const E = data.entities.icc;
    const leaving = {};
    E.leaving.forEach((s) => { leaving[s.name] = s; });
    const stated = {};
    E.positions.forEach((s) => { stated[s.map] = s; });

    const PARTY = 1;
    const LEAVING = 2;
    const REFUSED = 3;
    const rows = E.parties.filter((s) => s.map).map((s) => {
      const pos = stated[s.map];
      const code = leaving[s.name] ? LEAVING : (pos && pos.stance === 'refused' ? REFUSED : PARTY);
      return { name: s.map, value: code, party: s.name };
    });

    const byName = {};
    rows.forEach((r) => { byName[r.name] = r; });

    return Object.assign({}, base, {
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'item',
        formatter: (t) => {
          const row = byName[t.name];
          const pos = stated[t.name];
          if (!row) {
            return `<b>${t.name}</b>`
              + mapNote(pos ? pos.detail : 'Not a party to the Rome Statute, and under no obligation to the Court.');
          }
          const note = leaving[row.party]
            ? `Gave notice of withdrawal on ${leaving[row.party].notified}, effective ${leaving[row.party].effective} — bound throughout.`
            : 'Bound by Articles 86 and 89(1) to arrest and surrender.';
          return `<b>${row.party}</b>${mapNote(note + (pos ? '<br><br>' + pos.detail : ''))}`;
        },
      }),
      visualMap: {
        type: 'piecewise',
        left: 10, bottom: 8, itemWidth: 13, itemHeight: 10, itemGap: 6,
        textStyle: { color: C.text2, fontSize: 11 },
        pieces: [
          { value: PARTY, label: 'State party — bound to arrest', color: '#347f61' },
          { value: LEAVING, label: 'Notice of withdrawal given — bound until it takes effect', color: C.amber },
          { value: REFUSED, label: 'Acted to defeat the warrant', color: C.red },
        ],
      },
      series: [Object.assign({}, MAP_BASE, {
        map: 'world',
        name: 'Obligation to arrest',
        data: rows,
      })],
    });
  });

  /* The land itself, at the four dates the geometry can honestly carry */
  R['land-map'] = () => geoMap('palestine').then(() => {
    const sand = '#c9b071';
    const frames = [
      {
        label: '1917–1948',
        title: 'Mandatory Palestine',
        sub: 'One territory of about 26,320 km². Jewish landholding was about 6 per cent of it in 1946 — scattered private parcels, not a territory, so it is not drawn here.',
        parts: [
          ['Israel', sand, 'Mandatory Palestine', 'British Mandate, 1920–1948.'],
          ['West Bank', sand, '', 'British Mandate, 1920–1948.'],
          ['Gaza Strip', sand, '', 'British Mandate, 1920–1948.'],
        ],
      },
      {
        label: '1949–1967',
        title: 'After the armistice',
        sub: 'Israel held about 78 per cent — some 22 per cent more than the 1947 partition plan had allotted it — and more than 700,000 Palestinians had been displaced from it.',
        parts: [
          ['Israel', C.red, 'Israel · 78%', 'Held about 78 per cent of the territory.'],
          ['West Bank', C.violet, 'Jordan · 21%', 'Administered by Jordan, annexed in 1950.'],
          ['Gaza Strip', C.blue, 'Egypt · 1%', 'Administered by Egypt.'],
        ],
      },
      {
        label: '1967–',
        title: 'Under military occupation',
        sub: 'The remaining 22 per cent came under military occupation in June 1967, where it has remained for fifty-nine years. East Jerusalem was annexed in 1980 and the Golan in 1981; the Security Council declared both null and void.',
        parts: [
          ['Israel', C.red, 'Israel', 'Pre-1967 lines.'],
          ['West Bank', '#a8443e', 'Occupied', 'Under Israeli military occupation since June 1967.'],
          ['Gaza Strip', '#a8443e', 'Occupied', 'Under Israeli military occupation since June 1967.'],
        ],
      },
      {
        label: '1995–2026',
        title: 'After Oslo II',
        sub: 'A five-year interim arrangement, thirty-one years old. Area A, the only ground under full Palestinian control, is about 18 per cent of the West Bank — 3.8 per cent of the territory on this map — and is not contiguous: 165 separate enclaves. The A/B/C boundaries are not drawn here; the percentages are in the chart above.',
        parts: [
          ['Israel', C.red, 'Israel', 'Pre-1967 lines, about 78 per cent of the territory.'],
          ['West Bank', C.amber, 'Areas A, B and C', 'Area C, 60 per cent and under full Israeli control, holds every settlement, the Jordan Valley and the aquifers. Area A, 18 per cent, is under Palestinian control.'],
          ['Gaza Strip', '#8e2f2b', 'Gaza', 'Under blockade since 2007. About 1 per cent of the territory.'],
        ],
      },
    ];

    const LABEL_NUDGE = { Israel: [6, 62], 'Gaza Strip': [-36, 0] };

    /* The map fills its container by default, which puts the southern tip
       under the timeline control and the northern edge under the caption.
       Reserve a band at each end. */
    const seriesFor = (frame) => [Object.assign({}, MAP_BASE, {
      map: 'palestine',
      name: frame.title,
      top: 86,
      bottom: 56,
      /* The caption is read off the data item by a formatter rather than
         written into each item's own label option: on a timeline step
         ECharts reuses the label element of a region that already had one
         and keeps its old text, so a per-item string would leave the
         previous period's caption on the map. */
      label: {
        show: true,
        color: C.text, fontSize: 11, textBorderColor: 'rgba(0,0,0,.55)', textBorderWidth: 2,
        formatter: (p) => (p.data && p.data.cap) || '',
      },
      data: frame.parts.map(([name, colour, label, detail]) => ({
        name,
        value: label,
        detail,
        cap: label,
        // Israel's centroid sits a few pixels from Gaza's, so the two
        // captions collide at this scale unless they are pushed apart.
        label: { offset: LABEL_NUDGE[name] || [0, 0] },
        itemStyle: { areaColor: colour, borderColor: C.ink(.45), borderWidth: 0.8 },
        emphasis: { itemStyle: { areaColor: colour, borderColor: '#ffffff', borderWidth: 1.6 } },
      })),
    })];

    const titleOf = (frame) => mapTitle(frame.title, frame.sub);

    return {
      baseOption: Object.assign({}, base, {
        legend: { show: false },
        tooltip: Object.assign({}, base.tooltip, {
          trigger: 'item',
          formatter: (t) => `<b>${t.name}</b>${t.data && t.data.detail ? mapNote(t.data.detail) : ''}`,
        }),
        timeline: timelineAxis(frames.map((f) => f.label)),
        title: titleOf(frames[0]),
        series: seriesFor(frames[0]),
      }),
      options: frames.map((f) => ({ title: titleOf(f), series: seriesFor(f) })),
    };
  });

  /* ---------------- 1948: the depopulated villages ----------------

     data/nakba.json is one record per town and village emptied of its Arab
     population between 1947 and 1950, parsed from the transcription of Abu
     Sitta's atlas. 456 rows, 438 of which carry coordinates. It is fetched on
     demand: the four charts below are the only things that read it. */

  /* How the atlas records what happened to each place. Three groups rather
     than six, because a legend of six on a map of 438 dots cannot be read —
     the exact entry is in the tooltip of every dot. */
  const NAKBA_GROUPS = [
    {
      name: 'A massacre or atrocity is recorded on the site',
      colour: C.red,
      has: (v) => v.cause === 'massacre' || v.cause === 'atrocity',
    },
    {
      name: 'Assault, expulsion or evacuation recorded',
      colour: C.amber,
      has: (v) => v.cause === 'assault' || v.cause === 'expulsion' || v.cause === 'evacuation',
    },
    {
      name: 'No cause recorded in the atlas',
      colour: C.blue,
      has: (v) => !v.cause,
    },
  ];

  // Area, not radius: a dot for Jaffa's 76,920 people beside one for a hamlet
  // of 200 has to stay on the map, so the scale is the square root.
  const villageSize = (v) => 4 + Math.sqrt(v[2] || 0) / 11;

  R['nakba-map'] = () => Promise.all([geoMap('palestine'), dataFile('nakba')]).then(([, n]) => {
    const placed = n.villages.filter((v) => v.at && v.date);
    const months = n.months.map((m) => m.month);
    const point = (v) => ({ value: [v.at[0], v.at[1], v.people || 0], v });

    const seriesFor = (upto) => {
      const shown = placed.filter((v) => v.date.slice(0, 7) <= upto);
      const now = shown.filter((v) => v.date.slice(0, 7) === upto);
      return NAKBA_GROUPS.map((g) => ({
        name: g.name, type: 'scatter', coordinateSystem: 'geo',
        symbolSize: villageSize,
        itemStyle: { color: hexToRgba(g.colour, 0.72), borderColor: 'rgba(6,9,15,.55)', borderWidth: 0.5 },
        emphasis: { itemStyle: { color: g.colour, borderColor: '#ffffff', borderWidth: 1.2 } },
        data: shown.filter(g.has).map(point),
      })).concat([{
        name: 'Emptied in this month',
        type: 'scatter', coordinateSystem: 'geo', z: 5,
        symbolSize: (v) => villageSize(v) + 7,
        itemStyle: { color: 'transparent', borderColor: C.ink(.85), borderWidth: 1.3 },
        data: now.map(point),
      }]);
    };

    const titleOf = (i) => {
      const m = n.months[i];
      const sofar = n.months.slice(0, i + 1);
      const villages = sofar.reduce((a, x) => a + x.villages, 0);
      const people = sofar.reduce((a, x) => a + x.people, 0);
      return mapTitle(
        `${monthLabel(m.month).replace("'", '19')} — ${fmt(m.villages)} ${m.villages === 1 ? 'village' : 'villages'} emptied`,
        `${fmt(villages)} of ${fmt(n.meta.villages)} towns and villages depopulated by the end of this month, `
        + `${fmt(people)} people driven from them. ${m.massacres ? fmt(m.massacres) + ' of this month’s villages carry a recorded massacre. ' : ''}`
        + 'Each dot is one place; its size is that place’s 1948 population.');
    };

    return {
      baseOption: Object.assign({}, base, {
        legend: Object.assign({}, base.legend, {
          // Clear of the timeline slider, which owns the bottom 50 pixels.
          top: 'auto', bottom: 62, left: 'center', itemGap: 14, textStyle: { color: C.text2, fontSize: 11 },
        }),
        tooltip: Object.assign({}, base.tooltip, {
          trigger: 'item',
          formatter: (t) => {
            const v = t.data && t.data.v;
            if (!v) return '';
            return `<b>${v.name}</b> — ${v.subdistrict} sub-district`
              + `<br>Depopulated <b>${dayLabel(v.date)}</b>`
              + (v.people ? `<br>${fmt(v.people)} people, ${fmt(v.dunams)} dunams of land` : '')
              + (v.operation ? mapNote('Israeli operation: ' + v.operation) : '')
              + (v.recorded ? mapNote('Recorded: ' + v.recorded.toLowerCase()) : '')
              + (v.remains ? mapNote('On the site today: ' + v.remains.toLowerCase()) : '');
          },
        }),
        geo: {
          map: 'palestine',
          roam: 'move',
          top: 92, bottom: 96,
          itemStyle: { areaColor: C.ink(.045), borderColor: C.ink(.20), borderWidth: 0.6 },
          emphasis: { itemStyle: { areaColor: C.ink(.06) }, label: { show: false } },
          // The Mandate outline draws last and over the rest, so it carries the
          // fill: in 1948 this was one territory, and the lines inside it are
          // there to orient a reader who knows the modern map, not to date it.
          regions: [{
            name: 'Mandatory Palestine',
            itemStyle: { areaColor: 'rgba(201,176,113,.10)', borderColor: 'rgba(201,176,113,.50)', borderWidth: 1 },
          }],
        },
        timeline: timelineAxis(months.map((m) => monthLabel(m)), 1200),
        title: titleOf(0),
        series: seriesFor(months[0]),
      }),
      options: months.map((m, i) => ({ title: titleOf(i), series: seriesFor(m) })),
    };
  });

  /* The curve of the expulsion itself: how many places were emptied each month */
  R['nakba-months'] = () => dataFile('nakba').then((n) => {
    // A month in which nothing is recorded is a month with a zero in it, not a
    // month to leave out: the gaps are part of the shape.
    const axis = [];
    const first = n.months[0].month;
    const last = n.months[n.months.length - 1].month;
    for (let y = +first.slice(0, 4), m = +first.slice(5); ; m += 1) {
      if (m > 12) { m = 1; y += 1; }
      const key = y + '-' + String(m).padStart(2, '0');
      axis.push(key);
      if (key === last) break;
    }
    const by = {};
    n.months.forEach((x) => { by[x.month] = x; });
    const marks = [
      { month: '1948-03', label: 'Plan Dalet', detail: 'Plan Dalet, 10 March 1948 — the Haganah plan for control of the territory allotted to the Jewish state and of areas beyond it, including the clearing of villages.' },
      { month: '1948-05', label: 'State declared', detail: '14 May 1948 — the declaration of the State of Israel; the neighbouring Arab states entered the following day.' },
    ];
    return Object.assign({}, base, {
      grid: { left: 52, right: 24, top: 26, bottom: 64 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const x = by[axis[t[0].dataIndex]];
          if (!x) return `<b>${monthLabel(axis[t[0].dataIndex])}</b><br>No depopulation recorded`;
          return `<b>${monthLabel(x.month)}</b><br><b>${fmt(x.villages)}</b> towns and villages emptied`
            + `<br>${fmt(x.people)} people`
            + (x.massacres ? mapNote(`${x.massacres} of them carry a recorded massacre.`) : '');
        },
      }),
      xAxis: axisX({ data: axis.map(monthLabel), axisLabel: { color: C.muted, fontSize: 10.5, rotate: 45 } }),
      yAxis: axisY({ name: 'villages', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: axis.map((m) => (by[m] ? by[m].villages : 0)),
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: (t) => {
            const x = by[axis[t.dataIndex]];
            return hexToRgba(x && x.massacres ? C.red : C.amber, x && x.massacres ? 0.88 : 0.7);
          },
        },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: C.ink(.30), type: 'dashed', width: 1.2 },
          data: marks.filter((k) => axis.indexOf(k.month) >= 0).map((k) => ({
            xAxis: axis.indexOf(k.month),
            label: Object.assign({ formatter: k.label, color: C.text2 }, MARK_LABEL),
          })),
        },
      }],
    });
  });

  /* Which sub-districts lost what */
  R['nakba-subdistricts'] = () => dataFile('nakba').then((n) => {
    const it = n.subdistricts.slice().reverse();
    return Object.assign({}, base, {
      // The bar label carries both the villages and the people, so the right
      // margin has to hold "79 · 51,098 people" in full.
      grid: { left: 96, right: 156, top: 16, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => {
          const x = it[t.dataIndex];
          return `<b>${x.name} sub-district</b><br><b>${fmt(x.villages)}</b> towns and villages emptied`
            + `<br>${fmt(x.people)} people`
            + (x.massacres ? mapNote(`${x.massacres} with a recorded massacre.`) : '');
        },
      }),
      xAxis: axisY({ name: 'towns and villages', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({ data: it.map((x) => x.name), axisLabel: { color: C.text2, fontSize: 11.5, interval: 0 } }),
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: it.map((x) => ({ value: x.villages, itemStyle: { color: hexToRgba(C.blue, 0.8), borderRadius: [0, 4, 4, 0] } })),
        label: {
          show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600,
          formatter: (t) => `${fmt(it[t.dataIndex].villages)} · ${fmt(it[t.dataIndex].people)} people`,
        },
      }],
    });
  });

  /* What stands on the sites now, as the atlas records it */
  R['nakba-fate'] = () => dataFile('nakba').then((n) => {
    const TONE = {
      'No trace': C.red,
      Rubble: C.red,
      'Some walls': C.amber,
      'Some houses': C.amber,
      '1 or 2 Jewish families': C.violet,
      '3 or more Jewish families': C.violet,
      Inaccessible: C.muted,
    };
    const it = n.remains
      .map((x) => ({ label: x.label || 'Not recorded', villages: x.villages, tone: TONE[x.label] || C.muted }))
      .sort((a, b) => a.villages - b.villages);
    return Object.assign({}, base, {
      grid: { left: 172, right: 62, top: 16, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${it[t.dataIndex].label}</b><br><b>${fmt(it[t.dataIndex].villages)}</b> of `
          + `${fmt(n.meta.villages)} sites`,
      }),
      xAxis: axisY({ name: 'sites', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: axisX({
        data: it.map((x) => x.label),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 162, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: it.map((x) => ({ value: x.villages, itemStyle: { color: hexToRgba(x.tone, 0.8), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 11.5, fontWeight: 600, formatter: (t) => fmt(t.value) },
      }],
    });
  });

  /* ---------------- the governorates ----------------

     data/geo/governorates.json is the OCHA boundary set, both territories in
     one file. ECharts cannot draw part of a registered map, so a chart that
     wants one territory registers its own from the same download. */

  function geoRegion(name, region) {
    const key = `${name}:${region}`;
    if (!geoCache[key]) {
      geoCache[key] = geoMap(name).then((json) => {
        const sub = {
          type: 'FeatureCollection',
          features: json.features.filter((f) => f.properties.region === region),
        };
        echarts.registerMap(key, sub);
        return sub;
      });
    }
    return geoCache[key];
  }

  /* Gaza on the IPC scale, at the three rounds published since the famine */
  R['gaza-ipc-map'] = () => Promise.all([
    geoRegion('governorates', 'Gaza Strip'), dataFile('maps'),
  ]).then(([, m]) => {
    const g = m.gaza_ipc;
    const colour = {};
    g.scale.forEach((s) => { colour[s.phase] = s.colour; });

    const seriesFor = (round) => [Object.assign({}, MAP_BASE, {
      map: 'governorates:Gaza Strip',
      name: round.title,
      top: 92, bottom: 58,
      label: {
        show: true,
        color: C.text, fontSize: 11, textBorderColor: 'rgba(0,0,0,.65)', textBorderWidth: 2.5,
        formatter: (p) => (p.data && p.data.cap) || '',
      },
      data: Object.keys(round.areas).map((name) => ({
        name,
        value: round.areas[name].phase,
        cap: `${name}\nPhase ${round.areas[name].phase}`,
        detail: round.areas[name].note,
        itemStyle: { areaColor: colour[round.areas[name].phase], borderColor: C.ink(.45), borderWidth: 0.8 },
      })).concat(Object.keys(round.unreported).map((name) => ({
        name,
        value: 0,
        cap: name,
        detail: round.unreported[name],
        itemStyle: { areaColor: g.unreported.colour, borderColor: C.ink(.30), borderWidth: 0.8 },
      }))),
    })];

    const titleOf = (round) => mapTitle(round.title, round.sub);

    return {
      baseOption: Object.assign({}, base, {
        legend: { show: false },
        tooltip: Object.assign({}, base.tooltip, {
          trigger: 'item',
          formatter: (t) => {
            const phase = t.data && t.data.value;
            const head = phase
              ? `<b>${t.name}</b><br><span style="color:${colour[phase]}">${g.scale.filter((s) => s.phase === phase)[0].label}</span>`
              : `<b>${t.name}</b><br><span style="color:${C.muted}">${g.unreported.label}</span>`;
            return head + (t.data && t.data.detail ? mapNote(t.data.detail) : '');
          },
        }),
        visualMap: {
          type: 'piecewise',
          // Above the timeline slider, which owns the bottom 50 pixels, and on
          // the left where the Strip's diagonal leaves the canvas empty.
          left: 10, bottom: 58, itemWidth: 13, itemHeight: 10, itemGap: 6,
          textStyle: { color: C.text2, fontSize: 11 },
          // The key only names the colours; the regions carry their own, so
          // that a governorate left out of a round is grey rather than absent.
          showLabel: true,
          pieces: g.scale.map((s) => ({ value: s.phase, label: s.label, color: s.colour }))
            .concat([{ value: 0, label: g.unreported.label, color: g.unreported.colour }]),
        },
        timeline: timelineAxis(g.rounds.map((r) => r.label)),
        title: titleOf(g.rounds[0]),
        series: seriesFor(g.rounds[0]),
      }),
      options: g.rounds.map((r) => ({ title: titleOf(r), series: seriesFor(r) })),
    };
  });

  /* The West Bank, governorate by governorate, where a figure is published */
  R['wb-gov-map'] = () => Promise.all([
    geoRegion('governorates', 'West Bank'), dataFile('maps'),
  ]).then(([, m]) => {
    const w = m.west_bank;

    const seriesFor = (layer) => {
      const values = Object.keys(layer.areas).map((k) => layer.areas[k].value);
      const top = Math.max.apply(null, values);
      return [Object.assign({}, MAP_BASE, {
        map: 'governorates:West Bank',
        name: layer.title,
        top: 92, bottom: 42,
        label: {
          show: true,
          color: C.text, fontSize: 10.5, textBorderColor: 'rgba(0,0,0,.65)', textBorderWidth: 2.5,
          formatter: (p) => (p.data && p.data.cap) || '',
        },
        data: Object.keys(layer.areas).map((name) => {
          const a = layer.areas[name];
          return {
            name,
            value: a.value,
            cap: `${a.name}\n${fmt(a.value)}`,
            detail: a.note,
            // Depth of colour is the value against the highest published one,
            // floored so the lowest of the three is still plainly coloured.
            itemStyle: {
              areaColor: hexToRgba(layer.colour, 0.35 + 0.55 * (a.value / top)),
              borderColor: C.ink(.45), borderWidth: 0.8,
            },
          };
        }),
      })];
    };

    const titleOf = (layer) => mapTitle(layer.title, layer.sub);

    return {
      baseOption: Object.assign({}, base, {
        legend: { show: false },
        tooltip: Object.assign({}, base.tooltip, {
          trigger: 'item',
          formatter: (t) => {
            const layer = w.layers[0];
            if (!t.data || t.data.value === undefined) {
              return `<b>${t.name}</b><br><span style="color:${C.muted}">${w.unreported.label}</span>`
                + mapNote('OCHA records incidents here, but the published breakdown names only the three highest governorates.');
            }
            return `<b>${t.data.cap.split('\n')[0]}</b><br><b>${fmt(t.data.value)}</b> ${layer.unit}`
              + (t.data.detail ? mapNote(t.data.detail) : '');
          },
        }),
        timeline: timelineAxis(w.layers.map((l) => l.label), 4000),
        title: titleOf(w.layers[0]),
        series: seriesFor(w.layers[0]),
      }),
      options: w.layers.map((l) => ({ title: titleOf(l), series: seriesFor(l) })),
    };
  });

  /* Settler attacks recorded per year, the last bar four months long */
  R['settler-annual'] = () => dataFile('maps').then((m) => {
    const a = m.west_bank.annual;
    return Object.assign({}, base, {
      grid: { left: 56, right: 24, top: 24, bottom: 40 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (t) => {
          const y = a.years[t[0].dataIndex];
          return `<b>${y.year}</b><br><b>${fmt(y.value)}</b> recorded settler attacks`
            + (y.note ? mapNote(y.note) : '');
        },
      }),
      xAxis: axisX({ data: a.years.map((y) => y.year + (y.partial ? '*' : '')) }),
      yAxis: axisY({ name: 'attacks', nameTextStyle: { color: C.muted, fontSize: 11 } }),
      series: [{
        type: 'bar', barMaxWidth: 54,
        data: a.years.map((y) => ({
          value: y.value,
          itemStyle: {
            color: hexToRgba(C.red, y.partial ? 0.42 : 0.85),
            borderRadius: [4, 4, 0, 0],
            borderColor: y.partial ? hexToRgba(C.red, 0.8) : 'transparent',
            borderWidth: y.partial ? 1 : 0,
            borderType: 'dashed',
          },
        })),
        label: { show: true, position: 'top', color: C.text, fontSize: 12, fontWeight: 600, formatter: (t) => fmt(t.value) },
      }],
    });
  });

  /* Operation Iron Wall: what is left of the three camps */
  R['iron-wall'] = () => dataFile('maps').then((m) => {
    const w = m.west_bank.iron_wall;
    const it = w.camps.slice().reverse();
    return Object.assign({}, base, {
      grid: { left: 176, right: 62, top: 16, bottom: 46 },
      legend: { show: false },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: (t) => `<b>${it[t.dataIndex].camp}</b> — ${it[t.dataIndex].governorate} governorate`
          + `<br><b>${it[t.dataIndex].damaged_pct}%</b> of structures destroyed or damaged`
          + mapNote(w.note),
      }),
      xAxis: axisY({
        max: 100, name: 'per cent of structures', nameLocation: 'middle', nameGap: 30,
        nameTextStyle: { color: C.muted, fontSize: 11 },
        axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + '%' },
      }),
      yAxis: axisX({
        data: it.map((x) => x.camp),
        axisLabel: { color: C.text2, fontSize: 11.5, width: 166, overflow: 'break', lineHeight: 14, interval: 0 },
      }),
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: it.map((x) => ({ value: x.damaged_pct, itemStyle: { color: hexToRgba(C.red, 0.85), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: C.text, fontSize: 12, fontWeight: 600, formatter: (t) => t.value + '%' },
      }],
    });
  });

  /* ---------------- lifecycle ---------------- */

  // Every built chart, by the name its container carries, so that export
  // and the table view can reach the instance and its option after the fact.
  const built = {};

  /* A y-axis name sits at the end of the axis by default, horizontally
     centred on the axis line, so half of it hangs off the left edge of the
     container and is clipped. Left-align it and make sure the top margin can
     hold it. Applied here rather than in the axis helper because the same
     helper also builds the value axis of every horizontal bar chart, where
     the name runs along the bottom and the default is already correct. */
  const NAME_ROOM = 34;

  function placeAxisNames(opt) {
    const axes = [].concat(opt.yAxis || []);
    const named = axes.filter((a) => a && a.name && !a.nameLocation);
    if (!named.length) return opt;
    named.forEach((a) => {
      a.nameLocation = 'end';
      a.nameTextStyle = Object.assign({ align: 'left', padding: [0, 0, 4, -2] }, a.nameTextStyle || {});
    });
    [].concat(opt.grid || []).forEach((g) => {
      if (g && typeof g.top === 'number' && g.top < NAME_ROOM) g.top = NAME_ROOM;
    });
    return opt;
  }

  // A chart that cannot be built leaves its own container with an explanation
  // rather than an empty box, and takes itself out of the live list.
  function failed(el, chart, name, err, message) {
    console.error('chart', name, err);
    if (chart) {
      const at = live.indexOf(chart);
      if (at >= 0) live.splice(at, 1);
      delete built[name];
      try { chart.dispose(); } catch (e) { /* already gone */ }
    }
    el.innerHTML = `<div class="chart-note" style="padding:22px">${message}</div>`;
  }

  const NO_WEBGL = 'This chart needs WebGL, which this browser has disabled.';
  const NO_GEOMETRY = 'The map geometry could not be loaded, so this map cannot be drawn.';

  /* ECharts-GL is 166 KB and draws two charts on this site. Loading it from
     the page head made every route pay for them, so it is injected here the
     first time one of those two is actually on screen — with the same SRI hash
     the head used to carry, so the integrity guarantee is unchanged. */
  const GL_CHARTS = ['deaths-3d', 'infra-3d'];
  const GL_SRC = 'https://cdn.jsdelivr.net/npm/echarts-gl@2.0.9/dist/echarts-gl.min.js';
  const GL_SRI = 'sha384-f4gAUkb5Y6LE9n50CbiH1hCBCw7021OeJu0ZrgRpgW6G1CZjPR8cu33e8rCFLqCl';
  let glPromise = null;

  function ensureGL() {
    if (window.echarts && echarts.graphicGL) return Promise.resolve();
    if (!glPromise) {
      glPromise = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = GL_SRC;
        tag.integrity = GL_SRI;
        tag.crossOrigin = 'anonymous';
        tag.referrerPolicy = 'no-referrer';
        tag.onload = resolve;
        tag.onerror = () => { glPromise = null; reject(new Error('echarts-gl did not load')); };
        document.head.appendChild(tag);
      });
    }
    return glPromise;
  }

  function init(root, payload) {
    data = payload;
    readTheme();
    root.querySelectorAll('[data-chart]').forEach((el) => {
      const name = el.getAttribute('data-chart');
      if (!R[name]) return;
      if (GL_CHARTS.indexOf(name) >= 0 && !(window.echarts && echarts.graphicGL)) {
        ensureGL()
          .then(() => { if (el.isConnected) build(el, name); })
          .catch((err) => failed(el, null, name, err, NO_WEBGL));
        return;
      }
      build(el, name);
    });
  }

  function build(el, name) {
    // A single bad chart (e.g. no WebGL for the 3D ones) must not stop the page.
    let chart;
      try {
        chart = echarts.init(el, null, { renderer: 'canvas' });
        const option = R[name]();
        // The maps fetch their geometry on demand and return a promise.
        if (option && typeof option.then === 'function') {
          option
            .then((ready) => chart.setOption(placeAxisNames(ready)))
            .catch((err) => failed(el, chart, name, err, NO_GEOMETRY));
        } else {
          chart.setOption(placeAxisNames(option));
        }
      } catch (err) {
        failed(el, chart, name, err, NO_WEBGL);
        return;
      }
      live.push(chart);
      built[name] = chart;
      // Fade the chart in when it first scrolls into view.
      el.style.opacity = 0;
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          el.style.transition = 'opacity .7s ease';
          el.style.opacity = 1;
          chart.resize();
          io.disconnect();
        });
      }, { threshold: 0.06 });
      io.observe(el);
  }

  function dispose() {
    while (live.length) live.pop().dispose();
    Object.keys(built).forEach((k) => delete built[k]);
  }

  /* Charts that branch on NARROW() fix their layout when the option is built,
     so a resize alone leaves a phone-width scene on a desktop canvas. Re-apply
     the options once, on the crossing itself, rather than on every resize tick. */
  let wasNarrow = NARROW();
  window.addEventListener('resize', () => {
    live.forEach((c) => c.resize());
    if (NARROW() === wasNarrow) return;
    wasNarrow = NARROW();
    Object.keys(built).forEach((name) => {
      if (!R[name]) return;
      try { built[name].setOption(R[name](), true); } catch (err) { /* a chart that cannot rebuild keeps the layout it has */ }
    });
  });

  /* ---------------- export ----------------
     Every chart is a canvas, which is invisible to a screen reader and
     impossible to paste into a document. These three turn any built chart
     back into data: a table, a CSV file, and a captioned PNG. */

  const cellValue = (d) => (d && typeof d === 'object' && !Array.isArray(d) ? d.value : d);

  // Pull the plotted series back out of the live option as a header/rows table.
  function table(name) {
    const chart = built[name];
    if (!chart) return null;
    const o = chart.getOption();
    const series = (o.series || []).filter((s) => /^(bar|line|pie|funnel|scatter|heatmap|map)$/.test(s.type));
    if (!series.length) return null;

    const axis = (a) => (a && a[0] && a[0].data ? a[0].data.map((d) => (d && d.value !== undefined ? d.value : d)) : null);
    const xCat = axis(o.xAxis);
    const yCat = axis(o.yAxis);

    // A map has no axis: the rows are the regions, and each carries the plain
    // reading of its own value so the export is not a column of codes.
    if (series[0].type === 'map') {
      return {
        header: ['Country', series[0].name || 'Value'],
        rows: (series[0].data || []).map((d) => [d.name, d.text !== undefined ? d.text : fmt(cellValue(d))]),
      };
    }

    if (series[0].type === 'pie' || series[0].type === 'funnel') {
      return {
        header: ['Item', 'Value'],
        rows: (series[0].data || []).map((d) => [d.name, fmt(cellValue(d))]),
      };
    }

    if (series[0].type === 'heatmap' && xCat && yCat) {
      return {
        header: ['Row', 'Column', 'Value'],
        rows: (series[0].data || []).map((d) => {
          const v = Array.isArray(d) ? d : d.value;
          return [yCat[v[1]], xCat[v[0]], fmt(d.raw !== undefined ? d.raw : v[2])];
        }),
      };
    }

    const cats = xCat && xCat.length ? xCat : yCat;
    if (!cats) return null;
    return {
      header: [''].concat(series.map((s, i) => s.name || 'Series ' + (i + 1))),
      rows: cats.map((c, i) => [String(c)].concat(series.map((s) => {
        const v = cellValue((s.data || [])[i]);
        return v === null || v === undefined ? '—' : fmt(v);
      }))),
    };
  }

  function download(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function csv(name, title) {
    const t = table(name);
    if (!t) return false;
    const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const text = [t.header].concat(t.rows).map((r) => r.map(quote).join(',')).join('\r\n');
    download('data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + text), name + '.csv');
    return true;
  }

  /* A chart pasted into a post without its source is not evidence. The PNG
     carries a caption strip with the title, the source and the URL. */
  function png(name, meta) {
    const chart = built[name];
    if (!chart) return false;
    const url = chart.getDataURL({ pixelRatio: 2, backgroundColor: '#0f1420' });
    const img = new Image();
    img.onload = () => {
      const pad = 28, strip = 128;
      const cv = document.createElement('canvas');
      cv.width = img.width + pad * 2;
      cv.height = img.height + pad + strip;
      const g = cv.getContext('2d');
      g.fillStyle = '#0b0f18';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, pad, pad);

      const x = pad, base = img.height + pad + 34;
      g.fillStyle = C.text;
      g.font = '600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
      g.fillText(String(meta.title || name).slice(0, 74), x, base);
      g.fillStyle = C.text2;
      g.font = '19px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
      g.fillText(String(meta.source || '').slice(0, 96), x, base + 32);
      g.fillStyle = C.muted;
      g.font = '17px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
      g.fillText(meta.url || location.href, x, base + 60);

      g.fillStyle = C.red;
      g.fillRect(0, cv.height - 6, cv.width / 3, 6);
      g.fillStyle = '#ffffff';
      g.fillRect(cv.width / 3, cv.height - 6, cv.width / 3, 6);
      g.fillStyle = '#4fae82';
      g.fillRect((cv.width / 3) * 2, cv.height - 6, cv.width / 3, 6);

      download(cv.toDataURL('image/png'), name + '.png');
    };
    img.src = url;
    return true;
  }

  /* Flip the event layer on a built chart and redraw it. The option is rebuilt
     from the registry rather than patched, so the markLine merges with the
     ceasefire the same way it does on a first render. `notMerge` is required:
     without it the previous markLine survives the update and the layer cannot
     be switched back off. */
  function toggleEvents(name) {
    if (!EVENTED[name]) return null;
    eventsOn[name] = !eventsOn[name];
    const chart = built[name];
    if (chart) chart.setOption(placeAxisNames(R[name]()), { notMerge: true });
    return eventsOn[name];
  }

  return {
    init, dispose, fmt, colours: C, table, csv, png,
    has: (n) => !!R[n], names: () => Object.keys(R),
    hasEvents: (n) => !!EVENTED[n], eventsOn: (n) => !!eventsOn[n], toggleEvents,
    setDay, onDayPick,
  };
})();
