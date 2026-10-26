// Mise en place commune : MJ = la page ; bob (équipe 1, Elfes sylvains) et cat (équipe 2, Saurus) ; unités placées, ordres de charge, révélation.
module.exports = async function setup({ page, S, mk, ps }, orders, ctx_armies, opts = {}) {
  await page.fill('#usernameInput', 'mj'); await page.evaluate(() => { document.getElementById('passwordInput').hidden = false; });
  await page.fill('#passwordInput', 'mj'); await page.click('#btnLogin');
  await page.waitForTimeout(600);
  const b = mk('b'), c = mk('c');
  await b.call('set-username', { name: 'bob', clientId: 'c2' }); await c.call('set-username', { name: 'cat', clientId: 'c3' });
  await ps.call('new-map', { cols: 22, rows: 20 });
  const top = [], bot = []; for (let x = 0; x < 22; x++) { top.push(`${x},1`); bot.push(`${x},18`); }
  ps.listeners('edit-tiles')[0]({ action: 'mark', mark: 'diamond', keys: [...top, ...bot] });
  await ps.call('landing-start', {});
  const L = (s) => s.log.filter((x) => x[0] === 'landing').pop()[1];
  const zs = L(ps).zones.map((z) => z.id);
  await ps.call('landing-group', { zone: zs[0], group: 'A' }); await ps.call('landing-group', { zone: zs[1], group: 'B' });
  await ps.call('fiches-team', { op: 'assign', name: 'bob', team: 't1' }); await ps.call('fiches-team', { op: 'assign', name: 'cat', team: 't2' });
  const [AB, AC] = ctx_armies || ['elfes_sylvains', 'saurus'];
  await ps.call('fiches-pick', { name: 'bob', army: AB, legion: '1' }); await ps.call('fiches-pick', { name: 'cat', army: AC, legion: '1' });
  await ps.call('landing-teams', { A: 't1' });
  await b.call('landing-choose', { zone: zs[0] }); await c.call('landing-choose', { zone: zs[1] });
  await ps.call('landing-freeze', { force: true });
  const lb = L(b).lines.filter((l) => l.owner === 'bob'), lc = L(c).lines.filter((l) => l.owner === 'cat');
  const id1 = (lines, owner, re) => { const l = lines.find((x) => re.test(x.name)); return l ? `${owner}|${l.uid}#1` : null; };
  const U = { E: id1(lb, 'bob', /^inf legere/), EA: id1(lb, 'bob', /^archer lourd/), Z: id1(lc, 'cat', /^inf legere/), ZA: id1(lc, 'cat', /^archer/) };
  const spot = { [U.E]: '5,6', [U.EA]: '11,7', [U.Z]: '5,10', [U.ZA]: '12,12' };
  const allB = lb.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `bob|${l.uid}#${i + 1}`)), allC = lc.flatMap((l) => Array.from({ length: l.qty }, (_, i) => `cat|${l.uid}#${i + 1}`));
  let fb = 0, fc = 0;
  for (const u of allB) await b.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u].split(',')[0]},1` : `${16 + (fb++ % 6)},1` });
  for (const u of allC) await c.call('landing-place', { units: [u], tile: spot[u] ? `${spot[u].split(',')[0]},18` : `${16 + (fc++ % 6)},18` });
  await ps.call('landing-lock', { force: true });
  if (opts.beforeBattle) await opts.beforeBattle({ ps, L, U });
  await ps.call('landing-battle', {});
  if (opts.stopAtBplace) return { b, c, L, U };
  for (let pass = 0; pass < 800 && !L(ps).b.allPlaced; pass++) {
    let prog = false;
    for (const So of [b, c]) for (const u of L(So).b.actors || []) { const r = await So.call('battle-place', { unit: u, tile: spot[u], orient: So === b ? 1 : 4 }); if (r.success) { prog = true; break; } }
    if (!prog) break;
  }
  if (opts.stopBeforeOrders) return { b, c, L, U };
  await ps.call('landing-orders', {});
  for (const [who, unit, target] of orders) { const So = who === 'b' ? b : c; const r = await So.call('battle-order', { unit: U[unit], order: { type: 'charge', target: U[target] } }); console.log('ordre', unit, '→', target, r.success ? 'ok' : r.message); }
  await __ready(b, L); await __ready(c, L);
  return { b, c, L, U };
};
