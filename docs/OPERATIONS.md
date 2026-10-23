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

The app loads/saves family state through `/api/state`; localStorage is retained as a recovery copy. Session event timelines are packed into a compact per-session representation for local storage and cloud requests, then expanded in the browser before rendering. This preserves the full timeline while keeping state below the Worker request and D1 row limits.

Visible clients refresh every ten seconds during a practice session and every two minutes while idle. Refreshes also run when a page returns to the foreground and pause while a parent timeline or editor is open. Practice checkpoints still save locally every five seconds, and active-session cloud checkpoints keep the previous five-second cadence; punch-in and punch-out still save promptly. The API requires a valid Cloudflare Access JWT for the configured parent identity and uses a revision check to prevent silent cross-device overwrites.

## Cloudflare resources

- Astro 6 produces a static site; `scripts/bundle-worker.mjs` bundles generated assets into `dist/worker.js` for deployment as a Worker module.
- Parent pages and APIs are protected by Cloudflare Access. The `/kids` entry point and kid API use a separate family-link key, which the Worker verifies on kid requests.
- Wrangler binds the `piano-punch` D1 database as `DB`; `app_state` stores the shared family state document and revision. The initial relational schema remains available for a future normalized API.
- The D1 schema is in `migrations/`; keep schema changes as new numbered migrations. Migration `0002_app_state.sql` is applied to production.
- Wrangler binds the private `piano-punch-recordings` R2 bucket as `RECORDINGS` for optional practice recordings.
- Session event timelines are packed for local and cloud persistence, then expanded by the browser. The current family state was about 1.86 MB before packing and about 866 KB afterward; all event details are preserved.

Before applying a migration remotely, confirm the active Cloudflare account and inspect the SQL. Use Wrangler's D1 migration workflow; do not edit production tables manually. The initial schema was provisioned during project setup and uses `CREATE TABLE IF NOT EXISTS` statements.

## Deployment checklist

1. Confirm `npm test` and `npm run build` pass.
2. Review Wrangler bindings against the deployed Worker and regenerate types from the current config.
3. Keep Cloudflare Access enabled for the parent app and Worker routes, with the exact parent email allow rule; keep Workers.dev preview URLs disabled.
4. Keep parent JWT and kid family-link authorization on every write route.
5. Apply reviewed D1 migrations and verify the deployed Worker uses the intended database.
6. Deploy only after the release gate in `docs/ROADMAP.md` is met; test a preview before production.
7. Verify microphone permission, backgrounding, lock-screen, call interruption, and recovery on iPhone Safari.

There are no credentials in this repository. Store secrets in Cloudflare's secret-management tools, never in source files or committed configuration. Keep Cloudflare Access enabled on the parent app and APIs before deploying from a connected account.

