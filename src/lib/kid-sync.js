import { recoverInterruptedSession } from './piano-state.js';

const correctionAt = (session) => (session.events || []).filter((event) => event.state === 'manual_correction')
  .reduce((latest, event) => Math.max(latest, Date.parse(event.correctedAt || '') || 0), session.eventArchive?.lastCorrectionAt || 0);

// Keep server-owned settings, awards and corrections while recovering offline practice.
export function mergeKidActivity(remote, local) {
  const ids = new Set(remote.children.map((child) => child.id));
  const sessions = new Map((remote.sessions || []).map((session) => [session.id, session]));
  let changed = false;
  for (const session of local?.sessions || []) {
    const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt);
    if (!ids.has(session.childId) || !/^[0-9a-f-]{36}$/i.test(session.id || '')
      || !['complete', 'interrupted'].includes(session.status) || !/^\d{4}-\d{2}-\d{2}$/.test(session.date || '')
      || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 24 * 60 * 60_000
      || !Number.isFinite(session.creditedMs) || session.creditedMs < 0 || session.creditedMs > end - start
      || !Array.isArray(session.events) || session.events.length > 20_000) continue;
    const existing = sessions.get(session.id);
    if (!existing || (correctionAt(existing) === 0
      && ((session.status === 'complete' && existing.status === 'interrupted')
        || (session.goalCelebrated === true && existing.goalCelebrated !== true)))) {
      sessions.set(session.id, existing?.recording && !session.recording ? { ...session, recording: existing.recording } : session);
      changed = true;
    }
  }
  const redemptions = new Map((remote.redemptions || []).map((item) => [item.id, item]));
  const rewards = new Set(remote.rewards.filter((reward) => reward.enabled).map((reward) => reward.id));
  for (const item of local?.redemptions || []) {
    const existing = redemptions.get(item.id);
    if ((!existing && item.status === 'pending' && ids.has(item.childId) && rewards.has(item.rewardId))
      || (existing?.status === 'pending' && item.status === 'cancelled')) {
      redemptions.set(item.id, item);
      changed = true;
    }
  }
  let currentSession = remote.currentSession;
  const localCurrent = local?.currentSession;
  if (localCurrent && ids.has(localCurrent.childId) && !sessions.has(localCurrent.id)) {
    if (!currentSession || (currentSession.id === localCurrent.id && localCurrent.elapsedMs >= currentSession.elapsedMs)) currentSession = localCurrent;
    else if (currentSession.id !== localCurrent.id) {
      // Preserve a second device's unsynced checkpoint instead of silently discarding it.
      sessions.set(localCurrent.id, recoverInterruptedSession(localCurrent));
      changed = true;
    }
  }
  if (currentSession && sessions.has(currentSession.id)) currentSession = null;
  if (JSON.stringify(currentSession) !== JSON.stringify(remote.currentSession)) changed = true;
  return { state: { ...remote, sessions: [...sessions.values()], redemptions: [...redemptions.values()], currentSession }, changed };
}
