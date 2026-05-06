// Fetches OHLCV candlestick data from Yahoo Finance for a given NSE/BSE stock.
// Query params:
//   symbol   — trading symbol, e.g. RELIANCE
//   exchange — NSE | BSE
//   range    — 1d | 5d | 1mo | 3mo | 6mo | 1y | max  (default: 3mo)

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { symbol, exchange, range = "3mo" } = event.queryStringParameters || {};
  if (!symbol || !exchange)
    return { statusCode: 400, headers: H, body: JSON.stringify({ ok: false, error: "symbol and exchange required" }) };

  const suffix  = exchange.toUpperCase() === "BSE" ? ".BO" : ".NS";
  const yfSym   = encodeURIComponent(`${symbol}${suffix}`);

  const intervalMap = {
    "1d":  "5m",
    "5d":  "15m",
    "1mo": "1d",
    "3mo": "1d",
    "6mo": "1d",
    "1y":  "1d",
    "2y":  "1wk",
    "5y":  "1wk",
    "max": "1mo",
  };
  const interval = intervalMap[range] || "1d";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}` +
              `?range=${range}&interval=${interval}&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept":     "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const r    = json?.chart?.result?.[0];
    if (!r)    throw new Error("No data returned by Yahoo Finance");

    const meta = r.meta || {};
    const ts   = r.timestamp || [];
    const q    = r.indicators?.quote?.[0] || {};

    return {
      statusCode: 200,
      headers:    H,
      body: JSON.stringify({
        ok: true,
        meta: {
          shortName:            meta.shortName || meta.longName || symbol,
          currency:             meta.currency  || "INR",
          regularMarketPrice:   meta.regularMarketPrice,
          previousClose:        meta.chartPreviousClose || meta.previousClose,
          regularMarketDayHigh: meta.regularMarketDayHigh,
          regularMarketDayLow:  meta.regularMarketDayLow,
          regularMarketVolume:  meta.regularMarketVolume,
          fiftyTwoWeekHigh:     meta.fiftyTwoWeekHigh,
          fiftyTwoWeekLow:      meta.fiftyTwoWeekLow,
          marketCap:            meta.marketCap,
        },
        timestamps: ts,
        ohlcv: {
          open:   q.open   || [],
          high:   q.high   || [],
          low:    q.low    || [],
          close:  q.close  || [],
          volume: q.volume || [],
        },
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
