# Amberline Terminal

A professional-style market terminal that runs in your browser. It has a command line with autocomplete, four independent panels, candlestick charts, company profiles, news, function keys and a scrolling ticker tape.

Every company and price is real: US stocks, ETFs and market news come from [Finnhub](https://finnhub.io) through your own free API key, or, when the terminal is opened on claude.ai, from your Astral connector (see [Astral plugin](#astral-plugin)). Nothing is simulated. Without a key, the terminal lists the real tickers and asks for one instead of making up prices.

There's no build step, no server and no dependencies.

> **Before you show it to anyone:** Finnhub's terms allow personal use only and forbid sharing its data, or results derived from it, without Finnhub's written approval. Before you present, screenshot, record or stream live data, get that approval or a plan licensed for display. Otherwise show only the no-key screen.

![Amberline Terminal on first launch, asking for a Finnhub key next to real tickers](docs/screenshot.png)

> Amberline is an independent project. It is not affiliated with or endorsed by Bloomberg L.P., Finnhub or any exchange, and contains none of their code. Its function codes follow conventions widely documented for professional terminals, including Bloomberg's. S&P 500, Nasdaq-100, Dow Jones, Russell 2000 and Bloomberg are trademarks of their owners and are used only to describe what each ETF tracks or where a convention comes from. Company names and ticker symbols belong to their owners and are used only to identify securities. Market data may be delayed or incomplete. Nothing here is investment advice.

## Try it

- **Hosted:** after you enable GitHub Pages (see [Deploy](#deploy)), the terminal is at `https://<your-username>.github.io/amberline-terminal/`
- **Locally:** serve the folder and open <http://localhost:8000>:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

On first launch it asks for a key:

1. Get a free key at [finnhub.io/register](https://finnhub.io/register).
2. In the terminal, type `KEY` and press Enter.
3. Paste the key and select **Save and connect**.

Your key is stored in your browser's local storage and is sent only to Finnhub. Other pages served from the same address (for example, your other GitHub Pages projects under `<you>.github.io`) can read it, so use a dedicated domain if that matters to you. To remove it, open `KEY` and select **Remove key**.

## How to use it

Type a **ticker**, a **function**, or both, then press **Enter**. A ticker on its own opens its description. A function on its own reuses the ticker already in the panel. Add `P1` to `P4` to send the result to a specific panel. Any US stock or ETF ticker works, and autocomplete searches Finnhub as you type.

| Command | What it shows |
| --- | --- |
| `AAPL GP 6M` | Price graph: candles or line, volume, 20/50-day moving averages. `1D`, `1M`, `3M`, `6M`, `1Y`. |
| `MSFT DES` | Profile, market cap, P/E, EPS, dividend yield, beta, 52-week range, peers |
| `NVDA NEWS` | Company headlines from the last 7 days |
| `NVDA ANR` | Analyst recommendations: consensus, buy/hold/sell mix and six months of history |
| `AAPL ERN` | Earnings: next report date with EPS and revenue estimates, recent beats and misses (alias `EE`) |
| `MSFT FA` | Financial analysis: margins, returns, per-share data, multiples and leverage, annual or quarterly |
| `TSLA INS` | Insider transactions from Form 4 filings, with open-market buy and sell totals |
| `EVTS` | Earnings calendar for the next 7 or 14 days, filtered to large companies or all |
| `WL` | Your watchlist. `WL ADD PLTR COIN`, `WL DEL COIN`, `WL CLEAR`. Saved in your browser |
| `TOP` | Market headlines. Select one for the summary and a link to the publisher. |
| `WEI` | World markets through country and benchmark ETFs (SPY, QQQ, EWJ…) |
| `MOST` | Biggest gainers and losers among 20 large caps |
| `FXC` | Currency ETFs (FXE, FXY, UUP…) |
| `CMDTY` | Commodity ETFs (USO, GLD, CORN…) |
| `CRV` | Treasury ETFs by maturity, from T-bills to 20+ years |
| `MON` | 20 large caps with day range, intraday line and quote age |
| `KEY` | Add, check, change or remove your key; request budget |
| `HELP` | Every function, with examples and keyboard shortcuts |

### Keyboard

| Key | Action |
| --- | --- |
| `F1`–`F8` | Load HELP, TOP, WEI, MOST, FXC, CMDTY, CRV or MON into the active panel |
| `F9` | Move to the next panel |
| `F10` | Maximize or restore the active panel (or double-click a panel header) |
| `Alt`+`1`–`4` | Select a panel |
| `Tab` | Accept the highlighted autocomplete suggestion |
| `↑` / `↓` | Command history |
| `Esc` | Clear the command line |
| Any letter | Starts typing a command from anywhere on the page |

## What the free Finnhub plan covers

As understood in October 2026. Check [finnhub.io/pricing](https://finnhub.io/pricing) for the current plans.

| Data | Free plan | How Amberline handles it |
| --- | --- | --- |
| Real-time US stock and ETF quotes | Yes | Streamed over WebSocket (extended hours move the last price; charts and the day range use regular hours only), refreshed by REST about once a minute |
| Company profiles, metrics, peers | Yes | `DES` |
| Company and market news | Yes | `NEWS`, `TOP` |
| Historical candles | Usually not (paid add-on) | Add a free [Twelve Data](https://twelvedata.com/register) key in `KEY` and `GP` loads real daily and 5-minute history from there (8 requests a minute, 800 a day, cached). Without one, `GP` tries Finnhub candles, then charts live trades since you opened the page and says so. |
| Recommendation trends, earnings surprises, earnings calendar, insider transactions, basic financials | Yes | `ANR`, `ERN`, `EVTS`, `INS`, `FA` |
| Index levels, futures, spot FX, Treasury yields | No | `WEI`, `CMDTY`, `FXC` and `CRV` use US-listed ETFs as stand-ins and label them that way |
| 60 API calls a minute | Limit | A request queue sends at most 50 calls a minute and fetches the active panel first |

Finnhub's terms limit its plans to personal use and forbid sharing its data, or results derived from it, with anyone without Finnhub's written approval ([terms](https://finnhub.io/terms-of-service)). **Before you present, screenshot or record live data, get Finnhub's written approval or a plan licensed for display.** Without that, the terminal is for your own screen.

## How it works

![System design: the browser UI, the market layer, the Finnhub client and session engine, and the outside services they reach](docs/system-design.png)

```
index.html              page shell: top bar, command line, panel grid, function keys, tape
src/finnhub.js          Finnhub client: rate-limited queue, cache, error types, WebSocket stream
src/history.js          Twelve Data client for chart history (optional second key)
src/astral.js           Astral plugin: the same calls, answered by your claude.ai Astral connector
src/market.js           the market the panels read from: real instruments, sessions, charts, news
src/terminal.js         front end: command parser, autocomplete, panels, canvas charts
src/terminal.css        the look: dark trading-screen palette, IBM Plex type
tests/market.test.js    session-boundary tests for the live market (node tests/market.test.js)
tests/astral.test.js    tests for the Astral plugin (node tests/astral.test.js)
tests/screens.test.js   tests for ANR, ERN, FA, the no-Finnhub fallback and Twelve Data history
tools/mock_finnhub.py   a local stand-in for the Finnhub API, for development and tests
docs/TEARDOWN.md        the design study behind the interface
docs/system-design.png  the system design chart above
```

**The market** (`src/market.js`) is the only thing panels talk to. It exposes instruments, `bars()`, `profile()`, `news()`, `find()` and a once-a-second tick. It is built on the Finnhub client. Without a saved key, every request fails with a clear "no key" message, so panels show real tickers with no prices. Panels tell the market which symbols are on screen, so those get streamed and refreshed first.

**The Finnhub client** (`src/finnhub.js`) queues requests by priority and keeps them under the per-minute limit. It shares one request between callers asking for the same thing, caches results for a short time, and turns HTTP errors into clear kinds (`auth`, `premium`, `rate`, `network`, `nokey`). A request that hits the rate limit is retried once, 5 seconds later.

**The front end** (`src/terminal.js`). Each function (`GP`, `DES`, `WEI` and the rest) is a small module with a `mount` method that builds the panel and a `tick` method that updates only the cells that changed. Charts are drawn on `<canvas>`. News text from the API is always inserted as text, never as HTML, and only `http(s)` links are shown.

## Astral plugin

`src/astral.js` lets the terminal read real market data through Astral when it runs as an artifact on claude.ai. The page calls your Astral connector with the artifact `mcp` capability, so it uses your own Astral login and never sees a token.

```
panel → market.js → astral.js → claude.use("mcp") → your Astral connector
```

| Terminal call | Astral tool |
| --- | --- |
| Quotes (batched, many symbols per request) | `astral_research_full_quote_list` |
| `GP` charts (5-minute and daily bars) | `astral_price_get` |
| `NEWS` (company filings, linked to sec.gov) | `astral_research_sec_filings` |
| Ticker search in autocomplete | `astral_symbol_resolve` |

A saved Finnhub key always wins. Outside claude.ai (GitHub Pages, a local copy) there is no connector, so the plugin stays off. Astral doesn't provide market headlines or a live trade stream, so `TOP` explains that, and quotes refresh about once a minute. Each viewer needs Astral connected in claude.ai Settings, Connectors. Check Astral's terms before you show its data to an audience.

## Develop without a key

`tools/mock_finnhub.py` answers the same endpoints with made-up prices and headlines for testing (its holiday calendar uses real 2026 dates). It is never used unless you point the page at it:

```bash
python tools/mock_finnhub.py
```

Then open `http://localhost:8000/?api=http://localhost:8766/api/v1&ws=off&td=http://localhost:8766/td` and save any key in `KEY` (and any Twelve Data key to test chart history). Add `--candles` to act like a paid plan that includes historical candles. The key `bad` is rejected so you can test that path. The `api` and `ws` overrides only work when both the page and the endpoint are on `localhost`, so a crafted link can't send someone's key elsewhere.

## Deploy

The repo includes a GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes the site to GitHub Pages on every push to `main`.

1. Push the repo to GitHub.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push again, or run the workflow from the **Actions** tab. The URL appears in the workflow summary.

The workflow publishes only `index.html`, `src/`, `LICENSE` and `.nojekyll`. Any static host works too. Embedded previews that block outside network requests can't reach Finnhub. On claude.ai the Astral plugin supplies data instead.

## License

[MIT](LICENSE). IBM Plex is loaded from Google Fonts under the SIL Open Font License. Market data belongs to Finnhub and its sources and is not covered by this license.
