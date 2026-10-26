// Dés annoncés (animation côté client) : initiative, relance, tirs.
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8862';
const EE = require('events');
require('./harness.js'); require('../server.js');
setTimeout(async () => {
  const io = global.__io;
  const mk = (id) => { const s = new EE(); s.id = id; s.data = {}; s.handshake = { address: '1.1.1.1' }; s.join = () => {}; s.leave = () => {}; s.broadcast = { emit() {} }; s.log = [];
    s.call = (ev, p) => new Promise((r) => { const hs = s.listeners(ev); if (!hs.length) return r({ error: 'no handler ' + ev }); Promise.resolve(hs[0](p, (res) => r(res))); setTimeout(() => r({ timeout: true }), 3000); });
    s.emit = (ev, ...a) => { s.log.push([ev, a[0]]); return true; }; io.sockets.sockets.set(id, s); io.h(s); return s; };
  const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
  const mj = mk('a'), b = mk('b'), c = mk('c');
  await mj.call('set-username', { name: 'mj', password: 'mj', clientId: 'c1' }); await b.call('set-username', { name: 'bob', clientId: 'c2' }); await c.call('set-username', { name: 'cat', clientId: 'c3' });
  await mj.call('new-map', { cols: 20, rows: 20 });
  // deux bandes d'entrée sur toute la largeur, face à face (comme la carte de test du MJ)
  const top = [], bot = []; for (let x = 0; x < 20; x++) { top.push(`${x},1`); bot.push(`${x},18`); }
  mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'diamond', keys: [...top, ...bot] });
  const FRONT = process.env.FRONT === '1';
  if (FRONT) { // frontière commune : ligne de disques avec un triangle au milieu (carte du MJ)
    const line = []; for (let x = 0; x < 20; x++) if (x !== 10) line.push(`${x},9`);
    mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'disc', keys: line });
    mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'triangle', keys: ['10,9'] });
  }
  await mj.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(mj).zones.map((z) => z.id); console.log('zones', zs.join(','));
  await mj.call('landing-group', { zone: zs[0], group: 'A' }); await mj.call('landing-group', { zone: zs[1], group: 'B' });
  await mj.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await mj.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  await mj.call('fiches-pick', { name: 'bob', army: 'empire', legion: '1' }); await mj.call('fiches-pick', { name: 'cat', army: 'bretonnie', legion: '1' });
  await mj.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[1] });
  await mj.call('landing-freeze', { force: true });
  const zb = L(b).zones.find((z) => z.id === zs[0]).tiles, zc = L(c).zones.find((z) => z.id === zs[1]).tiles;
  for (const l of L(b).lines.filter((l) => l.owner === 'bob')) for (let i = 1; i <= l.qty; i++) await b.call('landing-place', { units: [`bob|${l.uid}#${i}`], tile: zb[0] });
  for (const l of L(c).lines.filter((l) => l.owner === 'cat')) for (let i = 1; i <= l.qty; i++) await c.call('landing-place', { units: [`cat|${l.uid}#${i}`], tile: zc[0] });
  await mj.call('landing-lock', { force: true });
  await mj.call('landing-battle', {});
  let a1 = L(b).b.anim; console.log(JSON.stringify(a1));
  const cl = L(b).b.clusters; console.log('secteurs', JSON.stringify(cl.map((x) => ({ secs: x.secs, active: x.active, roll: x.roll }))));
  if (FRONT) {
    ok(cl.length === 1 && cl[0].roll && cl[0].active === L(b).b.first, 'frontière commune : un seul secteur, le dé d’initiative décide qui place');
    ok(a1.dice.length === 2 && /place en premier\.$/.test(a1.text), 'un seul dé annoncé : ' + a1.text);
    const first = L(b).b.first, S1 = first === 't1' ? b : c, S2 = first === 't1' ? c : b;
    const u1 = L(S1).b.actors[0], u2 = L(S2).b.actors[0];
    ok(u1 && !u2, 'seule l’équipe désignée a la main');
    let r = await S1.call('battle-place', { unit: u1, orient: 0 }); ok(r.success, 'placement 1');
    ok(L(S2).b.actors.length > 0 && L(S1).b.actors.length === 0, 'la main passe à l’autre équipe');
  } else ok(cl.length === 1 && a1.dice[0].v === L(b).b.roll.t1, 'sans frontière : même aire ouverte, un seul secteur aussi');
  const seen = new Set([a1.id]); let changed = false;
  await mj.call('battle-undo', {});
  for (let k = 0; k < 6; k++) { await mj.call('battle-roll', {}); const a = L(c).b.anim; ok(!seen.has(a.id) && a.dice[0].v === L(c).b.roll.t1, `relance ${k + 1} : ${a.dice[0].v}/${a.dice[1].v} → ${a.text}`); if (a.dice[0].v !== a1.dice[0].v || a.dice[1].v !== a1.dice[1].v) changed = true; seen.add(a.id); }
  ok(changed, 'les valeurs changent au fil des relances');
  // dé des déplacements : un nouveau dé, distinct du dé de placement
  for (let pass = 0; pass < 400 && !L(mj).b.allPlaced; pass++) { let prog = false;
    for (const S of [b, c]) for (const u of L(S).b.actors || []) { const r2 = await S.call('battle-place', { unit: u, orient: 0 }); if (r2.success) { prog = true; break; } }
    if (!prog) break; }
  ok(L(mj).b.allPlaced, 'tous placés');
  await mj.call('landing-orders', {});
  const ub = Object.keys(L(b).b.done).find((id) => id.startsWith('bob')), uc = Object.keys(L(c).b.done).find((id) => id.startsWith('cat'));
  let r = await b.call('battle-order', { unit: ub, order: { type: 'depl', tile: zb[0] } }); r = await c.call('battle-order', { unit: uc, order: { type: 'depl', tile: zc[0] } });
  await __ready(b, L); await __ready(c, L);
  const before = L(b).b.anim.id;
  r = await mj.call('landing-move', {}); const am = L(b).b.anim, vm = L(b).m;
  console.log('déplacements', JSON.stringify(am), vm.active);
  ok(r.success && am.id !== before && /Déplacements/.test(am.title) && vm.roll && vm.active === (vm.roll.t1 > vm.roll.t2 ? 't1' : 't2'), 'nouveau dé pour les déplacements, il désigne l’équipe qui commence');
  process.exit(0);
}, 3000);
