(() => {
  const canvas = document.getElementById('builder-canvas');
  const ctx = canvas.getContext('2d');
  const linkInput = document.getElementById('course-link');
  const statusEl = document.getElementById('builder-status');
  const copyButton = document.getElementById('copy-link');
  const testButton = document.getElementById('test-course');
  const clearButton = document.getElementById('clear-course');
  const toolButtons = Array.from(document.querySelectorAll('[data-tool]'));
  const codec = window.SkiFreedleCodec;
  const objectSheet = new Image();

  const COURSE_LENGTH = codec.COURSE_LENGTH;
  const MOBILE_COURSE_BREAKPOINT = 640;
  const TYPES = codec.TYPES;
  const SPRITES = {
    tree: { frame: [0, 28, 30, 34], scale: 0.75, anchor: 'bottom', yOffset: 11 },
    rock: { frame: [30, 52, 23, 11], scale: 0.85, anchor: 'bottom', yOffset: 6 },
    mogul: { frame: [143, 53, 43, 10], scale: 0.78, anchor: 'center', yOffset: 0 },
    jump: { frame: [109, 55, 32, 8], scale: 0.9, anchor: 'center', yOffset: 0 },
  };

  const state = {
    tool: 'tree',
    finishX: 0.5,
    objects: TYPES.reduce((objects, type) => {
      objects[type] = [];
      return objects;
    }, {}),
  };

  let logicalWidth = 480;
  let logicalHeight = Math.round(COURSE_LENGTH * 0.5);

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const yToCourse = (y) => clamp((y / logicalHeight) * COURSE_LENGTH, 0, COURSE_LENGTH);
  const courseToY = (y) => (y / COURSE_LENGTH) * logicalHeight;

  function terrainMarginForWidth(width) {
    if (width <= MOBILE_COURSE_BREAKPOINT) {
      return Math.max(8, Math.min(16, width * 0.03));
    }

    const oldMargin = Math.max(34, Math.min(72, width * 0.06));
    const oldCourseWidth = width - oldMargin * 2;
    const narrowedWidth = Math.max(120, oldCourseWidth / 3);
    return (width - narrowedWidth) * 0.5;
  }

  function xToRatio(x) {
    const margin = terrainMarginForWidth(logicalWidth);
    return clamp((x - margin) / (logicalWidth - margin * 2), 0, 1);
  }

  function ratioToX(ratio) {
    const margin = terrainMarginForWidth(logicalWidth);
    return margin + clamp(ratio, 0, 1) * (logicalWidth - margin * 2);
  }

  function playUrl() {
    const url = new URL('./', window.location.href);
    url.searchParams.set('c', codec.encodeCourse({
      finishX: state.finishX,
      objects: state.objects,
    }));
    return url.toString();
  }

  function updateLink() {
    linkInput.value = playUrl();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    linkInput.select();
    if (!document.execCommand('copy')) throw new Error('Copy command failed');
  }

  function setTool(tool) {
    state.tool = tool;
    for (const button of toolButtons) {
      button.classList.toggle('selected', button.dataset.tool === tool);
    }
  }

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    logicalWidth = Math.min(640, Math.max(320, window.innerWidth - 24));
    logicalHeight = Math.round(COURSE_LENGTH * 0.5);
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.width = Math.floor(logicalWidth * dpr);
    canvas.height = Math.floor(logicalHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    draw();
  }

  function drawGrid() {
    ctx.fillStyle = '#fffefe';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.strokeStyle = '#edf4fb';
    ctx.lineWidth = 1;
    for (let y = 0; y <= COURSE_LENGTH; y += 300) {
      const sy = Math.round(courseToY(y));
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(logicalWidth, sy);
      ctx.stroke();
    }

    ctx.strokeStyle = '#d9eafd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(logicalWidth * 0.5, 0);
    ctx.lineTo(logicalWidth * 0.5, logicalHeight);
    ctx.stroke();

    const margin = terrainMarginForWidth(logicalWidth);
    const edgeWidth = Math.max(0, margin - 16);
    if (edgeWidth > 0) {
      ctx.fillStyle = 'rgba(238, 247, 255, 0.72)';
      ctx.fillRect(0, 0, edgeWidth, logicalHeight);
      ctx.fillRect(logicalWidth - edgeWidth, 0, edgeWidth, logicalHeight);
      ctx.strokeStyle = '#d9eafd';
      ctx.beginPath();
      ctx.moveTo(edgeWidth, 0);
      ctx.lineTo(edgeWidth, logicalHeight);
      ctx.moveTo(logicalWidth - edgeWidth, 0);
      ctx.lineTo(logicalWidth - edgeWidth, logicalHeight);
      ctx.stroke();
    }
  }

  function drawSprite(sprite, x, y) {
    const [sx, sy, sw, sh] = sprite.frame;
    const dw = sw * sprite.scale;
    const dh = sh * sprite.scale;
    const dx = Math.round(x - dw * 0.5);
    const dy = Math.round(sprite.anchor === 'bottom' ? y - dh : y - dh * 0.5);
    ctx.drawImage(objectSheet, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function drawLake(x, y) {
    ctx.fillStyle = 'rgba(147, 214, 245, 0.72)';
    ctx.beginPath();
    ctx.ellipse(x, y, 26, 11, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f7fdff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 1);
    ctx.lineTo(x + 10, y - 7);
    ctx.moveTo(x - 4, y + 7);
    ctx.lineTo(x + 17, y + 1);
    ctx.stroke();
  }

  function drawObject(type, object) {
    const x = ratioToX(object.x);
    const y = courseToY(object.y);

    if (type === 'lake') {
      drawLake(x, y);
      return;
    }

    const sprite = SPRITES[type];
    if (sprite && objectSheet.complete && objectSheet.naturalWidth !== 0) {
      drawSprite(sprite, x, y + sprite.yOffset);
      return;
    }

    ctx.fillStyle = '#1d73be';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFinish() {
    const y = courseToY(COURSE_LENGTH);
    const x = ratioToX(state.finishX);
    ctx.strokeStyle = '#d31f2f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 55, y - 42);
    ctx.lineTo(x - 55, y + 42);
    ctx.stroke();
    ctx.strokeStyle = '#2369d8';
    ctx.beginPath();
    ctx.moveTo(x + 55, y - 42);
    ctx.lineTo(x + 55, y + 42);
    ctx.stroke();
    ctx.fillStyle = '#102942';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', x, y - 54);
  }

  function draw() {
    drawGrid();
    drawFinish();
    for (const type of TYPES) {
      for (const object of state.objects[type]) drawObject(type, object);
    }
    updateLink();
  }

  function nearestObject(x, y) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const type of TYPES) {
      for (const object of state.objects[type]) {
        const dx = ratioToX(object.x) - x;
        const dy = courseToY(object.y) - y;
        const distance = Math.hypot(dx, dy);
        if (distance < nearestDistance) {
          nearest = { type, object };
          nearestDistance = distance;
        }
      }
    }
    return nearestDistance <= 24 ? nearest : null;
  }

  function placeAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (state.tool === 'finish') {
      state.finishX = xToRatio(x);
      statusEl.textContent = 'Moved finish gate';
      draw();
      return;
    }

    if (state.tool === 'erase') {
      const nearest = nearestObject(x, y);
      if (nearest) {
        state.objects[nearest.type] = state.objects[nearest.type].filter((object) => object !== nearest.object);
        statusEl.textContent = `Removed ${nearest.type}`;
      }
      draw();
      return;
    }

    if (state.objects[state.tool].length >= 255) {
      statusEl.textContent = `Too many ${state.tool} objects`;
      return;
    }

    state.objects[state.tool].push({ x: xToRatio(x), y: yToCourse(y) });
    statusEl.textContent = `Placed ${state.tool}`;
    draw();
  }

  toolButtons.forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });

  objectSheet.addEventListener('load', draw);
  objectSheet.src = 'skifree-objects.png';

  canvas.addEventListener('click', placeAt);
  copyButton.addEventListener('click', () => {
    copyText(linkInput.value)
      .then(() => { statusEl.textContent = 'Copied playable link'; })
      .catch((error) => { statusEl.textContent = `Copy failed: ${error.message}`; });
  });
  testButton.addEventListener('click', () => { window.location.href = linkInput.value; });
  clearButton.addEventListener('click', () => {
    for (const type of TYPES) state.objects[type] = [];
    statusEl.textContent = 'Cleared course';
    draw();
  });
  window.addEventListener('resize', resize);

  resize();
})();
