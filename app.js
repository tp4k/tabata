(function () {
  'use strict';

  const STORAGE_KEY_LAPS = 'tabata.laps';
  const STORAGE_KEY_WORK = 'tabata.work';
  const STORAGE_KEY_REST = 'tabata.rest';

  const DEFAULT_LAPS = 8;
  const DEFAULT_WORK = 20;
  const DEFAULT_REST = 10;

  const LAPS_MIN = 1;
  const LAPS_MAX = 99;
  const WORK_MIN = 5;
  const WORK_MAX = 600;
  const REST_MIN = 0;
  const REST_MAX = 600;

  const GET_READY_SECONDS = 3;
  const LEAD_IN_SECONDS = 0.1;

  const SCHEDULER_TICK_MS = 25;
  const LOOKAHEAD_SECONDS = 0.1;

  const COUNTDOWN_BEEP_WINDOW = 3;

  const COUNTDOWN_BEEP_FREQ = 880;
  const LAP_START_FREQ = 587.33;
  const FINAL_CHORD_FREQS = [523.25, 659.25, 783.99];

  const BEEP_DURATION = 0.12;
  const LAP_START_DURATION = 0.25;
  const FINAL_CHORD_DURATION = 1.2;

  const BEEP_GAIN = 0.3;
  const LAP_START_GAIN = 0.35;
  const FINAL_CHORD_GAIN = 0.25;

  const ENVELOPE_ATTACK_SECONDS = 0.005;
  const ENVELOPE_RELEASE_SECONDS = 0.03;
  const ENVELOPE_TAIL_SECONDS = 0.02;

  const DONE_DISPLAY_MS = 2500;

  const PHASE_GET_READY = 'getReady';
  const PHASE_WORK = 'work';
  const PHASE_REST = 'rest';
  const PHASE_DONE = 'done';

  const PHASE_LABEL_TEXT = {
    [PHASE_GET_READY]: 'GET READY',
    [PHASE_WORK]: 'WORK',
    [PHASE_REST]: 'REST',
    [PHASE_DONE]: 'DONE!'
  };

  const PHASE_CSS_CLASS = {
    [PHASE_GET_READY]: 'phase-get-ready',
    [PHASE_WORK]: 'phase-work',
    [PHASE_REST]: 'phase-rest',
    [PHASE_DONE]: 'phase-done'
  };

  const EVENT_KIND_COUNTDOWN = 'countdown';
  const EVENT_KIND_LAP_START = 'lapStart';
  const EVENT_KIND_FINAL = 'final';

  const configScreenEl = document.getElementById('config-screen');
  const activeScreenEl = document.getElementById('active-screen');
  const lapsInputEl = document.getElementById('input-laps');
  const workInputEl = document.getElementById('input-work');
  const restInputEl = document.getElementById('input-rest');
  const startButtonEl = document.getElementById('start-button');
  const pauseButtonEl = document.getElementById('pause-button');
  const stopButtonEl = document.getElementById('stop-button');
  const phaseLabelEl = document.getElementById('phase-label');
  const countdownEl = document.getElementById('countdown');
  const lapIndicatorEl = document.getElementById('lap-indicator');

  let audioCtx = null;
  let config = { laps: DEFAULT_LAPS, work: DEFAULT_WORK, rest: DEFAULT_REST };

  let phases = [];
  let events = [];
  let nextEventIndex = 0;
  let scheduledNodes = [];

  let startTime = 0;
  let pausedOffset = null;
  let isRunning = false;
  let isPaused = false;
  let completionTriggered = false;

  let schedulerTimerId = null;
  let rafId = null;
  let doneTimeoutId = null;
  let wakeLockSentinel = null;

  const NON_LAP_PHASE_KEY = -1;
  let currentPhaseIndex = 0;
  let lastRenderedSecond = null;
  let lastRenderedPhaseType = null;
  let lastRenderedLapKey = null;

  function clampInt(rawValue, min, max, fallback) {
    const parsed = parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function loadConfig() {
    const laps = clampInt(localStorage.getItem(STORAGE_KEY_LAPS), LAPS_MIN, LAPS_MAX, DEFAULT_LAPS);
    const work = clampInt(localStorage.getItem(STORAGE_KEY_WORK), WORK_MIN, WORK_MAX, DEFAULT_WORK);
    const rest = clampInt(localStorage.getItem(STORAGE_KEY_REST), REST_MIN, REST_MAX, DEFAULT_REST);
    return { laps, work, rest };
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY_LAPS, String(cfg.laps));
    localStorage.setItem(STORAGE_KEY_WORK, String(cfg.work));
    localStorage.setItem(STORAGE_KEY_REST, String(cfg.rest));
  }

  function buildPhases(anchorTime, laps, work, rest) {
    const builtPhases = [];
    let cursor = anchorTime;

    builtPhases.push({ type: PHASE_GET_READY, lap: 0, start: cursor, end: cursor + GET_READY_SECONDS });
    cursor += GET_READY_SECONDS;

    for (let lap = 1; lap <= laps; lap += 1) {
      builtPhases.push({ type: PHASE_WORK, lap, start: cursor, end: cursor + work });
      cursor += work;

      if (rest > 0 && lap < laps) {
        builtPhases.push({ type: PHASE_REST, lap, start: cursor, end: cursor + rest });
        cursor += rest;
      }
    }

    return builtPhases;
  }

  function buildEvents(builtPhases) {
    const builtEvents = [];

    for (const phase of builtPhases) {
      for (let k = 1; k <= COUNTDOWN_BEEP_WINDOW; k += 1) {
        const time = phase.end - k;
        if (time >= phase.start) {
          builtEvents.push({ time, kind: EVENT_KIND_COUNTDOWN });
        }
      }

      if (phase.type === PHASE_WORK) {
        builtEvents.push({ time: phase.start, kind: EVENT_KIND_LAP_START });
      }
    }

    const lastPhase = builtPhases[builtPhases.length - 1];
    builtEvents.push({ time: lastPhase.end, kind: EVENT_KIND_FINAL });

    builtEvents.sort((a, b) => a.time - b.time);
    return builtEvents;
  }

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    return audioCtx;
  }

  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  function scheduleTone(freqOrFreqs, time, duration, gainValue) {
    const ctx = audioCtx;
    const freqs = Array.isArray(freqOrFreqs) ? freqOrFreqs : [freqOrFreqs];

    for (const freq of freqs) {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, time);

      gainNode.gain.setValueAtTime(0, time);
      gainNode.gain.linearRampToValueAtTime(gainValue, time + ENVELOPE_ATTACK_SECONDS);
      gainNode.gain.setValueAtTime(gainValue, Math.max(time + ENVELOPE_ATTACK_SECONDS, time + duration - ENVELOPE_RELEASE_SECONDS));
      gainNode.gain.linearRampToValueAtTime(0, time + duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      const stopTime = time + duration + ENVELOPE_TAIL_SECONDS;
      oscillator.start(time);
      oscillator.stop(stopTime);

      const entry = { oscillator, gainNode, startTime: time, stopTime };
      scheduledNodes.push(entry);
      oscillator.onended = () => {
        const idx = scheduledNodes.indexOf(entry);
        if (idx !== -1) {
          scheduledNodes.splice(idx, 1);
        }
        oscillator.disconnect();
        gainNode.disconnect();
      };
    }
  }

  function fireEvent(evt) {
    if (evt.kind === EVENT_KIND_COUNTDOWN) {
      scheduleTone(COUNTDOWN_BEEP_FREQ, evt.time, BEEP_DURATION, BEEP_GAIN);
    } else if (evt.kind === EVENT_KIND_LAP_START) {
      scheduleTone(LAP_START_FREQ, evt.time, LAP_START_DURATION, LAP_START_GAIN);
    } else if (evt.kind === EVENT_KIND_FINAL) {
      scheduleTone(FINAL_CHORD_FREQS, evt.time, FINAL_CHORD_DURATION, FINAL_CHORD_GAIN);
    }
  }

  function silencePendingNodes() {
    if (!audioCtx) {
      return;
    }
    const now = audioCtx.currentTime;
    for (const entry of scheduledNodes.slice()) {
      if (entry.stopTime > now) {
        try {
          entry.gainNode.gain.cancelScheduledValues(now);
          entry.gainNode.gain.setValueAtTime(0, now);
          entry.oscillator.stop(now);
          entry.oscillator.disconnect();
          entry.gainNode.disconnect();
        } catch (err) {
          /* node may already be stopped */
        }
      }
    }
  }

  function schedulerTick() {
    if (!audioCtx) {
      return;
    }
    const now = audioCtx.currentTime;
    while (nextEventIndex < events.length && events[nextEventIndex].time <= now + LOOKAHEAD_SECONDS) {
      fireEvent(events[nextEventIndex]);
      nextEventIndex += 1;
    }
  }

  function startSchedulerLoop() {
    schedulerTimerId = setInterval(schedulerTick, SCHEDULER_TICK_MS);
  }

  function stopSchedulerLoop() {
    if (schedulerTimerId !== null) {
      clearInterval(schedulerTimerId);
      schedulerTimerId = null;
    }
  }

  function findCurrentPhase(now) {
    while (currentPhaseIndex < phases.length - 1 && now >= phases[currentPhaseIndex].end) {
      currentPhaseIndex += 1;
    }
    const phase = phases[currentPhaseIndex];
    if (phase && now < phase.end) {
      return phase;
    }
    return null;
  }

  function setPhaseBackground(phaseType) {
    activeScreenEl.className = PHASE_CSS_CLASS[phaseType];
  }

  function renderFrame(phase, now) {
    const duration = phase.end - phase.start;
    const remaining = Math.max(0, Math.min(phase.end - now, duration));
    const remainingSeconds = Math.ceil(remaining);

    if (remainingSeconds !== lastRenderedSecond) {
      countdownEl.textContent = String(remainingSeconds);
      lastRenderedSecond = remainingSeconds;
    }

    if (phase.type !== lastRenderedPhaseType) {
      phaseLabelEl.textContent = PHASE_LABEL_TEXT[phase.type];
      setPhaseBackground(phase.type);
      lastRenderedPhaseType = phase.type;
    }

    const lapKey = (phase.type === PHASE_WORK || phase.type === PHASE_REST) ? phase.lap : NON_LAP_PHASE_KEY;
    if (lapKey !== lastRenderedLapKey) {
      lapIndicatorEl.textContent = lapKey === NON_LAP_PHASE_KEY ? '' : `Lap ${lapKey} / ${config.laps}`;
      lastRenderedLapKey = lapKey;
    }
  }

  function rafLoop() {
    if (!isRunning) {
      return;
    }
    const now = audioCtx.currentTime;
    const phase = findCurrentPhase(now);

    if (phase) {
      renderFrame(phase, now);
      rafId = requestAnimationFrame(rafLoop);
    } else if (!completionTriggered) {
      handleComplete();
    }
  }

  function showConfigScreen() {
    activeScreenEl.classList.add('hidden');
    configScreenEl.classList.remove('hidden');
  }

  function showActiveScreen() {
    configScreenEl.classList.add('hidden');
    activeScreenEl.classList.remove('hidden');
    activeScreenEl.className = PHASE_CSS_CLASS[PHASE_GET_READY];
    pauseButtonEl.textContent = 'Pause';
  }

  function showDoneState() {
    setPhaseBackground(PHASE_DONE);
    phaseLabelEl.textContent = PHASE_LABEL_TEXT[PHASE_DONE];
    countdownEl.textContent = '';
    lapIndicatorEl.textContent = '';
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      return;
    }
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    } catch (err) {
      wakeLockSentinel = null;
    }
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isRunning && !isPaused && !completionTriggered) {
      acquireWakeLock();
    }
  });

  function startWorkout() {
    const ctx = getAudioContext();

    isRunning = true;
    isPaused = false;
    completionTriggered = false;
    pausedOffset = null;
    scheduledNodes = [];

    startTime = ctx.currentTime + LEAD_IN_SECONDS;
    phases = buildPhases(startTime, config.laps, config.work, config.rest);
    events = buildEvents(phases);
    nextEventIndex = 0;
    currentPhaseIndex = 0;
    lastRenderedSecond = null;
    lastRenderedPhaseType = null;
    lastRenderedLapKey = null;

    showActiveScreen();
    acquireWakeLock();
    startSchedulerLoop();
    rafId = requestAnimationFrame(rafLoop);
  }

  function pauseWorkout() {
    const ctx = audioCtx;
    isPaused = true;
    pausedOffset = ctx.currentTime - startTime;

    stopSchedulerLoop();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    silencePendingNodes();
    pauseButtonEl.textContent = 'Resume';
  }

  function resumeWorkout() {
    const ctx = audioCtx;
    startTime = ctx.currentTime - pausedOffset;
    pausedOffset = null;

    phases = buildPhases(startTime, config.laps, config.work, config.rest);
    events = buildEvents(phases);

    const now = ctx.currentTime;
    let resumeIndex = events.findIndex((evt) => evt.time > now);
    if (resumeIndex === -1) {
      resumeIndex = events.length;
    }
    nextEventIndex = resumeIndex;
    currentPhaseIndex = 0;
    lastRenderedSecond = null;
    lastRenderedPhaseType = null;
    lastRenderedLapKey = null;

    isPaused = false;
    pauseButtonEl.textContent = 'Pause';
    startSchedulerLoop();
    rafId = requestAnimationFrame(rafLoop);
  }

  function stopWorkout() {
    isRunning = false;
    isPaused = false;
    completionTriggered = false;
    pausedOffset = null;

    stopSchedulerLoop();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (doneTimeoutId !== null) {
      clearTimeout(doneTimeoutId);
      doneTimeoutId = null;
    }

    silencePendingNodes();
    releaseWakeLock();
    pauseButtonEl.textContent = 'Pause';
    showConfigScreen();
  }

  function handleComplete() {
    isRunning = false;
    completionTriggered = true;

    stopSchedulerLoop();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    releaseWakeLock();
    showDoneState();

    doneTimeoutId = setTimeout(() => {
      doneTimeoutId = null;
      releaseWakeLock();
      showConfigScreen();
    }, DONE_DISPLAY_MS);
  }

  function applyConfigToInputs(cfg) {
    lapsInputEl.value = cfg.laps;
    workInputEl.value = cfg.work;
    restInputEl.value = cfg.rest;
  }

  function readConfigFromInputs() {
    return {
      laps: clampInt(lapsInputEl.value, LAPS_MIN, LAPS_MAX, DEFAULT_LAPS),
      work: clampInt(workInputEl.value, WORK_MIN, WORK_MAX, DEFAULT_WORK),
      rest: clampInt(restInputEl.value, REST_MIN, REST_MAX, DEFAULT_REST)
    };
  }

  startButtonEl.addEventListener('click', () => {
    config = readConfigFromInputs();
    applyConfigToInputs(config);
    saveConfig(config);
    unlockAudio();
    startWorkout();
  });

  pauseButtonEl.addEventListener('click', () => {
    if (!isRunning || completionTriggered) {
      return;
    }
    if (isPaused) {
      resumeWorkout();
    } else {
      pauseWorkout();
    }
  });

  stopButtonEl.addEventListener('click', () => {
    stopWorkout();
  });

  config = loadConfig();
  applyConfigToInputs(config);
})();
