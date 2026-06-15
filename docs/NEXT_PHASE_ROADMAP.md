# TradeSignal Pro V2 - Next Phase Roadmap

This document tracks the next phase of improvements for the deployed Netlify application.

## Current Baseline

- Static frontend served from `index.html`.
- Netlify Functions provide market data, Kite integration, Supabase sync/query endpoints, and AI analysis.
- Production is already deployed on Netlify.
- Git remote: `https://github.com/techhack01/PYTHON-ALGOTRADING.git`.
- Data sources include Yahoo Finance, NSE/BSE bhavcopy files, Kite Connect, Supabase, Google News RSS, and Anthropic.

## Primary Goals

1. Make production operations safer.
2. Improve data freshness and user trust.
3. Make the screener and portfolio analysis more actionable.
4. Reduce maintenance risk in the large single-file frontend.
5. Prepare the app for regular iteration through Git and Netlify deploys.

## Phase 1 - Production Safety And Operations

Priority: High

Objective: protect expensive or admin-like backend functions and expose production data freshness clearly.

### Tasks

- [ ] Add `ADMIN_SYNC_TOKEN` Netlify environment variable in Netlify project settings.
- [x] Require admin token for sync/backfill/compute functions:
  - [x] `netlify/functions/sync-instruments.js`
  - [x] `netlify/functions/sync-candles.js`
  - [x] `netlify/functions/sync-candles-background.js`
  - [x] `netlify/functions/backfill-candles-background.js`
  - [x] `netlify/functions/compute-signals-background.js`
- [x] Add shared function helpers for:
  - [x] CORS headers
  - [x] JSON responses
  - [x] admin token checks
  - [x] Supabase request headers
- [x] Add `data-status` function.
- [x] Show data freshness in the dashboard:
  - [x] latest `daily_candles` date
  - [x] latest `signals` date
  - [x] latest instrument sync timestamp if available
  - [x] clear warning when data is stale
- [x] Document the production sync sequence.

### Acceptance Criteria

- Public users cannot trigger backfills or full recomputes without the admin token.
- The dashboard shows whether screener data is current.
- Function errors return consistent JSON shapes.

## Phase 2 - Screener Improvements

Priority: High

Objective: make the technical screener more useful for daily decision making.

### Tasks

- [x] Add CSV export for filtered screener results.
- [ ] Add saved screener presets in `localStorage`.
- [ ] Add "new today" flags:
  - [ ] new MACD bullish cross
  - [ ] new NR7 setup
  - [ ] first close above 50MA
  - [ ] volume breakout
- [ ] Add composite ranking score beyond `bull_count`.
- [ ] Add sector or group filters if available from instruments/fundamental metadata.
- [ ] Improve stock detail panel:
  - [ ] support/resistance levels
  - [ ] recent signal history
  - [ ] volume trend
  - [ ] risk/reward zones

### Acceptance Criteria

- A user can filter, sort, export, and revisit useful screener views.
- Fresh signals are visually distinct from older signals.
- Ranking explains why a stock appears near the top.

## Phase 3 - Portfolio Intelligence

Priority: Medium-High

Objective: turn the portfolio tab into a rule-based portfolio health system, with AI as a readable explanation layer.

### Tasks

- [ ] Add portfolio health score.
- [ ] Add rule-based diagnostics:
  - [ ] concentration risk
  - [ ] allocation imbalance
  - [ ] weak-trend holdings
  - [ ] excessive loss exposure
  - [ ] low-signal holdings
- [ ] Add Nifty/Sensex benchmark comparison.
- [ ] Add persistent portfolio snapshots.
- [ ] Improve position-level recommendations.
- [ ] Improve trade history analysis:
  - [ ] holding period buckets
  - [ ] average winner duration
  - [ ] average loser duration
  - [ ] repeated stock-level mistakes
  - [ ] missed upside after exit, if data supports it

### Acceptance Criteria

- Portfolio insights are useful even when AI is unavailable.
- AI output references computed facts instead of only raw holdings.
- User can see portfolio changes over time.

## Phase 4 - Frontend Maintainability

Priority: Medium

Objective: reduce risk from the very large `index.html` file.

### Tasks

- [ ] Normalize file encoding to UTF-8.
- [ ] Split frontend JavaScript into logical modules, or migrate to a small Vite app.
- [ ] Separate concerns:
  - [ ] screener state/rendering
  - [ ] portfolio parsing/rendering
  - [ ] chart rendering
  - [ ] Kite integration
  - [ ] AI analysis UI
- [ ] Add simple UI smoke tests for critical flows.
- [ ] Add a README section for local Netlify development.

### Acceptance Criteria

- Future changes can be made without editing thousands of lines in one file.
- Encoding renders consistently on Windows, GitHub, Netlify, and browsers.
- Core flows can be verified after each deploy.

## Phase 5 - Data Quality And Testing

Priority: Medium

Objective: make indicator calculations, import parsing, and external data handling more reliable.

### Tasks

- [ ] Deduplicate indicator math between:
  - [ ] `quote.js`
  - [ ] `compute-signals-background.js`
- [ ] Add tests for:
  - [ ] RSI
  - [ ] MACD
  - [ ] Bollinger Bands
  - [ ] NR7
  - [ ] portfolio CSV parsing
  - [ ] Kite holding mapping
- [ ] Add retry/backoff for external data fetches.
- [ ] Add clear timeout handling for Yahoo, NSE, BSE, Kite, Supabase, and Anthropic.
- [ ] Add structured logging for production troubleshooting.

### Acceptance Criteria

- Indicator outputs are consistent between live quote and batch screener paths.
- Parser changes can be verified before deployment.
- Production failures are easier to diagnose.

## Suggested First Sprint

Scope: small, production-focused, and low-risk.

- [x] Create shared function helpers.
- [x] Add admin token protection to sync/backfill/compute endpoints.
- [x] Add `data-status` function.
- [x] Add dashboard data freshness panel.
- [x] Add screener CSV export.
- [x] Update README with Netlify env vars and sync operations.

## Environment Variables To Track

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `KITE_API_KEY`
- `KITE_API_SECRET`
- `ANTHROPIC_API_KEY`
- `ADMIN_SYNC_TOKEN`

## Deployment Notes

- Netlify should remain the production source of truth.
- Keep admin sync endpoints callable only with `ADMIN_SYNC_TOKEN`.
- Avoid committing `.env` or real credentials.
- Deploy changes through Git so Netlify can build from the repository.

## Open Questions

- Should admin sync be triggered by Netlify Scheduled Functions, an external cron, or a manual admin page?
- Should the frontend stay as static HTML, or should the next phase migrate to Vite/React?
- Should Supabase hold portfolio snapshots, or should snapshots stay local-only initially?
- Should AI analysis stay Anthropic-only, or should the app support a provider abstraction later?
