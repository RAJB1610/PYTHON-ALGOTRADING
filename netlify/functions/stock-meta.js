// Looks up stock metadata such as sector and industry from Yahoo Finance Search.
// Query params:
//   symbol   trading symbol, e.g. RELIANCE
//   exchange NSE | BSE (default: inferred from suffix or NSE)

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const rawSymbol = event.queryStringParameters?.symbol?.trim();
  const exchange = (event.queryStringParameters?.exchange || "").trim().toUpperCase();
  if (!rawSymbol) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ ok: false, error: "symbol required" }) };
  }

  const clean = rawSymbol.toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, "").replace(/[^A-Z0-9&-]/g, "");
  if (!clean) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ ok: false, error: "invalid symbol" }) };
  }

  const preferredSuffix = exchange === "BSE" || exchange === "BO" || /\.BO$/i.test(rawSymbol) ? ".BO" : ".NS";
  const candidates = [
    `${clean}${preferredSuffix}`,
    `${clean}${preferredSuffix === ".NS" ? ".BO" : ".NS"}`,
    clean
  ];

  try {
    let quote = null;
    for (const candidate of candidates) {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(candidate)}&quotesCount=8&newsCount=0`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com/"
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) throw new Error(`Yahoo search HTTP ${res.status}`);

      const json = await res.json();
      const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
      quote = quotes.find(q => String(q.symbol || "").toUpperCase() === candidate)
        || quotes.find(q => String(q.symbol || "").toUpperCase().startsWith(`${clean}.`))
        || quotes.find(q => q.quoteType === "EQUITY" && (q.sector || q.industry))
        || null;
      if (quote) break;
    }

    if (!quote) throw new Error("No metadata found");

    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({
        ok: true,
        sym: clean,
        yf: quote.symbol || candidates[0],
        name: quote.longname || quote.shortname || clean,
        sector: quote.sector || null,
        industry: quote.industry || null,
        exchange: quote.exchDisp || quote.exchange || exchange || null
      })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({ ok: false, sym: clean, yf: candidates[0], error: e.message })
    };
  }
};
