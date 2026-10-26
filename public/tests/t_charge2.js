// Bonus d'armée (BA) : unités marquées BA seulement ; Elfes sylvains (forêt gratuite, att −1 près d'une forêt), Saurus (eau, att −1 près d'une rivière), Empire (général à 9 hex).
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8864'; process.env.GAME_TEST = '1';
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
  const id1 = (lines, owner, re) => { const l = lines.find((x) => re.test(x.name)); return l ? `${owner}|${l.uid}#1` : null; };
  const E = id1(lb, 'bob', /^inf legere/), EA = id1(lb, 'bob', /^archer lourd/), Z = id1(lc, 'cat', /^inf legere/), ZA = id1(lc, 'cat', /^archer/);
  ok(E && EA && Z && ZA, 'unités de test trouvées');
  const spot = { [E]: '5,8', [EA]: '10,8', [Z]: '5,12', [ZA]: '10,12' };
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
  ok(P(E) === '5,8' && P(Z) === '5,12', 'unités placées');
  await mj.call('landing-orders', {});

  const B = S.state.landing.b;
  const U = (id) => S.allBattleUnits().find((x) => x.id === id);
  const others = allC.filter((x) => x !== Z && x !== ZA);
  // une unité au sol passe sous une unité volante en vol (sans s'arrêter sur sa tuile)
  { const FL = allC.find((x) => /ptérodactyle/.test(S.allBattleUnits().find((y) => y.id === x)?.line.name || ''));
    const mates = allB.filter((x) => x !== E && x !== EA).slice(0, 5);
    const keep = {}; for (const x of [E, Z, FL, ...mates]) keep[x] = B.pos[x];
    B.pos[E] = '5,6'; B.pos[Z] = '5,10'; B.pos[FL] = '5,7';
    ['6,6', '4,6', '4,5', '5,5', '4,7'].forEach((t, i) => { B.pos[mates[i]] = t; });
    ok(FL && S.chargeInRange(U(E), '5,10', 5, [false]), 'charge : passe sous l’unité volante en vol, sans traverser d’unité au sol');
    B.orders[FL] = { type: 'depl', air: false };
    ok(!S.chargeInRange(U(E), '5,10', 5, [false]), 'unité volante restée au sol : elle barre le passage');
    delete B.orders[FL];
    for (const x of Object.keys(keep)) { if (keep[x] == null) delete B.pos[x]; else B.pos[x] = keep[x]; } }
  // marqueurs de terrain de la cible et charge de cavalerie
  B.pos[E] = '5,6'; B.pos[Z] = '5,10';
  edit({ action: 'terrain', terrain: 'hill', keys: ['5,10'] }); edit({ action: 'object', object: 'forest', keys: ['5,10'] });
  let rm = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(rm.success && JSON.stringify(B.orders[E].save) === JSON.stringify(['hill', 'forest']), 'marqueurs de la cible : colline et forêt (' + JSON.stringify(B.orders[E].save) + ')');
  const CAV = allB.find((x) => /caval lourde/.test(S.allBattleUnits().find((y) => y.id === x)?.line.name || ''));
  if (CAV) { B.pos[CAV] = '7,7'; rm = await b.call('battle-order', { unit: CAV, order: { type: 'charge', target: Z } }); ok(rm.success && B.orders[CAV].cav === false, 'cavalerie (C) contre une cible en forêt : pas d’att ×2'); delete B.orders[CAV]; B.pos[CAV] = '20,1'; }
  edit({ action: 'terrain', terrain: 'plain', keys: ['5,10'] }); { const g = S.state.gridData['5,10']; if (g) delete g.object; }
  delete B.orders[E];
  // 1. distance de charge à la pose, par le chemin autorisé (5 tuiles jusqu'au contact)
  B.pos[E] = '5,6'; B.pos[Z] = '5,12';
  let r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(r.success, 'cible à 6 hex : contact atteint en 5 tuiles, charge acceptée ' + (r.message || ''));
  B.pos[E] = '5,4';
  r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(!r.success, 'cible à 8 hex : refusée — ' + r.message);
  // 2. charge mutuelle (à portée) avec une forêt sur la moitié de E
  B.pos[E] = '5,6'; B.pos[Z] = '5,12';
  B.orders[E] = { type: 'charge', target: Z }; B.orders[Z] = { type: 'charge', target: E };
  // 3. charge simple, toutes les tuiles au contact de la cible occupées : deuxième rideau
  B.pos[EA] = '10,8'; B.pos[ZA] = '10,12';
  const ring = ['11,12', '9,12', '9,11', '10,11', '9,13', '10,13'];
  // facette de charge : la plus proche, sinon les 2 voisines, sinon toutes (surnombre)
  { const hd = (a, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A2 = cube(a), B2 = cube(b2); return Math.max(...A2.map((v, i) => Math.abs(v - B2[i]))); };
    B.orders[EA] = { type: 'charge', target: ZA, rear: false }; B.orient[ZA] = 4; // cible tournée nord-ouest : facettes avant 9,11 / 10,11 / 9,12
    let f = S.chargeFacets(U(EA), '10,12');
    ok(f.length === 1 && hd(f[0], '10,8') === 3, 'facette la plus proche de l’attaquant (' + f.join(' ') + ')');
    const f0 = f[0]; B.pos[others[0]] = f0;
    f = S.chargeFacets(U(EA), '10,12');
    ok(f.length === 2 && f.includes('9,11') && f.includes('9,12'), 'facette occupée : les autres facettes de la charge (avant, charge de face) (' + f.join(' ') + ')');
    B.pos[others[1]] = f[0]; B.pos[others[2]] = f[1];
    f = S.chargeFacets(U(EA), '10,12');
    ok(f.length === 3 && ['11,12', '9,13', '10,13'].every((k) => f.includes(k)), 'surnombre : étalement sur les autres facettes seulement quand celles de la charge sont prises (' + f.join(' ') + ')');
    B.orders[EA].rear = true; for (const i of [1, 2]) delete B.pos[others[i]];
    f = S.chargeFacets(U(EA), '10,12');
    ok(f.length === 3 && ['11,12', '9,13', '10,13'].every((k) => f.includes(k)), 'charge à revers, facette prise : les facettes arrière d’abord (' + f.join(' ') + ')');
    delete B.orders[EA];
    for (const i of [0, 1, 2]) delete B.pos[others[i]]; }
  ring.forEach((t, i) => { B.pos[others[i]] = t; });
  B.orders[EA] = { type: 'charge', target: ZA };
  // 4. charge hors de portée à la révélation (ordre posé à la main) : échouée
  const XF = allB.find((x) => x !== E && x !== EA);
  B.pos[XF] = '18,3'; B.orders[XF] = { type: 'charge', target: ZA };
  // forêt sur la moitié du trajet de E seulement (charge mutuelle) : E peut s'y arrêter, Z vient à son contact
  edit({ action: 'object', object: 'forest', keys: Array.from({ length: 22 }, (_, x) => `${x},7`) });
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', {}); ok(r.success, 'ordres révélés');
  edit({ action: 'terrain', terrain: 'hill', keys: ['0,10'] });
  ok((S.state.gridData['0,10']?.terrain ?? 'plain') !== 'hill' && mj.log.some((x) => x[0] === 'edit-refused'), 'terrain figé une fois les ordres validés : modification refusée');
  b.listeners('paint-tile')[0]({ key: '0,11', kind: 'terrain', id: 'hill' });
  ok((S.state.gridData['0,11']?.terrain ?? 'plain') !== 'hill' && b.log.some((x) => x[0] === 'edit-refused'), 'terrain figé aussi pour le pinceau des joueurs');
  const m = S.state.landing.m;
  const qf = m.queue.find((x) => x.id === XF);
  ok(qf && qf.failed && B.orders[XF].failed, 'charge hors de portée à la révélation : échouée');
  const hd = (a, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A2 = cube(a), B2 = cube(b2); return Math.max(...A2.map((v, i) => Math.abs(v - B2[i]))); };
  ok(m.queue[m.qi].id === EA, 'à jouer : la charge sur la cible encerclée');
  r = await b.call('move-skip', { unit: EA }); ok(!r.success, 'le joueur ne peut pas renoncer à sa charge : ' + r.message);
  let tiles = L(b).m.allow[EA] || [];
  ok(tiles.length && tiles.every((t) => hd(t, '10,12') === 2), 'cible encerclée : tuiles au plus près, en deuxième rideau (' + tiles.join(' ') + ')');
  r = await b.call('move-do', { unit: EA, tile: tiles[0] }); ok(r.success && B.orders[EA].second, 'l’unité s’avance en deuxième rideau, elle ne combattra pas');
  // charge échouée : elle avance quand même au maximum de sa capacité de charge vers sa cible
  if (m.queue[m.qi]?.id === XF) {
    const tf = L(b).m.allow[XF] || [];
    ok(tf.length && tf.every((t) => hd(t, '10,12') < hd('18,3', '10,12')), 'charge échouée : tuiles d’arrivée plus proches de la cible (' + tf.join(' ') + ')');
    r = await b.call('move-do', { unit: XF, tile: tf[0] }); ok(r.success && hd(B.pos[XF], '18,3') >= 1, 'charge échouée : l’unité avance au maximum de sa capacité de charge');
  }
  const qm = m.queue.find((x) => x.mutual);
  ok(qm && qm.plan && qm.plan.contact && !qm.plan.none, 'charge mutuelle : contact (' + (qm?.plan?.n) + ' tuiles entre elles)');
  ok(qm.plan.choice && qm.plan.choice.unit === E && qm.plan.mods.a === 2 && qm.plan.mods.b === 0, 'forêt croisée par E seulement : E choisit où s’arrêter (' + JSON.stringify(qm.plan.mods) + ')');
  const actor0 = L(mj).m.actors[0];
  if (actor0 === XF) { const tf = L(b).m.allow[XF] || []; ok(tf.length && tf.every((t) => hd(t, '10,12') < hd('18,3', '10,12')), 'charge échouée : tuiles d’arrivée plus proches de la cible (' + tf.join(' ') + ')'); r = await b.call('move-do', { unit: XF, tile: tf[0] }); ok(r.success, 'charge échouée : l’unité avance au maximum de sa capacité de charge'); }
  const actor = L(mj).m.actors[0];
  const So = actor && actor.startsWith('bob') ? b : c;
  tiles = L(So).m.allow[actor] || [];
  const ft = tiles.find((t) => t.endsWith(',7'));
  ok(actor === E && ft, 'E peut s’arrêter dans la forêt (' + tiles.join(' ') + ')');
  r = await So.call('move-do', { unit: actor, tile: ft || tiles[0] }); ok(r.success && B.pos[E] === ft, 'charge mutuelle jouée : E s’arrête dans la forêt ' + (r.message || ''));
  const pe = B.pos[E] || S.state.landing.placed[E], pz = B.pos[Z] || S.state.landing.placed[Z];
  ok(hd(pe, pz) === 1, 'les deux unités sont au contact (' + pe + ' / ' + pz + ')');
  // 5. charge mutuelle où les deux sont hors de portée (ordres posés à la main) : chacune avance au maximum, sans contact
  await mj.call('landing-goto', { phase: 'orders' });
  await b.call('battle-ready', { on: false }); await c.call('battle-ready', { on: false });
  for (const k of Object.keys(B.orders)) delete B.orders[k];
  edit({ action: 'object', object: 'forest', keys: [] });
  for (let x = 0; x < 22; x++) { const g = S.state.gridData[`${x},7`]; if (g) delete g.object; }
  B.pos[E] = '5,2'; B.pos[Z] = '5,15';
  B.orders[E] = { type: 'charge', target: Z }; B.orders[Z] = { type: 'charge', target: E };
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', {}); ok(r.success, 'ordres révélés (2e tour)');
  const m2 = S.state.landing.m, q2 = m2.queue.find((x) => x.mutual);
  ok(q2 && q2.failed && q2.plan && q2.plan.contact === false, 'les deux hors de portée : charge mutuelle échouée, sans contact');
  const a2 = L(mj).m.actors[0], S2 = a2 && a2.startsWith('bob') ? b : c;
  const t2 = L(S2).m.allow[a2] || [];
  r = await S2.call('move-do', { unit: a2, tile: t2[0] });
  const e2 = B.pos[E] || S.state.landing.placed[E], z2 = B.pos[Z] || S.state.landing.placed[Z];
  ok(r.success && hd(e2, '5,2') >= 4 && hd(z2, '5,15') >= 4 && hd(e2, z2) > 1, 'chacune avance au maximum de sa capacité de charge (' + e2 + ' / ' + z2 + ')');
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
