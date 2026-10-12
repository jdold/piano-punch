# Security and Privacy

## Current limits

The hosted preview is gated by Cloudflare Access for the parent account. The app itself still has no server-side roles or cloud sync. Browser storage is accessible to anyone using that browser profile. Do not put authoritative family records in a shared device profile or treat this prototype as private multi-user storage.

## Data handling

- Microphone capture begins only for a practice session and is analyzed on-device.
- Audio frames are discarded after classification; recordings are not enabled.
- Session totals, child names, settings, timeline events, and the points ledger currently remain in localStorage.
- The D1 schema exists, but the app does not yet read from or write to it.
- No third-party AI/audio processing or analytics is configured.

## Required before family deployment

- Keep the preview hostname protected by Cloudflare Access; it currently allows only the parent's configured identity.
- Validate the authenticated identity and role on every Worker write. Hiding parent controls in the UI is not authorization.
- Use parameterized D1 statements and transactional/idempotent operations for ledger and redemption changes.
- Keep audit events for parent corrections, awards, adjustments, approvals, and rejections.
- If recording is ever enabled, make it opt-in, private by default, retention-limited, downloadable/deletable by a parent, and separate from audio classification.
- Review logs and error reporting so child names, practice details, and audio are not unnecessarily exposed.
