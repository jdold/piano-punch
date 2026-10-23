export const ACTIVE_SESSION_REFRESH_INTERVAL_MS = 10_000;
export const IDLE_REFRESH_INTERVAL_MS = 120_000;
export const ACTIVE_SESSION_CLOUD_SYNC_INTERVAL_MS = 5_000;

export function cloudRefreshIntervalMs(state) {
  return state?.currentSession ? ACTIVE_SESSION_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
}
