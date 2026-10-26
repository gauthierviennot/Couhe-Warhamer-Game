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
  const mage = idOf(lb, 'bob', /^mage/), canon = idOf(lb, 'bob', /canon.*servant/), archer = idOf(lb, 'bob', /^archer/);
  const iL = idOf(lc, 'cat', /^inf lourde/), cata = idOf(lc, 'cat', /catapulte.*servant/);
  console.log('ids', mage, canon, archer, iL, cata);
  ok(mage && canon && archer && iL && cata, 'unités de test trouvées (dont machines composées)');

  await mj.call('landing-battle', {});
  const spot = { [mage]: ['3,9', 1], [canon]: ['5,8', 1], [archer]: ['2,9', 1], [iL]: ['3,12', 4], [cata]: ['6,13', 4] };
  for (let pass = 0; pass < 600; pass++) {
    const v = L(mj); if (v.b.allPlaced) break; let prog = false;
    for (const U of [...ub, ...uc]) { if (L(mj).b.done[U]) continue; const S = U.startsWith('bob') ? b : c; const sp = spot[U];
      const rr = await S.call('battle-place', { unit: U, tile: sp ? sp[0] : undefined, orient: sp ? sp[1] : 0 }); if (rr.success) prog = true; }
    if (!prog) break;
  }
  ok(L(mj).b.allPlaced, 'tous placés');
  await mj.call('landing-orders', {});
  // ordres selon la fiche
  const caps = (id) => L(b).lines.concat(L(c).lines).find((l) => id.includes(l.uid + '#')).caps;
  console.log('caps mage', JSON.stringify(caps(mage)), 'canon', JSON.stringify(caps(canon)), 'iL', JSON.stringify(caps(iL)));
  ok(caps(mage).tir && !caps(mage).cc && caps(canon).art && !caps(canon).cc && caps(iL).cc && !caps(iL).tir, 'capacités lues dans la fiche');
  let r = await b.call('battle-order', { unit: mage, order: { type: 'charge', target: iL } }); ok(!r.success, 'mage : pas de charge (' + r.message + ')');
  r = await b.call('battle-order', { unit: canon, order: { type: 'tir', range: 'long', target: iL } }); ok(!r.success, 'artillerie : pas de tir long (' + r.message + ')');
  r = await b.call('battle-order', { unit: mage, order: { type: 'tir', target: iL } }); ok(!r.success, 'tir sans portée refusé (' + r.message + ')');
  r = await b.call('battle-order', { unit: archer, order: { type: 'depl' } }); ok(r.success, 'déplacement sans destination');
  { const setT = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'terrain', terrain, keys });
    const ar = await b.call('battle-reach', { unit: archer, type: 'depl' }); const ar2 = await b.call('battle-reach', { unit: archer, type: 'marche' });
    console.log('portée archer', ar.tiles.length, 'marche', ar2.tiles.length);
    ok(ar.success && ar.tiles.includes('2,9') && ar2.tiles.length > ar.tiles.length, 'portée réelle à la pose des ordres (marche forcée plus loin)');
    const ring = ['3,9', '1,9', '2,8', '3,8', '2,10', '3,10']; setT(ring, 'mountain');
    const ar3 = await b.call('battle-reach', { unit: archer, type: 'depl' }); ok(ar3.tiles.length === 1, 'entourée de montagnes : ne peut pas bouger (' + ar3.tiles.length + ')');
    setT(ring, 'plain'); }
  r = await b.call('battle-order', { unit: mage, order: { type: 'tir', range: 'long' } }); ok(r.success && !L(b).b.orders[mage].target, 'tir sans cible (choisie au moment du tir)');
  r = await b.call('battle-order', { unit: mage, order: { type: 'tir', range: 'court', target: iL } }); ok(r.success, 'ordre tir mage ' + (r.message || ''));
  ok(L(c).b.given.includes(mage) && !L(c).b.orders[mage] && L(b).b.orders[mage], 'l’adversaire voit qu’un ordre est donné, pas lequel');
  r = await b.call('battle-order', { unit: canon, order: { type: 'tir', range: 'art', target: iL } }); ok(r.success, 'ordre tir canon');
  r = await b.call('battle-order', { unit: archer, order: { type: 'depl', tile: '1,9' } }); ok(r.success, 'ordre déplacement archer');
  r = await c.call('battle-order', { unit: cata, order: { type: 'tir', range: 'art', target: mage } }); ok(r.success, 'ordre tir catapulte ' + (r.message || ''));
  await __ready(b, L); await __ready(c, L);
  r = await mj.call('landing-move', {}); ok(r.success, 'déplacements');
  let v = L(mj);
  const al = v.m.allow[archer] || [];
  // toutes les unités ont un ordre (les autres « restent en place ») : on joue le tour de rôle jusqu'à l'archer
  for (let k = 0; k < 200 && L(mj).m.step === 'move' && !L(mj).m.moved[archer]; k++) {
    const vm = L(mj).m;
    if (vm.active === 't1' && L(b).m.actors.includes(archer)) { r = await b.call('move-do', { unit: archer, tile: L(b).m.allow[archer].find((t) => t !== '2,9'), orient: 1 }); ok(r.success, 'archer se déplace ' + (r.message || '')); break; }
    const S = vm.active === 't1' ? b : c; await S.call('move-skip', { unit: L(S).m.actors[0] });
  }
  if (L(mj).m.step !== 'done') await mj.call('move-end', {});
  ok(L(mj).m.step === 'done', 'déplacements terminés');

  r = await b.call('landing-fire', {}); ok(!r.success, 'un joueur ne lance pas les tirs');
  r = await mj.call('landing-fire', {}); ok(r.success && L(mj).phase === 'fire', 'phase de tir');
  r = await mj.call('fire-roll', {}); // (rien à lancer)
  r = await mj.call('mj-test', { on: true }); ok(r.success, 'le MJ passe en mode test et correction (il lance les dés)');
  v = L(mj);
  console.log('f', JSON.stringify({ step: v.f.step, active: v.f.active, rolls: v.f.rolls, left: v.f.left }));
  ok(v.f.step === 'art' && v.f.rolls.art && v.f.left.t1 === 1 && v.f.left.t2 === 1, 'artillerie : dé, une machine par équipe');
  const A = v.f.active === 't1' ? b : c, B = v.f.active === 't1' ? c : b;
  const aArt = v.f.active === 't1' ? canon : cata, bArt = v.f.active === 't1' ? cata : canon;
  const aTgt = v.f.active === 't1' ? iL : mage;
  r = await B.call('fire-aim', { unit: bArt, target: aTgt === iL ? mage : iL }); ok(!r.success, 'pas son tour : ' + r.message);
  ok((L(A).f.actors || []).includes(aArt) && L(A).f.targets[aArt].some((t) => t.id === aTgt), 'cibles proposées au joueur actif');
  const ptile = L(mj).b.pos[aTgt] || L(mj).placed[aTgt];
  r = await A.call('fire-aim', { unit: aArt, tile: ptile }); ok(r.success, 'visée artillerie : point maximal ' + ptile + ' ' + (r.message || ''));
  ok(L(mj).f.pending.three.length === 3 && L(mj).f.pending.three[2] === ptile, 'artillerie : 3 tuiles du trajet, la 3e est le point visé (' + L(mj).f.pending.three.join(' ') + ')');
  ok(L(B).f.pending && L(B).f.pending.id === aArt, 'tir en préparation visible de l’adversaire');
  r = await A.call('fire-roll', {}); ok(!r.success, 'seul le MJ lance les dés');
  r = await mj.call('fire-roll', {}); ok(r.success, 'dés artillerie');
  v = L(mj); console.log('art', JSON.stringify(v.f.last.shots), 'dmg', v.f.last.dmg);
  const s0 = v.f.last.shots[0], th = v.f.last.three;
  ok(s0.r1 <= 3 ? s0.tile === th[s0.r1 - 1] : (s0.r2 === 4 ? s0.incident && s0.unit === aArt : (s0.tile === th[s0.r2 - 1] || s0.blind)), 'artillerie : 1-3 → tuile correspondante (1 la plus proche) ; 4 → nouveau d4 (tuile si vision) ; 4 et 4 → incident sur la machine');
  ok(!s0.unit || s0.done > 0, 'unité sur la tuile touchée : perd des PV');
  { const S0 = global.__srv, cr = require('crypto'), ri = cr.randomInt; const three = ['a', 'b', 'c'];
    const seq = (arr) => { let i = 0; cr.randomInt = () => arr[i++]; };
    seq([2]); let x = S0.artShot({ art: { dmg: 15 }, tags: [] }, three, false); ok(x.tile === 'b' && !x.r2, 'd4 = 2 : tuile 2');
    seq([4, 3]); x = S0.artShot({ art: { dmg: 15 }, tags: [] }, three, false); ok(x.tile === 'c', '4 puis 3 avec vision : tuile 3');
    seq([4, 3]); x = S0.artShot({ art: { dmg: 15 }, tags: [] }, three, true); ok(!x.tile && x.blind, '4 puis 3 sans vision : rien');
    seq([4, 4]); x = S0.artShot({ art: { dmg: 15 }, tags: [] }, three, false); ok(x.incident, '4 puis 4 : incident de tir');
    seq([4, 4, 1]); x = S0.artShot({ art: { dmg: 15 }, tags: ['art', 'spe'] }, three, false); ok(x.tile === 'a' && !x.incident, 'canon nain : relance supplémentaire avant l’incident (1 → tuile 1)');
    seq([4, 4, 4]); x = S0.artShot({ art: { dmg: 15 }, tags: ['art', 'spe'] }, three, false); ok(x.incident && x.r3 === 4, 'canon nain : 4, 4, 4 → incident');
    cr.randomInt = ri; }
  { const S0 = global.__srv, U0 = S0.allBattleUnits().find((x) => x.id === canon); const hp0 = S0.state.landing.b.hp?.[canon] ? S0.state.landing.b.hp[canon].slice() : null;
    const tpl = U0 && (() => { const hp = []; return hp; })();
    const before = S0.unitHp(U0).slice();
    console.log('canon hp', JSON.stringify(before));
    if (before && before.length > 1) { const h = before.slice(); S0.applyArtDamage(U0, h, 15); const idx = h.findIndex((x, i) => x !== before[i]); ok(before[idx] === Math.max(...before.filter((x) => x > 0)), 'artillerie : la figurine la plus forte (machine, monstre, grande figurine) perd ses PV en priorité'); }
  }
  ok(v.f.active !== (A === b ? 't1' : 't2'), 'la main passe à l’autre équipe');
  r = await B.call('fire-skip', { unit: bArt }); ok(r.success, 'l’autre machine passe');
  v = L(mj); ok(v.f.step === 'tir' && (v.f.left.t1 && v.f.left.t2 ? Boolean(v.f.rolls.tir) : v.f.rolls.tir === null), `autres tirs : second dé seulement si les deux équipes tirent (${v.f.left.t1}/${v.f.left.t2})`);
  const before = v.b.alive[iL] ? v.b.alive[iL][0] : 8, pvBefore = before * 4 - (v.b.alive[iL] ? 0 : 0);
  // tir du mage (40 points → 4 dés) sur l'infanterie lourde (armure 6)
  if (v.f.active !== 't1') { for (const u of L(c).f.actors) await c.call('fire-skip', { unit: u }); }
  v = L(mj); ok(v.f.active === 't1', 'au tour de bob');
  r = await b.call('fire-aim', { unit: mage, target: iL }); ok(r.success, 'visée mage ' + (r.message || ''));
  v = L(mj); const p = v.f.pending; console.log('mods', p.mods.filter((m) => m.on).map((m) => m.k).join(','), 'seuil', p.thr, 'dés', p.dice, 'arm', p.arm, 'd', p.d);
  const mageFigs = v.b.alive[mage] ? v.b.alive[mage][0] : 8;
  ok(p.points === mageFigs * 5 && p.dice === Math.ceil(mageFigs * 5 / 10), `mage : ${mageFigs} fig × 5 = ${p.points} points, ${p.dice} dés`);
  ok(p.mods.find((m) => m.k === 'mag').on && p.arm === 7, 'magie : armure 6 → 7');
  const thr0 = p.thr;
  r = await mj.call('fire-mod', { k: 'std', on: true }); r = await mj.call('fire-mod', { adj: 1 });
  ok(L(mj).f.pending.thr === thr0 + 2, 'MJ coche étendard (+1) et ajuste (+1)');
  global.__views = global.__views || []; global.__views.push(['pending', L(mj), L(b), L(c)]);
  r = await mj.call('fire-roll', {}); ok(r.success, 'dés du mage');
  global.__views.push(['result', L(mj), L(b), L(c)]);
  v = L(mj); const last = v.f.last;
  console.log('dés', JSON.stringify(last.dice), 'seuil', last.thr, 'arm', last.arm, 'dmg', last.dmg, 'reste', last.left);
  const expect = last.dice.filter((d) => d.r >= last.thr && d.a < last.arm).reduce((t, d) => t + d.v, 0);
  ok(last.dice.reduce((t, d) => t + d.v, 0) === p.points && Math.min(expect, before * 4) === last.dmg, 'blessures = somme des dés qui touchent puis passent l’armure');
  ok(v.b.alive[iL] && v.b.alive[iL][1] === 8 && v.b.alive[iL][0] === Math.ceil((before * 4 - last.dmg) / 4), 'figurines retirées (4 PV chacune) ' + before + ' → ' + JSON.stringify(v.b.alive[iL]));
  r = await mj.call('fire-undo', {}); v = L(mj);
  ok(r.success && v.f.pending && v.f.pending.id === mage && (v.b.alive[iL] ? v.b.alive[iL][0] : 8) === before, 'annulation : pertes du tir effacées, tir de nouveau en préparation');
  r = await mj.call('fire-cancel', {}); ok(r.success && !L(mj).f.pending, 'MJ annule la visée');
  // ligne de vue : montagnes entre le mage (3,9) et sa cible (3,12)
  const setT = (keys, terrain) => mj.listeners('edit-tiles')[0]({ testForce: true,  action: 'terrain', terrain, keys });
  setT(['3,10', '2,10', '3,11', '2,11', '4,10', '4,11'], 'mountain');
  r = await b.call('fire-aim', { unit: mage, target: iL }); v = L(mj);
  ok(r.success && v.f.pending.mods.find((m) => m.k === 'nolos').on && !v.f.pending.los.ok, 'montagne : sans voir +4 (' + v.f.pending.los.reason + ')');
  await b.call('fire-cancel', {}); setT(['3,10', '2,10', '3,11', '2,11', '4,10', '4,11'], 'plain');
  r = await b.call('fire-aim', { unit: mage, target: iL }); ok(r.success && L(mj).f.pending.los.ok, 'vue dégagée après retrait des montagnes');
  await b.call('fire-cancel', {});
  // archer déplacé : malus +3
  v = L(mj);
  if (v.f.active === 't1' && v.f.actors.includes(archer)) {
    r = await b.call('fire-aim', { unit: archer, target: iL }); console.log('archer', r.success, r.message || '');
    if (r.success) { ok(L(mj).f.pending.mods.find((m) => m.k === 'moved').on, 'archer déplacé : malus +3 coché'); await b.call('fire-cancel', {}); }
  }
  // MJ corrige : 3 figurines restantes sur 8 → jet de fuite
  r = await mj.call('fire-fix', { unit: iL, figs: 3 }); ok(r.success && L(mj).b.alive[iL][0] === 3, 'MJ corrige les figurines');
  r = await mj.call('fire-end', {}); v = L(mj);
  ok(v.f.step === 'flee' && iL in v.f.flee, 'jets de fuite proposés : ' + Object.keys(v.f.flee).join(','));
  global.__views.push(['flee', L(mj), L(b), L(c)]);
  r = await mj.call('fire-flee', { unit: iL }); v = L(mj);
  global.__views.push(['done', L(mj), L(b), L(c)]);
  const fl = v.f.flee[iL]; console.log('fuite', JSON.stringify(fl));
  ok(fl && fl.thr === 1 && fl.out === (fl.r <= 1), 'inf lourde indémoralisable : seuil 1');
  ok(v.f.step === 'done', 'phase de tir terminée');
  // une unité détruite quitte le plateau
  r = await mj.call('fire-undo', {}); r = await mj.call('fire-fix', { unit: iL, figs: 0 }); v = L(mj);
  ok(v.b.dead[iL] === true, 'unité à 0 figurine détruite');
  r = await mj.call('battle-next-turn', {}); console.log('tour suivant', r.success, r.message || '');
  if (!r.success) r = await mj.call('battle-next-turn', { force: true });
  v = L(mj); ok(r.success && v.phase === 'orders' && v.b.turn === 2 && !Object.keys(v.b.orders).length, 'tour 2 : pose des ordres');
  ok(v.b.dead[iL] && v.b.alive[iL][0] === 0, 'les pertes sont conservées');
  r = await b.call('battle-order', { unit: mage, order: { type: 'tir', target: iL } }); ok(!r.success, 'cible détruite refusée');
  // retour d'étape depuis les tirs : pertes de la phase effacées
  await __ready(b, L); await __ready(c, L);
  await mj.call('landing-move', {}); await mj.call('move-end', {}); await mj.call('move-end', {});
  r = await mj.call('landing-fire', {}); ok(r.success, 'tirs du tour 2');
  await mj.call('fire-fix', { unit: cata, figs: 1 });
  ok(L(mj).b.alive[cata][0] === 1, 'perte au tour 2');
  r = await mj.call('landing-goto', { phase: 'move' }); v = L(mj);
  ok(r.success && v.phase === 'move' && !v.b.alive[cata] && v.b.dead[iL], 'retour aux déplacements : pertes du tour 2 effacées, celles du tour 1 gardées');
  if (process.env.DUMP) require('fs').writeFileSync(process.env.DUMP, JSON.stringify(global.__views));
  console.log(`\n${nok} OK, ${nko} FAIL`);
  process.exit(0);
}, 3000);
