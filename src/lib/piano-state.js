import { DEFAULT_RULES, evaluateDay, reconcileDayAwards, addAward, addAdjustment, confirmLesson, requestRedemption, resolveRedemption, ledgerBalance } from './rewards.js';

export const STORAGE_KEY = 'piano-punch:v1';

export const INSTRUMENT_PRESETS = {
  acoustic_piano: { label: 'Acoustic piano', detector: { minVolume: 0.003, minFrequencyHz: 55, maxFrequencyHz: 1400, minHarmonicity: 0.25, confidence: 0.72 } },
  digital_keyboard: { label: 'Digital keyboard', detector: { minVolume: 0.0025, minFrequencyHz: 55, maxFrequencyHz: 1500, minHarmonicity: 0.23, confidence: 0.70 } },
  cello: { label: 'Cello', detector: { minVolume: 0.0025, minFrequencyHz: 60, maxFrequencyHz: 1000, minHarmonicity: 0.22, confidence: 0.68 } },
  other: { label: 'Other instrument', detector: { minVolume: 0.003, minFrequencyHz: 55, maxFrequencyHz: 1400, minHarmonicity: 0.25, confidence: 0.72 } },
};

function childProfile(id, name, instrumentType) {
  return { id, name, goalMinutes: 20, inactivitySeconds: 20, requiredWeekdays: [1, 2, 3, 4, 5, 6], excusedDates: [], pointRules: structuredClone(DEFAULT_RULES), instrumentType, detector: structuredClone(INSTRUMENT_PRESETS[instrumentType].detector) };
}

export function initialState() {
  return {
    children: [
      childProfile('son', 'Gordon', 'digital_keyboard'),
      childProfile('daughter', 'Caroline', 'acoustic_piano'),
      childProfile('emma', 'Emma', 'cello'),
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

export function ensureFamilyProfiles(state) {
  let changed = false;
  const defaults = initialState().children;
  for (const profile of defaults) {
    if (!state.children.some((child) => child.id === profile.id)) {
      state.children.push(profile);
      changed = true;
    }
  }
  for (const child of state.children) {
    const inferred = child.id === 'daughter' ? 'acoustic_piano' : child.id === 'emma' ? 'cello' : 'digital_keyboard';
    if (!INSTRUMENT_PRESETS[child.instrumentType]) { child.instrumentType = inferred; changed = true; }
    if (!child.detector) { child.detector = structuredClone(INSTRUMENT_PRESETS[child.instrumentType].detector); changed = true; }
    if (!child.excusedDates) { child.excusedDates = []; changed = true; }
    if (!child.pointRules) { child.pointRules = structuredClone(DEFAULT_RULES); changed = true; }
  }
  return changed;
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

export function settlePracticeDay(state, childId, date = dayKey(), additionalActiveMs = 0, qualifyingRunDays = undefined) {
  const child = state.children.find((c) => c.id === childId);
  const recordedMs = childSessionsForDay(state, childId, date).reduce((sum, session) => sum + session.creditedMs, 0);
  const mins = Math.floor((recordedMs + Math.max(0, additionalActiveMs)) / 60_000);
  const result = evaluateDay({
    childId,
    date,
    creditedMinutes: mins,
    goalMinutes: child.goalMinutes,
    ledger: state.ledger,
    rules: child.pointRules,
    qualifyingRunDays: qualifyingRunDays ?? currentStreak(state, child, date),
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
