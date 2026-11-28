export const LOCAL_SESSION_CHECKPOINT_INTERVAL_MS = 5_000;
export const ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS = 30_000;
export const IDLE_REFRESH_INTERVAL_MS = 60 * 60_000;

export function shouldRefreshCloud({ hidden, active, pending, lastReadAt, now, force = false }) {
  return !hidden && !active && !pending && (force || now - lastReadAt >= 60_000);
}
