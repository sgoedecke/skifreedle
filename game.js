(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const multEl = document.getElementById('mult');
  const speedEl = document.getElementById('speed');
  const overlay = document.getElementById('overlay');

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;
  let canvasScale = 1;
  const viewport = () => ({
    w: canvas.width / canvasScale,
    h: canvas.height / canvasScale,
  });
  const visibleViewport = () => ({
    w: Math.floor(window.visualViewport?.width || window.innerWidth),
    h: Math.floor(window.visualViewport?.height || window.innerHeight),
  });
  const COURSE_LENGTH = 3900;
  const FINISH_GATE_WIDTH = 150;
  const RUN_STORAGE_KEY = 'skifreedle-daily-run-v1';
  const MOBILE_COURSE_BREAKPOINT = 640;
  const TOUCH_REPEAT_MS = 170;
  const ACTIONS = ['west', 'east', 'down', 'stop'];
  const ACTION_CODES = ACTIONS.reduce((codes, action, index) => {
    codes[action] = index;
    return codes;
  }, {});
  const CUSTOM_TYPE_MAP = {
    tree: 'smallTree',
    rock: 'rock',
    mogul: 'thickSnow',
    lake: 'ice',
    jump: 'jump',
  };
  const FIXED_OBJECTS = {
    smallTree: { r: 16, w: 25, h: 32 },
    rock: { r: 11, w: 23, h: 11 },
    thickSnow: { r: 14, w: 43, h: 10 },
    ice: { r: 34, w: 92, h: 34 },
    jump: { r: 18, w: 32, h: 8 },
  };

  const sheets = {
    characters: new Image(),
    objects: new Image(),
  };
  sheets.characters.src = 'sprite-characters.png';
  sheets.objects.src = 'skifree-objects.png';

  const FRAMES = {
    skier: {
      east: [0, 0, 24, 34],
      esEast: [24, 0, 24, 34],
      sEast: [49, 0, 17, 34],
      south: [65, 0, 17, 34],
      sWest: [49, 37, 17, 34],
      wsWest: [24, 37, 24, 34],
      west: [0, 37, 24, 34],
      jumping: [84, 0, 32, 34],
      hit: [0, 78, 31, 31],
    },
    monster: {
      sEast1: [64, 112, 26, 43],
      sEast2: [90, 112, 32, 43],
      sWest1: [64, 158, 26, 43],
      sWest2: [90, 158, 32, 43],
    },
    objects: {
      smallTree: [0, 28, 30, 34],
      tallTree: [95, 66, 32, 64],
      thickSnow: [143, 53, 43, 10],
      rock: [30, 52, 23, 11],
      jump: [109, 55, 32, 8],
      signStart: [260, 103, 42, 27],
    },
  };

  const DIRECTIONS = [
    { name: 'west', x: 0, y: 0, angle: -Math.PI / 2 },
    { name: 'wsWest', x: -0.5, y: 0.6, angle: -0.93 },
    { name: 'sWest', x: -0.33, y: 0.85, angle: -0.45 },
    { name: 'south', x: 0, y: 1, angle: 0 },
    { name: 'sEast', x: 0.33, y: 0.85, angle: 0.45 },
    { name: 'esEast', x: 0.5, y: 0.6, angle: 0.93 },
    { name: 'east', x: 0, y: 0, angle: Math.PI / 2 },
  ];
  const SOUTH_INDEX = 3;

  function utcDateKey(date = new Date()) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createRng(seed) {
    return () => {
      seed += 0x6D2B79F5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRand(rng, min, max) {
    return rng() * (max - min) + min;
  }

  function formatTime(seconds) {
    return `${seconds.toFixed(2)}s`;
  }

  function msUntilUtcTomorrow(date = new Date()) {
    const tomorrow = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return Math.max(0, tomorrow - date.getTime());
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function courseCenterRatio(y, seed) {
    const phase = (seed % 6283) / 1000;
    const wave = Math.sin(y * 0.0044 + phase) * 0.27 + Math.sin(y * 0.0102 + phase * 0.53) * 0.11;
    return clamp(0.5 + wave, 0.16, 0.84);
  }

  function mapCourseX(ratio, width) {
    const margin = terrainMarginForWidth(width);
    return margin + clamp(ratio, 0, 1) * (width - margin * 2);
  }

  function readStoredRun(dateKey = utcDateKey()) {
    if (typeof localStorage === 'undefined') return null;

    try {
      const raw = localStorage.getItem(RUN_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || parsed.dateKey !== dateKey) return null;

      const elapsed = storedNumber(parsed.elapsed);
      const rawBestTime = storedNumber(parsed.bestTime);
      const bestTime = rawBestTime ?? elapsed;
      const ghostBestTime = storedNumber(parsed.ghostBestTime);
      const rawGhost = normalizeStoredGhost(parsed.ghost);
      const ghost = storedGhostMatchesBest(rawGhost, bestTime, ghostBestTime) ? rawGhost : null;
      return {
        dateKey: parsed.dateKey,
        seed: Number(parsed.seed) >>> 0,
        attempts: Math.max(0, Number(parsed.attempts) || 0),
        finished: Boolean(parsed.finished),
        elapsed,
        bestTime,
        ghost,
        ghostBestTime: ghost ? bestTime : null,
      };
    } catch (error) {
      console.warn('Could not read SkiFreedle daily run from localStorage:', error);
      return null;
    }
  }

  function storedNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function normalizeStoredGhost(ghost) {
    if (!ghost || !Array.isArray(ghost.actions)) return null;

    const duration = Math.max(0, Number(ghost.duration) || 0);
    const actions = ghost.actions
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return null;
        const t = Math.max(0, Math.round(Number(entry[0]) || 0));
        const action = ACTIONS[Number(entry[1])];
        return action ? { t, action } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);

    if (duration <= 0) return null;
    return { duration, actions };
  }

  function storedGhostMatchesBest(ghost, bestTime, ghostBestTime) {
    if (!ghost) return false;
    if (!Number.isFinite(bestTime)) return true;
    if (Number.isFinite(ghostBestTime)) return Math.abs(ghostBestTime - bestTime) < 0.005;

    // Legacy builds saved the latest ghost without tagging the best time.
    // That data is ambiguous, so ignore it rather than replaying a stale run.
    return false;
  }

  function currentRunGhostPayload() {
    if (State.running || State.elapsed <= 0) return null;

    return ghostPayloadFromRun({
      duration: Math.round(State.elapsed * 1000),
      actions: State.currentRunActions,
    });
  }

  function ghostPayloadFromRun(ghostRun) {
    if (!ghostRun) return null;

    return {
      duration: Math.round(ghostRun.duration),
      actions: ghostRun.actions
        .map((entry) => [entry.t, ACTION_CODES[entry.action]])
        .filter((entry) => Number.isFinite(entry[1])),
    };
  }

  function persistRun() {
    if (State.isPractice || State.isCustom) return;
    if (typeof localStorage === 'undefined') return;

    const existingRun = readStoredRun(State.course.dateKey);
    const hasFinishedResult = State.finished || Boolean(existingRun?.finished);
    const finishedElapsed = State.finished ? State.elapsed : existingRun?.elapsed ?? null;
    const currentGhost = currentRunGhostPayload();
    const existingGhost = ghostPayloadFromRun(existingRun?.ghost);
    const existingBest = existingRun?.bestTime;
    const isBestGhost = State.finished && currentGhost && (existingBest === null || typeof existingBest === 'undefined' || State.elapsed <= existingBest);
    const ghost = isBestGhost ? currentGhost : existingGhost;
    const ghostBestTime = isBestGhost ? State.elapsed : existingRun?.ghostBestTime ?? null;
    const payload = {
      dateKey: State.course.dateKey,
      seed: State.course.seed,
      attempts: State.attempts,
      finished: hasFinishedResult,
      elapsed: finishedElapsed,
      bestTime: State.course.bestTime ?? existingRun?.bestTime ?? null,
      ghost,
      ghostBestTime,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Could not save SkiFreedle daily run to localStorage:', error);
    }
  }

  const State = {
    running: false,
    gameOver: false,
    time: 0,
    elapsed: 0,
    cameraY: -160,
    crashReason: 'Wipeout!',
    objects: [],
    tracks: [],
    bonuses: [],
    yeti: null,
    attempts: 0,
    currentRunActions: [],
    ghostRun: null,
    ghost: null,
    isPractice: false,
    isCustom: false,
    customCourse: null,
    customParam: '',
    finished: false,
    missedFinish: false,
    course: {
      dateKey: '',
      seed: 0,
      finishY: COURSE_LENGTH,
      finishX: 0,
      finishWidth: FINISH_GATE_WIDTH,
      bestTime: null,
    },
    player: {
      x: 0,
      y: 0,
      directionIndex: SOUTH_INDEX,
      lastSide: 1,
      speed: 130,
      z: 0,
      vz: 0,
      airborne: false,
      airTime: 0,
      iceTimer: 0,
      hitRadius: 12,
    },
  };

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const { w, h } = visibleViewport();
    canvasScale = dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const p = State.player;
    if (!State.running && !State.gameOver) p.x = w * 0.5;
    p.x = clamp(p.x || w * 0.5, 38, w - 38);
  }

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  function turnWestFor(p, blockedByGameOver = false) {
    if (p.airborne || p.iceTimer > 0 || (blockedByGameOver && State.gameOver)) return;
    if (p.directionIndex === 0) {
      p.x -= 18;
      return;
    }
    p.directionIndex -= 1;
    p.lastSide = -1;
  }

  function turnEastFor(p, blockedByGameOver = false) {
    if (p.airborne || p.iceTimer > 0 || (blockedByGameOver && State.gameOver)) return;
    if (p.directionIndex === DIRECTIONS.length - 1) {
      p.x += 18;
      return;
    }
    p.directionIndex += 1;
    p.lastSide = 1;
  }

  function pointDownhillFor(p, blockedByGameOver = false) {
    if (p.iceTimer > 0 || (blockedByGameOver && State.gameOver)) return;
    p.directionIndex = SOUTH_INDEX;
  }

  function stopAcrossSlopeFor(p, blockedByGameOver = false) {
    if (p.airborne || p.iceTimer > 0 || (blockedByGameOver && State.gameOver)) return;
    p.directionIndex = p.directionIndex < SOUTH_INDEX || p.lastSide < 0 ? 0 : DIRECTIONS.length - 1;
  }

  function recordControlAction(action) {
    if (!State.running || !ACTIONS.includes(action)) return;
    State.currentRunActions.push({ t: Math.round(State.elapsed * 1000), action });
  }

  function applyControlAction(action, target, blockedByGameOver = false) {
    if (action === 'west') turnWestFor(target, blockedByGameOver);
    if (action === 'east') turnEastFor(target, blockedByGameOver);
    if (action === 'down') pointDownhillFor(target, blockedByGameOver);
    if (action === 'stop') stopAcrossSlopeFor(target, blockedByGameOver);
  }

  function runControlAction(action, { target = State.player, record = true } = {}) {
    if (record) recordControlAction(action);
    applyControlAction(action, target, target === State.player);
  }

  const touchControl = {
    pointerId: null,
    action: null,
    lastRepeat: 0,
  };

  function touchActionFromEvent(event) {
    const visible = visibleViewport();
    const rect = { left: 0, top: 0, width: visible.w, height: visible.h };
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const column = x / rect.width;

    if (column < 1 / 3) return 'west';
    if (column > 2 / 3) return 'east';
    return y > rect.height * 0.5 ? 'down' : 'stop';
  }

  function startTouchControl(event) {
    if (event.pointerType === 'mouse') return;
    if (!State.running) return;

    event.preventDefault();
    touchControl.pointerId = event.pointerId;
    touchControl.action = touchActionFromEvent(event);
    touchControl.lastRepeat = performance.now();
    canvas.setPointerCapture?.(event.pointerId);
    runControlAction(touchControl.action);
  }

  function moveTouchControl(event) {
    if (event.pointerId !== touchControl.pointerId) return;

    event.preventDefault();
    const action = touchActionFromEvent(event);
    if (action !== touchControl.action) {
      touchControl.action = action;
      touchControl.lastRepeat = performance.now();
      runControlAction(action);
    }
  }

  function stopTouchControl(event) {
    if (event.pointerId !== touchControl.pointerId) return;

    canvas.releasePointerCapture?.(event.pointerId);
    touchControl.pointerId = null;
    touchControl.action = null;
  }

  function updateTouchRepeat(now) {
    if (!State.running || !touchControl.action) return;
    if (touchControl.action !== 'west' && touchControl.action !== 'east') return;
    if (now - touchControl.lastRepeat < TOUCH_REPEAT_MS) return;

    touchControl.lastRepeat = now;
    runControlAction(touchControl.action);
  }

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'spacebar'].includes(key)) {
      event.preventDefault();
    }
    if ((key === ' ' || key === 'spacebar') && !State.running) reset({ practice: State.isPractice, custom: State.isCustom });
    if (key === 'arrowleft' || key === 'a') runControlAction('west');
    if (key === 'arrowright' || key === 'd') runControlAction('east');
    if (key === 'arrowdown' || key === 's') runControlAction('down');
    if (key === 'arrowup' || key === 'w') runControlAction('stop');
  });
  canvas.addEventListener('pointerdown', startTouchControl);
  canvas.addEventListener('pointermove', moveTouchControl);
  canvas.addEventListener('pointerup', stopTouchControl);
  canvas.addEventListener('pointercancel', stopTouchControl);
  overlay.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    if (event.target.dataset.action === 'play') reset({ practice: State.isPractice, custom: State.isCustom });
    if (event.target.dataset.action === 'practice') reset({ practice: true, freshPractice: true });
    if (event.target.dataset.action === 'share') shareFinishedRun(event.target);
  });

  function reset({ practice = false, custom = false, freshPractice = false } = {}) {
    const { w, h } = viewport();
    const isCustomRun = custom && State.customCourse;
    const dateKey = isCustomRun ? 'custom' : practice ? 'practice' : utcDateKey();
    const storedRun = practice || isCustomRun ? null : readStoredRun(dateKey);
    const sameDaily = !practice && !isCustomRun && State.course.dateKey === dateKey;
    const samePractice = practice && State.isPractice && !freshPractice;
    const sameCustom = isCustomRun && State.isCustom;
    const priorBest = practice
      ? samePractice ? State.course.bestTime : null
      : isCustomRun ? sameCustom ? State.course.bestTime : null
      : sameDaily ? State.course.bestTime : storedRun?.bestTime ?? null;
    const seed = practice
      ? samePractice ? State.course.seed : (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
      : undefined;
    const course = isCustomRun
      ? createCustomCourse(w, State.customCourse, priorBest)
      : createDailyCourse(w, dateKey, priorBest, seed);
    const ghostRun = practice
      ? samePractice ? State.ghostRun : null
      : isCustomRun ? sameCustom ? State.ghostRun : null
      : storedRun?.ghost ?? State.ghostRun ?? null;
    const previousAttempts = practice
      ? samePractice ? State.attempts : 0
      : isCustomRun ? sameCustom ? State.attempts : 0
      : sameDaily ? State.attempts : storedRun?.attempts ?? 0;
    Object.assign(State, {
      running: true,
      gameOver: false,
      time: 0,
      elapsed: 0,
      cameraY: -h * 0.34,
      crashReason: 'Wipeout!',
      objects: course.objects,
      tracks: [],
      bonuses: [],
      yeti: null,
      attempts: previousAttempts + 1,
      currentRunActions: [],
      ghostRun,
      ghost: createGhost(ghostRun, w),
      isPractice: practice,
      isCustom: Boolean(isCustomRun),
      finished: false,
      missedFinish: false,
      course: {
        dateKey: course.dateKey,
        seed: course.seed,
        finishY: course.finishY,
        finishX: course.finishX,
        finishWidth: course.finishWidth,
        bestTime: course.bestTime,
      },
    });
    Object.assign(State.player, createSkierState(w * 0.5));
    persistRun();
    overlay.classList.remove('show');
  }

  function terrainMarginForWidth(width) {
    if (width <= MOBILE_COURSE_BREAKPOINT) {
      return Math.max(8, Math.min(16, width * 0.03));
    }

    const oldMargin = Math.max(34, Math.min(72, width * 0.06));
    const oldCourseWidth = width - oldMargin * 2;
    const narrowedWidth = Math.max(120, oldCourseWidth / 3);
    return (width - narrowedWidth) * 0.5;
  }

  function terrainMargin() {
    return terrainMarginForWidth(viewport().w);
  }

  function objectRadius(type, rng = Math.random) {
    if (type === 'smallTree') return seededRand(rng, 14, 18);
    if (type === 'tallTree') return seededRand(rng, 18, 24);
    if (type === 'rock') return seededRand(rng, 9, 14);
    if (type === 'thickSnow') return seededRand(rng, 12, 18);
    if (type === 'jump') return seededRand(rng, 16, 22);
    return seededRand(rng, 28, 46);
  }

  function createFixedObject(type, x, y) {
    const fixed = FIXED_OBJECTS[type];
    if (!fixed) throw new Error(`Unsupported custom object type: ${type}`);

    const frame = FRAMES.objects[type];
    return {
      type,
      x,
      y,
      r: fixed.r,
      spriteW: frame ? frame[2] : undefined,
      spriteH: frame ? frame[3] : undefined,
      w: fixed.w,
      h: fixed.h,
      used: false,
      scored: false,
    };
  }

  function createSkierState(x) {
    return {
      x,
      y: 0,
      directionIndex: SOUTH_INDEX,
      lastSide: 1,
      speed: 130,
      z: 0,
      vz: 0,
      airborne: false,
      airTime: 0,
      iceTimer: 0,
      hitRadius: 12,
    };
  }

  function createGhost(ghostRun, width) {
    if (!ghostRun) return null;
    return {
      active: true,
      elapsed: 0,
      duration: ghostRun.duration / 1000,
      actionIndex: 0,
      actions: ghostRun.actions,
      usedObjects: new WeakSet(),
      player: createSkierState(width * 0.5),
    };
  }

  function createCustomCourse(width, customCourse, bestTime) {
    const margin = terrainMargin();
    const courseWidth = width - margin * 2;
    const finishY = COURSE_LENGTH;
    const finishX = mapCourseX(customCourse.finishX ?? 0.5, width);
    const finishWidth = Math.min(FINISH_GATE_WIDTH, Math.max(76, courseWidth * 0.64));
    const objects = [
      { type: 'start', x: width * 0.5, y: 8, r: 14 },
      {
        type: 'finish',
        x: finishX,
        y: finishY,
        r: 14,
        w: finishWidth,
        h: 70,
        used: false,
      },
    ];

    for (const [encodedType, gameType] of Object.entries(CUSTOM_TYPE_MAP)) {
      const entries = customCourse.objects?.[encodedType] || [];
      for (const entry of entries) {
        objects.push(createFixedObject(
          gameType,
          mapCourseX(entry.x ?? 0.5, width),
          clamp(entry.y ?? 0, 0, COURSE_LENGTH)
        ));
      }
    }

    return {
      dateKey: 'custom',
      seed: 0,
      finishY,
      finishX,
      finishWidth,
      bestTime,
      objects,
    };
  }

  function createDailyCourse(width, dateKey, bestTime, seedOverride) {
    const seed = typeof seedOverride === 'number' ? seedOverride >>> 0 : hashString(dateKey);
    const rng = createRng(seed);
    const margin = terrainMargin();
    const courseWidth = width - margin * 2;
    const finishY = COURSE_LENGTH;
    const finishX = mapCourseX(courseCenterRatio(finishY, seed), width);
    const finishWidth = Math.min(FINISH_GATE_WIDTH, Math.max(76, courseWidth * 0.64));
    const objects = [
      { type: 'start', x: width * 0.5, y: 8, r: 14 },
      {
        type: 'finish',
        x: finishX,
        y: finishY,
        r: 14,
        w: finishWidth,
        h: 70,
        used: false,
      },
    ];

    for (let y = 280; y < finishY - 210; y += seededRand(rng, 82, 128)) {
      const progress = y / finishY;
      const safeRatio = courseCenterRatio(y, seed);
      const safeGapRatio = 0.145 + progress * 0.025;
      const baseCount = 2 + Math.floor(progress * 3) + (rng() < 0.45 ? 1 : 0);
      const count = baseCount * 2;

      if (rng() < 0.18) {
        const type = rng() < 0.65 ? 'thickSnow' : 'jump';
        const r = objectRadius(type, rng);
        const frame = FRAMES.objects[type];
        objects.push({
          type,
          x: mapCourseX(clamp(safeRatio + seededRand(rng, -0.035, 0.035), 0, 1), width),
          y: y + seededRand(rng, -24, 18),
          r,
          spriteW: frame ? frame[2] : undefined,
          spriteH: frame ? frame[3] : undefined,
          w: r * seededRand(rng, 1.4, 2.0),
          h: r * seededRand(rng, 1.0, 1.4),
          used: false,
          scored: false,
        });
      }

      for (let i = 0; i < count; i += 1) {
        let xRatio = safeRatio;
        for (let attempt = 0; attempt < 14; attempt += 1) {
          xRatio = seededRand(rng, 0, 1);
          if (Math.abs(xRatio - safeRatio) > safeGapRatio) break;
        }
        if (Math.abs(xRatio - safeRatio) <= safeGapRatio) continue;

        const roll = rng();
        let type = null;
        if (roll < 0.402) type = 'smallTree';
        else if (roll < 0.541) type = 'tallTree';
        else if (roll < 0.6705) type = 'rock';
        else if (roll < 0.7945) type = 'thickSnow';
        else if (roll < 0.8575) type = 'jump';
        else if (roll < 0.9) type = 'ice';
        if (!type) continue;

        const r = objectRadius(type, rng);
        const frame = FRAMES.objects[type];
        objects.push({
          type,
          x: mapCourseX(xRatio, width),
          y: y + seededRand(rng, -18, 18),
          r,
          spriteW: frame ? frame[2] : undefined,
          spriteH: frame ? frame[3] : undefined,
          w: type === 'ice' ? r * seededRand(rng, 2.0, 3.2) : r * seededRand(rng, 1.4, 2.0),
          h: type === 'ice' ? r * seededRand(rng, 0.8, 1.2) : r * seededRand(rng, 1.0, 1.4),
          used: false,
          scored: false,
        });
      }
    }

    return {
      dateKey,
      seed,
      finishY,
      finishX,
      finishWidth,
      bestTime,
      objects,
    };
  }

  function updateSkier(p, dt, { recordTracks = false } = {}) {
    const { w } = viewport();
    const dir = DIRECTIONS[p.directionIndex];
    const onIce = p.iceTimer > 0;
    const ice = onIce ? 1.28 : 1;
    const downhill = dir.y;
    const airScale = p.airborne ? 0.3 : 1;
    const edgeDrag = onIce ? 0.04 : (1 - downhill) * 1.15;
    const drag = (onIce ? 0.08 : 0.32 + edgeDrag) * p.speed;
    const accel = (180 * Math.max(0.1, downhill) - drag) * airScale;
    p.speed = clamp(p.speed + accel * dt, 42, 500);

    if (p.iceTimer > 0) p.iceTimer = Math.max(0, p.iceTimer - dt);

    const vx = dir.x * p.speed * ice;
    const vy = dir.y * p.speed;
    p.x += vx * dt;
    if (vy > 0) p.y += Math.max(18, vy) * dt;

    const margin = terrainMargin();
    if (p.x < margin) {
      p.x = margin;
      p.directionIndex = Math.max(p.directionIndex, 1);
      p.speed *= 0.986;
    } else if (p.x > w - margin) {
      p.x = w - margin;
      p.directionIndex = Math.min(p.directionIndex, DIRECTIONS.length - 2);
      p.speed *= 0.986;
    }

    if (p.airborne) {
      p.airTime += dt;
      p.vz -= 780 * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = 0;
        p.airborne = false;
        p.airTime = 0;
      }
    }

    if (recordTracks) {
      const movedEnough = State.tracks.length === 0 || p.y - State.tracks[State.tracks.length - 1].y > 6;
      if (!p.airborne && movedEnough && dir.y > 0) State.tracks.push({ x: p.x, y: p.y, angle: dir.angle });
      while (State.tracks.length > 520 || (State.tracks[0] && State.tracks[0].y < State.cameraY - 90)) {
        State.tracks.shift();
      }
    }
  }

  function updatePlayer(dt) {
    updateSkier(State.player, dt, { recordTracks: true });
  }

  function hitCircle(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  }

  function hitEllipse(px, py, ex, ey, ew, eh) {
    const dx = (px - ex) / (ew * 0.5);
    const dy = (py - ey) / (eh * 0.5);
    return dx * dx + dy * dy <= 1;
  }

  function addBonus(text, x, y) {
    State.bonuses.push({ text, x, y, age: 0 });
  }

  function attemptLabel(count) {
    return count === 1 ? 'attempt' : 'attempts';
  }

  function customShareUrl() {
    return `https://skifreedle.com/?c=${encodeURIComponent(State.customParam)}`;
  }

  function runLabel() {
    if (State.isCustom) return 'Custom';
    if (State.isPractice) return 'Practice';
    return `Daily ${State.course.dateKey}`;
  }

  function shareText() {
    const courseLabel = State.isCustom
      ? customShareUrl()
      : `https://skifreedle.com/ ${State.isPractice ? 'practice' : State.course.dateKey}`;
    return [
      `🎿 ${courseLabel}`,
      `${formatTime(State.elapsed)} in ${State.attempts} ${attemptLabel(State.attempts)}`,
    ].join('\n');
  }

  function setShareStatus(message) {
    const status = overlay.querySelector('[data-share-status]');
    if (status) status.textContent = message;
  }

  async function copyText(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy command failed');
  }

  function shareFinishedRun(button) {
    copyText(shareText())
      .then(() => {
        button.textContent = 'Copied!';
        setShareStatus('Copied result 🎿');
      })
      .catch((error) => {
        setShareStatus(`Copy failed: ${error.message}`);
      });
  }

  function renderFinishedModal(isBest) {
    const course = State.course;
    const label = runLabel();
    const refreshLine = State.isPractice || State.isCustom
      ? ''
      : `<p>Refreshes in <strong data-refreshes-in>${formatCountdown(msUntilUtcTomorrow())}</strong></p>`;
    const buttons = State.isPractice || State.isCustom
      ? `
        <button data-action="share">Share 🎿</button>
        <button data-action="play">Try again (space)</button>
        <button data-action="practice">New Practice</button>
      `
      : `
        <button data-action="share">Share 🎿</button>
        <button data-action="play">Try again (space)</button>
        <button data-action="practice">Practice</button>
      `;
    overlay.querySelector('.panel').innerHTML = `
      <h1>Finished!</h1>
      <p>${label}: ${formatTime(State.elapsed)} in ${State.attempts} ${attemptLabel(State.attempts)} ${isBest ? '(best)' : ''}</p>
      <p>Best: ${course.bestTime === null ? '--' : formatTime(course.bestTime)}</p>
      ${refreshLine}
      ${buttons}
      <p class="share-status" data-share-status></p>
      <p class="modal-links"><a href="/about">About</a></p>
    `;
    overlay.classList.add('show');
  }

  function launchFromJump(object) {
    const p = State.player;
    if (p.airborne || object.used) return;
    object.used = true;
    p.airborne = true;
    p.vz = 305 + Math.min(130, p.speed * 0.27);
    p.speed = Math.min(575, p.speed + 45);
    addBonus('jump!', object.x, object.y - 20);
  }

  function launchGhostFromJump(ghost) {
    const p = ghost.player;
    if (p.airborne) return;
    p.airborne = true;
    p.vz = 305 + Math.min(130, p.speed * 0.27);
    p.speed = Math.min(575, p.speed + 45);
  }

  function updateGhostObjects(ghost) {
    const p = ghost.player;

    for (const object of State.objects) {
      if (object.y < p.y - 80 || object.y > p.y + 180) continue;
      if (object.type === 'start' || object.type === 'finish') continue;

      if (object.type === 'jump') {
        if (!ghost.usedObjects.has(object) && !p.airborne && hitEllipse(p.x, p.y + 9, object.x, object.y, object.w * 1.15, object.h * 1.2)) {
          ghost.usedObjects.add(object);
          launchGhostFromJump(ghost);
        }
        continue;
      }

      if (object.type === 'thickSnow') {
        if (!ghost.usedObjects.has(object) && !p.airborne && hitEllipse(p.x, p.y + 6, object.x, object.y, object.spriteW || 43, object.spriteH || 10)) {
          ghost.usedObjects.add(object);
          p.speed = Math.max(55, p.speed * 0.45);
        }
        continue;
      }

      if (object.type === 'ice') {
        if (!p.airborne && hitEllipse(p.x, p.y, object.x, object.y, object.w, object.h)) {
          if (!ghost.usedObjects.has(object) || p.iceTimer <= 0) {
            ghost.usedObjects.add(object);
            p.speed = Math.min(620, p.speed + 70);
          }
          p.iceTimer = 1.1;
        }
      }
    }
  }

  function updateGhost(dt) {
    const ghost = State.ghost;
    if (!ghost?.active) return;

    const nextElapsed = Math.min(ghost.duration, ghost.elapsed + dt);
    const nextMs = Math.round(nextElapsed * 1000);

    while (ghost.actionIndex < ghost.actions.length && ghost.actions[ghost.actionIndex].t <= nextMs) {
      runControlAction(ghost.actions[ghost.actionIndex].action, { target: ghost.player, record: false });
      ghost.actionIndex += 1;
    }

    const step = nextElapsed - ghost.elapsed;
    if (step > 0) {
      updateSkier(ghost.player, step);
      updateGhostObjects(ghost);
    }

    ghost.elapsed = nextElapsed;
    if (ghost.elapsed >= ghost.duration) ghost.active = false;
  }

  function rememberSessionGhost(isBest) {
    if (!State.isPractice && !State.isCustom) return;
    if (!isBest) return;
    State.ghostRun = normalizeStoredGhost(currentRunGhostPayload());
  }

  function finishRun() {
    State.running = false;
    State.gameOver = true;
    State.finished = true;

    const course = State.course;
    const previousBest = course.bestTime;
    const isBest = previousBest === null || State.elapsed < previousBest;
    if (isBest) course.bestTime = State.elapsed;

    rememberSessionGhost(isBest);
    persistRun();
    renderFinishedModal(isBest);
  }

  function startYetiChase() {
    if (State.missedFinish) return;
    State.missedFinish = true;
    const p = State.player;
    State.yeti = {
      x: State.course.finishX,
      y: p.y - 150,
      speed: Math.max(455, p.speed + 182),
    };
    addBonus('missed finish!', p.x, p.y - 40);
  }

  function crash(reason) {
    State.running = false;
    State.gameOver = true;
    State.crashReason = reason;
    const course = State.course;
    persistRun();

    overlay.querySelector('.panel').innerHTML = `
      <h1>${reason}</h1>
      <p>${runLabel()}: crashed at ${formatTime(State.elapsed)}</p>
      <p>${State.missedFinish ? 'You missed the finish gate and the yeti caught you.' : 'Reach the finish gate without hitting anything.'}</p>
      <p>Best: ${course.bestTime === null ? '--' : formatTime(course.bestTime)}</p>
      <button data-action="play">Try again (space)</button>
      <p class="modal-links"><a href="/about">About</a></p>
    `;
    overlay.classList.add('show');
  }

  function updateObjects(dt) {
    const p = State.player;

    for (const object of State.objects) {
      if (object.y < p.y - 80 || object.y > p.y + 180) continue;
      if (object.type === 'start' || object.type === 'finish') continue;

      if (object.type === 'jump') {
        if (hitEllipse(p.x, p.y + 9, object.x, object.y, object.w * 1.15, object.h * 1.2)) {
          launchFromJump(object);
        }
        continue;
      }

      if (object.type === 'thickSnow') {
        if (!p.airborne && hitEllipse(p.x, p.y + 6, object.x, object.y, object.spriteW || 43, object.spriteH || 10)) {
          if (!object.used) {
            object.used = true;
            p.speed = Math.max(55, p.speed * 0.45);
            addBonus('mogul!', object.x, object.y - 12);
          }
        }
        continue;
      }

      if (object.type === 'ice') {
        if (!p.airborne && hitEllipse(p.x, p.y, object.x, object.y, object.w, object.h)) {
          if (!object.used || p.iceTimer <= 0) {
            object.used = true;
            p.speed = Math.min(620, p.speed + 70);
            addBonus('sliding!', object.x, object.y - 14);
          }
          p.iceTimer = 1.1;
        }
        continue;
      }

      if (p.airborne && p.z > 10) continue;

      const isTree = object.type === 'smallTree' || object.type === 'tallTree';
      const hazardRadius = isTree ? object.r * 0.72 : object.r * 0.82;
      if (hitCircle(p.x, p.y + 7, p.hitRadius, object.x, object.y, hazardRadius)) {
        crash(object.type === 'rock' ? 'Rocked!' : 'Tree wipeout!');
        return;
      }

      const nearMiss = !object.scored && hitCircle(p.x, p.y + 7, p.hitRadius + 18, object.x, object.y, hazardRadius);
      if (nearMiss) {
        object.scored = true;
        addBonus('close!', object.x, object.y - 18);
      }
    }

    const minY = State.cameraY - 260;
    State.objects = State.objects.filter((object) => object.y > minY);
  }

  function updateYeti(dt) {
    const p = State.player;
    if (!State.missedFinish || !State.yeti) return;

    const y = State.yeti;
    const dx = p.x - y.x;
    const dy = p.y - y.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    y.speed = Math.min(644, y.speed + dt * 126);
    y.x += (dx / dist) * y.speed * dt;
    y.y += (dy / dist) * y.speed * dt;

    if (!p.airborne && hitCircle(p.x, p.y, 14, y.x, y.y, 21)) {
      crash('Eaten by the yeti!');
    }
  }

  function updateFinishState() {
    if (!State.running || State.finished || State.missedFinish) return;

    const p = State.player;
    const course = State.course;
    if (p.y < course.finishY) return;

    if (Math.abs(p.x - course.finishX) <= course.finishWidth * 0.5) {
      finishRun();
      return;
    }

    startYetiChase();
  }

  function update(dt) {
    State.time += dt;
    State.elapsed += dt;
    updatePlayer(dt);
    updateGhost(dt);

    const { h } = viewport();
    const targetCameraY = State.player.y - h * 0.34;
    State.cameraY = lerp(State.cameraY, targetCameraY, clamp(dt * 8, 0, 1));
    const downhillSpeed = State.player.speed * DIRECTIONS[State.player.directionIndex].y;
    updateObjects(dt);
    updateFinishState();
    if (State.running) updateYeti(dt);

    for (const bonus of State.bonuses) bonus.age += dt;
    State.bonuses = State.bonuses.filter((bonus) => bonus.age < 1.15);

    scoreEl.textContent = formatTime(State.elapsed);
    multEl.textContent = State.course.bestTime === null ? '--' : formatTime(State.course.bestTime);
    if (speedEl) speedEl.textContent = `${Math.floor(downhillSpeed / 3)} km/h`;
  }

  function updateRefreshCountdown() {
    const target = overlay.querySelector('[data-refreshes-in]');
    if (target) target.textContent = formatCountdown(msUntilUtcTomorrow());
  }

  function renderStartModal({ custom = false, error = '' } = {}) {
    const panel = overlay.querySelector('.panel');
    const errorLine = error ? `<p class="share-status">${error}</p>` : '';
    panel.innerHTML = `
      <h1>SkiFreedle</h1>
      ${errorLine}
      <p>Use WASD or touchscreen to ski.</p>
      <p>${custom
        ? 'Reach the custom finish gate without crashing.'
        : 'Reach today&apos;s finish gate in about 10 seconds without crashing. Miss the gate and the yeti will hunt you down.'}</p>
      <p class="modal-links"><a href="builder.html">Build a custom course</a> <span aria-hidden="true">·</span> <a href="/about">About</a></p>
      <button data-action="play">${custom ? 'Start Custom Course' : 'Start Today&apos;s Run'}</button>
    `;
    overlay.classList.add('show');
  }

  function worldToScreenY(y) {
    return y - State.cameraY;
  }

  function spriteReady(image) {
    return image.complete && image.naturalWidth !== 0;
  }

  function drawFrame(sheetName, frame, x, y, anchor = 'bottom', scale = 1) {
    const image = sheets[sheetName];
    if (!frame || !spriteReady(image)) return false;

    const [sx, sy, sw, sh] = frame;
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = Math.round(x - dw / 2);
    const dy = Math.round(anchor === 'center' ? y - dh / 2 : y - dh);
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    return true;
  }

  function hash(n) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawSnowfield(w, h) {
    ctx.fillStyle = '#fffefe';
    ctx.fillRect(0, 0, w, h);

    const base = Math.floor(State.cameraY / 62) * 62;
    for (let y = base; y < State.cameraY + h + 80; y += 62) {
      for (let col = 0; col < Math.ceil(w / 96) + 1; col += 1) {
        const seed = y * 0.11 + col * 13;
        const x = col * 96 + hash(seed) * 76;
        const sy = Math.round(worldToScreenY(y + hash(seed + 8) * 28));
        if (sy < -6 || sy > h + 6) continue;
        ctx.fillStyle = hash(seed + 1) > 0.55 ? '#e7f0fb' : '#f2f7fc';
        ctx.fillRect(Math.round(x), sy, 2, 2);
      }
    }

    const margin = terrainMargin();
    const edgeWidth = Math.max(0, margin - 16);
    if (edgeWidth > 0) {
      ctx.fillStyle = '#eef7ff';
      ctx.fillRect(0, 0, edgeWidth, h);
      ctx.fillRect(w - edgeWidth, 0, edgeWidth, h);
      ctx.strokeStyle = '#d9eafd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(edgeWidth, 0);
      ctx.lineTo(edgeWidth, h);
      ctx.moveTo(w - edgeWidth, 0);
      ctx.lineTo(w - edgeWidth, h);
      ctx.stroke();
    }
  }

  function drawTracks() {
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    for (let i = 1; i < State.tracks.length; i += 1) {
      const a = State.tracks[i - 1];
      const b = State.tracks[i];
      const ay = worldToScreenY(a.y);
      const by = worldToScreenY(b.y);
      if ((ay < -30 && by < -30) || (ay > viewport().h + 30 && by > viewport().h + 30)) continue;

      const alpha = clamp((by + 60) / (viewport().h + 120), 0.08, 0.26);
      ctx.strokeStyle = `rgba(70, 105, 145, ${alpha})`;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        const ax = a.x + Math.cos(a.angle) * side * 7;
        const bx = b.x + Math.cos(b.angle) * side * 7;
        ctx.moveTo(Math.round(ax), Math.round(ay));
        ctx.lineTo(Math.round(bx), Math.round(by));
      }
      ctx.stroke();
    }
  }

  function triangle(points, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function drawIce(x, y, w, h) {
    ctx.fillStyle = 'rgba(147, 214, 245, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, -0.12, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#f7fdff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.27, y - h * 0.05);
    ctx.lineTo(x + w * 0.18, y - h * 0.2);
    ctx.moveTo(x - w * 0.08, y + h * 0.2);
    ctx.lineTo(x + w * 0.32, y + h * 0.02);
    ctx.stroke();
  }

  function drawFinishGate(x, y, w) {
    for (const side of [-1, 1]) {
      const poleX = x + side * w * 0.5;
      ctx.strokeStyle = side < 0 ? '#d31f2f' : '#2369d8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(poleX, y - 36);
      ctx.lineTo(poleX, y + 34);
      ctx.stroke();
      triangle([[poleX, y - 36], [poleX + side * 24, y - 28], [poleX, y - 16]], side < 0 ? '#d31f2f' : '#2369d8');
    }
    ctx.fillStyle = '#102942';
    ctx.font = 'bold 15px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', x, y - 42);
    ctx.textAlign = 'start';
  }

  function drawYeti(yeti) {
    const x = yeti.x;
    const y = worldToScreenY(yeti.y);
    const movingRight = yeti.x < State.player.x;
    const step = Math.floor(State.time * 6) % 2 === 0 ? '1' : '2';
    const frame = FRAMES.monster[`${movingRight ? 'sEast' : 'sWest'}${step}`];

    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y + 21, 23, 7, 0, 0, TAU);
    ctx.fill();
    drawFrame('characters', frame, x, y + 32, 'bottom');
  }

  function drawSkier(p = State.player, { ghost = false } = {}) {
    const sy = worldToScreenY(p.y) - p.z * 0.28;
    const direction = DIRECTIONS[p.directionIndex].name;
    const frame = FRAMES.skier[p.airborne ? 'jumping' : direction];

    ctx.save();
    if (ghost) {
      ctx.globalAlpha = 0.45;
      ctx.filter = 'grayscale(1)';
    } else {
      ctx.fillStyle = `rgba(0, 0, 0, ${p.airborne ? 0.12 : 0.18})`;
      ctx.beginPath();
      ctx.ellipse(p.x, worldToScreenY(p.y) + 13, 15 - p.z * 0.018, 5, 0, 0, TAU);
      ctx.fill();
    }
    drawFrame('characters', frame, p.x, sy + 18, 'bottom');
    ctx.restore();
  }

  function drawObject(object) {
    const y = worldToScreenY(object.y);
    if (y < -80 || y > viewport().h + 90) return;

    if (object.type === 'start') {
      drawFrame('objects', FRAMES.objects.signStart, object.x, y + 24, 'bottom');
      return;
    }

    if (object.type === 'finish') {
      drawFinishGate(object.x, y, object.w);
      return;
    }

    const frame = FRAMES.objects[object.type];

    ctx.fillStyle = 'rgba(30, 56, 82, 0.12)';
    if (['smallTree', 'tallTree', 'rock'].includes(object.type)) {
      ctx.beginPath();
      ctx.ellipse(object.x, y + object.r * 0.86, object.r * 0.9, object.r * 0.22, 0, 0, TAU);
      ctx.fill();
    }

    if (frame) {
      const bottomY = ['smallTree', 'tallTree'].includes(object.type)
        ? y + object.r
        : y + frame[3] * 0.5;
      drawFrame('objects', frame, object.x, bottomY, 'bottom');
    } else if (object.type === 'ice') drawIce(object.x, y, object.w, object.h);
  }

  function drawBonuses() {
    ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    for (const bonus of State.bonuses) {
      const alpha = 1 - bonus.age / 1.15;
      ctx.fillStyle = `rgba(28, 87, 150, ${alpha})`;
      ctx.fillText(bonus.text, bonus.x, worldToScreenY(bonus.y) - bonus.age * 28);
    }
    ctx.textAlign = 'start';
  }

  function render() {
    const { w, h } = viewport();
    drawSnowfield(w, h);
    drawTracks();

    const drawables = State.objects
      .filter((object) => {
        const sy = worldToScreenY(object.y);
        return sy > -100 && sy < h + 120;
      })
      .map((object) => ({ y: object.y, draw: () => drawObject(object) }));

    if (State.yeti) drawables.push({ y: State.yeti.y + 22, draw: () => drawYeti(State.yeti) });
    if (State.ghost?.active) {
      drawables.push({ y: State.ghost.player.y + 10, draw: () => drawSkier(State.ghost.player, { ghost: true }) });
    }
    drawables.push({ y: State.player.y + 10, draw: () => drawSkier() });
    drawables.sort((a, b) => a.y - b.y);
    for (const drawable of drawables) drawable.draw();

    drawBonuses();

    if (State.player.iceTimer > 0 && State.running) {
      ctx.fillStyle = 'rgba(42, 124, 204, 0.85)';
      ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('ICE!', 14, h - 18);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    updateTouchRepeat(now);
    if (State.running) update(dt);
    render();
    updateRefreshCountdown();
    requestAnimationFrame(frame);
  }

  function initializeDailyState() {
    const { w } = viewport();
    const customParam = new URLSearchParams(window.location.search).get('c');
    const dateKey = utcDateKey();
    const storedRun = readStoredRun(dateKey);
    const course = createDailyCourse(w, dateKey, storedRun?.bestTime ?? null);

    if (customParam) {
      try {
        const customCourse = window.SkiFreedleCodec.decodeCourseParam(customParam);
        const custom = createCustomCourse(w, customCourse, null);
        State.course = {
          dateKey: custom.dateKey,
          seed: custom.seed,
          finishY: custom.finishY,
          finishX: custom.finishX,
          finishWidth: custom.finishWidth,
          bestTime: custom.bestTime,
        };
        State.objects = custom.objects;
        State.attempts = 0;
        State.isPractice = false;
        State.isCustom = true;
        State.customCourse = customCourse;
        State.customParam = customParam;
        renderStartModal({ custom: true });
        return;
      } catch (error) {
        console.warn('Could not load custom SkiFreedle course:', error);
        renderStartModal({ error: `Could not load custom course: ${error.message}` });
      }
    }

    State.course = {
      dateKey: course.dateKey,
      seed: course.seed,
      finishY: course.finishY,
      finishX: course.finishX,
      finishWidth: course.finishWidth,
      bestTime: course.bestTime,
    };
    State.objects = course.objects;
    State.attempts = storedRun?.attempts ?? 0;
    State.ghostRun = storedRun?.ghost ?? null;
    State.ghost = null;
    State.isPractice = false;
    State.isCustom = false;
    State.customCourse = null;
    State.customParam = '';

    if (storedRun?.finished && storedRun.elapsed !== null) {
      State.gameOver = true;
      State.finished = true;
      State.elapsed = storedRun.elapsed;
      State.course.bestTime = storedRun.bestTime;
      renderFinishedModal(State.course.bestTime === State.elapsed);
    }
  }

  scoreEl.textContent = '0.00s';
  multEl.textContent = '--';
  if (speedEl) speedEl.textContent = '0 km/h';
  initializeDailyState();
  requestAnimationFrame(frame);
})();
