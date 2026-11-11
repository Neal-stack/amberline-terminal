/*
 * Amberline Terminal: the front end.
 * Four independent panels driven by a command line, function keys and a
 * ticker tape. Everything reads from window.AmberlineMarket (market.js),
 * which serves real US market data from Finnhub with the viewer's own key.
 */
(function () {
  'use strict';

  const M = window.AmberlineMarket;
  const I = M.inst;
  const STORE_KEY = 'amberline.layout.live.v2';
  try { localStorage.removeItem('amberline.layout.demo.v2'); } catch (e) { /* storage unavailable */ }
  const TYPE_LABEL = { equity: 'Equity', etf: 'ETF', index: 'Index', cmdty: 'Commodity', fx: 'Currency' };

  // ---------- formatting ----------
  const nfCache = {};
  const ok = v => v != null && isFinite(v);
  function fmt(v, d) {
    if (!ok(v)) return '—';
    const f = nfCache[d] || (nfCache[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    return f.format(v);
  }
  const signed = (v, d) => {
    if (!ok(v)) return '—';
    const r = +v.toFixed(d); // so -0.04 at one decimal reads 0.0, not −0.0
    return (r > 0 ? '+' : r < 0 ? '−' : '') + fmt(Math.abs(r), d);
  };
  const pctStr = v => (ok(v) ? signed(v, 2) + '%' : '—');
  const dirOf = v => (!ok(v) ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '');
  function big(v) {
    if (!ok(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return fmt(v / 1e12, 2) + 'T';
    if (a >= 1e9) return fmt(v / 1e9, 2) + 'B';
    if (a >= 1e6) return fmt(v / 1e6, 2) + 'M';
    if (a >= 1e3) return fmt(v / 1e3, 1) + 'K';
    return fmt(v, 0);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const chg = i => (ok(i.last) && ok(i.prevClose) ? i.last - i.prevClose : null);
  const chgPct = i => (ok(i.last) && i.prevClose ? (i.last / i.prevClose - 1) * 100 : null);
  const val = v => (typeof v === 'function' ? v() : v);

  function flash(el, dir) {
    el.classList.remove('fl-up', 'fl-dn');
    void el.offsetWidth; // restart the animation
    el.classList.add(dir === 'up' ? 'fl-up' : 'fl-dn');
  }
  function put(el, text, dir) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (dir) flash(el, dir);
  }
  function setDir(el, v) {
    const d = dirOf(v);
    el.classList.toggle('up', d === 'up');
    el.classList.toggle('dn', d === 'dn');
  }

  // ---------- canvas charts ----------
  const css = getComputedStyle(document.documentElement);
  const C = {};
  ['ink', 'panel', 'rule', 'grid', 'amber', 'amber-dim', 'text', 'muted', 'up', 'dn', 'link', 'key'].forEach(k => { C[k] = css.getPropertyValue('--' + k).trim(); });
  const MONO = css.getPropertyValue('--font-data').trim() || 'monospace';
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function sizeCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }

  function hline(ctx, x1, x2, y) { ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
  function vline(ctx, x, y1, y2) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke(); }

  // o: { style, dec, vol, ref, ma: {src, off}, hover, xlabel }
  function drawChart(cv, bars, o) {
    const { ctx, W, H } = sizeCanvas(cv);
    const n = bars.length;
    if (W < 60 || H < 60 || !n) return null;
    const line = o.style === 'line';
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const b of bars) {
      lo = Math.min(lo, line ? b.c : b.l);
      hi = Math.max(hi, line ? b.c : b.h);
      vmax = Math.max(vmax, b.v || 0);
    }
    if (ok(o.ref)) { lo = Math.min(lo, o.ref); hi = Math.max(hi, o.ref); }
    const span = (hi - lo) * 0.08 || hi * 0.01 || 1;
    lo -= span; hi += span;

    ctx.font = '600 11px ' + MONO;
    const padL = 4, padT = 10, padB = 20;
    const padR = Math.ceil(ctx.measureText(fmt(hi, o.dec)).width) + 18;
    const hasVol = o.vol && vmax > 0;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const priceH = hasVol ? plotH * 0.8 : plotH;
    const volTop = padT + priceH + 4, volH = hasVol ? plotH - priceH - 4 : 0;
    const bw = plotW / n;
    const y = v => padT + (hi - v) / (hi - lo) * priceH;
    const x = k => padL + bw * (k + 0.5);
    const body = Math.max(1, Math.min(bw * 0.7, 14));

    // grid and price axis
    ctx.font = '11px ' + MONO;
    ctx.lineWidth = 1;
    const step = niceStep(hi - lo, Math.max(3, Math.round(priceH / 44)));
    const axDec = Math.min(o.dec, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = C.grid;
      hline(ctx, padL, padL + plotW, yy);
      ctx.fillStyle = C.muted;
      ctx.fillText(fmt(v, axDec), padL + plotW + 8, yy);
    }

    // time axis: evenly spaced, or one label per month on long daily charts
    const maxLabels = Math.max(2, Math.floor(plotW / 84));
    let marks = [];
    if (o.monthly) {
      for (let k = 1; k < n; k++) if (o.xlabel(bars[k]) !== o.xlabel(bars[k - 1])) marks.push(k);
      const thin = Math.ceil(marks.length / maxLabels);
      const jan = marks.findIndex(k => o.xlabel(bars[k]).includes("'"));
      const anchor = jan < 0 ? 0 : jan % thin; // keep January, which carries the year
      marks = marks.filter((_, j) => (j - anchor) % thin === 0);
    } else {
      const every = Math.max(1, Math.ceil(n / maxLabels));
      for (let k = 0; k < n; k += every) marks.push(k);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const k of marks) {
      const xx = Math.round(x(k)) + 0.5;
      ctx.strokeStyle = C.grid;
      vline(ctx, xx, padT, padT + plotH);
      const label = o.xlabel(bars[k]);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = C.muted;
      ctx.fillText(label, Math.max(padL + w / 2, Math.min(xx, padL + plotW - w / 2)), H - 6);
    }

    // previous close
    if (ok(o.ref)) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = C['amber-dim'];
      hline(ctx, padL, padL + plotW, Math.round(y(o.ref)) + 0.5);
      ctx.restore();
    }

    // volume
    if (hasVol) {
      for (let k = 0; k < n; k++) {
        const b = bars[k], h = (b.v || 0) / vmax * volH;
        ctx.fillStyle = alpha(b.c >= b.o ? C.up : C.dn, 0.4);
        ctx.fillRect(x(k) - body / 2, volTop + volH - h, body, h);
      }
    }

    // price series
    if (line) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
      grad.addColorStop(0, alpha(C.amber, 0.26));
      grad.addColorStop(1, alpha(C.amber, 0));
      ctx.beginPath();
      bars.forEach((b, k) => (k ? ctx.lineTo(x(k), y(b.c)) : ctx.moveTo(x(k), y(b.c))));
      ctx.lineTo(x(n - 1), padT + priceH);
      ctx.lineTo(x(0), padT + priceH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      bars.forEach((b, k) => (k ? ctx.lineTo(x(k), y(b.c)) : ctx.moveTo(x(k), y(b.c))));
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      for (let k = 0; k < n; k++) {
        const b = bars[k], col = b.c >= b.o ? C.up : C.dn;
        const xx = Math.round(x(k)) + 0.5;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        vline(ctx, xx, y(b.h), y(b.l));
        const y1 = y(Math.max(b.o, b.c)), y2 = y(Math.min(b.o, b.c));
        ctx.fillRect(Math.round(xx - body / 2), Math.round(y1), Math.max(1, Math.round(body)), Math.max(1, Math.round(y2 - y1)));
      }
    }

    // moving averages, computed on the full daily history
    if (o.ma) {
      const src = o.ma.src;
      [[20, C.link], [50, C.key]].forEach(([len, col]) => {
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < n; k++) {
          const end = o.ma.off + k;
          if (end < len - 1) continue;
          let s = 0;
          for (let j = end - len + 1; j <= end; j++) s += src[j].c;
          const yy = y(s / len);
          if (started) ctx.lineTo(x(k), yy); else { ctx.moveTo(x(k), yy); started = true; }
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.lineWidth = 1;
      });
    }

    // crosshair
    if (o.hover != null) {
      const k = Math.min(o.hover, n - 1);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = C.muted;
      vline(ctx, Math.round(x(k)) + 0.5, padT, padT + plotH);
      hline(ctx, padL, padL + plotW, Math.round(y(bars[k].c)) + 0.5);
      ctx.restore();
    }

    // last-price tag on the axis
    const last = bars[n - 1].c, ly = Math.max(padT + 8, Math.min(padT + priceH - 8, y(last)));
    ctx.fillStyle = C.amber;
    ctx.fillRect(padL + plotW + 2, ly - 8, padR - 4, 16);
    ctx.fillStyle = C.ink;
    ctx.font = '600 11px ' + MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(last, o.dec), padL + plotW + 7, ly + 0.5);

    return { padL, bw, n };
  }

  function drawSpark(cv, values, color) {
    const { ctx, W, H } = sizeCanvas(cv);
    if (W < 10 || H < 10 || values.length < 2) return;
    const lo = Math.min(...values), hi = Math.max(...values);
    const x = k => k / (values.length - 1) * (W - 2) + 1;
    const y = v => 3 + (hi - v) / (hi - lo || 1) * (H - 6);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, alpha(color, 0.22));
    grad.addColorStop(1, alpha(color, 0));
    ctx.beginPath();
    values.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
    ctx.lineTo(W - 1, H);
    ctx.lineTo(1, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    values.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x(values.length - 1), y(values[values.length - 1]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function sparkSVG(values) {
    if (values.length < 2) return '<span class="muted">—</span>';
    const lo = Math.min(...values), hi = Math.max(...values);
    const pts = values.map((v, k) => `${(k / (values.length - 1) * 78 + 1).toFixed(1)},${(2 + (hi - v) / (hi - lo || 1) * 14).toFixed(1)}`).join(' ');
    return `<svg class="spk" viewBox="0 0 80 18" width="80" height="18" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
  }

  function pctBar(p) {
    if (!ok(p)) return '';
    const w = Math.min(50, Math.abs(p) * 25);
    return `<span class="pbar"><i style="${p >= 0 ? 'left:50%' : 'right:50%'};width:${w.toFixed(1)}%"></i></span>`;
  }

  // ---------- quote tables ----------
  const COL = {
    sym: { k: 'sym', label: 'Ticker', cls: 'sym', get: i => i.sym },
    name: { k: 'name', label: 'Name', cls: 'name', get: i => i.name },
    proxy: { k: 'proxy', label: 'Market', cls: 'name', get: i => i.proxy || i.name },
    last: { k: 'last', label: 'Last', num: 1, live: 1, get: i => fmt(i.last, i.dec) },
    chg: { k: 'chg', label: 'Net chg', num: 1, dir: 1, get: i => signed(chg(i), i.dec) },
    pct: { k: 'pct', label: '% chg', num: 1, dir: 1, get: i => pctStr(chgPct(i)) },
    bar: { k: 'bar', label: '', html: 1, dir: 1, get: i => pctBar(chgPct(i)) },
    rng: { k: 'rng', label: 'Day range', num: 1, cls: 'muted', opt: 1, get: i => { const d = M.day(i); return fmt(d.l, i.dec) + ' – ' + fmt(d.h, i.dec); } },
    spark: { k: 'spark', label: 'Today', html: 1, dir: 1, opt: 1, get: i => sparkSVG(i.ticks.map(b => b.c)) },
    upd: { k: 'upd', label: 'As of', num: 1, cls: 'muted', opt: 1, get: i => (i.dataAt ? timeAgo(i.dataAt) : i.missing ? 'no quote' : M.authError() ? 'no data' : 'loading') }
  };
  function timeAgo(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 5 ? 'now' : s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago';
  }

  function quoteTable(host, groups, cols, onRow) {
    const cls = c => [c.cls, c.num && 'num', c.opt && 'opt'].filter(Boolean).join(' ');
    host.innerHTML = `<table class="qt"><thead><tr>${cols.map(c => `<th class="${[c.num && 'num', c.opt && 'opt'].filter(Boolean).join(' ')}" scope="col">${c.label}</th>`).join('')}</tr></thead>` +
      groups.map(g => `<tbody>${g.label ? `<tr class="grp"><th colspan="${cols.length}" scope="rowgroup">${esc(g.label)}</th></tr>` : ''}` +
        g.syms.map(s => `<tr data-sym="${esc(s)}" tabindex="0">${cols.map(c => `<td class="${cls(c)}"></td>`).join('')}</tr>`).join('') +
        '</tbody>').join('') + '</table>';
    const rows = [...host.querySelectorAll('tr[data-sym]')].map(tr => ({ inst: I[tr.dataset.sym], cells: [...tr.children] }));
    function update(first) {
      rows.forEach(r => cols.forEach((c, j) => {
        const td = r.cells[j], v = c.get(r.inst);
        if (c.html) { if (td.innerHTML !== v) td.innerHTML = v; } else put(td, v, !first && c.live ? r.inst.dir : null);
        if (c.dir) setDir(td, chg(r.inst));
        if (c.dirOf) setDir(td, c.dirOf(r.inst));
      }));
    }
    const go = tr => tr && onRow(tr.dataset.sym);
    host.addEventListener('click', e => go(e.target.closest('tr[data-sym]')));
    host.addEventListener('keydown', e => { if (e.key === 'Enter') go(e.target.closest('tr[data-sym]')); });
    update(true);
    return update;
  }

  function notice(host, html, kind) {
    host.innerHTML = `<div class="notice ${kind || ''}">${html}</div>`;
  }
  function errText(err) {
    return esc(err && err.message ? err.message : 'Something went wrong loading this data.');
  }

  // ---------- functions ----------
  const FN = Object.create(null);
  const TFS = ['1D', '1M', '3M', '6M', '1Y'];

  FN.GP = {
    name: 'Price Graph', sec: 'req', example: 'AAPL GP 6M',
    help: 'Candlestick or line chart with volume and 20/50-day moving averages. Add 1D, 1M, 3M, 6M or 1Y.',
    mount(p, s) {
      const i = I[s.sym];
      s.tf = TFS.includes(s.tf) ? s.tf : '1D';
      s.style = s.style === 'line' ? 'line' : 'candle';
      p.body.innerHTML = `
        <div class="gp">
          <div class="gp-top">
            <div class="quote"><span class="q-last"></span><span class="q-chg"></span><span class="q-unit">${esc(i.unit)}</span></div>
            <div class="seg" data-k="tf" role="group" aria-label="Timeframe">${TFS.map(t => `<button type="button" data-v="${t}">${t}</button>`).join('')}</div>
            <div class="seg" data-k="style" role="group" aria-label="Chart style"><button type="button" data-v="candle">Candle</button><button type="button" data-v="line">Line</button></div>
          </div>
          <p class="chart-note" hidden></p>
          <div class="chart"><canvas role="img" aria-label="Price chart for ${esc(i.name)}"></canvas><div class="legend"></div><div class="chart-msg" hidden></div></div>
        </div>`;
      const cv = p.body.querySelector('canvas');
      const legend = p.body.querySelector('.legend');
      const note = p.body.querySelector('.chart-note');
      const msg = p.body.querySelector('.chart-msg');
      const qLast = p.body.querySelector('.q-last'), qChg = p.body.querySelector('.q-chg');
      let hover = null, geo = null, sr = null, req = 0, dead = false;

      const syncSeg = () => p.body.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.v === s[g.dataset.k]));
        const noHistory = M.candles() === false && g.dataset.k === 'tf' && b.dataset.v !== '1D';
        b.disabled = noHistory;
        b.title = noHistory ? 'Needs historical candles, which your Finnhub plan does not include' : '';
      }));
      p.body.querySelectorAll('.seg').forEach(g => g.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        const k = g.dataset.k;
        s[k] = b.dataset.v;
        hover = null;
        syncSeg(); save();
        if (k === 'tf') fetchBars(); else draw();
      }));

      function fetchBars() {
        const my = ++req;
        sr = null;
        msg.hidden = false;
        msg.textContent = 'Loading chart…';
        legend.textContent = '';
        sizeCanvas(cv);
        M.bars(s.sym, s.tf).then(r => {
          if (dead || my !== req) return;
          sr = r;
          if (r.kind === 'ticks' && s.tf !== '1D') { s.tf = '1D'; save(); }
          syncSeg();
          note.hidden = !r.note;
          note.textContent = r.note || '';
          draw();
        }, err => {
          if (dead || my !== req) return;
          msg.hidden = false;
          msg.innerHTML = errText(err);
        });
      }
      function draw() {
        if (!sr) return;
        const bars = sr.series();
        if (!bars.length) {
          sizeCanvas(cv);
          legend.textContent = '';
          msg.hidden = false;
          msg.textContent = 'Waiting for the first trade. Outside market hours this can take until the next session opens.';
          return;
        }
        msg.hidden = true;
        if (hover != null) hover = Math.min(hover, bars.length - 1);
        const ma = sr.ma ? sr.ma() : null;
        geo = drawChart(cv, bars, {
          style: sr.kind === 'ticks' ? 'line' : s.style, dec: i.dec, vol: true, hover,
          ref: sr.ref ? sr.ref() : null, ma, xlabel: sr.xlabel, monthly: sr.monthly
        });
        const b = bars[hover != null ? hover : bars.length - 1];
        legend.innerHTML = `<span class="lt">${esc(sr.tlabel(b))}</span>` +
          (sr.kind === 'ticks' ? `Last <b>${fmt(b.c, i.dec)}</b>` :
            `O <b>${fmt(b.o, i.dec)}</b>H <b>${fmt(b.h, i.dec)}</b>L <b>${fmt(b.l, i.dec)}</b>C <b>${fmt(b.c, i.dec)}</b>` + (b.v ? `V <b>${big(b.v)}</b>` : '')) +
          (ma ? '<span class="ma20">MA20</span><span class="ma50">MA50</span>' : ok(sr.ref && sr.ref()) ? '<span class="ref">--- prev close</span>' : '');
      }
      cv.addEventListener('pointermove', e => {
        if (!geo) return;
        const r = cv.getBoundingClientRect();
        hover = Math.max(0, Math.min(geo.n - 1, Math.floor((e.clientX - r.left - geo.padL) / geo.bw)));
        draw();
      });
      cv.addEventListener('pointerleave', () => { hover = null; draw(); });
      const ro = new ResizeObserver(draw);
      ro.observe(cv);

      function quote() {
        put(qLast, fmt(i.last, i.dec), i.dir);
        qChg.textContent = signed(chg(i), i.dec) + '  ' + pctStr(chgPct(i));
        setDir(qChg, chg(i));
      }
      syncSeg(); quote(); fetchBars();
      return { syms: () => [s.sym], tick() { quote(); draw(); }, destroy() { dead = true; ro.disconnect(); } };
    }
  };

  FN.DES = {
    name: 'Description', sec: 'req', example: 'MSFT DES',
    help: 'Company profile, key statistics, 52-week range and peers.',
    mount(p, s) {
      const i = I[s.sym];
      const rows = [['Last', 'last'], ['Net change', 'chg'], ['Open', 'open'], ['Previous close', 'pc'], ['Day range', 'rng'],
        ['Market cap', 'cap'], ['P/E (trailing)', 'pe'], ['EPS (trailing)', 'eps'], ['Dividend yield', 'div'], ['Shares outstanding', 'sh'],
        ['Beta', 'beta'], ['10-day avg volume', 'avg']];
      p.body.innerHTML = `
        <div class="des">
          <div class="des-head">
            <div><h3 class="des-name">${esc(i.name)}</h3><p class="des-sub">${esc(i.sym)} · ${TYPE_LABEL[i.type] || 'Security'} · <span class="des-sector">${esc(i.group)}</span></p></div>
            <div class="quote"><span class="q-last"></span><span class="q-chg"></span></div>
          </div>
          <div class="des-grid">
            <table class="kv"><tbody>${rows.map(([l, k]) => `<tr data-row="${k}"><th scope="row">${l}</th><td data-f="${k}">…</td></tr>`).join('')}</tbody></table>
            <div class="des-side">
              <div class="r52">
                <div class="r52-lbl"><span>52-week low <b data-f="lo52">…</b></span><span>high <b data-f="hi52">…</b></span></div>
                <div class="r52-track"><i></i></div>
              </div>
              <div class="spark-box" hidden><div class="label spark-lbl">One year, daily close</div>
              <div class="spark-wrap"><canvas role="img" aria-label="One-year price line"></canvas></div></div>
              <p class="about" hidden></p>
              <dl class="facts"></dl>
              <div class="chips"><span class="label">Open</span>
                <button type="button" class="chip" data-go="GP"><span class="fn">GP</span> Price graph</button>
                <button type="button" class="chip" data-go="NEWS"><span class="fn">NEWS</span> Headlines</button>
                ${i.type === 'equity' ? ['ANR', 'ERN', 'FA', 'INS'].map(f => `<button type="button" class="chip" data-go="${f}"><span class="fn">${f}</span> ${esc(FN[f].name)}</button>`).join('') : ''}
                <button type="button" class="chip" data-wl></button>
              </div>
              <div class="chips peers" hidden><span class="label">Peers</span></div>
              <p class="src-note"></p>
            </div>
          </div>
        </div>`;
      const f = {};
      p.body.querySelectorAll('[data-f]').forEach(el => { f[el.dataset.f] = el; });
      const qLast = p.body.querySelector('.q-last'), qChg = p.body.querySelector('.q-chg');
      const marker = p.body.querySelector('.r52-track i');
      const cv = p.body.querySelector('.spark-wrap canvas');
      let prof = null, dead = false;
      const wlBtn = p.body.querySelector('[data-wl]');
      const wlSync = () => { const on = wlRead().includes(i.sym); wlBtn.textContent = on ? '✓ On watchlist' : '+ Watchlist'; wlBtn.setAttribute('aria-pressed', String(on)); };
      wlSync();
      p.body.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.go) load(p, { fn: b.dataset.go, sym: i.sym });
        if (b.dataset.sym) open(p, 'DES', b.dataset.sym);
        if (b.hasAttribute('data-wl')) {
          const list = wlRead();
          wlWrite(list.includes(i.sym) ? list.filter(x => x !== i.sym) : list.concat(i.sym));
          wlSync();
          wlRefresh();
        }
      });
      const spark = () => { if (prof && prof.spark) drawSpark(cv, prof.spark(), i.last >= prof.spark()[0] ? C.up : C.dn); };
      const ro = new ResizeObserver(spark);
      ro.observe(cv);

      M.profile(s.sym).then(pr => {
        if (dead) return;
        prof = pr;
        p.body.querySelector('.des-name').textContent = i.name;
        p.body.querySelector('.des-sector').textContent = pr.sector || i.group;
        if (pr.about) { const a = p.body.querySelector('.about'); a.hidden = false; a.textContent = pr.about; }
        const facts = (pr.facts || []).slice();
        p.body.querySelector('.facts').innerHTML = facts.map(([dt, dd]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd></div>`).join('') +
          (pr.web ? `<div><dt>Website</dt><dd><a href="${esc(pr.web)}" target="_blank" rel="noopener noreferrer">${esc(new URL(pr.web).hostname.replace(/^www\./, ''))}</a></dd></div>` : '');
        if (pr.peers && pr.peers.length) {
          const box = p.body.querySelector('.peers');
          box.hidden = false;
          box.insertAdjacentHTML('beforeend', pr.peers.map(x => `<button type="button" class="chip" data-sym="${esc(x)}">${esc(x)}</button>`).join(''));
        }
        if (pr.spark) { p.body.querySelector('.spark-box').hidden = false; spark(); }
        p.body.querySelector('.src-note').textContent = pr.error ? 'Profile unavailable: ' + pr.error.message
          : 'Profile and statistics from ' + M.source + '. ' + (M.feed().state === 'live' ? 'Quotes update as trades stream in.' : 'Quotes refresh about once a minute.');
        update();
      }, err => { if (!dead) p.body.querySelector('.src-note').textContent = 'Profile unavailable: ' + (err && err.message || 'unknown error'); });

      function update() {
        const d = M.day(i);
        put(qLast, fmt(i.last, i.dec), i.dir);
        qChg.textContent = signed(chg(i), i.dec) + '  ' + pctStr(chgPct(i));
        setDir(qChg, chg(i));
        const st = prof ? prof.stats || {} : null;
        const S = k => (st ? val(st[k]) : undefined);
        const pending = '…';
        const v = {
          last: fmt(i.last, i.dec), chg: ok(chg(i)) ? signed(chg(i), i.dec) + ' (' + pctStr(chgPct(i)) + ')' : '—',
          open: fmt(d.o, i.dec), pc: fmt(i.prevClose, i.dec), rng: fmt(d.l, i.dec) + ' – ' + fmt(d.h, i.dec),
          cap: !st ? pending : ok(S('cap')) ? '$' + big(S('cap')) : '—',
          pe: !st ? pending : !ok(S('pe')) ? '—' : S('pe') > 0 ? fmt(S('pe'), 1) + '×' : 'n/m (loss)',
          eps: !st ? pending : ok(S('eps')) ? '$' + fmt(S('eps'), 2) : '—',
          div: !st ? pending : ok(S('div')) ? (S('div') ? fmt(S('div'), 2) + '%' : 'None') : '—',
          sh: !st ? pending : big(S('sh')), beta: !st ? pending : fmt(S('beta'), 2),
          avg: !st ? pending : big(S('avgVol')),
          lo52: !st ? pending : fmt(S('lo52'), i.dec), hi52: !st ? pending : fmt(S('hi52'), i.dec)
        };
        for (const k in f) put(f[k], v[k], k === 'last' ? i.dir : null);
        setDir(f.chg, chg(i));
        const lo = S('lo52'), hi = S('hi52');
        marker.hidden = !(ok(lo) && ok(hi) && ok(i.last));
        if (!marker.hidden) marker.style.left = Math.max(0, Math.min(100, (i.last - lo) / (hi - lo || 1) * 100)).toFixed(2) + '%';
      }
      update();
      let n = 0;
      return { syms: () => [s.sym], tick() { update(); if (++n % 10 === 0) spark(); }, destroy() { dead = true; ro.disconnect(); } };
    }
  };

  function tableFn(name, help, groupsFn, colsFn, row, liveNote) {
    return {
      name, help, sec: 'none',
      mount(p) {
        const groups = groupsFn();
        p.body.innerHTML = '<div class="tbl-wrap"></div>' + (liveNote ? `<p class="tbl-note">${liveNote}</p>` : '');
        const update = quoteTable(p.body.firstChild, groups, colsFn(), sym => open(p, row(sym), sym));
        return { syms: () => groups.flatMap(g => g.syms), tick: () => update(false) };
      }
    };
  }

  FN.WEI = tableFn('World Equity Indices', 'Country and benchmark ETFs by region, as stand-ins for index levels.',
    () => M.universe.world,
    () => [COL.proxy, COL.sym, COL.last, COL.chg, COL.pct, COL.bar, COL.rng], () => 'GP',
    'Prices are for US-listed ETFs that track each market, not index levels. Finnhub\'s free plan doesn\'t include index levels.');
  FN.CMDTY = tableFn('Commodities', 'Energy, metals and agriculture through the ETFs that track them.',
    () => M.universe.cmdty,
    () => [COL.proxy, COL.sym, COL.last, COL.chg, COL.pct, COL.rng, COL.upd], () => 'GP',
    'Prices are for US-listed ETFs that hold each commodity or its futures, not futures prices. Finnhub\'s free plan doesn\'t include futures.');
  FN.MON = tableFn('Equity Monitor', 'Twenty US large caps with day range, an intraday line and how fresh each quote is.',
    () => [{ label: null, syms: M.universe.monitor }],
    () => [COL.sym, COL.name, COL.last, COL.chg, COL.pct, COL.rng, COL.spark, COL.upd], () => 'DES');

  FN.MOST = {
    name: 'Movers', sec: 'none', example: 'MOST',
    help: 'The biggest gainers and losers among the large caps in the monitor.',
    mount(p, s) {
      const TABS = { gainers: 'Gainers', losers: 'Losers' };
      s.tab = TABS[s.tab] ? s.tab : Object.keys(TABS)[0];
      p.body.innerHTML = `<div class="most"><div class="most-top"><div class="seg" role="group" aria-label="Ranking">${Object.keys(TABS).map(k => `<button type="button" data-v="${k}">${TABS[k]}</button>`).join('')}</div></div><div class="tbl-wrap"></div></div>`;
      let host = p.body.querySelector('.tbl-wrap');
      let update;
      const cols = [COL.sym, COL.name, COL.last, COL.chg, COL.pct, COL.rng];
      function render() {
        p.body.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s.tab)));
        const all = M.universe.monitor.map(x => I[x]).filter(x => ok(chgPct(x)));
        const sorted = all.filter(x => (s.tab === 'gainers' ? chgPct(x) > 0 : chgPct(x) < 0)).sort((a, b) => (s.tab === 'gainers' ? 1 : -1) * (chgPct(b) - chgPct(a)));
        const fresh = host.cloneNode(false);
        host.replaceWith(fresh);
        host = fresh;
        if (!sorted.length) {
          notice(host, !all.length ? 'Waiting for quotes…' : s.tab === 'gainers' ? 'Nothing in the monitor is up today.' : 'Nothing in the monitor is down today.');
          update = () => {};
          return;
        }
        update = quoteTable(host, [{ label: null, syms: sorted.slice(0, 12).map(x => x.sym) }], cols, sym => open(p, 'DES', sym));
      }
      p.body.querySelector('.seg').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        s.tab = b.dataset.v;
        save();
        render();
      });
      render();
      let n = 0;
      return { syms: () => M.universe.monitor, tick() { if (++n % 5 === 0 && !host.contains(document.activeElement)) render(); else update(false); } };
    }
  };

  FN.FXC = tableFn('Currencies', 'Currency ETFs against the US dollar. Finnhub\'s free plan doesn\'t include spot FX rates.',
    () => [{ label: 'Currency ETFs', syms: M.universe.fx }], () => [COL.proxy, COL.sym, COL.last, COL.chg, COL.pct, COL.bar, COL.rng], () => 'GP',
    'Prices are for currency ETFs in US dollars, not exchange rates. Finnhub\'s free plan doesn\'t include spot FX rates.');

  FN.CRV = {
    name: 'Treasuries', sec: 'none', example: 'CRV',
    help: 'Treasury ETFs from T-bills to 20+ years, ordered by duration. Bond prices fall when yields rise.',
    mount(p) {
      const syms = M.universe.rates;
      p.body.innerHTML = `
        <div class="crv">
          <div class="crv-top"><span class="label">Today's % change by maturity bucket</span></div>
          <div class="chart"><canvas role="img" aria-label="Bar chart of Treasury ETF changes by maturity"></canvas></div>
          <div class="tbl-wrap crv-tbl"></div>
          <p class="tbl-note">These are ETF prices, not yields. When yields rise, longer-maturity bond prices fall the most. Finnhub's free plan doesn't include Treasury yields.</p>
        </div>`;
      const cv = p.body.querySelector('canvas');
      const update = quoteTable(p.body.querySelector('.crv-tbl'), [{ label: null, syms }], [COL.proxy, COL.sym, COL.last, COL.chg, COL.pct, COL.upd], sym => open(p, 'GP', sym));
      function draw() {
        const { ctx, W, H } = sizeCanvas(cv);
        if (W < 60 || H < 60) return;
        const vals = syms.map(s => chgPct(I[s]));
        const m = Math.max(0.25, ...vals.filter(ok).map(Math.abs)) * 1.2;
        const padL = 8, padR = 52, padT = 10, padB = 22;
        const n = syms.length, cw = (W - padL - padR) / n;
        const y = v => padT + (m - v) / (2 * m) * (H - padT - padB);
        ctx.font = '11px ' + MONO;
        ctx.strokeStyle = C.grid;
        [-m / 1.2, 0, m / 1.2].forEach(v => {
          hline(ctx, padL, W - padR, Math.round(y(v)) + 0.5);
          ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(signed(v, 2) + '%', W - padR + 6, y(v));
        });
        syms.forEach((s, k) => {
          const v = vals[k];
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.muted;
          ctx.fillText(I[s].short, padL + cw * (k + 0.5), H - 6);
          if (!ok(v)) return;
          ctx.fillStyle = v >= 0 ? C.up : C.dn;
          const y0 = y(0), y1 = y(v);
          ctx.fillRect(padL + cw * k + cw * 0.2, Math.min(y0, y1), cw * 0.6, Math.max(1, Math.abs(y1 - y0)));
        });
      }
      const ro = new ResizeObserver(draw);
      ro.observe(cv);
      return { syms: () => syms, tick() { update(false); draw(); }, destroy() { ro.disconnect(); } };
    }
  };

  function newsMount(p, sym) {
    p.body.innerHTML = '<ol class="news" aria-busy="true"><li class="empty">Loading headlines…</li></ol>' +
      (M.source === 'Astral' ? '<p class="tbl-note">Company news shows recent SEC filings from Astral, linked to the filing on sec.gov.</p>' : '<p class="tbl-note">Headlines and summaries from Finnhub and its publishers. Amberline doesn\'t write or verify them.</p>');
    const ol = p.body.firstChild;
    let dead = false, loading = false;
    function render(items) {
      const focused = ol.contains(document.activeElement) ? document.activeElement.dataset.id : null;
      ol.removeAttribute('aria-busy');
      ol.innerHTML = items.map(n => `<li data-id="${esc(n.id)}" tabindex="0" role="button" class="${n.hot ? 'hot' : ''}">
          <time>${esc(n.when)}</time><span class="src" title="${esc(n.src)}">${esc(n.src)}</span><span class="head">${esc(n.head)}</span><span class="tk">${esc(n.syms.join(' '))}</span></li>`).join('') ||
        `<li class="empty">${sym ? `No ${esc(sym)} headlines in the last week.` : 'No headlines right now.'}</li>`;
      if (focused && p.i === active) {
        const again = [...ol.children].find(li => li.dataset.id === focused);
        if (again) again.focus({ preventScroll: true });
      }
    }
    function fetchNews() {
      if (loading) return;
      loading = true;
      M.news(sym).then(items => { if (!dead) render(items); }, err => { if (!dead) ol.innerHTML = `<li class="empty">${errText(err)}</li>`; })
        .finally(() => { loading = false; });
    }
    const openStory = li => li && li.dataset.id && load(p, { fn: 'STORY', id: li.dataset.id, sym: sym || null });
    ol.addEventListener('click', e => openStory(e.target.closest('li')));
    ol.addEventListener('keydown', e => { if (e.key === 'Enter') openStory(e.target.closest('li')); });
    let seen = M.newsVersion();
    fetchNews();
    return { syms: () => (sym ? [sym] : []), tick() { const v = M.newsVersion(); if (v !== seen) { seen = v; fetchNews(); } }, destroy() { dead = true; } };
  }

  FN.TOP = { name: 'Top News', sec: 'none', example: 'TOP', help: 'Market headlines from Finnhub, newest first. Select one to read the summary.', mount: p => newsMount(p, null) };
  FN.NEWS = { name: 'Company News', sec: 'req', example: 'NVDA NEWS', help: 'Headlines about one company from the last seven days.', mount: (p, s) => newsMount(p, s.sym) };
  FN.STORY = {
    name: 'Story', sec: 'none', hidden: true,
    mount(p, s) {
      const n = M.story(s.id);
      if (!n) {
        p.body.innerHTML = '<article class="story"><p class="meta">This story is no longer in the feed.</p><button type="button" class="chip" data-back>◀ Headlines</button></article>';
      } else {
        p.body.innerHTML = `<article class="story">
          <button type="button" class="chip" data-back>◀ Headlines</button>
          <p class="meta">${esc(n.when)} · ${esc(n.src)}</p>
          <h3>${esc(n.head)}</h3>
          ${n.body.map(b => `<p>${esc(b)}</p>`).join('') || '<p class="muted">No summary was provided with this headline.</p>'}
          ${n.url ? `<p><a class="read" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">Read the full story at ${esc(n.src)} ↗</a></p>` : ''}
          <p class="note">${M.source === 'Astral' ? 'Filing details from Astral. Open the filing on sec.gov for the full document.' : 'Headline and summary from Finnhub and the publisher named above. Amberline doesn\'t write or verify news.'}</p>
          ${n.syms.length ? `<div class="chips"><span class="label">Securities</span>${n.syms.map(x => `<button type="button" class="chip" data-sym="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
        </article>`;
      }
      p.body.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-back')) back(p, { fn: s.sym ? 'NEWS' : 'TOP', sym: s.sym });
        if (b.dataset.sym) open(p, 'GP', b.dataset.sym);
      });
    }
  };

  // ---------- analyst, earnings and fundamental screens ----------
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${MON3[+m[2] - 1]} ${+m[3]} '${m[1].slice(2)}` : '—'; };
  const monthLabel = iso => { const m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? `${MON3[+m[2] - 1]} ${m[1]}` : '—'; };
  const HOUR = { bmo: 'Before open', amc: 'After close', dmh: 'During hours' };
  const usd = (v, d = 2) => (ok(v) ? (v < 0 ? '−$' : '$') + fmt(Math.abs(v), d) : '—');
  const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const etToday = () => etFmt.format(new Date());
  const daysUntil = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(etToday() + 'T00:00:00Z')) / 864e5);

  // A screen that loads once: shows "Loading…", then render(data) or the error.
  function screen(p, s, what, fetch, render) {
    p.body.innerHTML = `<div class="scr"><p class="notice">Loading ${what}…</p></div>`;
    const host = p.body.firstChild;
    let dead = false;
    fetch().then(d => { if (!dead) render(host, d); }, err => { if (!dead) notice(host, errText(err), 'err'); });
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-go], tr[data-sym], [data-sym]');
      if (!b) return;
      if (b.dataset.go) load(p, { fn: b.dataset.go, sym: s.sym });
      else if (b.dataset.sym) open(p, b.dataset.fn || 'DES', b.dataset.sym);
    });
    return { syms: () => (s.sym ? [s.sym] : []), destroy() { dead = true; } };
  }
  const goChips = (sym, fns) => `<div class="chips"><span class="label">${esc(sym)}</span>${fns.map(f => `<button type="button" class="chip" data-go="${f}"><span class="fn">${f}</span> ${esc(FN[f].name)}</button>`).join('')}</div>`;

  FN.ANR = {
    name: 'Analyst Recommendations', sec: 'req', example: 'NVDA ANR',
    help: 'Sell-side buy, hold and sell ratings: the consensus today and how it has moved over the last six months.',
    mount(p, s) {
      return screen(p, s, 'analyst ratings', () => M.analyst(s.sym), (host, r) => {
        if (!r.rows.length) { notice(host, `Finnhub has no analyst ratings for ${esc(s.sym)}. Small caps and most ETFs aren't covered.`); return; }
        const cur = r.rows[0];
        const score = x => (5 * x.sb + 4 * x.b + 3 * x.h + 2 * x.s + x.ss) / x.total;
        const pct = (n, x) => Math.round(n / x.total * 100);
        const tone = r.score >= 3.5 ? 'up' : r.score < 2.5 ? 'dn' : 'key';
        const SEG = [['sb', 'Strong buy', 'sb'], ['b', 'Buy', 'b'], ['h', 'Hold', 'h'], ['s', 'Sell', 's'], ['ss', 'Strong sell', 'ss']];
        const prev = r.rows[r.rows.length - 1];
        const drift = r.rows.length > 1 ? score(cur) - score(prev) : null;
        host.innerHTML = `
          <div class="scr-head">
            <div><span class="label">Consensus · ${esc(monthLabel(cur.period))}</span><div class="big ${tone}">${esc(r.label)}</div>
              <span class="muted">${fmt(r.score, 2)} on a 1–5 scale (5 = strong buy) · ${cur.total} analysts</span></div>
            <div class="kpis">
              <div><span class="label">Buy</span><b class="up">${pct(cur.sb + cur.b, cur)}%</b></div>
              <div><span class="label">Hold</span><b>${pct(cur.h, cur)}%</b></div>
              <div><span class="label">Sell</span><b class="dn">${pct(cur.s + cur.ss, cur)}%</b></div>
              ${drift != null ? `<div><span class="label">vs ${esc(monthLabel(prev.period).slice(0, 3))}</span><b class="${dirOf(drift)}">${signed(drift, 2)}</b></div>` : ''}
            </div>
          </div>
          <div class="stack" role="img" aria-label="Rating mix">${SEG.map(([k, l, c]) => cur[k] ? `<i class="st-${c}" style="flex:${cur[k]}" title="${l}: ${cur[k]}">${cur[k]}</i>` : '').join('')}</div>
          <div class="stack-key">${SEG.map(([, l, c]) => `<span><i class="st-${c}"></i>${l}</span>`).join('')}</div>
          <div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Month</th>${SEG.map(([, l]) => `<th class="num" scope="col">${l}</th>`).join('')}<th class="num" scope="col">Total</th><th class="num" scope="col">% Buy</th><th class="num" scope="col">Score</th></tr></thead><tbody>
            ${r.rows.map(x => `<tr><td>${esc(monthLabel(x.period))}</td>${SEG.map(([k]) => `<td class="num">${x[k]}</td>`).join('')}<td class="num">${x.total}</td><td class="num">${pct(x.sb + x.b, x)}%</td><td class="num">${fmt(score(x), 2)}</td></tr>`).join('')}
          </tbody></table></div>
          ${goChips(s.sym, ['ERN', 'FA', 'GP'])}
          <p class="tbl-note">Monthly recommendation trends from Finnhub. Price targets and individual broker calls aren't in Finnhub's free plan.</p>`;
      });
    }
  };

  FN.ERN = {
    name: 'Earnings', sec: 'req', example: 'AAPL ERN',
    help: 'Next report date with EPS and revenue estimates, plus actual vs. estimated EPS and the surprise for recent quarters.',
    mount(p, s) {
      return screen(p, s, 'earnings', () => M.earnings(s.sym), (host, r) => {
        const n = r.next, h = r.history.filter(x => ok(x.act));
        const beats = h.filter(x => ok(x.est) && x.act > x.est).length;
        const avgSurp = h.filter(x => ok(x.pct)).reduce((a, x, _, arr) => a + x.pct / arr.length, 0);
        const d = n ? daysUntil(n.date) : null;
        host.innerHTML = `
          <div class="scr-head">
            <div><span class="label">Next report</span>
              <div class="big">${n ? esc(dayLabel(n.date)) : 'Not scheduled'}</div>
              <span class="muted">${n ? `${esc(HOUR[n.hour] || 'Time not confirmed')} · ${d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days'}${n.quarter ? ` · Q${n.quarter} FY${n.year}` : ''}` : 'No date in the next 120 days'}</span></div>
            <div class="kpis">
              ${n ? `<div><span class="label">EPS est.</span><b>${usd(n.epsEst)}</b></div><div><span class="label">Revenue est.</span><b>${ok(n.revEst) ? '$' + big(n.revEst) : '—'}</b></div>` : ''}
              ${h.length ? `<div><span class="label">Beat rate</span><b class="${beats * 2 >= h.length ? 'up' : 'dn'}">${beats}/${h.length}</b></div><div><span class="label">Avg surprise</span><b class="${dirOf(avgSurp)}">${pctStr(avgSurp)}</b></div>` : ''}
            </div>
          </div>
          ${r.history.length ? `<div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Quarter</th><th scope="col">Period end</th><th class="num" scope="col">EPS est.</th><th class="num" scope="col">EPS actual</th><th class="num" scope="col">Surprise</th><th class="num" scope="col">Surprise %</th><th scope="col"></th></tr></thead><tbody>
            ${r.history.map(x => `<tr><td>${x.quarter ? `Q${x.quarter} ${x.year}` : '—'}</td><td class="muted">${esc(dayLabel(x.period))}</td><td class="num">${usd(x.est)}</td><td class="num">${usd(x.act)}</td><td class="num ${dirOf(x.surprise)}">${ok(x.surprise) ? signed(x.surprise, 2) : '—'}</td><td class="num ${dirOf(x.pct)}">${pctStr(x.pct)}</td><td>${ok(x.act) && ok(x.est) ? `<span class="tag ${x.act > x.est ? 'up' : x.act < x.est ? 'dn' : ''}">${x.act > x.est ? 'Beat' : x.act < x.est ? 'Miss' : 'In line'}</span>` : ''}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="notice">Finnhub has no earnings history for this symbol.</p>'}
          ${goChips(s.sym, ['ANR', 'FA', 'GP'])}
          <p class="tbl-note">EPS history and calendar from Finnhub. The free plan covers the last four reported quarters.</p>`;
      });
    }
  };

  FN.FA = {
    name: 'Financial Analysis', sec: 'req', example: 'MSFT FA',
    help: 'Margins, returns, per-share figures, valuation multiples and leverage by fiscal year or quarter.',
    mount(p, s) {
      s.freq = s.freq === 'quarterly' ? 'quarterly' : 'annual';
      let data = null;
      const ctl = screen(p, s, 'financials', () => M.fundamentals(s.sym), (host, d) => { data = d; draw(host); });
      function cell(r, v) {
        if (!ok(v)) return '—';
        if (r.kind === 'usd') return usd(v);
        if (r.kind === 'pct') return (r.signed ? signed(v, 1) : fmt(v, 1)) + '%';
        return fmt(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) + '×';
      }
      function draw(host) {
        const t = data[s.freq];
        if (!t.rows.length) { notice(host, `Finnhub has no financial data for ${esc(s.sym)}. ETFs and some recent listings aren't covered.`); return; }
        const head = t.periods.map(per => s.freq === 'annual' ? 'FY' + per.slice(0, 4) : dayLabel(per));
        let group = null;
        host.innerHTML = `
          <div class="most-top"><div class="seg" role="group" aria-label="Period"><button type="button" data-f="annual" aria-pressed="${s.freq === 'annual'}">Annual</button><button type="button" data-f="quarterly" aria-pressed="${s.freq === 'quarterly'}">Quarterly</button></div></div>
          <div class="tbl-wrap"><table class="qt fa"><thead><tr><th scope="col">${s.freq === 'annual' ? 'Fiscal year' : 'Quarter ending'}</th>${head.map(x => `<th class="num" scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>
          ${t.rows.map(r => {
            const g = r.group !== group ? `<tr class="grp"><th colspan="${t.periods.length + 1}" scope="rowgroup">${esc(r.group)}</th></tr>` : '';
            group = r.group;
            return g + `<tr><td>${esc(r.label)}</td>${t.periods.map(per => `<td class="num${r.signed ? ' ' + dirOf(r.values[per]) : ''}">${cell(r, r.values[per])}</td>`).join('')}</tr>`;
          }).join('')}
          </tbody></table></div>
          ${goChips(s.sym, ['ERN', 'ANR', 'DES'])}
          <p class="tbl-note">Ratios from Finnhub's reported financials. Valuation multiples use the price at each period end. Rows Finnhub doesn't report for this company are left out.</p>`;
        host.querySelector('.seg').addEventListener('click', e => {
          const b = e.target.closest('button');
          if (!b) return;
          s.freq = b.dataset.f;
          save();
          draw(host);
        });
      }
      return ctl;
    }
  };

  const INS_CODE = { P: 'Buy', S: 'Sale', A: 'Award', M: 'Option exercise', X: 'Option exercise', F: 'Tax withholding', G: 'Gift', D: 'Sold to issuer', C: 'Conversion', J: 'Other', I: 'Discretionary', W: 'Inheritance' };
  FN.INS = {
    name: 'Insider Transactions', sec: 'req', example: 'TSLA INS',
    help: 'Form 4 trades by executives and directors over the past year, with open-market buying and selling totals.',
    mount(p, s) {
      return screen(p, s, 'insider trades', () => M.insiders(s.sym), (host, rows) => {
        if (!rows.length) { notice(host, `No insider transactions for ${esc(s.sym)} in the past year.`); return; }
        const cut = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
        const recent = rows.filter(x => x.date >= cut);
        const sum = code => recent.filter(x => x.code === code).reduce((a, x) => ({ n: a.n + 1, sh: a.sh + Math.abs(x.change || 0), v: a.v + Math.abs((x.change || 0) * (x.price || 0)) }), { n: 0, sh: 0, v: 0 });
        const buy = sum('P'), sell = sum('S');
        const net = buy.v - sell.v;
        host.innerHTML = `
          <div class="scr-head">
            <div><span class="label">Open-market trades · last 90 days</span>
              <div class="big ${net > 0 ? 'up' : net < 0 ? 'dn' : ''}">${net > 0 ? 'Net buying' : net < 0 ? 'Net selling' : buy.n + sell.n ? 'Balanced' : 'No open-market trades'}</div>
              <span class="muted">Buys and sales coded P and S. Awards, option exercises and tax withholding are listed but not counted.</span></div>
            <div class="kpis">
              <div><span class="label">Buys</span><b class="up">${buy.n} · $${big(buy.v)}</b></div>
              <div><span class="label">Sales</span><b class="dn">${sell.n} · $${big(sell.v)}</b></div>
            </div>
          </div>
          <div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Date</th><th scope="col">Insider</th><th scope="col">Type</th><th class="num" scope="col">Shares</th><th class="num" scope="col">Price</th><th class="num" scope="col">Value</th><th class="num opt" scope="col">Held after</th></tr></thead><tbody>
            ${rows.slice(0, 60).map(x => {
              const v = ok(x.change) && x.price ? Math.abs(x.change * x.price) : null;
              const dir = x.code === 'P' ? 'up' : x.code === 'S' ? 'dn' : '';
              return `<tr><td class="muted">${esc(dayLabel(x.date))}</td><td class="name" title="${esc(x.name)}">${esc(x.name)}</td><td class="${dir}">${esc(INS_CODE[x.code] || x.code || '—')}</td><td class="num ${dirOf(x.change)}">${ok(x.change) ? signed(x.change, 0) : '—'}</td><td class="num">${x.price ? usd(x.price) : '—'}</td><td class="num">${v ? '$' + big(v) : '—'}</td><td class="num opt muted">${big(x.held)}</td></tr>`;
            }).join('')}
          </tbody></table></div>
          ${goChips(s.sym, ['DES', 'NEWS'])}
          <p class="tbl-note">SEC Form 4 filings via Finnhub, newest first.</p>`;
      });
    }
  };

  FN.EVTS = {
    name: 'Earnings Calendar', sec: 'none', example: 'EVTS',
    help: 'Who reports in the next one or two weeks, with timing and consensus estimates. Filter to large companies or show all.',
    mount(p, s) {
      s.span = s.span === 14 ? 14 : 7;
      s.all = !!s.all;
      let data = null;
      p.body.innerHTML = '<div class="scr"><p class="notice">Loading the earnings calendar…</p></div>';
      const host = p.body.firstChild;
      let dead = false;
      const fetchCal = () => M.calendar(s.span).then(d => { if (!dead) { data = d; draw(); } }, err => { if (!dead) notice(host, errText(err), 'err'); });
      function draw() {
        const rows = data.filter(x => s.all || (x.revEst || 0) >= 1e9).slice(0, 200);
        const days = [...new Set(rows.map(x => x.date))];
        host.innerHTML = `
          <div class="most-top">
            <div class="seg" role="group" aria-label="Window"><button type="button" data-k="span" data-v="7" aria-pressed="${s.span === 7}">7 days</button><button type="button" data-k="span" data-v="14" aria-pressed="${s.span === 14}">14 days</button></div>
            <div class="seg" role="group" aria-label="Companies"><button type="button" data-k="all" data-v="0" aria-pressed="${!s.all}">Revenue est. ≥ $1B</button><button type="button" data-k="all" data-v="1" aria-pressed="${s.all}">All</button></div>
          </div>
          ${rows.length ? `<div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Ticker</th><th scope="col">Time</th><th scope="col">Quarter</th><th class="num" scope="col">EPS est.</th><th class="num" scope="col">Revenue est.</th></tr></thead>
            ${days.map(d => `<tbody><tr class="grp"><th colspan="5" scope="rowgroup">${esc(dayLabel(d))}${d === etToday() ? ' · Today' : ''}</th></tr>` +
              rows.filter(x => x.date === d).map(x => `<tr data-sym="${esc(x.sym)}" data-fn="ERN" tabindex="0"><td class="sym">${esc(x.sym)}</td><td class="muted">${esc(HOUR[x.hour] || '—')}</td><td class="muted">${x.quarter ? `Q${x.quarter} ${x.year}` : '—'}</td><td class="num">${usd(x.epsEst)}</td><td class="num">${ok(x.revEst) ? '$' + big(x.revEst) : '—'}</td></tr>`).join('') + '</tbody>').join('')}
          </table></div>` : `<p class="notice">No ${s.all ? '' : 'large-company '}reports in the next ${s.span} days.</p>`}
          <p class="tbl-note">${data.length} companies report in this window${s.all ? '' : `; showing the ${rows.length} with consensus revenue of $1B or more`}. Select one for its earnings history. Calendar from Finnhub.</p>`;
      }
      host.addEventListener('click', e => {
        const b = e.target.closest('.seg button');
        if (b) {
          if (b.dataset.k === 'span') { s.span = +b.dataset.v; save(); notice(host, 'Loading the earnings calendar…'); fetchCal(); }
          else { s.all = b.dataset.v === '1'; save(); draw(); }
          return;
        }
        const tr = e.target.closest('tr[data-sym]');
        if (tr) open(p, 'ERN', tr.dataset.sym);
      });
      host.addEventListener('keydown', e => { const tr = e.key === 'Enter' && e.target.closest('tr[data-sym]'); if (tr) open(p, 'ERN', tr.dataset.sym); });
      fetchCal();
      return { destroy() { dead = true; } };
    }
  };

  // ---------- watchlist ----------
  const WL_KEY = 'amberline.watchlist';
  const TICKER = /^[A-Z][A-Z.]{0,5}$/;
  function wlRead() {
    try { const v = JSON.parse(localStorage.getItem(WL_KEY)); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && TICKER.test(x)).slice(0, 50) : []; } catch (e) { return []; }
  }
  function wlWrite(list) { try { localStorage.setItem(WL_KEY, JSON.stringify(list.slice(0, 50))); return true; } catch (e) { return false; } }
  function wlRefresh() { panels.forEach(q => { if (q.state && q.state.fn === 'WL') load(q, { fn: 'WL' }, false); }); }

  FN.WL = {
    name: 'Watchlist', sec: 'none', example: 'WL ADD PLTR COIN',
    help: 'Your own list, saved in this browser. WL ADD TSLA PLTR adds tickers, WL DEL TSLA removes one, WL CLEAR empties it.',
    mount(p) {
      const list = wlRead();
      if (!list.length) {
        p.body.innerHTML = `<div class="help"><section><h3>Your watchlist is empty</h3>
          <p>Add tickers from the command line: <b>WL ADD PLTR COIN HOOD</b>. Remove one with <b>WL DEL COIN</b>. The list is saved in this browser only.</p>
          <div class="chips"><span class="label">Try</span><button type="button" class="chip" data-run="WL ADD SPY QQQ NVDA">WL ADD SPY QQQ NVDA</button></div></section></div>`;
        p.body.addEventListener('click', e => { const b = e.target.closest('[data-run]'); if (b) run(b.dataset.run); });
        return {};
      }
      const del = { k: 'del', label: '', html: 1, get: i => `<button type="button" class="x" data-del="${esc(i.sym)}" title="Remove ${esc(i.sym)}" aria-label="Remove ${esc(i.sym)}">×</button>` };
      const cols = [COL.sym, COL.name, COL.last, COL.chg, COL.pct, COL.rng, COL.spark, COL.upd, del];
      p.body.innerHTML = '<div class="tbl-wrap"></div><p class="tbl-note"></p>';
      const note = p.body.lastChild;
      let update = () => {}, dead = false;
      const shown = () => list.filter(s => I[s]);
      function render() {
        const host = p.body.firstChild.cloneNode(false);
        p.body.firstChild.replaceWith(host);
        update = quoteTable(host, [{ label: null, syms: shown() }], cols, sym => open(p, 'DES', sym));
        const waiting = list.length - shown().length;
        note.textContent = `${list.length} ticker${list.length === 1 ? '' : 's'} · saved in this browser · WL ADD / WL DEL to edit` + (waiting ? ` · looking up ${waiting}…` : '');
      }
      p.body.addEventListener('click', e => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        e.stopPropagation();
        wlWrite(wlRead().filter(x => x !== b.dataset.del));
        wlRefresh();
      }, true);
      render();
      const missing = list.filter(s => !I[s]);
      if (missing.length && M.hasKey) {
        Promise.allSettled(missing.map(s => M.ensure(s))).then(() => { if (!dead) { render(); watch(); } });
      }
      return { syms: shown, tick: () => update(false), destroy() { dead = true; } };
    }
  };

  function wlCommand(op, syms) {
    const cur = wlRead();
    if (op === 'CLEAR') { wlWrite([]); wlRefresh(); status('Watchlist cleared.'); return; }
    if (!syms.length) { status(`Add tickers after ${op}, for example <b>WL ${op} TSLA</b>.`, 'err'); return; }
    const bad = syms.filter(s => !TICKER.test(s));
    if (bad.length) { status(`<b>${esc(bad[0])}</b> isn't a ticker.`, 'err'); return; }
    if (op !== 'ADD') {
      wlWrite(cur.filter(x => !syms.includes(x)));
      wlRefresh();
      status(`Removed ${esc(syms.join(', '))} from the watchlist.`);
      return;
    }
    const fresh = syms.filter(x => !cur.includes(x));
    if (!fresh.length) { status(`${esc(syms.join(', '))} ${syms.length > 1 ? 'are' : 'is'} already on the watchlist.`); return; }
    const finish = good => {
      if (!wlWrite(cur.concat(good))) { status("This browser won't let the page save data, so the watchlist can't be kept.", 'err'); return; }
      const shown = panels.some(q => q.state && q.state.fn === 'WL');
      if (shown) wlRefresh(); else load(panels[active], { fn: 'WL' });
      const missed = fresh.filter(x => !good.includes(x));
      status(`Added ${esc(good.join(', ') || 'nothing')} to the watchlist.` + (missed.length ? ` No quote found for ${esc(missed.join(', '))}.` : ''), missed.length ? 'err' : '');
    };
    if (!M.hasKey) { finish(fresh); return; }
    status(`Checking ${esc(fresh.join(', '))}…`);
    Promise.allSettled(fresh.map(x => M.ensure(x))).then(rs => finish(fresh.filter((_, k) => rs[k].status === 'fulfilled')));
  }

  FN.KEY = {
    name: 'Data Connection', sec: 'none', example: 'KEY',
    help: 'Connect real market data with your own free Finnhub API key, check the connection, or remove the key.',
    mount(p) {
      const live = M.hasKey;
      const fhSec = `          <section>
            <h3>${live ? 'Change key' : 'Your Finnhub API key'}</h3>
            <form class="keyform" autocomplete="off">
              <label for="fhKey" class="label">API key</label>
              <div class="keyrow">
                <input id="fhKey" type="password" spellcheck="false" autocomplete="off" placeholder="Paste your Finnhub key">
                <button type="submit" class="chip solid">Save and connect</button>
                ${live ? '<button type="button" class="chip" data-clear>Remove key</button>' : ''}
              </div>
              <p class="keymsg" role="status"></p>
            </form>
            <p class="fine"><b>Sharing:</b> Finnhub's terms allow personal use only and forbid sharing its data, or results derived from it, without Finnhub's written approval. Before you present, screenshot, record or stream live data, get that approval or a plan licensed for display. See <a href="https://finnhub.io/terms-of-service" target="_blank" rel="noopener noreferrer">Finnhub's terms</a>.</p>
            <p class="fine">Your key is stored in this browser's local storage and is sent only to Finnhub. Anyone using this browser profile, and any other page on this site's address, can read it, so remove it on shared machines.</p>
          </section>
`;
      const tdSec = `          <section>
            <h3>Chart history · Twelve Data key (optional)</h3>
            <p>${M.hasHistoryKey ? 'Connected. <b>GP</b> charts load real daily and 5-minute history from Twelve Data, so 1M, 3M, 6M and 1Y all work.' : "Finnhub's free plan has no price history, so <b>GP</b> can only chart trades since you opened the page. A free Twelve Data key adds full 1M–1Y candlestick charts and the one-year line on <b>DES</b>."}</p>
            ${M.hasHistoryKey ? '' : '<p>Get one at <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer">twelvedata.com/register</a> (the Basic plan is free: 8 requests a minute, 800 a day), then paste it below.</p>'}
            <form class="keyform tdform" autocomplete="off">
              <label for="tdKey" class="label">Twelve Data API key</label>
              <div class="keyrow">
                <input id="tdKey" type="password" spellcheck="false" autocomplete="off" placeholder="${M.hasHistoryKey ? 'Paste a new key to replace it' : 'Paste your Twelve Data key'}">
                <button type="submit" class="chip solid">Save</button>
                ${M.hasHistoryKey ? '<button type="button" class="chip" data-tdclear>Remove key</button>' : ''}
              </div>
              <p class="keymsg tdmsg" role="status"></p>
            </form>
            <p class="fine">Stored in this browser and sent only to Twelve Data. Their free plan is for personal use too.</p>
          </section>
`;
      const intro = !live ? 'Amberline shows real US stocks, ETFs and news from Finnhub. It needs your own Finnhub API key. Until you add one, the panels show tickers without prices.'
        : M.mock ? 'This page is using the mock server on localhost. Every price, name and headline it serves is made up for testing.'
        : M.source === 'Astral' ? 'Quotes, charts and SEC filings come from your Astral connector on claude.ai. To use Finnhub instead, add a key below.' : '';
      p.body.innerHTML = `
        <div class="help keypage">
          <section>
            <h3>${!live ? 'No data source connected' : M.mock ? 'Connected to the local mock API' : 'Connected to ' + M.source}</h3>
            ${intro ? `<p>${intro}</p>` : ''}
            ${live ? '' : '<p>Get a free key at <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">finnhub.io/register</a>, copy it from your dashboard and paste it below.</p>'}
          </section>
          ${live ? `<section><h3>Status</h3><dl class="keys status-list">
              <div><dt>Feed</dt><dd data-k="feed">…</dd></div>
              <div><dt>Requests</dt><dd data-k="req">…</dd></div>
              <div><dt>Historical charts</dt><dd data-k="candles">…</dd></div>
              <div><dt>Key</dt><dd data-k="auth">…</dd></div>
            </dl></section>` : ''}
          ${live ? `<details class="manage"><summary>Manage keys</summary>${fhSec}${M.hasHistoryKey ? tdSec : ''}</details>${M.hasHistoryKey ? '' : tdSec}` : fhSec + tdSec}
        </div>`;
      const tdForm = p.body.querySelector('.tdform');
      const tdMsg = p.body.querySelector('.tdmsg');
      tdForm.addEventListener('submit', e => {
        e.preventDefault();
        const k = p.body.querySelector('#tdKey').value.trim();
        if (!/^[A-Za-z0-9]{16,64}$/.test(k)) { tdMsg.textContent = "That doesn't look like a Twelve Data key. Keys are 32 letters and numbers."; tdMsg.className = 'keymsg tdmsg err'; return; }
        if (!M.setHistoryKey(k)) { tdMsg.textContent = "This browser won't let the page save data. Try a normal (non-private) window."; tdMsg.className = 'keymsg tdmsg err'; return; }
        tdMsg.textContent = 'Saved. Reloading…';
        tdMsg.className = 'keymsg tdmsg';
        setTimeout(() => location.reload(), 300);
      });
      const tdClr = p.body.querySelector('[data-tdclear]');
      if (tdClr) tdClr.addEventListener('click', () => { M.setHistoryKey(''); location.reload(); });
      const form = p.body.querySelector('.keyform:not(.tdform)');
      const input = p.body.querySelector('#fhKey');
      const msg = form.querySelector('.keymsg');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const k = input.value.trim();
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(k)) { msg.textContent = "That doesn't look like a Finnhub key. Keys are letters and numbers, usually 20 characters."; msg.className = 'keymsg err'; return; }
        if (!M.setKey(k)) { msg.textContent = "This browser won't let the page save data, so the key can't be kept. Try a normal (non-private) window."; msg.className = 'keymsg err'; return; }
        msg.textContent = 'Saved. Connecting…';
        msg.className = 'keymsg';
        setTimeout(() => location.reload(), 300);
      });
      const clr = p.body.querySelector('[data-clear]');
      if (clr) clr.addEventListener('click', () => { M.setKey(''); location.reload(); });
      function update() {
        if (!live) return;
        const f = M.feed(), r = M.requests(), c = M.candles(), a = M.authError();
        const set = (k, t) => { const el = p.body.querySelector(`[data-k="${k}"]`); if (el) el.textContent = t; };
        const se = M.streamError();
        set('feed', (f.state === 'live' ? 'Streaming live trades' : 'Polling quotes about once a minute (no live stream)') + (se ? ' · stream says: ' + se : ''));
        set('req', `${r.used} of ${r.perMinute} this minute${r.queued ? ', ' + r.queued + ' waiting' : ''}`);
        set('candles', M.historySource() === 'Twelve Data' ? 'From Twelve Data (1M–1Y on)' : c === true ? 'Included in your Finnhub plan' : c === false ? 'Not in your Finnhub plan; add a Twelve Data key below' : 'Not checked yet');
        set('auth', a ? a.message : 'Accepted');
      }
      update();
      return { tick: update };
    }
  };

  FN.HELP = {
    name: 'Help', sec: 'none', example: 'HELP',
    help: 'This page: functions, syntax and keyboard shortcuts.',
    mount(p) {
      const fns = Object.keys(FN).filter(k => !FN[k].hidden);
      const ex = 'AAPL GP';
      p.body.innerHTML = `
        <div class="help">
          <section>
            <h3>How to type a command</h3>
            <p>Type a ticker, a function, or both, then press <kbd>Enter</kbd>. <b>${ex}</b> opens a price graph. A ticker on its own opens its description. A function on its own reuses the ticker already in the panel. Add <b>P1</b>–<b>P4</b> to send the result to another panel. Any US stock or ETF ticker works, not just the ones in the monitor.</p>
          </section>
          <section>
            <h3>Functions</h3>
            <div class="tbl-wrap"><table class="qt"><thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Try</th><th scope="col">What it shows</th></tr></thead><tbody>
              ${fns.map(k => `<tr><td><span class="fn">${k}</span></td><td>${FN[k].name}</td><td class="sym"><button type="button" class="link" data-run="${FN[k].example || k}">${FN[k].example || k}</button></td><td class="wrap">${FN[k].help}</td></tr>`).join('')}
            </tbody></table></div>
          </section>
          <section>
            <h3>Keyboard</h3>
            <dl class="keys">
              <div><dt><kbd>F1</kbd>–<kbd>F8</kbd></dt><dd>Load a function into the active panel</dd></div>
              <div><dt><kbd>F9</kbd></dt><dd>Move to the next panel</dd></div>
              <div><dt><kbd>F10</kbd></dt><dd>Maximize or restore the active panel</dd></div>
              <div><dt><kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>4</kbd></dt><dd>Select a panel</dd></div>
              <div><dt><kbd>Tab</kbd></dt><dd>Accept the highlighted suggestion</dd></div>
              <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Command history</dd></div>
              <div><dt><kbd>Esc</kbd></dt><dd>Clear the command line</dd></div>
              <div><dt>Any letter</dt><dd>Starts typing a command from anywhere</dd></div>
            </dl>
          </section>
          <section>
            <h3>About the data</h3>
            <p>Quotes, profiles, statistics, analyst ratings, earnings, insider trades and headlines come from Finnhub through your own API key. With an optional free Twelve Data key, price charts load full daily and intraday history. Market-wide views use US-listed ETFs as stand-ins for indices, commodities, currencies and Treasuries. Data may be delayed or incomplete. Nothing here is investment advice. Finnhub's terms allow personal use only and forbid sharing its data, or results derived from it, without Finnhub's written approval. Before you present, screenshot, record or stream live data, get that approval or a plan licensed for display.
              Amberline is an independent project and is not affiliated with Bloomberg L.P., Finnhub or any exchange.</p>
          </section>
        </div>`;
      p.body.addEventListener('click', e => {
        const b = e.target.closest('[data-run]');
        if (b) run(b.dataset.run);
      });
    }
  };

  const ALIAS = Object.assign(Object.create(null), { G: 'GP', CHART: 'GP', N: 'NEWS', FX: 'FXC', ACT: 'MOST', MOVERS: 'MOST', YC: 'CRV', TSY: 'CRV', CMD: 'CMDTY', W: 'MON', '?': 'HELP', INDEX: 'WEI', NI: 'NEWS', API: 'KEY', LIVE: 'KEY', CONNECT: 'KEY',
    EE: 'ERN', EARNINGS: 'ERN', RATINGS: 'ANR', RATIOS: 'FA', INSIDER: 'INS', ECAL: 'EVTS', WATCHLIST: 'WL' });

  // ---------- panels ----------
  const grid = document.getElementById('grid');
  const DEFAULT = M.hasKey
    ? [{ fn: 'GP', sym: 'AAPL', tf: '1D' }, { fn: 'WEI' }, { fn: 'TOP' }, { fn: 'MON' }]
    : [{ fn: 'KEY' }, { fn: 'MON' }, { fn: 'WEI' }, { fn: 'HELP' }];
  const panels = [];
  let active = 0;

  function makePanel(k) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.setAttribute('aria-label', 'Panel ' + (k + 1));
    el.innerHTML = `<header class="phead"><span class="pnum">${k + 1}</span><button class="pback" type="button" aria-label="Back" title="Back" hidden>◀</button><h2 class="ptitle"></h2><button class="pmax" type="button" aria-label="Maximize panel" title="Maximize (F10)">⤢</button></header><div class="pbody"></div>`;
    grid.appendChild(el);
    const p = { i: k, el, body: el.querySelector('.pbody'), title: el.querySelector('.ptitle'), backBtn: el.querySelector('.pback'), hist: [], state: null, ctl: {} };
    el.addEventListener('pointerdown', () => setActive(k));
    el.addEventListener('focusin', () => setActive(k));
    p.backBtn.addEventListener('click', () => back(p));
    el.querySelector('.pmax').addEventListener('click', () => toggleMax(p));
    el.querySelector('.phead').addEventListener('dblclick', () => toggleMax(p));
    return p;
  }

  function valid(state) {
    const f = state && FN[state.fn];
    return !!f && (f.sec !== 'req' || !!I[state.sym]);
  }

  function load(p, state, push = true) {
    if (!valid(state)) return false;
    p.seq = (p.seq || 0) + 1; // invalidates lookups started for this panel earlier
    const f = FN[state.fn];
    if (p.ctl && p.ctl.destroy) p.ctl.destroy();
    if (push && p.state) { p.hist.push(p.state); if (p.hist.length > 20) p.hist.shift(); }
    p.state = Object.assign({}, state);
    p.backBtn.hidden = !p.hist.length;
    const i = f.sec !== 'none' && state.sym ? I[state.sym] : null;
    retitle(p);
    const fresh = p.body.cloneNode(false); // drop listeners from the previous function
    p.body.replaceWith(fresh);
    p.body = fresh;
    p.ctl = f.mount(p, p.state) || {};
    save();
    watch();
    return true;
  }

  // Company names can arrive after the panel opens, so titles refresh on each tick.
  function retitle(p) {
    const f = FN[p.state.fn];
    const i = f.sec !== 'none' && p.state.sym ? I[p.state.sym] : null;
    const key = (i ? i.name : '') + p.state.fn;
    if (p.titleKey === key) return;
    p.titleKey = key;
    const code = p.state.fn === 'STORY' ? 'NEWS' : p.state.fn;
    p.title.innerHTML = `${i ? `<span class="psym">${esc(i.sym)}</span>` : ''}<span class="fn">${code}</span><span class="pname">${esc(i ? i.name + ' · ' + f.name : f.name)}</span>`;
  }

  // Load a ticker that may not be in the market yet (live mode accepts any US ticker).
  function open(p, fn, sym, extra, push = true) {
    if (I[sym] && I[sym].quotedAt) return load(p, Object.assign({ fn, sym }, extra), push);
    status(`Looking up <b>${esc(sym)}</b>…`);
    const my = p.seq = (p.seq || 0) + 1;
    M.ensure(sym).then(() => {
      if (my !== p.seq) return; // the panel moved on while we waited
      load(p, Object.assign({ fn, sym }, extra), push);
      status(`Panel ${p.i + 1}: ${esc(sym)} ${fn} · ${esc(FN[fn].name)}`);
    }, err => { if (my === p.seq) status(errText(err), 'err'); });
    return true;
  }

  function back(p, fallback) {
    const prev = p.hist.pop();
    if (prev) load(p, prev, false);
    else if (fallback) load(p, fallback, false);
    p.backBtn.hidden = !p.hist.length;
  }

  function setActive(k) {
    if (k === active && panels[k].el.classList.contains('active')) return;
    active = k;
    panels.forEach((p, j) => p.el.classList.toggle('active', j === k));
    document.getElementById('promptPanel').textContent = k + 1;
    save();
    watch();
  }

  function toggleMax(p) {
    const on = !p.el.classList.contains('max');
    panels.forEach(q => q.el.classList.remove('max'));
    p.el.classList.toggle('max', on);
    grid.classList.toggle('has-max', on);
    p.el.querySelector('.pmax').setAttribute('aria-label', on ? 'Restore panel' : 'Maximize panel');
    const f10 = fkeys.querySelector('[data-j="9"]');
    if (f10) f10.lastChild.textContent = on ? 'Restore' : 'Maximize';
    setActive(p.i);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ active, panels: panels.map(p => p.state) }));
    } catch (e) { /* storage unavailable: layout simply isn't remembered */ }
  }
  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (raw && Array.isArray(raw.panels)) return raw;
    } catch (e) { /* fall through to defaults */ }
    return null;
  }

  // Tell the market which symbols are on screen so it can stream and refresh them first.
  function watch() {
    const syms = new Set();
    const order = [panels[active]].concat(panels.filter((_, k) => k !== active));
    order.forEach(p => { if (p && p.ctl && p.ctl.syms) p.ctl.syms().forEach(s => syms.add(s)); });
    M.universe.tape.forEach(s => syms.add(s));
    M.watch([...syms]);
  }

  // ---------- command line ----------
  const cmd = document.getElementById('cmd');
  const sug = document.getElementById('suggest');
  const statusEl = document.getElementById('status');
  cmd.placeholder = 'Ticker and function, e.g. AAPL GP. Press Enter to run.';
  const hist = [];
  let histIdx = 0, sugItems = [], sugIdx = -1, sugReq = 0, sugTimer = null;

  function status(html, kind) {
    statusEl.innerHTML = html;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function run(text) {
    const toks = text.trim().toUpperCase().replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    // Watchlist edits: WL ADD TSLA PLTR, WL DEL TSLA, WL CLEAR
    if (toks[0] === 'WL' && /^(ADD|DEL|RMV|REMOVE|CLEAR)$/.test(toks[1] || '')) {
      const pTok = toks.find(t => /^P[1-4]$/.test(t));
      if (pTok) setActive(+pTok[1] - 1);
      wlCommand(toks[1] === 'ADD' ? 'ADD' : toks[1] === 'CLEAR' ? 'CLEAR' : 'DEL', toks.slice(2).filter(t => !/^P[1-4]$/.test(t)));
      return;
    }
    // A token that is both a function and a ticker (FXC) is a ticker when another function is present.
    const isFn = t => (FN[t] && !FN[t].hidden) || ALIAS[t];
    const fnCount = toks.filter(isFn).length;
    let target = active, sym = null, fn = null, tf = null;
    for (const t of toks) {
      if (/^P[1-4]$/.test(t)) target = +t[1] - 1;
      else if (TFS.includes(t)) tf = t;
      else if (t === 'GO') continue;
      else if (!fn && isFn(t) && !(fnCount > 1 && !sym)) fn = FN[t] && !FN[t].hidden ? t : ALIAS[t];
      else if (!sym && (I[t] || /^[A-Z][A-Z.]{0,5}$/.test(t))) sym = t;
      else {
        status(`<b>${esc(t)}</b> isn't a ticker or a function code. Type <b>HELP</b> to see what's available.`, 'err');
        return;
      }
    }
    const p = panels[target];
    if (!fn && !sym && tf) fn = 'GP';
    if (!fn && !sym) { setActive(target); return; }
    if (!fn) fn = tf || (I[sym] && I[sym].type !== 'equity') ? 'GP' : 'DES';
    if (FN[fn].sec === 'req' && !sym) {
      sym = p.state && p.state.sym && I[p.state.sym] ? p.state.sym : null;
      if (!sym) { status(`<b>${fn}</b> needs a ticker first, for example <b>AAPL ${fn}</b>.`, 'err'); return; }
    }
    setActive(target);
    if (FN[fn].sec === 'none') {
      load(p, { fn });
      status(`Panel ${target + 1}: ${fn} · ${esc(FN[fn].name)}`);
      return;
    }
    const extra = {};
    if (fn === 'GP') extra.tf = tf || (p.state && p.state.fn === 'GP' && p.state.sym === sym ? p.state.tf : '1D');
    if (!I[sym] || !I[sym].quotedAt) { open(p, fn, sym, extra); return; }
    load(p, Object.assign({ fn, sym }, extra));
    status(`Panel ${target + 1}: ${esc(sym)} ${fn} · ${esc(FN[fn].name)}`);
  }

  function buildSuggestions() {
    const parts = cmd.value.split(/\s+/);
    const q = parts[parts.length - 1].toUpperCase();
    if (!q) return closeSug();
    const out = [];
    Object.keys(FN).forEach(code => {
      const f = FN[code];
      if (f.hidden) return;
      const score = code.startsWith(q) ? (code === q ? 0 : 1) : f.name.toUpperCase().includes(q) ? 3 : -1;
      if (score >= 0) out.push({ v: code, sub: f.name, kind: 'Function', score });
    });
    Object.values(I).forEach(i => {
      const score = i.sym.startsWith(q) ? (i.sym === q ? 0 : 1) : i.name.toUpperCase().includes(q) ? 2 : -1;
      if (score >= 0) out.push({ v: i.sym, sub: i.name, kind: TYPE_LABEL[i.type] || 'Security', score });
    });
    out.sort((a, b) => a.score - b.score || a.v.localeCompare(b.v));
    sugItems = out.slice(0, 8);
    sugIdx = -1;
    renderSug();
    // Live mode also searches Finnhub for tickers outside the built-in lists.
    clearTimeout(sugTimer);
    if (M.hasKey && q.length >= 2 && sugItems.length < 8) {
      const my = ++sugReq, typed = cmd.value;
      sugTimer = setTimeout(() => M.find(q).then(found => {
        if (my !== sugReq || cmd.value !== typed) return;
        const have = new Set(sugItems.map(s => s.v));
        found.forEach(f => { if (!have.has(f.sym) && sugItems.length < 8) sugItems.push({ v: f.sym, sub: f.name, kind: f.kind, score: 5 }); });
        renderSug();
      }), 350);
    }
  }
  function renderSug() {
    sug.innerHTML = sugItems.map((s, k) => `<li role="option" id="sug-${k}" data-k="${k}" aria-selected="${k === sugIdx}"><b>${esc(s.v)}</b><span>${esc(s.sub)}</span><em>${esc(s.kind)}</em></li>`).join('');
    sug.hidden = !sugItems.length;
    cmd.setAttribute('aria-expanded', String(!sug.hidden));
    if (sugIdx >= 0) cmd.setAttribute('aria-activedescendant', 'sug-' + sugIdx);
    else cmd.removeAttribute('aria-activedescendant');
  }
  function closeSug() { sugReq++; clearTimeout(sugTimer); sugItems = []; sugIdx = -1; renderSug(); }
  function accept(k) {
    const s = sugItems[k];
    const parts = cmd.value.split(/\s+/);
    parts[parts.length - 1] = s.v;
    cmd.value = parts.join(' ') + ' ';
    closeSug();
    cmd.focus();
    return s;
  }
  function submit() {
    const text = cmd.value.trim();
    if (!text) return;
    if (hist[hist.length - 1] !== text) hist.push(text);
    histIdx = hist.length;
    cmd.value = '';
    closeSug();
    run(text);
  }

  cmd.addEventListener('input', buildSuggestions);
  cmd.addEventListener('keydown', e => {
    const isOpen = !sug.hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (isOpen) { sugIdx = (sugIdx + 1) % sugItems.length; renderSug(); }
      else if (histIdx < hist.length) { histIdx++; cmd.value = hist[histIdx] || ''; }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) { sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length; renderSug(); }
      else if (histIdx > 0) { histIdx--; cmd.value = hist[histIdx]; }
    } else if (e.key === 'Tab' && isOpen) {
      e.preventDefault();
      accept(Math.max(0, sugIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && sugIdx >= 0) accept(sugIdx);
      submit();
    } else if (e.key === 'Escape') {
      if (isOpen) closeSug(); else cmd.value = '';
    }
  });
  cmd.addEventListener('blur', () => setTimeout(closeSug, 120));
  sug.addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    const s = accept(+li.dataset.k);
    if (s.kind === 'Function') submit();
  });
  document.getElementById('goBtn').addEventListener('click', () => { if (cmd.value.trim()) submit(); else cmd.focus(); });

  // ---------- function keys ----------
  const FKEYS = [
    ['F1', 'Help', () => run('HELP')],
    ['F2', 'Top news', () => run('TOP')],
    ['F3', 'World', () => run('WEI')],
    ['F4', 'Movers', () => run('MOST')],
    ['F5', 'Currencies', () => run('FXC')],
    ['F6', 'Commodities', () => run('CMDTY')],
    ['F7', 'Treasuries', () => run('CRV')],
    ['F8', 'Monitor', () => run('MON')],
    ['F9', 'Next panel', () => setActive((active + 1) % panels.length)],
    ['F10', 'Maximize', () => toggleMax(panels[active])]
  ];
  const fkeys = document.getElementById('fkeys');
  fkeys.insertAdjacentHTML('afterbegin', FKEYS.map(([k, l], j) => `<button type="button" class="fkey" data-j="${j}"><kbd>${k}</kbd>${l}</button>`).join(''));
  fkeys.addEventListener('click', e => { const b = e.target.closest('.fkey'); if (b) FKEYS[+b.dataset.j][2](); });

  document.addEventListener('keydown', e => {
    const fk = FKEYS.find(([k]) => k === e.key);
    if (fk && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fk[2](); return; }
    if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); setActive(+e.key - 1); return; }
    if (e.target === cmd || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key.length === 1 && /[A-Za-z0-9?]/.test(e.key)) {
      // Typing anywhere goes to the command line, including this first keystroke.
      e.preventDefault();
      cmd.focus();
      cmd.value += e.key;
      buildSuggestions();
    }
  });

  // ---------- header, banner and tape ----------
  const simClock = document.getElementById('simClock');
  const clockPrefix = document.getElementById('clockPrefix');
  const mktState = document.getElementById('mktState');
  const feedEl = document.getElementById('feed');
  const banner = document.getElementById('banner');
  document.getElementById('dateLbl').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()).toUpperCase();
  function clock() {
    const c = M.clock();
    simClock.textContent = c.time;
    clockPrefix.textContent = c.prefix;
    mktState.textContent = c.state;
    mktState.classList.toggle('closed', !c.open);
    const f = M.feed();
    feedEl.lastChild.textContent = f.label;
    feedEl.dataset.state = f.state;
    const a = M.authError();
    if (a) { banner.hidden = false; banner.innerHTML = esc(a.message) + (a.kind === 'nokey' ? '' : ' Type <b>KEY</b> to update it.'); }
    else if (!M.mock) banner.hidden = true;
  }
  if (M.mock) {
    banner.hidden = false;
    banner.innerHTML = 'Mock API on localhost: these prices and headlines are made up for testing, not real market data.';
  }
  document.getElementById('disclaim').textContent = M.mock
    ? 'Mock API on localhost: made-up data for testing.'
    : M.source === 'Astral'
    ? 'Market data from Astral through your claude.ai connector. May be delayed. Not investment advice.'
    : 'Market data and news from Finnhub, for personal use. May be delayed. Not investment advice.';

  const TAPE = M.universe.tape;
  const tape = document.getElementById('tape');
  const tapeItem = s => `<button type="button" class="ti" data-tape="${s}" tabindex="-1"><b>${s}</b><span class="tl"></span><span class="tc"></span></button>`;
  tape.innerHTML = TAPE.map(tapeItem).join('') + TAPE.map(tapeItem).join('');
  const tapeEls = [...tape.querySelectorAll('[data-tape]')].map(el => ({ i: I[el.dataset.tape], l: el.querySelector('.tl'), c: el.querySelector('.tc') }));
  function updateTape() {
    tapeEls.forEach(({ i, l, c }) => {
      l.textContent = fmt(i.last, i.dec);
      c.textContent = pctStr(chgPct(i));
      setDir(c, chg(i));
    });
  }
  tape.addEventListener('click', e => { const b = e.target.closest('[data-tape]'); if (b) run(b.dataset.tape + ' GP'); });

  // ---------- boot ----------
  const saved = restore();
  for (let k = 0; k < 4; k++) {
    const p = makePanel(k);
    panels.push(p);
    let st = saved && saved.panels[k];
    if (st && st.fn === 'STORY') st = { fn: st.sym ? 'NEWS' : 'TOP', sym: st.sym };
    const wantsLookup = M.hasKey && st && FN[st.fn] && FN[st.fn].sec === 'req' && typeof st.sym === 'string' && /^[A-Z][A-Z.]{0,5}$/.test(st.sym) && !I[st.sym];
    if (!load(p, valid(st) ? st : DEFAULT[k], false)) load(p, DEFAULT[k], false);
    if (wantsLookup) open(p, st.fn, st.sym, st.fn === 'GP' && TFS.includes(st.tf) ? { tf: st.tf } : {}, false);
  }
  setActive(saved && saved.active >= 0 && saved.active < 4 ? saved.active : 0);
  clock();
  updateTape();
  status(M.hasKey
    ? 'Type any US ticker and a function, then press <b>Enter</b>. Try <b>NVDA GP 1Y</b>, <b>AAPL ERN</b>, <b>MSFT FA</b> or <b>EVTS</b>.'
    : 'Type <b>KEY</b> to add your free Finnhub key and load real prices, charts and news. Then try <b>NVDA GP 1Y</b>.');

  M.onTick(() => {
    panels.forEach(p => { if (p.ctl.tick) p.ctl.tick(); retitle(p); });
    clock();
    updateTape();
  });
  watch();
  M.start();
})();
