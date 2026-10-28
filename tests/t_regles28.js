// Corrections du 28/10 : ordre des charges (mutuelles d'abord à distance égale), choix d'arrêt en charge mutuelle, trajet par l'entrée du pont, tuiles interdites, artillerie (tuile au choix).
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8873'; process.env.GAME_TEST = '1';
const EE = require('events');
require('./harness.js'); require('../server.js');
setTimeout(async () => {
  const io = global.__io, S = global.__srv;
  const mk = (id) => { const s = new EE(); s.id = id; s.data = {}; s.handshake = { address: '1.1.1.1' }; s.join = () => {}; s.leave = () => {}; s.broadcast = { emit() {} }; s.log = [];
    s.call = (ev, p) => new Promise((r) => { const hs = s.listeners(ev); if (!hs.length) return r({ error: 'no handler ' + ev }); Promise.resolve(hs[0](p, (res) => r(res))); setTimeout(() => r({ timeout: true }), 3000); });
    s.emit = (ev, ...a) => { s.log.push([ev, a[0]]); return true; }; io.sockets.sockets.set(id, s); io.h(s); return s; };
  let nok = 0, nko = 0;
  const ok = (c, m) => { c ? nok++ : nko++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); };
  const mj = mk('a'), b = mk('b'), c = mk('c');
  await mj.call('set-username', { name: 'mj', password: 'mj', clientId: 'c1' }); await b.call('set-username', { name: 'bob', clientId: 'c2' }); await c.call('set-username', { name: 'cat', clientId: 'c3' });
  await mj.call('new-map', { cols: 22, rows: 20 });
  const top = [], bot = []; for (let x = 0; x < 22; x++) { top.push(`${x},1`); bot.push(`${x},18`); }
  const edit = (d) => mj.listeners('edit-tiles')[0](d);
  edit({ action: 'mark', mark: 'diamond', keys: [...top, ...bot] });
  await mj.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(mj).zones.map((z) => z.id);
  await mj.call('landing-group', { zone: zs[0], group: 'A' }); await mj.call('landing-group', { zone: zs[1], group: 'B' });
  await mj.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await mj.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  await mj.call('fiches-pick', { name: 'bob', army: 'elfes_sylvains', legion: '1' }); await mj.call('fiches-pick', { name: 'cat', army: 'saurus', legion: '1' });
  await mj.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[1] });
  await mj.call('landing-freeze', { force: true });
  const lb = L(b).lines.filter((l) => l.owner === 'bob'), lc = L(c).lines.filter((l) => l.owner === 'cat');
  console.log('bob', lb.map((l) => `${l.name}×${l.qty}`).join(' | ')); console.log('cat', lc.map((l) => `${l.name}×${l.qty}`).join(' | '));
  const pickN = (lines, owner, re, n) => { const out = []; for (const l of lines.filter((x) => re.test(x.name))) for (let i = 1; i <= l.qty && out.length < n; i++) out.push(`${owner}|${l.uid}#${i}`); return out; };
  const [E1, E2, E3] = pickN(lb, 'bob', /^inf/, 3), [Z1, Z2, Z3] = pickN(lc, 'cat', /^inf/, 3);
  const E = E1, EA = E2, Z = Z1, ZA = Z2;
  ok(E1 && E2 && E3 && Z1 && Z2 && Z3, 'unités de test trouvées');
  const spot = { [E1]: '4,6', [E2]: '9,6', [E3]: '14,6', [Z1]: '4,13', [Z2]: '9,13', [Z3]: '14,13' };
  const allB = lb.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `bob|${l.uid}#${i + 1}`)), allC = lc.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `cat|${l.uid}#${i + 1}`));
  for (const u of allB) await b.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u].split(',')[0]},1` : '20,1' });
  for (const u of allC) await c.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u].split(',')[0]},18` : '20,18' });
  await mj.call('landing-lock', { force: true });
  await mj.call('landing-battle', {});
  for (let pass = 0; pass < 800 && !L(mj).b.allPlaced; pass++) {
    let prog = false;
    for (const So of [b, c]) for (const u of L(So).b.actors || []) { const r = await So.call('battle-place', { unit: u, tile: spot[u], orient: So === b ? 1 : 4 }); if (r.success) { prog = true; break; } }
    if (!prog) break;
  }
  const P = (id) => L(mj).b.pos[id] || L(mj).placed[id];
  ok(P(E1) === '4,6' && P(Z1) === '4,13', 'unités placées');
  await mj.call('landing-orders', {});
  const B = S.state.landing.b, Lg = S.state.landing;
  const T2 = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain, keys });
  const O2 = (keys, object) => mj.listeners('edit-tiles')[0]({ testForce: true, action: 'object', object, keys });
  const U = (id) => S.allBattleUnits().find((x) => x.id === id);
  const park = () => { let i = 0; for (const u of S.allBattleUnits()) B.pos[u.id] = `21,${i++ % 20}`; };
  // 1) Trajet de charge par l'entrée du pont (jamais par le côté) : rivière sur la ligne 9, pont en 4,9 orienté nord-ouest / sud-est.
  park();
  { const row = []; for (let x = 0; x < 20; x++) row.push(`${x},9`); T2(row, 'water'); O2(['4,9'], 'bridge'); mj.listeners('rotate-object')[0]({ key: '4,9', testForce: true });
    B.pos[E1] = '3,11'; B.orient[E1] = 5; B.pos[Z1] = '4,7'; B.orient[Z1] = 2;
    let r = await b.call('battle-order', { unit: E1, order: { type: 'charge', target: Z1 } }); ok(r.success, 'ordre de charge à travers le pont ' + (r.message || ''));
    S.emitLanding();
    const rt = S.orderRoutes()[E1] || [];
    const iB = rt.indexOf('4,9');
    ok(iB > 0 && S.bridgeOk(rt[iB - 1], '4,9') && S.bridgeOk('4,9', rt[iB + 1]), 'cheminement prévu : entrée et sortie par les extrémités du pont (' + rt.join(' ') + ')');
    await b.call('battle-order', { unit: E1, order: null });
    T2(row, 'plain'); }
  // 2) Tuiles interdites à portée (pointillés orange) : renvoyées avec la portée.
  park(); B.pos[E2] = '8,5'; O2(['9,5'], 'village');
  { const rr = await b.call('unit-reach', { unit: E2 }); ok(rr.success && (rr.forbid || []).includes('9,5') && !rr.tiles.includes('9,5'), 'portée : village simple à portée signalé comme interdit'); }
  // 3) Ordre des charges : à distance égale, les charges mutuelles avant les charges simples.
  park();
  B.pos[E1] = '2,2'; B.orient[E1] = 1; B.pos[Z1] = '2,8'; B.orient[Z1] = 4; // mutuelle E1 ⇄ Z1 (6 hex)
  B.pos[E2] = '10,2'; B.orient[E2] = 1; B.pos[Z2] = '10,8'; B.orient[Z2] = 4; // simple E2 → Z2 (6 hex)
  let r = await b.call('battle-order', { unit: E1, order: { type: 'charge', target: Z1 } }); ok(r.success, 'ordre E1 → Z1 ' + (r.message || ''));
  r = await c.call('battle-order', { unit: Z1, order: { type: 'charge', target: E1 } }); ok(r.success, 'ordre Z1 → E1 ' + (r.message || ''));
  r = await b.call('battle-order', { unit: E2, order: { type: 'charge', target: Z2 } }); ok(r.success, 'ordre E2 → Z2 ' + (r.message || ''));
  // 4) Charge mutuelle : forêts successives sur la moitié de E1 → elle peut s'arrêter sur la dernière forêt (en avançant au maximum) ou au milieu.
  { const band = []; for (let x = 0; x <= 5; x++) band.push(`${x},3`, `${x},4`); O2(band, 'forest'); }
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true }); ok(r.success, 'ordres révélés ' + (r.message || ''));
  const q = Lg.m.queue;
  const iM = q.findIndex((x) => x.mutual), iS = q.findIndex((x) => !x.mutual && x.id === E2);
  ok(iM >= 0 && iS >= 0 && q[iM].dist === q[iS].dist && iM < iS, `même distance (${q[iM]?.dist}/${q[iS]?.dist}) : la charge mutuelle passe avant la charge simple`);
  const mu = q[iM];
  const tiles = mu.plan?.choice ? (mu.plan.choice.side === 'A' ? mu.plan.choice.opts.map((k) => mu.plan.path[k]) : mu.plan.choice.opts.map((k) => mu.plan.path[mu.plan.n + 1 - k])) : [];
  console.log('trajet', (mu.plan?.path || []).join(' '), '· choix', tiles.join(' '));
  const pth = mu.plan?.path || [];
  ok(tiles.includes(pth[2]) && !tiles.includes(pth[1]), 'charge mutuelle : arrêt sur la dernière des forêts successives (avance au maximum), pas sur la première');
  ok(tiles.includes(pth[mu.plan?.kA]), 'charge mutuelle : elle peut aussi aller jusqu’au milieu');
  // 5) Artillerie : quand le trait passe entre deux tuiles, deux possibilités pour le même dé.
  { let found = null;
    for (let x = 0; x < 12 && !found; x++) for (let y = 0; y < 12 && !found; y++) { const al = S.artAlts('5,5', `${x},${y}`); if (al.some(Boolean)) found = { pt: `${x},${y}`, al }; }
    ok(Boolean(found), 'artillerie : cas de tuile ambiguë trouvé (' + (found ? found.pt + ' → ' + JSON.stringify(found.al) : '') + ')'); }
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
