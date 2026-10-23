const EVENT_LOG_VERSION = 1;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function packSessionEvents(session) {
  if (!session || session.eventLog?.v === EVENT_LOG_VERSION
    || !Array.isArray(session.events) || session.events.length === 0) return session;

  const states = [];
  const reasons = [];
  const stateIndexes = new Map();
  const reasonIndexes = new Map();

  for (const event of session.events) {
    if (hasOwn(event, 'state') && !stateIndexes.has(event.state)) {
      stateIndexes.set(event.state, states.length);
      states.push(event.state);
    }
    if (hasOwn(event, 'reason') && !reasonIndexes.has(event.reason)) {
      reasonIndexes.set(event.reason, reasons.length);
      reasons.push(event.reason);
    }
  }

  const rows = session.events.map((event) => [
    hasOwn(event, 'at') ? event.at : null,
    hasOwn(event, 'state') ? stateIndexes.get(event.state) : -1,
    hasOwn(event, 'reason') ? reasonIndexes.get(event.reason) : -1,
    Object.fromEntries(Object.entries(event).filter(([key]) => !['at', 'state', 'reason'].includes(key))),
  ]);

  return {
    ...session,
    events: [],
    eventLog: { v: EVENT_LOG_VERSION, states, reasons, rows },
  };
}

function unpackSessionEvents(session) {
  const log = session?.eventLog;
  if (log?.v !== EVENT_LOG_VERSION || !Array.isArray(log.rows)
    || (Array.isArray(session.events) && session.events.length > 0)) return session;

  const events = log.rows.map(([at, stateIndex, reasonIndex, extra]) => {
    const event = { at };
    if (Number.isInteger(stateIndex) && stateIndex >= 0) event.state = log.states[stateIndex];
    if (Number.isInteger(reasonIndex) && reasonIndex >= 0) event.reason = log.reasons[reasonIndex];
    return Object.assign(event, extra || {});
  });
  const { eventLog, ...rest } = session;
  return { ...rest, events };
}

// Store the repetitive detector timeline fields once per session. The full event
// objects are restored before the app renders or applies business rules.
export function packCloudState(state) {
  if (!state || !Array.isArray(state.sessions)) return state;
  const sessions = state.sessions.map(packSessionEvents);
  return sessions.some((session, index) => session !== state.sessions[index])
    ? { ...state, sessions }
    : state;
}

export function unpackCloudState(state) {
  if (!state || !Array.isArray(state.sessions)) return state;
  const sessions = state.sessions.map(unpackSessionEvents);
  return sessions.some((session, index) => session !== state.sessions[index])
    ? { ...state, sessions }
    : state;
}

export function hasLegacyCloudEvents(state) {
  return (state?.sessions || []).some((session) =>
    Array.isArray(session.events) && session.events.length > 0 && session.eventLog?.v !== EVENT_LOG_VERSION);
}
