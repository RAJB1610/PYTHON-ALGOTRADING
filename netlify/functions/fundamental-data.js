exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const p = event.queryStringParameters || {};
  const raw = String(p.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9&.-]/g, "");
  const exchange = String(p.exchange || "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
  if (!raw) return { statusCode: 400, headers: H, body: JSON.stringify({ ok: false, error: "symbol required" }) };

  const suffix = exchange === "BSE" ? ".BO" : ".NS";
  const yf = raw.endsWith(".NS") || raw.endsWith(".BO") ? raw : raw + suffix;
  const clean = yf.replace(/\.(NS|BO)$/i, "");

  try {
    const [profile, chart, rich] = await Promise.all([
      fetchYahooSearch(yf, suffix),
      fetchYahooChart(yf),
      fetchYahooSummary(yf).catch(() => null)
    ]);

    if (!profile && !chart && !rich) throw new Error("No Yahoo data found");

    const price = rich?.price || {};
    const summary = rich?.summaryDetail || {};
    const stats = rich?.defaultKeyStatistics || {};
    const financial = rich?.financialData || {};
    const assetProfile = rich?.assetProfile || {};
    const sector = assetProfile.sector || profile?.sector || profile?.industry || "Unclassified";
    const industry = assetProfile.industry || profile?.industry || "";

    const out = {
      ok: true,
      sym: clean,
      yf,
      name: rawVal(price.longName) || rawVal(price.shortName) || chart?.longName || profile?.name || clean,
      sec: sector,
      isNBFC: /bank|finance|financial|nbfc|credit|loan/i.test(`${sector} ${industry}`),
      surv: false,
      profQ: 3,
      promo: 0,
      promoT: "na",
      rev: pct(financial.revenueGrowth),
      profit: pct(financial.earningsGrowth),
      roe: pct(financial.returnOnEquity),
      de: ratio(financial.debtToEquity, 100),
      pe: num(summary.trailingPE) ?? num(stats.trailingPE) ?? num(summary.forwardPE),
      mcapCr: marketCapCr(price.marketCap),
      price: chart?.price ?? null,
      note: rich
        ? "Yahoo Finance snapshot. Promoter and surveillance checks unavailable for dynamically added symbols."
        : "Yahoo Finance public snapshot. Detailed ratios were not available from the public endpoint; treat missing metrics as data gaps.",
      source: rich ? "yahoo-summary" : "yahoo-public"
    };

    return { statusCode: 200, headers: H, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, symbol: raw, yf, error: e.message }) };
  }
};

async function fetchYahooSearch(yf, suffix) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yf)}&quotesCount=8&newsCount=0`;
  const res = await fetch(url, {
    headers: yahooHeaders(),
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) return null;
  const data = await res.json();
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  const item = quotes.find(q => String(q.symbol || "").toUpperCase().endsWith(suffix)) || quotes[0];
  if (!item) return null;
  return {
    name: item.longname || item.shortname || item.name || null,
    sector: item.sectorDisp || item.sector || null,
    industry: item.industryDisp || item.industry || null
  };
}

async function fetchYahooChart(yf) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yf)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: yahooHeaders(),
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) return null;
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  return {
    price: num(meta.regularMarketPrice),
    longName: meta.longName || meta.shortName || null
  };
}

async function fetchYahooSummary(yf) {
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yf)}?modules=${modules}`;
  const res = await fetch(url, {
    headers: yahooHeaders(),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.quoteSummary?.result?.[0] || null;
}

function yahooHeaders() {
  return {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://finance.yahoo.com/"
  };
}

function rawVal(x) {
  return x?.raw ?? x;
}

function num(x) {
  const v = rawVal(x);
  return Number.isFinite(Number(v)) ? +Number(v).toFixed(2) : null;
}

function pct(x) {
  const v = rawVal(x);
  return Number.isFinite(Number(v)) ? +(Number(v) * 100).toFixed(1) : null;
}

function ratio(x, divisor = 1) {
  const v = rawVal(x);
  return Number.isFinite(Number(v)) ? +(Number(v) / divisor).toFixed(2) : null;
}

function marketCapCr(x) {
  const v = rawVal(x);
  return Number.isFinite(Number(v)) ? +(Number(v) / 10000000).toFixed(0) : null;
}
