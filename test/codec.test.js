const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCodec } = require('./helpers/game-harness');

test('course codec round-trips grouped fixed objects', () => {
  const { codec, cleanup } = loadCodec();
  const encoded = codec.encodeCourse({
    finishX: 0.65,
    objects: {
      tree: [{ x: 0.2, y: 500 }],
      rock: [{ x: 0.8, y: 900 }],
      mogul: [{ x: 0.5, y: 1200 }],
      lake: [{ x: 0.4, y: 1800 }],
      jump: [{ x: 0.6, y: 2400 }],
    },
  });

  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const decoded = codec.decodeCourseParam(encoded);
  assert.equal(decoded.version, codec.VERSION);
  assert.equal(decoded.objects.tree.length, 1);
  assert.equal(decoded.objects.rock[0].y, 900);
  assert.equal(decoded.objects.jump[0].y, 2400);
  assert.ok(Math.abs(decoded.finishX - 0.65) < 0.01);
  cleanup();
});

test('course codec rejects malformed input', () => {
  const { codec, cleanup } = loadCodec();

  assert.throws(() => codec.decodeCourseParam(''), /Missing custom course data/);
  assert.throws(() => codec.decodeCourseParam('Ag'), /Unsupported custom course version/);
  assert.throws(() => codec.decodeCourseParam('AQA'), /Missing tree count|Truncated/);
  cleanup();
});

test('course codec clamps coordinates and caps per-type object counts', () => {
  const { codec, cleanup } = loadCodec();
  const manyTrees = Array.from({ length: 300 }, (_, index) => ({ x: index % 2 ? 2 : -1, y: index * 100 }));
  const encoded = codec.encodeCourse({ finishX: 2, objects: { tree: manyTrees } });
  const decoded = codec.decodeCourseParam(encoded);

  assert.equal(decoded.objects.tree.length, 255);
  assert.equal(decoded.finishX, 1);
  assert.equal(decoded.objects.tree[0].x, 0);
  assert.equal(decoded.objects.tree[1].x, 1);
  assert.equal(decoded.objects.tree.at(-1).y, codec.COURSE_LENGTH);
  cleanup();
});
