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

  const COURSE_LENGTH = codec.COURSE_LENGTH;
  const TYPES = codec.TYPES;
  const TYPE_META = {
    tree: { label: 'T', color: '#147438' },
    rock: { label: 'R', color: '#6d7782' },
    mogul: { label: 'M', color: '#79bdf2' },
    lake: { label: 'L', color: '#43b9e8' },
    jump: { label: 'J', color: '#df7a21' },
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
  let logicalHeight = 1600;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const xToRatio = (x) => clamp(x / logicalWidth, 0, 1);
  const yToCourse = (y) => clamp((y / logicalHeight) * COURSE_LENGTH, 0, COURSE_LENGTH);
  const ratioToX = (ratio) => ratio * logicalWidth;
  const courseToY = (y) => (y / COURSE_LENGTH) * logicalHeight;

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
    logicalHeight = 1600;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.width = Math.floor(logicalWidth * dpr);
    canvas.height = Math.floor(logicalHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  }

  function drawObject(type, object) {
    const meta = TYPE_META[type];
    const x = ratioToX(object.x);
    const y = courseToY(object.y);

    ctx.fillStyle = meta.color;
    if (type === 'lake') {
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 10, -0.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'jump') {
      ctx.beginPath();
      ctx.moveTo(x - 14, y + 8);
      ctx.lineTo(x + 14, y + 8);
      ctx.lineTo(x + 6, y - 9);
      ctx.lineTo(x - 10, y - 3);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, type === 'tree' ? 9 : 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.label, x, y);
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
