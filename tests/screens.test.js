// Tests for the analyst, earnings, fundamentals and history additions, run with: node tests/screens.test.js
// A fake Finnhub client and a fake Twelve Data fetch; nothing touches the network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let failed = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log('PASS', name, 'got=' + g);
  else { failed++; console.log('FAIL', name, 'got=' + g, 'want=' + w); }
}

function boot(client, opts = {}) {
  const store = Object.assign({ 'amberline.finnhub.key': 'testkeytestkey' }, opts.store || {});
  const win = {
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    location: { hostname: 'example.com', search: '' },
    Finnhub: { create: () => client, FinnhubError: class extends Error { constructor(kind, m) { super(m); this.kind = kind; } }, DEFAULT_API: 'x' }
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, {
    Intl, Date, Math, URL, URLSearchParams, Promise, console, setTimeout,
    setInterval: () => 0, fetch: opts.fetch, WebSocket: undefined
  }));
  if (opts.history) vm.runInContext(read('history.js'), ctx);
  vm.runInContext(read('market.js'), ctx);
  return win.AmberlineMarket;
}

const base = {
  budget: () => ({ used: 0, perMinute: 50, queued: 0 }),
  quote: () => Promise.resolve({ c: 100, pc: 99, o: 99, h: 101, l: 98, t: Math.floor(Date.now() / 1000) }),
  profile: () => Promise.resolve({}), peers: () => Promise.resolve([]),
  marketStatus: () => Promise.reject(new Error('x')), marketHoliday: () => Promise.resolve({ data: [] }),
  candles: () => Promise.reject(Object.assign(new Error('premium'), { kind: 'premium' })),
  stream(t, s) { s('off'); return { set() {}, close() {} }; }
};

(async () => {
  console.log('-- analyst consensus');
  const M1 = boot(Object.assign({}, base, {
    recommendation: () => Promise.resolve([
      { period: '2026-10-01', strongBuy: 10, buy: 10, hold: 0, sell: 0, strongSell: 0 },
      { period: '2026-11-01', strongBuy: 0, buy: 0, hold: 10, sell: 0, strongSell: 0 },
      { period: '2026-09-01', strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }
    ])
  }));
  const a = await M1.analyst('AAPL');
  eq('newest month first, empty months dropped', a.rows.map(r => r.period), ['2026-11-01', '2026-10-01']);
  eq('all-hold consensus', [a.score, a.label], [3, 'Hold']);

  console.log('-- earnings: next date picks this symbol, history newest first');
  const M2 = boot(Object.assign({}, base, {
    earnings: () => Promise.resolve([{ period: '2026-03-31', actual: 1, estimate: 0.9 }, { period: '2026-06-30', actual: 1.2, estimate: 1.3 }]),
    earningsCalendar: () => Promise.resolve({ earningsCalendar: [{ symbol: 'MSFT', date: '2099-01-02' }, { symbol: 'AAPL', date: '2099-01-05', hour: 'amc', epsEstimate: 2 }] })
  }));
  const e = await M2.earnings('AAPL');
  eq('history order', e.history.map(x => x.period), ['2026-06-30', '2026-03-31']);
  eq('next report', [e.next.date, e.next.hour, e.next.epsEst], ['2099-01-05', 'amc', 2]);

  console.log('-- fundamentals: fractions scaled to percent, EPS growth computed');
  const M3 = boot(Object.assign({}, base, {
    metrics: () => Promise.resolve({
      metric: { grossMarginTTM: 45 },
      series: { annual: { grossMargin: [{ period: '2025-09-30', v: 0.45 }, { period: '2024-09-30', v: 0.40 }], eps: [{ period: '2025-09-30', v: 6 }, { period: '2024-09-30', v: 5 }] }, quarterly: {} }
    })
  }));
  const f = await M3.fundamentals('AAPL');
  const gm = f.annual.rows.find(r => r.k === 'grossMargin');
  eq('gross margin in percent', Math.round(gm.values['2025-09-30']), 45);
  eq('periods oldest first', f.annual.periods, ['2024-09-30', '2025-09-30']);
  eq('EPS growth', Math.round(f.annual.rows.find(r => r.k === 'epsg').values['2025-09-30']), 20);
  const M3b = boot(Object.assign({}, base, {
    metrics: () => Promise.resolve({ metric: { grossMarginTTM: 45 }, series: { annual: { grossMargin: [{ period: '2025-09-30', v: 44 }] } } })
  }));
  eq('series already in percent stays as is', (await M3b.fundamentals('AAPL')).annual.rows[0].values['2025-09-30'], 44);

  console.log('-- screens without Finnhub methods explain instead of crashing');
  const M4 = boot(Object.assign({}, base));
  const err = await M4.analyst('AAPL').then(() => null, x => x.kind);
  eq('missing method reads as premium', err, 'premium');

  console.log('-- history: Twelve Data bars feed 6M charts when Finnhub has none');
  const day = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  const values = [];
  for (let k = 200; k >= 1; k--) values.push({ datetime: day(k), open: '10', high: '11', low: '9', close: String(10 + k / 100), volume: '1000' });
  let calls = 0;
  const fetch = url => { calls++; eq('asks for UTC times', /timezone=UTC/.test(url), true); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok', values }) }); };
  const M5 = boot(Object.assign({}, base), { history: true, fetch, store: { 'amberline.twelvedata.key': 'tdkeytdkeytdkeytdkey' } });
  await M5.ensure('AAPL');
  eq('history reported on', [M5.candles(), M5.historySource()], [true, 'Twelve Data']);
  const r = await M5.bars('AAPL', '6M');
  eq('daily chart from history', [r.kind, r.series().length], ['daily', 126]);
  await M5.bars('AAPL', '1Y');
  eq('cached: one request for both', calls, 1);
  eq('date-only times are trading days', vm.runInNewContext('History.parseTime("2026-11-10")', (() => { const w = {}; w.window = w; vm.runInNewContext(read('history.js'), w); return w; })()), Date.parse('2026-11-10T00:00:00Z'));

  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
