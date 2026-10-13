# Security and Privacy

## Current limits

The parent dashboard and parent API are gated by Cloudflare Access. The Worker verifies the Access JWT audience, issuer, expiry, and parent's email before parent operations. The child name picker is available through `/kids#<family-link-key>`; a high-entropy key is validated on a dedicated kid API, and the key is stored in the Worker secret `KID_LINK_KEY`. Cloudflare Access bypasses only the child page, its static assets, and kid API paths. Browser storage remains a local recovery copy.

## Data handling

- Microphone capture begins only for a practice session and is analyzed on-device.
- Audio frames are analyzed on-device. Optional recordings are stored separately in private R2.
- The family app state is stored in D1 and mirrored in localStorage for recovery. D1 writes use a revision check so one device cannot silently overwrite another device's newer state.
- The family link is a bearer credential: anyone who has it can see family practice and rewards data, record sessions, and submit reward requests. Keep it private and rotate `KID_LINK_KEY` if it is shared too widely.
- Child endpoints cannot change parent settings, approve redemptions, edit existing practice sessions, or access parent controls. They can create pending redemption requests and cancel their own pending requests.
- A shared family link is not a strong child identity boundary. Client-side microphone classification cannot prove that a session represents piano playing; parent audits and manual corrections remain important.
- No third-party AI/audio processing or analytics is configured.

## Required before family deployment

- Keep the root and parent APIs protected by Cloudflare Access. Maintain narrow path-based bypasses only for the kids' entry page, its static assets, and the dedicated key-protected kid API.
- Validate the authenticated identity and role on every Worker write. Hiding parent controls in the UI is not authorization.
- Use parameterized D1 statements and transactional/idempotent operations for ledger and redemption changes.
- Keep audit events for parent corrections, awards, adjustments, approvals, and rejections.
- Before enabling recordings, make them opt-in, private by default, retention-limited, downloadable/deletable by a parent, and separate from audio classification.
- Review logs and error reporting so child names, practice details, and audio are not unnecessarily exposed.
