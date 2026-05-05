exports.handler = async (event) => {
  const H = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
  if (event.httpMethod==="OPTIONS") return {statusCode:200,headers:H,body:""};

  const fail = (msg, extra={}) => ({statusCode:200,headers:H,body:JSON.stringify({ok:false,error:String(msg),...extra})});

  if (!process.env.ANTHROPIC_API_KEY)
    return fail("ANTHROPIC_API_KEY not set — add it in Netlify → Project config → Environment variables → redeploy", {reason:"no_key"});

  let portfolio;
  try   { portfolio = JSON.parse(event.body||"{}").portfolio; }
  catch  { return fail("Invalid request body"); }
  if (!portfolio?.length) return fail("Empty portfolio");

  const rows = portfolio.map(h =>
    `${h.sym}: return=${h.pnlPct!=null?h.pnlPct+"%":"?"}, signals=${h.bullCount??0}/5, MA=${h.maTrend??"?"}, RSI=${h.rsi??"-"}`
  ).join("\n");

  const prompt = `Indian equity portfolio analyst. Analyse this NSE portfolio and return ONLY valid compact JSON — no markdown, no extra text.

${rows}

JSON schema (keep ALL strings to one sentence max):
{"healthScore":5,"healthLabel":"Good","healthSummary":"Two sentences.","strengths":["s1","s2"],"weaknesses":["w1","w2"],"stocks":[{"sym":"X","action":"HOLD","conviction":"MEDIUM","reasoning":"One sentence.","risk":"LOW","targetAction":"One action."}],"biggestRisk":"One sentence.","biggestOpportunity":"One sentence.","priorityActions":["a1","a2","a3"],"portfolioTheme":"Five words","verdict":"B","verdictTitle":"Four words","verdictSummary":"Two sentences."}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort("timeout"), 7500);

  let apiRes;
  try {
    apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:900,messages:[{role:"user",content:prompt}]}),
      signal:controller.signal
    });
    clearTimeout(tid);
  } catch(e) {
    clearTimeout(tid);
    const isTO = e.name==="AbortError" || String(e).includes("timeout");
    return fail(isTO ? "timeout" : `Fetch error: ${e.message||e}`, {isTimeout:isTO});
  }

  if (!apiRes.ok) {
    const body = await apiRes.text().catch(()=>"");
    return fail(`Anthropic API ${apiRes.status}: ${body.slice(0,200)}`);
  }

  let apiJson;
  try   { apiJson = await apiRes.json(); }
  catch(e) { return fail(`Could not parse Anthropic response: ${e.message}`); }

  const raw = (apiJson.content?.[0]?.text || "").replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  if (!raw) return fail("Claude returned an empty response — try again");

  // Auto-repair truncated JSON then parse
  const repaired = repairJSON(raw);
  let analysis;
  try { analysis = JSON.parse(repaired); }
  catch(e) {
    // One more attempt: extract the JSON object
    const m = repaired.match(/\{[\s\S]+/);
    if (m) try { analysis = JSON.parse(repairJSON(m[0])); } catch{}
    if (!analysis) return fail(`JSON parse error: ${e.message} — raw: ${raw.slice(0,120)}`);
  }

  return {statusCode:200,headers:H,body:JSON.stringify({ok:true,analysis})};
};

function repairJSON(s) {
  s = s.trim();
  s = s.replace(/,(\s*[}\]])/g,"$1");          // trailing commas
  if ((s.match(/"/g)||[]).length%2!==0) s+='"'; // unclosed string
  const opens=[];let inStr=false,prev="";
  for(const ch of s){
    if(ch==='"'&&prev!=="\\") inStr=!inStr;
    if(!inStr){if(ch==="{"||ch==="[") opens.push(ch==="{"?"}":"]"); else if(ch==="}"||ch==="]") opens.pop();}
    prev=ch;
  }
  return s+opens.reverse().join("");
}
