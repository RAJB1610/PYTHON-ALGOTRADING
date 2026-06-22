const { generateText } = require("./_shared/ai-client");

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type", "Content-Type":"application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:H, body:"" };

  const fail = (msg, extra = {}) => ({
    statusCode: 200,
    headers: H,
    body: JSON.stringify({ ok:false, error:String(msg), ...extra })
  });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return fail("Invalid request body"); }

  const stock = body.stock || {};
  if (!stock.sym) return fail("Missing stock symbol");

  const rule = ruleForecast(stock);
  const prompt = `You are an Indian equity analyst building an educational AI-assisted forecast from public data only.
Do not claim access to broker reports, management meetings, or non-public data.
Do not invent missing metrics. If data is missing, lower confidence and list the gap.

Stock:
${JSON.stringify(stock, null, 2)}

Rule-based baseline:
${JSON.stringify(rule, null, 2)}

Return ONLY compact valid JSON. No markdown.
Schema:
{"summary":"Two sentences explaining the forecast.","horizon":"6-12 months","conservativeTarget":123,"baseTarget":145,"bullTarget":170,"expectedReturnPct":12.3,"confidence":"Low|Medium|High","action":"Avoid|Watch|Accumulate|Hold|Trim","drivers":["d1","d2","d3"],"risks":["r1","r2","r3"],"assumptions":["a1","a2","a3"],"dataGaps":["g1","g2"],"method":"One sentence describing the public-data valuation method."}`;

  try {
    const raw = (await generateText(prompt, { maxTokens: 1000, timeoutMs: 9000, temperature: 0.15 }))
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const ai = JSON.parse(repairJSON(raw));
    return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, forecast: normalizeForecast(ai, rule, stock) }) };
  } catch (e) {
    if (e.reason === "no_key") {
      return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, mode:"rules", forecast: rule }) };
    }
    const isTO = e.name === "AbortError" || String(e).includes("timeout");
    if (isTO) return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, mode:"rules", forecast: { ...rule, dataGaps:[...(rule.dataGaps || []), "AI forecast timed out; showing rule baseline."] } }) };
    return fail(e.message || e, { reason:e.reason, provider:e.provider });
  }
};

function ruleForecast(stock) {
  const cmp = num(stock.cmp);
  const pe = num(stock.pe);
  const roe = num(stock.roe);
  const rev = num(stock.rev);
  const profit = num(stock.profit);
  const score = num(stock.sc);
  const de = num(stock.de);
  const gaps = [];
  if (!cmp) gaps.push("CMP");
  if (!pe) gaps.push("PE");
  if (roe == null) gaps.push("ROE");
  if (rev == null) gaps.push("Revenue growth");
  if (profit == null) gaps.push("Profit growth");

  const quality = score >= 7 ? 1.12 : score >= 5 ? 1.02 : 0.9;
  const growth = avg([cap(rev, -20, 60), cap(profit, -30, 80)]);
  const growthFactor = growth == null ? 1 : 1 + cap(growth, -20, 40) / 180;
  const roeFactor = roe == null ? 1 : roe >= 25 ? 1.08 : roe >= 15 ? 1.03 : roe < 8 ? 0.92 : 1;
  const debtFactor = de == null ? 1 : de <= 1 ? 1.03 : de > 3 ? 0.9 : 0.97;
  const baseMult = quality * growthFactor * roeFactor * debtFactor;
  const baseTarget = cmp ? round2(cmp * baseMult) : null;
  const conservativeTarget = baseTarget ? round2(baseTarget * 0.88) : null;
  const bullTarget = baseTarget ? round2(baseTarget * 1.18) : null;
  const expectedReturnPct = cmp && baseTarget ? round2(((baseTarget - cmp) / cmp) * 100) : null;
  const confidence = gaps.length >= 3 ? "Low" : score >= 7 && gaps.length <= 1 ? "High" : "Medium";
  const action = !cmp || score < 4 ? "Watch" : expectedReturnPct > 18 && score >= 6 ? "Accumulate" : expectedReturnPct > 5 ? "Hold" : expectedReturnPct < -10 ? "Trim" : "Watch";

  return {
    summary: `${stock.sym} forecast is a public-data estimate using valuation, growth, quality score, leverage, and trend context. Treat it as a scenario range, not a broker target.`,
    horizon: "6-12 months",
    conservativeTarget,
    baseTarget,
    bullTarget,
    expectedReturnPct,
    confidence,
    action,
    drivers: [
      score >= 7 ? "Strong fundamental score supports a better valuation scenario." : "Fundamental score limits forecast confidence.",
      growth == null ? "Growth data is incomplete." : `Blended growth proxy is ${round2(growth)}%.`,
      roe == null ? "ROE data is unavailable." : `ROE is ${roe}%.`
    ],
    risks: [
      pe && pe > 35 ? `PE ${pe}x leaves limited margin of safety.` : "Valuation should be checked against sector peers.",
      de && de > 1 ? `Debt/equity ${de}x may reduce valuation comfort.` : "Balance sheet risk appears manageable from available data.",
      "News, results, and market trend can invalidate this range quickly."
    ],
    assumptions: [
      "Current public fundamentals remain broadly valid.",
      "No major adverse regulatory, governance, or earnings event occurs.",
      "Market assigns a valuation consistent with quality and growth."
    ],
    dataGaps: gaps,
    method: "Rule baseline adjusts CMP by quality, growth, ROE, leverage, and screen score."
  };
}

function normalizeForecast(ai, rule, stock) {
  const f = { ...rule, ...ai };
  f.conservativeTarget = num(f.conservativeTarget) || rule.conservativeTarget;
  f.baseTarget = num(f.baseTarget) || rule.baseTarget;
  f.bullTarget = num(f.bullTarget) || rule.bullTarget;
  f.expectedReturnPct = num(f.expectedReturnPct);
  if (f.expectedReturnPct == null && num(stock.cmp) && f.baseTarget) {
    f.expectedReturnPct = round2(((f.baseTarget - num(stock.cmp)) / num(stock.cmp)) * 100);
  }
  ["drivers", "risks", "assumptions", "dataGaps"].forEach(k => {
    f[k] = Array.isArray(f[k]) ? f[k].slice(0, 5).map(String) : [];
  });
  f.confidence = ["Low", "Medium", "High"].includes(f.confidence) ? f.confidence : rule.confidence;
  return f;
}

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

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function cap(v, lo, hi) { return v == null ? null : Math.max(lo, Math.min(hi, v)); }
function avg(arr) {
  const xs = arr.filter(v => v != null && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function round2(n) { return Math.round(Number(n) * 100) / 100; }
