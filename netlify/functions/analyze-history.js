// TradeSignal Pro — AI Trade History Analyser
// Analyses closed trade data for behavioral patterns, gaps and verdict

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: "no_key" }) };
  }

  let stats;
  try { stats = JSON.parse(event.body || "{}").stats; }
  catch(e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Bad body" }) }; }

  const { totalTrades, realizedPnL, winRate, avgGain, avgLoss,
          topWinner, topLoser, riskReward, yearsSpan,
          top5Winners, top5Losers, totalInvested } = stats;

  const prompt = `You are a senior behavioural finance expert and portfolio coach. Analyse this Indian retail trader's ${yearsSpan || "multi"}-year closed trade history and provide deep, honest, specific insights.

KEY STATS:
- Total closed trades: ${totalTrades}
- Realized P&L: ₹${(realizedPnL/100000).toFixed(2)}L
- Win rate: ${winRate}%
- Avg gain per winner: ₹${(avgGain/1000).toFixed(1)}K
- Avg loss per loser: ₹${(avgLoss/1000).toFixed(1)}K
- Risk/Reward ratio: ${riskReward}x (avg gain / avg loss)
- Top winner: ${topWinner?.sym} (₹${((topWinner?.pnl||0)/100000).toFixed(2)}L)
- Top loser: ${topLoser?.sym} (₹${((topLoser?.pnl||0)/100000).toFixed(2)}L)
- Top 5 winners: ${top5Winners?.map(s=>`${s.sym} +₹${(s.pnl/1000).toFixed(0)}K`).join(", ")}
- Top 5 losers: ${top5Losers?.map(s=>`${s.sym} ₹${(s.pnl/1000).toFixed(0)}K`).join(", ")}

Return ONLY valid JSON (no markdown):
{
  "journeyVerdict": "<3-4 sentences: honest overall assessment of this trader's journey with specific numbers>",
  "patterns": [
    {
      "title": "<Short pattern name>",
      "icon": "<single emoji>",
      "description": "<2-3 sentences: specific behavioral pattern observed from the data with stock examples>"
    },
    { "title": "...", "icon": "...", "description": "..." },
    { "title": "...", "icon": "...", "description": "..." },
    { "title": "...", "icon": "...", "description": "..." }
  ],
  "gaps": [
    {
      "title": "<Gap title>",
      "problem": "<What the data shows is wrong — specific, honest>",
      "fix": "<Specific, actionable rule to implement going forward>"
    },
    { "title": "...", "problem": "...", "fix": "..." },
    { "title": "...", "problem": "...", "fix": "..." }
  ],
  "verdict": {
    "grade": "<A+|A|B+|B|C+|C|D>",
    "title": "<5-7 word punchy title for their trading style>",
    "summary": "<4-5 sentences: brutally honest but constructive overall verdict with specific numbers and what they must change>"
  }
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1600,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(9000)
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    let text = (data.content?.[0]?.text || "").replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
    const match = text.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(match ? match[0] : text);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, analysis }) };
  } catch(e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
