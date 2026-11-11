"""A stand-in for the Finnhub REST API, for developing Amberline without a real key.

Every value it returns is made up. Run it, then open the terminal with the dev
override (only honored when the page is served from localhost):

    python tools/mock_finnhub.py            # free plan: candles return 403
    python tools/mock_finnhub.py --candles  # paid plan: candles included
    http://localhost:8000/?api=http://localhost:8766/api/v1&ws=off

Save any key in the KEY panel. The key "bad" is rejected with a 401.
"""
import argparse
import hashlib
import json
import math
import random
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CANDLES = False


def rng_for(*parts):
    seed = int(hashlib.sha256(":".join(map(str, parts)).encode()).hexdigest()[:12], 16)
    return random.Random(seed)


def base_price(sym):
    return round(20 + rng_for(sym, "base").random() * 480, 2)


def quote(sym):
    if sym.startswith("ZZZ"):
        return {"c": 0, "d": None, "dp": None, "h": 0, "l": 0, "o": 0, "pc": 0, "t": 0}
    r = rng_for(sym, int(time.time() // 20))
    pc = base_price(sym)
    c = round(pc * (1 + r.gauss(0, 0.012)), 2)
    o = round(pc * (1 + r.gauss(0, 0.004)), 2)
    return {"c": c, "d": round(c - pc, 2), "dp": round((c / pc - 1) * 100, 4), "h": round(max(c, o) * 1.006, 2),
            "l": round(min(c, o) * 0.994, 2), "o": o, "pc": pc, "t": int(time.time())}


EPOCH = 1704067200  # 2024-01-01: walks start here, so overlapping ranges agree


def candles(sym, res, frm, to):
    """Weekday bars from a seeded walk, scaled so the latest close equals the quote's previous close."""
    step = 300 if res == "5" else 86400
    start = EPOCH if step == 86400 else frm - frm % 86400
    bars, p, t = [], 1.0, start - start % step
    while t <= to:
        if time.gmtime(t).tm_wday < 5:
            r = rng_for(sym, res, t)
            o = p
            p = p * math.exp(r.gauss(0.0003, 0.015 if step == 86400 else 0.0015))
            ext = abs(r.gauss(0, 0.004 if step == 86400 else 0.0008))
            vol = int(r.uniform(2e7, 6e7) if step == 86400 else r.uniform(5e4, 6e5))
            bars.append((t, o, max(o, p) * (1 + ext), min(o, p) * (1 - ext), p, vol))
        t += step
    if not bars:
        return {"s": "no_data"}
    k = base_price(sym) / bars[-1][4]
    keep = [b for b in bars if b[0] >= frm]
    return {"s": "ok", "t": [b[0] for b in keep], "o": [round(b[1] * k, 2) for b in keep], "h": [round(b[2] * k, 2) for b in keep],
            "l": [round(b[3] * k, 2) for b in keep], "c": [round(b[4] * k, 2) for b in keep], "v": [b[5] for b in keep]}


def news(sym):
    now = int(time.time())
    who = sym or "the market"
    return [{"category": "company" if sym else "general", "datetime": now - k * 1700, "headline": f"Mock headline {k + 1} about {who}",
             "id": abs(hash((sym, k))) % 10**8, "image": "", "related": sym or "SPY", "source": "Mock Wire",
             "summary": "Placeholder summary from the local mock server. Not real news.", "url": "https://example.com/mock-story"}
            for k in range(12)]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/td/time_series":
            sym = q.get("symbol", "").upper()
            if q.get("apikey") == "bad":
                return self._send(200, {"code": 401, "message": "Invalid key", "status": "error"})
            now = int(time.time())
            if q.get("interval") == "1day":
                c = candles(sym, "D", now - 330 * 86400 * 7 // 5, now)
                fmt_t = lambda t: time.strftime("%Y-%m-%d", time.gmtime(t))
            else:
                c = candles(sym, "5", now - 4 * 86400, now)
                fmt_t = lambda t: time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t))
            vals = [{"datetime": fmt_t(t), "open": str(o), "high": str(h), "low": str(l), "close": str(cl), "volume": str(v)}
                    for t, o, h, l, cl, v in zip(c["t"], c["o"], c["h"], c["l"], c["c"], c["v"])]
            return self._send(200, {"meta": {"symbol": sym}, "values": vals[-int(q.get("outputsize", 30)):], "status": "ok"})
        if q.get("token") == "bad":
            return self._send(401, {"error": "Invalid API key."})
        sym = q.get("symbol", "").upper()
        path = u.path.replace("/api/v1", "", 1)
        if path == "/quote":
            return self._send(200, quote(sym))
        if path == "/stock/profile2":
            return self._send(200, {"name": f"{sym} Mock Corp", "exchange": "MOCK EXCHANGE", "country": "US", "ipo": "2001-01-01",
                                    "finnhubIndustry": "Mock Industry", "marketCapitalization": 123456.7, "shareOutstanding": 987.6,
                                    "weburl": "https://example.com/", "ticker": sym})
        if path == "/stock/metric":
            r = rng_for(sym, "fa")
            def ser(base, sd, n, quarterly=False):
                ends = [f"{2025 - k}-09-30" for k in range(n)] if not quarterly else [f"{2026 - (k + 1) // 4}-{['09', '06', '03', '12'][k % 4]}-{['30', '30', '31', '31'][k % 4]}" for k in range(n)]
                return [{"period": e, "v": round(base * (1 + r.gauss(0, sd)), 4)} for e in ends]
            def block(q):
                n = 12 if q else 8
                return {"eps": ser(6, .15, n, q), "salesPerShare": ser(25, .1, n, q), "grossMargin": ser(.44, .03, n, q), "operatingMargin": ser(.30, .05, n, q),
                        "netMargin": ser(.25, .05, n, q), "roe": ser(1.5, .1, n, q), "roa": ser(.28, .05, n, q), "pe": ser(28, .15, n, q),
                        "ps": ser(7, .1, n, q), "pb": ser(40, .1, n, q), "currentRatio": ser(.95, .05, n, q), "totalDebtToEquity": ser(1.6, .1, n, q)}
            return self._send(200, {"metric": {"52WeekHigh": base_price(sym) * 1.3, "52WeekLow": base_price(sym) * 0.7, "beta": 1.1,
                                               "peTTM": 24.5, "epsTTM": 6.2, "currentDividendYieldTTM": 1.1, "10DayAverageTradingVolume": 12.3,
                                               "grossMarginTTM": 44.1, "netProfitMarginTTM": 24.9, "roeTTM": 151.0},
                                    "series": {"annual": block(False), "quarterly": block(True)},
                                    "metricType": "all", "symbol": sym})
        if path == "/stock/peers":
            return self._send(200, [sym, "MSFT", "GOOGL", "META"])
        if path == "/stock/candle":
            if not CANDLES:
                return self._send(403, {"error": "You don't have access to this resource."})
            return self._send(200, candles(sym, q.get("resolution", "D"), int(q.get("from", 0)), int(q.get("to", 0))))
        if path == "/company-news":
            return self._send(200, news(sym))
        if path == "/news":
            return self._send(200, news(None))
        if path == "/search":
            s = q.get("q", "").upper()
            return self._send(200, {"count": 2, "result": [{"description": f"{s} MOCK INC", "displaySymbol": s, "symbol": s, "type": "Common Stock"},
                                                           {"description": f"{s} MOCK ETF", "displaySymbol": s + "X", "symbol": s + "X", "type": "ETP"}]})
        if path == "/stock/market-holiday":
            return self._send(200, {"exchange": "US", "timezone": "America/New_York", "data": [
                {"eventName": "Christmas", "atDate": "2026-12-25", "tradingHour": ""},
                {"eventName": "Thanksgiving Day", "atDate": "2026-11-27", "tradingHour": "09:30-13:00"},
                {"eventName": "Thanksgiving Day", "atDate": "2026-11-26", "tradingHour": ""}]})
        if path == "/stock/recommendation":
            r = rng_for(sym, "rec")
            out = []
            for k in range(6):
                m = 11 - k
                y = 2026 if m > 0 else 2025
                out.append({"symbol": sym, "period": f"{y}-{(m - 1) % 12 + 1:02d}-01", "strongBuy": r.randint(5, 15), "buy": r.randint(10, 25),
                            "hold": r.randint(3, 12), "sell": r.randint(0, 3), "strongSell": r.randint(0, 1)})
            return self._send(200, out)
        if path == "/stock/earnings":
            r = rng_for(sym, "ern")
            out = []
            for k, (y, q, per) in enumerate([(2026, 3, "2026-09-30"), (2026, 2, "2026-06-30"), (2026, 1, "2026-03-31"), (2025, 4, "2025-12-31")]):
                est = round(1 + r.random() * 2, 2)
                act = round(est * (1 + r.gauss(0.03, 0.05)), 2)
                out.append({"symbol": sym, "period": per, "year": y, "quarter": q, "estimate": est, "actual": act,
                            "surprise": round(act - est, 4), "surprisePercent": round((act / est - 1) * 100, 4)})
            return self._send(200, out)
        if path == "/calendar/earnings":
            day = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400 * 3))
            if sym:
                return self._send(200, {"earningsCalendar": [{"symbol": sym, "date": day, "hour": "amc", "year": 2026, "quarter": 4,
                                                              "epsEstimate": 2.31, "revenueEstimate": 5.2e10, "epsActual": None, "revenueActual": None}]})
            rows = []
            for k, s2 in enumerate(["AAPL", "MSFT", "NVDA", "WMT", "TINY", "SMOL", "HD", "LOW", "TGT", "CSCO"]):
                d = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 86400 * (k % 5)))
                rows.append({"symbol": s2, "date": d, "hour": ["bmo", "amc", "", "dmh"][k % 4], "year": 2026, "quarter": 4,
                             "epsEstimate": round(0.5 + k * 0.3, 2), "revenueEstimate": 2e8 if s2 in ("TINY", "SMOL") else 1e10 * (k + 1)})
            return self._send(200, {"earningsCalendar": rows})
        if path == "/stock/insider-transactions":
            r = rng_for(sym, "ins")
            rows = []
            for k in range(14):
                code = ["S", "S", "M", "F", "P", "A", "S"][k % 7]
                ch = r.randint(1000, 90000) * (-1 if code in ("S", "F") else 1)
                rows.append({"name": ["DOE JANE", "SMITH JOHN A", "LEE KIM"][k % 3], "share": r.randint(100000, 5000000), "change": ch,
                             "filingDate": time.strftime("%Y-%m-%d", time.gmtime(time.time() - 86400 * (k * 9 + 1))),
                             "transactionDate": time.strftime("%Y-%m-%d", time.gmtime(time.time() - 86400 * (k * 9 + 3))),
                             "transactionCode": code, "transactionPrice": 0 if code in ("A", "M") else round(base_price(sym) * r.uniform(.9, 1.1), 2)})
            return self._send(200, {"data": rows, "symbol": sym})
        if path == "/stock/market-status":
            return self._send(200, {"exchange": "US", "holiday": None, "isOpen": True, "session": "regular", "t": int(time.time()), "timezone": "America/New_York"})
        return self._send(404, {"error": "Unknown endpoint"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--candles", action="store_true", help="act like a paid plan that includes historical candles")
    args = ap.parse_args()
    CANDLES = args.candles
    print(f"Mock Finnhub on http://localhost:{args.port}/api/v1 (candles {'on' if CANDLES else 'off'})")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
