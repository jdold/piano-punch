# Implementation notes

## Smart timer accounting

`SmartTimer` uses monotonic time. Verified playing time is committed immediately. A silence interval is provisional; if it is shorter than the configured threshold and playing resumes, the interval is committed. When the threshold is reached, the whole provisional interval is discarded. Initial silence never starts credit. Microphone loss and punch-out discard unresolved provisional time.

## Audio classification

The AudioWorklet moves microphone frames off the UI thread. A local FFT feature pass checks harmonic energy, spectral flatness, and repeated pitch evidence. It does not use volume alone. This is an experimental piano-likeness heuristic, not a validated instrument classifier. It may credit recorded piano or mistake other harmonic sounds for piano. Test real piano, speech, TV, other instruments, and slow practice before treating points or completion as authoritative.

## Data and access

The app stores shared family state in D1 and keeps localStorage as an offline recovery copy. Access JWT certificates and imported verification keys are cached per Worker isolate for ten minutes; every parent request still checks the JWT signature, audience, issuer, expiry, and allowed email. Session event timelines are packed for local and cloud persistence and expanded in the browser before use. The packed representation retains every event while reducing repeated field names. Shared state is fetched during page initialization, without background refresh polling. During practice, local and cloud checkpoints continue every five seconds, with immediate saves at punch-in and punch-out. If another device changes family data while a page remains open, reload that page to fetch the latest version.

## Point rules

`point_ledger.idempotency_key` is unique in the D1 schema. Each award source has a stable key. Corrections to history must append compensating ledger transactions; never edit or delete original ledger rows. Pending redemptions reserve spendable points, approval creates one debit, and rejection/cancellation release the reservation.

## Verification still needed

- Run on an iPhone in Safari, including screen lock, backgrounding, calls, and permission revocation.
- Calibrate against the actual acoustic and digital pianos and common household background sounds.

## Goal celebrated before interruption (2026-10-20)

The live practice UI celebrates as soon as verified active time reaches the daily goal, before the child necessarily punches out. A later page close can recover that same session with `status: interrupted`. A persisted `goalCelebrated` flag is therefore authoritative evidence of a qualifying practice day: streaks and goal awards must retain it, and kid/parent sync merges must not discard a local celebration when the server has a less complete interrupted copy. Sessions interrupted before the celebration remain subject to parent review and do not qualify.

The server remains the shared source of truth; local storage is a recovery queue for offline activity. The app loads shared state on page initialization and otherwise does not poll for updates. During practice, local checkpoints and cloud updates remain five seconds apart, with immediate saves at punch-in and punch-out. Failed transient saves retry with capped backoff; permanent validation and size errors are shown without retrying.

## Compact family state (2026-10-23)

The shared state had grown to about 1.86 MB, mostly because detector event objects repeated the same field names. The Worker rejected state writes over 1 MB, and D1 rows are limited to 2 MB. A dictionary plus row representation preserves all event values while reducing the current state to about 866 KB. Parent state reads return the stored JSON directly to avoid parsing and serializing the full document inside the Worker.

