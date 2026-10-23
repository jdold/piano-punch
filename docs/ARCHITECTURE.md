# Architecture

## Current shape

```text
Browser
  ├─ microphone → AudioWorklet → local feature heuristic → SmartTimer
  ├─ practice and parent controls → local application state
  └─ localStorage recovery copy
       └─ packed state JSON over HTTPS
            └─ Cloudflare Worker
                 ├─ serves static assets
                 ├─ verifies parent Access JWTs and child family-link keys
                 └─ revision-checked reads and writes
                      └─ Cloudflare D1 app_state
                           └─ shared family state and practice history

Optional practice recordings → private Cloudflare R2 bucket
```

Astro builds the static page and browser modules. The Worker serves them and owns the family APIs. Parent APIs require a valid Cloudflare Access JWT for an allowed parent identity. The kids' page and key-protected kid API use a separate family-link key. D1 is the shared source of truth; localStorage is a per-device recovery copy.

## State transfer

Practice and reward state is stored as one JSON document in D1 with a revision number. Writes include the revision last read, so the Worker rejects stale updates instead of silently replacing newer activity. The browser keeps full session event objects while rendering and applying business rules. At the storage boundary, repetitive event fields are packed into per-session dictionaries and rows; the browser expands them on load. This representation preserves event values and history while reducing local and cloud state size.

Cloud refreshes run at a low frequency while the page is visible and pause while a parent is editing session history. Local practice checkpoints are saved every five seconds; active-session cloud updates are less frequent, while punch-in and punch-out still save immediately. Failed transient saves use capped backoff, and revision conflicts are merged before retrying.

## Audio and timer

The AudioWorklet transfers short audio frames locally. The browser classifier estimates whether the signal resembles piano activity from harmonic structure, spectral flatness, and repeated pitch evidence. It does not transcribe notes or prove that sound came from a live piano.

`SmartTimer` tracks elapsed time independently from verified active time. Playing time is committed; short silence is provisional and credited only if playing resumes before the configured threshold. If the threshold expires, the full provisional interval is discarded. Initial silence, microphone loss, unreliable classification, and unresolved silence at punch-out receive no credit.

## Practice and rewards

Each child has a daily active-time goal, inactivity threshold, required weekdays, excused dates, point rules, and independent history. Completed sessions contribute to daily totals. Goal completion drives daily awards and streaks. Lessons are parent-confirmed and keyed by child and week.

The ledger uses signed entries for awards, adjustments, redemptions, and compensating corrections. Stable idempotency keys prevent duplicate automatic awards. Pending redemptions reserve spendable points; approval debits once; rejection or cancellation releases the reservation.

## Privacy and storage

Raw microphone audio stays on-device for classification. If a parent enables recording, audio is stored separately in the private R2 bucket and is accessed through authenticated APIs. The main D1 state contains family profiles, practice sessions and their event timelines, lesson records, rewards, and the point ledger. Cloudflare Access and the family-link key are access boundaries; localStorage is only a recovery copy.

