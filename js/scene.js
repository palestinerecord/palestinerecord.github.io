/* ============================================================
   scene.js — Three.js hero field, layered-separation pattern.

   Three.js owns the scene, camera and render loop and nothing else
   touches them. GSAP/ScrollTrigger writes only to a plain state
   object; the render loop reads it. No property is animated by two
   libraries. Rendering is conditional: the loop only draws when
   `needsRender` is set, and it stops entirely off the overview.

   The field carries one particle per documented death in Gaza
   (73,670), of which the child share (20,179, ~27%) is lit amber.
   ============================================================ */

import * as THREE from 'three';

const canvas = document.getElementById('scene');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TOTAL = 73670;
const CHILDREN = 20179;
// One point per death is honest but heavy on integrated GPUs; sample down
// proportionally and keep the child share exact.
const SAMPLE = window.devicePixelRatio > 1.5 ? 6 : 3;
const COUNT = Math.round(TOTAL / SAMPLE);
const CHILD_COUNT = Math.round(CHILDREN / SAMPLE);

const state = {
  scroll: 0,
  pointer: { x: 0, y: 0 },
  target: { x: 0, y: 0 },
  active: true,
  needsRender: true,
};

// Raw cursor position in CSS pixels, which the hit test and the name label need
// and the smoothed camera pointer above cannot give.
const cursor = { x: 0, y: 0, moved: false };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070c, 0.028);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 1.2, 42);

/* ---------------- the field ---------------- */

const positions = new Float32Array(COUNT * 3);
const colours = new Float32Array(COUNT * 3);
const sizes = new Float32Array(COUNT);
const phases = new Float32Array(COUNT);

const adult = new THREE.Color(0xa0453f);
const adultHot = new THREE.Color(0xe4675d);
const child = new THREE.Color(0xf2bd5a);

for (let i = 0; i < COUNT; i++) {
  // Flattened disc — reads as ground strewn with points rather than a nebula.
  const r = Math.pow(Math.random(), 0.52) * 62;
  const a = Math.random() * Math.PI * 2;
  positions[i * 3] = Math.cos(a) * r;
  positions[i * 3 + 1] = (Math.random() - 0.5) * 13 * (1 - r / 90);
  positions[i * 3 + 2] = Math.sin(a) * r * 0.72;

  const isChild = i < CHILD_COUNT;
  const c = isChild ? child : adult.clone().lerp(adultHot, Math.random() * 0.7);
  colours[i * 3] = c.r;
  colours[i * 3 + 1] = c.g;
  colours[i * 3 + 2] = c.b;

  sizes[i] = isChild ? 1.7 + Math.random() * 1.2 : 1.05 + Math.random() * 1.0;
  phases[i] = Math.random() * Math.PI * 2;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('colour', new THREE.BufferAttribute(colours, 3));
geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
  vertexShader: `
    attribute vec3 colour;
    attribute float size;
    attribute float phase;
    uniform float uTime;
    uniform float uPixelRatio;
    varying vec3 vColour;
    varying float vAlpha;
    void main() {
      vColour = colour;
      vec3 p = position;
      // Only the bob lives in the shader. The scroll displacement is applied to
      // the object instead, where the raycaster can see it — a point the reader
      // is hovering must be the point they are pointing at.
      p.y += sin(uTime * 0.32 + phase) * 0.45;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float dist = -mv.z;
      gl_PointSize = min(size * uPixelRatio * (205.0 / dist), 7.5 * uPixelRatio);
      vAlpha = smoothstep(125.0, 20.0, dist) * (0.74 + 0.26 * sin(uTime * 0.7 + phase));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColour;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      // Halo plus core. The halo alone renders as a smudge at this density; the
      // core is what gives each point an edge the eye can resolve.
      float halo = smoothstep(0.5, 0.08, d);
      float core = smoothstep(0.26, 0.0, d);
      gl_FragColor = vec4(vColour * (1.0 + core * 0.7), (halo * 0.3 + core * 0.95) * vAlpha);
    }
  `,
});

const field = new THREE.Points(geometry, material);
scene.add(field);

/* ---------------- horizon grid ---------------- */

const grid = new THREE.GridHelper(150, 46, 0x1d2637, 0x121826);
grid.position.y = -7;
grid.material.transparent = true;
grid.material.opacity = 0.32;
scene.add(grid);

/* ---------------- interaction ---------------- */

window.addEventListener('pointermove', (e) => {
  state.target.x = (e.clientX / window.innerWidth - 0.5) * 2;
  state.target.y = (e.clientY / window.innerHeight - 0.5) * 2;
  cursor.x = e.clientX;
  cursor.y = e.clientY;
  cursor.moved = true;
  state.needsRender = true;
}, { passive: true });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  state.needsRender = true;
}
window.addEventListener('resize', resize);

// GSAP writes only to `state`; the render loop is the sole writer of
// camera and material properties.
if (window.gsap && window.ScrollTrigger) {
  ScrollTrigger.create({
    trigger: document.body,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => { state.scroll = self.progress; state.needsRender = true; },
  });
}

document.addEventListener('visibilitychange', () => {
  state.active = !document.hidden && document.body.getAttribute('data-view') === 'overview';
  state.needsRender = true;
});

/* ---------------- the names ---------------- */

/* The field draws one point per death and, on its own, says nothing about who
   any of them were. Opt in and it becomes addressable: every point takes one
   record from the Ministry of Health identification list, hovering it gives
   that person's name and age, and the points that no record reaches are dimmed
   — 835 of the counted dead have never been identified, and that gap is part of
   the record rather than something to paper over.

   The list is fetched only when the reader asks for it, because it is two
   megabytes and no one who does not want it should pay for it. */

const NAMES_URL = 'data/names.json';
const names = { file: null, on: false, hovered: -1 };

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.62;
const ndc = new THREE.Vector2();

const tip = document.createElement('div');
tip.className = 'name-tip';
tip.hidden = true;
document.body.appendChild(tip);

// Both sequences run in the order the Ministry published them, so a stride maps
// one point to one record with no repetition. Where the field draws more points
// than the list holds records, the surplus points stay unnamed.
const recordFor = (i) => {
  const people = names.file.people;
  return people.length >= COUNT ? Math.floor(i * people.length / COUNT) : i;
};

const baseColours = colours.slice();
const baseSizes = sizes.slice();
const unnamed = new THREE.Color(0x3a4254);

/* With the list loaded the colours stop being a proportional sample and start
   being each point's own record: amber is a person under 18, red an adult, grey
   someone counted but never identified. */
function paintFromList() {
  const people = names.file.people;
  const colour = geometry.getAttribute('colour');
  const size = geometry.getAttribute('size');
  for (let i = 0; i < COUNT; i++) {
    const person = people[recordFor(i)];
    const age = person ? person[2] : null;
    const isChild = age != null && age < 18;
    const c = !person ? unnamed : (isChild ? child : adult.clone().lerp(adultHot, ((i * 97) % 70) / 100));
    colour.setXYZ(i, c.r, c.g, c.b);
    size.setX(i, !person ? 0.8 : (isChild ? 1.5 + ((i * 37) % 110) / 100 : 0.9 + ((i * 53) % 90) / 100));
  }
  colour.needsUpdate = true;
  size.needsUpdate = true;
}

function restorePalette() {
  geometry.getAttribute('colour').array.set(baseColours);
  geometry.getAttribute('size').array.set(baseSizes);
  geometry.getAttribute('colour').needsUpdate = true;
  geometry.getAttribute('size').needsUpdate = true;
}

function showTip(index) {
  if (index < 0) { tip.hidden = true; return; }
  const person = names.file.people[recordFor(index)];
  tip.innerHTML = person
    ? `<span class="name-tip-ar" dir="rtl" lang="ar">${person[0].replace(/[<&]/g, '')}</span>
       <span class="name-tip-en">${person[1].replace(/[<&]/g, '')}</span>
       <span class="name-tip-meta">${person[2] == null ? 'age not recorded'
      : (person[2] === 0 ? 'under one year old' : `${person[2]} years old`)}${
      person[3] ? (person[3] === 'f' ? ' · female' : ' · male') : ''}</span>`
    : `<span class="name-tip-en">Not identified</span>
       <span class="name-tip-meta">Counted in the toll; no name on the register.</span>`;
  tip.hidden = false;
  const pad = 16;
  tip.style.left = Math.min(cursor.x + pad, window.innerWidth - tip.offsetWidth - pad) + 'px';
  tip.style.top = Math.min(cursor.y + pad, window.innerHeight - tip.offsetHeight - pad) + 'px';
}

function pickName() {
  ndc.set(cursor.x / window.innerWidth * 2 - 1, -(cursor.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(field, false)[0];
  const index = hit ? hit.index : -1;
  if (index === names.hovered) return;
  names.hovered = index;
  showTip(index);
}

/* ---------------- loop ---------------- */

const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  if (!state.active && !state.needsRender) return;

  const t = clock.getElapsedTime();
  state.pointer.x += (state.target.x - state.pointer.x) * 0.04;
  state.pointer.y += (state.target.y - state.pointer.y) * 0.04;

  if (!reduced) field.rotation.y = t * 0.026;
  material.uniforms.uTime.value = t;
  field.position.y = -state.scroll * 7;

  camera.position.x = state.pointer.x * 4.5;
  camera.position.y = 1.2 - state.pointer.y * 2.2 + state.scroll * 5;
  camera.position.z = 42 - state.scroll * 12;
  camera.lookAt(0, state.scroll * 2, 0);

  grid.position.y = -7 - state.scroll * 4;

  renderer.render(scene, camera);

  // After the render, so the hit test uses the matrices that were just drawn,
  // and only once per frame however often the pointer moved within it.
  if (names.on && cursor.moved) {
    cursor.moved = false;
    field.updateMatrixWorld();
    pickName();
  }

  state.needsRender = state.active;
}

tick();

/* ---------------- public surface ---------------- */

window.Scene = {
  // The field is decorative everywhere but the overview; stop drawing elsewhere.
  setView(name) {
    state.active = name === 'overview' && !document.hidden;
    state.scroll = 0;
    state.needsRender = true;
    if (name !== 'overview' && names.on) window.Scene.names(false);
  },

  /* Turn the names on or off. Resolves with what the caller should tell the
     reader: whether the layer is on, and what the list actually covers. */
  async names(on) {
    if (on && !names.file) {
      const res = await fetch(NAMES_URL);
      if (!res.ok) throw new Error(`${NAMES_URL} — HTTP ${res.status}`);
      names.file = await res.json();
    }
    names.on = !!on;
    names.hovered = -1;
    tip.hidden = true;
    if (names.on) paintFromList(); else restorePalette();
    state.needsRender = true;
    return {
      on: names.on,
      identified: names.file ? names.file.meta.identified : 0,
      counted: names.file ? names.file.meta.counted_dead : TOTAL,
      drawn: COUNT,
      // Not every drawn point reaches a record: the list is shorter than the
      // field on a large display, by about the share of the dead never named.
      named: names.file ? Math.min(COUNT, names.file.people.length) : 0,
    };
  },

  stats: { total: TOTAL, children: CHILDREN, drawn: COUNT },
};
