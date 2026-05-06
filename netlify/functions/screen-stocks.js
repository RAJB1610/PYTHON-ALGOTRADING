// Queries the signals table to screen stocks by indicator criteria.
// All params are optional — omit any to skip that filter.
//
// Query params:
//   date         YYYY-MM-DD  (default: latest date in signals)
//   exchange     NSE | BSE   (default: both)
//   ma_trend     uptrend | downtrend | mixed
//   min_bull     0-5         minimum bull_count
//   rsi_min      number      RSI lower bound
//   rsi_max      number      RSI upper bound
//   vol_ratio_min number     minimum volume ratio
//   bb_pos_max   number      max BB position (0-100), e.g. 25 = near lower band
//   squeeze      true        only BB squeeze stocks
//   nr7          true        only NR7 stocks
//   limit        number      max results (default 100, max 500)

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Supabase env vars missing" }) };

  const p = event.queryStringParameters || {};

  try {
    // Resolve date
    const date = p.date || await getLatestSignalDate(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    if (!date) throw new Error("No signals found. Run compute-signals first.");

    // Build filter string
    const filters = [`date=eq.${date}`];
    if (p.exchange)      filters.push(`exchange=eq.${p.exchange.toUpperCase()}`);
    if (p.ma_trend)      filters.push(`ma_trend=eq.${p.ma_trend}`);
    if (p.min_bull)      filters.push(`bull_count=gte.${p.min_bull}`);
    if (p.rsi_min)       filters.push(`rsi=gte.${p.rsi_min}`);
    if (p.rsi_max)       filters.push(`rsi=lte.${p.rsi_max}`);
    if (p.vol_ratio_min) filters.push(`vol_ratio=gte.${p.vol_ratio_min}`);
    if (p.bb_pos_max)    filters.push(`bb_position=lte.${p.bb_pos_max}`);
    if (p.squeeze === "true") filters.push(`bb_squeeze=eq.true`);
    if (p.nr7     === "true") filters.push(`is_nr7=eq.true`);

    const limit = Math.min(parseInt(p.limit || "100"), 500);

    const qs  = filters.join("&");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/signals?${qs}&order=bull_count.desc,rsi.asc&limit=${limit}`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase query failed: ${err.slice(0, 300)}`);
    }

    const stocks = await res.json();
    return {
      statusCode: 200,
      headers: H,
      body: JSON.stringify({ ok: true, date, count: stocks.length, stocks })
    };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

async function getLatestSignalDate(url, key) {
  const res  = await fetch(`${url}/rest/v1/signals?select=date&order=date.desc&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const data = await res.json();
  return data?.[0]?.date || null;
}
