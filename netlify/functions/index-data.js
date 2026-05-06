// Returns OHLCV data for Nifty 50 and Sensex for a given range.
// Optional query param: range = 1d | 5d | 1mo | 3mo | 6mo | 1y | max  (default: 3mo)

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { range = "3mo" } = event.queryStringParameters || {};

  const intervalMap = {
    "1d": "5m", "5d": "15m", "1mo": "1d", "3mo": "1d",
    "6mo": "1d", "1y": "1d", "2y": "1wk", "5y": "1wk", "max": "1mo",
  };
  const interval = intervalMap[range] || "1d";
  const intraday = range === "1d" || range === "5d";

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };

  async function fetchIndex(sym) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
                `?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r) throw new Error("No data");
    const meta   = r.meta;
    const ts     = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    // intraday: keep Unix timestamps; daily: convert to YYYY-MM-DD strings
    const times  = intraday
      ? ts
      : ts.map(t => new Date(t * 1000).toISOString().slice(0, 10));
    return {
      price:     meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose || meta.previousClose,
      high:      meta.regularMarketDayHigh,
      low:       meta.regularMarketDayLow,
      intraday,
      times,
      closes:    closes.map(c => c != null ? +c.toFixed(2) : null),
    };
  }

  const [nifty, sensex] = await Promise.allSettled([
    fetchIndex("^NSEI"),
    fetchIndex("^BSESN"),
  ]);

  return {
    statusCode: 200,
    headers: H,
    body: JSON.stringify({
      ok:     true,
      range,
      nifty:  nifty.status  === "fulfilled" ? nifty.value  : { error: nifty.reason?.message  },
      sensex: sensex.status === "fulfilled" ? sensex.value : { error: sensex.reason?.message },
    }),
  };
};
