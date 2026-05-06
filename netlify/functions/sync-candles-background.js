// Downloads NSE + BSE official bhavcopy EOD files → stores OHLCV in Supabase.
// No Kite auth required. Run after 18:00 IST when exchanges publish the files.
// Optional query params: ?date=YYYYMMDD  ?exchange=NSE|BSE

const SB_BATCH = 1000;

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Supabase env vars missing" }) };

  const dateParam     = event.queryStringParameters?.date     || null;
  const exchangeParam = event.queryStringParameters?.exchange?.toUpperCase() || null;

  try {
    const date      = dateParam || getLastTradingDay();
    const exchanges = exchangeParam ? [exchangeParam] : ["NSE", "BSE"];
    const rows      = [];
    const errors    = [];

    for (const exchange of exchanges) {
      try {
        const csv    = await fetchBhavcopy(exchange, date);
        const parsed = parseBhavcopy(csv, exchange);
        rows.push(...parsed);
      } catch (e) {
        errors.push(`${exchange}: ${e.message}`);
      }
    }

    if (!rows.length)
      throw new Error(`No data. ${errors.join(" | ")} — market may be closed on ${date} or files not yet published.`);

    // Upsert to Supabase in batches
    for (let i = 0; i < rows.length; i += SB_BATCH) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_candles`, {
        method: "POST",
        headers: {
          apikey:         SUPABASE_SERVICE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer:         "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows.slice(i, i + SB_BATCH))
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase upsert failed: ${err.slice(0, 300)}`);
      }
    }

    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({
        ok: true, date,
        synced: rows.length,
        nse:    rows.filter(r => r.exchange === "NSE").length,
        bse:    rows.filter(r => r.exchange === "BSE").length,
        errors: errors.length ? errors : undefined
      })
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

// ── Fetch ───────────────────────────────────────────────────────────────────

// NSE blocks server-side requests via Cloudflare — BSE bhavcopy covers all NSE-listed stocks.
// BSE is a superset of NSE for equity instruments, so BSE-only data is sufficient for analysis.
const BSE_URL = date =>
  `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${date}_F_0000.csv`;

const NSE_URL = date =>
  `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${date}_F_0000.csv`;

const FETCH_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

async function fetchBhavcopy(exchange, date) {
  const url     = exchange === "NSE" ? NSE_URL(date) : BSE_URL(date);
  const referer = exchange === "NSE" ? "https://nseindia.com/" : "https://www.bseindia.com/";
  const res     = await fetch(url, {
    headers: { ...FETCH_HEADERS, Referer: referer },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error("Got HTML instead of CSV — blocked by exchange");
  return text;
}

// ── Parse ───────────────────────────────────────────────────────────────────

function parseBhavcopy(csv, exchange) {
  const lines   = csv.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/\r/g, ""));
  const rows    = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = line.split(",");
    const r    = Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim().replace(/\r/g, "")]));

    if (!shouldInclude(r, exchange)) continue;

    const open   = parseFloat(r.OpnPric);
    const high   = parseFloat(r.HghPric);
    const low    = parseFloat(r.LwPric);
    const close  = parseFloat(r.ClsPric);
    const volume = parseInt(r.TtlTradgVol, 10);

    if (!close || close <= 0) continue;

    const date = parseDate(r.TradDt);
    if (!date) continue;

    rows.push({
      tradingsymbol: r.TckrSymb,
      exchange,
      date,
      open:   isNaN(open)   ? null : open,
      high:   isNaN(high)   ? null : high,
      low:    isNaN(low)    ? null : low,
      close,
      volume: isNaN(volume) ? null : volume
    });
  }
  return rows;
}

function shouldInclude(row, exchange) {
  const series = row.SctySrs;
  if (exchange === "NSE") return series === "EQ";
  // BSE uses group codes (A, B, T, etc.) — exclude suspended (Z), unlisted (XT/XD), debt (ID/IS/IQ)
  if (exchange === "BSE") return !["Z", "XT", "XD", "XC", "IS", "IQ", "IV", "ID"].includes(series);
  return false;
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD-MMM-YYYY e.g. 15-JAN-2024
  const m = str.match(/^(\d{2})-([A-Z]{3})-(\d{4})$/i);
  if (m) {
    const mo = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
                 JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
    return `${m[3]}-${mo[m[2].toUpperCase()]}-${m[1]}`;
  }
  return null;
}

// ── Date helper ─────────────────────────────────────────────────────────────

function getLastTradingDay() {
  // Work in IST (UTC+5:30). Bhavcopy published after ~18:00 IST.
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  if (ist.getUTCHours() < 18) ist.setUTCDate(ist.getUTCDate() - 1);
  // Skip weekends
  while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6)
    ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10).replace(/-/g, "");
}
