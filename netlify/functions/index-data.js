// Returns last 90 days of daily closes + current price for Nifty 50 and Sensex
// Yahoo Finance symbols: ^NSEI (Nifty 50), ^BSESN (Sensex)

exports.handler = async () => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json"
  };

  async function fetchIndex(sym) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;
    const res  = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const r    = json?.chart?.result?.[0];
    if (!r) throw new Error("No data");
    const meta   = r.meta;
    const ts     = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    return {
      price:     meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose || meta.previousClose,
      high:      meta.regularMarketDayHigh,
      low:       meta.regularMarketDayLow,
      dates:     ts.map(t => new Date(t * 1000).toISOString().slice(0, 10)),
      closes:    closes.map(c => c != null ? +c.toFixed(2) : null)
    };
  }

  const [nifty, sensex] = await Promise.allSettled([
    fetchIndex("^NSEI"),
    fetchIndex("^BSESN")
  ]);

  return {
    statusCode: 200,
    headers: H,
    body: JSON.stringify({
      ok: true,
      nifty:  nifty.status  === "fulfilled" ? nifty.value  : { error: nifty.reason?.message  },
      sensex: sensex.status === "fulfilled" ? sensex.value : { error: sensex.reason?.message }
    })
  };
};
