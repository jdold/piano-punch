import { DEFAULT_RULES, evaluateDay, reconcileDayAwards, addAward, addAdjustment, confirmLesson, requestRedemption, resolveRedemption, ledgerBalance } from './rewards.js';

export const STORAGE_KEY = 'piano-punch:v1';

export function initialState() {
  return {
    children: [
      { id: 'son', name: 'Gordon', goalMinutes: 20, inactivitySeconds: 20, requiredWeekdays: [1, 2, 3, 4, 5, 6], excusedDates: [], pointRules: structuredClone(DEFAULT_RULES) },
      { id: 'daughter', name: 'Caroline', goalMinutes: 20, inactivitySeconds: 20, requiredWeekdays: [1, 2, 3, 4, 5, 6], excusedDates: [], pointRules: structuredClone(DEFAULT_RULES) },
    ],
    sessions: [],
    ledger: [],
    rewards: [
      { id: 'movie-night', name: 'Choose family movie', description: 'Pick the movie for family night.', cost: 120, enabled: true },
      { id: 'dessert', name: 'Choose dessert', description: 'Pick a dessert for everyone.', cost: 80, enabled: true },
    ],
    redemptions: [],
    currentSession: null,
    parentMode: false,
  };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    return saved?.children?.length ? { ...initialState(), ...saved } : initialState();
  } catch {
    return initialState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function childSessionsForDay(state, childId, date) {
  return state.sessions.filter((s) => s.childId === childId && s.date === date && s.status === 'complete');
}

export function creditedMinutesForDay(state, childId, date) {
  return Math.floor(childSessionsForDay(state, childId, date).reduce((sum, s) => sum + s.creditedMs, 0) / 60_000);
}

export function requiredPracticeDate(child, date) {
  return child.requiredWeekdays.includes(new Date(`${date}T12:00:00`).getDay()) && !child.excusedDates.includes(date);
}

export function completedDates(state, child) {
  const dates = [...new Set(state.sessions.filter((s) => s.childId === child.id && s.status === 'complete').map((s) => s.date))].sort();
  return dates.filter((date) => creditedMinutesForDay(state, child.id, date) >= child.goalMinutes);
}

export function currentStreak(state, child, today = dayKey()) {
  const done = new Set(completedDates(state, child));
  let streak = 0;
  const cursor = new Date(`${today}T12:00:00`);
  // If today's requirement is not completed yet, count the run through yesterday.
  if (requiredPracticeDate(child, today) && !done.has(today)) cursor.setDate(cursor.getDate() - 1);
  for (let guard = 0; guard < 370; guard++) {
    const key = dayKey(cursor);
    if (requiredPracticeDate(child, key)) {
      if (!done.has(key)) break;
      streak += 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function settlePracticeDay(state, childId, date = dayKey()) {
  const child = state.children.find((c) => c.id === childId);
  const mins = creditedMinutesForDay(state, childId, date);
  const result = evaluateDay({
    childId,
    date,
    creditedMinutes: mins,
    goalMinutes: child.goalMinutes,
    ledger: state.ledger,
    rules: child.pointRules,
    qualifyingRunDays: currentStreak(state, child, date),
  });
  state.ledger = result.ledger;
  return result;
}

export function reconcilePracticeDay(state, childId, date, correctionId) {
  const c = state.children.find((item) => item.id === childId);
  state.ledger = reconcileDayAwards({ childId, date, creditedMinutes: creditedMinutesForDay(state, childId, date), goalMinutes: c.goalMinutes, ledger: state.ledger, rules: c.pointRules, qualifyingRunDays: currentStreak(state, c, date), correctionId });
}

export function recalculateChildAwards(state, childId) {
  const dates=[...new Set(state.sessions.filter((s)=>s.childId===childId&&s.status==='complete').map((s)=>s.date))].sort();
  for(const date of dates){
    settlePracticeDay(state,childId,date);
    reconcilePracticeDay(state,childId,date,crypto.randomUUID());
  }
}

export const points = { addAward, addAdjustment, confirmLesson, requestRedemption, resolveRedemption, ledgerBalance };
