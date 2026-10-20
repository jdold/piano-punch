# Implementation notes

## Smart timer accounting

`SmartTimer` uses monotonic time. Verified playing time is committed immediately. A silence interval is provisional; if it is shorter than the configured threshold and playing resumes, the interval is committed. When the threshold is reached, the whole provisional interval is discarded. Initial silence never starts credit. Microphone loss and punch-out discard unresolved provisional time.

## Audio classification

The AudioWorklet moves microphone frames off the UI thread. A local FFT feature pass checks harmonic energy, spectral flatness, and repeated pitch evidence. It does not use volume alone. This is an experimental piano-likeness heuristic, not a validated instrument classifier. It may credit recorded piano or mistake other harmonic sounds for piano. Test real piano, speech, TV, other instruments, and slow practice before treating points or completion as authoritative.

## Data and access

The current UI uses localStorage for a working prototype. It is per-browser and has no login or cloud sync. A private D1 database and initial schema now exist in the Cloudflare account, but the app does not yet use them. Before family deployment, put the app behind Cloudflare Access, add authenticated Worker APIs, and bind private R2 only if recordings are explicitly enabled. Never expose the D1 binding or recording objects publicly.

## Point rules

`point_ledger.idempotency_key` is unique in the D1 schema. Each award source has a stable key. Corrections to history must append compensating ledger transactions; never edit or delete original ledger rows. Pending redemptions reserve spendable points, approval creates one debit, and rejection/cancellation release the reservation.

## Verification still needed

- Run on an iPhone in Safari, including screen lock, backgrounding, calls, and permission revocation.
- Calibrate against the actual acoustic and digital pianos and common household background sounds.
- Move the local state operations behind Worker endpoints and exercise atomic D1 redemption approval.
- Configure Cloudflare Access and connect the existing D1 database before publishing.

## Goal celebrated before interruption (2026-10-20)

The live practice UI celebrates as soon as verified active time reaches the daily goal, before the child necessarily punches out. A later page close can recover that same session with `status: interrupted`. A persisted `goalCelebrated` flag is therefore authoritative evidence of a qualifying practice day: streaks and goal awards must retain it, and kid/parent sync merges must not discard a local celebration when the server has a less complete interrupted copy. Sessions interrupted before the celebration remain subject to parent review and do not qualify.
