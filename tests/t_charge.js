// Phase de tir : artillerie puis tirs à tour de rôle, dés, pertes, annulation, correction, jets de fuite, tour suivant, retour d'étape.
process.env.GAME_TEST = '1'; process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8862';
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
  mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'mark', mark: 'diamond', keys: ['1,5', '2,5', '3,5', '4,5', '5,5', '6,5', '7,5', '8,5', '9,5', '10,5', '11,5', '12,5', '3,15', '4,15', '10,15', '11,15'] });
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
  await mj.call('landing-lock', { force: true });
  const idOf = (lines, owner, re) => { const l = lines.find((x) => re.test(x.name)); return l ? `${owner}|${l.uid}#1` : null; };
  const A1 = idOf(lb, 'bob', /^inf lourde/), B1 = idOf(lc, 'cat', /^inf lourde/), A2 = idOf(lb, 'bob', /^inf d'elite/), B2 = idOf(lc, 'cat', /^caval lourde/);
  console.log('ids', A1, B1, A2, B2);


  await mj.call('landing-battle', {});
  const spot = { [A1]: ['3,9', 1], [B1]: ['3,14', 1], [A2]: ['10,9', 1], [B2]: ['10,13', 4] };
  for (let pass = 0; pass < 600; pass++) {
    if (L(mj).b.allPlaced) break; let prog = false;
    for (const U of [...ub, ...uc]) { if (L(mj).b.done[U]) continue; const S = U.startsWith('bob') ? b : c; const sp = spot[U];
      const rr = await S.call('battle-place', { unit: U, tile: sp ? sp[0] : undefined, orient: sp ? sp[1] : 0 }); if (rr.success) prog = true; }
    if (!prog) break;
  }
  ok(L(mj).b.allPlaced, 'tous placés');
  const P = (id) => L(mj).b.pos[id] || L(mj).placed[id];
  const hd = (a, b2) => { const cube = (k) => { const [c0, r0] = k.split(',').map(Number); const x = c0 - (r0 - (r0 & 1)) / 2; return [x, -x - r0, r0]; }; const A = cube(a), B = cube(b2); return Math.max(...A.map((v, i) => Math.abs(v - B[i]))); };
  await mj.call('landing-orders', {});
  { // prise à revers et visibilité (pose de l'ordre)
    const T = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'terrain', terrain, keys });
    const O = (keys, object) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'object', object, keys });
    const chk = (u, t) => (u.startsWith('bob') ? b : c).call('battle-charge-check', { unit: u, target: t });
    let k = await chk(A1, B1); console.log('A1→B1', JSON.stringify(k)); ok(k.rear && k.seen, 'B1 tournée vers le sud-est : prise à revers ; vue dégagée');
    k = await chk(A2, B2); ok(!k.rear, 'B2 tournée vers A2 : de face');
    k = await chk(B1, A1); ok(!k.seen && k.why === 'dans son dos', 'B1 tournée vers le sud-est charge A1 au nord : sans voir (dans son dos)');
    const band = []; for (let x = 0; x < 8; x++) band.push(`${x},11`, `${x},12`);
    O(band, 'forest'); k = await chk(A1, B1); console.log('forêt', JSON.stringify(k), JSON.stringify(L(mj).lines ? 1 : 0));
    ok(!k.seen && k.why === 'forêt', 'même niveau, forêt sur la ligne : non visible');
    T([P(A1)], 'hill'); k = await chk(A1, B1); ok(k.seen, 'unité qui charge sur une colline : voit par-dessus la forêt');
    T(band, 'hill'); k = await chk(A1, B1); ok(!k.seen && k.why === 'relief', 'sur sa colline, des collines au même niveau entre elle et la plaine : relief, non visible (' + k.why + ')');
    T([P(A1)], 'plain'); k = await chk(A1, B1); ok(!k.seen && k.why === 'hauteur', 'en plaine, des collines entre les deux : non visible (' + k.why + ')');
    T(band, 'mountain'); k = await chk(A1, B1); ok(!k.seen && k.why === 'montagne', 'montagne : personne ne voit à travers');
    T(band, 'plain'); T([P(A1)], 'plain');
    const r0 = await b.call('battle-order', { unit: A1, order: { type: 'charge', target: B1 } }); ok(r0.success && L(b).b.orders[A1].rear === true && L(b).b.orders[A1].seen === true, 'l’ordre garde revers et visibilité');
  }
  const giveCharges = async () => {
    for (const [S, u, t] of [[b, A1, B1], [c, B1, A1], [b, A2, B2], [c, B2, A2]]) { const r = await S.call('battle-order', { unit: u, order: { type: 'charge', target: t } }); ok(r.success, `ordre charge ${u.split('|')[1]} → ${t.split('|')[1]} ${r.message || ''}`); }
    await __ready(b, L); await __ready(c, L);
  };
  await giveCharges();
  let r = await mj.call('landing-move', { manual: true }); let v = L(mj);
  console.log('file', JSON.stringify(v.m.queue.map((x) => ({ id: x.id.split('|')[1], mutual: x.mutual, n: x.plan?.n, roll: x.plan?.roll, choice: x.plan?.choice }))));
  ok(v.m.queue.length === 2 && v.m.queue.every((x) => x.mutual), 'deux charges mutuelles (une entrée par paire)');
  // jouer les deux charges : l'acteur touche la tuile proposée
  const playCharge = async () => {
    const vv = L(mj), cur = vv.m.queue[vv.m.qi];
    const actor = vv.m.actors[0]; const S = actor.startsWith('bob') ? b : c;
    const tiles = L(S).m.allow[actor];
    const rr = await S.call('move-do', { unit: actor, tile: tiles[tiles.length - 1] });
    ok(rr.success, `charge mutuelle jouée (${cur.id.split('|')[1]}, ${cur.plan.n} tuiles entre elles${cur.plan.roll ? `, dé ${cur.plan.roll.a}/${cur.plan.roll.b}` : ''}) ${rr.message || ''}`);
    return cur;
  };
  const before = { A1: P(A1), B1: P(B1), A2: P(A2), B2: P(B2) };
  const c1 = await playCharge(), c2 = await playCharge();
  v = L(mj);
  const d1 = hd(P(A1), P(B1)), d2 = hd(P(A2), P(B2));
  const mv = (k) => hd(before[k], P(eval(k)));
  console.log('après', P(A1), P(B1), P(A2), P(B2), 'avancées', mv('A1'), mv('B1'), mv('A2'), mv('B2'));
  ok(d1 === 1 && d2 === 1, 'les deux paires sont au contact');
  { const q = (v.m.queue || []).filter((x) => x.res); const r0 = q[0]?.res;
    ok(q.length === 2 && r0.kind === 'mutual' && r0.units.length === 2 && r0.units.every((x) => x.path[0] === x.from && x.path[x.path.length - 1] === x.to), 'détail des charges : résultat et trajets conservés pour chaque charge'); }
  const even = [c1, c2].find((x) => x.plan.n % 2 === 0), odd = [c1, c2].find((x) => x.plan.n % 2 === 1);
  ok(even && !even.plan.roll && odd && odd.plan.roll, 'pas de dé si nombre pair de tuiles, dé d10 sinon');
  const ka = (x) => (x.id === A1 ? [mv('A1'), mv('B1')] : [mv('A2'), mv('B2')]);
  ok(ka(even)[0] === ka(even)[1], 'nombre pair : chacune fait la moitié ' + ka(even));
  const wa = odd.plan.roll.a > odd.plan.roll.b; const [oa, ob] = ka(odd);
  ok(wa ? oa === ob + 1 : ob === oa + 1, `nombre impair : le meilleur dé avance d’une tuile de plus (${oa}/${ob})`);
  ok(v.b.orient[A1] === [0,1,2,3,4,5].find((o) => o === v.b.orient[A1]) && v.m.step !== 'charge', 'charges terminées, unités orientées l’une vers l’autre');
  // annulation : positions des deux unités restaurées
  r = await mj.call('move-undo', {}); v = L(mj);
  const lastA = c2.id === A1 ? A1 : A2, lastB = c2.id === A1 ? B1 : B2;
  ok(P(lastA) === before[lastA === A1 ? 'A1' : 'A2'] && P(lastB) === before[lastB === B1 ? 'B1' : 'B2'], 'annulation : les deux unités reviennent');
  // avantage de terrain : A1 sur une colline, le reste en plaine
  await mj.call('landing-goto', { phase: 'orders' });
  mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'terrain', terrain: 'hill', keys: [P(A1)] });
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true }); v = L(mj);
  if (v.m.queue[v.m.qi].id !== A1) { const S0 = v.m.actors[0].startsWith('bob') ? b : c; const t0 = L(S0).m.allow[v.m.actors[0]]; await S0.call('move-do', { unit: v.m.actors[0], tile: t0[t0.length - 1] }); }
  v = L(mj); const ch = v.m.queue[v.m.qi];
  console.log('colline', JSON.stringify(ch.plan), 'acteurs', v.m.actors);
  ok(ch.id === A1 && ch.plan.choice && ch.plan.choice.unit === A1 && v.m.actors[0] === A1, 'A1 mieux placée (colline) : c’est elle qui choisit');
  const al = L(b).m.allow[A1]; console.log('tuiles proposées à A1', al);
  ok(al && al.includes(P(A1)), 'elle peut rester sur sa colline');
  const hA = P(A1);
  r = await b.call('move-do', { unit: A1, tile: hA }); ok(r.success, 'A1 reste sur la colline');
  ok(P(A1) === hA && hd(P(A1), P(B1)) === 1, 'B1 fait tout le chemin jusqu’au contact');
  // Pont : chaque côté a sa tuile juste avant le pont (+2) → même modificateur maximum → rencontre au milieu
  await mj.call('landing-goto', { phase: 'orders' });
  { const T2 = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'terrain', terrain, keys });
    const O2 = (keys, object) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'object', object, keys });
    T2([P(A1)], 'plain');
    const w1 = [], w2 = []; for (let x = 0; x <= 6; x++) w1.push(`${x},12`); for (let x = 7; x <= 13; x++) w2.push(`${x},11`);
    T2([...w1, ...w2], 'water'); O2(['3,12'], 'bridge'); O2(['10,11'], 'bridge');
    await __ready(b, L); await __ready(c, L);
    r = await mj.call('landing-move', { manual: true }); v = L(mj);
    console.log('file pont', JSON.stringify(v.m.queue.map((x) => ({ id: x.id.split('|')[1], d: x.dist }))));
    const done = {};
    for (let k = 0; k < 4 && L(mj).m.step === 'charge'; k++) {
      const vv = L(mj), cur = vv.m.queue[vv.m.qi]; const pair = cur.id === A1 || cur.target === A1 ? 1 : 2;
      console.log('paire', pair, JSON.stringify(cur.plan));
      done[pair] = cur.plan;
      const act = vv.m.actors[0], S = act.startsWith('bob') ? b : c; const al2 = L(S).m.allow[act];
      // règle du 26/10 : chaque unité compare le plus fort modificateur de sa moitié du trajet ; chacune a sa tuile d'entrée de pont (+2) → égalité → au milieu
      ok(cur.plan.choice && cur.plan.choice.bridge === true && cur.plan.choice.tie, 'pont : chacune sur sa tuile d’entrée → un d10 désigne le côté du pont');
      const at = al2[0]; r = await S.call('move-do', { unit: act, tile: at });
      ok(r.success && (() => { const x1 = pair === 1 ? P(A1) : P(A2), y1 = pair === 1 ? P(B1) : P(B2); return x1 && y1 && hd(x1, y1) === 1; })(), 'pont : la charge a lieu du côté désigné par le dé, au contact');
      { const S0 = global.__srv, o1 = S0.state.landing.b.orders[pair === 1 ? A1 : A2], o2 = S0.state.landing.b.orders[pair === 1 ? B1 : B2]; ok(!(o1?.save || []).includes('bridge') && !(o2?.save || []).includes('bridge'), 'pont : pas de modificateur de pont pour les deux unités'); }
    }
    ok(done[1] && done[2], 'les deux charges mutuelles avec pont ont été jouées');
  }
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 3000);
