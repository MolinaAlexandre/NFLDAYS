// 2021 uniforms, simplified to flat colours (no logos / numbers on the model).
// h: helmet shell, m: facemask, s: helmet centre stripe (= h when none),
// j: colour jersey, t: sleeve/collar/pants trim, p: [pants home, pants away], k: socks,
// a: away jersey (default white), w: team wears white at home (colour jersey on the road).
const K = {
  ARI: { h: '#FFFFFF', m: '#000000', s: '#FFFFFF', j: '#97233F', t: '#000000', p: ['#FFFFFF', '#FFFFFF'], k: '#97233F' },
  ATL: { h: '#101820', m: '#101820', s: '#A71930', j: '#101820', t: '#A71930', p: ['#FFFFFF', '#101820'], k: '#A71930' },
  BAL: { h: '#101820', m: '#101820', s: '#101820', j: '#241773', t: '#9E7C0C', p: ['#FFFFFF', '#FFFFFF'], k: '#241773' },
  BUF: { h: '#FFFFFF', m: '#00338D', s: '#C60C30', j: '#00338D', t: '#C60C30', p: ['#FFFFFF', '#00338D'], k: '#00338D' },
  CAR: { h: '#A5ACAF', m: '#101820', s: '#0085CA', j: '#101820', t: '#0085CA', p: ['#A5ACAF', '#A5ACAF'], k: '#0085CA' },
  CHI: { h: '#0B162A', m: '#0B162A', s: '#C83803', j: '#0B162A', t: '#C83803', p: ['#FFFFFF', '#FFFFFF'], k: '#0B162A' },
  CIN: { h: '#FB4F14', m: '#101820', s: '#101820', j: '#101820', t: '#FB4F14', p: ['#FFFFFF', '#FFFFFF'], k: '#101820' },
  CLE: { h: '#FF3C00', m: '#311D00', s: '#311D00', j: '#311D00', t: '#FF3C00', p: ['#FFFFFF', '#311D00'], k: '#FF3C00' },
  DAL: { h: '#869397', m: '#041E42', s: '#041E42', j: '#041E42', t: '#869397', p: ['#869397', '#869397'], k: '#041E42', w: true },
  DEN: { h: '#002244', m: '#002244', s: '#FB4F14', j: '#FB4F14', t: '#002244', p: ['#FFFFFF', '#FFFFFF'], k: '#FB4F14' },
  DET: { h: '#B0B7BC', m: '#0076B6', s: '#B0B7BC', j: '#0076B6', t: '#B0B7BC', p: ['#B0B7BC', '#B0B7BC'], k: '#0076B6' },
  GB:  { h: '#FFB612', m: '#203731', s: '#203731', j: '#203731', t: '#FFB612', p: ['#FFB612', '#FFB612'], k: '#203731' },
  HOU: { h: '#03202F', m: '#03202F', s: '#A71930', j: '#03202F', t: '#A71930', p: ['#FFFFFF', '#FFFFFF'], k: '#03202F' },
  IND: { h: '#FFFFFF', m: '#002C5F', s: '#002C5F', j: '#002C5F', t: '#FFFFFF', p: ['#FFFFFF', '#FFFFFF'], k: '#002C5F' },
  JAX: { h: '#101820', m: '#101820', s: '#006778', j: '#006778', t: '#D7A22A', p: ['#FFFFFF', '#FFFFFF'], k: '#006778' },
  KC:  { h: '#E31837', m: '#FFFFFF', s: '#FFFFFF', j: '#E31837', t: '#FFB81C', p: ['#FFFFFF', '#E31837'], k: '#E31837' },
  LA:  { h: '#003594', m: '#003594', s: '#FFD100', j: '#003594', t: '#FFD100', p: ['#FFFFFF', '#003594'], k: '#003594', a: '#E9E3D3' },
  LAC: { h: '#0080C6', m: '#FFC20E', s: '#FFC20E', j: '#0080C6', t: '#FFC20E', p: ['#FFFFFF', '#FFFFFF'], k: '#002A5E' },
  LV:  { h: '#A5ACAF', m: '#101820', s: '#101820', j: '#101820', t: '#A5ACAF', p: ['#A5ACAF', '#A5ACAF'], k: '#101820' },
  MIA: { h: '#FFFFFF', m: '#005778', s: '#008E97', j: '#008E97', t: '#FC4C02', p: ['#FFFFFF', '#FFFFFF'], k: '#008E97' },
  MIN: { h: '#4F2683', m: '#4F2683', s: '#FFC62F', j: '#4F2683', t: '#FFC62F', p: ['#FFFFFF', '#FFFFFF'], k: '#4F2683' },
  NE:  { h: '#B0B7BC', m: '#002244', s: '#B0B7BC', j: '#002244', t: '#C60C30', p: ['#002244', '#FFFFFF'], k: '#002244' },
  NO:  { h: '#D3BC8D', m: '#101820', s: '#101820', j: '#101820', t: '#D3BC8D', p: ['#D3BC8D', '#D3BC8D'], k: '#101820' },
  NYG: { h: '#0B2265', m: '#A5ACAF', s: '#0B2265', j: '#0B2265', t: '#A71930', p: ['#A5ACAF', '#A5ACAF'], k: '#0B2265' },
  NYJ: { h: '#125740', m: '#FFFFFF', s: '#125740', j: '#125740', t: '#FFFFFF', p: ['#FFFFFF', '#FFFFFF'], k: '#125740' },
  PHI: { h: '#004C54', m: '#101820', s: '#A5ACAF', j: '#004C54', t: '#A5ACAF', p: ['#FFFFFF', '#004C54'], k: '#004C54' },
  PIT: { h: '#101820', m: '#101820', s: '#FFB612', j: '#101820', t: '#FFB612', p: ['#FFB612', '#FFB612'], k: '#101820' },
  SEA: { h: '#002244', m: '#002244', s: '#69BE28', j: '#002244', t: '#69BE28', p: ['#002244', '#FFFFFF'], k: '#002244' },
  SF:  { h: '#B3995D', m: '#AA0000', s: '#AA0000', j: '#AA0000', t: '#FFFFFF', p: ['#B3995D', '#B3995D'], k: '#AA0000' },
  TB:  { h: '#34302B', m: '#101820', s: '#34302B', j: '#D50A0A', t: '#34302B', p: ['#34302B', '#34302B'], k: '#D50A0A' },
  TEN: { h: '#0C2340', m: '#0C2340', s: '#4B92DB', j: '#0C2340', t: '#4B92DB', p: ['#FFFFFF', '#FFFFFF'], k: '#0C2340' },
  WAS: { h: '#5A1414', m: '#FFB612', s: '#5A1414', j: '#5A1414', t: '#FFB612', p: ['#FFB612', '#5A1414'], k: '#5A1414' },
};
const FALLBACK = { h: '#888888', m: '#444444', s: '#888888', j: '#888888', t: '#444444', p: ['#cccccc', '#cccccc'], k: '#444444' };

// colour jersey for the home side (or the road side for teams that wear white at home)
export function kitFor(team, home) {
  const k = K[team] ?? FALLBACK;
  const colour = home !== !!k.w;
  const jersey = colour ? k.j : (k.a ?? '#F2F2F2');
  return {
    jersey, trim: colour ? k.t : k.j, pants: k.p[home ? 0 : 1], socks: k.k,
    helmet: k.h, facemask: k.m, stripe: k.s,
    num: light(jersey) ? (colour ? k.t : k.j) : '#FFFFFF',
  };
}

const light = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
};

// glb material name -> kit slot
export const KIT_SLOTS = [['jersey', 'jersey'], ['team', 'jersey'], ['helmet', 'helmet'], ['facemask', 'facemask'],
  ['stripe', 'stripe'], ['trim', 'trim'], ['pants', 'pants'], ['socks', 'socks']];
