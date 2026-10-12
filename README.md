# Piano Punch

Private, mobile-first piano practice tracker for a family. The project is an early prototype: it has a live microphone timer, a piano-likeness heuristic, practice history, and a points/rewards interface. It is **not ready for family use or public deployment** yet.

## Current status

| Area | Now | Before relying on it |
| --- | --- | --- |
| Practice data | Stored in this browser's `localStorage` | Connect authenticated Worker APIs to D1 |
| Audio | Processed on-device; no recording is saved | Validate the classifier with the family's pianos and ordinary household audio |
| Points | Deterministic local ledger prototype | Move awards and redemptions to transactional server logic |
| Access | No login or role enforcement | Put behind Cloudflare Access and enforce parent actions server-side |
| Cloudflare | D1 database and schema are provisioned; Worker is not deployed | Complete API, access controls, and deployment checks |

The audio classifier is an experimental signal-feature heuristic. It can mistake recorded piano, other pitched instruments, or some background audio for live piano. See [Testing](docs/TESTING.md) before trusting credited time or rewards.

## Run and verify

Requirements: Node.js 22 and npm.

```sh
npm ci
npm run dev
npm test
npm run build
```

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
