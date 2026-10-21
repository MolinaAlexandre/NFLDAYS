import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { extendPlay, ballHeight } from './sim.js';

// ---------- constants ----------
const HZ = 10;
const FIELD_W = 53.3;
const TEAM = {
  ARI: ['#97233F', '#FFB612'], ATL: ['#A71930', '#000000'], BAL: ['#241773', '#9E7C0C'], BUF: ['#00338D', '#C60C30'],
  CAR: ['#0085CA', '#101820'], CHI: ['#0B162A', '#C83803'], CIN: ['#FB4F14', '#000000'], CLE: ['#FF3C00', '#311D00'],
  DAL: ['#003594', '#869397'], DEN: ['#FB4F14', '#002244'], DET: ['#0076B6', '#B0B7BC'], GB: ['#203731', '#FFB612'],
  HOU: ['#03202F', '#A71930'], IND: ['#002C5F', '#A2AAAD'], JAX: ['#006778', '#D7A22A'], KC: ['#E31837', '#FFB81C'],
  LA: ['#003594', '#FFD100'], LAC: ['#0080C6', '#FFC20E'], LV: ['#A5ACAF', '#000000'], MIA: ['#008E97', '#FC4C02'],
  MIN: ['#4F2683', '#FFC62F'], NE: ['#002244', '#C60C30'], NO: ['#D3BC8D', '#101820'], NYG: ['#0B2265', '#A71930'],
  NYJ: ['#125740', '#FFFFFF'], PHI: ['#004C54', '#A5ACAF'], PIT: ['#FFB612', '#101820'], SEA: ['#002244', '#69BE28'],
  SF: ['#AA0000', '#B3995D'], TB: ['#D50A0A', '#34302B'], TEN: ['#4B92DB', '#0C2340'], WAS: ['#5A1414', '#FFB612'],
};
const TAGS = [
  ['SACK', 'Sacks'], ['HIT', 'Hits'], ['HURRY', 'Hurries'], ['PRESSURE', 'Pression avant la passe'],
  ['BEATEN', 'Bloqueur battu'], ['INT', 'INT'], ['TD', 'TD'], ['BIG', 'Gain 20+'], ['QUICK', 'Passe rapide'],
  ['HOLD', 'Long en poche'], ['SCRAMBLE', 'Scramble'],
];
const CAMS = [
  ['broadcast', 'TV'], ['all22', 'All-22'], ['endzone', 'Vue défense'], ['qb', 'Yeux du QB'],
  ['follow', 'Suivre joueur'], ['top', 'Dessus'], ['free', 'Libre'],
];
const LAYERS = [['pocket', 'Poche'], ['pressure', 'Pression'], ['duels', 'Duels de blocs'], ['trail', 'Trajectoire'], ['labels', 'Numéros']];

// field (x, y) -> three (x, h, -y)
const v3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

// ---------- state ----------
const S = {
  index: null, players: {}, games: {}, gameCache: new Map(),
  play: null, meta: null, f: 0, playing: false, speed: 1,
  cam: 'broadcast', layers: { pocket: true, pressure: true, duels: false, trail: true, labels: true },
  selected: null, tags: new Set(), playerModel: null,
};
const $ = (id) => document.getElementById(id);
const pname = (id) => S.players[id]?.n ?? `#${id}`;

// ---------- three setup ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1018');
scene.fog = new THREE.Fog('#0b1018', 120, 260);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;

scene.add(new THREE.HemisphereLight('#dfe9ff', '#2a3a20', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 50, bottom: -50, near: 1, far: 250 });
scene.add(sun, sun.target);

// ground around the field
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 250), new THREE.MeshStandardMaterial({ color: '#1d3b22', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(60, -0.02, -FIELD_W / 2); ground.receiveShadow = true;
scene.add(ground);

const fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
const field = new THREE.Mesh(new THREE.PlaneGeometry(120, FIELD_W), fieldMat);
field.rotation.x = -Math.PI / 2; field.position.set(60, 0, -FIELD_W / 2); field.receiveShadow = true;
scene.add(field);

function drawField(home, away) {
  const P = 20, W = 120 * P, H = Math.round(FIELD_W * P);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? '#2f6b34' : '#2a6230'; g.fillRect(i * 5 * P, 0, 5 * P, H); }
  const hc = TEAM[home]?.[0] ?? '#333', ac = TEAM[away]?.[0] ?? '#333';
  g.fillStyle = hc; g.fillRect(0, 0, 10 * P, H);
  g.fillStyle = ac; g.fillRect(110 * P, 0, 10 * P, H);
  g.fillStyle = '#ffffffdd'; g.font = `800 ${6 * P}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [x, t, rot] of [[5, home, -Math.PI / 2], [115, away, Math.PI / 2]]) {
    g.save(); g.translate(x * P, H / 2); g.rotate(rot); g.fillText(t ?? '', 0, 0); g.restore();
  }
  g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  for (let x = 10; x <= 110; x += 5) { g.lineWidth = x === 10 || x === 110 ? 6 : 3; g.beginPath(); g.moveTo(x * P, 0); g.lineTo(x * P, H); g.stroke(); }
  g.lineWidth = 2;
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const y of [0.5, 23.36, 29.96, FIELD_W - 0.5]) { const py = (FIELD_W - y) * P; g.beginPath(); g.moveTo(x * P, py - 0.4 * P); g.lineTo(x * P, py + 0.4 * P); g.stroke(); }
  }
  g.lineWidth = 8; g.strokeRect(0, 0, W, H);
  g.font = `700 ${2.2 * P}px Inter, sans-serif`; g.fillStyle = '#ffffffcc';
  for (let k = 1; k <= 9; k++) {
    const x = 10 + 10 * k, n = String(Math.min(10 * k, 100 - 10 * k));
    g.fillText(n, x * P, (FIELD_W - 12) * P);
    g.save(); g.translate(x * P, 12 * P); g.rotate(Math.PI); g.fillText(n, 0, 0); g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  fieldMat.map?.dispose(); fieldMat.map = tex; fieldMat.needsUpdate = true;
}
drawField('', '');

// line of scrimmage / first down
const losLine = new THREE.Mesh(new THREE.PlaneGeometry(0.25, FIELD_W), new THREE.MeshBasicMaterial({ color: '#3b82f6' }));
const fdLine = new THREE.Mesh(new THREE.PlaneGeometry(0.25, FIELD_W), new THREE.MeshBasicMaterial({ color: '#facc15' }));
for (const l of [losLine, fdLine]) { l.rotation.x = -Math.PI / 2; l.position.set(0, 0.02, -FIELD_W / 2); scene.add(l); }

// pocket polygon (triangle fan, max 24 verts)
const MAXV = 24;
const pocketGeo = new THREE.BufferGeometry();
pocketGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXV * 3 * 3), 3));
const pocketMat = new THREE.MeshBasicMaterial({ color: '#58a6ff', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
const pocket = new THREE.Mesh(pocketGeo, pocketMat);
scene.add(pocket);
const pocketEdgeGeo = new THREE.BufferGeometry();
pocketEdgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAXV + 1) * 3), 3));
const pocketEdge = new THREE.Line(pocketEdgeGeo, new THREE.LineBasicMaterial({ color: '#58a6ff' }));
scene.add(pocketEdge);

function segLines(max) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  l.frustumCulled = false; scene.add(l); return l;
}
const pressureLines = segLines(16);
const duelLines = segLines(16);

const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f0883e' }));
scene.add(trail);
const SIM_COLOR = '#c084fc';
const dashed = () => { const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: SIM_COLOR, dashSize: 0.6, gapSize: 0.4 })); scene.add(l); return l; };
const trailSim = dashed(), ballPathSim = dashed(), carrierPathSim = dashed();
const simSpot = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color: SIM_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
simSpot.rotation.x = -Math.PI / 2; scene.add(simSpot);
const setLine = (line, pts) => { line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints(pts); line.computeLineDistances?.(); };
let ghost = false;
function setGhost(on) {
  if (on === ghost) return; ghost = on;
  playerRoot.traverse((m) => { if (m.isMesh) { m.material.transparent = on; m.material.opacity = on ? 0.55 : 1; } });
}
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: '#f0883e', side: THREE.DoubleSide }));
selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);

// ---------- players ----------
let actors = []; // {ent, obj, ring, label, body}
const playerRoot = new THREE.Group(); scene.add(playerRoot);

function numberSprite(n, fg, bg) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(24, 6, 80, 52, 12); g.fill();
  g.fillStyle = fg; g.font = '800 40px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n ?? '', 64, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.8, 1); s.position.y = 2.6; s.renderOrder = 10;
  return s;
}

const GEO = {
  body: new THREE.CapsuleGeometry(0.3, 0.85, 4, 12),
  pads: new THREE.BoxGeometry(0.5, 0.28, 1.0),
  helmet: new THREE.SphereGeometry(0.24, 16, 12),
  mask: new THREE.BoxGeometry(0.12, 0.16, 0.3),
  ball: new THREE.SphereGeometry(0.17, 16, 10),
  ring: new THREE.RingGeometry(0.6, 0.78, 32),
};

function makePlayer(color, trim, helmet) {
  if (S.playerModel) {
    const o = S.playerModel.clone(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true;
      m.material = m.material.clone();
      const n = (m.material.name || m.name).toLowerCase();
      if (n.includes('jersey') || n.includes('team')) m.material.color.set(color);
      else if (n.includes('helmet')) m.material.color.set(helmet);
    });
    return o;
  }
  const grp = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const body = new THREE.Mesh(GEO.body, mat(color)); body.position.y = 0.73;
  const pads = new THREE.Mesh(GEO.pads, mat(trim)); pads.position.y = 1.32;
  const head = new THREE.Mesh(GEO.helmet, new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.25, metalness: 0.3 })); head.position.y = 1.72;
  const mask = new THREE.Mesh(GEO.mask, mat('#d0d0d0')); mask.position.set(0.2, 1.68, 0);
  for (const m of [body, pads, head, mask]) { m.castShadow = true; grp.add(m); }
  return grp;
}

function buildActors(play, meta, game) {
  for (const a of actors) { playerRoot.remove(a.obj, a.ring); a.label?.material.map.dispose(); }
  actors = [];
  const beaten = new Map(meta.beaten.map((b) => [b.b, b.k]));
  const credited = new Map(meta.credits.map((c) => [c.p, c.k]));
  for (const ent of play.ents) {
    let obj, label = null;
    if (ent.id === -1) {
      obj = new THREE.Mesh(GEO.ball, new THREE.MeshStandardMaterial({ color: '#7a3e12', roughness: 0.5 }));
      obj.scale.set(1.5, 0.9, 0.9); obj.castShadow = true;
    } else {
      const [c1, c2] = TEAM[ent.t] ?? ['#888', '#444'];
      const home = ent.t === game.homeTeamAbbr;
      obj = home ? makePlayer(c1, c2, c2 === '#FFFFFF' ? c1 : c2) : makePlayer('#f2f2f2', c1, c1);
      obj.userData.nflId = ent.id;
      label = numberSprite(ent.j, home ? '#fff' : c1, home ? c1 : '#ffffff');
      obj.add(label);
    }
    let ring = null;
    const k = beaten.get(ent.id) ?? credited.get(ent.id);
    if (k) {
      const col = beaten.has(ent.id) ? '#f85149' : '#f0883e';
      ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; playerRoot.add(ring);
    }
    playerRoot.add(obj);
    actors.push({ ent, obj, ring, label });
  }
}

// ---------- interpolation ----------
function sample(ent, f) {
  const d = ent.d, n = d.length / 4;
  const i = Math.max(0, Math.min(n - 1, Math.floor(f))), j = Math.min(n - 1, i + 1), t = Math.max(0, Math.min(1, f - i));
  const a = i * 4, b = j * 4;
  let da = d[b + 2] - d[a + 2]; if (da > 180) da -= 360; if (da < -180) da += 360;
  return { x: d[a] + (d[b] - d[a]) * t, y: d[a + 1] + (d[b + 1] - d[a + 1]) * t, o: d[a + 2] + da * t, s: d[a + 3] + (d[b + 3] - d[a + 3]) * t };
}
const facing = (o) => { const r = o * Math.PI / 180; return { x: Math.sin(r), y: Math.cos(r) }; };

function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// ---------- per-frame update ----------
const byId = () => new Map(actors.map((a) => [a.ent.id, a]));
let actorMap = new Map();

function updateScene() {
  const play = S.play; if (!play) return;
  const f = S.f;
  const pos = new Map();
  for (const a of actors) {
    const p = sample(a.ent, f); pos.set(a.ent.id, p);
    if (a.ent.id === -1) {
      a.obj.position.copy(v3(p.x, p.y, ballHeight(play, f)));
      const fa = facing(p.o || 90); a.obj.rotation.y = Math.atan2(-(-fa.y), fa.x);
    } else {
      a.obj.position.copy(v3(p.x, p.y));
      a.obj.rotation.y = Math.PI / 2 - p.o * Math.PI / 180;
      if (a.label) a.label.visible = S.layers.labels && S.cam !== 'qb';
      a.obj.visible = !(S.cam === 'qb' && a.ent.r === 'Pass');
    }
    if (a.ring) a.ring.position.copy(v3(p.x, p.y, 0.03));
  }
  const qbA = actors.find((a) => a.ent.r === 'Pass');
  const qb = qbA && pos.get(qbA.ent.id);
  const computed = f > play.nReal - 1;
  setGhost(computed);
  $('simBadge').style.display = computed ? 'block' : 'none';

  // pocket hull
  const blockers = actors.filter((a) => a.ent.r === 'Pass Block');
  pocket.visible = pocketEdge.visible = S.layers.pocket && !!qb && f >= play.snap - 1 && !computed;
  if (pocket.visible) {
    const h = hull([...blockers.map((a) => { const p = pos.get(a.ent.id); return [p.x, p.y]; }), [qb.x, qb.y]]).slice(0, MAXV);
    const arr = pocketGeo.attributes.position.array; let k = 0;
    for (let i = 1; i < h.length - 1; i++) for (const q of [h[0], h[i], h[i + 1]]) { arr[k++] = q[0]; arr[k++] = 0.04; arr[k++] = -q[1]; }
    pocketGeo.setDrawRange(0, k / 3); pocketGeo.attributes.position.needsUpdate = true; pocketGeo.computeBoundingSphere();
    const e = pocketEdgeGeo.attributes.position.array; let m = 0;
    for (const q of [...h, h[0]]) { e[m++] = q[0]; e[m++] = 0.05; e[m++] = -q[1]; }
    pocketEdgeGeo.setDrawRange(0, h.length + 1); pocketEdgeGeo.attributes.position.needsUpdate = true; pocketEdgeGeo.computeBoundingSphere();
    const md = play.md[Math.round(f)] ?? 99;
    const col = md < 2 ? '#f85149' : md < 3.5 ? '#f0883e' : '#58a6ff';
    pocketMat.color.set(col); pocketEdge.material.color.set(col);
  }

  // pressure lines (rushers within 5 yd of QB)
  {
    const g = pressureLines.geometry, P = g.attributes.position.array, C = g.attributes.color.array; let k = 0;
    if (S.layers.pressure && qb && f >= play.snap - 1 && !computed) {
      for (const a of actors) {
        if (a.ent.r !== 'Pass Rush' || k >= 16 * 6) continue;
        const p = pos.get(a.ent.id), d = Math.hypot(p.x - qb.x, p.y - qb.y);
        if (d > 5) continue;
        const c = new THREE.Color(d < 2 ? '#ff3b30' : d < 3.5 ? '#ff9f0a' : '#ffd60a');
        for (const q of [p, qb]) { P[k] = q.x; P[k + 1] = 1.0; P[k + 2] = -q.y; C[k] = c.r; C[k + 1] = c.g; C[k + 2] = c.b; k += 3; }
      }
    }
    g.setDrawRange(0, k / 3); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }
  // block duels (blocker -> first defender blocked, PFF)
  {
    const g = duelLines.geometry, P = g.attributes.position.array, C = g.attributes.color.array; let k = 0;
    if (S.layers.duels) {
      const beaten = new Set(S.meta.beaten.map((b) => b.b));
      for (const a of blockers) {
        if (!a.ent.blk || !actorMap.has(a.ent.blk) || k >= 16 * 6) continue;
        const p = pos.get(a.ent.id), q = pos.get(a.ent.blk);
        const c = new THREE.Color(beaten.has(a.ent.id) ? '#f85149' : '#ffffff');
        for (const r of [p, q]) { P[k] = r.x; P[k + 1] = 0.6; P[k + 2] = -r.y; C[k] = c.r; C[k + 1] = c.g; C[k + 2] = c.b; k += 3; }
      }
    }
    g.setDrawRange(0, k / 3); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }

  // selection
  const sel = S.selected != null && pos.get(S.selected);
  selRing.visible = !!sel; if (sel) selRing.position.copy(v3(sel.x, sel.y, 0.035));
  trail.visible = trailSim.visible = !!sel && S.layers.trail;
  ballPathSim.visible = carrierPathSim.visible = simSpot.visible = !!play.sim && S.layers.trail;
  updatePlayerPanel(pos, qb);
  return { pos, qb };
}

// ---------- cameras ----------
let tween = null, camJump = false;
function camPreset(mode) {
  const play = S.play; if (!play) return null;
  const s = play.dir === 'right' ? 1 : -1, los = play.los ?? 60, cy = -FIELD_W / 2;
  switch (mode) {
    case 'broadcast': return { pos: new THREE.Vector3(los - s * 2, 16, 16), target: new THREE.Vector3(los - s * 2, 0, cy + 2) };
    case 'all22': return { pos: new THREE.Vector3(los - s * 30, 30, cy), target: new THREE.Vector3(los + s * 2, 0, cy) };
    case 'endzone': return { pos: new THREE.Vector3(los + s * 22, 11, cy), target: new THREE.Vector3(los - s * 5, 1, cy) };
    case 'top': return { pos: new THREE.Vector3(los - s * 3, 55, cy + 0.01), target: new THREE.Vector3(los - s * 3, 0, cy) };
    default: return null;
  }
}
function setCam(mode, animate = true) {
  S.cam = mode;
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  if (mode === 'follow' && S.selected == null) {
    const qb = actors.find((a) => a.ent.r === 'Pass'); if (qb) selectPlayer(qb.ent.id);
  }
  const p = camPreset(mode);
  controls.enabled = !(mode === 'qb' || mode === 'follow');
  camJump = !animate;
  camera.fov = mode === 'qb' ? 75 : 45; camera.updateProjectionMatrix();
  if (p) tween = { from: camera.position.clone(), fromT: controls.target.clone(), ...p, t: animate ? 0 : 1 };
}
const tmpPos = new THREE.Vector3(), tmpTgt = new THREE.Vector3();
function updateCamera(dt, pos) {
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.8);
    const e = 1 - Math.pow(1 - tween.t, 3);
    camera.position.lerpVectors(tween.from, tween.pos, e);
    controls.target.lerpVectors(tween.fromT, tween.target, e);
    if (tween.t >= 1) tween = null;
  }
  if (!pos) return;
  // TV camera pans with the ball once it leaves the pocket (incl. the computed phase)
  if (S.cam === 'broadcast' && !tween && S.play && S.f > S.play.end - 1) {
    const b = pos.get(-1);
    if (b) { const dx = (b.x - controls.target.x) * (1 - Math.exp(-dt * 2)); camera.position.x += dx; controls.target.x += dx; }
  }
  const id = S.cam === 'qb' ? actors.find((a) => a.ent.r === 'Pass')?.ent.id : S.cam === 'follow' ? S.selected : null;
  const p = id != null && pos.get(id);
  if (!p) return;
  const fa = facing(p.o);
  if (S.cam === 'qb') {
    tmpPos.copy(v3(p.x, p.y, 1.85));
    tmpTgt.copy(v3(p.x + fa.x * 20, p.y + fa.y * 20, 1.0));
  } else {
    tmpPos.copy(v3(p.x - fa.x * 7, p.y - fa.y * 7, 4.5));
    tmpTgt.copy(v3(p.x + fa.x * 6, p.y + fa.y * 6, 1));
  }
  const k = camJump ? 1 : 1 - Math.exp(-dt * 6);
  camJump = false;
  camera.position.lerp(tmpPos, k);
  controls.target.lerp(tmpTgt, k);
  camera.lookAt(controls.target);
}

// ---------- UI: player selection ----------
function selectPlayer(id) {
  S.selected = id;
  const a = actorMap.get(id);
  if (a) {
    const n = a.ent.d.length / 4, nr = S.play.nReal, pts = [];
    for (let i = 0; i < n; i++) pts.push(v3(a.ent.d[i * 4], a.ent.d[i * 4 + 1], 0.06));
    setLine(trail, pts.slice(0, nr)); setLine(trailSim, pts.slice(nr - 1));
  }
  $('player').style.display = a ? 'block' : 'none';
}
function updatePlayerPanel(pos, qb) {
  const a = S.selected != null && actorMap.get(S.selected); if (!a) return;
  const p = pos.get(a.ent.id), info = S.players[a.ent.id] ?? {};
  const dq = qb && a.ent.r !== 'Pass' ? `${Math.hypot(p.x - qb.x, p.y - qb.y).toFixed(1)} yd du QB` : '';
  $('player').innerHTML = `<b>#${a.ent.j ?? ''} ${info.n ?? ''}</b> <span class="sub">${a.ent.t} · ${info.pos ?? ''}</span>
    <div class="sub">${a.ent.r || ''} ${a.ent.pl ? '· aligné ' + a.ent.pl : ''}</div>
    <div style="margin-top:6px;font-size:16px;font-weight:800">${(p.s * 2.045).toFixed(1)} mph <span class="sub" style="font-size:12px;font-weight:400">${dq}</span></div>
    <div class="sub" style="margin-top:4px">Caméra : <span class="link" id="followBtn">suivre ce joueur</span></div>`;
  $('followBtn').onclick = () => setCam('follow');
}

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(playerRoot.children, true).find((h) => {
    let o = h.object; while (o && o.userData.nflId == null) o = o.parent; return o;
  });
  if (!hit) return;
  let o = hit.object; while (o.userData.nflId == null) o = o.parent;
  selectPlayer(o.userData.nflId);
});

// ---------- UI: timeline & chart ----------
const chart = $('chart'), cg = chart.getContext('2d');
function drawChart() {
  const play = S.play; if (!play) return;
  const w = chart.clientWidth, h = chart.clientHeight, dpr = devicePixelRatio;
  if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
  cg.setTransform(dpr, 0, 0, dpr, 0, 0); cg.clearRect(0, 0, w, h);
  const n = play.n, X = (i) => (i / (n - 1)) * w;
  const MD = 10, yMd = (d) => h - (Math.min(d, MD) / MD) * (h - 4) - 2;
  const amax = Math.max(1, ...play.area), yA = (a) => h - (a / amax) * (h - 4) - 2;
  cg.fillStyle = '#ffffff08'; cg.fillRect(X(play.snap - 1), 0, X(play.end - 1) - X(play.snap - 1), h);
  if (play.nReal < n) {
    const x0 = X(play.nReal - 1);
    cg.save(); cg.beginPath(); cg.rect(x0, 0, w - x0, h); cg.clip();
    cg.fillStyle = '#c084fc14'; cg.fillRect(x0, 0, w - x0, h);
    cg.strokeStyle = '#c084fc40'; cg.lineWidth = 1;
    for (let x = x0 - h; x < w; x += 8) { cg.beginPath(); cg.moveTo(x, h); cg.lineTo(x + h, 0); cg.stroke(); }
    cg.restore();
    cg.fillStyle = '#c084fc'; cg.font = '600 11px Inter'; cg.fillText('CALCULÉ — hors tracking', x0 + 6, h - 6);
  }
  cg.strokeStyle = '#8b949e'; cg.setLineDash([4, 4]); cg.beginPath(); cg.moveTo(0, yMd(2)); cg.lineTo(w, yMd(2)); cg.stroke(); cg.setLineDash([]);
  const line = (arr, y, col) => { cg.strokeStyle = col; cg.lineWidth = 2; cg.beginPath(); arr.forEach((v, i) => v != null && (i ? cg.lineTo(X(i), y(v)) : cg.moveTo(X(i), y(v)))); cg.stroke(); };
  line(play.area, yA, '#58a6ff'); line(play.md, yMd, '#f85149');
  cg.strokeStyle = '#fff'; cg.lineWidth = 1.5; cg.beginPath(); cg.moveTo(X(S.f), 0); cg.lineTo(X(S.f), h); cg.stroke();
  const md = play.md[Math.round(S.f)];
  cg.fillStyle = '#e6edf3'; cg.font = '11px Inter'; cg.fillText(md != null ? `${md.toFixed(1)} yd` : '', Math.min(X(S.f) + 5, w - 45), 12);
}
const EV_FR = { ball_snap: 'Snap', autoevent_ballsnap: 'Snap', pass_forward: 'Passe', autoevent_passforward: 'Passe', qb_sack: 'SACK', qb_strip_sack: 'Strip-sack', play_action: 'Play-action', run: 'Scramble', line_set: 'Set', man_in_motion: 'Motion', pass_tipped: 'Dévié', fumble: 'Fumble' };
function drawMarks() {
  const play = S.play, seen = new Set();
  $('marks').innerHTML = play.events.filter(([f, e]) => EV_FR[e] && !seen.has(EV_FR[e]) && seen.add(EV_FR[e]))
    .map(([f, e]) => `<span style="left:${((f - 1) / (play.n - 1)) * 100}%">${EV_FR[e]}</span>`).join('')
    + (play.sim ? [[play.sim.catchF, { C: 'Réception*', IN: 'INT*', I: 'Incomplète*', R: '' }[play.sim.kind]], [play.sim.tackleF, play.sim.F ? (play.sim.td ? 'TD*' : 'Plaqué*') : '']]
      .filter(([, l]) => l).map(([f, l]) => `<span class="sim" style="left:${(f / (play.n - 1)) * 100}%">${l}</span>`).join('') : '');
  $('scrub').max = play.n - 1;
  const z = (play.nReal - 1) / (play.n - 1) * 100;
  $('simzone').style.display = play.sim ? 'block' : 'none';
  $('simzone').style.left = `${z}%`; $('simzone').style.width = `${100 - z}%`;
}
$('scrub').addEventListener('input', (e) => { S.f = +e.target.value; S.playing = false; syncPlayBtn(); });
$('playBtn').onclick = () => { if (S.f >= S.play.n - 1.01) S.f = 0; S.playing = !S.playing; syncPlayBtn(); };
$('restart').onclick = () => { S.f = Math.max(0, S.play.snap - 1); S.playing = true; syncPlayBtn(); };
$('speed').onchange = (e) => { S.speed = +e.target.value; };
function syncPlayBtn() { $('playBtn').textContent = S.playing ? '❚❚' : '▶'; }
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'search') return;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  if (e.code === 'ArrowRight') { S.playing = false; S.f = Math.min(S.play.n - 1, Math.floor(S.f) + 1); syncPlayBtn(); }
  if (e.code === 'ArrowLeft') { S.playing = false; S.f = Math.max(0, Math.ceil(S.f) - 1); syncPlayBtn(); }
});

// ---------- computed end of play ----------
function buildSimPaths() {
  const play = S.play, s = play.sim;
  if (!s) { for (const l of [ballPathSim, carrierPathSim]) setLine(l, []); return; }
  const ball = play.ents.find((e) => e.id === -1), pts = [];
  for (let f = s.L; f <= Math.min(play.n - 1, Math.ceil(s.catchF)); f += 0.25) {
    const p = sample(ball, f); pts.push(v3(p.x, p.y, ballHeight(play, f)));
  }
  setLine(ballPathSim, pts);
  const car = s.carrier != null && play.ents.find((e) => e.id === s.carrier), cpts = [];
  if (car && s.F) for (let i = Math.floor(s.catchF); i < play.n; i++) cpts.push(v3(car.d[i * 4], car.d[i * 4 + 1], 0.07));
  setLine(carrierPathSim, cpts);
  const end = s.F ?? s.C;
  simSpot.position.copy(v3(end.x, end.y, 0.04));
}
function simSection() {
  const s = S.play.sim;
  if (!S.play || !s) return S.meta.res === 'S' ? '' : `<div class="simbox"><b>⚙ Fin d'action non calculée</b><div class="sub">Aucune cible identifiable dans la description.</div></div>`;
  const who = s.carrier != null ? `<span class="link" data-sel="${s.carrier}">${pname(s.carrier)}</span>` : '—';
  const row = (k, v, src) => `<div class="simrow"><span>${k}</span><b>${v}</b><i>${src}</i></div>`;
  const kind = { C: 'Réception', I: 'Passe incomplète', IN: 'Interception', R: 'Scramble' }[s.kind];
  return `<div class="simbox">
    <div class="simhead">⚙ Fin d'action CALCULÉE <span>hors tracking</span></div>
    <div class="sub" style="margin-bottom:6px">Le tracking s'arrête 0,5 s après la passe. La suite (zone hachurée violette, joueurs translucides, tracés en pointillés) est reconstruite :</div>
    ${row(kind === 'Scramble' ? 'Porteur' : 'Cible', who, s.method)}
    ${s.kind !== 'R' ? row('Vitesse du ballon', `${s.ballSpeed.toFixed(1)} yd/s`, s.measuredSpeed > 3 ? 'mesurée (tracking)' : 'valeur par défaut') : ''}
    ${s.kind !== 'R' ? row('Temps de vol', `${s.flightTotal.toFixed(1)} s`, 'calculé') : ''}
    ${s.airYds != null ? row('Air yards', `${s.airYds.toFixed(0)} yd`, 'calculé') : ''}
    ${s.yac != null ? row('Yards après réception', `${s.yac.toFixed(0)} yd`, 'calculé') : ''}
    ${s.F ? row('Spot final', s.td ? 'Touchdown' : `${S.meta.yds > 0 ? '+' : ''}${S.meta.yds} yd`, 'résultat officiel') : ''}
    <div class="sub" style="margin-top:6px">Hypothèses : receveur prolongé à sa dernière vitesse mesurée, ballon en ligne droite (hauteur parabolique), défenseurs qui convergent sur le ballon puis poursuivent le porteur.</div>
  </div>`;
}

// ---------- UI: info panel ----------
function infoPanel(meta) {
  const who = (id) => `<span class="link" data-sel="${id}">${pname(id)}</span>`;
  const margin = meta.ttp != null ? (meta.ttt - meta.ttp).toFixed(1) : null;
  const res = { C: 'Complète', I: 'Incomplète', S: 'Sack', IN: 'Interception', R: 'Scramble' }[meta.res] ?? meta.res;
  $('info').innerHTML = `
    <h2>Q${meta.q} ${meta.clock} · ${meta.down}&${meta.ytg} · ${meta.off} vs ${meta.def}</h2>
    <div class="desc">${meta.desc}</div>
    <div class="metrics">
      <div class="metric"><small>Temps avant la passe</small><b>${meta.ttt.toFixed(1)} s</b></div>
      <div class="metric"><small>Pocket Clock ⏱</small><b style="color:${meta.ttp != null && meta.ttp <= meta.ttt ? 'var(--danger)' : 'var(--ok)'}">${meta.ttp != null ? meta.ttp.toFixed(1) + ' s' : 'Propre'}</b></div>
      <div class="metric"><small>Marge du QB</small><b>${margin != null ? (margin > 0 ? '+' : '') + margin + ' s' : '—'}</b></div>
      <div class="metric"><small>Rusher le plus proche</small><b>${meta.minDist != null ? meta.minDist.toFixed(1) + ' yd' : '—'}</b></div>
      <div class="metric"><small>Résultat</small><b style="font-size:14px">${res} · ${meta.yds ?? 0} yd</b></div>
      <div class="metric"><small>Couverture / formation</small><b style="font-size:13px">${meta.cov || '—'}<br>${meta.form || ''}</b></div>
    </div>
    ${meta.pressureBy ? `<div class="duel">⏱ Premier à moins de 2 yd du QB : ${who(meta.pressureBy)} (${meta.ttp.toFixed(1)} s)</div>` : ''}
    ${meta.credits.length ? `<div class="section">Pression défensive (PFF)</div>` + meta.credits.map((c) => `<div class="duel"><span class="k" style="color:var(--accent)">${c.k}</span>${who(c.p)}</div>`).join('') : ''}
    ${meta.beaten.length ? `<div class="section">Bloqueurs battus (PFF)</div>` + meta.beaten.map((b) => `<div class="duel"><span class="k">${b.k}</span>${who(b.b)}${b.d ? ' battu par ' + who(b.d) : ''}</div>`).join('') : ''}
    ${simSection()}
    <div class="section">Lecture</div>
    <div class="sub">Poche bleue = enveloppe des bloqueurs + QB (rouge si un rusher est à moins de 2 yd). Anneau rouge = bloqueur battu, orange = défenseur crédité. Lignes = rushers à moins de 5 yd du QB.</div>`;
  $('info').querySelectorAll('[data-sel]').forEach((el) => (el.onclick = () => selectPlayer(+el.dataset.sel)));
}

// ---------- loading plays ----------
// Data is shipped pre-gzipped (.json.gz) for static hosting; falls back to plain .json.
// Handles hosts that serve the .gz raw and hosts that already decode it (Content-Encoding).
async function fetchJSON(path) {
  const r = await fetch(`${path}.gz`);
  if (!r.ok) return fetch(path).then((x) => x.json());
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}
async function loadGame(gid) {
  if (!S.gameCache.has(gid)) S.gameCache.set(gid, fetchJSON(`data/games/${gid}.json`));
  return S.gameCache.get(gid);
}
async function openPlay(meta) {
  $('loading').style.display = 'grid'; $('loading').textContent = 'Chargement du match…';
  const game = await loadGame(meta.g);
  const play = game[meta.p];
  $('loading').style.display = 'none';
  if (!play) return;
  const g = S.games[meta.g];
  if (S.play?.gid !== meta.g) drawField(g.homeTeamAbbr, g.visitorTeamAbbr);
  S.play = { ...extendPlay(play, meta, S.players), gid: meta.g }; S.meta = meta;
  ghost = false; buildActors(S.play, meta, g); actorMap = byId();
  buildSimPaths();
  S.selected = null; selectPlayer(null);
  if (play.los != null) { losLine.position.x = play.los; fdLine.position.x = play.fd; }
  losLine.visible = fdLine.visible = play.los != null;
  S.f = Math.max(0, play.snap - 6); S.playing = true; syncPlayBtn();
  drawMarks(); infoPanel(meta);
  setCam(S.cam === 'follow' ? 'broadcast' : S.cam, true);
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('active', el.dataset.k === `${meta.g}_${meta.p}`));
  history.replaceState(null, '', `#g=${meta.g}&p=${meta.p}${location.hash.match(/&cam=.*/)?.[0] ?? ''}`);
}

// ---------- sidebar list ----------
function filtered() {
  const q = $('q').value.trim().toLowerCase(), team = $('team').value, side = $('side').value, game = $('game').value;
  return S.index.plays.filter((p) => {
    if (game && String(p.g) !== game) return false;
    if (team && !((side !== 'def' && p.off === team) || (side !== 'off' && p.def === team))) return false;
    if (S.tags.size && !p.tags.some((t) => S.tags.has(t))) return false;
    if (q && !p._search.includes(q)) return false;
    return true;
  });
}
function renderList() {
  const rows = filtered();
  $('count').textContent = `${rows.length} actions${rows.length > 300 ? ' (300 premières affichées)' : ''}`;
  $('list').innerHTML = rows.slice(0, 300).map((p) => `
    <div class="item" data-k="${p.g}_${p.p}">
      <div class="top"><span>${p.off} vs ${p.def} · Q${p.q} ${p.clock}</span><span class="sub">${S.games[p.g]?.week ? 'S' + S.games[p.g].week : ''} · ${p.ttt.toFixed(1)}s</span></div>
      <div class="desc">${p.desc}</div>
      <div>${p.tags.map((t) => `<span class="tag ${t}">${t}</span>`).join('')}</div>
    </div>`).join('');
  const byKey = new Map(rows.map((p) => [`${p.g}_${p.p}`, p]));
  $('list').querySelectorAll('.item').forEach((el) => (el.onclick = () => openPlay(byKey.get(el.dataset.k))));
}

// ---------- leaders ----------
function renderLeaders() {
  const L = S.index.leaders;
  const tbl = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;
  $('leaders').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Classements · Pocket Clock</h2><button class="chip" id="closeLeaders">Fermer ✕</button></div>
    <p class="sub">Pocket Clock = temps entre le snap et le moment où le premier rusher arrive à moins de 2 yards du QB (calculé sur le tracking 10 Hz, uniquement si c'est avant la passe).</p>
    <div class="cols">
      <div><h3>Rushers les plus rapides</h3>${tbl(['Joueur', 'Pressions', 'Pocket Clock méd.'], L.rushers.map((r) => `<tr><td><span class="link" data-q="${pname(r.id)}">${pname(r.id)}</span> <span class="sub">${S.players[r.id]?.pos ?? ''}</span></td><td>${r.count}</td><td>${r.median.toFixed(2)} s</td></tr>`))}</div>
      <div><h3>Bloqueurs les plus battus</h3>${tbl(['Joueur', 'Sacks/hits/hurries concédés'], L.blockers.map((r) => `<tr><td><span class="link" data-q="${pname(r.id)}">${pname(r.id)}</span> <span class="sub">${S.players[r.id]?.pos ?? ''}</span></td><td>${r.count}</td></tr>`))}</div>
      <div><h3>Protection par équipe</h3>${tbl(['Équipe', '% pression', 'Tps passe moy.', 'Sacks'], L.teams.map((t) => `<tr><td><span class="link" data-team="${t.off}">${t.off}</span></td><td>${t.pressureRate}%</td><td>${t.ttt.toFixed(2)} s</td><td>${t.sacks}</td></tr>`))}</div>
    </div>`;
  $('closeLeaders').onclick = () => ($('leaders').style.display = 'none');
  $('leaders').querySelectorAll('[data-q]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.q.toLowerCase(); $('leaders').style.display = 'none'; renderList(); }));
  $('leaders').querySelectorAll('[data-team]').forEach((el) => (el.onclick = () => { $('team').value = el.dataset.team; $('side').value = 'off'; $('leaders').style.display = 'none'; renderList(); }));
}
$('leadersBtn').onclick = () => { renderLeaders(); $('leaders').style.display = 'block'; };

// ---------- init ----------
async function init() {
  $('cams').innerHTML = CAMS.map(([k, l]) => `<button data-cam="${k}">${l}</button>`).join('');
  $('cams').querySelectorAll('button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));
  $('layers').innerHTML = LAYERS.map(([k, l]) => `<button data-layer="${k}" class="${S.layers[k] ? 'on' : ''}">${l}</button>`).join('');
  $('layers').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.layers[b.dataset.layer] = !S.layers[b.dataset.layer]; b.classList.toggle('on'); }));
  $('tags').innerHTML = TAGS.map(([k, l]) => `<button class="chip" data-tag="${k}">${l}</button>`).join('');
  $('tags').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.tags.has(b.dataset.tag) ? S.tags.delete(b.dataset.tag) : S.tags.add(b.dataset.tag); b.classList.toggle('on'); renderList(); }));

  const idx = await fetchJSON('data/index.json');
  S.index = idx; S.players = idx.players;
  for (const g of idx.games) S.games[g.gameId] = g;
  for (const p of idx.plays) {
    const names = [p.pressureBy, ...p.beaten.flatMap((b) => [b.b, b.d]), ...p.credits.map((c) => c.p)].filter(Boolean).map(pname);
    p._search = `${p.desc} ${p.off} ${p.def} ${p.cov} ${names.join(' ')}`.toLowerCase();
  }
  idx.plays.sort((a, b) => b.score - a.score || a.g - b.g || a.p - b.p);
  const teams = [...new Set(idx.plays.map((p) => p.off))].sort();
  $('team').innerHTML += teams.map((t) => `<option>${t}</option>`).join('');
  $('game').innerHTML += idx.games.filter((g) => idx.plays.some((p) => p.g === g.gameId))
    .map((g) => `<option value="${g.gameId}">S${g.week} · ${g.visitorTeamAbbr} @ ${g.homeTeamAbbr} (${g.gameDate})</option>`).join('');
  for (const id of ['q', 'team', 'side', 'game']) $(id).addEventListener('input', renderList);
  renderList();
  $('loading').style.display = 'none';

  const m = location.hash.match(/g=(\d+)&p=(\d+)/);
  const first = (m && idx.plays.find((p) => p.g === +m[1] && p.p === +m[2])) || idx.plays[0];
  const cm = location.hash.match(/cam=(\w+)/), tm = location.hash.match(/t=([\d.-]+)/);
  if (cm) S.cam = cm[1];
  await openPlay(first);
  if (tm) { S.f = S.play.snap - 1 + parseFloat(tm[1]) * HZ; S.playing = false; syncPlayBtn(); }
  if (cm) setCam(cm[1], false);
}

// optional Blender model: drop web/models/player.glb (1 unit = 1 yard, feet at origin, facing +X)
new GLTFLoader().load('models/player.glb', (gltf) => {
  S.playerModel = gltf.scene;
  if (S.meta) { buildActors(S.play, S.meta, S.games[S.meta.g]); actorMap = byId(); }
}, undefined, () => {});

// ---------- loop ----------
const clock = new THREE.Clock();
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
function loop() {
  const dt = Math.min(0.1, clock.getDelta());
  resize();
  if (S.play) {
    if (S.playing) {
      S.f += dt * HZ * S.speed;
      if (S.f >= S.play.n - 1) { S.f = S.play.n - 1; S.playing = false; syncPlayBtn(); }
    }
    $('scrub').value = S.f;
    $('time').textContent = `${((S.f - (S.play.snap - 1)) / HZ).toFixed(1)} s ${S.f < S.play.snap - 1 ? 'avant snap' : S.f > S.play.nReal - 1 ? '· CALCULÉ' : 'après snap'}`;
    $('time').classList.toggle('sim', S.f > S.play.nReal - 1);
    const r = updateScene();
    updateCamera(dt, r?.pos);
    drawChart();
  }
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
camera.position.set(60, 40, 40); controls.target.set(60, 0, -26);
loop();
init();
