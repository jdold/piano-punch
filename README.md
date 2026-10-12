# Piano Punch

Private, mobile-first piano practice tracker for a family. The project is an early prototype: it has a live microphone timer, a piano-likeness heuristic, practice history, and a points/rewards interface. A gated Cloudflare preview is available at https://piano-punch.jakedold07.workers.dev.

## Current status

| Area | Now | Before relying on it |
| --- | --- | --- |
| Practice data | Stored in this browser's `localStorage` | Connect authenticated Worker APIs to D1 |
| Audio | Processed on-device; parent may opt in to private session recordings stored in R2 | Validate the classifier with the family's pianos and ordinary household audio |
| Points | Deterministic local ledger prototype | Move awards and redemptions to transactional server logic |
| Access | Cloudflare Access gates the preview for the parent's account | Add authenticated API roles before relying on any shared family data |
| Cloudflare | Worker preview and D1 schema are provisioned; app state is still local to each browser | Recording data is separately stored in a private R2 bucket |

The audio classifier is an experimental signal-feature heuristic. It can mistake recorded piano, other pitched instruments, or some background audio for live piano. See [Testing](docs/TESTING.md) before trusting credited time or rewards.

Family settings and practice history sync through D1. Opt-in recordings are stored privately in R2 and are available only to the Access-authenticated parent for playback or deletion. Recordings are never published or sent to a third-party model.

## Run and verify

Requirements: Node.js 22 and npm. The [private preview](https://piano-punch.jakedold07.workers.dev) is gated by Cloudflare Access for the parent account.

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run dev:worker` builds the static UI into a local Worker preview. `npm run deploy` builds and deploys the Worker; it requires Wrangler authentication for the Cloudflare account. The deployed preview is restricted by Cloudflare Access to the parent email above. Keep Access enabled and previews disabled.

Microphone access requires a secure browser context (localhost is supported). The UI stores state locally; clearing browser storage clears the prototype's data.

## Project map

- `src/lib/smart-timer.js` — provisional grace-window accounting and live states.
- `src/audio/` and `public/audio/` — local audio feature analysis and AudioWorklet.
- `src/lib/rewards.js` — deterministic award rules, ledger, and redemption state transitions.
- `src/lib/piano-state.js` — prototype profiles, streak calculations, and browser persistence.
- `migrations/` — D1 schema migrations.
- `tests/` — automated timer and rewards checks.
- `docs/` — architecture, security, operations, testing, and roadmap.
- `PROJECT_GUIDE.md` — shared contribution instructions for any developer or coding assistant.

## Documentation

- [Project guide](PROJECT_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Operations](docs/OPERATIONS.md)
- [Security and privacy](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Implementation notes](docs/implementation-notes.md)

No LLM provider, hosted AI service, or generated-code tool is required to build, test, or operate the project.
