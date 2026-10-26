// Bonus d'armée (BA) : unités marquées BA seulement ; Elfes sylvains (forêt gratuite, att −1 près d'une forêt), Saurus (eau, att −1 près d'une rivière), Empire (général à 9 hex).
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8865'; process.env.GAME_TEST = '1';
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
  const E = id1(lb, 'bob', /^inf legere/), EA = id1(lb, 'bob', /^archer lourd/), Z = id1(lc, 'cat', /^inf legere/), ZA = id1(lc, 'cat', /^archer/), ZT = id1(lc, 'cat', /^tirailleur/);
  ok(E && EA && Z && ZA && ZT, 'unités de test trouvées');
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
  const PZ = (id) => B.pos[id] || S.state.landing.placed[id];
  const hd = (a, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A2 = cube(a), B2 = cube(b2); return Math.max(...A2.map((v, i) => Math.abs(v - B2[i]))); };
  // Z en 5,12 tourné nord-ouest (4) : la tuile juste devant est 4,11
  B.pos[Z] = '5,12'; B.orient[Z] = 4; B.pos[ZT] = '9,15';
  let r = await c.call('battle-order', { unit: ZT, order: { type: 'tirailleur' } });
  ok(!r.success, 'tirailleurs seuls refusés : ' + r.message);
  B.pos[ZT] = '4,11'; B.orient[ZT] = 1;
  r = await c.call('battle-order', { unit: ZT, order: { type: 'tirailleur' } });
  ok(!r.success, 'tirailleurs pas tournés comme l’unité protégée : refusé');
  B.orient[ZT] = 4;
  r = await c.call('battle-order', { unit: ZT, order: { type: 'tirailleur' } });
  ok(r.success && S.screenOf(U(Z))?.id === ZT, 'tirailleurs sur la tuile juste devant l’unité de corps à corps : position tirailleur ' + (r.message || ''));
  ok(B.orient[ZT] === B.orient[Z], 'tirailleurs orientés comme l’unité protégée (un seul ensemble)');
  B.pos[ZT] = '5,11';
  ok(!S.screenOf(U(Z)), 'tuile voisine mais pas juste devant : pas de protection');
  B.pos[ZT] = '4,11';
  // distance de charge mesurée jusqu'aux tirailleurs
  B.pos[E] = '4,5'; B.orient[E] = 1;
  r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(r.success, 'unité protégée : distance de charge comptée jusqu’aux tirailleurs (6 hex), acceptée ' + (r.message || ''));
  B.pos[ZT] = '9,15';
  r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(!r.success, 'sans tirailleurs devant, la même cible (7 hex) est hors de portée : ' + r.message);
  B.pos[ZT] = '4,11';
  // prise à revers : ensemble tirailleurs + unité protégée, centre sur les tirailleurs, orientation de l'unité protégée
  B.pos[E] = '6,13'; B.orient[E] = 4;
  r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } });
  ok(r.success && B.orders[E].rear === true, 'revers calculé depuis la tuile des tirailleurs avec l’orientation de l’unité protégée');
  // déplacement simple : côte à côte permis s'il y a une différence de hauteur
  B.pos[E] = '4,7';
  r = await b.call('battle-order', { unit: E, order: { type: 'depl' } });
  edit({ action: 'terrain', terrain: 'plain', keys: ['4,10'] });
  let reach = (await b.call('battle-reach', { unit: E, type: 'depl' })).tiles || [];
  ok(!reach.includes('4,10'), 'même hauteur : pas d’arrêt au contact d’un adversaire');
  edit({ action: 'terrain', terrain: 'hill', keys: ['4,10'] });
  reach = (await b.call('battle-reach', { unit: E, type: 'depl' })).tiles || [];
  ok(reach.includes('4,10'), 'différence de hauteur (colline) : arrêt côte à côte permis');
  edit({ action: 'terrain', terrain: 'plain', keys: ['4,10'] });
  // tir sur l'unité protégée : pas de sauvegarde +1 (que corps à corps)
  S.state.landing.f = S.state.landing.f || { moved: {} };
  const fm = S.fireMods(U(EA), U(Z), 'tir').mods.find((x) => x.k === 'screen');
  ok(!fm, 'protégé par tirailleurs : sauvegarde +1 seulement au corps à corps, pas au tir');
  // 1. charge adverse sur l'unité protégée → redirigée sur les tirailleurs, échange après les tirs
  B.pos[E] = '4,7'; B.orient[E] = 1;
  r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } }); ok(r.success, 'ordre de charge sur l’unité protégée ' + (r.message || ''));
  B.orders[Z] = { type: 'depl' };
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true }); ok(r.success, 'ordres révélés');
  ok(B.orders[E].target === ZT && B.orders[E].screened === Z, 'la charge se dirige vers les tirailleurs');
  const m = S.state.landing.m;
  ok(m.queue[m.qi] && m.queue[m.qi].id === E, 'à jouer : la charge de E');
  let tiles = L(b).m.allow[E] || [];
  ok(tiles.length && tiles.every((t) => hd(t, '4,11') === 1), 'E vient au contact des tirailleurs (' + tiles.join(' ') + ')');
  r = await b.call('move-do', { unit: E, tile: tiles[0] }); ok(r.success, 'charge jouée');
  const pe = PZ(E);
  S.fireFinished();
  ok(PZ(Z) === '4,11' && PZ(ZT) === '5,12', 'après les tirs : l’unité protégée prend la place des tirailleurs (' + PZ(Z) + ' / ' + PZ(ZT) + ')');
  ok(hd(PZ(Z), pe) === 1, 'le corps à corps aura lieu entre E et l’unité protégée');
  ok(B.orient[ZT] === B.orient[Z], 'après l’échange, l’ensemble garde une seule orientation');
  // 2. l'unité protégée charge : elle traverse ses tirailleurs sans malus, ils la suivent
  await mj.call('landing-goto', { phase: 'orders' });
  await b.call('battle-ready', { on: false }); await c.call('battle-ready', { on: false });
  B.pos[Z] = '5,12'; B.orient[Z] = 4; B.pos[ZT] = '4,11'; B.orient[ZT] = 4; B.pos[E] = '3,8'; B.orient[E] = 1;
  r = await c.call('battle-order', { unit: ZT, order: { type: 'tirailleur' } }); ok(r.success, 'tirailleurs replacés');
  r = await c.call('battle-order', { unit: Z, order: { type: 'charge', target: E } }); ok(r.success, 'l’unité protégée charge à travers ses tirailleurs ' + (r.message || ''));
  B.orders[E] = { type: 'depl' };
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true }); ok(r.success, 'ordres révélés');
  ok(B.orders[Z].seen === true, 'ses tirailleurs ne gênent pas sa vision (' + (B.orders[Z].why || 'visible') + ')');
  tiles = L(c).m.allow[Z] || [];
  r = await c.call('move-do', { unit: Z, tile: tiles[0] }); ok(r.success, 'charge jouée');
  const pz = PZ(Z), back = PZ(ZT);
  ok(B.orient[ZT] === B.orient[Z], 'après la charge, les tirailleurs gardent l’orientation de l’unité protégée');
  ok(hd(pz, PZ(E)) === 1 && hd(back, pz) === 1 && hd(back, PZ(E)) === 2, 'les tirailleurs suivent, juste derrière l’unité qui charge (' + pz + ' / ' + back + ')');
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
