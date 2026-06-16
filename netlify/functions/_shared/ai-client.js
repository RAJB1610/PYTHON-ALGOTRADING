function aiStatus() {
  const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase();

  if (provider === "openai_compatible" || provider === "openai") {
    const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.AI_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.AI_MODEL || "gpt-4o-mini";
    return {
      ok: !!apiKey,
      provider: "openai_compatible",
      model,
      baseUrl,
      reason: apiKey ? null : "no_key",
      message: apiKey ? null : "AI_API_KEY or OPENAI_API_KEY not set",
    };
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  return {
    ok: !!process.env.ANTHROPIC_API_KEY,
    provider: "anthropic",
    model,
    baseUrl: "https://api.anthropic.com",
    reason: process.env.ANTHROPIC_API_KEY ? null : "no_key",
    message: process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY not set",
  };
}

async function generateText(prompt, options = {}) {
  const status = aiStatus();
  if (!status.ok) {
    const err = new Error(status.message || "AI provider is not configured");
    err.reason = status.reason || "no_key";
    err.provider = status.provider;
    throw err;
  }

  if (status.provider === "openai_compatible") {
    return generateOpenAICompatible(prompt, status, options);
  }
  return generateAnthropic(prompt, status, options);
}

async function generateAnthropic(prompt, status, options) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: options.model || status.model,
      max_tokens: options.maxTokens || 900,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs || 9000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text || "").trim();
}

async function generateOpenAICompatible(prompt, status, options) {
  const base = status.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || status.model,
      max_tokens: options.maxTokens || 900,
      temperature: options.temperature ?? 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs || 9000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return (
    data.choices?.[0]?.message?.content ||
    data.choices?.[0]?.text ||
    data.output_text ||
    ""
  ).trim();
}

module.exports = {
  aiStatus,
  generateText,
};
