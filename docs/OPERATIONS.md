# Operations

## Local development

```sh
npm ci
npm run dev
npm run dev:worker
npm test
npm run build
```

`npm run dev:worker` builds the UI and runs the bundled Worker locally. `npm run deploy` builds and deploys it with Wrangler. The Worker uses the configured D1 database and private R2 bucket.

The app loads/saves family state through `/api/state`; localStorage is retained as a recovery copy. Session event timelines are packed into a compact per-session representation for local storage and cloud requests, then expanded in the browser before rendering. Closed-session detection timelines are archived losslessly in the existing private R2 bucket under `history/`; shared D1 state and local recovery copies retain the session totals and a history reference. The parent timeline loads archived events only when requested. All history access still requires parent authentication.

The app fetches shared state at startup, after a full save, hourly while idle, and when returning to an idle tab after at least a minute. It does not refresh during practice or pending saves. Shared settings, corrections, awards and histories replace stale tablet data; valid offline sessions are merged before saving. Practice checkpoints still save locally every five seconds; cloud checkpoints send only the active session every thirty seconds. Punch-in, punch-out, and family-data changes still save promptly through the full-state API. The API requires a valid Cloudflare Access JWT for the configured parent identity and uses a revision check to prevent silent cross-device overwrites.

## Cloudflare resources

- Astro 6 produces a static site; `scripts/bundle-worker.mjs` bundles generated assets into `dist/worker.js` for deployment as a Worker module.
- Parent pages and APIs are protected by Cloudflare Access. The `/kids` entry point and kid API use a separate family-link key, which the Worker verifies on kid requests.
- Wrangler binds the `piano-punch` D1 database as `DB`; `app_state` stores the shared family state document and revision. The initial relational schema remains available for a future normalized API.
- The D1 schema is in `migrations/`; keep schema changes as new numbered migrations. Migration `0002_app_state.sql` is applied to production.
- Wrangler binds the private `piano-punch-recordings` R2 bucket as `RECORDINGS` for optional practice recordings.
- Full-state recovery uploads accept up to 16 MB so older devices can recover copies that exceeded the former 4 MB cap. Before committing, the Worker archives closed timelines in R2 and stores only small session summaries in D1. Immutable content-hashed objects preserve prior audit versions; a revision conflict may leave an unreferenced archive object, but cannot replace newer state. Active checkpoints remain bounded to one session.

Before applying a migration remotely, confirm the active Cloudflare account and inspect the SQL. Use Wrangler's D1 migration workflow; do not edit production tables manually. The initial schema was provisioned during project setup and uses `CREATE TABLE IF NOT EXISTS` statements.

## Deployment checklist

1. Confirm `npm test` and `npm run build` pass.
2. Review Wrangler bindings against the deployed Worker and regenerate types from the current config.
3. Keep Cloudflare Access enabled for the parent app and Worker routes, with the exact parent email allow rule; keep Workers.dev preview URLs disabled.
4. Keep parent JWT and both kid family-link keys authorized on every write route.
5. Apply reviewed D1 migrations and verify the deployed Worker uses the intended database.
6. Deploy only after the release gate in `docs/ROADMAP.md` is met; test a preview before production.
7. Verify microphone permission, backgrounding, lock-screen, call interruption, and recovery on iPhone Safari.

There are no credentials in this repository. Store secrets in Cloudflare's secret-management tools, never in source files or committed configuration. Keep Cloudflare Access enabled on the parent app and APIs before deploying from a connected account.


## Parent corrections and streaks

Saving corrected punches verifies the session as complete, including sessions recovered as interrupted. The correction event retains the prior status and times. Streaks use the corrected daily total immediately; automatic awards are reconciled across the child's history so repairing an older gap restores subsequent milestones without duplicate points. If a correction moves a session to another date, awards on the original date are also reconciled.

Child sync uses the same recurring streak interval and point amount as parent corrections, preserving restored bonuses on subsequent saves.

## Parent-confirmed recovery days

A `parentDayCredit` session records a parent-confirmed daily minimum, including the November 26 Thanksgiving credit. Recovered actual practice counts toward that minimum instead of being added twice. Further playing beyond the minimum still earns ordinary extra-time points. Child APIs cannot create these parent-only credits.

## November 28 sync repair

Shared state had grown beyond the former 4 MB request cap and stopped updating on November 24. Archived timelines remove this cause of repeated full-state upload failures. Kid hydration and conflict resolution use one merger; successful full saves refresh canonical server state so an old local streak does not remain on screen. Offline sessions and newer parent corrections are preserved. A stale active checkpoint recovered at startup is explicitly queued for saving.
