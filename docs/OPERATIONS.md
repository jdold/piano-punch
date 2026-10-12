# Operations

## Local development

```sh
npm ci
npm run dev
npm test
npm run build
```

The browser prototype uses localStorage and does not call D1. A local UI session cannot validate production persistence or access policies.

## Cloudflare resources

- Astro 6 with `@astrojs/cloudflare` serves the app as a Worker.
- Wrangler configuration binds the `piano-punch` D1 database as `DB`.
- The D1 schema is in `migrations/`; keep schema changes as new numbered migrations.
- No R2 bucket, recording storage, or third-party audio service is configured.

Before applying a migration remotely, confirm the active Cloudflare account and inspect the SQL. Use Wrangler's D1 migration workflow; do not edit production tables manually. The initial schema was provisioned during project setup and uses `CREATE TABLE IF NOT EXISTS` statements.

## Deployment checklist

1. Confirm `npm test` and `npm run build` pass.
2. Review Wrangler bindings against the deployed Worker and regenerate types from the current config.
3. Verify Cloudflare Access protects the hostname and test parent/child authorization on every write route.
4. Apply reviewed D1 migrations and verify the deployed Worker uses the intended database.
5. Deploy only after the release gate in `docs/ROADMAP.md` is met; test a preview before production.
6. Verify microphone permission, backgrounding, lock-screen, call interruption, and recovery on iPhone Safari.

There are no credentials in this repository. Store any future secrets in Cloudflare's secret-management tools, never in source files or committed configuration.
