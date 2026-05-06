// Computes RSI, MACD, BB, MAs, volume ratio, NR7 for all stocks.
// Strategy: fetch all candles per exchange in pages (no per-symbol batching),
// group in memory, compute indicators, upsert to signals table.
// Optional param: ?date=YYYY-MM-DD (defaults to latest date in daily_candles)

const SB_BATCH = 500;
const PAGE     = 50000; // rows per Supabase fetch (set Supabase max-rows to 50000 in API settings)
const LOOKBACK = 365;   // calendar days of history

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Supabase env vars missing" }) };

  const dateParam = event.queryStringParameters?.date || null;

  try {
    const date   = dateParam || await getLatestDate(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const cutoff = subtractDays(date, LOOKBACK);

    const summary = { date, cutoff };
    const signals = [];

    for (const exchange of ["NSE", "BSE"]) {
      // Fetch all candles for this exchange in the lookback window
      const candles = await fetchAllCandles(SUPABASE_URL, SUPABASE_SERVICE_KEY, exchange, cutoff);
      summary[`${exchange}_candles`] = candles.length;

      if (!candles.length) continue;

      // Group by tradingsymbol
      const bySymbol = {};
      for (const c of candles) {
        if (!bySymbol[c.tradingsymbol]) bySymbol[c.tradingsymbol] = [];
        bySymbol[c.tradingsymbol].push(c);
      }

      summary[`${exchange}_symbols`] = Object.keys(bySymbol).length;

      // Compute signal for each stock
      for (const [sym, history] of Object.entries(bySymbol)) {
        if (history.length < 20) continue;
        history.sort((a, b) => (a.date < b.date ? -1 : 1));
        const sig = computeSignals(history);
        if (sig) signals.push({ tradingsymbol: sym, exchange, date, ...sig });
      }

      // Upsert this exchange's signals immediately to avoid memory buildup
      const exchangeSignals = signals.splice(0);
      summary[`${exchange}_signals`] = exchangeSignals.length;

      for (let i = 0; i < exchangeSignals.length; i += SB_BATCH) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/signals`, {
          method: "POST",
          headers: {
            apikey:         SUPABASE_SERVICE_KEY,
            Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer:         "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify(exchangeSignals.slice(i, i + SB_BATCH))
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Supabase upsert failed (${exchange}): ${err.slice(0, 300)}`);
        }
      }
    }

    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({ ok: true, ...summary })
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getLatestDate(url, key) {
  const res  = await sbGet(url, key, "/rest/v1/daily_candles?select=date&order=date.desc&limit=1");
  const data = await res.json();
  if (!data?.[0]?.date) throw new Error("daily_candles is empty");
  return data[0].date;
}

async function fetchAllCandles(url, key, exchange, cutoff) {
  const all = [];
  let offset = 0;
  while (true) {
    const res  = await sbGet(url, key,
      `/rest/v1/daily_candles?select=tradingsymbol,date,close,high,low,volume` +
      `&exchange=eq.${exchange}&date=gte.${cutoff}` +
      `&order=tradingsymbol,date&limit=${PAGE}&offset=${offset}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;
    all.push(...data);
    offset += data.length;
  }
  return all;
}

function sbGet(url, key, path) {
  return fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
  });
}

// ── Signal computation ────────────────────────────────────────────────────────

function computeSignals(candles) {
  const closes  = candles.map(c => +c.close);
  const highs   = candles.map(c => +c.high);
  const lows    = candles.map(c => +c.low);
  const volumes = candles.map(c => +c.volume || 0);
  const n       = closes.length;
  const cmp     = closes.at(-1);
  const prev    = closes.at(-2);

  const ma20  = n >= 20  ? +sma(closes, 20).toFixed(4)  : null;
  const ma50  = n >= 50  ? +sma(closes, 50).toFixed(4)  : null;
  const ma200 = n >= 200 ? +sma(closes, 200).toFixed(4) : null;

  const maTrend = (ma50 && ma200)
    ? (cmp > ma50 && ma50 > ma200 ? "uptrend"
      : cmp < ma50 && ma50 < ma200 ? "downtrend" : "mixed")
    : null;

  const rsi  = n >= 30 ? +calcRSI(closes, 14).toFixed(2) : null;
  const macd = n >= 40 ? calcMACD(closes, 12, 26, 9)     : null;
  const bb   = n >= 20 ? calcBB(closes, 20, 2)           : null;

  const curVol   = volumes.at(-1);
  const avgVol10 = volumes.length >= 11
    ? volumes.slice(-11, -1).reduce((a, b) => a + b, 0) / 10 : null;
  const volRatio = avgVol10 ? +(curVol / avgVol10).toFixed(3) : null;

  const ranges = highs.map((h, i) => h - lows[i]);
  const isNR7  = ranges.length >= 7 && ranges.at(-1) < Math.min(...ranges.slice(-7, -1));

  let bullCount = 0;
  if (rsi !== null && rsi < 35)             bullCount++;
  if (bb   !== null && bb.position < 25)    bullCount++;
  if (macd?.aboveSignal)                    bullCount++;
  if (volRatio !== null && volRatio >= 1.5) bullCount++;
  if (maTrend === "uptrend")                bullCount++;

  return {
    close:        +cmp.toFixed(4),
    change_1d:    prev ? +((cmp - prev) / prev * 100).toFixed(2) : null,
    ma20, ma50, ma200, ma_trend: maTrend,
    rsi,
    macd_value:   macd?.value   ?? null,
    macd_signal:  macd?.signal  ?? null,
    macd_hist:    macd?.hist    ?? null,
    macd_bullish: macd?.aboveSignal ?? null,
    bb_upper:     bb?.upper    ?? null,
    bb_lower:     bb?.lower    ?? null,
    bb_position:  bb ? +bb.position.toFixed(2) : null,
    bb_squeeze:   bb?.isSqueeze ?? null,
    volume:       curVol || null,
    vol_ratio:    volRatio,
    is_nr7:       isNR7,
    bull_count:   bullCount
  };
}

// ── Indicator math ────────────────────────────────────────────────────────────

function sma(arr, period) {
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function ema(arr, period) {
  if (arr.length < period) return [];
  const k   = 2 / (period + 1);
  let val   = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [val];
  for (let i = period; i < arr.length; i++) { val = arr[i] * k + val * (1 - k); out.push(val); }
  return out;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 2) return 50;
  const ch = closes.slice(-(period + 15)).map((v, i, a) => i === 0 ? 0 : v - a[i - 1]).slice(1);
  let ag = ch.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
  let al = ch.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + Math.max(ch[i], 0)) / period;
    al = (al * (period - 1) + Math.max(-ch[i], 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal + 2) return null;
  const f  = ema(closes, fast), s = ema(closes, slow);
  const ml = s.map((sv, j) => f[j + (slow - fast)] - sv);
  if (ml.length < signal + 2) return null;
  const sl = ema(ml, signal);
  const curM = ml.at(-1), curS = sl.at(-1), preM = ml.at(-2), preS = sl.at(-2);
  return {
    value: +curM.toFixed(4), signal: +curS.toFixed(4), hist: +(curM - curS).toFixed(4),
    aboveSignal: curM > curS, bullishCross: preM <= preS && curM > curS
  };
}

function calcBB(closes, period = 20, mult = 2) {
  const sl   = closes.slice(-period);
  const mean = sl.reduce((a, b) => a + b, 0) / period;
  const std  = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  const upper = +(mean + mult * std).toFixed(4), lower = +(mean - mult * std).toFixed(4);
  const pos  = upper > lower ? (closes.at(-1) - lower) / (upper - lower) * 100 : 50;
  const w    = mean > 0 ? (upper - lower) / mean * 100 : 0;
  const allW = [];
  for (let i = period; i <= closes.length; i++) {
    const s2 = closes.slice(i - period, i), m2 = s2.reduce((a, b) => a + b, 0) / period;
    allW.push(m2 > 0 ? (4 * Math.sqrt(s2.reduce((a, b) => a + (b - m2) ** 2, 0) / period)) / m2 * 100 : 0);
  }
  const avgW = allW.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, allW.length);
  return { upper, lower, position: pos, isSqueeze: w < avgW * 0.8 };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function subtractDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
