import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKidActivity } from '../src/lib/kid-sync.js';
import { initialState, currentStreak, recalculateChildAwards, creditedPracticeMsForDay, mergeParentActivity } from '../src/lib/piano-state.js';

function practice(date, extra = {}) {
  return { id:crypto.randomUUID(), childId:'daughter', date, status:'complete', creditedMs:30*60_000,
    startedAt:`${date}T14:00:00.000Z`, endedAt:`${date}T14:30:00.000Z`, elapsedMs:30*60_000, events:[], ...extra };
}

test('an offline tablet recovers its missing practices and adopts the parent streak and settings', () => {
  const remote = initialState();
  const child = remote.children.find((c) => c.id === 'daughter');
  child.goalMinutes=30; child.requiredWeekdays=[0,1,2,3,4,5,6];
  for (let n=7;n<=22;n++) remote.sessions.push(practice(`2026-11-${String(n).padStart(2,'0')}`));
  const local = structuredClone(remote);
  local.children.find((c)=>c.id==='daughter').goalMinutes=60;
  for (let n=23;n<=27;n++) local.sessions.push(practice(`2026-11-${n}`));
  assert.equal(currentStreak(remote,child,'2026-11-28'),0);
  const merged = mergeKidActivity(remote,local);
  assert.equal(merged.changed,true);
  assert.equal(currentStreak(merged.state,child,'2026-11-28'),21);
  assert.equal(merged.state.children.find((c)=>c.id==='daughter').goalMinutes,30);
  assert.equal(mergeKidActivity(merged.state,local).changed,false);
});

test('a stale tablet cannot replace an archived parent correction or resurrect a closed session', () => {
  const remote = initialState();
  const session = practice('2026-11-27',{creditedMs:10*60_000,eventArchive:{lastCorrectionAt:Date.parse('2026-11-28T14:00:00Z')}});
  remote.sessions=[session];
  const local=structuredClone(remote);
  local.sessions[0].creditedMs=30*60_000;
  local.sessions[0].goalCelebrated=true;
  delete local.sessions[0].eventArchive;
  local.currentSession={...session};
  const merged=mergeKidActivity(remote,local);
  assert.equal(merged.state.sessions[0].creditedMs,10*60_000);
  assert.equal(merged.state.currentSession,null);
  assert.equal(mergeParentActivity(remote,local).state.sessions[0].creditedMs,10*60_000);
});

test('recovered real practice replaces parent day credit without duplicating time or points', () => {
  const state=initialState();
  const child=state.children.find((c)=>c.id==='daughter');
  child.goalMinutes=30;
  state.sessions=[practice('2026-11-26',{parentDayCredit:true})];
  recalculateChildAwards(state,child.id);
  const balance=state.ledger.reduce((sum,row)=>sum+row.points,0);
  state.sessions.push(practice('2026-11-26'));
  assert.equal(creditedPracticeMsForDay(state,child.id,'2026-11-26'),30*60_000);
  recalculateChildAwards(state,child.id);
  assert.equal(state.ledger.reduce((sum,row)=>sum+row.points,0),balance);
  assert.equal(creditedPracticeMsForDay(state,child.id,'2026-11-26',15*60_000),45*60_000);
});
