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
  powerPreference: 'low-power'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.setAttribute('aria-label', 'Трёхмерная комната и персонаж Ai');
host.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 40);
camera.position.set(0, 4.2, 8.4);
camera.lookAt(0, 1.55, -0.2);
scene.add(new THREE.HemisphereLight(0xc6d8ff, 0x161020, 2.05));

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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createRoom() {
  const wallMat = material('#171527', { roughness: 0.92 });
  const floorMat = material('#111322', { roughness: 0.78 });
  const trimViolet = material('#9b61ff', { emissive: '#6831cf', emissiveIntensity: 1.2 });
  const trimCyan = material('#57e8f1', { emissive: '#17a8cc', emissiveIntensity: 1.1 });

  box(world, 'floor', '#111322', [0, -0.16, -0.05], [6.1, 0.3, 5.6]);
  box(world, 'back-wall-left', wallMat.color, [-0.9, 2.02, -2.82], [4.3, 4.05, 0.18]);
  box(world, 'back-wall-right', wallMat.color, [2.6, 2.02, -2.82], [0.9, 4.05, 0.18]);
  box(world, 'door-lintel', wallMat.color, [1.65, 3.15, -2.82], [0.8, 1.8, 0.18]);
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

  const windowX = -0.75;
  box(world, 'window-glass', '#132a46', [windowX, 2.42, -2.67], [2.0, 1.36, 0.035], {
    emissive: '#12446c',
    emissiveIntensity: 0.42,
    metalness: 0.25,
    roughness: 0.25
  });
  for (let i = 0; i < 6; i += 1) {
    const x = windowX - 0.88 + i * 0.34;
    const height = 0.36 + (i % 3) * 0.18;
    box(world, `city-tower-${i}`, i % 2 ? '#27315b' : '#1d274c',
      [x, 1.76 + height / 2, -2.63], [0.24, height, 0.035], {
        emissive: i % 2 ? '#263e83' : '#6b347f',
        emissiveIntensity: 0.55
      });
  }
  box(world, 'window-frame-top', '#565078', [windowX, 3.12, -2.61], [2.12, 0.075, 0.12]);
  box(world, 'window-frame-bottom', '#565078', [windowX, 1.72, -2.61], [2.12, 0.075, 0.12]);
  box(world, 'window-frame-left', '#565078', [windowX - 1.03, 2.42, -2.61], [0.075, 1.4, 0.12]);
  box(world, 'window-frame-right', '#565078', [windowX + 1.03, 2.42, -2.61], [0.075, 1.4, 0.12]);
  box(world, 'window-crossbar', '#565078', [windowX, 2.42, -2.6], [0.04, 1.35, 0.11]);

  const bed = new THREE.Group();
  bed.position.set(-1.47, 0, 0.18);
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

  const desk = new THREE.Group();
  desk.position.set(1.47, 0, -0.32);
  world.add(desk);
  box(desk, 'desk-top', '#29273e', [0, 0.9, 0], [1.42, 0.13, 0.78]);
  for (const x of [-0.58, 0.58]) {
    for (const z of [-0.27, 0.27]) {
      box(desk, `desk-leg-${x}-${z}`, '#51466e', [x, 0.45, z], [0.07, 0.88, 0.07]);
    }
  }
  box(desk, 'monitor-case', '#1b1b31', [0, 1.42, -0.27], [0.88, 0.63, 0.08], {
    metalness: 0.22
  });
  box(desk, 'monitor-screen', '#102b3d', [0, 1.43, -0.222], [0.78, 0.51, 0.012], {
    emissive: '#12627b',
    emissiveIntensity: 0.9,
    roughness: 0.25
  });
  for (let i = 0; i < 4; i += 1) {
    box(desk, `screen-code-${i}`, i % 2 ? '#ab77ff' : '#58e3ee',
      [-0.25 + (i % 2) * 0.1, 1.55 - i * 0.075, -0.21], [0.22 + (i % 3) * 0.08, 0.018, 0.009], {
        emissive: i % 2 ? '#7338cf' : '#129db1',
        emissiveIntensity: 0.9
      });
  }
  box(desk, 'monitor-stand', '#56506c', [0, 1.09, -0.26], [0.08, 0.25, 0.08]);
  box(desk, 'keyboard', '#17182a', [0, 1.0, 0.16], [0.58, 0.035, 0.2]);
  for (let i = 0; i < 5; i += 1) {
    box(desk, `keyboard-light-${i}`, i % 2 ? '#55e2ee' : '#a66cff',
      [-0.22 + i * 0.11, 1.022, 0.16], [0.055, 0.008, 0.015], {
        emissive: i % 2 ? '#2294ab' : '#7534c0',
        emissiveIntensity: 1
      });
  }

  const doorFrame = box(world, 'door-frame', '#5b4a79', [1.65, 1.42, -2.67], [0.98, 2.9, 0.16]);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(1.19, 0.04, -2.57);
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
  doorFrame.visible = false;
  box(world, 'door-frame-top', '#5b4a79', [1.65, 2.88, -2.67], [1.02, 0.12, 0.16]);
  box(world, 'door-frame-left', '#5b4a79', [1.15, 1.45, -2.67], [0.12, 2.85, 0.16]);
  box(world, 'door-frame-right', '#5b4a79', [2.15, 1.45, -2.67], [0.12, 2.85, 0.16]);
  box(world, 'door-threshold', '#61dfea', [1.65, 0.04, -2.56], [0.98, 0.08, 0.3], {
    emissive: '#168caa',
    emissiveIntensity: 0.95
  });

  const plantPot = cylinder(world, 'plant-pot', '#433152', [-2.04, 0.28, -1.94], 0.23, 0.18, 0.5);
  plantPot.rotation.z = Math.PI;
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.58 + (i % 2) * 0.2, 7),
      material(i % 2 ? '#5f4c9a' : '#377878', { emissive: '#241d46', emissiveIntensity: 0.35 })
    );
    leaf.position.set(-2.04 + Math.cos(i * 1.25) * 0.14, 0.72 + (i % 2) * 0.08, -1.94 + Math.sin(i * 1.25) * 0.14);
    leaf.rotation.z = Math.cos(i * 1.25) * 0.4;
    world.add(leaf);
  }

  const hotspots = {
    bed: new THREE.Vector3(-1.5, 1.06, 0.12),
    desk: new THREE.Vector3(1.47, 1.86, -0.3),
    door: new THREE.Vector3(1.65, 2.95, -2.5)
  };
  const buttons = Array.from(host.querySelectorAll('[data-room-action]'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      window.pxaxRoomAction(button.dataset.roomAction, false);
    });
  }
  return { bed, desk, doorPivot, hotspots, buttons };
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
  { minX: -2.23, maxX: -0.71, minZ: -0.85, maxZ: 1.21 },
  { minX: 0.76, maxX: 2.18, minZ: -0.71, maxZ: 0.07 },
  { minX: -2.35, maxX: -1.73, minZ: -2.25, maxZ: -1.63 }
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

function addRiggedPart(baseRoot, baseBones, gltf, tint, glow) {
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
  }
}

function makeTask(action, options = {}) {
  if (task || mode !== 'room' || !characterRoot) return false;
  task = action;
  taskPhase = 'walk-to';
  taskDurationSeconds = Math.max(0, Number(options.durationSeconds) || 0);
  phaseDeadline = 0;
  const taskPositions = {
    bed: new THREE.Vector3(-0.5, 0, 1.55),
    sleep: new THREE.Vector3(-0.5, 0, 1.55),
    desk: new THREE.Vector3(1.15, 0, 0.38),
    door: new THREE.Vector3(1.5, 0, -1.55),
    toilet: new THREE.Vector3(1.5, 0, -1.55)
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
    action === 'bed' ? 'Идёт отдохнуть' : action === 'desk' ? 'Идёт к ноутбуку' : 'Идёт к двери',
    true
  );
  actionLoop('Walk_Loop');
  return true;
}

function finishTask() {
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
  actionLoop('Idle_Loop');
  const hour = new Date().getHours();
  setRoomStatus(hour >= 23 || hour < 7 ? 'В комнате тихая ночь' : 'Осматривает комнату');
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
    phaseTimer = 6.5;
    setRoomStatus('Работает за ноутбуком', true);
    return;
  }
  if (task === 'door' || task === 'toilet') {
    taskPhase = 'door-use';
    actionLoop('Interact');
    phaseTimer = 1.4;
    room.doorPivot.rotation.y = room.doorPivot.userData.closedRotation - 1.1;
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
      new THREE.Vector3(-1.47, -0.15, 0.18),
      eased
    );
    posePivot.rotation.x = phaseStartRotation + (-Math.PI / 2 - phaseStartRotation) * eased;
    if (phaseTimer <= 0) {
      characterRoot.position.set(-1.47, -0.15, 0.18);
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
      new THREE.Vector3(-0.5, 0, 1.55),
      eased
    );
    posePivot.rotation.x = phaseStartRotation * (1 - eased);
    if (phaseTimer <= 0) {
      characterRoot.position.set(-0.5, 0, 1.55);
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
  for (const button of room.buttons) {
    const point = room.hotspots[button.dataset.roomAction].clone().project(camera);
    const x = THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * host.clientWidth, 50, host.clientWidth - 50);
    const y = THREE.MathUtils.clamp((-point.y * 0.5 + 0.5) * host.clientHeight, 28, host.clientHeight - 30);
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
    button.hidden = mode !== 'room' || point.z < -1 || point.z > 1;
    button.disabled = !!task;
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
  const delta = Math.min(clock.getDelta(), 0.05);
  if (mixer) mixer.update(delta);
  updateTask(delta);
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
    if (mode === 'room' && !task) actionLoop('Idle_Loop');
    else if (mode === 'chat' && !task) actionLoop('Idle_Loop');
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
  addRiggedPart(characterRoot, baseBones, outfit, '#b09aff', '#301256');
  addRiggedPart(characterRoot, baseBones, hair, '#7852bf', '#34135b');

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
      object.castShadow = true;
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

  const bedCollider = box(world, 'bed-hotspot', '#000000', [-1.47, 0.68, 0.2], [1.8, 1.4, 2.3]);
  const deskCollider = box(world, 'desk-hotspot', '#000000', [1.47, 1.15, -0.32], [1.65, 1.8, 1.1]);
  const doorCollider = box(world, 'door-hotspot', '#000000', [1.65, 1.45, -2.54], [1.1, 2.9, 0.5]);
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
    if (!['bed', 'sleep', 'desk', 'door', 'toilet'].includes(action)) return false;
    return makeTask(action, options || {});
  },
  wake() {
    if (task !== 'sleep') return;
    if (taskPhase === 'bed-rest') phaseTimer = 0;
    else wakeRequested = true;
  },
  setMode,
  emote,
  speak
};

initialize().catch(reportError);
