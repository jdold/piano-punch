import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, addAward, confirmLesson, evaluateDay, ledgerBalance, reconcileDayAwards, requestRedemption, resolveRedemption } from '../src/lib/rewards.js';

test('daily goal and extra-minute awards are idempotent on repeated evaluation', () => {
  const args = { childId:'son', date:'2026-10-12', creditedMinutes:40, goalMinutes:20, ledger:[], rules:DEFAULT_RULES, qualifyingRunDays:3 };
  const first = evaluateDay(args);
  const second = evaluateDay({ ...args, ledger:first.ledger });
  assert.equal(first.ledger.length, 5); // daily goal, practice day, 3-day milestone, two 10-minute extras
  assert.equal(second.ledger.length, first.ledger.length);
  assert.equal(ledgerBalance(second.ledger,'son'),18);
});

test('weekly lesson confirmation is unique for the child and week', () => {
  let ledger = [];
  const one = confirmLesson(ledger,{childId:'son',lessonDate:'2026-10-12',points:20},'2026-10-12T12:00:00Z');
  const two = confirmLesson(one.ledger,{childId:'son',lessonDate:'2026-10-15',points:20},'2026-10-15T12:00:00Z');
  assert.equal(one.awarded,true);
  assert.equal(two.awarded,false);
  assert.equal(ledgerBalance(two.ledger,'son'),20);
});

test('pending reward requests reserve points and rejection releases the reservation', () => {
  let ledger=[]; let redemptions=[];
  ledger = addAward(ledger,{childId:'daughter',points:100,type:'award',sourceId:'seed',idempotencyKey:'seed'}).ledger;
  const pending = requestRedemption(redemptions,ledger,{childId:'daughter',rewardId:'book',cost:80},'2026-10-12T12:00:00Z');
  redemptions=pending.redemptions;
  assert.throws(()=>requestRedemption(redemptions,ledger,{childId:'daughter',rewardId:'toy',cost:30}),/Not enough/);
  const rejected=resolveRedemption(redemptions,ledger,pending.request.id,'rejected','2026-10-12T13:00:00Z');
  assert.equal(ledgerBalance(rejected.ledger,'daughter'),100);
  assert.equal(rejected.redemptions[0].status,'rejected');
});

test('approved redemption deducts once and cannot be double-approved', () => {
  let ledger=addAward([],{childId:'son',points:100,type:'award',sourceId:'seed',idempotencyKey:'seed'}).ledger;
  const pending=requestRedemption([] ,ledger,{childId:'son',rewardId:'outing',cost:60});
  const approved=resolveRedemption(pending.redemptions,ledger,pending.request.id,'approved');
  assert.equal(ledgerBalance(approved.ledger,'son'),40);
  assert.throws(()=>resolveRedemption(approved.redemptions,approved.ledger,pending.request.id,'approved'),/not pending/i);
});

test('approval rechecks spendable points if balance changed while request was pending', () => {
  let ledger=addAward([],{childId:'son',points:100,type:'award',sourceId:'seed',idempotencyKey:'seed'}).ledger;
  const pending=requestRedemption([],ledger,{childId:'son',rewardId:'outing',cost:80});
  ledger=ledger.concat({id:'adj',childId:'son',points:-30,type:'adjustment',idempotencyKey:'adj',note:'correction'});
  assert.throws(()=>resolveRedemption(pending.redemptions,ledger,pending.request.id,'approved'),/Not enough available/);
});

test('duplicate idempotency keys do not create a second ledger row', () => {
  const input={childId:'son',points:7,type:'special',sourceId:'x',idempotencyKey:'special:x'};
  const one=addAward([],input); const two=addAward(one.ledger,input);
  assert.equal(one.ledger.length,1); assert.equal(two.ledger.length,1); assert.equal(two.awarded,false);
});

test('historical correction reverses an invalid daily award and restores it only once', () => {
  const completed=evaluateDay({childId:'son',date:'2026-10-12',creditedMinutes:20,goalMinutes:20,ledger:[],rules:DEFAULT_RULES});
  const lower=reconcileDayAwards({childId:'son',date:'2026-10-12',creditedMinutes:8,goalMinutes:20,ledger:completed.ledger,rules:DEFAULT_RULES,correctionId:'edit-1'});
  assert.equal(ledgerBalance(lower,'son'),0);
  const repeated=reconcileDayAwards({childId:'son',date:'2026-10-12',creditedMinutes:8,goalMinutes:20,ledger:lower,rules:DEFAULT_RULES,correctionId:'edit-1'});
  assert.equal(repeated.length,lower.length);
  const restored=reconcileDayAwards({childId:'son',date:'2026-10-12',creditedMinutes:20,goalMinutes:20,ledger:lower,rules:DEFAULT_RULES,correctionId:'edit-2'});
  assert.equal(ledgerBalance(restored,'son'),11);
});

test('reconciling one day leaves other days awards untouched', () => {
  const first=evaluateDay({childId:'son',date:'2026-10-13',creditedMinutes:20,goalMinutes:20,ledger:[],rules:DEFAULT_RULES});
  const second=evaluateDay({childId:'son',date:'2026-10-14',creditedMinutes:20,goalMinutes:20,ledger:first.ledger,rules:DEFAULT_RULES});
  const ledger=reconcileDayAwards({childId:'son',date:'2026-10-14',creditedMinutes:0,goalMinutes:20,ledger:second.ledger,rules:DEFAULT_RULES,correctionId:'interrupt-14'});
  assert.equal(ledger.filter((row)=>row.type==='award_reversal'&&row.sourceId==='2026-10-13').length,0);
  assert.equal(ledger.filter((row)=>row.type==='award_reversal'&&row.sourceId==='2026-10-14').length,2);
  assert.equal(ledgerBalance(ledger,'son'),11);
});
