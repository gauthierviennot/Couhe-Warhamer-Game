// Bonus d'armée (BA) : unités marquées BA seulement ; Elfes sylvains (forêt gratuite, att −1 près d'une forêt), Saurus (eau, att −1 près d'une rivière), Empire (général à 9 hex).
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8863'; process.env.GAME_TEST = '1';
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
  const T = (keys, terrain) => edit({ action: 'terrain', terrain, keys });
  const O = (keys, object) => edit({ action: 'object', object, keys });
  const clr = (keys) => { for (const k of keys) if (S.state.gridData[k]) delete S.state.gridData[k].object; };
  const U = (id) => S.allBattleUnits().find((x) => x.id === id);
  ok(S.hasBA(U(E)) && S.hasBA(U(Z)), 'les unités marquées (BA) sont reconnues');
  // 1. forêt : coût normal pour une unité sans BA, gratuit pour un elfe sylvain BA
  const ring = ['4,8', '6,8', '4,7', '5,7', '4,9', '5,9'];
  O(ring, 'forest');
  const reach = await b.call('battle-reach', { unit: E, type: 'depl' });
  const dep = lb.find((l) => E.includes(l.uid)).dep;
  ok(reach.success && reach.tiles.includes('2,8') && dep === 3, `elfe sylvain BA : la forêt ne coûte rien (dep ${dep}, ${reach.tiles?.length} tuiles)`);
  ok(S.unitMob(U(E)).woods === true && S.unitMob(U(Z)).woods === false, 'forêt gratuite seulement pour les Elfes sylvains BA');
  // 2. Saurus BA sur l'eau
  ok(S.unitMob(U(Z)).swim === true && S.unitMob(U(E)).swim === false, 'les Saurus BA nagent, pas les elfes');
  // 3. bonus d'attaque −1 près du terrain
  clr(ring);
  ok(S.terrainBA(U(EA)) === null, 'archer sylvain loin de toute forêt : pas de bonus');
  O(['13,8'], 'forest'); ok(S.terrainBA(U(EA)) === 'forêt', 'forêt à 3 hex : bonus');
  clr(['13,8']); O(['14,8'], 'forest'); ok(S.terrainBA(U(EA)) === null, 'forêt à 4 hex : pas de bonus');
  clr(['14,8']); O([P(EA)], 'forest'); ok(S.terrainBA(U(EA)) === 'forêt', 'dans la forêt : bonus');
  clr([P(EA)]);
  ok(S.terrainBA(U(ZA)) === null, 'archer saurus loin de l’eau : pas de bonus');
  T(['12,14'], 'water'); ok(S.terrainBA(U(ZA)) === 'rivière', 'rivière à 2 hex : bonus');
  O(['12,14'], 'bridge'); ok(S.terrainBA(U(ZA)) === 'rivière', 'un pont compte comme rivière');
  S.state.landing.f = S.state.landing.f || { moved: {} };
  const fm = S.fireMods(U(ZA), U(EA), 'tir').mods.find((m) => m.k === 'ba');
  ok(fm && fm.on && fm.v === -1, 'modificateur de tir « Bonus d’armée » −1 coché d’office');
  T(['12,14'], 'plain'); clr(['12,14']);
  const fm2 = S.fireMods(U(ZA), U(EA), 'tir').mods.find((m) => m.k === 'ba');
  ok(fm2 && !fm2.on, 'loin de la rivière : modificateur proposé mais décoché');
  // village : sauvegarde +2 pour les tuiles autour des maisons
  const bm = () => S.fireMods(U(ZA), U(EA), 'tir').mods.find((m) => m.k === 'build');
  ok(!bm().on, 'cible loin des villages : pas de sauvegarde de construction');
  O(['11,8'], 'village'); ok(bm().on, 'cible juste à côté d’un village : sauvegarde +2');
  clr(['11,8']);
  // tir : prise à revers (−2), marche forcée (−2), sortie de pont (+2)
  const fmv = (k) => S.fireMods(U(ZA), U(EA), 'tir').mods.find((m) => m.k === k);
  S.state.landing.b.orient[EA] = 1; ok(!fmv('trear').on, 'tir de face : pas de revers');
  S.state.landing.b.orient[EA] = 4; ok(fmv('trear').on && fmv('trear').v === -2, 'tir dans le dos de la cible : prise à revers −2');
  S.state.landing.b.orders[EA] = { type: 'marche' }; ok(fmv('tmarche').on && fmv('tmarche').v === -2, 'cible en marche forcée : −2'); delete S.state.landing.b.orders[EA];
  T(['10,9', '9,9'], 'water'); O(['10,9', '9,9'], 'bridge'); ok(fmv('bridge').on && fmv('bridge').v === 2, 'cible à la sortie du pont, tir par le pont : +2'); clr(['10,9', '9,9']); T(['10,9', '9,9'], 'plain');
  // 4. portée du général : 6, 9 pour l'Empire
  ok(S.genRadius('bob') === 6, 'portée du général hors Empire = 6 (sans général désigné)');
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
