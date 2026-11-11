/*
 * Amberline Terminal: a small Finnhub client.
 *
 * Uses the viewer's own API key, kept in their browser. Requests go through a
 * priority queue that sends at most 50 calls a minute (the free plan allows 60), and
 * identical requests share one in-flight promise and a short cache.
 * Docs: https://finnhub.io/docs/api
 */
(function (root) {
  'use strict';

  const DEFAULT_API = 'https://finnhub.io/api/v1';
  const DEFAULT_WS = 'wss://ws.finnhub.io';

  class FinnhubError extends Error {
    // kind: auth | premium | rate | notfound | network | http | nokey
    constructor(kind, message, status) {
      super(message);
      this.kind = kind;
      this.status = status || 0;
    }
  }

  function create(opts) {
    const key = opts.key;
    const api = opts.api || DEFAULT_API;
    const wsUrl = opts.ws === undefined ? DEFAULT_WS : opts.ws;
    const perMinute = opts.perMinute || 50;
    const queue = [];
    const stamps = [];
    const cache = new Map();
    let inflight = 0, timer = null;
    const stats = { sent: 0, failed: 0, lastError: null };

    function pump() {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 60000) stamps.shift();
      while (queue.length && stamps.length < perMinute && inflight < 4) {
        queue.sort((a, b) => b.pri - a.pri);
        run(queue.shift());
      }
      if (queue.length && !timer) {
        const wait = stamps.length >= perMinute ? 60000 - (now - stamps[0]) + 50 : 250;
        timer = setTimeout(() => { timer = null; pump(); }, Math.max(50, wait));
      }
    }

    function run(job) {
      stamps.push(Date.now());
      inflight++;
      stats.sent++;
      const qs = new URLSearchParams(job.params);
      qs.set('token', key);
      fetch(api + job.path + '?' + qs.toString(), { cache: 'no-store' })
        .then(async res => {
          let body = null;
          try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
          const msg = body && body.error ? String(body.error) : res.statusText || 'Request failed';
          if (res.status === 401) throw new FinnhubError('auth', 'Finnhub rejected the API key. Check it and try again.', 401);
          if (res.status === 403) throw new FinnhubError('premium', "Your Finnhub plan doesn't include this data.", 403);
          if (res.status === 429) throw new FinnhubError('rate', 'Finnhub rate limit reached.', 429);
          if (!res.ok) throw new FinnhubError('http', msg, res.status);
          if (body && body.error) {
            const premium = /access/i.test(body.error);
            throw new FinnhubError(premium ? 'premium' : 'http', premium ? "Your Finnhub plan doesn't include this data." : msg, res.status);
          }
          return body;
        }, () => { throw new FinnhubError('network', "Couldn't reach Finnhub. Check your connection. Embedded previews may block outside requests."); })
        .then(job.resolve, err => {
          if (err.kind === 'rate' && job.tries < 1) { // retry once
            job.tries++;
            setTimeout(() => { queue.push(job); pump(); }, 5000);
            return;
          }
          stats.failed++;
          stats.lastError = err;
          job.reject(err);
        })
        .finally(() => { inflight--; pump(); });
    }

    // ttl: milliseconds a result stays fresh; pri: higher runs first.
    function get(path, params, ttl, pri) {
      const id = path + '?' + new URLSearchParams(params).toString();
      const hit = cache.get(id);
      if (hit && (hit.pending || Date.now() - hit.at < ttl)) return hit.promise;
      const promise = new Promise((resolve, reject) => {
        queue.push({ path, params, pri: pri || 0, tries: 0, resolve, reject });
        pump();
      });
      const entry = { promise, pending: true, at: 0 };
      cache.set(id, entry);
      promise.then(() => { entry.pending = false; entry.at = Date.now(); }, () => { cache.delete(id); });
      return promise;
    }

    const ymd = d => d.toISOString().slice(0, 10);

    const client = {
      stats,
      budget: () => ({ used: stamps.filter(t => Date.now() - t < 60000).length, perMinute, queued: queue.length }),
      quote: (symbol, pri) => get('/quote', { symbol }, 15000, pri),
      profile: symbol => get('/stock/profile2', { symbol }, 6 * 3600e3, 1),
      metrics: symbol => get('/stock/metric', { symbol, metric: 'all' }, 3600e3, 1),
      peers: symbol => get('/stock/peers', { symbol }, 6 * 3600e3, 0),
      marketNews: () => get('/news', { category: 'general' }, 4 * 60e3, 1),
      companyNews(symbol) {
        const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
        return get('/company-news', { symbol, from: ymd(from), to: ymd(to) }, 4 * 60e3, 1);
      },
      candles: (symbol, resolution, from, to) => get('/stock/candle', { symbol, resolution, from: String(from), to: String(to) }, resolution === 'D' ? 3600e3 : 60e3, 2),
      search: q => get('/search', { q, exchange: 'US' }, 600e3, 3),
      marketStatus: () => get('/stock/market-status', { exchange: 'US' }, 120e3, 0),
      marketHoliday: () => get('/stock/market-holiday', { exchange: 'US' }, 12 * 3600e3, 0),
      recommendation: symbol => get('/stock/recommendation', { symbol }, 6 * 3600e3, 2),
      earnings: symbol => get('/stock/earnings', { symbol }, 6 * 3600e3, 2),
      earningsCalendar(from, to, symbol) {
        const p = { from, to };
        if (symbol) p.symbol = symbol;
        return get('/calendar/earnings', p, 3600e3, 2);
      },
      insiders(symbol, from, to) { return get('/stock/insider-transactions', { symbol, from, to }, 3600e3, 2); },

      // Live trades over WebSocket. Calls onTrade(symbol, price, volume, ms),
      // onState(connecting | open | closed | off) and onError(message).
      stream(onTrade, onState, onError) {
        if (!wsUrl || typeof WebSocket === 'undefined') { onState('off'); return { set() {}, close() {} }; }
        let sock = null, retry = 0, closed = false;
        const subs = new Set();
        const send = (type, symbol) => { if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type, symbol })); };
        function open() {
          try { sock = new WebSocket(wsUrl + '?token=' + encodeURIComponent(key)); } catch (e) { onState('off'); return; }
          onState('connecting');
          sock.onopen = () => { retry = 0; onState('open'); subs.forEach(s => send('subscribe', s)); };
          sock.onmessage = e => {
            let m;
            try { m = JSON.parse(e.data); } catch (err) { return; }
            if (m.type === 'trade' && Array.isArray(m.data)) m.data.forEach(t => onTrade(String(t.s), +t.p, +t.v || 0, +t.t));
            else if (m.type === 'error' && onError) onError(String(m.msg || 'Finnhub stream error'));
          };
          sock.onclose = () => {
            onState('closed');
            if (!closed && retry < 8) setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
            else if (!closed) onState('off');
          };
        }
        open();
        return {
          // The free plan allows 50 symbols on one connection.
          set(symbols) {
            const next = new Set(symbols.slice(0, 50));
            subs.forEach(s => { if (!next.has(s)) { send('unsubscribe', s); subs.delete(s); } });
            next.forEach(s => { if (!subs.has(s)) { subs.add(s); send('subscribe', s); } });
          },
          close() { closed = true; if (sock) sock.close(); }
        };
      }
    };
    return client;
  }

  root.Finnhub = { create, FinnhubError, DEFAULT_API, DEFAULT_WS };
})(window);
