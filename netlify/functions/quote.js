// TradeSignal Pro V2 — Indicator Engine
// Calculates RSI(14), MACD(12,26,9), Bollinger Bands(20,2),
// Volume ratio, NR7 squeeze, and MA alignment from 6 months of OHLCV data

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const symbol = event.queryStringParameters?.symbol?.trim();
  if (!symbol) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "symbol required" }) };

  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com/"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const meta = result.meta;
    const q    = result.indicators?.quote?.[0];
    if (!q) throw new Error("No quote data");

    // Clean arrays — remove nulls but keep index alignment where needed
    const closes  = q.close.map((v, i) => ({ v, i })).filter(x => x.v != null).map(x => x.v);
    const volumes = q.volume.map((v, i) => ({ v, i })).filter(x => x.v != null).map(x => x.v);
    const highs   = q.high.map((v, i) => ({ v, i })).filter(x => x.v != null).map(x => x.v);
    const lows    = q.low.map((v, i) => ({ v, i })).filter(x => x.v != null).map(x => x.v);

    if (closes.length < 30) throw new Error("Insufficient history");

    // ── Price ──────────────────────────────────────────────────────────────
    const cmp      = meta.regularMarketPrice;
    const prev     = meta.chartPreviousClose ?? closes.at(-2);
    const chg1d    = prev ? +((cmp - prev) / prev * 100).toFixed(2) : 0;
    const chg1m    = closes.length >= 21
      ? +((cmp - closes.at(-21)) / closes.at(-21) * 100).toFixed(2) : null;
    const chg3m    = closes.length >= 63
      ? +((cmp - closes.at(-63)) / closes.at(-63) * 100).toFixed(2) : null;

    // ── 52-Week ────────────────────────────────────────────────────────────
    const hi52  = meta.fiftyTwoWeekHigh;
    const lo52  = meta.fiftyTwoWeekLow;
    const pos52 = (hi52 && lo52 && hi52 > lo52)
      ? Math.round((cmp - lo52) / (hi52 - lo52) * 100) : null;
    const newHigh = hi52 ? cmp >= hi52 * 0.99 : false;

    // ── Moving Averages ────────────────────────────────────────────────────
    const ma50  = meta.fiftyDayAverage   ?? null;
    const ma200 = meta.twoHundredDayAverage ?? null;
    const abv50  = ma50  ? cmp > ma50  : null;
    const abv200 = ma200 ? cmp > ma200 : null;
    const ma50abv200 = (ma50 && ma200) ? ma50 > ma200 : null;
    // Trend: uptrend = price > 50MA > 200MA; downtrend = price < 50MA < 200MA
    const maTrend = (abv50 && abv200 && ma50abv200) ? "uptrend"
      : (!abv50 && !abv200 && ma50abv200 === false) ? "downtrend"
      : "mixed";

    // ── RSI (14) ───────────────────────────────────────────────────────────
    const rsi = +calcRSI(closes, 14).toFixed(1);

    // ── Bollinger Bands (20, 2) ────────────────────────────────────────────
    const bb = calcBB(closes, 20, 2);

    // ── MACD (12, 26, 9) ──────────────────────────────────────────────────
    const macd = calcMACD(closes, 12, 26, 9);

    // ── Volume ────────────────────────────────────────────────────────────
    const curVol  = volumes.at(-1) ?? 0;
    const avgVol10 = volumes.length >= 11
      ? Math.round(volumes.slice(-11, -1).reduce((a, b) => a + b, 0) / 10) : null;
    const volRatio = avgVol10 ? +((curVol / avgVol10)).toFixed(2) : null;

    // ── NR7 (Narrowest daily range in 7 sessions) ─────────────────────────
    const ranges  = highs.map((h, i) => h - (lows[i] ?? h));
    const todayR  = ranges.at(-1);
    const prior6R = ranges.slice(-7, -1);
    const isNR7   = prior6R.length === 6 && todayR < Math.min(...prior6R);

    // ── Bull signal count (0-5) ────────────────────────────────────────────
    // Each of 5 indicators contributes 1 bullish point
    const sigRSI   = rsi < 35 ? 1 : 0;                              // oversold
    const sigBB    = bb.position < 25 ? 1 : 0;                      // near lower band
    const sigMACD  = macd ? (macd.aboveSignal ? 1 : 0) : 0;        // MACD above signal
    const sigVol   = volRatio && volRatio >= 1.5 ? 1 : 0;          // volume surge
    const sigMA    = maTrend === "uptrend" ? 1 : 0;                 // golden cross zone
    const bullCount = sigRSI + sigBB + sigMACD + sigVol + sigMA;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true, symbol: meta.symbol,
        name: meta.longName || meta.shortName || symbol,
        cmp, chg1d, chg1m, chg3m,
        hi52, lo52, pos52, newHigh,
        ma50, ma200, abv50, abv200, maTrend,
        rsi,
        bb: { ...bb, position: +bb.position.toFixed(1), width: +bb.width.toFixed(2) },
        macd,
        volume: curVol, avgVol10, volRatio,
        isNR7,
        bullCount, sigRSI, sigBB, sigMACD, sigVol, sigMA,
        mcapCr: meta.marketCap ? Math.round(meta.marketCap / 1e7) : null,
        pe: meta.trailingPE ?? null,
        exchange: meta.fullExchangeName ?? meta.exchangeName,
        ts: meta.regularMarketTime
      })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, symbol, error: e.message })
    };
  }
};

// ── Indicator math ─────────────────────────────────────────────────────────

function calcRSI(closes, period = 14) {
  if (closes.length < period + 2) return 50;
  const changes = closes.slice(-(period + 15)).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]).slice(1);
  let ag = changes.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
  let al = changes.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;
  for (let i = period; i < changes.length; i++) {
    ag = (ag * (period - 1) + Math.max(changes[i], 0)) / period;
    al = (al * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function emaArr(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  let val = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [val];
  for (let i = period; i < data.length; i++) {
    val = data[i] * k + val * (1 - k);
    out.push(val);
  }
  return out; // out[j] corresponds to data[period - 1 + j]
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal + 2) return null;
  const f = emaArr(closes, fast);   // f[j] ~ closes[fast-1+j]
  const s = emaArr(closes, slow);   // s[j] ~ closes[slow-1+j]
  // Align: MACD[j] = f[j + (slow-fast)] - s[j]
  const offset = slow - fast;       // = 14
  const ml = s.map((sv, j) => f[j + offset] - sv);
  if (ml.length < signal + 2) return null;
  const sl = emaArr(ml, signal);
  const n  = sl.length;
  const curM = ml.at(-1), curS = sl.at(-1);
  const preM = ml.at(-2), preS = sl.at(-2);
  return {
    value:        +curM.toFixed(3),
    signal:       +curS.toFixed(3),
    hist:         +(curM - curS).toFixed(3),
    aboveSignal:  curM > curS,
    bullishCross: preM <= preS && curM > curS,
    bearishCross: preM >= preS && curM < curS
  };
}

function calcBB(closes, period = 20, mult = 2) {
  const sl   = closes.slice(-period);
  const sma  = sl.reduce((a, b) => a + b, 0) / period;
  const std  = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / period);
  const upper = sma + mult * std;
  const lower = sma - mult * std;
  const cmp   = closes.at(-1);
  const pos   = upper > lower ? (cmp - lower) / (upper - lower) * 100 : 50;
  const width = sma > 0 ? (upper - lower) / sma * 100 : 0;
  // BB Squeeze: current width below 20-period average width
  const allW = [];
  for (let i = period; i <= closes.length; i++) {
    const s2 = closes.slice(i - period, i);
    const m2 = s2.reduce((a, b) => a + b, 0) / period;
    const sd2 = Math.sqrt(s2.reduce((a, b) => a + (b - m2) ** 2, 0) / period);
    allW.push(m2 > 0 ? (4 * sd2) / m2 * 100 : 0);
  }
  const avgW = allW.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, allW.length);
  return {
    upper: +upper.toFixed(2),
    middle: +sma.toFixed(2),
    lower: +lower.toFixed(2),
    position: pos,
    width,
    isSqueeze: width < avgW * 0.8
  };
}
