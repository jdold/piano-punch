# Testing

## Automated checks

Run:

```sh
npm test
npm run build
```

Timer tests cover provisional grace accounting and inactive-time exclusion. Rewards tests cover stable award keys and redemption state changes. Expand coverage whenever those rules change; server-side flows still need integration tests after D1 is connected.

## Piano and browser test plan

Use the target iPhone and Safari. For every test, compare the session elapsed time, credited active time, live status, and parent timeline.

| Scenario | Expected result |
| --- | --- |
| Start a session and wait before playing | Elapsed time grows; credited time stays at zero |
| Play continuously | Credited time follows detected playing |
| Pause briefly, then resume within threshold | The short pause is provisionally credited when playing resumes |
| Stop longer than the configured threshold | The entire idle interval, including the initial grace window, is excluded |
| Lose microphone permission or audio context | State becomes unavailable and no further time is credited |
| Lock/background the phone or receive a call | Credit stops while classification cannot run; recovery is visible and reviewable |
| Punch out during a short unresolved pause | Unresolved provisional time is excluded |
| Speech, TV, recorded piano, and another pitched instrument | Record false positives and missed piano activity; do not assume a passing UI test validates classification |
| Slow scales and pauses between phrases | Confirm the configured threshold matches how the children practice |

Repeat with both the acoustic piano and digital piano. Record environment, phone placement, and classifier settings when reporting results. Do not upload sample audio to third-party services.
