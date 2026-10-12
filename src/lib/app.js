import { SmartTimer, TIMER_STATES } from './smart-timer.js';
import { requestMicrophone, microphoneErrorMessage } from './microphone.js';
import { analyzePianoFrame, PianoEvidenceGate } from '../audio/classifier.js';
import { loadState, saveState, dayKey, creditedMinutesForDay, settlePracticeDay, reconcilePracticeDay, recalculateChildAwards, currentStreak, points } from './piano-state.js';

let state = loadState();
let selectedChild = state.children[0].id;
let timer = null;
let audio = null;
let ticker = null;
let clockBase = 0;
let lastAudioFrameAt = 0;
let startIso = null;
let microphoneStatus = 'idle';
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
      saveState(state);
    } else {
      const local = JSON.parse(localStorage.getItem('piano-punch:v1') || 'null');
      if (local?.children?.length) state = { ...state, ...local };
    }
    cloudReady = true;
    $('#cloud-status').textContent = remote.state ? 'Synced' : 'Saving…';
    if (!remote.state) queueCloudSync();
  } catch {
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
  $('#session-active').textContent = fmt(current.activeMs + current.provisionalMs);
  $('#session-credit-note').textContent = current.provisionalMs ? `${fmt(current.provisionalMs)} provisional` : 'Verified active time';
  const displayState = state.currentSession && microphoneStatus === 'starting' ? 'starting' : current.state;
  $('#live-state').textContent = stateLabel(displayState);
  $('#live-state').dataset.state = displayState;
  $('#session-heading').textContent = !state.currentSession ? 'Ready when you are' : displayState === 'starting' ? 'Starting your session' : 'Practice session';
  $('#session-hint').textContent = state.currentSession
    ? 'This session stays open until you punch out. Active time counts only while piano is detected.'
    : 'The microphone stays off until your child punches in.';
  $('#punch-in').hidden = Boolean(state.currentSession);
  $('#punch-out').hidden = !state.currentSession;
  $('#punch-out').disabled = !state.currentSession;
  $('#session-detail').hidden = !state.currentSession;
  $('#reward-progress').innerHTML = state.rewards.filter((r) => r.enabled).map((r) => {
    const pending = state.redemptions.filter((x) => x.childId === c.id && x.status === 'pending').reduce((n,x)=>n+x.cost,0);
    const available = points.ledgerBalance(state.ledger, c.id) - pending;
    const pct = Math.min(100, Math.floor(available / Math.max(1,r.cost) * 100));
    const pendingRequest=state.redemptions.find((x)=>x.childId===c.id&&x.rewardId===r.id&&x.status==='pending');
    return `<article class="reward-card">${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="reward-image" />` : ''}<div><strong>${escapeHtml(r.name)}</strong><p>${escapeHtml(r.description || '')}${r.restrictions ? ` · ${escapeHtml(r.restrictions)}` : ''}</p></div><div class="reward-cost">${r.cost} pts</div><div class="mini-track"><span style="width:${pct}%"></span></div><small>${available} / ${r.cost} points ${available >= r.cost ? '· Ready to request' : '· Keep going'}</small>${pendingRequest?`<button class="request-reward" data-cancel="${pendingRequest.id}">Request pending · cancel</button>`:`<button class="request-reward" data-reward="${r.id}" ${available < r.cost ? 'disabled' : ''}>Request reward</button>`}</article>`;
  }).join('') || '<p class="muted">Your parent can add a reward.</p>';
  $('#history-list').innerHTML = state.sessions.filter((s) => s.childId === c.id).slice().reverse().slice(0,8).map((s) => `<li><span>${new Date(`${s.date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${new Date(s.startedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</span><strong>${fmt(s.creditedMs)} active</strong></li>`).join('') || '<li class="muted">Your first session will appear here.</li>';
  $('#parent-dashboard').hidden = !state.parentMode;
  if (state.parentMode) {
    renderParent();
    if (document.activeElement?.tagName !== 'INPUT') fillSettings(c);
  }
  $('#pending-count').textContent = state.redemptions.filter((x) => x.status === 'pending').length;
  const ringProgress = Math.min(100, current.activeMs / Math.max(1, c.goalMinutes * 60_000) * 100);
  $('#live-ring').style.setProperty('--progress', `${ringProgress}%`);
}

function stateLabel(value) {
  return ({ ready: 'Ready', starting: 'Starting mic…', listening: 'Listening', playing: 'Playing', grace: 'Grace period', paused: 'Paused', unavailable: 'Microphone unavailable', ended: 'Session complete' })[value] || 'Ready';
}

function renderParent() {
  $('#parent-children').innerHTML = state.children.map((c) => {
    const date = dayKey(); const mins = creditedMinutesForDay(state,c.id,date);
    return `<article class="child-admin"><div><strong>${escapeHtml(c.name)}</strong><small>Today · ${mins} of ${c.goalMinutes} min · ${currentStreak(state,c)} day streak · ${points.ledgerBalance(state.ledger,c.id)} available points</small></div><button data-lesson="${c.id}" class="small-button">Confirm lesson</button></article>`;
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
    return `<details class="timeline-row"><summary><strong>${s.date}</strong> · ${time(s.creditedMs)} credited · ${escapeHtml(s.status)}</summary>${s.status==='interrupted'?`<button class="small-button" data-review-session="${s.id}">Approve verified time</button>`:''}<button class="small-button" data-correct-session="${s.id}">Edit session punches</button><div class="session-edit-form" data-session-form="${s.id}" hidden><label>Start <input type="datetime-local" data-session-start required value="${localDateTimeValue(startedAt)}" /></label><label>End <input type="datetime-local" data-session-end required value="${localDateTimeValue(endedAt)}" /></label><label>Credited active minutes <input type="number" min="0" step="0.1" data-session-active required value="${(Math.max(0,s.creditedMs)/60_000).toFixed(1)}" /></label><label>Reason <input type="text" data-session-reason required placeholder="Why are you correcting this?" /></label><button class="small-button" type="button" data-save-session="${s.id}">Save correction</button></div><ul>${timeline || '<li>No detector transitions recorded.</li>'}</ul>${s.correctionMs ? `<small>Manual adjustment: ${s.correctionMs>0?'+':'−'}${time(Math.abs(s.correctionMs))} · ${escapeHtml(s.correctionReason || '')}</small>` : ''}</details>`;
  }).join('') || '<p class="muted">No sessions to review.</p>';
}

function fillSettings(c) {
  $('#goal-input').value = c.goalMinutes;
  $('#threshold-input').value = c.inactivitySeconds;
  $('#daily-points').value = c.pointRules.dailyGoal;
  $('#lesson-points').value = c.pointRules.lesson;
  $('#practice-points').value = c.pointRules.practiceDay;
  $('#extra-step').value = c.pointRules.extraEveryMinutes;
  $('#extra-points').value = c.pointRules.extraMinutes;
  for (const day of [3,5,7,14,30]) $(`#milestone-${day}`).value = c.pointRules.milestones[day] ?? 0;
  document.querySelectorAll('.weekday-check').forEach((input) => { input.checked = c.requiredWeekdays.includes(Number(input.value)); });
}

async function beginPractice() {
  if (state.currentSession) return;
  clockBase = performance.now(); startIso = new Date().toISOString(); microphoneStatus = 'starting';
  timer = new SmartTimer({ thresholdMs: child().inactivitySeconds * 1000, nowMs: 0 });
  timer.punchIn(0);
  state.currentSession = { id: crypto.randomUUID(), childId: selectedChild, startedAt: startIso, date: dayKey(), recoveryRequired: false, elapsedMs: 0, creditedMs: 0, events: [] };
  persist();
  if (ticker) clearInterval(ticker);
  let checkpointAt=0;
  ticker = setInterval(() => {
    const elapsedNow=performance.now()-clockBase;
    if(audio && lastAudioFrameAt && performance.now()-lastAudioFrameAt>1500 && timer.state!==TIMER_STATES.UNAVAILABLE) loseMic();
    const snapshot=timer.tick(elapsedNow);
    if(performance.now()-checkpointAt>=5000){ checkpointAt=performance.now(); state.currentSession.elapsedMs=snapshot.elapsedMs; state.currentSession.creditedMs=snapshot.activeMs; state.currentSession.events=snapshot.events; saveState(state); queueCloudSync(); }
    render();
  }, 250);
  await startAudio();
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
    await resumePromise;
    await context.audioWorklet.addModule('/audio/piano-worklet.js');
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'piano-input', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = context.createGain(); mute.gain.value = 0;
    audio.source = source; audio.node = node; audio.mute = mute;
    const gate = new PianoEvidenceGate();
    node.port.onmessage = (event) => {
      if (event.data?.type !== 'frame' || !timer || !state.currentSession) return;
      lastAudioFrameAt=performance.now();
      if (microphoneStatus === 'starting') microphoneStatus = 'listening';
      const features = analyzePianoFrame(new Float32Array(event.data.samples), event.data.sampleRate);
      const classValue = gate.push(features, performance.now() - clockBase);
      const priorEvents = timer.events.length;
      timer.update(classValue, performance.now() - clockBase);
      if (timer.events.length > priorEvents) timer.events.at(-1).confidence = Number(features.score.toFixed(3));
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
  if (audio?.node) audio.node.disconnect();
  if (audio?.mute) audio.mute.disconnect();
  if (audio?.source) audio.source.disconnect();
  if (audio?.stream) audio.stream.getTracks().forEach((track) => track.stop());
  if (audio?.context) audio.context.close().catch(()=>{});
  audio = null;
}

function finishPractice() {
  if (!timer || !state.currentSession) return;
  const finishAt = performance.now() - clockBase;
  const snapshot = timer.punchOut(finishAt);
  const session = { ...state.currentSession, endedAt: new Date().toISOString(), elapsedMs: snapshot.elapsedMs, creditedMs: snapshot.activeMs, events: snapshot.events, status: 'complete', correctionMs: 0 };
  const before=points.ledgerBalance(state.ledger,session.childId);
  state.sessions.push(session); state.currentSession = null;
  settlePracticeDay(state, session.childId, session.date);
  $('#permission-message').hidden = true;
  timer = null; startIso = null; microphoneStatus = 'idle'; stopAudio(); persist();
  const earned=points.ledgerBalance(state.ledger,session.childId)-before;
  if(earned>0) showToast(`Lovely practice! +${earned} points earned${[3,5,7,14,30].includes(currentStreak(state,childFor(session.childId)))?' · streak badge unlocked':''}`);
}

function bindEvents() {
  $('#child-picker').addEventListener('click', (event) => {
    const button = event.target.closest('[data-child]'); if (!button || state.currentSession) return;
    selectedChild = button.dataset.child; persist();
  });
  $('#punch-in').addEventListener('click', beginPractice);
  $('#punch-out').addEventListener('click', finishPractice);
  $('#retry-audio').addEventListener('click', startAudio);
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
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.currentSession) loseMic();
    else if (!document.hidden && audio?.context?.state === 'suspended') audio.context.resume().catch(() => loseMic());
  });
  window.addEventListener('pagehide', () => { if (state.currentSession) { state.currentSession.recoveryRequired = true; saveState(state); stopAudio(); } });
  if (state.currentSession) {
    const interrupted=state.currentSession;
    state.sessions.push({ ...interrupted, endedAt: new Date().toISOString(), status: 'interrupted', correctionMs: 0, events: interrupted.events || [] });
    state.currentSession = null;
    saveState(state);
    setTimeout(()=>showToast('A session was interrupted. Verified time is waiting for parent review.'),100);
  }
}

function childFor(id) { return state.children.find((c) => c.id === id); }
function resetRewardForm() { $('#reward-form').reset(); $('#reward-id').value=''; $('#reward-submit').textContent='Add reward'; $('#reward-cancel').hidden=true; }
function showToast(text) { const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2300); }

document.addEventListener('DOMContentLoaded', async () => {
  await hydrateCloudState();
  bindEvents();
  fillSettings(child());
  $('#reward-cancel').addEventListener('click', resetRewardForm);
  render();
});
