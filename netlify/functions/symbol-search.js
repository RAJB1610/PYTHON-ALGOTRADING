exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "Supabase env vars missing" }) };
  }

  const p = event.queryStringParameters || {};
  const q = String(p.q || "").trim().toUpperCase().replace(/[^A-Z0-9&.-]/g, "");
  const exchange = String(p.exchange || "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
  const limit = Math.min(Math.max(parseInt(p.limit || "20", 10) || 20, 1), 50);

  if (q.length < 1) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, symbols: [] }) };
  }

  try {
    const select = "tradingsymbol,name,exchange";
    const filters = [
      `exchange=eq.${exchange}`,
      "instrument_type=eq.EQ",
      `or=(tradingsymbol.ilike.${encodeURIComponent(q + "*")},name.ilike.${encodeURIComponent("*" + q + "*")})`,
      "order=tradingsymbol.asc",
      `limit=${limit}`
    ];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/instruments?select=${select}&${filters.join("&")}`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase query failed: ${err.slice(0, 300)}`);
    }

    const rows = await res.json();
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, symbols: rows }) };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
