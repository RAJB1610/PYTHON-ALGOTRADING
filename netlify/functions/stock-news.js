const { generateText } = require("./_shared/ai-client");

exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:H, body:"" };

  let sym, requestedName;
  try {
    const body = JSON.parse(event.body || "{}");
    sym = body.sym;
    requestedName = body.name;
  }
  catch { return { statusCode:400, headers:H, body:JSON.stringify({ ok:false, error:"Bad body" }) }; }
  if (!sym) return { statusCode:400, headers:H, body:JSON.stringify({ ok:false, error:"Missing sym" }) };

  const name = String(requestedName || sym).replace(/-(T|BE|Z|N1|BZ|RE\d*-R)$/i, "");

  const rssItems = await fetchGoogleNews(name);
  if (!rssItems.length) {
    return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, sym, news:[], note:"No recent news" }) };
  }

  const urlMap = Object.fromEntries(rssItems.map((it, i) => [i, it.url]));
  const headlineBlock = rssItems
    .map((it, i) => `${i}: [${it.date}] ${it.title} | ${it.source}`)
    .join("\n");

  const prompt = `Categorise these recent Google News headlines for "${name}" (NSE/BSE India stock).
Headlines are numbered 0 to ${rssItems.length - 1}:

${headlineBlock}

Return ONLY a valid JSON array. Each entry MUST include the original index number. No markdown, no text outside the array:
[{"idx":0,"title":"concise headline under 12 words","category":"Corporate Action|Deal/Order|Bulk/Block Deal|Insider Trading|Results|Analyst|Regulatory|General","date":"date from headline","summary":"One sentence: what happened and its significance.","sentiment":"positive|negative|neutral","source":"source from headline"}]
Include only headlines directly about ${name}. Prefer a balanced set across Corporate Action, Deal/Order, Bulk/Block Deal, Insider Trading, Results, Analyst, Regulatory, and General when present. Return up to 10 best items. If none apply, return [].`;

  try {
    const raw = await generateText(prompt, { maxTokens: 1500, timeoutMs: 9000 });
    const items = extractArray(raw);
    const classified = items.map(it => ({
      ...it,
      url: (it.idx !== undefined && urlMap[it.idx]) ? urlMap[it.idx] : ""
    }));
    const usedIdx = new Set(classified.map(it => Number(it.idx)).filter(Number.isFinite));
    const supplemental = rssItems
      .map((it, idx) => ({ it, idx }))
      .filter(({ idx }) => !usedIdx.has(idx))
      .map(({ it, idx }) => ({
        idx,
        title: it.title,
        category: "General",
        date: it.date,
        summary: "Additional recent source headline for market context.",
        sentiment: "neutral",
        source: it.source,
        url: it.url
      }));
    const news = [...classified, ...supplemental].slice(0, 14);

    return { statusCode:200, headers:H, body:JSON.stringify({ ok:true, sym, news }) };
  } catch (e) {
    return {
      statusCode:200,
      headers:H,
      body:JSON.stringify({ ok:false, error:e.name === "AbortError" ? "timeout" : String(e.message), reason:e.reason, provider:e.provider })
    };
  }
};

async function fetchGoogleNews(name) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const queries = [
    `"${name}" NSE India after:${since}`,
    `${name} stock BSE NSE after:${since}`
  ];

  for (const q of queries) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`, {
        headers: { "User-Agent":"Mozilla/5.0" },
        signal: ctrl.signal
      });
      if (!res.ok) continue;
      const items = parseRSS(await res.text());
      const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
      const fresh = items.filter(it => {
        try { return new Date(it.rawDate).getTime() > cutoff; }
        catch { return true; }
      });
      if (fresh.length >= 2) return fresh.slice(0, 14);
    } catch {}
  }
  return [];
}

function parseRSS(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const chunk = m[1];
    const get = tag => {
      const cd = chunk.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
      if (cd) return cd[1].trim();
      const pl = chunk.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`));
      return pl ? pl[1].trim() : "";
    };
    const title = get("title");
    const pubRaw = get("pubDate");
    const source = chunk.match(/<source[^>]*>([^<]*)<\/source>/)?.[1]?.trim() || "Google News";
    const url = (chunk.match(/<link>([^<]+)<\/link>/)?.[1] ||
                 chunk.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1] || "").trim();
    if (!title) continue;
    const d = new Date(pubRaw);
    const date = isNaN(d) ? pubRaw.slice(0, 16) : d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
    items.push({ title, date, rawDate:pubRaw, source, url });
  }
  return items;
}

function extractArray(text) {
  const blocks = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") { if (!depth) start = i; depth++; }
    else if (text[i] === "]") {
      depth--;
      if (!depth && start >= 0) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (const b of blocks.reverse()) {
    try {
      const a = JSON.parse(b);
      if (Array.isArray(a) && a.length) return a;
    } catch {}
  }
  return [];
}
