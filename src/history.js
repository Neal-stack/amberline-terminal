/*
 * Amberline Terminal: price history from Twelve Data.
 *
 * Finnhub's free plan has no historical candles, so with an optional free
 * Twelve Data key the GP charts load real daily and 5-minute bars from here.
 * The free plan allows 8 requests a minute and 800 a day, so requests are
 * queued under that limit and results are cached.
 * Docs: https://twelvedata.com/docs#time-series
 */
(function (root) {
  'use strict';

  const DEFAULT_API = 'https://api.twelvedata.com';
  const KEY_STORE = 'amberline.twelvedata.key';

  function readKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function writeKey(k) {
    try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); return true; } catch (e) { return false; }
  }

  // "2026-11-10" is a trading day (midnight UTC, like Finnhub's daily bars);
  // "2026-11-10 15:55:00" is a UTC time because requests ask for timezone=UTC.
  function parseTime(s) {
    const t = String(s || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(t + 'T00:00:00Z');
    return Date.parse(t.replace(' ', 'T') + 'Z');
  }

  function create(opts) {
    const key = opts.key;
    const api = opts.api || DEFAULT_API;
    const Err = opts.Error;
    const perMinute = opts.perMinute || 8;
    const queue = [], stamps = [], cache = new Map();
    let timer = null;
    const stats = { sent: 0, lastError: null };

    function pump() {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 60000) stamps.shift();
      while (queue.length && stamps.length < perMinute) run(queue.shift());
      if (queue.length && !timer) {
        timer = setTimeout(() => { timer = null; pump(); }, Math.max(250, 60000 - (now - stamps[0]) + 50));
      }
    }

    function run(job) {
      stamps.push(Date.now());
      stats.sent++;
      const qs = new URLSearchParams(Object.assign({}, job.params, { apikey: key, timezone: 'UTC', order: 'ASC' }));
      fetch(api + '/time_series?' + qs.toString(), { cache: 'no-store' })
        .then(res => res.json().catch(() => ({ status: 'error', code: res.status, message: res.statusText })), () => {
          throw new Err('network', "Couldn't reach Twelve Data for chart history.");
        })
        .then(body => {
          if (body && body.status === 'error') {
            const code = +body.code || 0;
            if (code === 401 || code === 403) throw new Err('auth', 'Twelve Data rejected the key. Check it with KEY.');
            if (code === 429) throw new Err('rate', 'Twelve Data limit reached (8 a minute, 800 a day on the free plan). Try again shortly.');
            if (code === 400 || code === 404) throw new Err('notfound', 'Twelve Data has no history for this symbol.');
            throw new Err('http', String(body.message || 'Twelve Data returned an error.'));
          }
          const values = body && Array.isArray(body.values) ? body.values : [];
          return values.map(v => ({ t: parseTime(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +v.volume || 0 }))
            .filter(b => isFinite(b.t) && b.c > 0);
        })
        .then(job.resolve, err => { stats.lastError = err; job.reject(err); });
    }

    function get(params, ttl) {
      const id = new URLSearchParams(params).toString();
      const hit = cache.get(id);
      if (hit && (hit.pending || Date.now() - hit.at < ttl)) return hit.promise;
      const promise = new Promise((resolve, reject) => { queue.push({ params, resolve, reject }); pump(); });
      const entry = { promise, pending: true, at: 0 };
      cache.set(id, entry);
      promise.then(() => { entry.pending = false; entry.at = Date.now(); }, () => cache.delete(id));
      return promise;
    }

    return {
      stats,
      // Daily bars: enough for a 1Y chart plus its 50-day average.
      daily: symbol => get({ symbol, interval: '1day', outputsize: '330' }, 3600e3),
      // 5-minute bars covering the last couple of sessions.
      intraday: symbol => get({ symbol, interval: '5min', outputsize: '200' }, 60e3)
    };
  }

  root.History = { create, readKey, writeKey, DEFAULT_API, parseTime };
})(window);
