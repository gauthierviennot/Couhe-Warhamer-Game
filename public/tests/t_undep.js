// Dés annoncés (animation côté client) : initiative, relance, tirs.
process.env.DATA_DIR = '/tmp/dd_' + Date.now(); process.env.PORT = '8862';
const EE = require('events');
require('./harness.js'); require('../server.js');
setTimeout(async () => {
  const io = global.__io;
  const mk = (id) => { const s = new EE(); s.id = id; s.data = {}; s.handshake = { address: '1.1.1.1' }; s.join = () => {}; s.leave = () => {}; s.broadcast = { emit() {} }; s.log = [];
    s.call = (ev, p) => new Promise((r) => { const hs = s.listeners(ev); if (!hs.length) return r({ error: 'no handler ' + ev }); Promise.resolve(hs[0](p, (res) => r(res))); setTimeout(() => r({ timeout: true }), 3000); });
    s.emit = (ev, ...a) => { s.log.push([ev, a[0]]); return true; }; io.sockets.sockets.set(id, s); io.h(s); return s; };
  const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
  const mj = mk('a'), b = mk('b'), c = mk('c');
  await mj.call('set-username', { name: 'mj', password: 'mj', clientId: 'c1' }); await b.call('set-username', { name: 'bob', clientId: 'c2' }); await c.call('set-username', { name: 'cat', clientId: 'c3' });
  await mj.call('new-map', { cols: 20, rows: 20 });
  // deux bandes d'entrée sur toute la largeur, face à face (comme la carte de test du MJ)
  const top = [], bot = []; for (let x = 0; x < 20; x++) { top.push(`${x},1`); bot.push(`${x},18`); }
  mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'diamond', keys: [...top, ...bot] });
  const FRONT = process.env.FRONT === '1';
  if (FRONT) { // frontière commune : ligne de disques avec un triangle au milieu (carte du MJ)
    const line = []; for (let x = 0; x < 20; x++) if (x !== 10) line.push(`${x},9`);
    mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'disc', keys: line });
    mj.listeners('edit-tiles')[0]({ action: 'mark', mark: 'triangle', keys: ['10,9'] });
  }
  await mj.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(mj).zones.map((z) => z.id); console.log('zones', zs.join(','));
  await mj.call('landing-group', { zone: zs[0], group: 'A' }); await mj.call('landing-group', { zone: zs[1], group: 'B' });
  await mj.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await mj.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  await mj.call('fiches-pick', { name: 'bob', army: 'empire', legion: '1' }); await mj.call('fiches-pick', { name: 'cat', army: 'bretonnie', legion: '1' });
  await mj.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[1] });
  await mj.call('landing-freeze', { force: true });
  const zb = L(b).zones.find((z) => z.id === zs[0]).tiles, zc = L(c).zones.find((z) => z.id === zs[1]).tiles;
  const allB = []; for (const l of L(b).lines.filter((l) => l.owner === 'bob')) for (let i = 1; i <= l.qty; i++) allB.push(`bob|${l.uid}#${i}`);
  for (const u of allB.slice(0, 3)) await b.call('landing-place', { units: [u], tile: zb[0] });
  for (const l of L(c).lines.filter((l) => l.owner === 'cat')) for (let i = 1; i <= l.qty; i++) await c.call('landing-place', { units: [`cat|${l.uid}#${i}`], tile: zc[0] });
  await mj.call('landing-lock', { force: true });
  await mj.call('landing-battle', {});
  for (let pass = 0; pass < 400 && !L(mj).b.allPlaced; pass++) { let prog = false;
    for (const S of [b, c]) for (const u of L(S).b.actors || []) { const r2 = await S.call('battle-place', { unit: u, orient: 0 }); if (r2.success) { prog = true; break; } }
    if (!prog) break; }
  const v = L(b).b; console.log('non déposées', v.undeposited.length, '/', allB.length, v.undeposited.slice(0, 2).map((u) => u.name).join(', '));
  ok(v.allPlaced, 'placement terminé malgré les unités non déposées');
  ok(v.undeposited.length === allB.length - 3 && v.undeposited.every((u) => u.owner === 'bob'), 'liste des unités non déposées envoyée aux joueurs');
  const r = await mj.call('landing-orders', {}); ok(r.success, 'passage aux ordres sans forcer ' + (r.message || ''));
  process.exit(0);
}, 3000);
