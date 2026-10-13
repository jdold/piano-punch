import { SmartTimer, TIMER_STATES } from './smart-timer.js';
import { requestMicrophone, microphoneErrorMessage } from './microphone.js';
import { analyzePianoFrame, PianoEvidenceGate } from '../audio/classifier.js';
import { loadState, saveState, dayKey, creditedMinutesForDay, settlePracticeDay, reconcilePracticeDay, recalculateChildAwards, currentStreak, requiredPracticeDate, points, INSTRUMENT_PRESETS, ensureFamilyProfiles } from './piano-state.js';

let state = loadState();
let selectedChild = state.children[0].id;
let timer = null;
let audio = null;
let ticker = null;
let clockBase = 0;
let lastAudioFrameAt = 0;
let startIso = null;
let microphoneStatus = 'idle';
let wakeLock = null;
let wakeLockStatus = 'inactive';
let calibrationAudio = null;
let calibrationGate = null;
let audioSuppressed = false;
let cloudRevision = 0;
let cloudReady = false;
let cloudConflict = false;
let cloudSyncTimer = null;
let cloudSyncChain = Promise.resolve();
const $ = (selector) => document.querySelector(selector);
const fmt = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDateTimeValue = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function persist() { saveState(state); queueCloudSync(); render(); }

function queueCloudSync() {
  if (!cloudReady || cloudConflict) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    const snapshot = structuredClone(state);
    cloudSyncChain = cloudSyncChain.then(async () => {
      const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: snapshot, revision: cloudRevision }) });
      if (response.status === 409) { cloudConflict = true; $('#cloud-status').textContent = 'Sync conflict — reload'; return; }
      if (!response.ok) throw new Error(`Cloud sync failed (${response.status})`);
      cloudRevision = (await response.json()).revision;
      $('#cloud-status').textContent = 'Synced';
    }).catch(() => { $('#cloud-status').textContent = 'Offline — saved here'; });
  }, 400);
}

async function hydrateCloudState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error('Cloud state unavailable');
    const remote = await response.json();
    cloudRevision = remote.revision || 0;
    if (remote.state) {
      state = remote.state;
    } else {
      const local = JSON.parse(localStorage.getItem('piano-punch:v1') || 'null');
      if (local?.children?.length) state = { ...state, ...local };
    }
    const migrated = ensureFamilyProfiles(state);
    saveState(state);
    cloudReady = true;
    $('#cloud-status').textContent = remote.state ? 'Synced' : 'Saving…';
    if (!remote.state || migrated) queueCloudSync();
  } catch {
    ensureFamilyProfiles(state);
    saveState(state);
    $('#cloud-status').textContent = 'Offline — saved here';
  }
}
function child() { return state.children.find((c) => c.id === selectedChild); }
function sessionElapsed() { return timer?.snapshot(performance.now() - clockBase).elapsedMs || 0; }
function activeInfo() { return timer?.snapshot(performance.now() - clockBase) || { state: 'ready', activeMs: 0, provisionalMs: 0, elapsedMs: 0, events: [] }; }

function render() {
  const c = child();
  const today = dayKey();
  const activeMinutes = creditedMinutesForDay(state, c.id, today);
  const goal = c.goalMinutes;
  const percent = Math.min(100, Math.round(activeMinutes / Math.max(1, goal) * 100));
  const current = activeInfo();
  $('#child-picker').innerHTML = state.children.map((item) => `<button class="child-chip ${item.id === selectedChild ? 'selected' : ''}" data-child="${item.id}">${escapeHtml(item.name)}</button>`).join('');
  $('#child-label').textContent = c.name;
  $('#goal-label').textContent = `${activeMinutes} / ${goal} min today`;
  $('#goal-ring').style.setProperty('--progress', `${percent}%`);
  $('#goal-ring-value').textContent = `${percent}%`;
  $('#today-active').textContent = fmt(activeMinutes * 60_000);
  $('#streak-count').textContent = `${currentStreak(state, c)} day${currentStreak(state, c) === 1 ? '' : 's'}`;
  const reservedPoints=state.redemptions.filter((x)=>x.childId===c.id&&x.status==='pending').reduce((n,x)=>n+x.cost,0);
  $('#point-total').textContent = Math.max(0,points.ledgerBalance(state.ledger, c.id)-reservedPoints);
  const earnedTypes=new Set(['daily_goal','practice_day','streak_milestone','extra_minutes','lesson','special_achievement','award_reinstatement','award_reversal']);
  $('#points-earned').textContent = `${state.ledger.filter((x) => x.childId === c.id && earnedTypes.has(x.type)).reduce((n,x)=>n+x.points,0)} earned`;
  $('#badges').innerHTML=[3,5,7,14,30].filter((n)=>currentStreak(state,c)>=n).map((n)=>`<span class="badge">${n} day badge</span>`).join('');
  $('#session-elapsed').textContent = fmt(current.elapsedMs);
  const livePlayingMs = state.currentSession?.childId === c.id ? current.activeMs + current.provisionalMs : 0;
  $('#session-active').textContent = fmt(livePlayingMs);
  $('#session-remaining').textContent = fmt(Math.max(0, goal * 60_000 - activeMinutes * 60_000 - livePlayingMs));
  $('#session-credit-note').textContent = current.provisionalMs ? `${fmt(current.provisionalMs)} provisional` : 'Verified active time';
  $('#screen-status').textContent = wakeLockStatus === 'active' ? 'Screen staying on' : state.currentSession ? 'Keep this page open' : '';
  const displayState = state.currentSession && microphoneStatus === 'starting' ? 'starting' : current.state;
  $('#live-state').textContent = stateLabel(displayState);
  $('#live-state').dataset.state = displayState;
  $('#session-heading').textContent = !state.currentSession ? 'Ready when you are' : displayState === 'starting' ? 'Starting your session' : 'Practice session';
  $('#session-hint').textContent = state.currentSession
    ? 'This session stays open until you punch out. Active time counts only while piano is detected.'
    : 'The microphone stays off until your child punches in.';
  $('#punch-in').hidden = Boolean(state.currentSession);
  $('#punch-out').hidden = !state.currentSession;
  // Punch-out is always available during an open session, even with live audio.
  $('#punch-out').disabled = false;
  $('#session-detail').hidden = !state.currentSession;
  $('#goal-celebration').hidden = !state.currentSession?.goalCelebrated;
  const bonusStep = Math.max(1, Number(c.pointRules.extraEveryMinutes) || 10);
  $('#celebration-bonus').textContent = `${c.pointRules.extraMinutes || 0} bonus point${c.pointRules.extraMinutes === 1 ? '' : 's'} for every ${bonusStep} extra playing minute${bonusStep === 1 ? '' : 's'}.`;
  $('#reward-progress').innerHTML = state.rewards.filter((r) => r.enabled).map((r) => {
    const pending = state.redemptions.filter((x) => x.childId === c.id && x.status === 'pending').reduce((n,x)=>n+x.cost,0);
    const available = points.ledgerBalance(state.ledger, c.id) - pending;
    const pct = Math.min(100, Math.floor(available / Math.max(1,r.cost) * 100));
    const pendingRequest=state.redemptions.find((x)=>x.childId===c.id&&x.rewardId===r.id&&x.status==='pending');
    return `<article class="reward-card">${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="reward-image" />` : ''}<div><strong>${escapeHtml(r.name)}</strong><p>${escapeHtml(r.description || '')}${r.restrictions ? ` · ${escapeHtml(r.restrictions)}` : ''}</p></div><div class="reward-cost">${r.cost} pts</div><div class="mini-track"><span style="width:${pct}%"></span></div><small>${available} / ${r.cost} points ${available >= r.cost ? '· Ready to request' : '· Keep going'}</small>${pendingRequest?`<button class="request-reward" data-cancel="${pendingRequest.id}">Request pending · cancel</button>`:`<button class="request-reward" data-reward="${r.id}" ${available < r.cost ? 'disabled' : ''}>Request reward</button>`}</article>`;
  }).join('') || '<p class="muted">Your parent can add a reward.</p>';
  const historyHtml = state.sessions.filter((s) => s.childId === c.id).slice().reverse().slice(0,8).map((s) => `<li><span>${new Date(`${s.date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${new Date(s.startedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}${s.recording ? `<span class="kid-playback"><small>Listen to your practice · full session</small><audio controls preload="none" src="/api/recordings/${s.id}" aria-label="Listen to your practice from ${s.date}"></audio></span>` : ''}</span><strong>${fmt(s.creditedMs)} playing</strong></li>`).join('') || '<li class="muted">Your first session will appear here.</li>';
  // Avoid replacing audio controls on each live timer tick; playback should continue uninterrupted.
  if ($('#history-list').innerHTML !== historyHtml) $('#history-list').innerHTML = historyHtml;
  $('#parent-dashboard').hidden = !state.parentMode;
  if (state.parentMode) {
    renderParent();
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) fillSettings(c);
  }
  $('#pending-count').textContent = state.redemptions.filter((x) => x.status === 'pending').length;
  const ringProgress = Math.min(100, (activeMinutes * 60_000 + livePlayingMs) / Math.max(1, c.goalMinutes * 60_000) * 100);
  $('#live-ring').style.setProperty('--progress', `${ringProgress}%`);
}

function stateLabel(value) {
  return ({ ready: 'Ready', starting: 'Starting mic…', listening: 'Listening', playing: 'Playing', grace: 'Grace period', paused: 'Paused', unavailable: 'Microphone unavailable', ended: 'Session complete' })[value] || 'Ready';
}

function renderParent() {
  $('#parent-children').innerHTML = state.children.map((c) => {
    const date = dayKey(); const mins = creditedMinutesForDay(state,c.id,date);
    return `<article class="child-admin"><div><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(INSTRUMENT_PRESETS[c.instrumentType]?.label || 'Instrument')} · Today ${mins}/${c.goalMinutes} min · ${currentStreak(state,c)} day streak · ${points.ledgerBalance(state.ledger,c.id)} points</small></div><button data-lesson="${c.id}" class="small-button">Confirm lesson</button></article>`;
  }).join('');
  $('#redemption-list').innerHTML = state.redemptions.filter((x) => x.status === 'pending').map((r) => {
    const c = state.children.find((it) => it.id === r.childId); const reward = state.rewards.find((it) => it.id === r.rewardId);
    return `<article class="child-admin"><div><strong>${escapeHtml(c?.name || 'Child')} · ${escapeHtml(reward?.name || 'Reward')}</strong><small>${r.cost} points · requested ${new Date(r.createdAt).toLocaleDateString()}</small></div><div class="actions"><button class="small-button approve" data-approve="${r.id}">Approve</button><button class="small-button reject" data-reject="${r.id}">Reject</button></div></article>`;
  }).join('') || '<p class="muted">No pending requests.</p>';
  $('#ledger-list').innerHTML = state.ledger.filter((x) => x.childId === selectedChild).slice().reverse().slice(0,8).map((x) => `<li><span>${escapeHtml(x.note || x.type.replaceAll('_',' '))}</span><strong class="${x.points < 0 ? 'negative' : ''}">${x.points > 0 ? '+' : ''}${x.points} pts</strong></li>`).join('') || '<li class="muted">No points yet.</li>';
  $('#reward-admin-list').innerHTML = state.rewards.map((r) => `<article class="child-admin"><div><strong>${escapeHtml(r.name)}</strong><small>${r.cost} points · ${r.enabled ? 'Available' : 'Hidden'}</small></div><div class="actions"><button class="small-button" data-edit-reward="${r.id}">Edit</button><button class="small-button" data-toggle-reward="${r.id}">${r.enabled ? 'Disable' : 'Enable'}</button></div></article>`).join('');
  $('#excused-list').innerHTML = child().excusedDates.map((date) => `<article class="child-admin"><div><strong>${date}</strong><small>Excused / rest day</small></div><button class="small-button" data-unexcuse="${date}">Remove</button></article>`).join('') || '<p class="muted">No excused days saved.</p>';
  $('#session-audit-list').innerHTML = state.sessions.filter((s) => s.childId === selectedChild).slice().reverse().slice(0,8).map((s) => {
    const time = (ms) => `${Math.floor(Math.max(0,ms)/60000)}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
    const startedAt = s.startedAt || new Date().toISOString();
    const endedAt = s.endedAt || new Date(new Date(startedAt).getTime() + Math.max(0, s.elapsedMs || 0)).toISOString();
    const timeline = (s.events || []).map((e) => `<li><span>${time(e.at)} · ${escapeHtml(e.state)} · ${escapeHtml(e.reason)}</span><small>${typeof e.confidence === 'number' ? `${Math.round(e.confidence*100)}% confidence` : ''}</small></li>`).join('');
    return `<details class="timeline-row"><summary><strong>${s.date}</strong> · ${time(s.creditedMs)} credited · ${escapeHtml(s.status)}</summary>${s.status==='interrupted'?`<button class="small-button" data-review-session="${s.id}">Approve verified time</button>`:''}<button class="small-button" data-correct-session="${s.id}">Edit session punches</button>${s.recording?`<div class="recording-audit"><p>Private recording · ${Math.max(1,Math.round(s.recording.size/1024))} KB</p><audio controls preload="none" src="/api/recordings/${s.id}"></audio><button class="small-button" data-delete-recording="${s.id}">Delete recording</button></div>`:''}<div class="session-edit-form" data-session-form="${s.id}" hidden><label>Start <input type="datetime-local" data-session-start required value="${localDateTimeValue(startedAt)}" /></label><label>End <input type="datetime-local" data-session-end required value="${localDateTimeValue(endedAt)}" /></label><label>Credited active minutes <input type="number" min="0" step="0.1" data-session-active required value="${(Math.max(0,s.creditedMs)/60_000).toFixed(1)}" /></label><label>Reason <input type="text" data-session-reason required placeholder="Why are you correcting this?" /></label><button class="small-button" type="button" data-save-session="${s.id}">Save correction</button></div><ul>${timeline || '<li>No detector transitions recorded.</li>'}</ul>${s.correctionMs ? `<small>Manual adjustment: ${s.correctionMs>0?'+':'−'}${time(Math.abs(s.correctionMs))} · ${escapeHtml(s.correctionReason || '')}</small>` : ''}</details>`;
  }).join('') || '<p class="muted">No sessions to review.</p>';
}

function fillSettings(c) {
  $('#goal-input').value = c.goalMinutes;
  $('#threshold-input').value = c.inactivitySeconds;
  $('#recording-enabled').checked = Boolean(c.recordingEnabled);
  $('#daily-points').value = c.pointRules.dailyGoal;
  $('#lesson-points').value = c.pointRules.lesson;
  $('#practice-points').value = c.pointRules.practiceDay;
  $('#extra-step').value = c.pointRules.extraEveryMinutes;
  $('#extra-points').value = c.pointRules.extraMinutes;
  for (const day of [3,5,7,14,30]) $(`#milestone-${day}`).value = c.pointRules.milestones[day] ?? 0;
  document.querySelectorAll('.weekday-check').forEach((input) => { input.checked = c.requiredWeekdays.includes(Number(input.value)); });
  fillDetectorSettings(c);
}

function fillDetectorSettings(c, usePreset = false) {
  if (usePreset) c.detector = structuredClone(INSTRUMENT_PRESETS[c.instrumentType].detector);
  const detector = c.detector || INSTRUMENT_PRESETS[child().instrumentType].detector;
  $('#instrument-input').value = c.instrumentType;
  $('#mic-volume').value = detector.minVolume;
  $('#pitch-low').value = detector.minFrequencyHz;
  $('#pitch-high').value = detector.maxFrequencyHz;
  $('#harmonicity').value = detector.minHarmonicity;
  $('#confidence').value = detector.confidence;
  updateDetectorReadouts();
}

function readDetectorControls() {
  const c = child();
  c.instrumentType = $('#instrument-input').value;
  c.detector = {
    minVolume: Number($('#mic-volume').value),
    minFrequencyHz: Number($('#pitch-low').value),
    maxFrequencyHz: Number($('#pitch-high').value),
    minHarmonicity: Number($('#harmonicity').value),
    confidence: Number($('#confidence').value),
  };
  updateDetectorReadouts();
}

function updateDetectorReadouts() {
  $('#mic-volume-value').textContent = Number($('#mic-volume').value).toFixed(4);
  $('#pitch-low-value').textContent = `${$('#pitch-low').value} Hz`;
  $('#pitch-high-value').textContent = `${$('#pitch-high').value} Hz`;
  $('#harmonicity-value').textContent = Number($('#harmonicity').value).toFixed(2);
  $('#confidence-value').textContent = Number($('#confidence').value).toFixed(2);
}

async function startCalibration() {
  if (state.currentSession) { showToast('Finish the practice session before testing the microphone.'); return; }
  if (calibrationAudio) { stopCalibration(); return; }
  const button = $('#detector-test-toggle');
  const status = $('#detector-test-state');
  button.disabled = true; status.textContent = 'Starting microphone…';
  let stream = null; let context = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone is unavailable in this browser.');
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !('AudioWorkletNode' in window)) throw new Error('This browser cannot run the live audio test.');
    context = new AudioCtx();
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
    resumePromise.catch(() => {});
    stream = await requestMicrophone((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    await resumePromise;
    await context.audioWorklet.addModule('/audio/piano-worklet.js');
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'piano-input', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = context.createGain(); mute.gain.value = 0;
    source.connect(node); node.connect(mute); mute.connect(context.destination);
    calibrationAudio = { stream, context, source, node, mute };
    calibrationGate = new PianoEvidenceGate({ minConfidence: child().detector.confidence });
    node.port.onmessage = (event) => {
      if (event.data?.type !== 'frame' || !calibrationAudio) return;
      const settings = child().detector;
      calibrationGate.minConfidence = settings.confidence;
      const features = analyzePianoFrame(new Float32Array(event.data.samples), event.data.sampleRate, settings);
      const result = calibrationGate.push(features, performance.now());
      status.textContent = result === 'playing' ? 'Instrument-like signal detected' : 'No instrument-like signal detected';
      status.dataset.detected = String(result === 'playing');
      $('#detector-test-metrics').textContent = `Input ${features.rms.toFixed(4)} · confidence ${features.score.toFixed(2)} · ${features.fundamentalHz ? `${Math.round(features.fundamentalHz)} Hz` : 'no stable pitch'}`;
    };
    button.disabled = false; button.textContent = 'Stop live test';
    status.textContent = 'Listening — speak or play, then adjust controls';
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (context) context.close().catch(() => {});
    calibrationAudio = null; calibrationGate = null;
    status.dataset.detected = 'false';
    status.textContent = microphoneErrorMessage(error);
    button.disabled = false; button.textContent = 'Start live test';
  }
}

function stopCalibration() {
  const current = calibrationAudio;
  calibrationAudio = null; calibrationGate = null;
  if (current?.node) current.node.disconnect();
  if (current?.mute) current.mute.disconnect();
  if (current?.source) current.source.disconnect();
  current?.stream?.getTracks().forEach((track) => track.stop());
  if (current?.context) current.context.close().catch(() => {});
  const button = $('#detector-test-toggle');
  const status = $('#detector-test-state');
  if (button) { button.disabled = false; button.textContent = 'Start live test'; }
  if (status) { status.textContent = 'Test stopped'; status.dataset.detected = 'false'; }
  if ($('#detector-test-metrics')) $('#detector-test-metrics').textContent = '';
}

async function beginPractice() {
  if (state.currentSession) return;
  stopCalibration();
  clockBase = performance.now(); startIso = new Date().toISOString(); microphoneStatus = 'starting';
  timer = new SmartTimer({ thresholdMs: child().inactivitySeconds * 1000, nowMs: 0 });
  timer.punchIn(0);
  const priorMs = state.sessions.filter((s) => s.childId === selectedChild && s.date === dayKey() && s.status === 'complete').reduce((sum, s) => sum + s.creditedMs, 0);
  const extraStepMs = Math.max(1, child().pointRules.extraEveryMinutes || 10) * 60_000;
  const goalMs = child().goalMinutes * 60_000;
  state.currentSession = { id: crypto.randomUUID(), childId: selectedChild, startedAt: startIso, date: dayKey(), recoveryRequired: false, elapsedMs: 0, creditedMs: 0, events: [], goalCelebrated: false, extraUnitsSettled: Math.floor(Math.max(0, priorMs - goalMs) / extraStepMs) };
  persist();
  requestScreenWakeLock();
  if (ticker) clearInterval(ticker);
  let checkpointAt=0;
  ticker = setInterval(() => {
    const elapsedNow=performance.now()-clockBase;
    if(audio && lastAudioFrameAt && performance.now()-lastAudioFrameAt>1500 && timer.state!==TIMER_STATES.UNAVAILABLE) loseMic();
    const snapshot=timer.tick(elapsedNow);
    checkPracticeMilestones(snapshot);
    if(performance.now()-checkpointAt>=5000){ checkpointAt=performance.now(); state.currentSession.elapsedMs=snapshot.elapsedMs; state.currentSession.creditedMs=snapshot.activeMs; state.currentSession.events=snapshot.events; saveState(state); queueCloudSync(); }
    render();
  }, 250);
  await startAudio();
}

async function requestScreenWakeLock() {
  if (!state.currentSession) return;
  if (!('wakeLock' in navigator) || document.hidden) {
    wakeLockStatus = 'unavailable'; render(); return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLockStatus = 'active';
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      if (state.currentSession) { wakeLockStatus = 'unavailable'; render(); }
    }, { once: true });
  } catch { wakeLockStatus = 'unavailable'; }
  render();
}

function releaseScreenWakeLock() {
  const held = wakeLock;
  wakeLock = null;
  wakeLockStatus = 'inactive';
  held?.release().catch(() => {});
}

async function startAudio() {
  if (!timer || !state.currentSession) return;
  microphoneStatus = 'starting';
  $('#permission-message').hidden = true;
  $('#retry-audio').hidden = true;
  render();
  let stream = null;
  let context = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable. Open this page in Safari over HTTPS.');
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !('AudioWorkletNode' in window)) throw new Error('This browser does not support the live audio analyzer.');
    // Begin both operations on the tap; iOS Safari may drop user activation after an await.
    context = new AudioCtx();
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
    resumePromise.catch(() => {});
    stream = await requestMicrophone((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    if (!state.currentSession) {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      return;
    }
    audio = { stream, context, source: null, node: null, mute: null };
    const childConfig = child();
    if (childConfig.recordingEnabled && typeof MediaRecorder !== 'undefined') {
      const preferred = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2'].find((type) => MediaRecorder.isTypeSupported?.(type));
      try {
        const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
        const chunks = [];
        recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
        recorder.start(1000);
        audio.recorder = recorder;
        audio.recordingChunks = chunks;
      } catch { showToast('Microphone timer is running; recording could not start.'); }
    } else if (childConfig.recordingEnabled) showToast('This browser can track practice but cannot record audio.');
    await resumePromise;
    await context.audioWorklet.addModule('/audio/piano-worklet.js');
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'piano-input', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = context.createGain(); mute.gain.value = 0;
    audio.source = source; audio.node = node; audio.mute = mute;
    const gate = new PianoEvidenceGate({ minConfidence: child().detector.confidence });
    audio.gate = gate;
    node.port.onmessage = (event) => {
      if (event.data?.type !== 'frame' || !timer || !state.currentSession) return;
      lastAudioFrameAt=performance.now();
      if (audioSuppressed) return;
      if (microphoneStatus === 'starting') microphoneStatus = 'listening';
      const detectorSettings = child().detector;
      gate.minConfidence = detectorSettings.confidence;
      const features = analyzePianoFrame(new Float32Array(event.data.samples), event.data.sampleRate, detectorSettings);
      const classValue = gate.push(features, performance.now() - clockBase);
      const priorEvents = timer.events.length;
      timer.update(classValue, performance.now() - clockBase);
      if (timer.events.length > priorEvents) timer.events.at(-1).confidence = Number(features.score.toFixed(3));
      checkPracticeMilestones(timer.snapshot(performance.now() - clockBase));
      render();
    };
    source.connect(node); node.connect(mute); mute.connect(context.destination);
    lastAudioFrameAt=performance.now();
    audio.stream.getAudioTracks()[0]?.addEventListener('ended', () => loseMic());
    context.addEventListener('statechange', () => {
      if (state.currentSession && context.state !== 'running' && microphoneStatus !== 'starting') loseMic();
    });
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (audio?.context) audio.context.close().catch(()=>{});
    else if (context) context.close().catch(()=>{});
    audio = null;
    if (!state.currentSession) return;
    microphoneStatus = 'unavailable';
    timer.microphoneLost(performance.now() - clockBase);
    $('#permission-message').textContent = microphoneErrorMessage(error);
    $('#permission-message').hidden = false;
    $('#retry-audio').hidden = false;
  }
  render();
}

function loseMic() {
  microphoneStatus = 'unavailable';
  if (timer && state.currentSession) timer.microphoneLost(performance.now() - clockBase);
  if (audio?.context) audio.context.suspend().catch(()=>{});
  $('#permission-message').textContent = 'Microphone input was lost. Timer paused and no unverified time is credited.';
  $('#permission-message').hidden = false; $('#retry-audio').hidden = false; render();
}

function stopAudio() {
  if (ticker) clearInterval(ticker); ticker = null;
  const currentAudio = audio;
  const recording = currentAudio?.recorder ? new Promise((resolve) => {
    const recorder = currentAudio.recorder;
    recorder.addEventListener('stop', () => resolve(new Blob(currentAudio.recordingChunks, { type: recorder.mimeType || 'application/octet-stream' })), { once: true });
    try { if (recorder.state !== 'inactive') recorder.stop(); else resolve(new Blob(currentAudio.recordingChunks, { type: recorder.mimeType || 'application/octet-stream' })); } catch { resolve(null); }
  }) : Promise.resolve(null);
  if (audio?.node) audio.node.disconnect();
  if (audio?.mute) audio.mute.disconnect();
  if (audio?.source) audio.source.disconnect();
  if (audio?.stream) audio.stream.getTracks().forEach((track) => track.stop());
  if (audio?.context) audio.context.close().catch(()=>{});
  audio = null;
  return recording;
}

function playCelebrationSound() {
  audioSuppressed = true;
  const now = performance.now();
  timer?.pauseForAnnouncement(now - clockBase);
  const context = audio?.context;
  if (context?.state === 'running') {
    const gain = context.createGain(); gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.8);
    gain.connect(context.destination);
    for (const [offset, frequency] of [[0, 660], [0.16, 880], [0.32, 1320]]) {
      const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      oscillator.connect(gain); oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + 0.22);
    }
    setTimeout(() => gain.disconnect(), 1000);
  }
  const resume = () => {
    if (!state.currentSession) return;
    audioSuppressed = false;
    if (audio?.gate) audio.gate.history = [];
    render();
  };
  if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
    const phrase = new SpeechSynthesisUtterance('Hey, you did it! Great job!');
    phrase.rate = 1.05; phrase.pitch = 1.2;
    phrase.onend = resume; phrase.onerror = resume;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(phrase);
    setTimeout(resume, 7000);
  } else setTimeout(resume, 1000);
}

function checkPracticeMilestones(snapshot) {
  const session = state.currentSession;
  if (!session || !snapshot || session.childId !== selectedChild) return;
  session.elapsedMs = snapshot.elapsedMs;
  session.creditedMs = snapshot.activeMs;
  session.events = snapshot.events;
  const c = childFor(session.childId);
  const previousMs = state.sessions.filter((s) => s.childId === c.id && s.date === session.date && s.status === 'complete').reduce((sum, s) => sum + s.creditedMs, 0);
  const verifiedDailyMs = previousMs + snapshot.activeMs;
  const goalMs = c.goalMinutes * 60_000;
  if (!session.goalCelebrated && previousMs < goalMs && verifiedDailyMs >= goalMs) {
    session.goalCelebrated = true;
    session.events = snapshot.events;
    const streak = currentStreak(state, c, session.date) + (requiredPracticeDate(c, session.date) ? 1 : 0);
    const before = points.ledgerBalance(state.ledger, c.id);
    settlePracticeDay(state, c.id, session.date, snapshot.activeMs, streak);
    const earned = points.ledgerBalance(state.ledger, c.id) - before;
    $('#celebration-copy').textContent = `You reached today’s active playing goal. ${earned > 0 ? `+${earned} points earned! ` : ''}Great job!`;
    playCelebrationSound();
    persist();
    $('#continue-bonus').focus();
  }
  const stepMs = Math.max(1, Number(c.pointRules.extraEveryMinutes) || 10) * 60_000;
  const bonusUnits = Math.floor(Math.max(0, verifiedDailyMs - goalMs) / stepMs);
  if (bonusUnits > (session.extraUnitsSettled || 0)) {
    const before = points.ledgerBalance(state.ledger, c.id);
    const streak = currentStreak(state, c, session.date) + (requiredPracticeDate(c, session.date) && verifiedDailyMs >= goalMs ? 1 : 0);
    settlePracticeDay(state, c.id, session.date, snapshot.activeMs, streak);
    session.extraUnitsSettled = bonusUnits;
    const earned = points.ledgerBalance(state.ledger, c.id) - before;
    if (earned > 0) showToast(`Bonus practice! +${earned} points earned`);
    persist();
  }
}

function finishPractice() {
  if (!timer || !state.currentSession) return;
  const finishAt = performance.now() - clockBase;
  const snapshot = timer.punchOut(finishAt);
  const session = { ...state.currentSession, endedAt: new Date().toISOString(), elapsedMs: snapshot.elapsedMs, creditedMs: snapshot.activeMs, events: snapshot.events, status: 'complete', correctionMs: 0 };
  $('#goal-celebration').hidden = true;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  audioSuppressed = false;
  const before=points.ledgerBalance(state.ledger,session.childId);
  state.sessions.push(session); state.currentSession = null;
  settlePracticeDay(state, session.childId, session.date);
  $('#permission-message').hidden = true;
  timer = null; startIso = null; microphoneStatus = 'idle'; releaseScreenWakeLock();
  const recordingPromise = stopAudio(); persist();
  const earned=points.ledgerBalance(state.ledger,session.childId)-before;
  if(earned>0) showToast(`Lovely practice! +${earned} points earned${[3,5,7,14,30].includes(currentStreak(state,childFor(session.childId)))?' · streak badge unlocked':''}`);
  recordingPromise.then(async (blob) => {
    if (!blob?.size) return;
    try {
      const response = await fetch(`/api/recordings/${session.id}`, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
      if (!response.ok) throw new Error('Upload failed');
      session.recording = { mimeType: blob.type, size: blob.size, createdAt: new Date().toISOString() };
      persist(); showToast('Private recording saved for parent review.');
    } catch { showToast('Practice saved; recording could not sync.'); }
  });
}

function bindEvents() {
  $('#child-picker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-child]'); if (!button || state.currentSession) return;
    stopCalibration();
    selectedChild = button.dataset.child; persist();
  });
  $('#punch-in').addEventListener('click', beginPractice);
  $('#punch-out').addEventListener('click', finishPractice);
  $('#continue-bonus').addEventListener('click', () => { $('#goal-celebration').hidden = true; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); audioSuppressed = false; if (audio?.gate) audio.gate.history = []; render(); $('#punch-out').focus(); });
  $('#end-after-goal').addEventListener('click', finishPractice);
  $('#retry-audio').addEventListener('click', startAudio);
  $('#detector-test-toggle').addEventListener('click', startCalibration);
  $('#instrument-input').addEventListener('change', () => { fillDetectorSettings(child(), true); persist(); });
  document.querySelectorAll('#mic-volume, #pitch-low, #pitch-high, #harmonicity, #confidence').forEach((input) => input.addEventListener('input', () => { readDetectorControls(); persist(); }));
  $('#parent-toggle').addEventListener('click', () => {
    state.parentMode = !state.parentMode;
    $('#parent-toggle').setAttribute('aria-expanded', String(state.parentMode));
    persist();
    if (state.parentMode) requestAnimationFrame(() => $('#parent-dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('#rename-child').addEventListener('click', () => {
    const next = prompt('Child display name', child().name)?.trim(); if (next) { child().name = next; persist(); }
  });
  $('#goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const c=child(); c.goalMinutes = Math.max(1, Number($('#goal-input').value) || 20); c.inactivitySeconds = Math.max(5, Number($('#threshold-input').value) || 20);
    c.pointRules.dailyGoal=Math.max(0,Number($('#daily-points').value)||0); c.pointRules.lesson=Math.max(0,Number($('#lesson-points').value)||0); c.pointRules.practiceDay=Math.max(0,Number($('#practice-points').value)||0);
    c.pointRules.extraEveryMinutes=Math.max(1,Number($('#extra-step').value)||10); c.pointRules.extraMinutes=Math.max(0,Number($('#extra-points').value)||0);
    c.pointRules.milestones={3:Number($('#milestone-3').value)||0,5:Number($('#milestone-5').value)||0,7:Number($('#milestone-7').value)||0,14:Number($('#milestone-14').value)||0,30:Number($('#milestone-30').value)||0};
    c.recordingEnabled = $('#recording-enabled').checked;
    c.requiredWeekdays=[...document.querySelectorAll('.weekday-check:checked')].map((input)=>Number(input.value));
    recalculateChildAwards(state,c.id);
    persist();
  });
  $('#excuse-form').addEventListener('submit',(event)=>{event.preventDefault(); const date=$('#excuse-date').value; if(!date)return; if(!child().excusedDates.includes(date)) child().excusedDates.push(date); recalculateChildAwards(state,child().id); event.target.reset(); persist();});
  $('#reward-form').addEventListener('submit', (event) => {
    event.preventDefault(); const name = $('#reward-name').value.trim(); const cost = Number($('#reward-cost').value);
    if (!name || !Number.isInteger(cost) || cost <= 0) return;
    const editId=$('#reward-id').value;
    const fields={name,description:$('#reward-description').value.trim(),image:$('#reward-image').value.trim(),restrictions:$('#reward-restrictions').value.trim(),cost};
    if(editId){ Object.assign(state.rewards.find((reward)=>reward.id===editId),fields); showToast('Reward updated.'); }
    else { state.rewards.push({id:crypto.randomUUID(),...fields,enabled:true}); showToast('Reward added.'); }
    resetRewardForm(); persist();
  });
  $('#special-form').addEventListener('submit', (event) => {
    event.preventDefault(); const n = Number($('#special-points').value); if (!Number.isInteger(n) || n <= 0) return;
    state.ledger = points.addAward(state.ledger, { childId: selectedChild, points: n, type: 'special_achievement', sourceId: crypto.randomUUID(), idempotencyKey: `manual:${crypto.randomUUID()}`, note: $('#special-name').value.trim() || 'Special achievement' }).ledger; event.target.reset(); persist();
  });
  $('#adjust-form').addEventListener('submit', (event) => {
    event.preventDefault(); try { state.ledger = points.addAdjustment(state.ledger, { childId: selectedChild, points: Number($('#adjust-points').value), note: $('#adjust-note').value }); event.target.reset(); persist(); } catch (err) { alert(err.message); }
  });
  document.addEventListener('click', (event) => {
    const reward = event.target.closest('[data-reward]');
    if (reward) {
      const item = state.rewards.find((x) => x.id === reward.dataset.reward);
      try { const result = points.requestRedemption(state.redemptions,state.ledger,{childId:selectedChild,rewardId:item.id,cost:item.cost}); state.redemptions=result.redemptions; persist(); showToast('Request sent to your parent'); } catch (err) { showToast(err.message); }
    }
    const cancelRequest=event.target.closest('[data-cancel]');
    if(cancelRequest){ const result=points.resolveRedemption(state.redemptions,state.ledger,cancelRequest.dataset.cancel,'cancelled'); state.redemptions=result.redemptions; state.ledger=result.ledger; persist(); showToast('Request cancelled; points are available again'); }
    const lesson = event.target.closest('[data-lesson]');
    if (lesson) { const date = dayKey(); const result = points.confirmLesson(state.ledger,{childId:lesson.dataset.lesson,lessonDate:date,points:childFor(lesson.dataset.lesson).pointRules.lesson}); state.ledger=result.ledger; persist(); showToast(result.awarded ? 'Lesson points added' : 'Lesson already confirmed this week'); }
    const approve = event.target.closest('[data-approve]');
    if (approve) { const res = points.resolveRedemption(state.redemptions,state.ledger,approve.dataset.approve,'approved'); state.redemptions=res.redemptions; state.ledger=res.ledger; persist(); }
    const reject = event.target.closest('[data-reject]');
    if (reject) { const res = points.resolveRedemption(state.redemptions,state.ledger,reject.dataset.reject,'rejected'); state.redemptions=res.redemptions; persist(); }
    const toggle = event.target.closest('[data-toggle-reward]');
    if (toggle) { const item = state.rewards.find((x)=>x.id===toggle.dataset.toggleReward); item.enabled=!item.enabled; persist(); }
    const unexcuse=event.target.closest('[data-unexcuse]');
    if (unexcuse) { child().excusedDates=child().excusedDates.filter((date)=>date!==unexcuse.dataset.unexcuse); recalculateChildAwards(state,child().id); persist(); }
    const editReward=event.target.closest('[data-edit-reward]');
    if (editReward) {
      const item=state.rewards.find((x)=>x.id===editReward.dataset.editReward);
      $('#reward-id').value=item.id; $('#reward-name').value=item.name; $('#reward-description').value=item.description||'';
      $('#reward-image').value=item.image||''; $('#reward-cost').value=item.cost; $('#reward-restrictions').value=item.restrictions||'';
      $('#reward-submit').textContent='Save reward'; $('#reward-cancel').hidden=false; $('#reward-name').focus();
    }
    const correction=event.target.closest('[data-correct-session]');
    if (correction) {
      const form=correction.closest('.timeline-row').querySelector(`[data-session-form="${correction.dataset.correctSession}"]`);
      form.hidden=!form.hidden;
    }
    const saveCorrection=event.target.closest('[data-save-session]');
    if (saveCorrection) {
      const session=state.sessions.find((s)=>s.id===saveCorrection.dataset.saveSession);
      const form=saveCorrection.closest('.session-edit-form');
      const startMs=new Date(form.querySelector('[data-session-start]').value).getTime();
      const endMs=new Date(form.querySelector('[data-session-end]').value).getTime();
      const activeValue=form.querySelector('[data-session-active]').value;
      const activeMinutes=Number(activeValue);
      const reason=form.querySelector('[data-session-reason]').value.trim();
      const creditedMs=Math.round(activeMinutes*60_000);
      if(!form.querySelector('[data-session-start]').value||!form.querySelector('[data-session-end]').value||activeValue===''||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<startMs||!Number.isFinite(creditedMs)||creditedMs<0||creditedMs>endMs-startMs||!reason){
        showToast('Check the times, active minutes, and correction reason.');
        return;
      }
      const before={startedAt:session.startedAt,endedAt:session.endedAt,creditedMs:session.creditedMs,date:session.date};
      const oldDate=session.date;
      const deltaMs=creditedMs-session.creditedMs;
      session.startedAt=new Date(startMs).toISOString();
      session.endedAt=new Date(endMs).toISOString();
      session.elapsedMs=endMs-startMs;
      session.date=dayKey(new Date(startMs));
      session.creditedMs=creditedMs;
      session.correctionMs=(session.correctionMs||0)+deltaMs;
      session.correctionReason=reason;
      session.events.push({at:session.elapsedMs,state:'manual_correction',reason,deltaMs,before,after:{startedAt:session.startedAt,endedAt:session.endedAt,creditedMs, date:session.date},correctedAt:new Date().toISOString()});
      const correctionId=crypto.randomUUID();
      settlePracticeDay(state,session.childId,oldDate); reconcilePracticeDay(state,session.childId,oldDate,correctionId);
      if(session.date!==oldDate){settlePracticeDay(state,session.childId,session.date);reconcilePracticeDay(state,session.childId,session.date,correctionId);}
      persist(); showToast('Session correction saved and logged.');
    }
    const review=event.target.closest('[data-review-session]');
    if(review){ const session=state.sessions.find((s)=>s.id===review.dataset.reviewSession); session.status='complete'; settlePracticeDay(state,session.childId,session.date); reconcilePracticeDay(state,session.childId,session.date,crypto.randomUUID()); persist(); showToast('Verified practice time approved'); }
    const deleteRecording=event.target.closest('[data-delete-recording]');
    if(deleteRecording){
      const session=state.sessions.find((s)=>s.id===deleteRecording.dataset.deleteRecording);
      if(session?.recording && confirm('Delete this private recording?')) fetch(`/api/recordings/${session.id}`,{method:'DELETE'}).then((response)=>{if(!response.ok)throw new Error();delete session.recording;persist();showToast('Recording deleted.');}).catch(()=>showToast('Recording could not be deleted.'));
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && calibrationAudio) stopCalibration();
    if (document.hidden && state.currentSession) loseMic();
    else if (!document.hidden && state.currentSession) {
      requestScreenWakeLock();
      if (audio?.context?.state === 'suspended') audio.context.resume().catch(() => loseMic());
    }
  });
  window.addEventListener('pagehide', () => { stopCalibration(); releaseScreenWakeLock(); if (state.currentSession) { state.currentSession.recoveryRequired = true; saveState(state); stopAudio(); } });
  if (state.currentSession) {
    const interrupted=state.currentSession;
    state.sessions.push({ ...interrupted, endedAt: new Date().toISOString(), status: 'interrupted', correctionMs: 0, events: interrupted.events || [] });
    state.currentSession = null;
    settlePracticeDay(state, interrupted.childId, interrupted.date);
    reconcilePracticeDay(state, interrupted.childId, interrupted.date, `interrupted:${interrupted.id}`);
    saveState(state);
    setTimeout(()=>showToast('A session was interrupted. Verified time is waiting for parent review.'),100);
  }
}

function childFor(id) { return state.children.find((c) => c.id === id); }
function resetRewardForm() { $('#reward-form').reset(); $('#reward-id').value=''; $('#reward-submit').textContent='Add reward'; $('#reward-cancel').hidden=true; }
function showToast(text) { const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2300); }

document.addEventListener('DOMContentLoaded', async () => {
  ensureFamilyProfiles(state);
  saveState(state);
  await hydrateCloudState();
  bindEvents();
  fillSettings(child());
  $('#reward-cancel').addEventListener('click', resetRewardForm);
  render();
});
