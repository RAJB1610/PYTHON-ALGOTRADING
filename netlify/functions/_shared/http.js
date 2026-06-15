const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function corsHeaders(extra = {}) {
  return { ...baseHeaders, ...extra };
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: corsHeaders(headers),
    body: JSON.stringify(body),
  };
}

function requireAdmin(event, headers = {}) {
  const expected = process.env.ADMIN_SYNC_TOKEN;
  if (!expected) {
    return json(500, {
      ok: false,
      error: "ADMIN_SYNC_TOKEN is not configured.",
      reason: "admin_token_missing",
    }, headers);
  }

  const supplied =
    event.headers?.["x-admin-token"] ||
    event.headers?.["X-Admin-Token"] ||
    event.queryStringParameters?.admin_token;

  if (supplied !== expected) {
    return json(401, {
      ok: false,
      error: "Unauthorized admin operation.",
      reason: "unauthorized",
    }, headers);
  }

  return null;
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

module.exports = {
  corsHeaders,
  json,
  requireAdmin,
  supabaseHeaders,
};
