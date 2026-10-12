# Project Guide

This is the shared working guide for people and coding assistants. It is tool- and model-neutral; use the repository documentation and code as the source of truth.

## Before changing code

1. Read `README.md`, this file, and the relevant pages under `docs/`.
2. Inspect the implementation and tests. Do not assume a feature described in the roadmap already exists.
3. Keep changes small and explain behavior changes in the relevant documentation.

## Project invariants

- Keep microphone audio processing on-device. Never upload or persist audio unless the parent explicitly enables a separately reviewed recording feature.
- Do not claim piano recognition is accurate until tested against the family's acoustic and digital pianos and representative background sounds.
- Never credit time while microphone capture or classification is unavailable. Keep elapsed session time separate from credited active time.
- Keep points append-only in the ledger. Use deterministic idempotency keys for automatic awards and a compensating entry for corrections; do not rewrite history.
- A practice streak is based on verified daily-goal completion on required, non-excused days—not on punching in.
- Parent-only actions include settings, corrections, lesson confirmation, rewards management, point adjustments, and redemption approval. Enforce these on the server before family deployment.
- Do not add third-party accounts, analytics, AI services, or external audio processing without a documented privacy decision.
- Do not deploy a public or family-facing service until access controls and server-side authorization are in place.

## Checks

```sh
npm ci
npm test
npm run build
```

Add or update meaningful automated tests when changing timer accounting, streak calculations, award idempotency, or redemption transitions. Keep real-device audio checks in `docs/TESTING.md`.

## Documentation expectations

- Update `README.md` when setup or user-visible project status changes.
- Update `docs/ARCHITECTURE.md` when components or data boundaries change.
- Update `docs/SECURITY.md` when data collection, access, or storage changes.
- Record material technical choices in `docs/` with the date and reason.
- Describe implemented, tested, and planned behavior separately.
