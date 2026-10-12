export const DEFAULT_RULES = Object.freeze({
  dailyGoal: 10,
  lesson: 20,
  practiceDay: 1,
  extraMinutes: 1,
  extraEveryMinutes: 10,
  milestones: { 3: 5, 5: 10, 7: 20, 14: 40, 30: 100 },
});

export function ledgerBalance(ledger, childId) {
  return ledger.filter((row) => row.childId === childId).reduce((sum, row) => sum + row.points, 0);
}

/** Create deterministic awards; idempotencyKey is unique per source event/rule. */
export function addAward(ledger, { childId, points, type, sourceId, idempotencyKey, note = '' }, now = new Date().toISOString()) {
  if (!Number.isInteger(points) || points <= 0) throw new Error('Award points must be a positive integer');
  if (ledger.some((row) => row.idempotencyKey === idempotencyKey)) return { ledger, awarded: false };
  const row = { id: cryptoId(), childId, points, type, sourceId, idempotencyKey, note, createdAt: now };
  return { ledger: [...ledger, row], awarded: true, entry: row };
}

export function addAdjustment(ledger, { childId, points, note }, now = new Date().toISOString()) {
  const value = Math.trunc(Number(points));
  if (!Number.isFinite(value) || value === 0 || !note?.trim()) throw new Error('Enter a nonzero adjustment and reason');
  const row = { id: cryptoId(), childId, points: value, type: 'adjustment', sourceId: null, idempotencyKey: cryptoId(), note: note.trim(), createdAt: now };
  return [...ledger, row];
}

export function evaluateDay({ childId, date, creditedMinutes, goalMinutes, ledger, rules = DEFAULT_RULES, qualifyingRunDays = 0 }) {
  let next = ledger;
  const completed = creditedMinutes >= goalMinutes;
  if (completed) {
    if (rules.dailyGoal > 0) next = addAward(next, { childId, points: rules.dailyGoal, type: 'daily_goal', sourceId: date, idempotencyKey: `daily_goal:${childId}:${date}` }).ledger;
    if (rules.practiceDay > 0) next = addAward(next, { childId, points: rules.practiceDay, type: 'practice_day', sourceId: date, idempotencyKey: `practice_day:${childId}:${date}` }).ledger;
    for (const [milestone, points] of Object.entries(rules.milestones)) {
      if (points > 0 && qualifyingRunDays === Number(milestone)) {
        next = addAward(next, { childId, points, type: 'streak_milestone', sourceId: date, idempotencyKey: `streak:${childId}:${date}:${milestone}` }).ledger;
      }
    }
  }
  const interval = Math.max(1, Number(rules.extraEveryMinutes) || 10);
  const extraUnits = Math.floor(Math.max(0, creditedMinutes - goalMinutes) / interval);
  for (let unit = 1; unit <= extraUnits; unit++) {
    if (rules.extraMinutes > 0) next = addAward(next, { childId, points: rules.extraMinutes, type: 'extra_minutes', sourceId: date, idempotencyKey: `extra:${childId}:${date}:${unit}` }).ledger;
  }
  return { ledger: next, completed };
}

/** Append reversals/reinstatements when a parent edits verified historical time. */
export function reconcileDayAwards({ childId, date, creditedMinutes, goalMinutes, ledger, rules = DEFAULT_RULES, qualifyingRunDays = 0, correctionId }) {
  const expected = new Set(evaluateDay({ childId, date, creditedMinutes, goalMinutes, ledger: [], rules, qualifyingRunDays }).ledger.map((row) => row.idempotencyKey));
  const autoTypes = new Set(['daily_goal','practice_day','streak_milestone','extra_minutes']);
  let next = [...ledger];
  for (const original of ledger.filter((row) => row.childId === childId && autoTypes.has(row.type) && !row.reversesLedgerId)) {
    const reversals = next.filter((row) => row.reversesLedgerId === original.id).reduce((sum, row) => sum + row.points, 0);
    const currentlyActive = original.points + reversals > 0;
    const shouldBeActive = expected.has(original.idempotencyKey);
    if (shouldBeActive === currentlyActive) continue;
    const delta = shouldBeActive ? original.points : -original.points;
    next.push({ id: cryptoId(), childId, points: delta, type: shouldBeActive ? 'award_reinstatement' : 'award_reversal', sourceId: original.sourceId, idempotencyKey: `${shouldBeActive ? 'reinstate' : 'reverse'}:${original.id}:${correctionId}`, reversesLedgerId: original.id, note: `${shouldBeActive ? 'Restored' : 'Reversed'} ${original.type} after session correction`, createdAt: new Date().toISOString() });
  }
  return next;
}

export function confirmLesson(ledger, { childId, lessonDate, points }, now = new Date().toISOString()) {
  const date = new Date(`${lessonDate}T12:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  const weekStart = date.toISOString().slice(0, 10);
  return addAward(ledger, { childId, points, type: 'lesson', sourceId: weekStart, idempotencyKey: `lesson:${childId}:${weekStart}` }, now);
}

export function requestRedemption(redemptions, ledger, { childId, rewardId, cost }, now = new Date().toISOString()) {
  if (!Number.isInteger(cost) || cost <= 0) throw new Error('Reward cost must be a positive integer');
  const reserved = redemptions.filter((r) => r.childId === childId && r.status === 'pending').reduce((n, r) => n + r.cost, 0);
  if (ledgerBalance(ledger, childId) - reserved < cost) throw new Error('Not enough available points');
  const row = { id: cryptoId(), childId, rewardId, cost, status: 'pending', createdAt: now, resolvedAt: null };
  return { redemptions: [...redemptions, row], request: row };
}

export function resolveRedemption(redemptions, ledger, requestId, action, now = new Date().toISOString()) {
  const request = redemptions.find((r) => r.id === requestId);
  if (!request || request.status !== 'pending') throw new Error('Redemption is not pending');
  if (!['approved', 'rejected', 'cancelled'].includes(action)) throw new Error('Invalid redemption action');
  const updated = redemptions.map((r) => r.id === requestId ? { ...r, status: action, resolvedAt: now } : r);
  if (action !== 'approved') return { redemptions: updated, ledger };
  const reservedForOthers = redemptions.filter((r) => r.childId === request.childId && r.id !== requestId && r.status === 'pending').reduce((sum, r) => sum + r.cost, 0);
  if (ledgerBalance(ledger, request.childId) - reservedForOthers < request.cost) throw new Error('Not enough available points to approve this request');
  const debit = { id: cryptoId(), childId: request.childId, points: -request.cost, type: 'redemption', sourceId: request.id, idempotencyKey: `redemption:${request.id}`, note: `Reward ${request.rewardId}`, createdAt: now };
  if (ledger.some((row) => row.idempotencyKey === debit.idempotencyKey)) throw new Error('Redemption already charged');
  return { redemptions: updated, ledger: [...ledger, debit] };
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
