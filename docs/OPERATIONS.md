# Operations

## Local development

```sh
npm ci
npm run dev
npm run dev:worker
npm test
npm run build
```

`npm run dev:worker` builds the UI and runs the bundled Worker locally. `npm run deploy` builds and deploys it with Wrangler. The checked-in Worker config binds the provisioned D1 database, but the app does not currently read or write it.

The app loads/saves family state through `/api/state`; localStorage is retained as a recovery copy. The API requires a valid Cloudflare Access JWT for the configured parent identity and uses a revision check to prevent silent cross-device overwrites.

## Cloudflare resources

- Astro 6 produces a static site; `scripts/bundle-worker.mjs` bundles generated assets into `dist/worker.js` for deployment as a Worker module.
- The deployed preview is currently protected by Cloudflare Access at the whole-site level. Do not add a public kid URL exception until child-link tokens are checked by Worker API routes.
- Wrangler binds the `piano-punch` D1 database as `DB`; `app_state` stores the family state document. The initial relational schema remains available for a future normalized API.
- The D1 schema is in `migrations/`; keep schema changes as new numbered migrations. Migration `0002_app_state.sql` is applied to production.
- R2 is not enabled yet; recordings are not captured or uploaded. Enable R2 and create/bind the private bucket before shipping recording support.

Before applying a migration remotely, confirm the active Cloudflare account and inspect the SQL. Use Wrangler's D1 migration workflow; do not edit production tables manually. The initial schema was provisioned during project setup and uses `CREATE TABLE IF NOT EXISTS` statements.

## Deployment checklist

1. Confirm `npm test` and `npm run build` pass.
2. Review Wrangler bindings against the deployed Worker and regenerate types from the current config.
3. Keep Cloudflare Access enabled for `piano-punch.jakedold07.workers.dev`, with the exact parent email allow rule; keep Workers.dev preview URLs disabled.
4. Add parent/child authorization on every write route before adding APIs.
5. Apply reviewed D1 migrations and verify the deployed Worker uses the intended database.
6. Deploy only after the release gate in `docs/ROADMAP.md` is met; test a preview before production.
7. Verify microphone permission, backgrounding, lock-screen, call interruption, and recovery on iPhone Safari.

There are no credentials in this repository. Store any future secrets in Cloudflare's secret-management tools, never in source files or committed configuration. Keep Cloudflare Access enabled on the Worker before deploying from a connected account.
