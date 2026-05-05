// Kite Connect — fetch live portfolio holdings
// Docs: https://kite.trade/docs/connect/v3/portfolio/#holdings
// Requires env var: KITE_API_KEY

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const { KITE_API_KEY } = process.env;
  if (!KITE_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: false, error: "KITE_API_KEY not set in environment variables."
    })};
  }

  // access_token comes from the client (stored in localStorage after OAuth)
  const access_token = event.headers["authorization"]?.replace("Bearer ", "");
  if (!access_token) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: false, error: "No access token. Please reconnect Kite.", needsLogin: true
    })};
  }

  try {
    const res = await fetch("https://api.kite.trade/portfolio/holdings", {
      headers: {
        "X-Kite-Version": "3",
        "Authorization": `token ${KITE_API_KEY}:${access_token}`
      }
    });

    const data = await res.json();

    if (data.status === "success" && Array.isArray(data.data)) {
      // Map Kite holding fields to our app's format
      const holdings = data.data
        .filter(h => h.quantity > 0)
        .map(h => ({
          sym:      h.tradingsymbol,
          qty:      h.quantity,
          avgPrice: +h.average_price.toFixed(2),
          cmp:      h.last_price ? +h.last_price.toFixed(2) : null,
          isin:     h.isin,
          exchange: h.exchange
        }));

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, holdings, count: holdings.length }) };
    }

    // Token expired (common — Kite expires tokens daily at 3:30 AM)
    if (data.error_type === "TokenException" || res.status === 403) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        ok: false, error: "Session expired. Please reconnect Kite.", needsLogin: true
      })};
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: false, error: data.message || "Failed to fetch holdings"
    })};
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
