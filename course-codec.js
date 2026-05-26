(() => {
  const VERSION = 1;
  const COURSE_LENGTH = 3900;
  const TYPES = ['tree', 'rock', 'mogul', 'lake', 'jump'];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const quantizeByte = (value) => Math.round(clamp(value, 0, 1) * 255);
  const dequantizeByte = (value) => clamp(value, 0, 255) / 255;

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function normalizeObjects(objects = {}) {
    return TYPES.reduce((normalized, type) => {
      normalized[type] = Array.isArray(objects[type]) ? objects[type] : [];
      return normalized;
    }, {});
  }

  function encodeCourse(course) {
    const objects = normalizeObjects(course.objects);
    const bytes = [VERSION, quantizeByte(course.finishX ?? 0.5)];

    for (const type of TYPES) {
      const entries = objects[type].slice(0, 255);
      bytes.push(entries.length);
      for (const object of entries) {
        const y = Math.round(clamp(object.y ?? 0, 0, COURSE_LENGTH));
        bytes.push(quantizeByte(object.x ?? 0.5), (y >> 8) & 0xff, y & 0xff);
      }
    }

    return bytesToBase64Url(bytes);
  }

  function decodeCourseParam(value) {
    if (!value) throw new Error('Missing custom course data');

    const bytes = base64UrlToBytes(value);
    let offset = 0;
    const version = bytes[offset++];
    if (version !== VERSION) throw new Error(`Unsupported custom course version: ${version}`);

    const finishX = dequantizeByte(bytes[offset++]);
    const objects = {};

    for (const type of TYPES) {
      const count = bytes[offset++];
      if (!Number.isFinite(count)) throw new Error(`Missing ${type} count`);
      objects[type] = [];

      for (let i = 0; i < count; i += 1) {
        if (offset + 2 >= bytes.length) throw new Error(`Truncated ${type} object list`);
        const x = dequantizeByte(bytes[offset++]);
        const y = (bytes[offset++] << 8) | bytes[offset++];
        objects[type].push({ x, y: clamp(y, 0, COURSE_LENGTH) });
      }
    }

    if (offset !== bytes.length) throw new Error('Unexpected trailing custom course data');
    return { version, finishX, objects };
  }

  window.SkiFreedleCodec = {
    VERSION,
    COURSE_LENGTH,
    TYPES,
    encodeCourse,
    decodeCourseParam,
  };
})();
