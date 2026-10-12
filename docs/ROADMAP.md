# Roadmap

## Next: safe persistence

1. Add authenticated Worker endpoints and connect the UI to D1. Keep the prototype's domain calculations reusable and testable.
2. Enforce parent and child permissions on the server; put the app behind Cloudflare Access before any family-facing deployment.
3. Make session save/recovery and historical edits transactional. Recalculate affected streaks and awards using deterministic keys and compensating ledger entries.
4. Add integration tests for duplicate requests, concurrent redemption approvals, corrections, missed days, and lesson confirmations.

## Then: validate live detection

1. Test an acoustic piano and a digital piano through the target iPhone/Safari setup.
2. Compare slow practice, short phrase gaps, long pauses, speech, TV, and recorded piano against the timeline.
3. Measure false credits and missed playing before changing thresholds or claiming reliability.
4. Add recording only if needed, opt-in, private, time-limited, and with parent-controlled deletion.

## Release gate

Do not deploy for family use until authentication, server-side authorization, D1 persistence, recovery, privacy controls, and the manual iPhone test plan are complete. The current prototype is not a secure multi-user service.
