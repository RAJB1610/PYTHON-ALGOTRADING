# TradeSignal Pro V2

Live NSE/BSE stock screener and portfolio analysis dashboard deployed on Netlify.

## Runtime

- Frontend: static `index.html`
- Backend: Netlify Functions in `netlify/functions`
- Data store: Supabase
- Market/chart data: Yahoo Finance, NSE/BSE bhavcopy files
- Broker integration: Zerodha Kite Connect
- AI analysis: Anthropic

## Required Netlify Environment Variables

Set these in Netlify project settings before deploying.

```text
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
KITE_API_KEY=
KITE_API_SECRET=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
AI_PROVIDER=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
ADMIN_SYNC_TOKEN=
```

Do not commit `.env` files or real credentials.

## AI Provider Configuration

The app's AI functions use server-side Netlify environment variables. Keys are never exposed to browser JavaScript.

Default Anthropic mode:

```text
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

OpenAI-compatible mode:

```text
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://provider.example.com/v1
AI_API_KEY=your_key
AI_MODEL=provider-model-name
```

Use OpenAI-compatible mode for providers that expose `/chat/completions`. Temporary or free keys can be used by setting Netlify env vars, but do not hardcode public keys into the repository.

RelayFreeLLM mode:

Deploy RelayFreeLLM as a separate long-running service, then point this Netlify app at its OpenAI-compatible endpoint.

```text
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://your-relay-domain.com/v1
AI_API_KEY=relay-free
AI_MODEL=meta-model
```

The relay service should hold provider keys such as `GEMINI_APIKEY`, `GROQ_APIKEY`, `MISTRAL_APIKEY`, and `NVIDIA_APIKEY`. Do not run the relay from Netlify Functions; use Railway, Render, Fly.io, a VPS, or a local machine for testing.

## AI Health Check

Use this endpoint after changing AI env vars:

```text
/.netlify/functions/ai-status
```

It reports provider, model, base URL, configuration state, and a small live completion test. It never returns API keys.

## Public Functions

These functions are intended to be callable by the frontend.

- `quote`
- `screen-stocks`
- `stock-chart`
- `index-data`
- `stock-news`
- `kite-config`
- `kite-auth`
- `kite-holdings`
- `analyze`
- `analyze-history`
- `data-status`
- `ai-status`

## Admin-Protected Functions

These functions mutate or recompute production data and require `ADMIN_SYNC_TOKEN`.

- `sync-instruments`
- `sync-candles`
- `sync-candles-background`
- `backfill-candles-background`
- `compute-signals-background`

Send the token as either:

```text
x-admin-token: <ADMIN_SYNC_TOKEN>
```

or, for manual invocation only:

```text
?admin_token=<ADMIN_SYNC_TOKEN>
```

Prefer the header for cron jobs and scripts because query strings can appear in logs.

## Production Data Sync Sequence

Initial setup or full rebuild:

1. Run `sync-instruments`.
2. Run `backfill-candles-background`.
3. Run `compute-signals-background`.
4. Open the dashboard and confirm the `Data` pill shows the latest signal date.

Daily market update:

1. Run `sync-candles` or `sync-candles-background` after NSE/BSE bhavcopy publication, usually after market close.
2. Run `compute-signals-background`.
3. Confirm `data-status` reports matching latest candle and signal dates.

Example manual call:

```bash
curl -H "x-admin-token: $ADMIN_SYNC_TOKEN" \
  "https://YOUR_NETLIFY_SITE.netlify.app/.netlify/functions/sync-candles"
```

## Data Freshness

The dashboard calls `/.netlify/functions/data-status` and shows a header pill with the latest signal date. The pill warns when signal data appears stale.

## Roadmap

See `docs/NEXT_PHASE_ROADMAP.md`.
