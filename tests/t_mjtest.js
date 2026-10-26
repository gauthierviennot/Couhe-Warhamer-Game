// Bonus d'armée (BA) : unités marquées BA seulement ; Elfes sylvains (forêt gratuite, att −1 près d'une forêt), Saurus (eau, att −1 près d'une rivière), Empire (général à 9 hex).
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8867'; process.env.GAME_TEST = '1';
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
  let r = await c.call('battle-order', { unit: E, order: { type: 'depl' } }); ok(!r.success, 'un joueur ne donne pas d’ordre à une unité adverse');
  r = await mj.call('battle-order', { unit: E, order: { type: 'depl' } }); ok(!r.success, 'hors mode test, le MJ ne joue pas à la place d’un joueur');
  r = await mj.call('mj-test', { on: true }); ok(r.success && L(mj).test.on, 'mode test et correction activé');
  r = await mj.call('battle-order', { unit: E, order: { type: 'depl' } }); ok(r.success && B.orders[E]?.type === 'depl', 'en mode test, le MJ donne l’ordre d’un joueur ' + (r.message || ''));
  r = await c.call('battle-order', { unit: E, order: { type: 'depl' } }); ok(!r.success, 'même en mode test du MJ, un joueur ne touche pas aux unités adverses');
  r = await mj.call('mj-test', { on: false, keep: false });
  ok(r.success && !L(mj).test.on && !S.state.landing.b.orders[E], 'fin du test en revenant à l’état du début : l’ordre disparaît');
  await mj.call('mj-test', { on: true });
  r = await mj.call('battle-order', { unit: E, order: { type: 'depl' } });
  r = await mj.call('mj-test', { on: false, keep: true });
  ok(r.success && S.state.landing.b.orders[E]?.type === 'depl', 'fin du test en gardant l’état : l’ordre reste');
  // charge avec une seule issue : résolue automatiquement à la révélation
  { const BB = S.state.landing.b; BB.pos[E] = '5,6'; BB.pos[Z] = '5,10'; BB.orient[Z] = 4;
    r = await b.call('battle-order', { unit: E, order: { type: 'charge', target: Z } }); ok(r.success, 'ordre de charge ' + (r.message || ''));
    S.emitLanding();
    await __ready(b, L); await __ready(c, L);
    r = await mj.call('landing-move', {}); ok(r.success, 'ordres révélés');
    const pe = BB.pos[E] || S.state.landing.placed[E];
    const hd = (a2, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A2 = cube(a2), B2 = cube(b2); return Math.max(...A2.map((v, i) => Math.abs(v - B2[i]))); };
    ok(hd(pe, '5,10') === 1, 'une seule facette possible : la charge se résout seule, l’unité est au contact (' + pe + ')'); }
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
