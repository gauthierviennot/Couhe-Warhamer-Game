// Phase de tir : artillerie puis tirs à tour de rôle, dés, pertes, annulation, correction, jets de fuite, tour suivant, retour d'étape.
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8862'; process.env.GAME_TEST = '1';
const EE = require('events');
require('./harness.js'); require('../server.js');
setTimeout(async () => {
  const io = global.__io;
  const mk = (id) => { const s = new EE(); s.id = id; s.data = {}; s.handshake = { address: '1.1.1.1' }; s.join = () => {}; s.leave = () => {}; s.broadcast = { emit() {} }; s.log = [];
    s.call = (ev, p) => new Promise((r) => { const hs = s.listeners(ev); if (!hs.length) return r({ error: 'no handler ' + ev }); Promise.resolve(hs[0](p, (res) => r(res))); setTimeout(() => r({ timeout: true }), 3000); });
    s.emit = (ev, ...a) => { s.log.push([ev, a[0]]); return true; }; io.sockets.sockets.set(id, s); io.h(s); return s; };
  let nok = 0, nko = 0;
  const ok = (c, m) => { c ? nok++ : nko++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
  const mj = mk('a'), b = mk('b'), c = mk('c');
  await mj.call('set-username', { name: 'mj', password: 'mj', clientId: 'c1' }); await b.call('set-username', { name: 'bob', clientId: 'c2' }); await c.call('set-username', { name: 'cat', clientId: 'c3' });
  await mj.call('new-map', { cols: 20, rows: 20 });
  mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'diamond', keys: ['1,5', '2,5', '3,5', '4,5', '5,5', '6,5', '7,5', '8,5', '9,5', '10,5', '11,5', '12,5', '3,15', '4,15', '10,15', '11,15'] });
  await mj.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(mj).zones.map((z) => z.id);
  for (const z of zs) await mj.call('landing-group', { zone: z, group: 'A' }); await mj.call('landing-group', { zone: zs[zs.length - 1], group: 'B' });
  await mj.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await mj.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  await mj.call('fiches-pick', { name: 'bob', army: 'empire', legion: '1' }); await mj.call('fiches-pick', { name: 'cat', army: 'bretonnie', legion: '1' });
  await mj.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[zs.length - 1] });
  await mj.call('landing-freeze', { force: true });
  const zb = L(b).zones.find((z) => z.id === zs[0]).tiles, zc = L(c).zones.find((z) => z.id === zs[zs.length - 1]).tiles;
  const lb = L(b).lines.filter((l) => l.owner === 'bob'), lc = L(c).lines.filter((l) => l.owner === 'cat');
  const ub = [], uc = []; lb.forEach((l) => { for (let i = 1; i <= l.qty; i++) ub.push(`bob|${l.uid}#${i}`); }); lc.forEach((l) => { for (let i = 1; i <= l.qty; i++) uc.push(`cat|${l.uid}#${i}`); });
  for (const u of ub) await b.call('landing-place', { units: [u], tile: zb[0] });
  for (const u of uc) await c.call('landing-place', { units: [u], tile: zc[0] });
  const idOf = (lines, owner, re) => { const l = lines.find((x) => re.test(x.name)); return l ? `${owner}|${l.uid}#1` : null; };
  const G = idOf(lb, 'bob', /^inf lourde/), C1 = idOf(lb, 'bob', /^inf legere/), O = `bob|${lb.find((x) => /^inf legere/.test(x.name)).uid}#2`, T = idOf(lc, 'cat', /^inf lourde/);
  let r = await b.call('landing-general', { unit: G }); ok(r.success, 'général affecté ' + (r.message || ''));
  r = await b.call('landing-chevron', { unit: G }); ok(r.success, 'chevron possible sur l’unité du général ' + (r.message || ''));
  r = await b.call('landing-chevron', { unit: C1 }); ok(r.success, 'chevron sur une unité proche ' + (r.message || ''));
  await mj.call('landing-lock', { force: true });
  await mj.call('landing-battle', {});
  const spot = { [G]: ['5,8', 1], [C1]: ['4,9', 1], [O]: ['6,9', 1], [T]: ['4,15', 4] };
  for (let pass = 0; pass < 600; pass++) {
    if (L(mj).b.allPlaced) break; let prog = false;
    for (const U of [...ub, ...uc]) { if (L(mj).b.done[U]) continue; const S = U.startsWith('bob') ? b : c; const sp = spot[U];
      const rr = await S.call('battle-place', { unit: U, tile: sp ? sp[0] : undefined, orient: sp ? sp[1] : 0 }); if (rr.success) prog = true; }
    if (!prog) break;
  }
  ok(L(mj).b.allPlaced && L(mj).chev.bob === C1, 'chevron conservé en bataille (positions de bataille)');
  await mj.call('landing-orders', {});
  r = await b.call('battle-gorder', { order: 'mvt' }); ok(r.success && L(b).b.gorders.bob === 'mvt', 'mvt +3 sur l’unité au chevron');
  const reach = async (u) => (await b.call('battle-reach', { unit: u, type: 'depl' })).tiles.length;
  const rc = await reach(C1), ro = await reach(O);
  console.log('portée chevron', rc, 'autre', ro);
  ok(rc > ro, 'seule l’unité désignée a +3 (portées ' + rc + ' / ' + ro + ')');
  r = await b.call('battle-gorder', { order: 'mvt', unit: O }); ok(r.success && L(b).chev.bob === O, 'le général change d’unité désignée');
  ok((await reach(O)) > (await reach(C1)), 'le bonus suit la nouvelle unité');
  r = await b.call('battle-gorder', { order: 'charge', unit: G }); ok(r.success && L(b).chev.bob === G, 'le général peut se désigner lui-même ' + (r.message || ''));
  r = await b.call('battle-gorder', { order: 'charge', unit: C1 });
  // T est à 6 hex de C1 : charge possible seulement avec +2
  const hd = (a, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A = cube(a), B = cube(b2); return Math.max(...A.map((v, i) => Math.abs(v - B[i]))); };
  console.log('distance C1→T', hd('4,9', '4,15'), 'O→T', hd('6,9', '4,15'));
  r = await b.call('battle-order', { unit: C1, order: { type: 'charge', target: T } }); ok(r.success, 'charge +2 : l’unité désignée charge à ' + hd('4,9', '4,15') + ' hex ' + (r.message || ''));
  r = await b.call('battle-order', { unit: O, order: { type: 'charge', target: T } });
  { const S0 = global.__srv, U0 = (id) => S0.allBattleUnits().find((x) => x.id === id); const can5 = S0.chargeInRange(U0(O), L(mj).b.pos[T] || L(mj).placed[T], 5); ok(r.success === can5, 'une autre unité n’a pas le +2 : charge à 5 tuiles par le chemin, ' + (r.success ? 'possible' : r.message)); }
  r = await b.call('battle-gorder', { order: 'att' }); ok(r.success && L(b).b.gorders.bob === 'att', 'att −1 pour toutes les unités à 6 hex');
  // mvt +3 aussi en marche forcée
  r = await b.call('battle-gorder', { order: 'mvt', unit: C1 });
  const reachM = async (u) => (await b.call('battle-reach', { unit: u, type: 'marche' })).tiles.length;
  const mc = await reachM(C1), mo = await reachM(O);
  ok(mc > mo, 'mvt +3 s’ajoute aussi à la marche forcée (portées ' + mc + ' / ' + mo + ')');
  const S = global.__srv, U = (id) => S.allBattleUnits().find((x) => x.id === id);
  await b.call('battle-order', { unit: C1, order: { type: 'marche' } });
  const dep = U(C1).line.dep; ok(S.moveRange(U(C1)) === dep * 2 + 3, 'marche forcée + mvt : dep × 2 + 3 = ' + S.moveRange(U(C1)));
  // général détruit : plus de pouvoirs
  S.state.landing.b.dead = { ...(S.state.landing.b.dead || {}), [G]: true };
  ok(S.genPower('bob') === null, 'unité du général détruite : plus aucun pouvoir');
  ok(S.moveRange(U(C1)) === dep * 2, 'le bonus mvt disparaît');
  r = await b.call('battle-gorder', { order: 'att' }); ok(!r.success, 'nouvel ordre du général refusé : ' + r.message);
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 3000);
