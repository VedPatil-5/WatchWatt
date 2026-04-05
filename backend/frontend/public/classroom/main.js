import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

const params = new URLSearchParams(window.location.search);
const embedded = params.get("embedded") === "1";

if (embedded) {
  document.body.classList.add("embed-mode");
}

const canvas = document.querySelector("#scene");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
RectAreaLightUniformsLib.init();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.58;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc7dce7);
scene.fog = new THREE.Fog(0xc7dce7, 25, 65);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(13.5, 12.6, 17.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-1.15, 2.8, -0.15);
controls.minDistance = 10;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.48;

const lightControlsRoot = document.querySelector("#light-controls");

const room = new THREE.Group();
scene.add(room);

function makeGlowTexture() {
  const size = 256;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.48
  );
  gradient.addColorStop(0, "rgba(255, 246, 214, 1)");
  gradient.addColorStop(0.28, "rgba(255, 235, 176, 0.72)");
  gradient.addColorStop(0.62, "rgba(255, 222, 150, 0.24)");
  gradient.addColorStop(1, "rgba(255, 222, 150, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWoodTexture(base = "#d9b07a", grain = "#8d5f37") {
  const size = 256;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i += 1) {
    const y = (i / 90) * size;
    ctx.strokeStyle = `rgba(90, 55, 25, ${0.08 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random() * 6);
    ctx.bezierCurveTo(
      size * 0.3,
      y - 4 + Math.random() * 8,
      size * 0.7,
      y + Math.random() * 8,
      size,
      y + Math.random() * 6
    );
    ctx.stroke();
  }

  for (let i = 0; i < 55; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    const w = 8 + Math.random() * 18;
    const h = 2 + Math.random() * 5;
    const x = Math.random() * (size - w);
    const y = Math.random() * (size - h);
    ctx.fillRect(x, y, w, h);
  }

  ctx.strokeStyle = grain;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makePaperTexture() {
  const size = 256;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  ctx.fillStyle = "#f8f4ec";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(80, 90, 120, 0.12)";
  ctx.lineWidth = 2;
  for (let i = 28; i < size; i += 24) {
    ctx.beginPath();
    ctx.moveTo(20, i);
    ctx.lineTo(size - 20, i);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(180, 80, 80, 0.2)";
  ctx.fillRect(24, 20, 4, size - 40);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const floorTexture = makeWoodTexture("#d8b082", "#7d5430");
floorTexture.repeat.set(4, 3);
const deskTexture = makeWoodTexture("#d6a56d", "#7e542e");
deskTexture.repeat.set(1, 1);
const paperTexture = makePaperTexture();

const materials = {
  wall: new THREE.MeshStandardMaterial({ color: 0xbad4ea, roughness: 0.92 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xb28b61, roughness: 0.76 }),
  floor: new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.7,
    metalness: 0.02,
  }),
  deskWood: new THREE.MeshStandardMaterial({
    map: deskTexture,
    roughness: 0.72,
  }),
  chairWood: new THREE.MeshStandardMaterial({ color: 0xcfab78, roughness: 0.74 }),
  metal: new THREE.MeshStandardMaterial({
    color: 0x7f868e,
    roughness: 0.42,
    metalness: 0.78,
  }),
  darkMetal: new THREE.MeshStandardMaterial({
    color: 0x57616a,
    roughness: 0.38,
    metalness: 0.88,
  }),
  chalkboard: new THREE.MeshStandardMaterial({
    color: 0x274f41,
    roughness: 0.94,
  }),
  cork: new THREE.MeshStandardMaterial({ color: 0xaa7c50, roughness: 0.98 }),
  paper: new THREE.MeshStandardMaterial({
    map: paperTexture,
    roughness: 0.95,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xdff5ff,
    roughness: 0.06,
    transmission: 0.68,
    transparent: true,
    opacity: 0.42,
    thickness: 0.06,
  }),
  radiator: new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 0.85 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xb17349, roughness: 0.9 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x4d8e49, roughness: 0.9 }),
  bookRed: new THREE.MeshStandardMaterial({ color: 0x99615a, roughness: 0.84 }),
  bookGreen: new THREE.MeshStandardMaterial({ color: 0x6a8760, roughness: 0.84 }),
  bookBlue: new THREE.MeshStandardMaterial({ color: 0x6680a1, roughness: 0.84 }),
  bookTan: new THREE.MeshStandardMaterial({ color: 0xb7986f, roughness: 0.84 }),
  curtain: new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0x89a6b8, roughness: 0.92 }),
  tube: new THREE.MeshStandardMaterial({
    color: 0x7e878d,
    roughness: 0.52,
    metalness: 0.7,
  }),
};

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radiusTop, radiusBottom, height, segments, material) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addRoundedPanel(width, height, depth, material) {
  const shape = new THREE.Shape();
  const radius = Math.min(width, height) * 0.08;
  shape.moveTo(-width / 2 + radius, -height / 2);
  shape.lineTo(width / 2 - radius, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + radius);
  shape.lineTo(width / 2, height / 2 - radius);
  shape.quadraticCurveTo(width / 2, height / 2, width / 2 - radius, height / 2);
  shape.lineTo(-width / 2 + radius, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - radius);
  shape.lineTo(-width / 2, -height / 2 + radius);
  shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + radius, -height / 2);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: depth * 0.18,
    bevelThickness: depth * 0.14,
  });
  geometry.center();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createDesk(withTeacherShelf = false) {
  const desk = new THREE.Group();

  const top = box(1.35, 0.1, 0.85, materials.deskWood);
  top.position.y = 0.78;
  desk.add(top);

  const frame = box(1.25, 0.08, 0.75, materials.metal);
  frame.position.y = 0.67;
  desk.add(frame);

  const frontBar = box(1.12, 0.05, 0.06, materials.darkMetal);
  frontBar.position.set(0, 0.42, 0.36);
  desk.add(frontBar);

  const backBar = frontBar.clone();
  backBar.position.z = -0.36;
  desk.add(backBar);

  const sideBarLeft = box(0.06, 0.05, 0.66, materials.darkMetal);
  sideBarLeft.position.set(-0.56, 0.42, 0);
  desk.add(sideBarLeft);

  const sideBarRight = sideBarLeft.clone();
  sideBarRight.position.x = 0.56;
  desk.add(sideBarRight);

  const legPositions = [
    [-0.52, 0.39, -0.3],
    [0.52, 0.39, -0.3],
    [-0.52, 0.39, 0.3],
    [0.52, 0.39, 0.3],
  ];

  legPositions.forEach(([x, y, z]) => {
    const leg = cylinder(0.032, 0.026, 0.76, 10, materials.darkMetal);
    leg.position.set(x, y, z);
    desk.add(leg);
  });

  const feet = [
    [-0.52, 0.02, -0.3],
    [0.52, 0.02, -0.3],
    [-0.52, 0.02, 0.3],
    [0.52, 0.02, 0.3],
  ];

  feet.forEach(([x, y, z]) => {
    const foot = box(0.12, 0.03, 0.08, materials.darkMetal);
    foot.position.set(x, y, z);
    desk.add(foot);
  });

  const paper = box(0.42, 0.015, 0.3, materials.paper);
  paper.position.set(0, 0.84, 0);
  paper.rotation.x = -0.03;
  paper.rotation.z = 0.06;
  desk.add(paper);

  if (withTeacherShelf) {
    const shelf = box(0.8, 0.08, 0.32, materials.deskWood);
    shelf.position.set(0, 0.5, 0);
    desk.add(shelf);
  }

  return desk;
}

function createChair() {
  const chair = new THREE.Group();

  const seat = box(0.5, 0.06, 0.48, materials.chairWood);
  seat.position.y = 0.46;
  chair.add(seat);

  const back = box(0.5, 0.48, 0.06, materials.chairWood);
  back.position.set(0, 0.79, -0.21);
  chair.add(back);

  const backCut = box(0.28, 0.18, 0.07, materials.wall);
  backCut.position.set(0, 0.8, -0.205);
  chair.add(backCut);

  const framePoints = [
    [-0.2, 0.23, -0.18],
    [0.2, 0.23, -0.18],
    [-0.2, 0.23, 0.18],
    [0.2, 0.23, 0.18],
  ];

  framePoints.forEach(([x, y, z]) => {
    const leg = cylinder(0.024, 0.02, 0.46, 10, materials.darkMetal);
    leg.position.set(x, y, z);
    chair.add(leg);
  });

  const skidFront = box(0.52, 0.03, 0.05, materials.darkMetal);
  skidFront.position.set(0, 0.02, 0.19);
  chair.add(skidFront);

  const skidBack = skidFront.clone();
  skidBack.position.z = -0.19;
  chair.add(skidBack);

  const spineLeft = cylinder(0.02, 0.02, 0.34, 8, materials.darkMetal);
  spineLeft.position.set(-0.18, 0.66, -0.18);
  chair.add(spineLeft);

  const spineRight = spineLeft.clone();
  spineRight.position.x = 0.18;
  chair.add(spineRight);

  return chair;
}

function createBookStack(count = 4) {
  const group = new THREE.Group();
  const mats = [materials.bookRed, materials.bookGreen, materials.bookBlue, materials.bookTan];
  for (let i = 0; i < count; i += 1) {
    const book = box(0.22 + (i % 2) * 0.03, 0.06, 0.28, mats[i % mats.length]);
    book.position.y = 0.03 + i * 0.06;
    book.rotation.y = (i % 2) * 0.08;
    group.add(book);
  }
  return group;
}

function createPlant(scale = 1) {
  const plant = new THREE.Group();
  const pot = cylinder(0.12 * scale, 0.09 * scale, 0.16 * scale, 18, materials.pot);
  pot.position.y = 0.08 * scale;
  plant.add(pot);

  const soil = cylinder(0.095 * scale, 0.095 * scale, 0.025 * scale, 14, materials.cork);
  soil.position.y = 0.145 * scale;
  plant.add(soil);

  for (let i = 0; i < 8; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.07 * scale, 12, 12),
      materials.plant
    );
    const angle = (i / 8) * Math.PI * 2;
    leaf.scale.set(1, 1.6, 0.7);
    leaf.position.set(
      Math.cos(angle) * 0.12 * scale,
      0.28 * scale + (i % 3) * 0.04 * scale,
      Math.sin(angle) * 0.1 * scale
    );
    leaf.rotation.z = angle * 0.6;
    leaf.castShadow = true;
    plant.add(leaf);
  }

  return plant;
}

function createGlobe() {
  const globe = new THREE.Group();
  const stand = cylinder(0.07, 0.09, 0.08, 16, materials.trim);
  stand.position.y = 0.04;
  globe.add(stand);

  const arm = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.012, 10, 32, Math.PI * 1.3),
    materials.metal
  );
  arm.rotation.x = Math.PI / 2;
  arm.position.y = 0.26;
  arm.castShadow = true;
  globe.add(arm);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0x4b8dc3,
      roughness: 0.75,
      metalness: 0.05,
    })
  );
  sphere.position.y = 0.28;
  sphere.castShadow = true;
  globe.add(sphere);

  const continents = [
    [0.06, 0.08, 0.16],
    [-0.09, 0.02, 0.14],
    [0.0, -0.05, -0.16],
  ];
  continents.forEach(([x, y, z]) => {
    const land = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x85b75e, roughness: 0.9 })
    );
    land.position.set(x, 0.28 + y, z);
    land.scale.set(1.5, 0.6, 1);
    globe.add(land);
  });

  return globe;
}

function createRadiator(width = 1.8) {
  const radiator = new THREE.Group();
  const panelCount = Math.floor(width / 0.18);

  for (let i = 0; i < panelCount; i += 1) {
    const panel = box(0.11, 0.78, 0.08, materials.radiator);
    panel.position.set(-width / 2 + 0.12 + i * 0.16, 0.39, 0);
    radiator.add(panel);
  }

  const top = box(width, 0.06, 0.11, materials.radiator);
  top.position.set(0, 0.79, 0);
  radiator.add(top);

  const base = box(width, 0.05, 0.11, materials.radiator);
  base.position.set(0, 0.03, 0);
  radiator.add(base);
  return radiator;
}

function createShelf() {
  const shelf = new THREE.Group();
  const body = box(0.9, 1.25, 0.42, materials.trim);
  body.position.y = 0.625;
  shelf.add(body);

  const hollow = box(0.74, 1.03, 0.36, materials.wall);
  hollow.position.y = 0.67;
  shelf.add(hollow);

  [0.28, 0.62, 0.94].forEach((y) => {
    const plank = box(0.78, 0.05, 0.36, materials.trim);
    plank.position.y = y;
    shelf.add(plank);
  });

  const globe = createGlobe();
  globe.scale.setScalar(0.8);
  globe.position.set(-0.17, 1.02, 0);
  shelf.add(globe);

  const books = createBookStack(5);
  books.position.set(0.1, 0.15, 0.02);
  books.rotation.y = Math.PI / 2;
  shelf.add(books);

  const sideBooks = createBookStack(3);
  sideBooks.position.set(0.16, 0.48, 0.05);
  sideBooks.rotation.set(0, Math.PI / 2, Math.PI / 2);
  shelf.add(sideBooks);

  return shelf;
}

function createBin() {
  const bin = new THREE.Group();
  const body = cylinder(0.18, 0.13, 0.46, 18, new THREE.MeshStandardMaterial({
    color: 0x6e7781,
    roughness: 0.72,
    metalness: 0.35,
  }));
  body.position.y = 0.23;
  bin.add(body);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.015, 8, 20),
    materials.darkMetal
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.45;
  rim.castShadow = true;
  bin.add(rim);
  return bin;
}

function createFireExtinguisher() {
  const item = new THREE.Group();
  const body = cylinder(0.08, 0.08, 0.5, 20, new THREE.MeshStandardMaterial({
    color: 0xc74231,
    roughness: 0.42,
    metalness: 0.18,
  }));
  body.position.y = 0.25;
  item.add(body);

  const nozzle = box(0.14, 0.03, 0.04, materials.darkMetal);
  nozzle.position.set(0.05, 0.52, 0);
  item.add(nozzle);

  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.01, 8, 16, Math.PI),
    materials.darkMetal
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, 0.54, 0);
  handle.castShadow = true;
  item.add(handle);

  const label = box(0.11, 0.14, 0.01, new THREE.MeshStandardMaterial({
    color: 0xf4e8d5,
    roughness: 0.8,
  }));
  label.position.set(0, 0.26, 0.082);
  item.add(label);
  return item;
}

function createWindowBay(width = 3.1, height = 3.5) {
  const bay = new THREE.Group();
  const frameDepth = 0.14;

  const outerFrame = box(width, height, frameDepth, materials.trim);
  outerFrame.position.y = height / 2;
  bay.add(outerFrame);

  const innerOpening = box(width - 0.28, height - 0.28, frameDepth + 0.02, materials.wall);
  innerOpening.position.y = height / 2;
  bay.add(innerOpening);

  const glass = box(width - 0.42, height - 0.42, 0.04, materials.glass);
  glass.position.set(0, height / 2, 0.01);
  bay.add(glass);

  const verticalCount = 3;
  const horizontalCount = 4;

  for (let i = 1; i < verticalCount; i += 1) {
    const mullion = box(0.08, height - 0.26, 0.1, materials.trim);
    mullion.position.set(-width / 2 + (width / verticalCount) * i, height / 2, 0);
    bay.add(mullion);
  }

  for (let j = 1; j < horizontalCount; j += 1) {
    const mullion = box(width - 0.26, 0.08, 0.1, materials.trim);
    mullion.position.set(0, (height / horizontalCount) * j, 0);
    bay.add(mullion);
  }

  const sill = box(width - 0.1, 0.12, 0.36, materials.trim);
  sill.position.set(0, 0.06, 0.11);
  bay.add(sill);

  return bay;
}

function createBulletinBoard() {
  const board = new THREE.Group();
  const frame = box(4.2, 1.32, 0.08, materials.trim);
  frame.position.z = -0.03;
  board.add(frame);
  const cork = box(3.92, 1.04, 0.04, materials.cork);
  board.add(cork);

  const notes = [
    [-1.45, 0.18, 0xfff6df],
    [-0.9, 0.21, 0xe8f3ff],
    [-0.35, 0.18, 0xfaf5ed],
    [0.28, 0.14, 0xf7efe7],
    [1.08, 0.22, 0xebfff5],
    [-1.2, -0.18, 0xf9f0d8],
    [-0.58, -0.18, 0xfff7ef],
    [0.02, -0.18, 0xf2fff1],
    [0.85, -0.15, 0xf4f0ff],
  ];

  notes.forEach(([x, y, color], index) => {
    const note = box(
      0.42 + (index % 3) * 0.06,
      0.26 + (index % 2) * 0.04,
      0.02,
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    );
    note.position.set(x, y, 0.03);
    note.rotation.z = (index % 4) * 0.04 - 0.06;
    board.add(note);
  });

  return board;
}

const glowTexture = makeGlowTexture();

function createGlowPatch(offsetX) {
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 1.55),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: 0xffe7a8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(offsetX, -5.82, 0);
  return glow;
}

function createCeilingLight(id) {
  const fixture = new THREE.Group();
  const housing = box(1.65, 0.08, 0.66, materials.metal);
  fixture.add(housing);

  const topGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2c8,
    emissive: 0xffd878,
    emissiveIntensity: 0.9,
    roughness: 0.26,
    transparent: true,
    opacity: 0.96,
  });
  const topGlow = box(1.52, 0.018, 0.56, topGlowMaterial);
  topGlow.position.y = 0.055;
  fixture.add(topGlow);

  const diffuser = box(1.5, 0.03, 0.54, new THREE.MeshStandardMaterial({
    color: 0xc8c8c4,
    roughness: 0.45,
  }));
  diffuser.position.y = -0.05;
  fixture.add(diffuser);

  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cf,
    emissive: 0xf4d88a,
    emissiveIntensity: 1.18,
    roughness: 0.24,
  });

  [-0.45, 0, 0.45].forEach((x) => {
    const strip = box(0.22, 0.012, 0.48, stripMat);
    strip.position.set(x, -0.07, 0);
    fixture.add(strip);
  });

  const areaLight = new THREE.RectAreaLight(0xfff1c4, 4.6, 1.42, 0.5);
  areaLight.position.set(0, -0.13, 0);
  areaLight.rotation.x = -Math.PI / 2;
  fixture.add(areaLight);

  const spotLight = new THREE.SpotLight(0xffefc8, 30, 12, 0.52, 0.58, 1.25);
  spotLight.position.set(0, -0.05, 0);
  spotLight.target.position.set(0, -5.82, 0);
  fixture.add(spotLight);
  fixture.add(spotLight.target);

  const glow = createGlowPatch(0);
  glow.scale.set(1.18, 0.96, 1);
  fixture.add(glow);

  const state = { on: true };

  function applyState() {
    stripMat.emissiveIntensity = state.on ? 1.18 : 0.03;
    stripMat.color.set(state.on ? 0xfff8df : 0x8f8f8a);
    topGlowMaterial.emissiveIntensity = state.on ? 1.15 : 0.04;
    topGlowMaterial.color.set(state.on ? 0xfff6d9 : 0x8e928d);
    topGlowMaterial.opacity = state.on ? 0.98 : 0.4;
    areaLight.intensity = state.on ? 4.6 : 0;
    spotLight.intensity = state.on ? 30 : 0;
    glow.material.opacity = state.on ? 0.24 : 0;
    const scale = state.on ? 1.18 : 0.88;
    glow.scale.set(scale, scale * 0.82, 1);
  }

  applyState();

  return {
    id,
    group: fixture,
    setOn(on) {
      state.on = on;
      applyState();
    },
    toggle() {
      state.on = !state.on;
      applyState();
      return state.on;
    },
    isOn() {
      return state.on;
    },
    getLabel() {
      return id;
    },
    getSortKey() {
      const match = id.match(/^(\d+)(left|right)$/);
      if (!match) {
        return 0;
      }
      return Number(match[1]) * 10 + (match[2] === "left" ? 0 : 1);
    },
  };
}

function createDuctRun(length = 10) {
  const duct = new THREE.Group();
  const main = box(length, 0.36, 0.36, materials.tube);
  duct.add(main);

  for (let i = -length / 2 + 0.9; i < length / 2; i += 1.8) {
    const ring = box(0.08, 0.39, 0.39, materials.darkMetal);
    ring.position.x = i;
    duct.add(ring);
  }

  return duct;
}

function createRoomShell() {
  const shell = new THREE.Group();
  const roomWidth = 13.8;
  const roomCenterX = -1.1;

  const floor = box(roomWidth, 0.25, 12, materials.floor);
  floor.position.set(roomCenterX, -0.125, 0);
  shell.add(floor);

  const leftWall = box(0.25, 6.5, 12, materials.wall);
  leftWall.position.set(-8, 3.25, 0);
  shell.add(leftWall);

  const backWall = box(roomWidth, 6.5, 0.25, materials.wall);
  backWall.position.set(roomCenterX, 3.25, -6);
  shell.add(backWall);

  const rightWall = box(0.25, 6.5, 12, materials.wall);
  rightWall.position.set(5.8, 3.25, 0);
  shell.add(rightWall);

  const frontLip = box(roomWidth, 0.28, 0.55, materials.trim);
  frontLip.position.set(roomCenterX, 0.02, 5.72);
  shell.add(frontLip);

  const sideLip = box(0.55, 0.28, 12, materials.trim);
  sideLip.position.set(-7.72, 0.02, 0);
  shell.add(sideLip);

  return shell;
}

room.add(createRoomShell());

const boardFrame = box(6.35, 2.7, 0.08, materials.trim);
boardFrame.position.set(-2.0, 2.95, -5.83);
room.add(boardFrame);

const board = box(5.95, 2.38, 0.04, materials.chalkboard);
board.position.set(-2.0, 2.95, -5.78);
room.add(board);

const chalkTray = box(5.95, 0.06, 0.16, materials.trim);
chalkTray.position.set(-2.0, 1.7, -5.68);
room.add(chalkTray);

const chalk = box(0.34, 0.03, 0.03, new THREE.MeshStandardMaterial({
  color: 0xf3f3f1,
  roughness: 0.9,
}));
chalk.position.set(-1.65, 1.74, -5.6);
room.add(chalk);

const eraser = box(0.26, 0.08, 0.13, new THREE.MeshStandardMaterial({
  color: 0x44403f,
  roughness: 0.95,
}));
eraser.position.set(0.55, 1.75, -5.62);
room.add(eraser);

const screenBar = box(3.6, 0.12, 0.12, materials.metal);
screenBar.position.set(-2.0, 4.38, -5.66);
room.add(screenBar);

const teacherDesk = createDesk(true);
teacherDesk.scale.set(1.28, 1.05, 1.15);
teacherDesk.position.set(-0.45, 0, -1.45);
teacherDesk.rotation.y = -0.03;
room.add(teacherDesk);

const teacherGlobe = createGlobe();
teacherGlobe.position.set(-0.1, 0.89, -1.1);
room.add(teacherGlobe);

const teacherCup = cylinder(0.07, 0.06, 0.16, 14, new THREE.MeshStandardMaterial({
  color: 0xe3ddd2,
  roughness: 0.9,
}));
teacherCup.position.set(-0.82, 0.88, -1.18);
room.add(teacherCup);

for (let i = 0; i < 4; i += 1) {
  const pencil = box(0.012, 0.18, 0.012, new THREE.MeshStandardMaterial({
    color: i % 2 === 0 ? 0xd1a74d : 0x5b88a8,
    roughness: 0.7,
  }));
  pencil.position.set(-0.82 + i * 0.02, 0.96, -1.18 + (i % 2) * 0.01);
  room.add(pencil);
}

const studentLayout = [
  [-4.8, 3.15], [-2.5, 3.15], [-0.2, 3.15], [2.1, 3.15],
  [-4.8, 1.45], [-2.5, 1.45], [-0.2, 1.45], [2.1, 1.45],
  [-4.8, -0.25], [-2.5, -0.25], [-0.2, -0.25], [2.1, -0.25],
  [-4.8, -1.95], [-2.5, -1.95], [-0.2, -1.95], [2.1, -1.95],
];

studentLayout.forEach(([x, z]) => {
  const desk = createDesk();
  desk.position.set(x, 0, z);
  room.add(desk);

  const chair = createChair();
  chair.position.set(x + 0.65, 0, z + 0.55);
  room.add(chair);
});

const alarmBox = box(0.12, 0.28, 0.08, new THREE.MeshStandardMaterial({
  color: 0xcf5c48,
  roughness: 0.7,
}));
alarmBox.position.set(5.78, 3.15, 4.28);
alarmBox.rotation.y = -Math.PI / 2;
room.add(alarmBox);

const ceilingGrid = new THREE.Group();
room.add(ceilingGrid);

const gridMaterial = materials.darkMetal;
for (let x = -6; x <= 3; x += 3) {
  const beam = box(0.08, 0.08, 8.15, gridMaterial);
  beam.position.set(x, 6.1, -1.5);
  ceilingGrid.add(beam);
}
for (let z = -4.8; z < 2.5; z += 2.4) {
  const beam = box(11.4, 0.08, 0.08, gridMaterial);
  beam.position.set(-1.1, 6.1, z);
  ceilingGrid.add(beam);
}

const ductBack = createDuctRun(10.5);
ductBack.position.set(-0.35, 6.45, -5.0);
room.add(ductBack);

const ductRight = createDuctRun(8.0);
ductRight.rotation.y = Math.PI / 2;
ductRight.position.set(4.85, 6.45, -1.25);
room.add(ductRight);

const lightPositions = [
  { id: "1left", x: -3.3, y: 5.86, z: -4.3 },
  { id: "1right", x: 0.1, y: 5.86, z: -4.3 },
  { id: "2left", x: -3.3, y: 5.86, z: -2.15 },
  { id: "2right", x: 0.1, y: 5.86, z: -2.15 },
  { id: "3left", x: -3.3, y: 5.86, z: 0.0 },
  { id: "3right", x: 0.1, y: 5.86, z: 0.0 },
  { id: "4left", x: -3.3, y: 5.86, z: 2.15 },
  { id: "4right", x: 0.1, y: 5.86, z: 2.15 },
];
const ceilingFixtures = [];

lightPositions.forEach(({ id, x, y, z }) => {
  const fixture = createCeilingLight(id);
  fixture.group.position.set(x, y, z);
  room.add(fixture.group);
  ceilingFixtures.push(fixture);
});

const ambient = new THREE.HemisphereLight(0xe8f5ff, 0xb88c63, 0.8);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff4d8, 0.95);
sun.position.set(11, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
scene.add(sun);

const outerBase = box(14.7, 0.18, 12.8, new THREE.MeshStandardMaterial({
  color: 0xd7dce0,
  roughness: 0.92,
}));
outerBase.position.set(-1.1, -0.27, 0);
scene.add(outerBase);

const outerEdge = box(15.2, 0.08, 13.4, new THREE.MeshStandardMaterial({
  color: 0x9aa4ad,
  roughness: 0.86,
}));
outerEdge.position.set(-1.1, -0.4, 0);
scene.add(outerEdge);

room.rotation.y = -0.4;
room.position.y = 0.28;

function createLightButtons() {
  if (embedded) {
    return;
  }

  [...ceilingFixtures]
    .sort((a, b) => a.getSortKey() - b.getSortKey())
    .forEach((fixture) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "light-button";
      button.textContent = fixture.getLabel();

      function sync() {
        button.classList.toggle("is-on", fixture.isOn());
      }

      button.addEventListener("click", () => {
        fixture.toggle();
        sync();
      });

      sync();
      lightControlsRoot.append(button);
    });
}

createLightButtons();

function orderedFixtures() {
  return [...ceilingFixtures].sort((a, b) => a.getSortKey() - b.getSortKey());
}

function setLightState(index, on) {
  const fixture = orderedFixtures()[index];
  if (!fixture) {
    return;
  }
  fixture.setOn(Boolean(on));
}

function toggleLightState(index) {
  const fixture = orderedFixtures()[index];
  if (!fixture) {
    return;
  }
  fixture.toggle();
}

function setLightCount(count) {
  orderedFixtures().forEach((fixture, index) => {
    fixture.setOn(index < count);
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.type === "classroom:setLightState") {
    setLightState(Number(data.index), data.on);
    return;
  }

  if (data.type === "classroom:toggleLight") {
    toggleLightState(Number(data.index));
    return;
  }

  if (data.type === "classroom:setLightCount") {
    const count = Math.max(0, Math.min(orderedFixtures().length, Number(data.count) || 0));
    setLightCount(count);
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
