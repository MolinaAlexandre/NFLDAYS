import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { extendPlay, ballHeight } from './sim.js';
import { kitFor, KIT_SLOTS } from './kits.js';
import { makeRig, animate, makeViewModel } from './anim.js';

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
  ['SACK', 'Sacks'], ['HIT', 'Hits'], ['HURRY', 'Hurries'], ['PRESSURE', 'Pression avant passe'],
  ['BEATEN', 'Bloqueur battu'], ['INT', 'INT'], ['TD', 'TD'], ['BIG', 'Gain 20+'], ['QUICK', 'Passe rapide'],
  ['HOLD', 'Long en poche'], ['SCRAMBLE', 'Scramble'],
];
const TAG_SHORT = { SACK: 'SACK', HIT: 'HIT', HURRY: 'HURRY', PRESSURE: 'PRESSION', BEATEN: 'BATTU', INT: 'INT', TD: 'TD', BIG: '+20 YD', QUICK: 'RAPIDE', HOLD: 'LONG', SCRAMBLE: 'SCRAMBLE' };
const CAMS = [
  ['broadcast', 'TV'], ['all22', 'All-22'], ['endzone', 'Vue défense'], ['qb', 'Yeux du QB'],
  ['follow', 'Suivre'], ['top', 'Dessus'], ['free', 'Libre'],
];
const LAYERS = [['pocket', 'Poche'], ['pressure', 'Pression'], ['duels', 'Duels de blocs'], ['trail', 'Trajectoires'], ['labels', 'Numéros']];
const SPEEDS = [0.25, 0.5, 1, 2];
const ROLE_FR = { Pass: 'Quarterback', 'Pass Block': 'Bloqueur', 'Pass Route': 'Route', 'Pass Rush': 'Pass rusher', Coverage: 'Couverture' };
const RES_FR = { C: 'Complète', I: 'Incomplète', S: 'Sack', IN: 'Interception', R: 'Scramble' };
const FEATURED = [
  { title: 'Le sack vu du QB', sub: 'Jalen Hurts, 5,7 s en poche', g: 2021091200, p: 2631, cam: 'qb', key: '1' },
  { title: 'Garrett en 1,9 s', sub: 'Caméra sur le rusher', g: 2021102100, p: 2798, cam: 'follow', follow: 'pressure', key: '2' },
  { title: '84 yards de Metcalf', sub: 'Fin d’action calculée', g: 2021102500, p: 326, cam: 'broadcast', key: '3' },
  { title: 'INT sous pression', sub: 'Goff intercepté', g: 2021091204, p: 1670, cam: 'all22', key: '4' },
];
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" style="vertical-align:-1px;margin-right:3px"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/></svg>',
};

// field (x, y) -> three (x, h, -y)
const v3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const teamColor = (t) => TEAM[t]?.[0] ?? '#555';
const ink = (hex) => {
  const c = new THREE.Color(hex); const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.45 ? '#0b0f14' : '#ffffff';
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ord = (n) => (n === 1 ? '1er' : `${n}e`);

// ---------- state ----------
const S = {
  index: null, players: {}, games: {}, gameCache: new Map(),
  play: null, meta: null, f: 0, playing: false, speed: 1,
  cam: 'broadcast', layers: { pocket: true, pressure: true, duels: false, trail: true, labels: true },
  selected: null, tags: new Set(), playerModel: null,
};
const $ = (id) => document.getElementById(id);
const pname = (id) => S.players[id]?.n ?? `#${id}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- three setup ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#04070d'); grad.addColorStop(0.55, '#0b1424'); grad.addColorStop(1, '#1a2a40');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog('#0f1a2b', 150, 340);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 3; controls.maxDistance = 220;

scene.add(new THREE.HemisphereLight('#dfe9ff', '#2a3a20', 1.15));
const sun = new THREE.DirectionalLight('#fff6e8', 2.3);
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 50, bottom: -50, near: 1, far: 250 });
scene.add(sun, sun.target);

// ---------- stadium ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 300), new THREE.MeshStandardMaterial({ color: '#173420', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(60, -0.02, -FIELD_W / 2); ground.receiveShadow = true;
scene.add(ground);

function crowdTexture(seed) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#121820'; g.fillRect(0, 0, 1024, 256);
  const palette = ['#7d8592', '#5b6472', '#8f7d6c', '#4a3a31', '#2a3341', '#7a3134', '#2b4673', '#8a7640', '#9aa1ab', '#2f5a3a'];
  for (let row = 0; row < 32; row++) {
    g.fillStyle = row % 2 ? '#1a2230' : '#161d28'; g.fillRect(0, row * 8, 1024, 8);
    for (let x = 0; x < 1024; x += 6) {
      if (rnd() < 0.22) continue;
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.fillRect(x + rnd() * 1.5, row * 8 + 1 + rnd() * 2, 4, 4.5);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function addStand(cx, cz, rotY, width, depth, seed) {
  const slope = 0.52;
  const tex = crowdTexture(seed); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(width / 60, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2 - slope;
  mesh.position.set(0, Math.sin(slope) * depth / 2, Math.cos(slope) * depth / 2);
  mesh.receiveShadow = true;
  const facade = new THREE.Mesh(new THREE.BoxGeometry(width, 2.2, 0.6), new THREE.MeshStandardMaterial({ color: '#0d141e', roughness: 0.8 }));
  facade.position.set(0, 1.1, -0.3);
  const grp = new THREE.Group(); grp.add(mesh, facade);
  grp.position.set(cx, 0, cz); grp.rotation.y = rotY;
  scene.add(grp);
}
addStand(60, 14, 0, 170, 46, 7);
addStand(60, -FIELD_W - 14, Math.PI, 170, 46, 11);
addStand(-16, -FIELD_W / 2, -Math.PI / 2, 95, 40, 13);
addStand(136, -FIELD_W / 2, Math.PI / 2, 95, 40, 17);

function addGoalpost(x, back) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffd21f', roughness: 0.35, metalness: 0.2, emissive: '#3a2a00' });
  const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 12);
  const grp = new THREE.Group(), cz = -FIELD_W / 2;
  const post = new THREE.Mesh(cyl(0.18, 3.33), mat); post.position.set(x + back * 1.2, 1.67, cz);
  const neck = new THREE.Mesh(cyl(0.12, 1.2), mat); neck.rotation.z = Math.PI / 2; neck.position.set(x + back * 0.6, 3.33, cz);
  const bar = new THREE.Mesh(cyl(0.1, 6.17), mat); bar.rotation.x = Math.PI / 2; bar.position.set(x, 3.33, cz);
  grp.add(post, neck, bar);
  for (const s of [-1, 1]) { const up = new THREE.Mesh(cyl(0.08, 10), mat); up.position.set(x, 8.33, cz + s * 3.08); grp.add(up); }
  grp.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(grp);
}
addGoalpost(0, -1); addGoalpost(120, 1);

const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.25, 'rgba(255,250,220,.55)'); r.addColorStop(1, 'rgba(255,250,220,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
for (const [x, z] of [[-30, 40], [150, 40], [-30, -FIELD_W - 40], [150, -FIELD_W - 40]]) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 52, 8), new THREE.MeshStandardMaterial({ color: '#2a3442' }));
  pole.position.set(x, 26, z);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 1), new THREE.MeshBasicMaterial({ color: '#fffbea' }));
  panel.position.set(x, 53, z); panel.lookAt(60, 0, -FIELD_W / 2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff6d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(34, 34, 1); glow.position.copy(panel.position);
  scene.add(pole, panel, glow);
}

const fieldMat = new THREE.MeshStandardMaterial({ roughness: 0.92 });
const field = new THREE.Mesh(new THREE.PlaneGeometry(126, FIELD_W + 6), fieldMat);
field.rotation.x = -Math.PI / 2; field.position.set(60, 0, -FIELD_W / 2); field.receiveShadow = true;
scene.add(field);

function drawField(home, away) {
  const P = 20, M = 3 * P, W = 126 * P, H = Math.round((FIELD_W + 6) * P);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#245a2b'; g.fillRect(0, 0, W, H); // sideline apron
  g.save(); g.translate(M, M);
  const FW = 120 * P, FH = Math.round(FIELD_W * P);
  for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? '#2f6f35' : '#2b6631'; g.fillRect(i * 5 * P, 0, 5 * P, FH); }
  const hc = teamColor(home), ac = teamColor(away);
  g.fillStyle = hc; g.fillRect(0, 0, 10 * P, FH);
  g.fillStyle = ac; g.fillRect(110 * P, 0, 10 * P, FH);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `800 ${6.5 * P}px "Barlow Condensed", Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [x, t, rot, col] of [[5, home, -Math.PI / 2, hc], [115, away, Math.PI / 2, ac]]) {
    g.save(); g.translate(x * P, FH / 2); g.rotate(rot); g.fillStyle = ink(col) === '#ffffff' ? 'rgba(255,255,255,.92)' : 'rgba(10,15,20,.85)'; g.fillText(t ?? '', 0, 0); g.restore();
  }
  g.strokeStyle = '#ffffff';
  for (let x = 10; x <= 110; x += 5) { g.lineWidth = x === 10 || x === 110 ? 7 : 3; g.beginPath(); g.moveTo(x * P, 0); g.lineTo(x * P, FH); g.stroke(); }
  g.lineWidth = 2;
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const y of [0.6, 23.36, 29.96, FIELD_W - 0.6]) { const py = (FIELD_W - y) * P; g.beginPath(); g.moveTo(x * P, py - 0.4 * P); g.lineTo(x * P, py + 0.4 * P); g.stroke(); }
  }
  g.lineWidth = 8; g.strokeRect(0, 0, FW, FH);
  g.font = `700 ${2.6 * P}px "Barlow Condensed", Inter, sans-serif`; g.fillStyle = 'rgba(255,255,255,.88)';
  for (let k = 1; k <= 9; k++) {
    const x = 10 + 10 * k, n = String(Math.min(10 * k, 100 - 10 * k));
    g.fillText(n, x * P, (FIELD_W - 12) * P);
    g.save(); g.translate(x * P, 12 * P); g.rotate(Math.PI); g.fillText(n, 0, 0); g.restore();
  }
  // midfield disc
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 4; g.beginPath(); g.arc(60 * P, FH / 2, 4 * P, 0, Math.PI * 2); g.stroke();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  fieldMat.map?.dispose(); fieldMat.map = tex; fieldMat.needsUpdate = true;
}
drawField('', '');
document.fonts?.ready.then(() => S.play && drawField(S.games[S.play.gid].homeTeamAbbr, S.games[S.play.gid].visitorTeamAbbr));

// line of scrimmage / first down
const losLine = new THREE.Mesh(new THREE.PlaneGeometry(0.28, FIELD_W), new THREE.MeshBasicMaterial({ color: '#3b82f6' }));
const fdLine = new THREE.Mesh(new THREE.PlaneGeometry(0.28, FIELD_W), new THREE.MeshBasicMaterial({ color: '#facc15' }));
for (const l of [losLine, fdLine]) { l.rotation.x = -Math.PI / 2; l.position.set(0, 0.02, -FIELD_W / 2); scene.add(l); }

// pocket polygon (triangle fan, max 24 verts)
const MAXV = 24;
const pocketGeo = new THREE.BufferGeometry();
pocketGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXV * 3 * 3), 3));
const pocketMat = new THREE.MeshBasicMaterial({ color: '#4da3ff', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
const pocket = new THREE.Mesh(pocketGeo, pocketMat);
scene.add(pocket);
const pocketEdgeGeo = new THREE.BufferGeometry();
pocketEdgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAXV + 1) * 3), 3));
const pocketEdge = new THREE.Line(pocketEdgeGeo, new THREE.LineBasicMaterial({ color: '#4da3ff' }));
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

const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff7a1a' }));
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
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.98, 40), new THREE.MeshBasicMaterial({ color: '#ff7a1a', side: THREE.DoubleSide, transparent: true }));
selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);

// ---------- players ----------
let actors = []; // {ent, obj, ring, label}
const playerRoot = new THREE.Group(); scene.add(playerRoot);

function numberSprite(n, fg, bg) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(26, 8, 76, 48, 12); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = fg; g.font = '800 40px "Barlow Condensed", Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n ?? '', 64, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.4, 0.7, 1); s.position.y = 2.55; s.renderOrder = 10;
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

// QB POV: his right hand + the ball, attached to the camera
const viewModel = makeViewModel(GEO.ball);
viewModel.group.visible = false;
camera.add(viewModel.group); scene.add(camera);

// QB possession: from the snap until the release on passes, or while the ball stays on him (sacks, scrambles)
const THROWS = new Set(['C', 'I', 'IN']);
function qbHold(f) {
  const play = S.play, rel = play.end - 1, thrown = THROWS.has(play.sim?.kind);
  const throwT = thrown ? (f - rel) / HZ : null;
  const qbA = actors.find((a) => a.ent.r === 'Pass'), ballA = actors.find((a) => a.ent.id === -1);
  if (!qbA || !ballA || f < play.snap - 1 || (thrown && f > rel)) return { holding: false, throwT };
  const q = sample(qbA.ent, f), b = sample(ballA.ent, f);
  return { holding: Math.hypot(q.x - b.x, q.y - b.y) < 1.5, throwT };
}

function makePlayer(kit) {
  if (S.playerModel) {
    const o = S.playerModel.clone(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true;
      m.material = m.material.clone();
      const n = (m.material.name || m.name).toLowerCase();
      const slot = KIT_SLOTS.find(([k]) => n.includes(k));
      if (slot) m.material.color.set(kit[slot[1]]);
    });
    return o;
  }
  const grp = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const body = new THREE.Mesh(GEO.body, mat(kit.jersey)); body.position.y = 0.73;
  const pads = new THREE.Mesh(GEO.pads, mat(kit.trim)); pads.position.y = 1.32;
  const head = new THREE.Mesh(GEO.helmet, new THREE.MeshStandardMaterial({ color: kit.helmet, roughness: 0.25, metalness: 0.3 })); head.position.y = 1.72;
  const mask = new THREE.Mesh(GEO.mask, mat(kit.facemask)); mask.position.set(0.2, 1.68, 0);
  for (const m of [body, pads, head, mask]) { m.castShadow = true; grp.add(m); }
  return grp;
}

function buildActors(play, meta, game) {
  for (const a of actors) { playerRoot.remove(a.obj, a.ring); a.label?.material.map.dispose(); }
  actors = [];
  const beaten = new Map(meta.beaten.map((b) => [b.b, b.k]));
  const credited = new Map(meta.credits.map((c) => [c.p, c.k]));
  for (const ent of play.ents) {
    let obj, label = null, rig = null;
    if (ent.id === -1) {
      obj = new THREE.Mesh(GEO.ball, new THREE.MeshStandardMaterial({ color: '#7a3e12', roughness: 0.5 }));
      obj.scale.set(1.5, 0.9, 0.9); obj.castShadow = true;
    } else {
      const kit = kitFor(ent.t, ent.t === game.homeTeamAbbr);
      obj = makePlayer(kit);
      obj.userData.nflId = ent.id;
      rig = S.playerModel ? makeRig(obj, ent) : null;
      if (ent.r === 'Pass') viewModel.setKit(kit);
      label = numberSprite(ent.j, kit.num, kit.jersey);
      obj.add(label);
    }
    let ring = null;
    const k = beaten.get(ent.id) ?? credited.get(ent.id);
    if (k) {
      const col = beaten.has(ent.id) ? '#ff4d4f' : '#ff7a1a';
      ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; playerRoot.add(ring);
    }
    playerRoot.add(obj);
    actors.push({ ent, obj, ring, label, rig });
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

function updateScene(time) {
  const play = S.play; if (!play) return;
  const f = S.f;
  const pos = new Map();
  const qbA = actors.find((a) => a.ent.r === 'Pass'), ballA = actors.find((a) => a.ent.id === -1);
  const hold = qbHold(f);
  // after a (computed) catch or interception the ball carrier holds the ball like the QB does
  const sim = play.sim, carrierHolds = !!sim && (sim.kind === 'C' || sim.kind === 'IN') && sim.carrier != null && f >= sim.catchF;
  const carrierA = carrierHolds ? actorMap.get(sim.carrier) : null;
  for (const a of actors) {
    const p = sample(a.ent, f); pos.set(a.ent.id, p);
    if (a.ent.id === -1) {
      a.obj.position.copy(v3(p.x, p.y, ballHeight(play, f)));
      const fa = facing(p.o || 90); a.obj.rotation.y = Math.atan2(fa.y, fa.x);
    } else {
      a.obj.position.copy(v3(p.x, p.y));
      a.obj.rotation.y = Math.PI / 2 - p.o * Math.PI / 180;
      if (a.label) {
        a.label.visible = S.layers.labels && S.cam !== 'qb';
        // fade numbers that are right in front of the lens (follow / close orbit)
        const d = camera.position.distanceTo(a.obj.position), k = Math.max(0.28, Math.min(1, d / 22));
        a.label.scale.set(1.4 * k, 0.7 * k, 1); a.label.position.y = 2.15 + 0.4 * k;
        a.label.material.opacity = Math.max(0, Math.min(1, (d - 2.5) / 3));
      }
      a.obj.visible = !(S.cam === 'qb' && a.ent.r === 'Pass');
      if (a.rig) animate(a.rig, a.ent, f, p, { pre: f < play.snap - 1, holding: (a === qbA && hold.holding) || a === carrierA, throwT: a === qbA ? hold.throwT : null });
    }
    if (a.ring) a.ring.position.copy(v3(p.x, p.y, 0.03));
  }
  // the ball sits in the QB's right hand while he holds it (hidden in his own POV: the view model shows it)
  if (hold.holding && qbA.rig && ballA) {
    qbA.obj.updateMatrixWorld(true);
    ballA.obj.position.copy(qbA.rig.forearm_R.localToWorld(qbA.rig.hand.clone()));
  }
  if (carrierA?.rig && ballA) {
    carrierA.obj.updateMatrixWorld(true);
    ballA.obj.position.copy(carrierA.rig.forearm_R.localToWorld(carrierA.rig.hand.clone()));
  }
  if (ballA) ballA.obj.visible = !(S.cam === 'qb' && hold.holding);
  viewModel.group.visible = S.cam === 'qb' && hold.holding;
  if (viewModel.group.visible) viewModel.update(hold.throwT, pos.get(qbA.ent.id).s, time);
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
    const col = md < 2 ? '#ff4d4f' : md < 3.5 ? '#ff7a1a' : '#4da3ff';
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
        const c = new THREE.Color(beaten.has(a.ent.id) ? '#ff4d4f' : '#ffffff');
        for (const r of [p, q]) { P[k] = r.x; P[k + 1] = 0.6; P[k + 2] = -r.y; C[k] = c.r; C[k + 1] = c.g; C[k + 2] = c.b; k += 3; }
      }
    }
    g.setDrawRange(0, k / 3); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }

  // selection
  const sel = S.selected != null && pos.get(S.selected);
  selRing.visible = !!sel;
  if (sel) { selRing.position.copy(v3(sel.x, sel.y, 0.035)); const s = 1 + 0.08 * Math.sin(time * 5); selRing.scale.set(s, s, s); }
  trail.visible = trailSim.visible = !!sel && S.layers.trail;
  ballPathSim.visible = carrierPathSim.visible = simSpot.visible = !!play.sim && S.layers.trail;
  updatePlayerCard(pos, qb);
  return { pos, qb };
}

// ---------- cameras ----------
let tween = null, camJump = false;
// lead: yards ahead of the ball (downfield) to aim at; lateral: share of the ball's sideline movement followed
const TRACK = {
  broadcast: { lead: 0, lateral: 0.7, base: 2 },
  all22: { lead: 4, lateral: 0.5, base: 0 },
  endzone: { lead: -3, lateral: 0.5, base: 0 },
  top: { lead: 0, lateral: 0.9, base: 0 },
};
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
  // Broadcast-style views track the ball (aiming slightly ahead of it) for the whole play, including the
  // computed phase. Camera and target move together, so any orbit the user applied is preserved.
  const track = TRACK[S.cam];
  if (track && !tween && S.play) {
    const ballEnt = S.play.ents.find((e) => e.id === -1);
    if (ballEnt) {
      const b = sample(ballEnt, S.f), ahead = sample(ballEnt, Math.min(S.play.n - 1, S.f + 3));
      const s = S.play.dir === 'right' ? 1 : -1, cy = -FIELD_W / 2;
      const fx = ahead.x + s * track.lead, fz = -ahead.y;
      const k = 1 - Math.exp(-dt * 4);
      const dx = (fx - controls.target.x) * k, dz = (track.base + cy + (fz - cy) * track.lateral - controls.target.z) * k;
      camera.position.x += dx; controls.target.x += dx;
      camera.position.z += dz; controls.target.z += dz;
    }
  }
  const id = S.cam === 'qb' ? actors.find((a) => a.ent.r === 'Pass')?.ent.id : S.cam === 'follow' ? S.selected : null;
  const p = id != null && pos.get(id);
  if (!p) return;
  const fa = facing(p.o);
  if (S.cam === 'qb') {
    tmpPos.copy(v3(p.x, p.y, 1.85));
    // after the release the QB keeps his eyes on the throw: the target spot, then the ball (carrier)
    const s = S.play.sim, rel = S.play.end - 1, b = pos.get(-1);
    if (S.f > rel && THROWS.has(s?.kind)) tmpTgt.copy(S.f < s.catchF ? v3(s.C.x, s.C.y, 1.3) : v3(b.x, b.y, 1.0));
    else tmpTgt.copy(v3(p.x + fa.x * 20, p.y + fa.y * 20, 1.0));
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

// ---------- UI: player card ----------
function selectPlayer(id) {
  S.selected = id;
  const a = actorMap.get(id);
  $('player').style.display = a ? 'block' : 'none';
  if (!a) { if (S.cam === 'follow') setCam('broadcast'); return; }
  const n = a.ent.d.length / 4, nr = S.play.nReal, pts = [];
  for (let i = 0; i < n; i++) pts.push(v3(a.ent.d[i * 4], a.ent.d[i * 4 + 1], 0.06));
  setLine(trail, pts.slice(0, nr)); setLine(trailSim, pts.slice(nr - 1));
  const info = S.players[id] ?? {}, kit = kitFor(a.ent.t, a.ent.t === S.games[S.meta.g].homeTeamAbbr);
  const jersey = $('pJersey');
  jersey.textContent = a.ent.j ?? '';
  jersey.style.background = kit.jersey;
  jersey.style.color = kit.num;
  $('pName').textContent = info.n ?? `#${id}`;
  $('pRole').textContent = [a.ent.t, info.pos, ROLE_FR[a.ent.r], a.ent.pl && `aligné ${a.ent.pl}`].filter(Boolean).join(' · ');
  $('pDist').parentElement.style.display = a.ent.r === 'Pass' ? 'none' : '';
}
let lastCard = 0;
function updatePlayerCard(pos, qb) {
  const a = S.selected != null && actorMap.get(S.selected); if (!a) return;
  const now = performance.now(); if (now - lastCard < 80) return; lastCard = now;
  const p = pos.get(a.ent.id);
  $('pSpeed').innerHTML = `${(p.s * 2.045).toFixed(1)}<span class="sub"> mph</span>`;
  if (qb && a.ent.r !== 'Pass') {
    const d = Math.hypot(p.x - qb.x, p.y - qb.y);
    $('pDist').innerHTML = `${d.toFixed(1)}<span class="sub"> yd</span>`;
    $('pDist').style.color = a.ent.r === 'Pass Rush' && d < 2 ? 'var(--danger)' : '';
  }
}
$('followBtn').onclick = () => setCam('follow');
$('unselectBtn').onclick = () => selectPlayer(null);

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  canvas.style.cursor = ray.intersectObjects(playerRoot.children, true).some((h) => { let o = h.object; while (o && o.userData.nflId == null) o = o.parent; return o; }) ? 'pointer' : '';
});
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
  if (chart.width !== Math.round(w * dpr)) { chart.width = Math.round(w * dpr); chart.height = Math.round(h * dpr); }
  cg.setTransform(dpr, 0, 0, dpr, 0, 0); cg.clearRect(0, 0, w, h);
  const n = play.n, X = (i) => (i / (n - 1)) * w;
  const MD = 10, yMd = (d) => h - (Math.min(d, MD) / MD) * (h - 6) - 3;
  const amax = Math.max(1, ...play.area), yA = (a) => h - (a / amax) * (h - 6) - 3;
  cg.fillStyle = 'rgba(255,255,255,.035)'; cg.fillRect(X(play.snap - 1), 0, X(play.end - 1) - X(play.snap - 1), h);
  if (play.nReal < n) {
    const x0 = X(play.nReal - 1);
    cg.save(); cg.beginPath(); cg.rect(x0, 0, w - x0, h); cg.clip();
    cg.fillStyle = 'rgba(192,132,252,.07)'; cg.fillRect(x0, 0, w - x0, h);
    cg.strokeStyle = 'rgba(192,132,252,.22)'; cg.lineWidth = 1;
    for (let x = x0 - h; x < w; x += 8) { cg.beginPath(); cg.moveTo(x, h); cg.lineTo(x + h, 0); cg.stroke(); }
    cg.restore();
    cg.fillStyle = '#c084fc'; cg.font = '700 10.5px Inter'; cg.fillText('CALCULÉ · hors tracking', x0 + 8, h - 7);
  }
  cg.strokeStyle = 'rgba(139,152,169,.7)'; cg.setLineDash([4, 4]); cg.lineWidth = 1; cg.beginPath(); cg.moveTo(0, yMd(2)); cg.lineTo(w, yMd(2)); cg.stroke(); cg.setLineDash([]);
  cg.fillStyle = 'rgba(139,152,169,.9)'; cg.font = '600 10px Inter'; cg.fillText('2 yd', 4, yMd(2) - 4);
  const line = (arr, y, col, fill) => {
    cg.beginPath(); let started = false, last = 0;
    arr.forEach((v, i) => { if (v == null) return; if (!started) { cg.moveTo(X(i), y(v)); started = true; } else cg.lineTo(X(i), y(v)); last = i; });
    cg.strokeStyle = col; cg.lineWidth = 2; cg.stroke();
    if (fill && started) { cg.lineTo(X(last), h); cg.lineTo(0, h); cg.closePath(); cg.fillStyle = fill; cg.fill(); }
  };
  line(play.area, yA, '#4da3ff', 'rgba(77,163,255,.08)'); line(play.md, yMd, '#ff4d4f');
  const x = X(S.f);
  cg.strokeStyle = '#fff'; cg.lineWidth = 1.5; cg.beginPath(); cg.moveTo(x, 0); cg.lineTo(x, h); cg.stroke();
  const md = play.md[Math.round(S.f)];
  if (md != null) {
    const label = `${md.toFixed(1)} yd`; cg.font = '700 11px Inter';
    const tw = cg.measureText(label).width + 10, lx = Math.min(x + 6, w - tw - 2);
    cg.fillStyle = md < 2 ? '#ff4d4f' : 'rgba(16,21,29,.95)'; cg.beginPath(); cg.roundRect(lx, 3, tw, 17, 5); cg.fill();
    cg.fillStyle = '#fff'; cg.fillText(label, lx + 5, 15);
    cg.beginPath(); cg.arc(x, yMd(md), 3.5, 0, Math.PI * 2); cg.fillStyle = '#ff4d4f'; cg.fill();
  }
}
const EV_FR = { ball_snap: 'Snap', autoevent_ballsnap: 'Snap', pass_forward: 'Passe', autoevent_passforward: 'Passe', qb_sack: 'SACK', qb_strip_sack: 'Strip-sack', play_action: 'Play-action', run: 'Scramble', man_in_motion: 'Motion', pass_tipped: 'Dévié', fumble: 'Fumble' };
function drawMarks() {
  const play = S.play, seen = new Set();
  $('marks').innerHTML = play.events.filter(([, e]) => EV_FR[e] && !seen.has(EV_FR[e]) && seen.add(EV_FR[e]))
    .map(([f, e]) => `<span style="left:${((f - 1) / (play.n - 1)) * 100}%">${EV_FR[e]}</span>`).join('')
    + (play.sim ? [[play.sim.catchF, { C: 'Réception*', IN: 'INT*', I: 'Incomplète*', R: '' }[play.sim.kind]], [play.sim.tackleF, play.sim.F ? (play.sim.td ? 'TD*' : 'Plaqué*') : '']]
      .filter(([, l]) => l).map(([f, l]) => `<span class="sim" style="left:${(f / (play.n - 1)) * 100}%">${l}</span>`).join('') : '');
  $('scrub').max = play.n - 1;
  const z = (play.nReal - 1) / (play.n - 1) * 100;
  $('simzone').style.display = play.sim ? 'block' : 'none';
  $('simzone').style.left = `${z}%`; $('simzone').style.width = `${100 - z}%`;
}
function syncPlayBtn() { $('playBtn').innerHTML = S.playing ? ICON.pause : ICON.play; }
function step(dir) { S.playing = false; S.f = dir > 0 ? Math.min(S.play.n - 1, Math.floor(S.f) + 1) : Math.max(0, Math.ceil(S.f) - 1); syncPlayBtn(); }
function restart() { S.f = Math.max(0, S.play.snap - 6); S.playing = true; syncPlayBtn(); }
$('scrub').addEventListener('input', (e) => { S.f = +e.target.value; S.playing = false; syncPlayBtn(); });
$('playBtn').onclick = () => { if (!S.play) return; if (S.f >= S.play.n - 1.01) S.f = 0; S.playing = !S.playing; syncPlayBtn(); };
$('restart').onclick = restart;
$('stepBack').onclick = () => step(-1);
$('stepFwd').onclick = () => step(1);
$('speed').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}" class="${s === 1 ? 'on' : ''}">${String(s).replace('.', ',')}×</button>`).join('');
$('speed').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  S.speed = +b.dataset.speed; $('speed').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
}));
addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') { closeModals(); return; }
  if (!S.play || document.querySelector('.modal.open')) return;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  else if (e.code === 'ArrowRight') step(1);
  else if (e.code === 'ArrowLeft') step(-1);
  else if (e.key === 'r' || e.key === 'R') restart();
  else if (/^[1-7]$/.test(e.key)) setCam(CAMS[+e.key - 1][0]);
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
  if (!s) return S.meta.res === 'S' ? '' : `<div class="simbox"><div class="simhead">Fin d'action non calculée</div><div class="sub">Aucune cible identifiable dans la description.</div></div>`;
  const who = s.carrier != null ? `<span class="link" data-sel="${s.carrier}">${esc(pname(s.carrier))}</span>` : '—';
  const row = (k, v, src) => `<div class="simrow"><span>${k}</span><b>${v}</b><i>${src}</i></div>`;
  const kind = { C: 'Réception', I: 'Passe incomplète', IN: 'Interception', R: 'Scramble' }[s.kind];
  return `<div class="simbox">
    <div class="simhead">Fin d'action calculée <span>HORS TRACKING</span></div>
    <div class="sub" style="margin-bottom:6px">Le tracking s'arrête 0,5 s après la passe. La suite (zone hachurée, joueurs translucides, pointillés violets) est reconstruite :</div>
    ${row(kind === 'Scramble' ? 'Porteur' : kind === 'Interception' ? 'Intercepteur' : 'Cible', who, esc(s.method))}
    ${s.kind !== 'R' ? row('Vitesse du ballon', `${s.ballSpeed.toFixed(1)} yd/s`, s.measuredSpeed > 3 ? 'mesurée (tracking)' : 'valeur par défaut') : ''}
    ${s.kind !== 'R' ? row('Temps de vol', `${s.flightTotal.toFixed(1)} s`, 'calculé') : ''}
    ${s.airYds != null ? row('Air yards', `${s.airYds.toFixed(0)} yd`, 'calculé') : ''}
    ${s.yac != null ? row('Yards après réception', `${s.yac.toFixed(0)} yd`, 'calculé') : ''}
    ${s.F ? row('Spot final', s.td ? 'Touchdown' : `${S.meta.yds > 0 ? '+' : ''}${S.meta.yds} yd`, 'résultat officiel') : ''}
    <div class="sub" style="margin-top:8px;font-size:11px">Hypothèses : receveur prolongé à sa dernière vitesse mesurée, ballon en ligne droite (hauteur parabolique), défenseurs qui convergent puis poursuivent le porteur.</div>
  </div>`;
}

// ---------- UI: info panel ----------
function fieldPosition(meta, play) {
  if (play.los == null) return '';
  const own = play.dir === 'right' ? play.los - 10 : 110 - play.los;
  const yl = Math.round(own);
  return yl === 50 ? '50' : yl < 50 ? `${meta.off} ${yl}` : `${meta.def} ${100 - yl}`;
}
function infoPanel(meta) {
  const who = (id) => `<span class="link" data-sel="${id}">${esc(pname(id))}</span>`;
  const pressured = meta.ttp != null && meta.ttp <= meta.ttt;
  const margin = meta.ttp != null ? meta.ttt - meta.ttp : null;
  const oc = teamColor(meta.off), dc = teamColor(meta.def);
  const g = S.games[meta.g];
  const metric = (label, value, unit, tip, color, cls = '') => `<div class="metric ${cls}" title="${esc(tip)}"><small>${label}</small><b style="${color ? `color:${color}` : ''}">${value}${unit ? `<em>${unit}</em>` : ''}</b></div>`;
  const hero = pressured
    ? `<div class="metric hero" title="Temps entre le snap et le moment où le premier rusher arrive à moins de 2 yards du QB (tracking 10 Hz).">
         <div><small>Pocket Clock</small><b class="num" style="color:var(--danger)">${meta.ttp.toFixed(1)}<em>s</em></b></div>
         <div class="exp">Le premier rusher (${who(meta.pressureBy)}) est arrivé à <strong>moins de 2 yd du QB</strong> en ${meta.ttp.toFixed(1)} s, soit <strong>${margin.toFixed(1)} s avant</strong> ${meta.res === 'S' ? 'le sack' : 'la passe'}.</div></div>`
    : `<div class="metric hero" title="Aucun rusher à moins de 2 yards du QB avant la passe." style="background:linear-gradient(120deg,rgba(47,210,122,.12),transparent 70%);border-color:rgba(47,210,122,.35)">
         <div><small>Pocket Clock</small><b class="num" style="color:var(--ok)">Propre</b></div>
         <div class="exp">Aucun rusher à moins de 2 yd du QB avant ${meta.res === 'S' ? 'le sack' : 'la passe'}.${meta.minDist != null ? ` Le plus proche est resté à <strong>${meta.minDist.toFixed(1)} yd</strong>.` : ''}</div></div>`;
  const people = [];
  if (meta.pressureBy && pressured) people.push(`<div class="duel"><span class="k first">1er arrivé</span>${who(meta.pressureBy)}<span class="vs" style="margin-left:auto">${meta.ttp.toFixed(1)} s</span></div>`);
  for (const c of meta.credits) people.push(`<div class="duel"><span class="k ${c.k}">${c.k}</span>${who(c.p)}<span class="vs" style="margin-left:auto">PFF</span></div>`);
  for (const b of meta.beaten) people.push(`<div class="duel"><span class="k ${b.k === 'beaten' ? 'beaten' : b.k}">${b.k === 'beaten' ? 'battu' : b.k + ' concédé'}</span>${who(b.b)}${b.d ? `<span class="vs">par</span>${who(b.d)}` : ''}</div>`);
  const min = $('info').classList.contains('min');
  const rushers = S.play.ents.filter((e) => e.r === 'Pass Rush').length;
  $('info').innerHTML = `
    <button class="collapse" id="collapseInfo" title="Réduire / agrandir">${min ? '+' : '−'}</button>
    <div class="bug">
      <div class="team" style="background:${oc};color:${ink(oc)}"><small>Attaque</small><b>${meta.off}</b></div>
      <div class="mid"><b class="num">Q${meta.q} · ${meta.clock}</b><small>S${g?.week ?? ''} · ${g ? `${g.visitorTeamAbbr} @ ${g.homeTeamAbbr}` : ''}</small></div>
      <div class="team def" style="background:${dc};color:${ink(dc)}"><small>Défense</small><b>${meta.def}</b></div>
    </div>
    <div class="scroll">
      <div class="situation">
        <span class="pill">${ord(meta.down)} & ${meta.ytg}</span>
        ${S.play?.los != null ? `<span class="pill">Ballon ${fieldPosition(meta, S.play)}</span>` : ''}
        <span class="pill res-${meta.res}">${RES_FR[meta.res] ?? meta.res} · ${meta.yds > 0 ? '+' : ''}${meta.yds ?? 0} yd</span>
      </div>
      <div class="desc" id="desc" title="Cliquer pour tout afficher">${esc(meta.desc)}</div>
      <div class="metrics">
        ${hero}
        ${metric('Avant passe', meta.ttt.toFixed(1), 's', 'Du snap à la passe (ou au sack / scramble).')}
        ${metric('Marge du QB', margin != null ? `${margin > 0 ? '+' : ''}${margin.toFixed(1)}` : '—', margin != null ? 's' : '', 'Temps passé par le QB sous pression avant de lâcher le ballon (temps avant passe − Pocket Clock).', margin > 1 ? 'var(--danger)' : '')}
        ${metric('Dist. min.', meta.minDist != null ? meta.minDist.toFixed(1) : '—', meta.minDist != null ? 'yd' : '', 'Distance minimale entre un pass rusher et le QB avant la passe.')}
        ${metric('Rushers', rushers || '—', rushers >= 5 ? 'blitz' : '', 'Nombre de défenseurs envoyés sur le QB (PFF). 5 ou plus = blitz.', rushers >= 5 ? 'var(--warn)' : '')}
        ${metric('Couverture', esc(meta.cov || '—'), '', 'Schéma de couverture défensive (PFF).', '', 'txt')}
        ${metric('Formation', esc((meta.form || '—').replace('_', ' ')), '', 'Formation offensive.', '', 'txt')}
      </div>
      ${people.length ? `<div class="section">Qui a fait la différence</div>${people.join('')}` : ''}
      ${simSection()}
      <div class="sub" style="margin-top:12px"><span class="link" id="howto">Comment lire la scène ?</span></div>
    </div>`;
  $('info').querySelectorAll('[data-sel]').forEach((el) => (el.onclick = () => selectPlayer(+el.dataset.sel)));
  $('desc').onclick = (e) => e.currentTarget.classList.toggle('open');
  $('collapseInfo').onclick = () => { $('info').classList.toggle('min'); $('collapseInfo').textContent = $('info').classList.contains('min') ? '+' : '−'; };
  $('howto').onclick = openGuide;
}

// ---------- event banners (SACK / INTERCEPTION / TOUCHDOWN) ----------
let banners = [], lastF = 0;
function buildBanners(play, meta) {
  const ev = (names) => play.events.find(([, e]) => names.includes(e))?.[0];
  const out = [], sim = play.sim;
  if (meta.res === 'S') {
    const f = ev(['qb_sack', 'qb_strip_sack']) ?? play.end;
    const by = meta.credits.find((c) => c.k === 'sack')?.p ?? meta.pressureBy;
    out.push({ f: f - 1, text: 'SACK', sub: by ? pname(by) : `${meta.yds} yd`, color: '#ff3b30' });
  }
  if (sim?.kind === 'IN') out.push({ f: sim.catchF, text: 'INTERCEPTION', sub: sim.carrier ? pname(sim.carrier) : '', color: '#2563eb' });
  if (sim?.td && sim.F) out.push({ f: sim.tackleF, text: sim.kind === 'IN' ? 'PICK SIX' : 'TOUCHDOWN', sub: sim.carrier ? `${pname(sim.carrier)} · ${Math.abs(meta.yds ?? 0)} yd` : '', color: sim.kind === 'IN' ? '#7c3aed' : '#16a34a' });
  banners = out;
}
function showBanner(b) {
  const el = $('banner');
  $('bannerText').textContent = b.text; $('bannerSub').textContent = b.sub; $('bannerSub').style.display = b.sub ? '' : 'none';
  el.style.setProperty('--bc', b.color);
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
}
function checkBanners(f) {
  // fire when playback crosses the event frame going forward (not when scrubbing backwards)
  if (f > lastF && f - lastF < 3) for (const b of banners) if (lastF < b.f && f >= b.f) showBanner(b);
  lastF = f;
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
function setLoading(text) {
  $('loading').style.display = text ? 'grid' : 'none';
  if (text) $('loadingText').textContent = text;
}
async function openPlay(meta, opts = {}) {
  if (!S.gameCache.has(meta.g)) setLoading('Chargement du match…');
  const game = await loadGame(meta.g);
  const play = game[meta.p];
  setLoading(null);
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
  buildBanners(S.play, meta); lastF = S.f; $('banner').classList.remove('go');
  if (opts.follow === 'pressure' && meta.pressureBy) selectPlayer(meta.pressureBy);
  const cam = opts.cam ?? (S.cam === 'follow' && S.selected == null ? 'broadcast' : S.cam);
  setCam(cam, !opts.instant);
  if (cam === 'free') { const p = camPreset('broadcast'); tween = { from: camera.position.clone(), fromT: controls.target.clone(), ...p, t: opts.instant ? 1 : 0 }; }
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('active', el.dataset.k === `${meta.g}_${meta.p}`));
  history.replaceState(null, '', `#g=${meta.g}&p=${meta.p}${opts.keepHash ? location.hash.match(/&cam=.*/)?.[0] ?? '' : ''}`);
}

// ---------- sidebar ----------
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
  const active = $('q').value || $('team').value || $('game').value || S.tags.size;
  $('reset').hidden = !active;
  $('count').textContent = `${rows.length.toLocaleString('fr-FR')} actions${rows.length > 300 ? ' · 300 affichées' : ''}`;
  if (!rows.length) { $('list').innerHTML = '<div class="empty">Aucune action ne correspond à ces filtres.</div>'; return; }
  const cur = S.meta && `${S.meta.g}_${S.meta.p}`;
  $('list').innerHTML = rows.slice(0, 300).map((p) => {
    const pressured = p.ttp != null && p.ttp <= p.ttt;
    return `<div class="item${cur === `${p.g}_${p.p}` ? ' active' : ''}" data-k="${p.g}_${p.p}" style="--team:${teamColor(p.off)}">
      <div class="top"><span class="teams">${p.off}<em>vs</em>${p.def}</span><span class="when">S${S.games[p.g]?.week ?? ''} · Q${p.q} ${p.clock}</span></div>
      <div class="desc">${esc(p.desc.replace(/^\(\d+:\d+\)\s*/, ''))}</div>
      <div class="bottom">${p.tags.slice(0, 5).map((t) => `<span class="tag ${t}">${TAG_SHORT[t]}</span>`).join('')}
        <span class="pc ${pressured ? 'hot' : ''}" title="Pocket Clock">${ICON.clock}${pressured ? `${p.ttp.toFixed(1)} s` : 'propre'}</span></div>
    </div>`;
  }).join('');
  const byKey = new Map(rows.map((p) => [`${p.g}_${p.p}`, p]));
  $('list').querySelectorAll('.item').forEach((el) => (el.onclick = () => openPlay(byKey.get(el.dataset.k))));
}
$('reset').onclick = () => {
  $('q').value = ''; $('team').value = ''; $('side').value = 'any'; $('game').value = '';
  S.tags.clear(); document.querySelectorAll('#tags .chip').forEach((c) => c.classList.remove('on'));
  renderList();
};

function renderFeatured() {
  $('cards').innerHTML = FEATURED.map((f, i) => `<button class="card" data-i="${i}"><i>${f.key}</i><b>${f.title}</b><span>${f.sub}</span></button>`).join('');
  $('cards').querySelectorAll('.card').forEach((el) => (el.onclick = () => {
    const f = FEATURED[+el.dataset.i], meta = S.index.plays.find((p) => p.g === f.g && p.p === f.p);
    if (meta) openPlay(meta, { cam: f.cam, follow: f.follow });
  }));
}

// ---------- modals ----------
function closeModals() { document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')); }
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));

function renderLeaders() {
  const L = S.index.leaders;
  const maxR = Math.max(...L.rushers.map((r) => r.count)), maxB = Math.max(...L.blockers.map((r) => r.count)), maxT = Math.max(...L.teams.map((t) => t.pressureRate));
  const person = (id) => `<span class="link" data-q="${esc(pname(id))}">${esc(pname(id))}</span> <span class="sub">${S.players[id]?.pos ?? ''}</span>`;
  $('leadersSheet').innerHTML = `
    <button class="btn close" data-close>Fermer ✕</button>
    <h2>Classements</h2>
    <div class="sub" style="max-width:760px">Calculés sur les 8 557 dropbacks (sem. 1–8). <b style="color:var(--text)">Pocket Clock</b> = temps entre le snap et l'arrivée du premier rusher à moins de 2 yards du QB, mesuré sur le tracking 10 Hz, compté seulement quand c'est avant la passe. Cliquez sur un nom pour voir ses actions.</div>
    <div class="cols">
      <div><h3>Rushers les plus souvent 1ers sur le QB</h3><table class="rank">${L.rushers.slice(0, 15).map((r, i) => `<tr><td class="n">${i + 1}</td><td>${person(r.id)}<div class="bar" style="width:${(r.count / maxR) * 100}%"></div></td><td class="v">${r.count}<div class="sub" style="font:500 10.5px Inter">${r.median.toFixed(1)} s méd.</div></td></tr>`).join('')}</table></div>
      <div><h3>Bloqueurs les plus battus</h3><table class="rank">${L.blockers.slice(0, 15).map((r, i) => `<tr><td class="n">${i + 1}</td><td>${person(r.id)}<div class="bar red" style="width:${(r.count / maxB) * 100}%"></div></td><td class="v">${r.count}<div class="sub" style="font:500 10.5px Inter">pressions</div></td></tr>`).join('')}</table></div>
      <div><h3>Protection par équipe</h3><table class="rank">${L.teams.map((t, i) => `<tr><td class="n">${i + 1}</td><td><span class="dot" style="background:${teamColor(t.off)}"></span><span class="link" data-team="${t.off}">${t.off}</span> <span class="sub">${t.ttt.toFixed(2)} s · ${t.sacks} sacks</span><div class="bar blue" style="width:${(t.pressureRate / maxT) * 100}%"></div></td><td class="v">${t.pressureRate}%</td></tr>`).join('')}</table>
        <div class="sub" style="margin-top:6px">% de dropbacks avec un rusher à moins de 2 yd avant la passe. Plus c'est bas, mieux la ligne protège.</div></div>
    </div>`;
  $('leadersSheet').querySelector('[data-close]').onclick = closeModals;
  $('leadersSheet').querySelectorAll('[data-q]').forEach((el) => (el.onclick = () => { $('q').value = el.dataset.q.toLowerCase(); closeModals(); renderList(); }));
  $('leadersSheet').querySelectorAll('[data-team]').forEach((el) => (el.onclick = () => { $('team').value = el.dataset.team; $('side').value = 'off'; closeModals(); renderList(); }));
}
$('leadersBtn').onclick = () => { if (!S.index) return; renderLeaders(); $('leaders').classList.add('open'); };

function openGuide() {
  const item = (sw, t, d) => `<div class="legend-item"><div class="sw" style="${sw}"></div><div><b>${t}</b><span>${d}</span></div></div>`;
  $('guideSheet').innerHTML = `
    <button class="btn close" data-close>Fermer ✕</button>
    <h2>Comment ça marche</h2>
    <div class="sub">PocketReplay recrée en 3D chaque dropback de la saison NFL 2021 (sem. 1–8) à partir du tracking Next Gen Stats (10 images/s) et du scouting PFF.</div>
    <div class="steps">
      <div><b>1</b>Choisissez une action : « À voir en premier », ou filtrez par équipe, joueur ou type (sacks, hits…).</div>
      <div><b>2</b>Changez d'angle : TV, All-22, vue défense, <strong>yeux du QB</strong>… ou cliquez sur un joueur pour le suivre.</div>
      <div><b>3</b>Lisez la pression : la poche rougit quand un rusher entre à moins de 2 yd. Le graphe en bas montre le moment exact.</div>
    </div>
    <div class="grid">
      ${item('background:rgba(77,163,255,.35);border:2px solid #4da3ff', 'La poche', 'Enveloppe des bloqueurs et du QB. Orange sous 3,5 yd, rouge sous 2 yd.')}
      ${item('background:linear-gradient(90deg,#ffd60a,#ff9f0a,#ff3b30)', 'Lignes de pression', 'Relient chaque rusher à moins de 5 yd au QB. Jaune, puis orange, puis rouge.')}
      ${item('background:transparent;border:3px solid #ff4d4f;border-radius:50%', 'Anneau rouge', 'Bloqueur battu (sack, hit ou hurry concédé selon PFF).')}
      ${item('background:transparent;border:3px solid #ff7a1a;border-radius:50%', 'Anneau orange', 'Défenseur crédité d’un sack, hit ou hurry (PFF).')}
      ${item('background:linear-gradient(90deg,#3b82f6 0 50%,#facc15 50%)', 'Lignes au sol', 'Bleu : ligne de scrimmage. Jaune : ligne du 1er down.')}
      ${item('background:repeating-linear-gradient(45deg,#c084fc 0 4px,transparent 4px 8px);border:1px solid #c084fc', 'Violet hachuré = calculé', 'Le tracking s’arrête 0,5 s après la passe. La suite est reconstruite et toujours signalée.')}
    </div>
    <div class="section" style="margin-top:18px">Raccourcis</div>
    <div class="sub" style="display:flex;gap:16px;flex-wrap:wrap"><span><kbd>Espace</kbd> lecture / pause</span><span><kbd>←</kbd> <kbd>→</kbd> image par image</span><span><kbd>R</kbd> revoir depuis le snap</span><span><kbd>1</kbd>–<kbd>7</kbd> caméras</span><span>Clic sur un joueur = fiche + suivi</span></div>
    <div style="margin-top:18px;display:flex;justify-content:flex-end"><button class="btn primary" data-close>C'est parti</button></div>`;
  $('guideSheet').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => { closeModals(); store.set('pr_seen', '1'); }));
  $('guide').classList.add('open');
}
$('helpBtn').onclick = openGuide;

// ---------- init ----------
async function init() {
  $('cams').innerHTML = CAMS.map(([k, l], i) => `<button data-cam="${k}" title="${l} (${i + 1})">${l}</button>`).join('');
  $('cams').querySelectorAll('button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));
  $('layers').innerHTML = LAYERS.map(([k, l]) => `<button data-layer="${k}" class="${S.layers[k] ? 'on' : ''}">${l}</button>`).join('');
  $('layers').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.layers[b.dataset.layer] = !S.layers[b.dataset.layer]; b.classList.toggle('on'); }));

  const idx = await fetchJSON('data/index.json');
  S.index = idx; S.players = idx.players;
  for (const g of idx.games) S.games[g.gameId] = g;
  const counts = {};
  for (const p of idx.plays) {
    const names = [p.pressureBy, ...p.beaten.flatMap((b) => [b.b, b.d]), ...p.credits.map((c) => c.p)].filter(Boolean).map(pname);
    p._search = `${p.desc} ${p.off} ${p.def} ${p.cov} ${names.join(' ')}`.toLowerCase();
    for (const t of p.tags) counts[t] = (counts[t] ?? 0) + 1;
  }
  idx.plays.sort((a, b) => b.score - a.score || a.g - b.g || a.p - b.p);
  $('tags').innerHTML = TAGS.map(([k, l]) => `<button class="chip" data-tag="${k}" title="${(counts[k] ?? 0).toLocaleString('fr-FR')} actions">${l}</button>`).join('');
  $('tags').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.tags.has(b.dataset.tag) ? S.tags.delete(b.dataset.tag) : S.tags.add(b.dataset.tag); b.classList.toggle('on'); renderList(); }));
  const teams = [...new Set(idx.plays.map((p) => p.off))].sort();
  $('team').innerHTML += teams.map((t) => `<option>${t}</option>`).join('');
  $('game').innerHTML += idx.games.filter((g) => idx.plays.some((p) => p.g === g.gameId))
    .map((g) => `<option value="${g.gameId}">Sem. ${g.week} · ${g.visitorTeamAbbr} @ ${g.homeTeamAbbr} (${g.gameDate})</option>`).join('');
  for (const id of ['q', 'team', 'side', 'game']) $(id).addEventListener('input', renderList);
  renderFeatured();
  renderList();
  setLoading(null);

  const m = location.hash.match(/g=(\d+)&p=(\d+)/);
  const def = FEATURED[0];
  const first = (m && idx.plays.find((p) => p.g === +m[1] && p.p === +m[2])) || idx.plays.find((p) => p.g === def.g && p.p === def.p) || idx.plays[0];
  const cm = location.hash.match(/cam=(\w+)/), tm = location.hash.match(/t=([\d.-]+)/), om = location.hash.match(/open=(\w+)/);
  await openPlay(first, { cam: cm ? cm[1] : m ? undefined : 'broadcast', keepHash: true, instant: true });
  if (tm) { S.f = S.play.snap - 1 + parseFloat(tm[1]) * HZ; S.playing = false; syncPlayBtn(); }
  if (cm) setCam(cm[1], false);
  if (om?.[1] === 'leaders') $('leadersBtn').click();
  else if (om?.[1] === 'guide' || (!m && !store.get('pr_seen'))) openGuide();
}

// optional Blender model: drop web/models/player.glb (1 unit = 1 yard, feet at origin, facing +X)
new GLTFLoader().load('models/player.glb', (gltf) => {
  S.playerModel = gltf.scene;
  if (S.meta) { buildActors(S.play, S.meta, S.games[S.meta.g]); actorMap = byId(); }
}, undefined, () => {});

// keep floating panels clear of the toolbar / dock whatever their wrapped height
const placePanels = () => {
  const t = $('tools'); $('player').style.top = `${t.offsetTop + t.offsetHeight + 10}px`;
  $('simBadge').style.bottom = `${$('bottom').offsetHeight + 26}px`;
  $('info').style.maxHeight = `calc(100% - ${$('bottom').offsetHeight + 42}px)`;
};
const ro = new ResizeObserver(placePanels);
for (const el of [document.querySelector('main'), $('tools'), $('bottom')]) ro.observe(el);

// ---------- loop ----------
const clock = new THREE.Clock();
let viewKey = '';
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  // shift the projection centre to the middle of the area not covered by the info panel, toolbar and dock
  const info = $('info'), tools = $('tools'), dock = $('bottom');
  const infoW = info.offsetParent && !info.classList.contains('min') ? info.offsetWidth + 14 : 0;
  const top = tools.offsetTop + tools.offsetHeight, bottom = dock.offsetHeight + 14;
  const ox = Math.round(infoW / 2), oy = Math.round((bottom - top) / 2);
  $('banner').style.right = `${infoW}px`;
  const key = `${w}x${h}:${ox},${oy}`;
  if (key !== viewKey) { viewKey = key; camera.setViewOffset(w, h, ox, oy, w, h); camera.updateProjectionMatrix(); }
}
function loop() {
  const dt = Math.min(0.1, clock.getDelta());
  resize();
  if (S.play) {
    if (S.playing) {
      S.f += dt * HZ * S.speed;
      if (S.f >= S.play.n - 1) { S.f = S.play.n - 1; S.playing = false; syncPlayBtn(); }
    }
    const scrub = $('scrub');
    scrub.value = S.f; scrub.style.setProperty('--fill', `${(S.f / (S.play.n - 1)) * 100}%`);
    const t = (S.f - (S.play.snap - 1)) / HZ, computed = S.f > S.play.nReal - 1;
    $('time').firstElementChild.textContent = `${t > 0 ? '+' : ''}${t.toFixed(1)} s`;
    $('time').lastElementChild.textContent = t < 0 ? 'avant snap' : computed ? 'calculé' : 'après snap';
    $('time').classList.toggle('sim', computed);
    checkBanners(S.f);
    const r = updateScene(clock.elapsedTime);
    updateCamera(dt, r?.pos);
    drawChart();
  }
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
camera.position.set(60, 40, 40); controls.target.set(60, 0, -26);
// debug handle (inspection from the console / automated checks)
window.__pr = { S, camera, controls, get actors() { return actors; }, get tween() { return tween; } };
syncPlayBtn();
loop();
init().catch((e) => { console.error(e); setLoading('Impossible de charger les données.'); });
