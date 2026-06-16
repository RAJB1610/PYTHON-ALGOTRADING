const { aiStatus, generateText } = require("./_shared/ai-client");
const { json } = require("./_shared/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const status = aiStatus();
  const safeStatus = {
    ok: status.ok,
    provider: status.provider,
    model: status.model,
    baseUrl: status.baseUrl,
    reason: status.reason,
    message: status.message,
  };

  if (!status.ok) {
    return json(200, {
      ok: false,
      configured: false,
      ...safeStatus,
      checkedAt: new Date().toISOString(),
    });
  }

  try {
    const started = Date.now();
    const text = await generateText(
      "Return exactly this JSON and nothing else: {\"ok\":true}",
      { maxTokens: 32, timeoutMs: 8000, temperature: 0 }
    );
    const latencyMs = Date.now() - started;

    return json(200, {
      ok: true,
      configured: true,
      ...safeStatus,
      latencyMs,
      sampleOk: /\{[\s\S]*"ok"\s*:\s*true[\s\S]*\}/.test(text),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json(200, {
      ok: false,
      configured: true,
      ...safeStatus,
      error: e.message,
      checkedAt: new Date().toISOString(),
    });
  }
};
