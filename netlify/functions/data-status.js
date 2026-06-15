const { json, supabaseHeaders } = require("./_shared/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json(500, { ok: false, error: "Supabase env vars missing" });
  }

  try {
    const headers = supabaseHeaders(SUPABASE_SERVICE_KEY);
    const [candles, signals, instruments] = await Promise.allSettled([
      sbGet(SUPABASE_URL, "/rest/v1/daily_candles?select=date&order=date.desc&limit=1", headers),
      sbGet(SUPABASE_URL, "/rest/v1/signals?select=date&order=date.desc&limit=1", headers),
      sbGet(SUPABASE_URL, "/rest/v1/instruments?select=updated_at&order=updated_at.desc&limit=1", headers),
    ]);

    const latestCandleDate = settledFirst(candles, "date");
    const latestSignalDate = settledFirst(signals, "date");
    const latestInstrumentSync = settledFirst(instruments, "updated_at");

    return json(200, {
      ok: true,
      latestCandleDate,
      latestSignalDate,
      latestInstrumentSync,
      stale: isStale(latestSignalDate),
      checkedAt: new Date().toISOString(),
      errors: {
        candles: settledError(candles),
        signals: settledError(signals),
        instruments: settledError(instruments),
      },
    });
  } catch (e) {
    return json(200, { ok: false, error: e.message });
  }
};

async function sbGet(url, path, headers) {
  const res = await fetch(`${url}${path}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  return res.json();
}

function settledFirst(result, key) {
  if (result.status !== "fulfilled") return null;
  return result.value?.[0]?.[key] || null;
}

function settledError(result) {
  return result.status === "rejected" ? result.reason?.message || "unknown error" : null;
}

function isStale(dateStr) {
  if (!dateStr) return true;
  const latest = new Date(`${dateStr}T00:00:00+05:30`);
  if (Number.isNaN(latest.getTime())) return true;
  return (Date.now() - latest.getTime()) / 86400000 > 4;
}
