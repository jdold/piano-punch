# Roadmap

## Next: child links and safe persistence

1. Connect the UI to D1 so practice and rewards sync between the children's tablet and the parent's devices.
2. Keep the parent dashboard behind Cloudflare Access. Give each child a separate high-entropy bearer link that only accesses that child's data; do not bypass Access until the Worker validates that token on every child API request.
3. Make session save/recovery and historical edits transactional. Recalculate affected streaks and awards using deterministic keys and compensating ledger entries.
4. Add integration tests for duplicate requests, concurrent redemption approvals, corrections, missed days, and lesson confirmations.

## Then: validate live detection

1. Test an acoustic piano and a digital piano through the target iPhone/Safari setup.
2. Compare slow practice, short phrase gaps, long pauses, speech, TV, and recorded piano against the timeline.
3. Measure false credits and missed playing before changing thresholds or claiming reliability.
4. Add recording only if needed, opt-in, private, time-limited, and with parent-controlled deletion.

## Release gate

Do not deploy for family use until authentication, server-side authorization, D1 persistence, recovery, privacy controls, and the manual iPhone test plan are complete. The current prototype is not a secure multi-user service.
