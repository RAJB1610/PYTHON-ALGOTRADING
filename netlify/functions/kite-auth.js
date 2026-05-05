// Kite Connect OAuth — exchange request_token → access_token
// Docs: https://kite.trade/docs/connect/v3/user/#token-exchange
// Requires env vars: KITE_API_KEY, KITE_API_SECRET

const crypto = require("crypto");

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const { KITE_API_KEY, KITE_API_SECRET } = process.env;
  if (!KITE_API_KEY || !KITE_API_SECRET) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: false, error: "KITE_API_KEY or KITE_API_SECRET not set in Netlify environment variables."
    })};
  }

  let request_token;
  try { request_token = JSON.parse(event.body || "{}").request_token; }
  catch(e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Invalid body" }) }; }

  if (!request_token) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Missing request_token" }) };

  // Kite checksum = sha256(api_key + request_token + api_secret)
  const checksum = crypto
    .createHash("sha256")
    .update(KITE_API_KEY + request_token + KITE_API_SECRET)
    .digest("hex");

  try {
    const res = await fetch("https://api.kite.trade/session/token", {
      method: "POST",
      headers: {
        "X-Kite-Version": "3",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ api_key: KITE_API_KEY, request_token, checksum })
    });

    const data = await res.json();
    if (data.status === "success" && data.data?.access_token) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        ok: true, access_token: data.data.access_token, user: data.data.user_name
      })};
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      ok: false, error: data.message || data.error_type || "Token exchange failed"
    })};
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
