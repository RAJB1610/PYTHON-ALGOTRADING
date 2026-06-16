const { generateText } = require("./_shared/ai-client");

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:H, body:"" };

  const fail = (msg, extra = {}) => ({
    statusCode: 200,
    headers: H,
    body: JSON.stringify({ ok:false, error:String(msg), ...extra })
  });

  let portfolio;
  try { portfolio = JSON.parse(event.body || "{}").portfolio; }
  catch { return fail("Invalid request body"); }
  if (!portfolio?.length) return fail("Empty portfolio");

  const rows = portfolio.map(h =>
    `${h.sym}: return=${h.pnlPct != null ? h.pnlPct + "%" : "?"}, signals=${h.bullCount ?? 0}/5, MA=${h.maTrend ?? "?"}, RSI=${h.rsi ?? "-"}`
  ).join("\n");

  const prompt = `Indian equity portfolio analyst. Analyse this NSE portfolio and return ONLY valid compact JSON. No markdown, no extra text.

${rows}

JSON schema. Keep all strings to one sentence max:
{"healthScore":5,"healthLabel":"Good","healthSummary":"Two sentences.","strengths":["s1","s2"],"weaknesses":["w1","w2"],"stocks":[{"sym":"X","action":"HOLD","conviction":"MEDIUM","reasoning":"One sentence.","risk":"LOW","targetAction":"One action."}],"biggestRisk":"One sentence.","biggestOpportunity":"One sentence.","priorityActions":["a1","a2","a3"],"portfolioTheme":"Five words","verdict":"B","verdictTitle":"Four words","verdictSummary":"Two sentences."}`;

  let raw;
  try {
    raw = (await generateText(prompt, { maxTokens: 900, timeoutMs: 7500 }))
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
  } catch (e) {
    const isTO = e.name === "AbortError" || String(e).includes("timeout");
    return fail(isTO ? "timeout" : e.message || e, { isTimeout:isTO, reason:e.reason, provider:e.provider });
  }

  if (!raw) return fail("AI returned an empty response. Try again.");

  const repaired = repairJSON(raw);
  let analysis;
  try {
    analysis = JSON.parse(repaired);
  } catch (e) {
    const m = repaired.match(/\{[\s\S]+/);
    if (m) {
      try { analysis = JSON.parse(repairJSON(m[0])); } catch {}
    }
    if (!analysis) return fail(`JSON parse error: ${e.message}. Raw: ${raw.slice(0, 120)}`);
  }

  return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, analysis }) };
};

function repairJSON(s) {
  s = s.trim();
  s = s.replace(/,(\s*[}\]])/g, "$1");
  if ((s.match(/"/g) || []).length % 2 !== 0) s += '"';
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
