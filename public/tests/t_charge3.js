// Charges : unité déjà chargée (charge simple annulée, charge mutuelle devenue simple) ; ponts orientés.
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8871'; process.env.GAME_TEST = '1';
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
  const hd = (a2, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A2 = cube(a2), B2 = cube(b2); return Math.max(...A2.map((v, i) => Math.abs(v - B2[i]))); };
  const put = (id, t, o) => { B.pos[id] = t; B.orient[id] = o; };
  // 1) Z1 charge E1 (le plus court) ; E1 charge Z2 (plus long) : E1 est prise d'abord, sa charge n'a pas lieu.
  put(E1, '4,6', 1); put(Z1, '4,8', 4); put(Z2, '7,9', 4);
  // 2) E3 charge Z3 (court) ; E2 ⇄ Z3 en charge mutuelle (plus long) : Z3 est prise d'abord, E2 fait tout le trajet jusqu'à elle.
  put(E3, '14,8', 1); put(Z3, '14,10', 4); put(E2, '11,6', 1);
  let r = await c.call('battle-order', { unit: Z1, order: { type: 'charge', target: E1 } }); ok(r.success, 'ordre Z1 → E1 ' + (r.message || ''));
  r = await b.call('battle-order', { unit: E1, order: { type: 'charge', target: Z2 } }); ok(r.success, 'ordre E1 → Z2 ' + (r.message || ''));
  r = await b.call('battle-order', { unit: E3, order: { type: 'charge', target: Z3 } }); ok(r.success, 'ordre E3 → Z3 ' + (r.message || ''));
  r = await b.call('battle-order', { unit: E2, order: { type: 'charge', target: Z3 } }); ok(r.success, 'ordre E2 → Z3 ' + (r.message || ''));
  r = await c.call('battle-order', { unit: Z3, order: { type: 'charge', target: E2 } }); ok(r.success, 'ordre Z3 → E2 ' + (r.message || ''));
  S.emitLanding();
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', {}); ok(r.success, 'ordres révélés ' + (r.message || ''));
  for (let k = 0; k < 10 && Lg.m.step === 'charge'; k++) {
    const vv = L(mj); const act = vv.m.actors[0]; if (!act) break; const So = act.startsWith('bob') ? b : c; const al = L(So).m.allow[act] || [];
    const rr = await So.call('move-do', { unit: act, tile: al[0] }); if (!rr.success) { console.log('move-do', rr.message); break; }
  }
  const q = Lg.m.queue; console.log(q.map((x) => `${x.id.split('|')[1]}→${x.target.split('|')[1]} d${x.dist} ${x.res?.kind}${x.wasMutual ? ' (ex-mutuelle)' : ''}`).join(' ; '));
  const P2 = (id) => B.pos[id] || Lg.placed[id];
  const e1 = q.find((x) => x.id === E1);
  ok(e1?.res?.kind === 'taken' && P2(E1) === '4,6', 'charge simple d’une unité déjà chargée : elle n’a pas lieu, l’unité reste en place');
  ok(hd(P2(Z1), P2(E1)) === 1, 'Z1 est bien au contact de E1');
  const ex = q.find((x) => x.wasMutual);
  ok(ex && ex.id === E2 && ex.target === Z3 && ex.res?.kind === 'contact' && hd(P2(E2), P2(Z3)) === 1, 'charge mutuelle dont une unité est déjà prise : l’autre fait tout le trajet jusqu’à son contact');
  ok(P2(Z3) === '14,10', 'l’unité déjà prise reste sur place');
  // annulation : la charge convertie redevient mutuelle
  for (let k = 0; k < 6; k++) await mj.call('move-undo', {});
  ok(!q.some((x) => x.wasMutual) && q.some((x) => x.mutual), 'annulation : la charge mutuelle convertie redevient mutuelle');
  // 3) Ponts orientés
  { const T2 = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain, keys });
    const O2 = (keys, object) => mj.listeners('edit-tiles')[0]({ testForce: true, action: 'object', object, keys });
    const row = []; for (let x = 0; x < 22; x++) row.push(`${x},11`);
    T2(row, 'water'); O2(['4,11'], 'bridge');
    const g = S.state.gridData['4,11']; ok(g?.object === 'bridge' && (g.dir || 0) === 0, 'pont posé, orientation est-ouest');
    ok(!S.bridgeOk('4,10', '4,11') && !S.bridgeOk('4,11', '4,12'), 'pont est-ouest : on n’y monte pas depuis la rive nord, on n’en descend pas vers le sud');
    mj.listeners('rotate-object')[0]({ key: '4,11', testForce: true });
    ok((S.state.gridData['4,11'].dir || 0) === 1, 'pont tourné : axe sud-est / nord-ouest');
    ok(S.bridgeOk('4,10', '4,11') && S.bridgeOk('4,11', '5,12'), 'on passe d’une extrémité à l’autre du pont (nord-ouest → sud-est)');
    ok(!S.bridgeOk('3,11', '4,11') && !S.bridgeOk('4,11', '4,12'), 'pas d’entrée ni de sortie par le côté du pont');
  }
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 300);
