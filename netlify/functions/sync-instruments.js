// Syncs NSE + BSE EQ instruments from Kite public CSV → Supabase instruments table.
// No Kite auth required. Trigger manually or on a daily schedule.

const { corsHeaders, requireAdmin } = require("./_shared/http");

const BATCH = 500;

exports.handler = async (event) => {
  const H = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  const denied = requireAdmin(event, H);
  if (denied) return denied;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)
    return { statusCode: 500, headers: H, body: JSON.stringify({ ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_KEY not set" }) };

  try {
    const rows = [];

    for (const exchange of ["NSE", "BSE"]) {
      const res = await fetch(`https://api.kite.trade/instruments/${exchange}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`Kite instruments CSV for ${exchange} returned HTTP ${res.status}`);

      const parsed = parseCSV(await res.text());
      for (const r of parsed) {
        if (r.instrument_type !== "EQ") continue;
        rows.push({
          instrument_token: Number(r.instrument_token),
          exchange_token:   Number(r.exchange_token),
          tradingsymbol:    r.tradingsymbol,
          name:             r.name || null,
          exchange:         r.exchange,
          instrument_type:  r.instrument_type,
          segment:          r.segment,
          tick_size:        Number(r.tick_size) || null,
          lot_size:         Number(r.lot_size)  || 1,
          updated_at:       new Date().toISOString()
        });
      }
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/instruments`, {
        method: "POST",
        headers: {
          apikey:          SUPABASE_SERVICE_KEY,
          Authorization:   `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type":  "application/json",
          Prefer:          "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows.slice(i, i + BATCH))
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase upsert failed (batch ${i}): ${err.slice(0, 300)}`);
      }
    }

    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, synced: rows.length }) };
  } catch (e) {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}
