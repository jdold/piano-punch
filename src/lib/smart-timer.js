export const TIMER_STATES = Object.freeze({
  LISTENING: 'listening',
  PLAYING: 'playing',
  GRACE: 'grace',
  PAUSED: 'paused',
  UNAVAILABLE: 'unavailable',
  ENDED: 'ended',
});

/** Deterministic clock. nowMs is monotonic time supplied by the caller. */
export class SmartTimer {
  constructor({ thresholdMs = 20_000, nowMs = 0 } = {}) {
    this.thresholdMs = Math.max(1_000, Number(thresholdMs) || 20_000);
    this.state = TIMER_STATES.LISTENING;
    this.lastAt = nowMs;
    this.activeMs = 0;
    this.provisionalMs = 0;
    this.startedAt = null;
    this.events = [];
    this.manuallyPaused = false;
  }

  punchIn(nowMs) {
    if (this.startedAt !== null) throw new Error('Session already started');
    this.startedAt = nowMs;
    this.lastAt = nowMs;
    this.#event(nowMs, TIMER_STATES.LISTENING, 'punch_in');
  }

  /** classification: 'playing', 'silent', or 'unreliable'. */
  update(classification, nowMs) {
    if (this.startedAt === null || this.state === TIMER_STATES.ENDED) return this.snapshot(nowMs);
    this.#advance(nowMs);
    if (this.manuallyPaused) {
      this.lastAt = nowMs;
      return this.snapshot(nowMs);
    }

    if (classification === 'unreliable') {
      this.provisionalMs = 0;
      if (this.state !== TIMER_STATES.UNAVAILABLE) this.#set(TIMER_STATES.UNAVAILABLE, nowMs, 'classification_unreliable');
    } else if (classification === 'playing') {
      if (this.state === TIMER_STATES.GRACE) {
        this.activeMs += this.provisionalMs;
        this.provisionalMs = 0;
      }
      if (this.state !== TIMER_STATES.PLAYING) this.#set(TIMER_STATES.PLAYING, nowMs, 'piano_detected');
    } else if (classification === 'silent') {
      if (this.state === TIMER_STATES.PLAYING) this.#set(TIMER_STATES.GRACE, nowMs, 'piano_not_detected');
      else if (this.state === TIMER_STATES.LISTENING || this.state === TIMER_STATES.UNAVAILABLE) {
        this.provisionalMs = 0;
        this.#set(TIMER_STATES.LISTENING, nowMs, 'listening');
      }
    }
    this.lastAt = nowMs;
    this.#expireGrace(nowMs);
    return this.snapshot(nowMs);
  }

  tick(nowMs) {
    if (this.startedAt === null || this.state === TIMER_STATES.ENDED) return this.snapshot(nowMs);
    this.#advance(nowMs);
    this.#expireGrace(nowMs);
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  microphoneLost(nowMs) {
    this.#advance(nowMs);
    this.provisionalMs = 0;
    this.#set(TIMER_STATES.UNAVAILABLE, nowMs, 'microphone_lost');
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  /** Let a player pause credit for a real-world interruption. */
  manualPause(nowMs) {
    if (this.startedAt === null || this.state === TIMER_STATES.ENDED || this.manuallyPaused) return this.snapshot(nowMs);
    this.#advance(nowMs);
    this.provisionalMs = 0;
    this.manuallyPaused = true;
    if (this.state === TIMER_STATES.PAUSED) this.#event(nowMs, TIMER_STATES.PAUSED, 'manual_pause');
    else this.#set(TIMER_STATES.PAUSED, nowMs, 'manual_pause');
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  /** Resume listening; credit resumes only after the detector hears playing. */
  manualResume(nowMs) {
    if (this.startedAt === null || this.state === TIMER_STATES.ENDED || !this.manuallyPaused) return this.snapshot(nowMs);
    this.manuallyPaused = false;
    this.#set(TIMER_STATES.LISTENING, nowMs, 'manual_resume');
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  /** Freeze verified credit during a device-generated celebration announcement. */
  pauseForAnnouncement(nowMs) {
    this.#advance(nowMs);
    this.provisionalMs = 0;
    this.#set(TIMER_STATES.LISTENING, nowMs, 'celebration_announcement');
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  punchOut(nowMs) {
    if (this.startedAt === null) throw new Error('Session has not started');
    this.#advance(nowMs);
    // A short unresolved pause remains provisional and is excluded on punch-out.
    this.provisionalMs = 0;
    this.#set(TIMER_STATES.ENDED, nowMs, 'punch_out');
    this.lastAt = nowMs;
    return this.snapshot(nowMs);
  }

  correctActiveTime(deltaMs, nowMs, reason) {
    const delta = Math.trunc(Number(deltaMs));
    if (!Number.isFinite(delta) || !reason?.trim()) throw new Error('A valid correction and reason are required');
    this.activeMs = Math.max(0, this.activeMs + delta);
    this.#event(nowMs, this.state, 'manual_correction', { deltaMs: delta, reason: reason.trim() });
    return this.snapshot(nowMs);
  }

  snapshot(nowMs = this.lastAt) {
    return {
      state: this.state,
      activeMs: Math.round(this.activeMs),
      provisionalMs: Math.round(this.provisionalMs),
      elapsedMs: this.startedAt === null ? 0 : Math.max(0, Math.round(nowMs - this.startedAt)),
      events: [...this.events],
    };
  }

  #advance(nowMs) {
    const delta = Math.max(0, nowMs - this.lastAt);
    if (this.state === TIMER_STATES.PLAYING) this.activeMs += delta;
    if (this.state === TIMER_STATES.GRACE) this.provisionalMs += delta;
  }

  #expireGrace(nowMs) {
    if (this.state === TIMER_STATES.GRACE && this.provisionalMs >= this.thresholdMs) {
      // A long idle gap earns none of its initial grace seconds.
      this.provisionalMs = 0;
      this.#set(TIMER_STATES.PAUSED, nowMs, 'inactivity_threshold');
    }
  }

  #set(state, at, reason) {
    if (this.state === state && this.events.length) return;
    this.state = state;
    this.#event(at, state, reason);
  }

  #event(at, state, reason, details = {}) {
    this.events.push({ at, state, reason, ...details });
  }
}
