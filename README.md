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
ADMIN_SYNC_TOKEN=
```

Do not commit `.env` files or real credentials.

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
