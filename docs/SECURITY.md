# Security and Privacy

## Current limits

The hosted preview and API are gated by Cloudflare Access for the parent account. The Worker verifies the Access JWT audience, issuer, expiry, and parent's email before returning or changing family data. Browser storage remains a local recovery copy.

## Data handling

- Microphone capture begins only for a practice session and is analyzed on-device.
- Audio frames are discarded after classification; recordings are not yet enabled.
- The family app state is stored in D1 and mirrored in localStorage for recovery. D1 writes use a revision check so one device cannot silently overwrite another device's newer state.
- R2 is not enabled on this Cloudflare account yet, so session recording sync is not available.
- There are no child access links yet. Do not make child routes public until each link is a high-entropy token validated server-side and restricted to one child's records.
- No third-party AI/audio processing or analytics is configured.

## Required before family deployment

- Keep the preview hostname protected by Cloudflare Access; it currently allows only the parent's configured identity.
- Validate the authenticated identity and role on every Worker write. Hiding parent controls in the UI is not authorization.
- Use parameterized D1 statements and transactional/idempotent operations for ledger and redemption changes.
- Keep audit events for parent corrections, awards, adjustments, approvals, and rejections.
- Before enabling recordings, make them opt-in, private by default, retention-limited, downloadable/deletable by a parent, and separate from audio classification.
- Review logs and error reporting so child names, practice details, and audio are not unnecessarily exposed.
