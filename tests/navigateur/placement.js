// Portée du placement de bataille : pas à travers l'eau, pont seulement par ses extrémités.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page } = ctx;
  let flip = false;
  const { U } = await setup(ctx, [], null, { stopAtBplace: true, beforeBattle: async ({ ps }) => {
    const row = []; for (let x = 0; x < 22; x++) row.push(`${x},3`);
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain: 'water', keys: row });
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'object', object: 'bridge', keys: ['5,3'] });
  } });
  await page.waitForTimeout(400);
  const rng = () => page.evaluate((id) => { const u = window.__landDebug.units().find((x) => x.id === id); const r = window.__landDebug.range(u); return { home: u.home, south: r.end.concat(r.bonusEnd || []).filter((k) => Number(k.split(',')[1]) >= 4), n: r.end.length }; }, U.E);
  console.log('pont est-ouest :', JSON.stringify(await rng()));
  ctx.ps.listeners('rotate-object')[0]({ key: '5,3', testForce: true });
  await page.waitForTimeout(400);
  console.log('pont tourné (sud-est / nord-ouest) :', JSON.stringify(await rng()));
});
