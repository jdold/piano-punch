# Architecture

## Current shape

```text
Astro static page and browser modules
  ├─ microphone → AudioWorklet → local feature heuristic
  ├─ classification → SmartTimer → practice timeline
  └─ profile/session/ledger state → localStorage

Cloudflare Worker
  ├─ serves static assets and adds response security headers
  └─ Cloudflare Access gates the preview to the parent identity

Cloudflare D1
  └─ provisioned, but not yet connected to the browser UI
```

The UI and all current business rules run in the browser. The Worker serves the static build; Cloudflare Access gates the hosted preview. D1 is provisioned in the Cloudflare account, but there are no API routes yet. `localStorage` is prototype persistence, not a backup or access-control boundary.

## Audio and timer

The AudioWorklet transfers short audio frames locally. The browser classifier estimates whether the signal resembles piano activity from harmonic structure, spectral flatness, and repeated pitch evidence. It does not transcribe notes or prove that sound came from a live piano.

`SmartTimer` tracks elapsed time independently from verified active time. Playing time is committed; short silence is provisional and is credited only if playing resumes before the configured threshold. If the threshold expires, the full provisional interval is discarded. Initial silence, microphone loss, unreliable classification, and unresolved silence at punch-out receive no credit.

## Practice and rewards

Each child has a daily active-time goal, inactivity threshold, required weekdays, excused dates, point rules, and independent history. Completed sessions contribute to the daily total. Goal completion drives daily awards and streaks. Lessons are parent-confirmed and keyed by child and week.

The ledger uses signed entries for awards, adjustments, redemptions, and compensating corrections. Stable idempotency keys prevent duplicate automatic awards. Pending redemptions reserve spendable points; approval debits once; rejection or cancellation releases the reservation.

## Target hosted shape

```text
Mobile browser ── HTTPS ── Cloudflare Worker / Astro
                             ├─ Cloudflare Access identity
                             └─ D1 binding
                                  ├─ children and settings
                                  ├─ sessions and detection events
                                  ├─ point rules and immutable ledger
                                  └─ rewards and redemption requests
```

Keep raw microphone audio on-device. Only persist session totals and the minimal detection timeline needed for parent review. R2 is not configured; only consider private R2 objects if recordings are explicitly enabled with access, retention, and deletion controls.

## Data model

`migrations/0001_initial.sql` defines children, practice sessions, detection events, point rules, point ledger, lessons, excused days, rewards, redemptions, and parent audit events. The schema is a foundation, not proof that server-side flows or authorization exist.
