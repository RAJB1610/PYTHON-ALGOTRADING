// Background function (15-min timeout) — syncs today's EOD OHLCV for all NSE + BSE EQ stocks.
// Reads Kite access token from Supabase settings table (saved there by kite-auth.js).
// Run after market close (after 15:45 IST) for accurate EOD data.
// Kite note: last_price after close = closing price; ohlc.close = previous day's close (reference only).

const KITE_BATCH  = 200;  // instruments per Kite /quote call (conservative for URL length)
const SB_BATCH    = 1000; // rows per Supabase upsert
const CONCURRENCY = 4;    // parallel Kite API calls

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, KITE_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !KITE_API_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, KITE_API_KEY" }) };

  try {
    // 1 — Get stored Kite access token
    const tokenRes  = await sbFetch(SUPABASE_URL, SUPABASE_SERVICE_KEY,
      "/rest/v1/settings?key=eq.kite_access_token&select=value&limit=1");
    const tokenRows = await tokenRes.json();
    const access_token = tokenRows?.[0]?.value;
    if (!access_token)
      throw new Error("No Kite access token found in settings. Log in via Kite first.");

    // Debug: confirm which key+token are being used (first 6 chars only)
    const debugInfo = {
      api_key_prefix:   KITE_API_KEY.slice(0, 6),
      token_prefix:     access_token.slice(0, 6),
      token_length:     access_token.length
    };
    console.log("Kite auth debug:", JSON.stringify(debugInfo));

    // 2 — Load all EQ instruments from Supabase (paginated, Supabase default page = 1000)
    const instruments = await fetchAllInstruments(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    if (!instruments.length)
      throw new Error("Instruments table is empty. Run sync-instruments first.");

    // 3 — Batch instruments → Kite /quote API with limited concurrency
    const today   = toIST(new Date()).split("T")[0]; // YYYY-MM-DD in IST
    const batches = chunk(instruments, KITE_BATCH);
    const candles = [];

    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const results = await Promise.all(
        batches.slice(i, i + CONCURRENCY).map(b => fetchQuotes(b, KITE_API_KEY, access_token))
      );
      for (const quotes of results) {
        for (const [key, q] of Object.entries(quotes)) {
          const [exch, sym] = key.split(":");
          candles.push({
            instrument_token: q.instrument_token,
            tradingsymbol:    sym,
            exchange:         exch,
            date:             today,
            open:             q.ohlc?.open  ?? null,
            high:             q.ohlc?.high  ?? null,
            low:              q.ohlc?.low   ?? null,
            close:            q.last_price  ?? null,
            volume:           q.volume      ?? null
          });
        }
      }
    }

    // 4 — Upsert candles to Supabase
    const candleBatches = chunk(candles, SB_BATCH);
    for (const batch of candleBatches) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_candles`, {
        method: "POST",
        headers: {
          apikey:         SUPABASE_SERVICE_KEY,
          Authorization:  `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer:         "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(batch)
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase candle upsert failed: ${err.slice(0, 300)}`);
      }
    }

    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({ ok: true, date: today, synced: candles.length, instruments: instruments.length })
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({
      ok: false, error: e.message,
      api_key_prefix: KITE_API_KEY?.slice(0, 6) ?? "missing"
    }) };
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchAllInstruments(url, key) {
  const all  = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const res  = await sbFetch(url, key,
      `/rest/v1/instruments?select=instrument_token,tradingsymbol,exchange&instrument_type=eq.EQ&limit=${PAGE}&offset=${offset}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchQuotes(instruments, apiKey, accessToken) {
  const qs  = instruments.map(i => `i=${encodeURIComponent(`${i.exchange}:${i.tradingsymbol}`)}`).join("&");
  const res = await fetch(`https://api.kite.trade/quote?${qs}`, {
    headers: {
      "X-Kite-Version": "3",
      Authorization:    `token ${apiKey}:${accessToken}`
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kite /quote HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.status !== "success") throw new Error(`Kite /quote error: ${json.message}`);
  return json.data;
}

function sbFetch(url, key, path) {
  return fetch(`${url}${path}`, {
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      "Content-Type": "application/json"
    }
  });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Returns ISO string adjusted to IST (UTC+5:30) for correct date at midnight
function toIST(date) {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString();
}
