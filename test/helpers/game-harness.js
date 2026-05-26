const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const gameSource = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const codecSource = fs.readFileSync(path.join(root, 'course-codec.js'), 'utf8');

function makeElement(name, listeners) {
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
      toggle() {},
    },
    addEventListener(type, callback) {
      if (name === 'overlay') listeners.overlay[type] = callback;
      if (name === 'canvas') listeners.canvas[type] = callback;
    },
    querySelector() {
      return { innerHTML: '', textContent: '' };
    },
    setAttribute() {},
    select() {},
    remove() {},
  };
}

function installGlobals({ width = 800, height = 600, search = '', store = new Map(), frameLimit = 0, fixedDate } = {}) {
  const listeners = { window: {}, visualViewport: {}, overlay: {}, canvas: {} };
  let frames = 0;

  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  ctx.drawImage = () => undefined;

  const canvas = makeElement('canvas', listeners);
  canvas.getContext = () => ctx;
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });

  const overlay = makeElement('overlay', listeners);
  const elements = {
    game: canvas,
    overlay,
    score: makeElement('score', listeners),
    mult: makeElement('mult', listeners),
    speed: makeElement('speed', listeners),
  };

  const RealDate = global.Date;
  if (fixedDate) {
    global.Date = class extends RealDate {
      constructor(...args) {
        return args.length ? new RealDate(...args) : new RealDate(fixedDate);
      }

      static UTC(...args) { return RealDate.UTC(...args); }
      static now() { return new RealDate(fixedDate).getTime(); }
      static parse(value) { return RealDate.parse(value); }
    };
  }

  global.window = {
    devicePixelRatio: 2,
    innerWidth: width,
    innerHeight: height,
    location: { search, href: `https://skifreedle.test/${search}` },
    visualViewport: {
      width,
      height,
      addEventListener(type, callback) {
        listeners.visualViewport[type] = callback;
      },
    },
    addEventListener(type, callback) {
      listeners.window[type] = callback;
    },
  };
  global.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
  global.atob = (value) => Buffer.from(value, 'base64').toString('binary');
  global.Image = function Image() {
    this.complete = true;
    this.naturalWidth = 337;
    this.src = '';
    this.addEventListener = () => undefined;
  };
  global.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
  };
  global.navigator = { clipboard: { writeText: async () => undefined } };
  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeElement('textarea', listeners),
    body: { appendChild() {} },
    execCommand: () => true,
  };
  global.performance = { now: () => 0 };
  global.HTMLButtonElement = function HTMLButtonElement() {};
  global.requestAnimationFrame = (callback) => {
    if (frames++ < frameLimit) callback(frames * 16);
  };

  return {
    listeners,
    store,
    cleanup() {
      if (fixedDate) global.Date = RealDate;
    },
  };
}

function loadCodec(options = {}) {
  const harness = installGlobals(options);
  new Function(codecSource)();
  return { codec: global.window.SkiFreedleCodec, ...harness };
}

function loadGame(options = {}) {
  const harness = installGlobals(options);
  new Function(codecSource)();
  const instrumented = gameSource.replace(
    'requestAnimationFrame(frame);\n})();',
    `globalThis.__skiTest = {
      State,
      reset,
      finishRun,
      crash,
      updateFinishState,
      updateObjects,
      runControlAction,
      createDailyCourse,
      createCustomCourse,
      readStoredRun,
      persistRun,
      normalizeStoredGhost,
      rememberSessionGhost,
      createGhost,
      terrainMarginForWidth
    };\n})();`
  );
  new Function(instrumented)();
  return { api: global.__skiTest, codec: global.window.SkiFreedleCodec, ...harness };
}

function laneRatios(objects, width, terrainMarginForWidth) {
  const margin = terrainMarginForWidth(width);
  const laneWidth = width - margin * 2;
  return objects
    .filter((object) => !['start', 'finish'].includes(object.type))
    .slice(0, 50)
    .map((object) => `${object.type}:${object.y.toFixed(2)}:${((object.x - margin) / laneWidth).toFixed(4)}`);
}

module.exports = {
  loadCodec,
  loadGame,
  laneRatios,
};
