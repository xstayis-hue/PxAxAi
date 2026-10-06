import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const host = document.getElementById('room3d');
const loadingLabel = document.getElementById('scene-loading');
const errorLabel = document.getElementById('scene-error');
const assetRoot = new URL('./assets/scene3d/', import.meta.url);
const assetUrl = (name) => new URL(name, assetRoot).href;
const loader = new GLTFLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#090916');
scene.fog = new THREE.Fog('#090916', 10, 22);

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'low-power'
});
// тени выключены сознательно: renderer.shadowMap не включаем ради мобильного GPU,
// поэтому castShadow/receiveShadow на мешах не ставим
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.setAttribute('aria-label', 'Трёхмерная комната и персонаж Ai');
host.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40);
camera.position.set(0, 4.2, 8.4);
camera.lookAt(0, 1.55, -0.2);
const hemiLight = new THREE.HemisphereLight(0xc6d8ff, 0x161020, 2.05);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xf3eaff, 2.6);
keyLight.position.set(-3.5, 6, 5);
scene.add(keyLight);

const violetLight = new THREE.PointLight(0x944cff, 14, 8, 2);
violetLight.position.set(-2, 2.7, -1.5);
scene.add(violetLight);

const cyanLight = new THREE.PointLight(0x37ddf1, 11, 7, 2);
cyanLight.position.set(2.1, 2.4, -1.3);
scene.add(cyanLight);

const world = new THREE.Group();
scene.add(world);

/* --- экран монитора: canvas-текстура со слайдами ---
   В кадре монитор занимает ~55px, читаемого текста на нём не разместить, поэтому
   на экран идут слайды крупным планом (рынок, уверенность, полоса), а полный
   список — в панели слева. Слайды листаются сами. */
const monitorCanvas = document.createElement("canvas");
monitorCanvas.width = 512;
monitorCanvas.height = 320;
const monitorCtx = monitorCanvas.getContext("2d");
const monitorTexture = new THREE.CanvasTexture(monitorCanvas);
monitorTexture.colorSpace = THREE.SRGBColorSpace;
let monitorSlides = [];
let monitorSlideIndex = 0;
let monitorSlideTimer = 0;
const MONITOR_SLIDE_SECONDS = 4.5;
let monitorDate = "";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMonitorSlide() {
  const ctx = monitorCtx;
  ctx.fillStyle = "#06121c";
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = "#0b2b3a";
  ctx.fillRect(0, 0, 512, 42);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#7ff0ea";
  ctx.font = "700 20px system-ui, sans-serif";
  ctx.fillText(monitorDate ? "PXAX · AI-АНАЛИТИКА · " + monitorDate : "PXAX · AI-АНАЛИТИКА", 18, 22);
  ctx.fillStyle = "#5ce1f1";
  ctx.beginPath();
  ctx.arc(486, 21, 6, 0, Math.PI * 2);
  ctx.fill();
  const slide = monitorSlides[monitorSlideIndex % Math.max(1, monitorSlides.length)];
  if (!slide) {
    ctx.fillStyle = "#9fb6c8";
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillText("Собираю свежие данные…", 22, 170);
    monitorTexture.needsUpdate = true;
    return;
  }
  if (slide.kind === "promo") {
    ctx.fillStyle = "#ffc93c";
    ctx.font = "800 22px system-ui, sans-serif";
    ctx.fillText(slide.tag || "ПАРТНЁР", 22, 80);
    ctx.fillStyle = "#f2f7ff";
    ctx.font = "800 40px system-ui, sans-serif";
    ctx.fillText((slide.title || "").slice(0, 18), 22, 142);
    ctx.fillStyle = "#9fb6c8";
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.fillText((slide.sub || "").slice(0, 30), 22, 190);
    ctx.fillStyle = "#ffc93c";
    roundRect(ctx, 22, 228, 300, 46, 12);
    ctx.fill();
    ctx.fillStyle = "#0a0d16";
    ctx.font = "800 24px system-ui, sans-serif";
    ctx.fillText((slide.code || "").slice(0, 18), 38, 252);
  } else {
    ctx.fillStyle = "#9fb6c8";
    ctx.font = "600 21px system-ui, sans-serif";
    ctx.fillText((slide.league || "").slice(0, 26), 22, 78);
    ctx.fillStyle = "#f2f7ff";
    ctx.font = "800 32px system-ui, sans-serif";
    ctx.fillText((slide.title || "").slice(0, 22), 22, 122);
    ctx.fillStyle = "#5ce1f1";
    ctx.font = "800 42px system-ui, sans-serif";
    ctx.fillText(slide.market || "", 22, 176);
    if (slide.confidence) {
      ctx.fillStyle = "#f2f7ff";
      ctx.font = "800 38px system-ui, sans-serif";
      const label = slide.confidence + "%";
      ctx.fillText(label, 490 - ctx.measureText(label).width, 176);
      ctx.fillStyle = "rgba(139,163,199,.25)";
      roundRect(ctx, 22, 214, 340, 15, 8);
      ctx.fill();
      ctx.fillStyle = slide.value ? "#ffc93c" : "#5ce1f1";
      roundRect(ctx, 22, 214, Math.max(16, 340 * Math.min(1, slide.confidence / 100)), 15, 8);
      ctx.fill();
    }
    ctx.fillStyle = slide.value ? "#ffc93c" : "#6a8a9c";
    ctx.font = "700 21px system-ui, sans-serif";
    ctx.fillText(slide.value ? "VALUE · кэф " + (slide.odds || "") : (slide.odds ? "кэф " + slide.odds : ""), 22, 262);
  }
  monitorTexture.needsUpdate = true;
}

/* Слайды листаются сами: на экране в кадре ~55px, иначе больше одного
   прогноза за раз не показать. */
function updateMonitorSlides(delta) {
  if (!monitorSlides.length) return;
  monitorSlideTimer += delta;
  if (monitorSlideTimer >= MONITOR_SLIDE_SECONDS) {
    monitorSlideTimer = 0;
    monitorSlideIndex = (monitorSlideIndex + 1) % monitorSlides.length;
    drawMonitorSlide();
  }
}

function setMonitorSlides(payload) {
  const data = payload || {};
  monitorSlides = Array.isArray(data.slides) ? data.slides.slice(0, 12) : [];
  monitorDate = data.date || "";
  monitorSlideIndex = 0;
  monitorSlideTimer = 0;
  drawMonitorSlide();
}
drawMonitorSlide();

const material = (color, options = {}) => new THREE.MeshStandardMaterial({
  color,
  roughness: options.roughness === undefined ? 0.72 : options.roughness,
  metalness: options.metalness || 0,
  emissive: options.emissive || 0x000000,
  emissiveIntensity: options.emissiveIntensity || 0
});

function box(parent, name, color, position, size, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    material(color, options)
  );
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, name, color, position, radiusTop, radiusBottom, height, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12),
    material(color, options)
  );
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  parent.add(mesh);
  return mesh;
}

function createRoom() {
  const wallMat = material('#171527', { roughness: 0.92 });
  const floorMat = material('#111322', { roughness: 0.78 });
  const trimViolet = material('#9b61ff', { emissive: '#6831cf', emissiveIntensity: 1.2 });
  const trimCyan = material('#57e8f1', { emissive: '#17a8cc', emissiveIntensity: 1.1 });

  box(world, 'floor', '#111322', [0, -0.16, -0.05], [6.1, 0.3, 5.6]);
  box(world, 'back-wall-left', wallMat.color, [0.9, 2.02, -2.82], [4.3, 4.05, 0.18]);
  box(world, 'back-wall-right', wallMat.color, [-2.6, 2.02, -2.82], [0.9, 4.05, 0.18]);
  box(world, 'door-lintel', wallMat.color, [-1.65, 3.15, -2.82], [0.8, 1.8, 0.18]);
  box(world, 'left-wall', '#111321', [-3.06, 2.02, -0.06], [0.18, 4.05, 5.5]);
  box(world, 'right-wall', '#111321', [3.06, 2.02, -0.06], [0.18, 4.05, 5.5]);
  box(world, 'ceiling-edge', '#111322', [0, 4.05, -0.15], [6.15, 0.12, 5.25]);

  for (let i = 0; i < 8; i += 1) {
    const z = -2.45 + i * 0.68;
    box(world, `floor-seam-${i}`, '#283047', [0, 0.002, z], [5, 0.012, 0.018]);
  }
  box(world, 'floor-neon-left', trimViolet, [-2.91, 0.015, 0.1], [0.035, 0.025, 4.8]);
  box(world, 'floor-neon-right', trimCyan, [2.91, 0.015, 0.1], [0.035, 0.025, 4.8]);
  box(world, 'back-neon', trimViolet, [0, 3.88, -2.69], [4.75, 0.035, 0.025]);

  // Окно на правой части задней стены, под ним — рабочий стол, рядом кровать.
  const windowX = 0.6;
  const windowGlass = box(world, 'window-glass', '#132a46', [windowX, 2.42, -2.67], [1.7, 1.36, 0.035], {
    emissive: '#12446c',
    emissiveIntensity: 0.42,
    metalness: 0.25,
    roughness: 0.25
  });
  const cityMats = [];
  for (let i = 0; i < 6; i += 1) {
    const x = windowX - 0.74 + i * 0.296;
    const height = 0.36 + (i % 3) * 0.18;
    const tower = box(world, `city-tower-${i}`, i % 2 ? '#27315b' : '#1d274c',
      [x, 1.76 + height / 2, -2.63], [0.24, height, 0.035], {
        emissive: i % 2 ? '#263e83' : '#6b347f',
        emissiveIntensity: 0.55
      });
    cityMats.push(tower.material);
  }
  box(world, 'window-frame-top', '#565078', [windowX, 3.12, -2.61], [1.82, 0.075, 0.12]);
  box(world, 'window-frame-bottom', '#565078', [windowX, 1.72, -2.61], [1.82, 0.075, 0.12]);
  box(world, 'window-frame-left', '#565078', [windowX - 0.88, 2.42, -2.61], [0.075, 1.4, 0.12]);
  box(world, 'window-frame-right', '#565078', [windowX + 0.88, 2.42, -2.61], [0.075, 1.4, 0.12]);
  box(world, 'window-crossbar', '#565078', [windowX, 2.42, -2.6], [0.04, 1.35, 0.11]);

  const starCount = 64;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    starPositions[i * 3] = windowX - 0.8 + Math.random() * 1.6;
    starPositions[i * 3 + 1] = 1.86 + Math.random() * 1.18;
    starPositions[i * 3 + 2] = -2.652;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: '#dfe8ff',
    size: 0.018,
    transparent: true,
    opacity: 0,
    depthWrite: false
  }));
  stars.name = 'sky-stars';
  world.add(stars);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.115, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#eef1ff', transparent: true, opacity: 0 })
  );
  moon.name = 'sky-moon';
  moon.position.set(windowX + 0.55, 2.9, -2.648);
  world.add(moon);

  // Кровать вдоль правой стены, изголовье у задней — она оказывается и у окна.
  const bed = new THREE.Group();
  bed.position.set(2.21, 0, -1.55);
  world.add(bed);
  box(bed, 'bed-frame', '#272239', [0, 0.28, 0], [1.52, 0.38, 2.05]);
  box(bed, 'bed-mattress', '#b5a6d2', [0, 0.53, 0], [1.5, 0.2, 1.98]);
  box(bed, 'bed-blanket', '#544180', [0, 0.66, 0.35], [1.46, 0.08, 1.05], {
    emissive: '#25103e',
    emissiveIntensity: 0.28
  });
  box(bed, 'bed-neon-edge', '#b270ff', [0, 0.59, 1.02], [1.4, 0.025, 0.025], {
    emissive: '#963dff',
    emissiveIntensity: 1.3
  });
  box(bed, 'bed-headboard', '#302744', [0, 0.82, -0.94], [1.58, 0.86, 0.14]);
  box(bed, 'bed-pillow', '#d4c9e7', [0, 0.68, -0.68], [0.72, 0.16, 0.43]);
  for (const x of [-0.62, 0.62]) {
    for (const z of [-0.82, 0.82]) {
      cylinder(bed, `bed-leg-${x}-${z}`, '#72628e', [x, 0.1, z], 0.055, 0.075, 0.2);
    }
  }

  // Рабочее место под окном, сдвинуто к кровати: монитор справа (на нём идут
  // слайды AI-аналитики), ноутбук слева, за ним и садится Nova — так она не
  // заслоняет экран. Стол прижат к задней стене и пол больше не занимает.
  const desk = new THREE.Group();
  desk.position.set(0.6, 0, -2.3);
  world.add(desk);
  box(desk, "desk-top", "#29273e", [0, 0.86, 0], [1.5, 0.11, 0.46]);
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.15, 0.15]) {
      box(desk, "desk-leg-" + x + "-" + z, "#51466e", [x, 0.4, z], [0.06, 0.8, 0.06]);
    }
  }
  const monitorX = 0.24;
  box(desk, "monitor-case", "#1b1b31", [monitorX, 1.38, -0.14], [0.9, 0.62, 0.06], {
    metalness: 0.22
  });
  const monitorScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.53),
    new THREE.MeshBasicMaterial({ map: monitorTexture, toneMapped: false })
  );
  monitorScreen.name = "monitor-screen";
  monitorScreen.position.set(monitorX, 1.38, -0.108);
  desk.add(monitorScreen);
  box(desk, "monitor-stand", "#56506c", [monitorX, 1.06, -0.13], [0.07, 0.22, 0.07]);
  box(desk, "laptop-base", "#17182a", [-0.44, 0.93, 0.02], [0.46, 0.025, 0.3]);
  box(desk, "laptop-lid", "#1d1e33", [-0.44, 1.06, -0.11], [0.46, 0.26, 0.02]);
  box(desk, "laptop-glow", "#58e3ee", [-0.44, 1.06, -0.098], [0.4, 0.2, 0.008], {
    emissive: "#12627b",
    emissiveIntensity: 1.1
  });
  box(desk, "keyboard", "#17182a", [0.3, 0.935, 0.14], [0.5, 0.03, 0.18]);
  for (let i = 0; i < 5; i += 1) {
    box(desk, "keyboard-light-" + i, i % 2 ? "#55e2ee" : "#a66cff",
      [0.1 + i * 0.1, 0.953, 0.14], [0.05, 0.007, 0.013], {
        emissive: i % 2 ? "#2294ab" : "#7534c0",
        emissiveIntensity: 1
      });
  }

  const doorPivot = new THREE.Group();
  doorPivot.position.set(-2.05, 0.04, -2.57);
  world.add(doorPivot);
  box(doorPivot, 'door-panel', '#28223a', [0.43, 1.39, 0], [0.86, 2.7, 0.1]);
  box(doorPivot, 'door-inset', '#342746', [0.43, 1.45, 0.065], [0.68, 2.36, 0.035], {
    emissive: '#21153d',
    emissiveIntensity: 0.36
  });
  cylinder(doorPivot, 'door-knob', '#59e3ee', [0.77, 1.34, 0.11], 0.045, 0.045, 0.07, {
    emissive: '#179cb2',
    emissiveIntensity: 1.2
  });
  doorPivot.userData.closedRotation = doorPivot.rotation.y;
  box(world, 'door-frame-top', '#5b4a79', [-1.65, 2.88, -2.67], [1.02, 0.12, 0.16]);
  box(world, 'door-frame-left', '#5b4a79', [-2.15, 1.45, -2.67], [0.12, 2.85, 0.16]);
  box(world, 'door-frame-right', '#5b4a79', [-1.15, 1.45, -2.67], [0.12, 2.85, 0.16]);
  box(world, 'door-threshold', '#61dfea', [-1.65, 0.04, -2.56], [0.98, 0.08, 0.3], {
    emissive: '#168caa',
    emissiveIntensity: 0.95
  });

  // Куст ушёл в левый угол, вплотную к двери.
  const plantPot = cylinder(world, 'plant-pot', '#433152', [-2.62, 0.28, -2.3], 0.23, 0.18, 0.5);
  plantPot.rotation.z = Math.PI;
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.58 + (i % 2) * 0.2, 7),
      material(i % 2 ? '#5f4c9a' : '#377878', { emissive: '#241d46', emissiveIntensity: 0.35 })
    );
    leaf.position.set(-2.62 + Math.cos(i * 1.25) * 0.14, 0.72 + (i % 2) * 0.08, -2.3 + Math.sin(i * 1.25) * 0.14);
    leaf.rotation.z = Math.cos(i * 1.25) * 0.4;
    world.add(leaf);
  }

  const deliveryBox = new THREE.Group();
  deliveryBox.name = 'delivery-box';
  box(deliveryBox, 'pkg-body', '#caa2ff', [0, 0, 0], [0.22, 0.15, 0.16], { roughness: 0.55 });
  box(deliveryBox, 'pkg-tape', '#5ce1f1', [0, 0, 0], [0.235, 0.05, 0.05], {
    emissive: '#179cb2',
    emissiveIntensity: 0.9
  });
  deliveryBox.position.set(-1.58, 0.08, -2.22);
  deliveryBox.visible = false;
  world.add(deliveryBox);

  const hotspots = {
    bed: new THREE.Vector3(2.21, 0.95, -1.55),
    desk: new THREE.Vector3(0.6, 1.3, -2.3),
    door: new THREE.Vector3(-1.65, 1.6, -2.5)
  };
  const buttons = Array.from(host.querySelectorAll('[data-room-action]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      window.pxaxRoomAction(button.dataset.roomAction, false);
    });
  }
  return { bed, desk, doorPivot, hotspots, buttons, windowGlass, cityMats, stars, moon, deliveryBox };
}

const room = createRoom();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerStart = new THREE.Vector2();
const pointerTargets = [];
const clock = new THREE.Clock();
let characterRoot = null;
let posePivot = null;
let characterParts = [];
let characterBones = new Map();
let mixer = null;
let actions = {};
let currentAction = null;
let currentActionName = '';
let animationDuration = {};
let task = null;
let taskPhase = '';
let phaseTimer = 0;
let phaseDuration = 0;
let taskDurationSeconds = 0;
let phaseDeadline = 0;
let wakeRequested = false;
let phaseStartPosition = null;
let phaseStartRotation = 0;
let targetPosition = null;
let routeTargets = [];
let mode = 'room';
let frameId = 0;
let autoTimer = 0;
let rendererReady = false;
const furnitureBounds = [
  { minX: 1.45, maxX: 2.97, minZ: -2.6, maxZ: -0.5 },
  { minX: -0.15, maxX: 1.35, minZ: -2.55, maxZ: -2.05 },
  { minX: -2.92, maxX: -2.32, minZ: -2.6, maxZ: -2.0 }
];
const characterClearance = 0.27;
const walkBounds = { minX: -2.68, maxX: 2.68, minZ: -2.32, maxZ: 2.05 };
const pathGridStep = 0.16;

function overlapsFurniture(x, z) {
  return x < walkBounds.minX || x > walkBounds.maxX || z < walkBounds.minZ || z > walkBounds.maxZ
    || furnitureBounds.some((bounds) =>
    x >= bounds.minX - characterClearance
    && x <= bounds.maxX + characterClearance
    && z >= bounds.minZ - characterClearance
    && z <= bounds.maxZ + characterClearance
  );
}

function segmentIsClear(from, to) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 0.06));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (overlapsFurniture(x, z)) return false;
  }
  return true;
}

function findPath(start, target) {
  if (overlapsFurniture(start.x, start.z) || overlapsFurniture(target.x, target.z)) return null;
  if (segmentIsClear(start, target)) return [target.clone()];

  const columns = Math.floor((walkBounds.maxX - walkBounds.minX) / pathGridStep) + 1;
  const rows = Math.floor((walkBounds.maxZ - walkBounds.minZ) / pathGridStep) + 1;
  const pointAt = (column, row) => new THREE.Vector3(
    walkBounds.minX + column * pathGridStep,
    0,
    walkBounds.minZ + row * pathGridStep
  );
  const cellAt = (position) => ({
    column: THREE.MathUtils.clamp(Math.round((position.x - walkBounds.minX) / pathGridStep), 0, columns - 1),
    row: THREE.MathUtils.clamp(Math.round((position.z - walkBounds.minZ) / pathGridStep), 0, rows - 1)
  });
  const keyAt = (column, row) => row * columns + column;
  const startCell = cellAt(start);
  const targetCell = cellAt(target);
  const nearestClearCell = (cell) => {
    for (let radius = 0; radius < Math.max(columns, rows); radius += 1) {
      for (let row = Math.max(0, cell.row - radius); row <= Math.min(rows - 1, cell.row + radius); row += 1) {
        for (let column = Math.max(0, cell.column - radius); column <= Math.min(columns - 1, cell.column + radius); column += 1) {
          if (Math.max(Math.abs(column - cell.column), Math.abs(row - cell.row)) !== radius) continue;
          const point = pointAt(column, row);
          if (!overlapsFurniture(point.x, point.z)) return { column, row };
        }
      }
    }
    return null;
  };
  const safeStart = nearestClearCell(startCell);
  const safeTarget = nearestClearCell(targetCell);
  if (!safeStart || !safeTarget) return null;

  const startKey = keyAt(safeStart.column, safeStart.row);
  const targetKey = keyAt(safeTarget.column, safeTarget.row);
  const open = [startKey];
  const openSet = new Set(open);
  const closed = new Set();
  const previous = new Map();
  const scores = new Map([[startKey, 0]]);
  const estimate = (key) => {
    const column = key % columns;
    const row = Math.floor(key / columns);
    return Math.hypot(column - safeTarget.column, row - safeTarget.row) * pathGridStep;
  };

  while (open.length) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) {
      const candidate = open[i];
      const currentBest = open[bestIndex];
      if (scores.get(candidate) + estimate(candidate) < scores.get(currentBest) + estimate(currentBest)) bestIndex = i;
    }
    const currentKey = open.splice(bestIndex, 1)[0];
    openSet.delete(currentKey);
    if (currentKey === targetKey) break;
    closed.add(currentKey);

    const currentColumn = currentKey % columns;
    const currentRow = Math.floor(currentKey / columns);
    const currentPoint = pointAt(currentColumn, currentRow);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (!dx && !dz) continue;
        const column = currentColumn + dx;
        const row = currentRow + dz;
        if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
        const neighborPoint = pointAt(column, row);
        if (overlapsFurniture(neighborPoint.x, neighborPoint.z)
            || !segmentIsClear(currentPoint, neighborPoint)) continue;
        if (dx && dz) {
          const sideA = pointAt(currentColumn + dx, currentRow);
          const sideB = pointAt(currentColumn, currentRow + dz);
          if (overlapsFurniture(sideA.x, sideA.z) || overlapsFurniture(sideB.x, sideB.z)) continue;
        }
        const neighborKey = keyAt(column, row);
        if (closed.has(neighborKey)) continue;
        const nextScore = scores.get(currentKey) + Math.hypot(dx, dz) * pathGridStep;
        if (nextScore >= (scores.get(neighborKey) ?? Infinity)) continue;
        previous.set(neighborKey, currentKey);
        scores.set(neighborKey, nextScore);
        if (!openSet.has(neighborKey)) {
          open.push(neighborKey);
          openSet.add(neighborKey);
        }
      }
    }
  }

  if (targetKey !== startKey && !previous.has(targetKey)) return null;
  const reversed = [];
  let key = targetKey;
  while (key !== startKey) {
    reversed.push(pointAt(key % columns, Math.floor(key / columns)));
    key = previous.get(key);
  }
  const points = [start.clone(), ...reversed.reverse(), target.clone()];
  const simplified = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let furthest = points.length - 1;
    while (furthest > anchor + 1 && !segmentIsClear(points[anchor], points[furthest])) furthest -= 1;
    simplified.push(points[furthest]);
    anchor = furthest;
  }
  return simplified.slice(1);
}

function setRoomStatus(text, busy = false) {
  window.pxaxRoomUpdate?.(text, busy);
}

function reportError(error) {
  console.error('PXAX 3D scene failed:', error);
  errorLabel.textContent = '3D-сцена не загрузилась. Обнови приложение и попробуй ещё раз.';
  errorLabel.hidden = false;
  loadingLabel.hidden = true;
  setRoomStatus('Ошибка загрузки 3D-сцены');
}

/* --- день/ночь в комнате --- */
const DAY_LIGHTS = {
  bg: new THREE.Color('#090916'),
  hemiSky: new THREE.Color('#c6d8ff'),
  hemiGround: new THREE.Color('#161020'),
  hemiIntensity: 2.05,
  keyColor: new THREE.Color('#f3eaff'),
  keyIntensity: 2.6,
  violet: 14,
  cyan: 11,
  glass: 0.42,
  city: 0.55,
  sky: 0
};
const NIGHT_LIGHTS = {
  bg: new THREE.Color('#04040b'),
  hemiSky: new THREE.Color('#232a52'),
  hemiGround: new THREE.Color('#0c0a16'),
  hemiIntensity: 0.85,
  keyColor: new THREE.Color('#39406e'),
  keyIntensity: 0.55,
  violet: 19,
  cyan: 15,
  glass: 0.14,
  city: 1.05,
  sky: 0.95
};
let dayNight = 0.5;
let dayNightTarget = 0.5;
let dayNightNeedsApply = true;
function dayNightFactor(hour) {
  if (hour >= 22 || hour < 5) return 1;
  if (hour >= 19) return (hour - 19) / 3;
  if (hour < 8) return (8 - hour) / 3;
  return 0;
}
function setHour(hour) {
  dayNightTarget = dayNightFactor(Number(hour) || 0);
  dayNightNeedsApply = true;
}
function applyDayNight(delta) {
  if (!dayNightNeedsApply) return;
  const diff = dayNightTarget - dayNight;
  if (Math.abs(diff) < 0.002) {
    dayNight = dayNightTarget;
    dayNightNeedsApply = false;
  } else {
    dayNight += diff * Math.min(1, delta * 0.45);
  }
  const t = dayNight;
  scene.background.copy(DAY_LIGHTS.bg).lerp(NIGHT_LIGHTS.bg, t);
  scene.fog.color.copy(scene.background);
  hemiLight.color.copy(DAY_LIGHTS.hemiSky).lerp(NIGHT_LIGHTS.hemiSky, t);
  hemiLight.groundColor.copy(DAY_LIGHTS.hemiGround).lerp(NIGHT_LIGHTS.hemiGround, t);
  hemiLight.intensity = THREE.MathUtils.lerp(DAY_LIGHTS.hemiIntensity, NIGHT_LIGHTS.hemiIntensity, t);
  keyLight.color.copy(DAY_LIGHTS.keyColor).lerp(NIGHT_LIGHTS.keyColor, t);
  keyLight.intensity = THREE.MathUtils.lerp(DAY_LIGHTS.keyIntensity, NIGHT_LIGHTS.keyIntensity, t);
  violetLight.intensity = THREE.MathUtils.lerp(DAY_LIGHTS.violet, NIGHT_LIGHTS.violet, t);
  cyanLight.intensity = THREE.MathUtils.lerp(DAY_LIGHTS.cyan, NIGHT_LIGHTS.cyan, t);
  room.windowGlass.material.emissiveIntensity = THREE.MathUtils.lerp(DAY_LIGHTS.glass, NIGHT_LIGHTS.glass, t);
  for (const mat of room.cityMats) {
    mat.emissiveIntensity = THREE.MathUtils.lerp(DAY_LIGHTS.city, NIGHT_LIGHTS.city, t);
  }
  const skyOpacity = THREE.MathUtils.lerp(DAY_LIGHTS.sky, NIGHT_LIGHTS.sky, t);
  room.stars.material.opacity = skyOpacity;
  room.moon.material.opacity = skyOpacity * 0.95;
}

/* --- настроение: лёгкая idle-анимация --- */
let moodKey = '';
function setMood(key) {
  moodKey = String(key || '');
}
function applyMoodIdle(elapsed) {
  if (!posePivot || task) return;
  if (currentActionName !== 'Idle_Loop') return;
  const t = elapsed;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (moodKey === 'tired') {
    rx = 0.05;
  } else if (moodKey === 'lonely') {
    rz = Math.sin(t * 0.6) * 0.022 - 0.02;
    ry = 0.03;
  } else if (moodKey === 'happy') {
    ry = Math.sin(t * 1.1) * 0.045;
  } else if (moodKey === 'hungry') {
    rx = Math.abs(Math.sin(t * 1.6)) * 0.05;
  }
  posePivot.rotation.x += (rx - posePivot.rotation.x) * 0.08;
  posePivot.rotation.y += (ry - posePivot.rotation.y) * 0.08;
  posePivot.rotation.z += (rz - posePivot.rotation.z) * 0.08;
}

let widgetAnchorOn = false;

function scheduleWander() {
  window.clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => {
    if (mode === 'room' && !task && !document.hidden && !window.pxaxNeeds?.isSleepOrBathroom()) {
      const hour = new Date().getHours();
      const tired = window.pxaxNeeds?.isTired();
      const options = tired || hour >= 23 || hour < 7
        ? ['bed', 'bed', 'desk']
        : ['desk', 'desk', 'door', 'bed'];
      makeTask(options[Math.floor(Math.random() * options.length)]);
    }
    scheduleWander();
  }, 300000 + Math.random() * 300000);
}

function resize() {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = width < 400 ? 48 : 44;
  camera.updateProjectionMatrix();
}

function actionLoop(name, loop = true) {
  const next = actions[name];
  if (!next) {
    console.error(`PXAX 3D animation is missing: ${name}`);
    return null;
  }
  if (currentAction === next) return next;
  if (currentAction) currentAction.fadeOut(0.22);
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.fadeIn(0.22).play();
  currentAction = next;
  currentActionName = name;
  return next;
}

function findSkinnedMeshes(root) {
  const meshes = [];
  root.traverse((object) => {
    if (object.isSkinnedMesh) meshes.push(object);
  });
  return meshes;
}

function addRiggedPart(baseRoot, baseBones, gltf, tint, glow, partKey) {
  const partRoot = gltf.scene;
  partRoot.updateMatrixWorld(true);
  baseRoot.updateMatrixWorld(true);
  const baseInverse = baseRoot.matrixWorld.clone().invert();
  const meshes = findSkinnedMeshes(partRoot);
  if (!meshes.length) throw new Error(`No rigged mesh found in ${gltf.parser.json.asset.generator || 'asset'}`);

  for (const source of meshes) {
    const bones = source.skeleton.bones.map((bone) => baseBones.get(bone.name));
    if (bones.some((bone) => !bone)) throw new Error(`Incompatible character rig at ${source.name}`);
    const targetSkeleton = new THREE.Skeleton(
      bones,
      source.skeleton.boneInverses.map((inverse) => inverse.clone())
    );
    const mesh = source.clone(false);
    mesh.material = Array.isArray(source.material)
      ? source.material.map((item) => item.clone())
      : source.material.clone();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const item of materials) {
      item.color.set(tint);
      if (glow) {
        item.emissive.set(glow);
        item.emissiveIntensity = 0.24;
      }
    }
    const localMatrix = baseInverse.multiply(source.matrixWorld);
    mesh.matrix.copy(localMatrix);
    mesh.matrixAutoUpdate = false;
    mesh.bind(targetSkeleton, source.bindMatrix.clone());
    mesh.frustumCulled = false;
    baseRoot.add(mesh);
    characterParts.push(mesh);
    if (partKey && Array.isArray(wornParts[partKey])) wornParts[partKey].push(mesh);
  }
}

/* --- гардероб: смена образа и причёски --- */
const WARD = {
  outfit: {
    peasant: { src: () => assetUrl('Female_Peasant.glb'), tint: '#b09aff', glow: '#301256' },
    ranger: {
      src: () => 'https://raw.githubusercontent.com/Dallolz/moorfall-assets/main/outfits/Female_Ranger.glb',
      tint: '#a78bff',
      glow: '#2c2450'
    }
  },
  hair: {
    long: { src: () => assetUrl('Hair_Long.glb'), tint: '#7852bf', glow: '#34135b' },
    buns: { src: () => 'https://raw.githubusercontent.com/Dallolz/moorfall-assets/main/hair/Hair_Buns.glb', tint: '#ffffff', glow: null },
    parted: { src: () => 'https://raw.githubusercontent.com/Dallolz/moorfall-assets/main/hair/Hair_SimpleParted.glb', tint: '#ffffff', glow: null },
    buzz: { src: () => 'https://raw.githubusercontent.com/Dallolz/moorfall-assets/main/hair/Hair_BuzzedFemale.glb', tint: '#ffffff', glow: null }
  }
};
const wornParts = { outfit: [], hair: [] };
let wardrobeKeys = { outfit: 'peasant', hair: 'long' };
try {
  const storedWardrobe = JSON.parse(window.localStorage.getItem('pxax_ai_wardrobe_v1') || 'null');
  if (storedWardrobe && typeof storedWardrobe === 'object') {
    wardrobeKeys = {
      outfit: storedWardrobe.outfit === 'ranger' ? 'ranger' : 'peasant',
      hair: WARD.hair[storedWardrobe.hair] ? storedWardrobe.hair : 'long'
    };
  }
} catch (e) {
  wardrobeKeys = { outfit: 'peasant', hair: 'long' };
}

function removeWornPart(partKey) {
  for (const mesh of wornParts[partKey] || []) {
    mesh.parent?.remove(mesh);
    if (Array.isArray(mesh.material)) mesh.material.forEach((item) => item.dispose());
    else if (mesh.material) mesh.material.dispose();
  }
  wornParts[partKey] = [];
}

function loadWardPart(partKey, key) {
  const def = WARD[partKey] && WARD[partKey][key];
  if (!def) return Promise.reject(new Error('Unknown wardrobe item: ' + key));
  return new Promise((resolve, reject) => {
    loader.load(def.src(), resolve, undefined, reject);
  }).then((gltf) => {
    removeWornPart(partKey);
    addRiggedPart(characterRoot, characterBones, gltf, def.tint, def.glow, partKey);
  });
}

function setWardrobe(partKey, key) {
  if (!rendererReady || !WARD[partKey] || !WARD[partKey][key]) return Promise.resolve(false);
  if (wardrobeKeys[partKey] === key) return Promise.resolve(true);
  return loadWardPart(partKey, key).then(() => {
    wardrobeKeys[partKey] = key;
    return true;
  });
}

function attachDeliveryBox(attach) {
  const deliveryBox = room.deliveryBox;
  if (!deliveryBox) return;
  if (attach) {
    const hand = characterBones.get('hand_r') || characterBones.get('hand_01');
    if (hand) {
      hand.add(deliveryBox);
      deliveryBox.position.set(0.02, -0.05, 0.12);
      deliveryBox.rotation.set(0, 0.3, 0);
      deliveryBox.userData.attachedTo = hand;
      return;
    }
  }
  if (deliveryBox.userData.attachedTo) {
    deliveryBox.userData.attachedTo.remove(deliveryBox);
    delete deliveryBox.userData.attachedTo;
  }
  deliveryBox.position.set(-1.58, 0.08, -2.22);
  deliveryBox.rotation.set(0, 0.4, 0);
}

function makeTask(action, options = {}) {
  // действия разрешены и в chat-режиме: комната видна на фоне (opacity .48)
  if (task || !characterRoot) return false;
  task = action;
  taskPhase = 'walk-to';
  taskDurationSeconds = Math.max(0, Number(options.durationSeconds) || 0);
  phaseDeadline = 0;
  const taskPositions = {
    bed: new THREE.Vector3(2.21, 0, -0.15),
    sleep: new THREE.Vector3(2.21, 0, -0.15),
    desk: new THREE.Vector3(0.16, 0, -1.55),
    door: new THREE.Vector3(-1.55, 0, -1.55),
    toilet: new THREE.Vector3(-1.55, 0, -1.55),
    delivery: new THREE.Vector3(-1.55, 0, -1.55)
  };
  routeTargets = findPath(characterRoot.position, taskPositions[action]);
  if (!routeTargets) {
    task = null;
    taskPhase = '';
    setRoomStatus('Не удалось построить безопасный маршрут');
    return false;
  }
  targetPosition = routeTargets.shift();
  setRoomStatus(
    action === 'bed' ? 'Идёт отдохнуть' : action === 'desk' ? 'Идёт к ноутбуку'
      : action === 'delivery' ? 'Идёт к двери за посылкой' : 'Идёт к двери',
    true
  );
  actionLoop('Walk_Loop');
  return true;
}

function finishTask() {
  const done = task;
  task = null;
  taskPhase = '';
  targetPosition = null;
  taskDurationSeconds = 0;
  phaseDeadline = 0;
  wakeRequested = false;
  if (posePivot) posePivot.rotation.x = 0;
  if (characterRoot) characterRoot.position.y = 0;
  room.doorPivot.rotation.y = room.doorPivot.userData.closedRotation;
  if (characterRoot) characterRoot.visible = true;
  widgetAnchorOn = false;
  window.pxaxLaptopWidget?.(false);
  attachDeliveryBox(false);
  if (room.deliveryBox) room.deliveryBox.visible = false;
  actionLoop('Idle_Loop');
  const hour = new Date().getHours();
  setRoomStatus(hour >= 23 || hour < 7 ? 'В комнате тихая ночь' : 'Осматривает комнату');
  if (done === 'delivery') window.pxaxRoomTaskDone?.('delivery');
}

function walkTo(position, phase) {
  routeTargets = findPath(characterRoot.position, position);
  if (!routeTargets) {
    setRoomStatus('Не удалось построить безопасный маршрут');
    finishTask();
    return;
  }
  targetPosition = routeTargets.shift();
  taskPhase = phase;
  actionLoop('Walk_Loop');
}

function walkHomeFromBed() {
  walkTo(new THREE.Vector3(0, 0, 1.2), 'return');
}

function arriveAtTask() {
  if (task === 'bed' || task === 'sleep') {
    taskPhase = 'bed-enter';
    const action = actionLoop('Sitting_Enter', false);
    phaseDuration = Math.max(1.4, action ? animationDuration.Sitting_Enter || 1.4 : 1.4);
    phaseTimer = phaseDuration;
    phaseStartPosition = characterRoot.position.clone();
    phaseStartRotation = posePivot.rotation.x;
    if (task === 'sleep') setRoomStatus('Идёт спать', true);
    return;
  }
  if (task === 'desk') {
    taskPhase = 'desk-use';
    actionLoop('Interact');
    phaseTimer = 15 + Math.random() * 15;
    setRoomStatus('Работает за ноутбуком', true);
    widgetAnchorOn = true;
    window.pxaxLaptopWidget?.(true);
    return;
  }
  if (task === 'delivery') {
    taskPhase = 'delivery-door';
    actionLoop('Interact');
    phaseTimer = 1.7;
    room.doorPivot.rotation.y = room.doorPivot.userData.closedRotation + 1.1;
    if (room.deliveryBox) room.deliveryBox.visible = true;
    setRoomStatus('Получает посылку', true);
    return;
  }
  if (task === 'door' || task === 'toilet') {
    taskPhase = 'door-use';
    actionLoop('Interact');
    phaseTimer = 1.4;
    room.doorPivot.rotation.y = room.doorPivot.userData.closedRotation + 1.1;
    setRoomStatus(task === 'toilet' ? 'Ушла в туалет' : 'Ненадолго вышла за дверь', true);
  }
}

function updateTask(delta) {
  if (!task || !characterRoot) return;
  if (targetPosition) {
    const dx = targetPosition.x - characterRoot.position.x;
    const dz = targetPosition.z - characterRoot.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > 0.04) {
      const step = Math.min(distance, delta * 1.15);
      const nextX = characterRoot.position.x + (dx / distance) * step;
      const nextZ = characterRoot.position.z + (dz / distance) * step;
      if (overlapsFurniture(nextX, nextZ)) {
        const detour = findPath(characterRoot.position, targetPosition);
        if (!detour) {
          setRoomStatus('Не удалось обойти мебель', true);
          return;
        }
        routeTargets = detour;
        targetPosition = routeTargets.shift();
        setRoomStatus('Обходит мебель', true);
        return;
      }
      characterRoot.position.x = nextX;
      characterRoot.position.z = nextZ;
      characterRoot.rotation.y = Math.atan2(dx, dz);
      return;
    }
    characterRoot.position.x = targetPosition.x;
    characterRoot.position.z = targetPosition.z;
    targetPosition = null;
    if (taskPhase === 'walk-to' && routeTargets.length) targetPosition = routeTargets.shift();
    else if (taskPhase === 'walk-to') arriveAtTask();
    else if (taskPhase === 'return') finishTask();
  }

  if (targetPosition) return;
  if (taskPhase === 'bed-enter') {
    phaseTimer -= delta;
    const progress = THREE.MathUtils.clamp(1 - Math.max(0, phaseTimer) / phaseDuration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    characterRoot.position.lerpVectors(
      phaseStartPosition,
      new THREE.Vector3(2.21, -0.15, -1.55),
      eased
    );
    posePivot.rotation.x = phaseStartRotation + (-Math.PI / 2 - phaseStartRotation) * eased;
    if (phaseTimer <= 0) {
      characterRoot.position.set(2.21, -0.15, -1.55);
      posePivot.rotation.x = -Math.PI / 2;
      taskPhase = 'bed-rest';
      actionLoop('Idle_Loop');
      phaseTimer = task === 'sleep' ? Math.max(0, taskDurationSeconds) : 6;
      if (wakeRequested) phaseTimer = 0;
      setRoomStatus(task === 'sleep' ? 'Спит' : 'Лежит на кровати', true);
    }
  } else if (taskPhase === 'bed-rest') {
    phaseTimer -= delta;
    if (phaseTimer <= 0) {
      taskPhase = 'bed-exit';
      const action = actionLoop('Sitting_Exit', false);
      phaseDuration = Math.max(1.3, action ? animationDuration.Sitting_Exit || 1.3 : 1.3);
      phaseTimer = phaseDuration;
      phaseStartPosition = characterRoot.position.clone();
      phaseStartRotation = posePivot.rotation.x;
    }
  } else if (taskPhase === 'bed-exit') {
    phaseTimer -= delta;
    const progress = THREE.MathUtils.clamp(1 - Math.max(0, phaseTimer) / phaseDuration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    characterRoot.position.lerpVectors(
      phaseStartPosition,
      new THREE.Vector3(2.21, 0, -0.15),
      eased
    );
    posePivot.rotation.x = phaseStartRotation * (1 - eased);
    if (phaseTimer <= 0) {
      characterRoot.position.set(2.21, 0, -0.15);
      posePivot.rotation.x = 0;
      walkHomeFromBed();
    }
  } else if (taskPhase === 'desk-use') {
    phaseTimer -= delta;
    const typing = Math.sin(performance.now() * 0.012) * 0.11;
    const leftHand = characterBones.get('hand_l');
    const rightHand = characterBones.get('hand_r');
    if (leftHand) leftHand.rotation.x += typing;
    if (rightHand) rightHand.rotation.x -= typing;
    if (phaseTimer <= 0) walkTo(new THREE.Vector3(0, 0, 1.2), 'return');
  } else if (taskPhase === 'delivery-door') {
    phaseTimer -= delta;
    if (phaseTimer <= 0) {
      taskPhase = 'delivery-carry';
      attachDeliveryBox(true);
      setRoomStatus('Несёт посылку', true);
      walkTo(new THREE.Vector3(0, 0, 1.2), 'return');
    }
  } else if (taskPhase === 'door-use') {
    phaseTimer -= delta;
    if (phaseTimer <= 0) {
      taskPhase = 'door-away';
      characterRoot.visible = false;
      if (task === 'toilet') phaseDeadline = Date.now() + taskDurationSeconds * 1000;
      else phaseTimer = 1.3;
    }
  } else if (taskPhase === 'door-away') {
    if (task === 'toilet' ? Date.now() >= phaseDeadline : (phaseTimer -= delta) <= 0) {
      characterRoot.position.set(0, 0, 1.2);
      characterRoot.visible = true;
      room.doorPivot.rotation.y = room.doorPivot.userData.closedRotation;
      finishTask();
    }
  }
}

function positionHotspots() {
  // камера статична: пишем стили в DOM только при реальном изменении, а не каждый кадр
  for (const button of room.buttons) {
    // Кнопки хотспотов живут в index.html, а их точки — в room.hotspots здесь,
    // и списки легко расходятся. Без проверки обращение к несуществующей точке
    // бросает исключение в первом же кадре, цикл рвётся до render(), и комната
    // остаётся пустым холстом — поэтому отсутствующую кнопку просто прячем.
    const hotspot = room.hotspots[button.dataset.roomAction];
    if (!hotspot) {
      if (!button._orphan) {
        button._orphan = true;
        button.hidden = true;
        button.disabled = true;
      }
      continue;
    }
    const point = hotspot.clone().project(camera);
    const x = THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * host.clientWidth, 50, host.clientWidth - 50);
    const y = THREE.MathUtils.clamp((-point.y * 0.5 + 0.5) * host.clientHeight, 28, host.clientHeight - 30);
    const hidden = mode !== 'room' || point.z < -1 || point.z > 1;
    const disabled = !!task;
    if (button._px === x && button._py === y && button._ph === hidden && button._pd === disabled) continue;
    button._px = x;
    button._py = y;
    button._ph = hidden;
    button._pd = disabled;
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
    // невидимая зона клика поверх объекта (CSS width/height = 0, растягиваем отсюда)
    button.style.width = '120px';
    button.style.height = '90px';
    button.hidden = hidden;
    button.disabled = disabled;
  }
  if (widgetAnchorOn) {
    const point = room.hotspots.desk.clone().project(camera);
    const visible = mode === 'room' && point.z > -1 && point.z < 1;
    const x = THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * host.clientWidth, 84, host.clientWidth - 84);
    const y = THREE.MathUtils.clamp((-point.y * 0.5 + 0.5) * host.clientHeight, 64, host.clientHeight - 28);
    window.pxaxRoomWidget?.(x, y, visible);
  }
}

function onPointerUp(event) {
  if (mode !== 'room') return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (dx * dx + dy * dy > 64) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(pointerTargets, true);
  if (!intersections.length) return;
  const target = intersections[0].object;
  if (target.userData.action) {
    window.pxaxRoomAction(target.userData.action, false);
  } else if (characterRoot && target.parent && characterRoot.getObjectById(target.id)) {
    window.pxaxRoom3d.emote('tap');
    window.pxaxRoomToast?.('Хм? Что-то нужно?');
  }
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerStart.set(event.clientX, event.clientY);
});
renderer.domElement.addEventListener('pointerup', onPointerUp);

function animate() {
  frameId = requestAnimationFrame(animate);
  // вкладка скрыта / reduced-motion — пропускаем кадр, но цикл живёт
  if (window.pxaxPerf && !window.pxaxPerf.shouldAnimate()) {
    clock.getDelta(); // сбрасываем delta, чтобы не копилась
    return;
  }
  const delta = Math.min(clock.getDelta(), 0.05);
  applyDayNight(delta);
  updateMonitorSlides(delta);
  if (mixer) mixer.update(delta);
  updateTask(delta);
  applyMoodIdle(clock.elapsedTime);
  positionHotspots();
  renderer.render(scene, camera);
}

function setMode(nextMode) {
  mode = nextMode;
  host.classList.toggle('chat-mode', mode === 'chat');
  if (mode === 'room' && !task) actionLoop('Idle_Loop');
}

function emote(type) {
  if (!actions.Idle_Talking_Loop || task) return;
  const actionName = type === 'talk' || type === 'thinking' || type === 'listening'
    ? 'Idle_Talking_Loop'
    : 'Interact';
  actionLoop(actionName);
  clearTimeout(emote.timer);
  emote.timer = setTimeout(() => {
    if (!task) actionLoop('Idle_Loop');
  }, type === 'talk' ? 4000 : 2200);
}

function speak(wordCount) {
  emote('talk');
  clearTimeout(emote.timer);
  emote.timer = setTimeout(() => {
    if (!task) actionLoop('Idle_Loop');
  }, Math.min(12000, Math.max(1800, wordCount * 170)));
}

async function initialize() {
  resize();
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  const [base, outfit, hair, animationGltf] = await Promise.all([
    loader.loadAsync(assetUrl('Superhero_Female.glb')),
    loader.loadAsync(assetUrl('Female_Peasant.glb')),
    loader.loadAsync(assetUrl('Hair_Long.glb')),
    loader.loadAsync(assetUrl('animations-core.glb'))
  ]);

  characterRoot = base.scene;
  const skinnedMeshes = findSkinnedMeshes(characterRoot);
  if (!skinnedMeshes.length) throw new Error('Female character model has no skin rig');
  const baseBones = new Map(skinnedMeshes[0].skeleton.bones.map((bone) => [bone.name, bone]));
  characterParts = skinnedMeshes;
  addRiggedPart(characterRoot, baseBones, outfit, '#b09aff', '#301256', 'outfit');
  addRiggedPart(characterRoot, baseBones, hair, '#7852bf', '#34135b', 'hair');
  if (wardrobeKeys.outfit !== 'peasant') {
    loadWardPart('outfit', wardrobeKeys.outfit).catch((error) => console.warn('Wardrobe outfit failed:', error));
  }
  if (wardrobeKeys.hair !== 'long') {
    loadWardPart('hair', wardrobeKeys.hair).catch((error) => console.warn('Wardrobe hair failed:', error));
  }

  const avatarRig = characterRoot;
  const bounds = new THREE.Box3().setFromObject(avatarRig);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Female character model has invalid dimensions');
  const scale = 1.75 / height;
  avatarRig.scale.setScalar(scale);
  avatarRig.position.y = -bounds.min.y * scale;
  avatarRig.traverse((object) => {
    if (object.isSkinnedMesh) {
      object.frustumCulled = false;
    }
  });
  posePivot = new THREE.Group();
  posePivot.position.y = 0.875;
  avatarRig.position.y -= 0.875;
  posePivot.add(avatarRig);
  const actor = new THREE.Group();
  actor.add(posePivot);
  actor.position.set(0, 0, 1.2);
  scene.add(actor);
  characterRoot = actor;
  characterBones = baseBones;

  mixer = new THREE.AnimationMixer(base.scene);
  for (const clip of animationGltf.animations) {
    actions[clip.name] = mixer.clipAction(clip);
    animationDuration[clip.name] = clip.duration;
  }
  const required = ['Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Interact'];
  const missing = required.filter((name) => !actions[name]);
  if (missing.length) throw new Error(`Missing 3D animation clips: ${missing.join(', ')}`);

  const bedCollider = box(world, 'bed-hotspot', '#000000', [2.21, 0.68, -1.55], [1.9, 1.4, 2.4]);
  const deskCollider = box(world, 'desk-hotspot', '#000000', [0.6, 1.2, -2.3], [1.7, 1.9, 0.8]);
  const doorCollider = box(world, 'door-hotspot', '#000000', [-1.65, 1.45, -2.54], [1.1, 2.9, 0.5]);
  for (const [object, action] of [[bedCollider, 'bed'], [deskCollider, 'desk'], [doorCollider, 'door']]) {
    object.material.transparent = true;
    object.material.opacity = 0;
    object.material.depthWrite = false;
    object.userData.action = action;
    pointerTargets.push(object);
  }
  characterRoot.traverse((object) => {
    if (object.isSkinnedMesh) pointerTargets.push(object);
  });

  actionLoop('Idle_Loop');
  loadingLabel.hidden = true;
  rendererReady = true;
  setHour(new Date().getHours());
  setRoomStatus('Осматривает комнату');
  frameId = requestAnimationFrame(animate);
  scheduleWander();
}

window.pxaxRoom3d = {
  act(action, options = {}) {
    if (!rendererReady) {
      window.pxaxRoomToast?.('3D-комната ещё загружается…');
      return false;
    }
    if (!['bed', 'sleep', 'desk', 'door', 'toilet', 'delivery'].includes(action)) return false;
    return makeTask(action, options || {});
  },
  wake() {
    if (task !== 'sleep') return;
    if (taskPhase === 'bed-rest') phaseTimer = 0;
    else wakeRequested = true;
  },
  setMode,
  setHour,
  setMood,
  setWardrobe,
  setMonitorSlides,
  emote,
  speak,
  screenshot() {
    if (!rendererReady) return null;
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } catch (err) {
      return null;
    }
  }
};

initialize().catch(reportError);
