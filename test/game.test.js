const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame, laneRatios } = require('./helpers/game-harness');

const RUN_KEY = 'skifreedle-daily-run-v1';
const FIXED_DATE = '2026-05-26T12:00:00Z';

function dateKey(date = new Date(FIXED_DATE)) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

test('daily courses are deterministic by UTC date', () => {
  const first = loadGame({ width: 800, fixedDate: FIXED_DATE });
  const firstLayout = first.api.State.objects.map((object) => `${object.type}:${object.x.toFixed(2)}:${object.y.toFixed(2)}`);
  first.cleanup();

  const second = loadGame({ width: 800, fixedDate: FIXED_DATE });
  const secondLayout = second.api.State.objects.map((object) => `${object.type}:${object.x.toFixed(2)}:${object.y.toFixed(2)}`);
  second.cleanup();

  const nextDay = loadGame({ width: 800, fixedDate: '2026-05-27T12:00:00Z' });
  const nextLayout = nextDay.api.State.objects.map((object) => `${object.type}:${object.x.toFixed(2)}:${object.y.toFixed(2)}`);
  nextDay.cleanup();

  assert.deepEqual(firstLayout, secondLayout);
  assert.notDeepEqual(firstLayout, nextLayout);
});

test('daily courses have the same relative layout across viewport sizes', () => {
  const phone = loadGame({ width: 390, fixedDate: FIXED_DATE });
  const phoneRatios = laneRatios(phone.api.State.objects, 390, phone.api.terrainMarginForWidth);
  phone.cleanup();

  const desktop = loadGame({ width: 900, fixedDate: FIXED_DATE });
  const desktopRatios = laneRatios(desktop.api.State.objects, 900, desktop.api.terrainMarginForWidth);
  desktop.cleanup();

  assert.deepEqual(phoneRatios, desktopRatios);
});

test('custom courses load from ?c= and do not write daily localStorage', () => {
  const codecHarness = loadGame({ fixedDate: FIXED_DATE });
  const encoded = codecHarness.codec.encodeCourse({
    finishX: 0.25,
    objects: {
      tree: [{ x: 0.2, y: 500 }],
      rock: [{ x: 0.8, y: 900 }],
      mogul: [{ x: 0.5, y: 1200 }],
      lake: [{ x: 0.4, y: 1800 }],
      jump: [{ x: 0.6, y: 2400 }],
    },
  });
  codecHarness.cleanup();

  const writes = new Map();
  const harness = loadGame({ search: `?c=${encoded}`, store: writes, fixedDate: FIXED_DATE });
  const { State } = harness.api;

  assert.equal(State.isCustom, true);
  assert.equal(State.course.dateKey, 'custom');
  assert.equal(State.objects.filter((object) => object.type === 'smallTree').length, 1);
  assert.equal(State.objects.filter((object) => object.type === 'ice').length, 1);
  harness.api.reset({ custom: true });
  assert.equal(writes.size, 0);
  harness.cleanup();
});

test('practice retry keeps the same map and New Practice changes it', () => {
  const harness = loadGame({ fixedDate: FIXED_DATE });
  const { State, reset } = harness.api;

  const originalRandom = Math.random;
  let randomValue = 0.1;
  Math.random = () => randomValue;
  reset({ practice: true, freshPractice: true });
  const firstSeed = State.course.seed;
  const firstLayout = State.objects.map((object) => `${object.type}:${object.x.toFixed(2)}:${object.y.toFixed(2)}`);

  randomValue = 0.9;
  reset({ practice: true });
  const retryLayout = State.objects.map((object) => `${object.type}:${object.x.toFixed(2)}:${object.y.toFixed(2)}`);
  assert.equal(State.course.seed, firstSeed);
  assert.deepEqual(retryLayout, firstLayout);

  reset({ practice: true, freshPractice: true });
  assert.notEqual(State.course.seed, firstSeed);
  Math.random = originalRandom;
  harness.cleanup();
});

test('input actions are timestamped and compacted for ghost storage', () => {
  const harness = loadGame({ fixedDate: FIXED_DATE });
  const { State, reset, runControlAction, finishRun } = harness.api;

  reset();
  State.elapsed = 1.234;
  runControlAction('west');
  State.elapsed = 2.5;
  runControlAction('down');
  assert.deepEqual(State.currentRunActions, [
    { t: 1234, action: 'west' },
    { t: 2500, action: 'down' },
  ]);

  finishRun();
  const saved = JSON.parse(harness.store.get(RUN_KEY));
  assert.deepEqual(saved.ghost.actions, [[1234, 0], [2500, 2]]);
  harness.cleanup();
});

test('daily ghost storage only tracks the best tagged run', () => {
  const key = dateKey();
  const harness = loadGame({
    fixedDate: FIXED_DATE,
    store: new Map([[RUN_KEY, JSON.stringify({
      dateKey: key,
      attempts: 1,
      finished: true,
      elapsed: 10,
      bestTime: 10,
      ghostBestTime: 10,
      ghost: { duration: 10000, actions: [[0, 0]] },
    })]]),
  });
  const { State, persistRun } = harness.api;

  State.course.dateKey = key;
  State.finished = true;
  State.running = false;
  State.elapsed = 12;
  State.currentRunActions = [{ t: 0, action: 'east' }];
  persistRun();
  let saved = JSON.parse(harness.store.get(RUN_KEY));
  assert.equal(saved.bestTime, 10);
  assert.equal(saved.ghost.duration, 10000);
  assert.deepEqual(saved.ghost.actions, [[0, 0]]);

  State.elapsed = 9;
  State.course.bestTime = 9;
  State.currentRunActions = [{ t: 0, action: 'stop' }];
  persistRun();
  saved = JSON.parse(harness.store.get(RUN_KEY));
  assert.equal(saved.bestTime, 9);
  assert.equal(saved.ghost.duration, 9000);
  assert.deepEqual(saved.ghost.actions, [[0, 3]]);
  assert.equal(saved.ghostBestTime, 9);
  harness.cleanup();
});

test('stale untagged daily ghosts are rejected', () => {
  const key = dateKey();
  const harness = loadGame({
    fixedDate: FIXED_DATE,
    store: new Map([[RUN_KEY, JSON.stringify({
      dateKey: key,
      attempts: 3,
      finished: true,
      elapsed: 9,
      bestTime: 9,
      ghost: { duration: 9000, actions: [[0, 0]] },
    })]]),
  });

  assert.equal(harness.api.readStoredRun(key).ghost, null);
  harness.cleanup();
});

test('practice ghosts update only on successful bests', () => {
  const harness = loadGame({ fixedDate: FIXED_DATE });
  const { State, reset, finishRun, crash, runControlAction } = harness.api;

  reset({ practice: true, freshPractice: true });
  runControlAction('west');
  State.elapsed = 10;
  finishRun();
  assert.equal(State.ghostRun.duration, 10000);
  assert.equal(State.ghostRun.actions[0].action, 'west');

  reset({ practice: true });
  runControlAction('east');
  State.elapsed = 5;
  crash('Practice crash');
  assert.equal(State.ghostRun.duration, 10000);
  assert.equal(State.ghostRun.actions[0].action, 'west');

  reset({ practice: true });
  runControlAction('stop');
  State.elapsed = 9;
  finishRun();
  assert.equal(State.ghostRun.duration, 9000);
  assert.equal(State.ghostRun.actions[0].action, 'stop');
  harness.cleanup();
});

test('finish gate success, finish miss, and collision transitions', () => {
  const harness = loadGame({ fixedDate: FIXED_DATE });
  const { State, reset, updateFinishState, updateObjects } = harness.api;

  reset();
  State.player.x = State.course.finishX;
  State.player.y = State.course.finishY;
  updateFinishState();
  assert.equal(State.finished, true);
  assert.equal(State.running, false);

  reset();
  State.player.x = 0;
  State.player.y = State.course.finishY;
  updateFinishState();
  assert.equal(State.missedFinish, true);
  assert.ok(State.yeti);

  reset();
  State.objects.push({ type: 'rock', x: State.player.x, y: State.player.y, r: 12 });
  updateObjects(0.016);
  assert.equal(State.gameOver, true);
  assert.match(State.crashReason, /Rocked/);
  harness.cleanup();
});
