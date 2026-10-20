import { DEFAULT_RULES, evaluateDay, reconcileDayAwards, addAward, addAdjustment, confirmLesson, requestRedemption, resolveRedemption, ledgerBalance } from './rewards.js';

export const STORAGE_KEY = 'piano-punch:v1';

export const PROFILE_THEMES = {
  orange: { label: 'Orange', symbol: '●' },
  blue: { label: 'Blue', symbol: '●' },
  yellow: { label: 'Yellow', symbol: '●' },
  green: { label: 'Green', symbol: '●' },
  purple: { label: 'Purple', symbol: '●' },
  pink: { label: 'Pink', symbol: '●' },
};

function defaultProfileTheme(id) {
  return id === 'son' ? 'orange' : id === 'emma' ? 'blue' : id === 'daughter' ? 'yellow' : 'green';
}

export const INSTRUMENT_PRESETS = {
  acoustic_piano: { label: 'Acoustic piano', detector: { minVolume: 0.003, minFrequencyHz: 55, maxFrequencyHz: 1400, minHarmonicity: 0.25, confidence: 0.72 } },
  digital_keyboard: { label: 'Digital keyboard', detector: { minVolume: 0.0025, minFrequencyHz: 55, maxFrequencyHz: 1500, minHarmonicity: 0.23, confidence: 0.70 } },
  cello: { label: 'Cello', detector: { minVolume: 0.0025, minFrequencyHz: 60, maxFrequencyHz: 1000, minHarmonicity: 0.22, confidence: 0.68 } },
  other: { label: 'Other instrument', detector: { minVolume: 0.003, minFrequencyHz: 55, maxFrequencyHz: 1400, minHarmonicity: 0.25, confidence: 0.72 } },
};

function childProfile(id, name, instrumentType) {
  return { id, name, theme: defaultProfileTheme(id), goalMinutes: 20, inactivitySeconds: 20, requiredWeekdays: [1, 2, 3, 4, 5, 6], excusedDates: [], pointRules: structuredClone(DEFAULT_RULES), instrumentType, detector: structuredClone(INSTRUMENT_PRESETS[instrumentType].detector) };
}

export function initialState() {
  return {
    children: [
      childProfile('son', 'Gordon', 'digital_keyboard'),
      childProfile('daughter', 'Caroline', 'acoustic_piano'),
      childProfile('emma', 'Emma', 'cello'),
    ],
    sessions: [],
    lessonSessions: [],
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
  if (!Array.isArray(state.lessonSessions)) { state.lessonSessions = []; changed = true; }
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
    if (!PROFILE_THEMES[child.theme]) { child.theme = defaultProfileTheme(child.id); changed = true; }
  }
  return changed;
}

// Kid pages can repair fields on existing profiles, but must not introduce
// profiles locally that the server has not saved yet.
export function ensureKidProfiles(state) {
  const existingIds = new Set(state.children.map((child) => child.id));
  const changed = ensureFamilyProfiles(state);
  state.children = state.children.filter((child) => existingIds.has(child.id));
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

export function hasLessonForDay(state, childId, date) {
  return (state.lessonSessions || []).some((lesson) => lesson.childId === childId && lesson.date === date);
}

export function requiredPracticeDate(child, date) {
  return child.requiredWeekdays.includes(new Date(`${date}T12:00:00`).getDay()) && !child.excusedDates.includes(date);
}

export function completedDates(state, child) {
  const dates = [...new Set([
    ...state.sessions.filter((s) => s.childId === child.id && s.status === 'complete').map((s) => s.date),
    ...(state.lessonSessions || []).filter((lesson) => lesson.childId === child.id).map((lesson) => lesson.date),
  ])].sort();
  return dates.filter((date) => hasLessonForDay(state, child.id, date) || creditedMinutesForDay(state, child.id, date) >= child.goalMinutes);
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
    lessonCompleted: hasLessonForDay(state, childId, date),
    qualifyingRunDays: qualifyingRunDays ?? currentStreak(state, child, date),
  });
  state.ledger = result.ledger;
  return result;
}

export function reconcilePracticeDay(state, childId, date, correctionId) {
  const c = state.children.find((item) => item.id === childId);
  state.ledger = reconcileDayAwards({ childId, date, creditedMinutes: creditedMinutesForDay(state, childId, date), goalMinutes: c.goalMinutes, ledger: state.ledger, rules: c.pointRules, lessonCompleted: hasLessonForDay(state, childId, date), qualifyingRunDays: currentStreak(state, c, date), correctionId });
}

export function recalculateChildAwards(state, childId) {
  const dates=[...new Set([
    ...state.sessions.filter((s)=>s.childId===childId&&s.status==='complete').map((s)=>s.date),
    ...(state.lessonSessions||[]).filter((lesson)=>lesson.childId===childId).map((lesson)=>lesson.date),
  ])].sort();
  for(const date of dates){
    settlePracticeDay(state,childId,date);
    reconcilePracticeDay(state,childId,date,crypto.randomUUID());
  }
}

function lastManualCorrectionAt(session) {
  return (session.events || []).filter((event) => event.state === 'manual_correction').reduce((latest, event) => {
    const at = Date.parse(event.correctedAt || '');
    return Number.isFinite(at) && at > latest ? at : latest;
  }, 0);
}

export function mergeParentActivity(remote, local, baseline = null) {
  if (!local) return { state: remote, changed: false };
  let changed = false;
  const sessions = new Map((remote.sessions || []).map((session) => [session.id, session]));
  for (const session of local.sessions || []) {
    const existing = sessions.get(session.id);
    if (!existing) { sessions.set(session.id, session); changed = true; continue; }
    const localCorrection = lastManualCorrectionAt(session);
    const remoteCorrection = lastManualCorrectionAt(existing);
    if (localCorrection > remoteCorrection || (session.status === 'complete' && existing.status === 'interrupted')) {
      sessions.set(session.id, session);
      changed = true;
    }
  }
  const mergeById = (remoteRows, localRows, keyOf) => {
    const rows = new Map((remoteRows || []).map((row) => [keyOf(row), row]));
    for (const row of localRows || []) {
      const key = keyOf(row);
      const existing = rows.get(key);
      if (!existing) { rows.set(key, row); changed = true; }
      else if (row.status && existing.status === 'pending' && row.status !== 'pending') {
        rows.set(key, row);
        changed = true;
      }
    }
    return [...rows.values()];
  };
  const ledger = mergeById(remote.ledger, local.ledger, (row) => row.idempotencyKey || row.id);
  const lessonSessions = mergeById(remote.lessonSessions, local.lessonSessions, (row) => row.id);
  const redemptions = mergeById(remote.redemptions, local.redemptions, (row) => row.id);
  let children = remote.children || [];
  let rewards = remote.rewards || [];
  if (baseline) {
    const baselineChildren = new Map((baseline.children || []).map((child) => [child.id, child]));
    const localChildren = new Map((local.children || []).map((child) => [child.id, child]));
    children = children.map((remoteChild) => {
      const localChild = localChildren.get(remoteChild.id);
      const baselineChild = baselineChildren.get(remoteChild.id);
      if (!localChild || !baselineChild) return remoteChild;
      const mergedChild = { ...remoteChild };
      for (const [key, value] of Object.entries(localChild)) {
        if (JSON.stringify(value) !== JSON.stringify(baselineChild[key]) && JSON.stringify(value) !== JSON.stringify(remoteChild[key])) {
          mergedChild[key] = value;
          changed = true;
        }
      }
      return mergedChild;
    });
    const baselineRewards = new Map((baseline.rewards || []).map((reward) => [reward.id, reward]));
    const rewardMap = new Map(rewards.map((reward) => [reward.id, reward]));
    for (const localReward of local.rewards || []) {
      const baselineReward = baselineRewards.get(localReward.id);
      if (!baselineReward) {
        if (!rewardMap.has(localReward.id)) { rewardMap.set(localReward.id, localReward); changed = true; }
      } else if (JSON.stringify(localReward) !== JSON.stringify(baselineReward) && JSON.stringify(localReward) !== JSON.stringify(rewardMap.get(localReward.id))) {
        rewardMap.set(localReward.id, localReward);
        changed = true;
      }
    }
    rewards = [...rewardMap.values()];
  }
  return { state: { ...remote, children, rewards, sessions: [...sessions.values()], ledger, lessonSessions, redemptions }, changed };
}

export const points = { addAward, addAdjustment, confirmLesson, requestRedemption, resolveRedemption, ledgerBalance };
