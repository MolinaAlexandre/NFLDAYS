// Reconstructs the END of a play that the tracking data does not contain
// (tracking stops 0.5 s after the throw). Everything produced here is COMPUTED:
//  - target receiver: parsed from the play description ("pass deep left to C.Lamb"),
//    fallback = receiver best aligned with the measured ball direction
//  - ball speed: measured on the last tracked frames, ball flies straight to the catch point
//  - catch point: receiver's last measured velocity extrapolated until the ball arrives
//  - final spot: line of scrimmage + official playResult yards (TD -> end zone)
//  - other players: velocity decay, defenders converge on the ball then pursue the carrier
const HZ = 10, DT = 1 / HZ;
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const len = (x, y) => Math.hypot(x, y);
const clampField = (p) => ({ x: Math.max(-2, Math.min(122, p.x)), y: Math.max(0.5, Math.min(52.8, p.y)) });

function matchName(abbr, ents, players) {
  if (!abbr) return null;
  const [ini, ...rest] = abbr.split('.');
  const last = norm(rest.join('.'));
  const cands = ents.filter((e) => {
    const n = players[e.id]?.n; if (!n) return false;
    const [first, ...ln] = n.split(' ');
    return norm(ln.join(' ')) === last && norm(first).startsWith(norm(ini));
  });
  if (cands.length) return cands[0];
  const loose = ents.filter((e) => norm((players[e.id]?.n ?? '').split(' ').slice(1).join(' ')) === last);
  return loose.length === 1 ? loose[0] : null;
}

function solveCatch(p, v, b, speed) {
  let T = len(p.x - b.x, p.y - b.y) / speed;
  for (let i = 0; i < 6; i++) T = len(p.x + v.x * T - b.x, p.y + v.y * T - b.y) / speed;
  T = Math.max(0.1, Math.min(3, T));
  return { T, C: clampField({ x: p.x + v.x * T, y: p.y + v.y * T }) };
}

export function extendPlay(play, meta, players) {
  const out = { ...play, nReal: play.n, sim: null };
  const res = meta.res;
  if (!['C', 'I', 'IN', 'R'].includes(res) || play.los == null || play.n < 3) return out;
  const L = play.n - 1, E = play.end - 1, sign = play.dir === 'right' ? 1 : -1;
  const at = (e, i) => ({ x: e.d[i * 4], y: e.d[i * 4 + 1], o: e.d[i * 4 + 2] });
  const velOf = (e) => { const a = at(e, L - 1), b = at(e, L); return { x: (b.x - a.x) * HZ, y: (b.y - a.y) * HZ }; };
  const ball = play.ents.find((e) => e.id === -1);
  const qb = play.ents.find((e) => e.r === 'Pass');
  if (!ball || !qb) return out;
  const offense = play.ents.filter((e) => e.t === meta.off);
  const defense = play.ents.filter((e) => e.t !== meta.off && e.id !== -1);
  const desc = meta.desc ?? '';

  const b0 = at(ball, L), vb = velOf(ball);
  const measuredSpeed = len(vb.x, vb.y);
  const ballSpeed = Math.max(12, Math.min(25, measuredSpeed || 18));

  let carrier = null, method = '', abbr = null, T = 0, C = null;
  if (res === 'R') {
    carrier = qb; method = 'QB (scramble)'; C = at(qb, L);
  } else {
    const intM = desc.match(/INTERCEPTED by ([A-Z][\w'-]*\.\s?[A-Z][\w'.-]*(?: [A-Z][\w'-]+)?)/);
    const toM = desc.match(/pass(?: incomplete)?(?: (?:short|deep))?(?: (?:left|middle|right))? to ([A-Z][\w'-]*\.\s?[A-Z][\w'.-]*(?: [A-Z][\w'-]+)?)/);
    if (res === 'IN' && intM) { abbr = intM[1]; carrier = matchName(abbr, defense, players); }
    else if (toM) { abbr = toM[1]; carrier = matchName(abbr, offense.filter((e) => e !== qb), players); }
    if (carrier) method = `description « ${abbr} »`;
    if (!carrier && measuredSpeed > 3) {
      // fallback: receiver whose catch point is best aligned with the measured ball direction
      const pool = res === 'IN' ? defense : offense.filter((e) => e !== qb);
      let best = Infinity;
      for (const e of pool) {
        const s = solveCatch(at(e, L), velOf(e), b0, ballSpeed);
        const dx = s.C.x - b0.x, dy = s.C.y - b0.y, ang = Math.acos(Math.max(-1, Math.min(1, (dx * vb.x + dy * vb.y) / (len(dx, dy) * measuredSpeed + 1e-6))));
        const score = ang * 10 + len(dx, dy) * 0.05;
        if (score < best) { best = score; carrier = e; }
      }
      if (carrier) method = 'direction du ballon (pas de nom dans la description)';
    }
    if (!carrier) {
      if (res !== 'I') return out;
      T = 0.8; C = clampField({ x: b0.x + (vb.x / (measuredSpeed || 1)) * ballSpeed * T, y: b0.y + (vb.y / (measuredSpeed || 1)) * ballSpeed * T });
      method = 'balle prolongée (aucune cible identifiable)';
    } else {
      ({ T, C } = solveCatch(at(carrier, L), velOf(carrier), b0, ballSpeed));
    }
  }

  // final spot from official yardage
  const td = /TOUCHDOWN/i.test(desc) && res !== 'I';
  const yds = meta.yds ?? 0;
  let F = null, D = 0;
  const caught = res === 'C' || res === 'IN' || res === 'R';
  if (caught && carrier) {
    const vc = velOf(carrier);
    if (res === 'IN') {
      const fwd = -sign; // interceptor runs the other way
      F = clampField({ x: C.x + fwd * 6, y: C.y + vc.y * 0.4 });
    } else {
      const fx = td ? (sign > 0 ? 111 : 9) : play.los + sign * yds;
      if ((fx - C.x) * sign < 0) C = { x: fx, y: C.y }; // catch depth cannot exceed the total gain
      F = clampField({ x: fx, y: C.y + vc.y * 0.5 });
    }
    D = Math.max(0.6, len(F.x - C.x, F.y - C.y) / 6.5);
  }
  const hold = 1.0;
  const total = T + D + hold;
  const K = Math.min(80, Math.round(total * HZ));
  const catchF = L + T * HZ, tackleF = L + (T + D) * HZ;

  // carrier path (Hermite curve from catch to final spot, initial tangent = receiver velocity)
  const vc0 = carrier ? velOf(carrier) : { x: 0, y: 0 };
  const carrierAt = (t) => {
    const p0 = carrier ? at(carrier, L) : b0;
    if (t <= T) return { x: p0.x + vc0.x * t, y: p0.y + vc0.y * t };
    if (!F) return null;
    const u = Math.min(1, (t - T) / D), m0 = { x: vc0.x * D * 0.5, y: vc0.y * D * 0.5 }, m1 = { x: (F.x - C.x) * 0.3, y: (F.y - C.y) * 0.3 };
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return { x: h00 * C.x + h10 * m0.x + h01 * F.x + h11 * m1.x, y: h00 * C.y + h10 * m0.y + h01 * F.y + h11 * m1.y };
  };

  const ext = new Map(play.ents.map((e) => [e.id, []]));
  const state = new Map(play.ents.filter((e) => e.id !== -1 && e !== carrier).map((e) => { const p = at(e, L); return [e.id, { ...p, v: velOf(e) }]; }));
  const pursuers = res === 'IN' ? offense.filter((e) => e !== qb) : defense;
  const pursuerIds = new Set(pursuers.map((e) => e.id));
  let carrierPrev = carrier ? at(carrier, L) : null;

  for (let k = 1; k <= K; k++) {
    const t = k * DT;
    const cp = carrier ? (carrierAt(t) ?? carrierAt(T)) : null;
    // carrier
    if (carrier) {
      const vx = (cp.x - carrierPrev.x) * HZ, vy = (cp.y - carrierPrev.y) * HZ, sp = len(vx, vy);
      const o = sp > 0.5 ? (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360 : ext.get(carrier.id).at(-2) ?? at(carrier, L).o;
      ext.get(carrier.id).push(cp.x, cp.y, o, sp);
      carrierPrev = cp;
    }
    // ball
    let bp;
    if (t <= T) { const u = t / T; bp = { x: b0.x + (C.x - b0.x) * u, y: b0.y + (C.y - b0.y) * u }; }
    else if (caught && carrier) bp = cp;
    else { const dx = C.x - b0.x, dy = C.y - b0.y, dl = len(dx, dy) || 1, r = Math.min(t - T, 0.4) * 6; bp = { x: C.x + dx / dl * r, y: C.y + dy / dl * r }; }
    ext.get(-1).push(bp.x, bp.y, 0, t <= T ? ballSpeed : 0);
    // everyone else
    for (const [id, s] of state) {
      let target = null, maxSp = 0;
      if (t <= T && caught) { if (pursuerIds.has(id) && len(s.x - C.x, s.y - C.y) < 15) { target = C; maxSp = 6; } }
      else if (t > T && caught && pursuerIds.has(id) && cp) { target = cp; maxSp = 7; }
      if (target) {
        const dx = target.x - s.x, dy = target.y - s.y, d = len(dx, dy) || 1;
        const want = d < 1.2 ? { x: 0, y: 0 } : { x: dx / d * maxSp, y: dy / d * maxSp };
        const k2 = Math.min(1, DT * 2.5);
        s.v = { x: s.v.x + (want.x - s.v.x) * k2, y: s.v.y + (want.y - s.v.y) * k2 };
      } else {
        const decay = Math.exp(-DT / (t > T + D ? 0.4 : 0.9));
        s.v = { x: s.v.x * decay, y: s.v.y * decay };
      }
      s.x += s.v.x * DT; s.y += s.v.y * DT;
      const sp = len(s.v.x, s.v.y);
      if (sp > 0.6) s.o = (Math.atan2(s.v.x, s.v.y) * 180 / Math.PI + 360) % 360;
      ext.get(id).push(+s.x.toFixed(2), +s.y.toFixed(2), s.o, sp);
    }
  }

  out.ents = play.ents.map((e) => ({ ...e, d: e.d.concat(ext.get(e.id)) }));
  out.n = play.n + K;
  out.md = play.md.concat(new Array(K).fill(null));
  out.area = play.area.concat(new Array(K).fill(null));
  const airYds = res === 'R' ? null : (C.x - play.los) * sign;
  out.sim = {
    kind: res, carrier: carrier?.id ?? null, method, abbr, E, L, catchF, tackleF, T, D, td,
    flightTotal: (L - E) / HZ + T, ballSpeed, measuredSpeed, C, F,
    airYds, yac: caught && res === 'C' ? (td ? (sign > 0 ? 110 : 10) - C.x : F.x - C.x) * sign : null,
  };
  return out;
}

// ball height (no z in the data -> parabola computed from the flight time)
export function ballHeight(play, f) {
  const snap = play.snap - 1, end = play.end - 1, s = play.sim;
  if (f < snap) return 0.2;
  if (f <= end) return 1.25;
  if (!s) return 1.25 + (f - end) * 0.6;
  if (s.kind === 'R') return 1.2;
  if (f <= s.catchF) {
    const u = (f - end) / Math.max(1, s.catchF - end), apex = Math.min(12, 1.34 * s.flightTotal ** 2);
    return 1.9 * (1 - u) + 1.4 * u + 4 * apex * u * (1 - u);
  }
  if (s.kind === 'I' || !s.carrier) return Math.max(0.15, 1.4 - (f - s.catchF) * 0.3);
  return 1.1;
}
