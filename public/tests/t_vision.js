// Règle de vision (REGLE-VISION.md) : exemples de la règle rejoués sur une carte, via la vérification de charge et la révélation des ordres.
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
  await mj.call('new-map', { cols: 22, rows: 20 });
  const top = [], bot = []; for (let x = 0; x < 22; x++) { top.push(`${x},1`); bot.push(`${x},18`); }
  const edit = (d) => mj.listeners('edit-tiles')[0]({ testForce: true, ...d });
  edit({ action: 'mark', mark: 'diamond', keys: [...top, ...bot] });
  await mj.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(mj).zones.map((z) => z.id);
  await mj.call('landing-group', { zone: zs[0], group: 'A' }); await mj.call('landing-group', { zone: zs[1], group: 'B' });
  await mj.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await mj.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  await mj.call('fiches-pick', { name: 'bob', army: 'empire', legion: '1' }); await mj.call('fiches-pick', { name: 'cat', army: 'saurus', legion: '1' });
  await mj.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[1] });
  await mj.call('landing-freeze', { force: true });
  const lb = L(b).lines.filter((l) => l.owner === 'bob'), lc = L(c).lines.filter((l) => l.owner === 'cat');
  const ids = (lines, owner, re, n) => { const l = lines.find((x) => re.test(x.name)); return l ? Array.from({ length: Math.min(n, l.qty) }, (_, i) => `${owner}|${l.uid}#${i + 1}`) : []; };
  const [A, A3, A4] = ids(lb, 'bob', /^inf lourde/, 3), [X, X2, X3] = ids(lb, 'bob', /^inf legere/, 3);
  const ccLine = lc.filter((l) => /^(iL|il|ie)$/.test(l.type));
  const cc = ccLine.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `cat|${l.uid}#${i + 1}`));
  const [B, B3, B4] = cc; const [GT] = ids(lc, 'cat', /haut/, 1); const [F] = ids(lc, 'cat', /ptérodactyle/, 1);
  console.log('unités', { A, A3, A4, X, X2, X3, B, B3, B4, GT, F });
  ok(A && A4 && X3 && B && B4 && GT && F, 'unités de test trouvées');
  // positions : [tuile, orientation] ; dépôt dans la même colonne de chaque zone
  const spot = { [A]: ['5,8', 1], [B]: ['5,12', 4], [A3]: ['14,8', 4], [B3]: ['14,12', 4], [A4]: ['17,8', 1], [GT]: ['17,12', 4], [X2]: ['17,10', 1],
    [X]: ['11,8', 1], [X3]: ['11,10', 1], [B4]: ['11,12', 4], [F]: ['8,12', 4] };
  const allB = lb.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `bob|${l.uid}#${i + 1}`)), allC = lc.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `cat|${l.uid}#${i + 1}`));
  for (const u of allB) await b.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u][0].split(',')[0]},1` : '20,1' });
  for (const u of allC) await c.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u][0].split(',')[0]},18` : '20,18' });
  await mj.call('landing-lock', { force: true });
  await mj.call('landing-battle', {});
  for (let pass = 0; pass < 800 && !L(mj).b.allPlaced; pass++) {
    let prog = false;
    for (const S of [b, c]) for (const u of L(S).b.actors || []) { const sp = spot[u]; const r = await S.call('battle-place', { unit: u, tile: sp ? sp[0] : undefined, orient: sp ? sp[1] : 0 }); if (r.success) { prog = true; break; } }
    if (!prog) break;
  }
  const P = (id) => L(mj).b.pos[id] || L(mj).placed[id];
  ok(L(mj).b.allPlaced && P(A) === '5,8' && P(F) === '8,12' && P(X3) === '11,10', 'unités placées aux positions des exemples');
  await mj.call('landing-orders', {});
  const T = (keys, terrain) => edit({ action: 'terrain', terrain, keys });
  const O = (keys, object) => edit({ action: 'object', object, keys });
  const row = (r) => Array.from({ length: 22 }, (_, x) => `${x},${r}`).filter((k) => !Object.values(spot).some((s) => s[0] === k));
  const reset = () => { for (let r = 2; r <= 17; r++) T(row(r), 'plain'); for (const k of Object.values(spot).map((s) => s[0])) T([k], 'plain'); };
  const chk = async (u, t) => (u.startsWith('bob') ? b : c).call('battle-charge-check', { unit: u, target: t });
  const see = async (u, t, want, msg, whyWant) => { const k = await chk(u, t); ok(k.seen === want && (!whyWant || k.why === whyWant), `${msg} → ${k.seen ? 'visible' : 'non visible (' + k.why + ')'}`); return k; };

  reset();
  await see(A, B, true, '1. plaine dégagée');
  O(row(10), 'forest'); await see(A, B, false, '2. même niveau, forêt au milieu', 'forêt');
  reset(); T([P(A)], 'hill'); O(row(10), 'forest'); await see(A, B, true, '3. bord de colline → plaine, forêt au milieu avec tuile dégagée avant la cible');
  reset(); T([P(A)], 'hill'); O(row(11), 'forest'); await see(A, B, false, '4. bord de colline → plaine, forêt juste devant la cible (abri)', 'forêt (abri)');
  reset(); T([P(A)], 'hill'); O(row(9), 'forest'); await see(A, B, false, '5. forêt juste en contrebas de l’unité haute (abri)', 'forêt (abri)');
  reset(); T([P(A)], 'hill'); T(row(9), 'hill'); await see(A, B, false, '6. milieu de colline (tuile suivante au même niveau)', 'relief');
  reset(); T([P(A)], 'hill'); O([P(A)], 'fortress'); T(row(11), 'hill'); await see(A, B, false, '7. fortification sur colline, colline juste devant la cible', 'colline (abri)');
  reset(); T([P(A)], 'hill'); O([P(A)], 'fortress'); T(row(10), 'hill'); await see(A, B, true, '8. fortification sur colline (niveau 2), colline plus basse au milieu');
  reset(); T([P(A)], 'hill'); T([P(B)], 'hill'); await see(A, B, true, '9. deux collines, vallée en plaine');
  O(row(10), 'forest'); await see(A, B, true, '9b. deux collines, forêt dans la vallée (plus basse)');
  T(row(10), 'hill'); O(row(10), 'fortress'); await see(A, B, false, '9c. deux collines, fortification sur colline (niveau 2) dans la vallée', 'hauteur');
  reset(); O(row(10), 'village'); await see(A, B, false, '10. village simple en plaine entre deux unités en plaine', 'village');
  reset(); T(row(10), 'hill'); O(row(10), 'village'); T([P(A)], 'hill'); T([P(B)], 'hill'); await see(A, B, false, '11. village simple sur une colline entre deux collines (même niveau)', 'village');
  reset(); T(row(10), 'mountain'); await see(A, B, false, '12. montagne', 'montagne');
  // unités sur le trait
  reset(); await see(X, B4, false, '13. unité au sol entre deux unités en plaine', 'unité');
  { // montagne qui rogne le trait au coin : elle bloque aussi la vue d'une unité volante en vol (cas de la capture du MJ)
    const S0 = global.__srv, BB = S0.state.landing.b, kA = BB.pos[A], kF = BB.pos[F];
    BB.pos[A] = '6,3'; BB.pos[F] = '9,10';
    reset(); T(['7,6'], 'mountain');
    await see(A, F, false, '13c. montagne qui rogne le trait au coin : bloque la vue, même vers une unité volante en vol', 'montagne');
    reset(); BB.pos[A] = kA; BB.pos[F] = kF;
  }
  { const S0 = global.__srv, BB = S0.state.landing.b, keepX3 = BB.pos[X3], keepGT = BB.pos[GT];
    BB.pos[X3] = '20,3'; BB.pos[GT] = '11,10';
    await see(X, B4, false, '13b. grande taille entre deux unités en plaine : elle cache la vue comme une autre unité', 'unité');
    BB.pos[X3] = keepX3; BB.pos[GT] = keepGT; }
  T([P(X)], 'hill'); await see(X, B4, true, '14. niveaux différents : unité au milieu de la plaine ne bloque pas');
  reset(); await see(A4, GT, true, '15. grande taille : on la voit par-dessus l’unité');
  O(row(11), 'forest'); await see(A4, GT, false, '16. grande taille cachée par un abri juste devant elle', 'forêt (abri)');
  reset(); O([P(GT)], 'forest'); await see(A4, GT, false, '17. grande taille dans une forêt : toujours cachée', 'dans une forêt');
  // arrière et 360°
  reset(); await see(A3, B3, false, '18. charge vers l’arrière', 'dans son dos');
  O([P(A3)], 'fortress'); await see(A3, B3, true, '19. sur une fortification : vue à 360°');
  reset(); O([P(A3)], 'village-flat'); await see(A3, B3, true, '20. sur un village à toit plat : vue à 360°');
  // unité volante
  reset(); T(row(10), 'hill'); O(row(11), 'forest'); await see(A, F, true, '21. cible volante en vol : vue par-dessus relief et forêt');
  reset(); T(row(10), 'mountain'); await see(A, F, false, '22. cible volante, montagne', 'montagne');
  reset(); O([P(F)], 'forest'); await see(A, F, true, '23. cible volante en vol dans une forêt : vue');
  // choix « au sol » de l'unité volante (caché à l'adversaire jusqu'à la révélation)
  let r = await c.call('battle-order', { unit: F, order: { type: 'depl' } }); ok(r.success && L(c).b.orders[F].air === true, '24. ordre de l’unité volante : « en vol » par défaut');
  r = await c.call('battle-air', { unit: F, air: false }); ok(r.success && L(c).b.orders[F].air === false, '25. le joueur choisit « au sol »');
  await see(A, F, true, '26. à la pose des ordres, l’adversaire ne connaît pas ce choix (calcul « en vol »)');
  r = await b.call('battle-order', { unit: A, order: { type: 'charge', target: F } });
  ok(r.success && L(b).b.orders[A].seen === true, '27. ordre de charge : visible (choix caché)');
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true });
  ok(r.success && L(mj).b.orders[A].seen === false && L(mj).b.orders[A].why === 'dans une forêt', '28. à la révélation : recalcul avec « au sol » → cachée dans la forêt (' + L(mj).b.orders[A].why + ')');
  // l'unité volante au sol se déplace comme une unité au sol (montagne infranchissable)
  await mj.call('landing-goto', { phase: 'orders' }); reset();
  // unité volante au sol : se déplace comme une unité au sol (pas de montagne)
  const ring = (k) => { const [c0, r0] = k.split(',').map(Number); return (r0 % 2 ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]).map(([dx, dy]) => `${c0 + dx},${r0 + dy}`); };
  await c.call('battle-ready', { on: false });
  T(ring(P(F)), 'mountain');
  r = await c.call('battle-air', { unit: F, air: true }); let rv = await c.call('battle-reach', { unit: F, type: 'depl' }); const nAir = rv.tiles.length;
  r = await c.call('battle-air', { unit: F, air: false }); rv = await c.call('battle-reach', { unit: F, type: 'depl' });
  ok(nAir > 1 && rv.tiles.length === 1, `29. unité volante en vol survole les montagnes (${nAir} tuiles), au sol elle est bloquée (${rv.tiles.length})`);
  reset();
  // charge sans chemin libre : traversée d'une unité, sans voir
  await b.call('battle-ready', { on: false });
  T(row(10), 'mountain'); // seul passage : la tuile de X3 (unité amie)
  r = await b.call('battle-order', { unit: X, order: { type: 'charge', target: B4 } }); ok(r.success, '30. ordre de charge à travers la ligne de montagnes ' + (r.message || ''));
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', { manual: true }); let v = L(mj);
  for (let k = 0; k < 10 && v.m.step === 'charge' && v.m.queue[v.m.qi]?.id !== X; k++) { const act = v.m.actors[0]; await (act.startsWith('bob') ? b : c).call('move-skip', { unit: act }); v = L(mj); }
  const al = L(b).m.allow[X] || [];
  console.log('tuiles de charge proposées', al);
  ok(al.length > 0, '31. sans chemin libre, la charge reste possible en traversant');
  r = await b.call('move-do', { unit: X, tile: al[0] }); v = L(mj);
  ok(r.success && v.b.orders[X].seen === false && v.b.orders[X].why === 'à travers des unités', '32. charge à travers une unité : sans voir (' + v.b.orders[X].why + ')');
  r = await mj.call('move-undo', {}); ok(L(mj).b.orders[X].seen === false && L(mj).b.orders[X].why === 'à travers des unités', '33. annulation du déplacement : la vision reste celle fixée à la révélation');
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 3000);
