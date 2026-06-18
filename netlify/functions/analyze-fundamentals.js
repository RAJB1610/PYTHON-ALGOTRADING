const { generateText } = require("./_shared/ai-client");

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };

  const fail = (msg, extra = {}) => ({
    statusCode: 200,
    headers: H,
    body: JSON.stringify({ ok: false, error: String(msg), ...extra })
  });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return fail("Invalid request body"); }

  const stocks = Array.isArray(body.stocks) ? body.stocks.slice(0, 40) : [];
  if (!stocks.length) return fail("No fundamental stocks supplied");

  const rows = stocks.map(s =>
    `${s.sym}: verdict=${s.label}, score=${s.sc}/10, sector=${s.sec || "-"}, PE=${s.pe ?? "-"}, ROE=${s.roe ?? "-"}%, rev=${s.rev ?? "-"}%, profit=${s.profit ?? "-"}%, promoter=${s.promoT === "na" ? "NA" : (s.promo + "% " + s.promoT)}, debt=${s.de ?? "NA"}, note=${s.note || ""}`
  ).join("\n");

  const prompt = `You are an Indian equity fundamental analyst. Analyse this fundamentals screen and return ONLY compact valid JSON. No markdown.

Rules:
- Do not invent metrics. If a metric is missing, call it a data gap.
- Treat this as educational analysis, not investment advice.
- Prioritise promoter quality, profit growth, ROE, leverage, valuation, and surveillance risks.

Thresholds:
${JSON.stringify(body.thresholds || {}, null, 2)}

Stocks:
${rows}

JSON schema:
{"summary":"Two sentences.","bestIdeas":[{"sym":"X","reason":"One sentence.","watchItem":"One sentence."}],"avoidOrReview":[{"sym":"Y","reason":"One sentence."}],"valuationNotes":["n1","n2"],"dataGaps":["g1","g2"],"nextActions":["a1","a2","a3"]}`;

  let raw;
  try {
    raw = (await generateText(prompt, { maxTokens: 900, timeoutMs: 8500 }))
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
  } catch (e) {
    if (e.reason === "no_key") {
      return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, mode: "rules", analysis: ruleAnalysis(stocks) }) };
    }
    const isTO = e.name === "AbortError" || String(e).includes("timeout");
    return fail(isTO ? "timeout" : e.message || e, { isTimeout: isTO, reason: e.reason, provider: e.provider });
  }

  try {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, analysis: JSON.parse(repairJSON(raw)) }) };
  } catch (e) {
    return fail(`JSON parse error: ${e.message}. Raw: ${raw.slice(0, 140)}`);
  }
};

function repairJSON(s) {
  s = String(s || "").trim().replace(/,(\s*[}\]])/g, "$1");
  const opens = [];
  let inStr = false, prev = "";
  for (const ch of s) {
    if (ch === '"' && prev !== "\\") inStr = !inStr;
    if (!inStr) {
      if (ch === "{" || ch === "[") opens.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") opens.pop();
    }
    prev = ch;
  }
  return s + opens.reverse().join("");
}

function ruleAnalysis(stocks) {
  const ranked = stocks
    .map(s => ({ ...s, sc: Number(s.sc) || 0 }))
    .sort((a, b) => b.sc - a.sc);
  const complete = ranked.filter(s => [s.pe, s.roe, s.rev, s.profit].some(v => v !== null && v !== undefined));
  const gaps = ranked.filter(s => [s.pe, s.roe, s.rev, s.profit].every(v => v === null || v === undefined));
  const best = complete.slice(0, 5).map(s => ({
    sym: s.sym,
    reason: `${s.label || "Review"} with score ${s.sc}/10, ROE ${fmt(s.roe)}%, profit growth ${fmt(s.profit)}%, and PE ${fmt(s.pe)}.`,
    watchItem: s.note || "Validate latest quarterly results before acting."
  }));
  const review = ranked
    .filter(s => /avoid|watch|fail/i.test(String(s.label || "")) || s.sc < 6)
    .slice(0, 6)
    .map(s => ({
      sym: s.sym,
      reason: `${s.label || "Review"} with score ${s.sc}/10; check missing metrics, leverage, and earnings trend before adding capital.`
    }));

  return {
    summary: `Rule-assisted fundamentals review covered ${stocks.length} stock(s). ${gaps.length} stock(s) need richer ratio data before a high-confidence view.`,
    bestIdeas: best.length ? best : ranked.slice(0, 3).map(s => ({
      sym: s.sym,
      reason: `${s.sym} is among the higher-ranked names currently available, but detailed ratios are limited.`,
      watchItem: "Add PE, ROE, profit growth, and debt data for confirmation."
    })),
    avoidOrReview: review,
    valuationNotes: complete.slice(0, 5).map(s => `${s.sym}: PE ${fmt(s.pe)}, ROE ${fmt(s.roe)}%, profit growth ${fmt(s.profit)}%.`),
    dataGaps: gaps.slice(0, 8).map(s => `${s.sym}: missing PE, ROE, revenue growth, and profit growth from the public data feed.`),
    nextActions: [
      "Review lowest-score names first and avoid fresh capital until earnings and debt checks are complete.",
      "For high-score names, compare PE against sector peers before sizing positions.",
      "Refresh or add missing fundamentals for symbols marked as data gaps."
    ]
  };
}

function fmt(v) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? "NA" : Number(v).toFixed(1).replace(/\.0$/, "");
}
