import { setAmbience } from './audio.mjs';
import { createRenderer, orientation } from './renderer.mjs';
import { buildWorld, seabed, zones } from './world.mjs';

const byId = id => document.getElementById(id);
const canvas = byId('ocean');
const stage = byId('stage');
const dive = byId('dive');
const sound = byId('sound');
const controls = byId('controls');
const stations = [...document.querySelectorAll('[data-zone]')];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const keys = new Set();
const moves = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

let renderer;
let zone = 0;
let diving = false;
let soundOn = false;
let ready = false;
let drag;
let time = 0;
let previous = 0;
let view;
let depthText;
let needsFrame = true;
const velocity = [0, 0, 0];

function resetView() {
  const { position, yaw, pitch } = zones[zone];
  view = { position: [...position], yaw, pitch };
  velocity.fill(0);
  needsFrame = true;
  updateReadings();
}

function updateReadings() {
  const reading = (-view.position[1]).toFixed(1);
  if (reading !== depthText) {
    depthText = reading;
    byId('depth').firstChild.nodeValue = reading + ' ';
  }
  byId('needle').style.transform = `rotate(${view.yaw}rad)`;
}

function select(index) {
  if (!ready || !zones[index]) return;
  zone = index;
  resetView();
  byId('scene-label').textContent = zones[index].name;
  stations.forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}

function setDiving(next, focus = true) {
  diving = next;
  stage.classList.toggle('is-diving', next);
  byId('intro').hidden = next;
  byId('active-tools').hidden = !next;
  byId('touch').hidden = !next;
  keys.clear();
  drag = undefined;
  velocity.fill(0);
  if (!focus) return;
  if (next) canvas.focus({ preventScroll: true });
  else if (!dive.disabled) dive.focus({ preventScroll: true });
}

function showStatus(message) {
  const element = byId('status');
  element.textContent = message;
  element.hidden = !message;
}

function setReady(state) {
  ready = state;
  dive.disabled = !state;
  stations.forEach(button => { button.disabled = !state; });
  if (state) byId('dive-label').textContent = '잠수 시작';
}

function look(dx, dy) {
  view.yaw -= dx;
  view.pitch = clamp(view.pitch - dy, -1.41, 1.41);
  needsFrame = true;
}

function move(dt) {
  const down = code => Number(keys.has(code));
  const turnX = down('ArrowRight') - down('ArrowLeft');
  const turnY = down('ArrowDown') - down('ArrowUp');
  if (turnX || turnY) look(turnX * dt * 1.55, turnY * dt * 1.25);

  const { forward, right } = orientation(view.yaw, view.pitch);
  const front = down('KeyW') - down('KeyS');
  const side = down('KeyD') - down('KeyA');
  const rise = down('KeyE') - down('KeyQ');
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 4.7;
  const desired = forward.map((axis, i) => axis * front + right[i] * side + (i === 1 ? rise : 0));
  const scale = speed / Math.max(1, Math.hypot(...desired));
  const blend = 1 - Math.exp(-dt * 6);
  if (!front && !side && !rise && Math.hypot(...velocity) < .015) return;

  const position = view.position.map((axis, i) => {
    velocity[i] += (desired[i] * scale - velocity[i]) * blend;
    return axis + velocity[i] * dt;
  });
  position[0] = clamp(position[0], -142, 143);
  position[2] = clamp(position[2], -100, 80);
  position[1] = clamp(position[1], seabed(position[0], position[2]) + .8, -1.3);

  // Push a proposed step away from solid rock and preserve tangential movement.
  for (const { center, radius } of renderer.obstacles) {
    const offset = position.map((axis, i) => axis - center[i]);
    const distance = Math.hypot(...offset.map((axis, i) => axis / (radius[i] + .42)));
    if (distance < 1 && distance > .0001) {
      for (let i = 0; i < 3; i++) position[i] = center[i] + offset[i] / distance;
    }
  }
  position[1] = clamp(position[1], seabed(position[0], position[2]) + .8, -1.3);
  view.position = position;
  needsFrame = true;
}

function frame(now) {
  if (!ready) return;
  const dt = previous ? Math.min(.05, (now - previous) / 1000) : 0;
  previous = now;
  if (diving && !controls.open) {
    move(dt);
    if (needsFrame) updateReadings();
  }
  if (!motion.matches) time += dt;
  if (needsFrame || !motion.matches) {
    renderer.render(view, time);
    needsFrame = false;
  }
  requestAnimationFrame(frame);
}

async function toggleSound() {
  const next = !soundOn;
  sound.disabled = true;
  try {
    await setAmbience(next);
    soundOn = next;
    sound.setAttribute('aria-pressed', String(next));
    byId('sound-label').textContent = next ? '소리 켜짐' : '소리 꺼짐';
  } catch (error) {
    console.warn('해저 사운드 초기화에 실패했습니다.', error);
    byId('sound-label').textContent = '소리 사용 불가';
  } finally {
    sound.disabled = false;
  }
}

canvas.tabIndex = -1;
dive.addEventListener('click', () => {
  if (ready) setDiving(true);
});
byId('pause').addEventListener('click', () => setDiving(false));
byId('help').addEventListener('click', () => {
  keys.clear();
  drag = undefined;
  velocity.fill(0);
  controls.showModal();
});
sound.addEventListener('click', toggleSound);
stations.forEach(button => button.addEventListener('click', () => {
  select(Number(button.dataset.zone));
  if (diving) canvas.focus({ preventScroll: true });
}));

window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || controls.open) return;
  if (event.code === 'Escape' && diving) setDiving(false);
  if (!event.repeat && event.code === 'KeyM' && !sound.disabled) toggleSound();
  if (!event.repeat && /^Digit[1-3]$/.test(event.code)) select(Number(event.code.at(-1)) - 1);
  if (diving && moves.has(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) keys.clear();
  previous = 0;
});
new ResizeObserver(() => { needsFrame = true; }).observe(canvas);

canvas.addEventListener('pointerdown', event => {
  if (!diving || drag || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  look((event.clientX - drag.x) * .005, (event.clientY - drag.y) * .005);
  drag.x = event.clientX;
  drag.y = event.clientY;
});
canvas.addEventListener('lostpointercapture', event => {
  if (drag?.id === event.pointerId) drag = undefined;
});

for (const button of byId('touch').querySelectorAll('button')) {
  const { key } = button.dataset;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    keys.add(key);
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('lostpointercapture', () => keys.delete(key));
}

resetView();
try {
  renderer = await createRenderer(canvas, buildWorld, () => {
    setReady(false);
    setDiving(false, false);
    byId('dive-label').textContent = '그래픽 연결 중단';
    showStatus('그래픽 연결이 끊겼습니다. 페이지를 새로고침해 주세요.');
  });
  renderer.render(view, time);
  setReady(true);
  requestAnimationFrame(frame);
} catch (error) {
  console.error('Afterlight WebGPU initialization failed:', error);
  byId('dive-label').textContent = '잠수 준비 실패';
  showStatus('WebGPU를 시작할 수 없습니다. 최신 Chrome 또는 Edge에서 하드웨어 가속을 켜고 다시 열어 주세요.');
}
