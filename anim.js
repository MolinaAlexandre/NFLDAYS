import * as THREE from 'three';

// Procedural animation of the articulated player.glb
// (player > hips > torso > upperarm_* > forearm_*, hips > thigh_* > shin_*).
// Every joint swings around its local z axis: +z moves a limb forward (the model faces +x).
const JOINTS = ['hips', 'torso', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R'];
const STRIDE = 2.2; // yards per full run cycle (two steps)
const TAU = Math.PI * 2;

// [thigh, shin, torso, upper arm, forearm] when standing still
const STANCE = {
  pre: {
    'Pass Block': [0.9, -1.3, -0.9, 0.9, 0.3], 'Pass Rush': [1.0, -1.4, -1.0, 1.1, 0.3],
    'Pass Route': [0.45, -0.7, -0.45, 0.4, 0.5], Coverage: [0.35, -0.6, -0.3, 0.3, 0.6], Pass: [0.3, -0.5, -0.25, 0.5, 1.0],
  },
  post: { 'Pass Block': [0.6, -0.9, -0.35, 1.1, 0.5], 'Pass Rush': [0.6, -0.9, -0.6, 1.2, 0.4] },
};
const ATHLETIC = [0.35, -0.55, -0.25, 0.25, 0.7];
const HOLD = [0.45, 1.6]; // both hands on the ball at the chest

// QB throwing motion, t in seconds relative to the release: [t, upper_R, fore_R, upper_L, torso yaw]
const THROW = [[-0.5, 0.45, 1.6, 0.45, 0], [-0.25, -2.3, -1.1, 1.3, -0.6], [0, -3.9, -0.2, 0.6, 0.3], [0.2, -5.3, 0.3, 0.2, 0.4]];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function makeRig(obj, ent) {
  const r = {};
  for (const n of JOINTS) { r[n] = obj.getObjectByName(n); if (!r[n]) return null; }
  r.hipY = r.hips.position.y;
  r.thighV = r.shin_L.position.clone();                  // hip -> knee
  r.shinV = new THREE.Vector3(0, -(r.hipY + r.thighV.y), 0); // knee -> ground
  // right glove centre, in forearm_R space (where the ball sits while the QB holds it)
  obj.updateWorldMatrix(true, true);
  r.hand = new THREE.Vector3(0.15, -0.28, 0);
  r.forearm_R.traverse((m) => {
    if (!m.isMesh || m.material.name !== 'gloves') return;
    m.geometry.computeBoundingBox();
    r.hand = r.forearm_R.worldToLocal(m.localToWorld(m.geometry.boundingBox.getCenter(new THREE.Vector3())));
  });
  // signed distance travelled (backpedalling runs the cycle backwards) -> deterministic phase when scrubbing
  const d = ent.d, n = d.length / 4;
  r.cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = d[i * 4] - d[i * 4 - 4], dy = d[i * 4 + 1] - d[i * 4 - 3], o = d[i * 4 + 2] * Math.PI / 180;
    const back = dx * Math.sin(o) + dy * Math.cos(o) < -0.02;
    r.cum[i] = r.cum[i - 1] + Math.hypot(dx, dy) * (back ? -1 : 1);
  }
  return r;
}

function throwPose(t) {
  if (t <= THROW[0][0]) return THROW[0];
  for (let i = 1; i < THROW.length; i++) {
    if (t <= THROW[i][0]) {
      const a = THROW[i - 1], b = THROW[i], u = (t - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => lerp(v, b[k], u));
    }
  }
  return null;
}

// ctx: { pre: before the snap, holding: QB carries the ball, throwT: s since release (QB on a pass) }
export function animate(r, ent, f, p, ctx) {
  const i = clamp(Math.floor(f), 0, r.cum.length - 1), j = Math.min(r.cum.length - 1, i + 1);
  const ph = lerp(r.cum[i], r.cum[j], clamp(f - i, 0, 1)) / STRIDE * TAU;
  const amp = clamp(((p.s ?? 0) - 0.6) / 5, 0, 1);
  const st = (ctx.pre ? STANCE.pre : STANCE.post)[ent.r] ?? ATHLETIC;
  const sn = Math.sin(ph), cs = Math.cos(ph);

  const thL = lerp(st[0] + 0.12, 0.15 + 0.75 * sn, amp), thR = lerp(st[0] - 0.12, 0.15 - 0.75 * sn, amp);
  const shL = lerp(st[1], -(0.3 + Math.max(0, cs)), amp), shR = lerp(st[1], -(0.3 + Math.max(0, -cs)), amp);
  let torso = lerp(st[2], -0.3, amp), yaw = 0;
  let uaL = lerp(st[3], 0.1 - 0.7 * sn, amp), uaR = lerp(st[3], 0.1 + 0.7 * sn, amp);
  let faL = lerp(st[4], 1.2, amp), faR = faL;
  if (ctx.holding) { uaL = uaR = HOLD[0]; faL = faR = HOLD[1]; torso = Math.max(torso, -0.3); }

  if (ctx.throwT != null && ctx.throwT > -0.5 && ctx.throwT < 0.6) {
    const k = throwPose(ctx.throwT);
    if (k) { [, uaR, faR, uaL, yaw] = k; faL = 0.4; }
    else { // follow-through, then ease back into the generic pose (-5.3 rad == 0.98 rad)
      const w = clamp((ctx.throwT - 0.2) / 0.4, 0, 1), e = THROW[THROW.length - 1];
      uaR = lerp(e[1] + TAU, uaR, w); faR = lerp(e[2], faR, w); uaL = lerp(e[3], uaL, w); yaw = lerp(e[4], 0, w);
    }
  }

  r.thigh_L.rotation.z = thL; r.thigh_R.rotation.z = thR;
  r.shin_L.rotation.z = shL; r.shin_R.rotation.z = shR;
  r.torso.rotation.set(0, yaw, torso);
  r.upperarm_L.rotation.z = uaL; r.upperarm_R.rotation.z = uaR;
  r.forearm_L.rotation.z = faL; r.forearm_R.rotation.z = faR;
  // keep the lowest foot on the ground
  const footY = (a, b) => r.thighV.x * Math.sin(a) + r.thighV.y * Math.cos(a) + r.shinV.y * Math.cos(a + b);
  r.hips.position.y = -Math.min(footY(thL, shL), footY(thR, shR));
}

// first-person right hand + ball for the QB camera (child of the camera, -z = forward)
export function makeViewModel(ballGeo) {
  const g = new THREE.Group();
  const mat = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const skin = mat('#7a5238', 0.7), glove = mat('#151515'), sleeve = mat('#ffffff'), leather = mat('#7a3e12', 0.5);
  const lace = mat('#f2f2f2');
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.058, 0.42, 12), skin);
  fore.position.set(0.09, -0.1, 0.2); fore.rotation.set(-1.15, 0, 0.38);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.07, 0.16, 12), sleeve);
  cuff.position.set(0.17, -0.19, 0.4); cuff.rotation.copy(fore.rotation);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), glove);
  hand.scale.set(1.05, 0.85, 1.25);
  const ball = new THREE.Mesh(ballGeo, leather);
  ball.scale.set(0.95, 0.55, 0.55); ball.position.set(-0.05, 0.055, -0.07); ball.rotation.set(0, 0.55, 0.45);
  const laces = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.012), lace);
  laces.position.set(0, 0.09, 0); ball.add(laces);
  g.add(fore, cuff, hand, ball);
  g.scale.setScalar(0.5);
  g.position.set(0.07, -0.15, -0.42); // right of centre but clear of the info panel
  const rest = g.position.clone(), cocked = new THREE.Vector3(0.12, -0.03, -0.36);
  return {
    group: g,
    setKit(kit) { glove.color.set('#151515'); sleeve.color.set(kit.jersey); },
    // t: seconds relative to the release (null when the play has no pass)
    update(t, speed, time) {
      const u = t == null ? 0 : clamp((t + 0.35) / 0.35, 0, 1), e = u * u * (3 - 2 * u);
      g.position.lerpVectors(rest, cocked, e);
      g.position.y += Math.sin(time * 9) * 0.006 * clamp(speed / 4, 0, 1);
      g.rotation.set(e * 0.5, 0, e * -0.3);
    },
  };
}
