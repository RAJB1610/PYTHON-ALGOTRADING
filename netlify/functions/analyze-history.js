const { generateText } = require("./_shared/ai-client");

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  let stats;
  try { stats = JSON.parse(event.body || "{}").stats; }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Bad body" }) }; }

  const {
    totalTrades, realizedPnL, winRate, avgGain, avgLoss,
    topWinner, topLoser, riskReward, yearsSpan,
    top5Winners, top5Losers
  } = stats;

  const prompt = `You are a senior behavioural finance expert and portfolio coach. Analyse this Indian retail trader's ${yearsSpan || "multi"}-year closed trade history and provide honest, specific insights.

KEY STATS:
- Total closed trades: ${totalTrades}
- Realized P&L: INR ${(realizedPnL / 100000).toFixed(2)}L
- Win rate: ${winRate}%
- Avg gain per winner: INR ${(avgGain / 1000).toFixed(1)}K
- Avg loss per loser: INR ${(avgLoss / 1000).toFixed(1)}K
- Risk/Reward ratio: ${riskReward}x
- Top winner: ${topWinner?.sym} (INR ${((topWinner?.pnl || 0) / 100000).toFixed(2)}L)
- Top loser: ${topLoser?.sym} (INR ${((topLoser?.pnl || 0) / 100000).toFixed(2)}L)
- Top 5 winners: ${top5Winners?.map(s => `${s.sym} +INR ${(s.pnl / 1000).toFixed(0)}K`).join(", ")}
- Top 5 losers: ${top5Losers?.map(s => `${s.sym} INR ${(s.pnl / 1000).toFixed(0)}K`).join(", ")}

Return ONLY valid JSON. No markdown:
{
  "journeyVerdict": "<3-4 sentences with specific numbers>",
  "patterns": [
    {"title":"<Short pattern name>","icon":"<single emoji>","description":"<2-3 sentences with examples>"},
    {"title":"...","icon":"...","description":"..."},
    {"title":"...","icon":"...","description":"..."},
    {"title":"...","icon":"...","description":"..."}
  ],
  "gaps": [
    {"title":"<Gap title>","problem":"<What the data shows is wrong>","fix":"<Specific actionable rule>"},
    {"title":"...","problem":"...","fix":"..."},
    {"title":"...","problem":"...","fix":"..."}
  ],
  "verdict": {
    "grade": "<A+|A|B+|B|C+|C|D>",
    "title": "<5-7 word title>",
    "summary": "<4-5 constructive sentences>"
  }
}`;

  try {
    const text = (await generateText(prompt, { maxTokens: 1600, timeoutMs: 9000 }))
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(match ? match[0] : text);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis }) };
  } catch (e) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: e.message, reason: e.reason, provider: e.provider })
    };
  }
};
