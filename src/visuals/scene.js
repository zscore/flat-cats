/**
 * scene.js — the picture. Water, sky, light, motes.
 *
 * THE ONE RULE IN THIS FILE: everything drawn is a function of `t` and nothing
 * else. No state accumulates between frames, no `+=`, no history. Call
 * `renderAt(30)` and you get exactly the frame at thirty seconds, whether or not
 * a note has ever played.
 *
 * That rule is not tidiness — it is what the whole review workflow stands on.
 * `tools/storyboard.mjs` renders a contact sheet of the entire piece in a few
 * seconds precisely because it can ask for any frame directly, and the studio
 * page can scrub the picture with the audio stopped.
 *
 * What is bound to what:
 *
 *   brightness  → camera height, sky and water colour, sun strength, haze
 *   tension     → wave height and chop, mote count, horizon glow
 *   kick        → a ring spreading out across the water (read from the score,
 *                 not from a live event — see patterns.timeSinceKick)
 *
 * three.js concepts used here are explained in docs/LEARNING-THREE.md.
 */
import * as THREE from 'three';
import * as bus from '../bus.js';
import { timeSinceKick } from '../music/patterns.js';

const lerp = (a, b, x) => a + (b - a) * x;

// ---------------------------------------------------------------- shaders ----
// The water is one plane whose vertices are pushed around in the vertex shader.
// Three travelling sine waves make the swell; a fourth term is the kick's ring.
const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uTension;
  uniform float uRing;        // 0..1 — how far the kick's ring has travelled
  uniform float uRingGain;

  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  // One directional sine wave. Returns height; the caller differences it for
  // normals rather than doing calculus, which is plenty at this scale.
  float wave(vec2 p, vec2 dir, float len, float speed, float amp, float time) {
    return sin(dot(p, normalize(dir)) * (6.2831 / len) + time * speed) * amp;
  }

  float surface(vec2 p, float time) {
    float amp = mix(0.10, 0.85, uTension);
    float h = 0.0;
    h += wave(p, vec2(1.0, 0.35), 26.0, 0.55, amp * 1.00, time);
    h += wave(p, vec2(-0.4, 1.0), 13.0, 0.85, amp * 0.55, time);
    h += wave(p, vec2(0.8, -0.7),  6.5, 1.40, amp * 0.28 * uTension, time);

    // the kick's ring: a travelling gaussian crest centred on the camera's foot
    float d = length(p);
    float radius = uRing * 90.0;
    float ring = exp(-pow((d - radius) * 0.16, 2.0)) * (1.0 - uRing);
    h += ring * uRingGain * 1.6;
    return h;
  }

  void main() {
    vec3 pos = position;
    vec2 p = pos.xy;                 // plane is built in XY, rotated into XZ below
    float h = surface(p, uTime);
    pos.z += h;

    // normals by finite difference — two extra surface() calls, no derivatives
    float e = 0.75;
    float hx = surface(p + vec2(e, 0.0), uTime);
    float hy = surface(p + vec2(0.0, e), uTime);
    vNormal = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0));

    vHeight = h;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform vec3 uWater;
  uniform vec3 uSky;
  uniform float uBrightness;
  uniform float uTension;
  uniform vec3 uCamera;

  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  void main() {
    // the plane was rotated, so swing the normal into world space with it
    vec3 n = normalize(vec3(vNormal.x, vNormal.z, -vNormal.y));
    vec3 view = normalize(uCamera - vWorld);
    vec3 sun = normalize(vec3(0.25, mix(0.12, 0.75, uBrightness), -1.0));

    // Fresnel: water you look across reflects the sky, water you look into is
    // its own colour. This single term is most of what makes it read as water.
    float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);

    float spec = pow(max(dot(reflect(-sun, n), view), 0.0), mix(24.0, 90.0, uBrightness));
    float lambert = 0.35 + 0.65 * max(dot(n, sun), 0.0);

    vec3 col = uWater * lambert;
    col = mix(col, uSky, clamp(fres, 0.0, 0.85));
    col += vec3(1.0, 0.96, 0.88) * spec * mix(0.35, 1.6, uBrightness);

    // crests catch light; troughs go dark. Cheap, and it sells the swell.
    col += uSky * clamp(vHeight, 0.0, 3.0) * 0.16 * uTension;

    // haze into the sky at distance, so there is no hard edge at the horizon
    float dist = length(vWorld - uCamera);
    float haze = 1.0 - exp(-pow(dist * 0.0075, 2.2));
    col = mix(col, uSky, clamp(haze, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSky;
  uniform vec3 uWater;
  uniform float uBrightness;
  uniform float uTension;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 high = uSky * mix(0.45, 1.15, uBrightness);
    vec3 low  = mix(uWater, uSky, 0.65);
    vec3 col = mix(low, high, pow(up, mix(1.6, 0.8, uBrightness)));

    // a glow where the sun sits, growing with tension — the horizon "opening"
    vec3 sun = normalize(vec3(0.25, mix(0.12, 0.75, uBrightness), -1.0));
    float halo = pow(max(dot(d, sun), 0.0), mix(28.0, 6.0, uTension));
    col += vec3(1.0, 0.93, 0.82) * halo * mix(0.25, 0.9, uBrightness);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ------------------------------------------------------------------ scene ----
export function initScene(canvas, { size = null, manual = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true, // the storyboard screenshots this canvas
  });
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);

  // --- sky: a big inside-out sphere that always sits around the camera
  const skyUniforms = {
    uSky: { value: new THREE.Color(0.2, 0.3, 0.35) },
    uWater: { value: new THREE.Color(0.05, 0.14, 0.19) },
    uBrightness: { value: 0.2 },
    uTension: { value: 0.1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  scene.add(sky);

  // --- water
  const waterUniforms = {
    uTime: { value: 0 },
    uTension: { value: 0.1 },
    uBrightness: { value: 0.2 },
    uRing: { value: 1 },
    uRingGain: { value: 0 },
    uWater: { value: new THREE.Color(0.05, 0.14, 0.19) },
    uSky: { value: new THREE.Color(0.2, 0.3, 0.35) },
    uCamera: { value: new THREE.Vector3() },
  };
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700, 220, 220),
    new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: waterUniforms,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // --- motes: additive specks above the water. Positions are a pure function of
  // index and time, so a still frame has them exactly where a live frame would.
  const MOTES = 900;
  const moteGeom = new THREE.BufferGeometry();
  moteGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  const moteSeeds = Array.from({ length: MOTES }, (_, i) => ({
    x: Math.sin(i * 12.9898) * 43758.5453 % 1,
    z: Math.sin(i * 78.233) * 22578.1459 % 1,
    y: Math.sin(i * 3.1415) * 12345.6789 % 1,
    speed: 0.15 + (Math.abs(Math.sin(i * 5.77)) * 0.5),
  }));
  const motes = new THREE.Points(
    moteGeom,
    new THREE.PointsMaterial({
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(1, 0.95, 0.85),
    }),
  );
  scene.add(motes);

  function updateMotes(t, tension, brightness) {
    const pos = moteGeom.attributes.position.array;
    const live = Math.floor(lerp(120, MOTES, tension));
    for (let i = 0; i < MOTES; i++) {
      if (i >= live) {
        pos[i * 3 + 1] = -999; // parked below the world rather than deleted
        continue;
      }
      const s = moteSeeds[i];
      pos[i * 3] = ((s.x * 260 + t * s.speed * 3) % 260) - 130;
      pos[i * 3 + 1] = 1.5 + Math.abs(s.y) * lerp(14, 42, brightness)
        + Math.sin(t * 0.4 + i) * 0.8;
      pos[i * 3 + 2] = ((s.z * 300 + t * s.speed) % 300) - 240;
    }
    moteGeom.attributes.position.needsUpdate = true;
    motes.material.opacity = lerp(0.12, 0.65, tension) * lerp(0.5, 1, brightness);
  }

  // ------------------------------------------------------------- the frame ---
  /**
   * Draw the piece at time `t`. THE function of this module — everything else
   * is setup. Pure: same t in, same pixels out.
   */
  function renderAt(t) {
    const tension = bus.tensionAt(t);
    const brightness = bus.brightnessAt(t);
    const { water: waterCol, sky: skyCol } = bus.colorsAt(t);

    // camera: height is brightness, with a slow drift sway so it never sits still
    const height = lerp(2.2, 26.0, brightness);
    const sway = bus.drift(t, 0.7);
    camera.position.set(sway * 2.2, height, 34 + sway * 3);
    camera.lookAt(sway * 4, height * 0.45, -70);
    sky.position.copy(camera.position);

    // the kick's ring — read off the score, so this works with no audio at all
    const age = timeSinceKick(t);
    const RING_SECONDS = 1.1;
    waterUniforms.uRing.value = Math.min(age / RING_SECONDS, 1);
    waterUniforms.uRingGain.value = age < RING_SECONDS ? lerp(0.35, 1.0, tension) : 0;

    waterUniforms.uTime.value = t;
    waterUniforms.uTension.value = tension;
    waterUniforms.uBrightness.value = brightness;
    waterUniforms.uWater.value.setRGB(...waterCol);
    waterUniforms.uSky.value.setRGB(...skyCol);
    waterUniforms.uCamera.value.copy(camera.position);

    skyUniforms.uSky.value.setRGB(...skyCol);
    skyUniforms.uWater.value.setRGB(...waterCol);
    skyUniforms.uBrightness.value = brightness;
    skyUniforms.uTension.value = tension;

    updateMotes(t, tension, brightness);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = size ? size[0] : canvas.clientWidth || 960;
    const h = size ? size[1] : canvas.clientHeight || 540;
    renderer.setPixelRatio(size ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, !size);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if (!size) window.addEventListener('resize', resize);

  // The live loop. It only decides WHICH t to draw; `renderAt` does the drawing.
  // `manual` skips it entirely — that is how the studio drives an offscreen copy
  // of this scene to make thumbnails without it also animating in the corner.
  let running = !manual;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    renderAt(bus.now());
  }
  if (!manual) loop();

  return {
    renderAt,
    resize,
    stop() { running = false; },
    renderer,
    camera,
  };
}
