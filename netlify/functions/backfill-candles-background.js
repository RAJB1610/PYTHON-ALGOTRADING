// Backfills daily_candles for a date range by downloading NSE + BSE bhavcopy for each trading day.
// Holidays return 404 and are skipped automatically.
// Default range: 1 year ago → yesterday (IST).
// Optional params: ?from=YYYYMMDD&to=YYYYMMDD
// Run once to build history, then use sync-candles-background for daily updates.

const { unzipSync } = require("fflate");

const SB_BATCH    = 1000;
const CONCURRENCY = 3; // days processed in parallel (6 requests: NSE+BSE per day)

const FETCH_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Supabase env vars missing" }) };

  const { from, to } = event.queryStringParameters || {};
  const fromDate = from || getISTDate(-365);
  const toDate   = to   || getISTDate(-1);

  try {
    const days = getWeekdays(fromDate, toDate);
    if (!days.length) throw new Error(`No weekdays found between ${fromDate} and ${toDate}`);

    let totalRows = 0, processed = 0, skipped = 0;
    const allRows = [];

    // Process CONCURRENCY days at a time
    for (let i = 0; i < days.length; i += CONCURRENCY) {
      const batch   = days.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(date => fetchDay(date)));

      for (const { rows, date, holiday } of results) {
        if (holiday) { skipped++; continue; }
        allRows.push(...rows);
        processed++;
      }

      // Flush to Supabase every 5000 rows to avoid memory buildup
      if (allRows.length >= 5000) {
        totalRows += await upsertRows(allRows.splice(0), SUPABASE_URL, SUPABASE_SERVICE_KEY);
      }
    }

    // Flush remaining rows
    if (allRows.length) {
      totalRows += await upsertRows(allRows, SUPABASE_URL, SUPABASE_SERVICE_KEY);
    }

    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({
        ok: true,
        from: fromDate, to: toDate,
        weekdays:  days.length,
        processed,
        skipped_holidays: skipped,
        rows_stored: totalRows
      })
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

// ── Fetch one day (NSE + BSE) ─────────────────────────────────────────────────

async function fetchDay(date) {
  const [nseResult, bseResult] = await Promise.all([
    fetchBhavcopy("NSE", date).catch(e => ({ error: e.message })),
    fetchBhavcopy("BSE", date).catch(e => ({ error: e.message }))
  ]);

  // If both fail with 404, it's likely a market holiday
  const nse404 = nseResult.error?.includes("404");
  const bse404 = bseResult.error?.includes("404");
  if (nse404 && bse404) return { date, rows: [], holiday: true };

  const rows = [
    ...(nseResult.rows || []),
    ...(bseResult.rows || [])
  ];
  return { date, rows, holiday: false };
}

async function fetchBhavcopy(exchange, date) {
  const url = exchange === "NSE"
    ? `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${date}_F_0000.csv.zip`
    : `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${date}_F_0000.csv`;

  const referer = exchange === "NSE" ? "https://nseindia.com/" : "https://www.bseindia.com/";
  const res = await fetch(url, {
    headers: { ...FETCH_HEADERS, Referer: referer },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let text;
  if (exchange === "NSE") {
    const buf      = await res.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buf));
    const csvFile  = Object.values(unzipped)[0];
    if (!csvFile) throw new Error("ZIP was empty");
    text = new TextDecoder().decode(csvFile);
  } else {
    text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("Got HTML — blocked");
  }

  return { rows: parseBhavcopy(text, exchange) };
}

// ── Parse ─────────────────────────────────────────────────────────────────────

function parseBhavcopy(csv, exchange) {
  const lines   = csv.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/\r/g, ""));
  const rows    = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = line.split(",");
    const r    = Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim().replace(/\r/g, "")]));

    if (!shouldInclude(r, exchange)) continue;

    const close  = parseFloat(r.ClsPric);
    if (!close || close <= 0) continue;

    const date = parseDate(r.TradDt);
    if (!date) continue;

    rows.push({
      tradingsymbol: r.TckrSymb,
      exchange,
      date,
      open:   parseFloat(r.OpnPric) || null,
      high:   parseFloat(r.HghPric) || null,
      low:    parseFloat(r.LwPric)  || null,
      close,
      volume: parseInt(r.TtlTradgVol, 10) || null
    });
  }
  return rows;
}

function shouldInclude(row, exchange) {
  const s = row.SctySrs;
  if (exchange === "NSE") return s === "EQ";
  return !["Z", "XT", "XD", "XC", "IS", "IQ", "IV", "ID"].includes(s);
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{2})-([A-Z]{3})-(\d{4})$/i);
  if (m) {
    const mo = { JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",
                 JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12" };
    return `${m[3]}-${mo[m[2].toUpperCase()]}-${m[1]}`;
  }
  return null;
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function upsertRows(rows, url, key) {
  for (let i = 0; i < rows.length; i += SB_BATCH) {
    const res = await fetch(`${url}/rest/v1/daily_candles`, {
      method: "POST",
      headers: {
        apikey:         key,
        Authorization:  `Bearer ${key}`,
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
  return rows.length;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getISTDate(offsetDays = 0) {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  ist.setUTCDate(ist.getUTCDate() + offsetDays);
  // If lands on weekend, roll back to Friday
  while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6)
    ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10).replace(/-/g, "");
}

function getWeekdays(from, to) {
  const days  = [];
  const start = parseYMD(from);
  const end   = parseYMD(to);
  const cur   = new Date(start);
  while (cur <= end) {
    if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6)
      days.push(cur.toISOString().slice(0, 10).replace(/-/g, ""));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function parseYMD(s) {
  return new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6) - 1, +s.slice(6,8)));
}
