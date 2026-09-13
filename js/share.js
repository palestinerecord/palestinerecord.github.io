/* ============================================================
   share.js — square social cards, drawn in the browser.

   A statement or a figure that travels as a screenshot loses the
   thing that makes it evidence: who said it, when, and where it
   is recorded. These cards carry the quotation or the number
   together with its speaker, its date, its source and the address
   of the page it came from, so the attribution travels with it.

   1080 × 1080 is the square both Instagram and X accept without
   re-cropping; 1200 × 630 is the landscape link card. Nothing here
   depends on a library, and nothing leaves the browser.
   ============================================================ */

const Share = (function () {
  const SIZE = { square: [1080, 1080], wide: [1200, 630] };

  /* The card is pinned to the dark palette rather than reading the page's
     current theme: an image is shared into someone else's context, where it
     should look the same whoever exported it. */
  const INK = {
    bg: '#05070c',
    plate: '#0d121d',
    line: 'rgba(255,255,255,0.10)',
    text: '#f2f5fb',
    text2: '#b9c2d4',
    muted: '#98a2b6',
    accent: '#d9a441',
    red: '#d2534c',
  };

  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
  const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
  const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

  const site = () => (window.Views && Views.origin) || location.origin;

  /* ---------- text ---------- */

  function wrap(ctx, text, width) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* Fit long text by shrinking it rather than by cutting it: a quotation that
     is truncated to fit a card is a quotation that has been edited. */
  function fitted(ctx, text, opts) {
    let size = opts.max;
    for (;;) {
      ctx.font = `${opts.style || ''} ${size}px ${opts.family}`.trim();
      const lines = wrap(ctx, text, opts.width);
      if (lines.length * size * opts.leading <= opts.height || size <= opts.min) {
        return { size, lines, height: lines.length * size * opts.leading };
      }
      size -= 2;
    }
  }

  function draw(ctx, lines, x, y, size, leading) {
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * leading));
    return y + lines.length * size * leading;
  }

  /* ---------- furniture ---------- */

  // The flag, drawn rather than fetched, so a card never waits on a network request.
  function flag(ctx, x, y, w) {
    const h = w * 2 / 3;
    const band = h / 3;
    ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, band);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y + band, w, band);
    ctx.fillStyle = '#007a3d'; ctx.fillRect(x, y + 2 * band, w, band);
    ctx.fillStyle = '#ce1126';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.42, y + h / 2);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function plate(ctx, w, h, pad) {
    ctx.fillStyle = INK.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK.plate;
    ctx.fillRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1);
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1);
    // A red rule down the left edge, the one piece of ornament on the card.
    ctx.fillStyle = INK.red;
    ctx.fillRect(pad * 0.55, pad * 0.55, 6, h - pad * 1.1);
  }

  function masthead(ctx, x, y, w) {
    flag(ctx, x, y - 26, 54);
    ctx.fillStyle = INK.text;
    ctx.font = `600 26px ${SERIF}`;
    ctx.fillText('The Documented Record', x + 70, y);
    ctx.fillStyle = INK.muted;
    ctx.font = `17px ${SANS}`;
    ctx.fillText('Israel & the Occupied Territories · 1917–2026', x + 70, y + 26);
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 52);
    ctx.lineTo(x + w, y + 52);
    ctx.stroke();
  }

  function footer(ctx, x, y, w, source, url) {
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();

    ctx.fillStyle = INK.muted;
    ctx.font = `17px ${SANS}`;
    const lines = wrap(ctx, source || '', w);
    draw(ctx, lines.slice(0, 2), x, y + 30, 17, 1.45);

    ctx.fillStyle = INK.accent;
    ctx.font = `16px ${MONO}`;
    ctx.fillText(String(url || site()).replace(/^https?:\/\//, ''), x, y + 30 + Math.min(lines.length, 2) * 25 + 8);
  }

  function canvas(shape) {
    const [w, h] = SIZE[shape] || SIZE.square;
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    return { el, ctx, w, h };
  }

  /* ---------- the two cards ---------- */

  /* A statement: the verbatim quotation, the speaker, their role at the time,
     the date, and the source as published. Nothing is paraphrased. */
  function statement(item, shape) {
    const { el, ctx, w, h } = canvas(shape || 'square');
    const pad = 84;
    const x = pad;
    const width = w - pad * 2;

    plate(ctx, w, h, pad);
    masthead(ctx, x, pad + 18, width);

    let y = pad + 130;
    if (item.date) {
      ctx.fillStyle = INK.accent;
      ctx.font = `600 18px ${MONO}`;
      ctx.fillText(String(item.date).toUpperCase(), x, y);
      y += 34;
    }

    const footHeight = 116;
    const attribution = 108;
    const quote = fitted(ctx, '“' + item.quote + '”', {
      family: SERIF, style: '600', max: 52, min: 22, leading: 1.34,
      width, height: h - y - pad - footHeight - attribution,
    });
    ctx.fillStyle = INK.text;
    ctx.font = `600 ${quote.size}px ${SERIF}`;
    y = draw(ctx, quote.lines, x, y + quote.size, quote.size, 1.34) + 30;

    ctx.fillStyle = INK.text;
    ctx.font = `600 27px ${SANS}`;
    ctx.fillText(item.speaker || '', x, y);
    y += 30;
    ctx.fillStyle = INK.text2;
    ctx.font = `20px ${SANS}`;
    draw(ctx, wrap(ctx, item.role || '', width).slice(0, 2), x, y, 20, 1.4);

    footer(ctx, x, h - pad - 78, width, item.source, item.url);
    return el;
  }

  /* A figure: the number at the size it deserves, what it counts, and who
     counted it. A number without the last of those is a rumour. */
  function figure(item, shape) {
    const { el, ctx, w, h } = canvas(shape || 'square');
    const pad = 84;
    const x = pad;
    const width = w - pad * 2;

    plate(ctx, w, h, pad);
    masthead(ctx, x, pad + 18, width);

    let y = pad + 210;
    const value = fitted(ctx, String(item.value), {
      family: SERIF, style: '600', max: 190, min: 60, leading: 1.08, width, height: 240,
    });
    ctx.fillStyle = item.tone === 'red' ? INK.red : item.tone === 'amber' ? INK.accent : INK.text;
    ctx.font = `600 ${value.size}px ${SERIF}`;
    y = draw(ctx, value.lines, x, y, value.size, 1.08) + 26;

    const label = fitted(ctx, item.label || '', {
      family: SANS, style: '600', max: 38, min: 22, leading: 1.34, width, height: 160,
    });
    ctx.fillStyle = INK.text;
    ctx.font = `600 ${label.size}px ${SANS}`;
    y = draw(ctx, label.lines, x, y + label.size, label.size, 1.34) + 16;

    if (item.note) {
      const note = fitted(ctx, item.note, {
        family: SANS, max: 22, min: 16, leading: 1.5, width,
        height: Math.max(60, h - y - pad - 150),
      });
      ctx.fillStyle = INK.text2;
      ctx.font = `${note.size}px ${SANS}`;
      draw(ctx, note.lines, x, y + note.size, note.size, 1.5);
    }

    footer(ctx, x, h - pad - 78, width, item.source, item.url);
    return el;
  }

  /* A day: the date, the toll it added and the toll it stood at, and — where
     the record has them — the words spoken that day and the finding standing
     over it. Separately those are three facts; on one date they are the
     argument, which is the whole reason the day route exists. */
  function day(item, shape) {
    const { el, ctx, w, h } = canvas(shape || 'square');
    const pad = 84;
    const x = pad;
    const width = w - pad * 2;
    const footTop = h - pad - 78;

    plate(ctx, w, h, pad);
    masthead(ctx, x, pad + 18, width);

    let y = pad + 140;
    ctx.fillStyle = INK.accent;
    ctx.font = `600 19px ${MONO}`;
    ctx.fillText(String(item.date || '').toUpperCase(), x, y);

    y += 76;
    ctx.fillStyle = INK.red;
    ctx.font = `600 72px ${SERIF}`;
    ctx.fillText(String(item.killed || ''), x, y);

    y += 30;
    ctx.fillStyle = INK.text;
    ctx.font = `600 21px ${SANS}`;
    y = draw(ctx, wrap(ctx, item.killedLabel || '', width).slice(0, 2), x, y, 21, 1.4);

    if (item.total) {
      ctx.fillStyle = INK.text2;
      ctx.font = `19px ${SANS}`;
      y = draw(ctx, wrap(ctx, item.total, width).slice(0, 2), x, y + 8, 19, 1.45);
    }

    y += 20;
    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
    y += 32;

    // The finding is one short line; the quotation takes whatever is left.
    const rulingRoom = item.ruling ? 132 : 0;

    if (item.quote) {
      const quote = fitted(ctx, '“' + item.quote + '”', {
        family: SERIF, style: '600', max: 38, min: 17, leading: 1.32,
        width, height: Math.max(90, footTop - y - rulingRoom - 78),
      });
      ctx.fillStyle = INK.text;
      ctx.font = `600 ${quote.size}px ${SERIF}`;
      y = draw(ctx, quote.lines, x, y + quote.size, quote.size, 1.32) + 18;

      ctx.fillStyle = INK.text;
      ctx.font = `600 19px ${SANS}`;
      ctx.fillText(item.speaker || '', x, y);
      y += 23;
      ctx.fillStyle = INK.muted;
      ctx.font = `16px ${SANS}`;
      y = draw(ctx, wrap(ctx, item.role || '', width).slice(0, 2), x, y, 16, 1.4) + 24;
    }

    if (item.ruling) {
      ctx.fillStyle = INK.accent;
      ctx.font = `600 13px ${MONO}`;
      ctx.fillText('ALREADY ORDERED, AND IN FORCE', x, y);
      y += 26;
      const ruling = fitted(ctx, item.ruling, {
        family: SANS, style: '600', max: 21, min: 14, leading: 1.42,
        width, height: Math.max(48, footTop - y - 24),
      });
      ctx.fillStyle = INK.text;
      ctx.font = `600 ${ruling.size}px ${SANS}`;
      draw(ctx, ruling.lines, x, y + ruling.size, ruling.size, 1.42);
    }

    footer(ctx, x, footTop, width, item.source, item.url);
    return el;
  }

  /* ---------- output ---------- */

  function save(el, name) {
    try {
      const a = document.createElement('a');
      a.href = el.toDataURL('image/png');
      a.download = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 70) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      console.error('share', err);
      return false;
    }
  }

  return {
    statement(item, shape) { return save(statement(item, shape), 'record-' + (item.speaker || 'statement')); },
    figure(item, shape) { return save(figure(item, shape), 'record-' + (item.label || 'figure')); },
    day(item, shape) { return save(day(item, shape), 'record-' + (item.date || 'day')); },
    canvasFor: { statement, figure, day },
  };
})();
