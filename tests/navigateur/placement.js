// Placement de bataille : les obstacles entre la tuile de dépôt et la tuile d'arrivée ne comptent pas ;
// seule la tuile d'arrivée est contrôlée (eau sauf pont, montagne, village simple, cavalerie sur fortification / village à toit plat).
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page } = ctx;
  const { U } = await setup(ctx, [], null, { stopAtBplace: true, beforeBattle: async ({ ps }) => {
    const row = []; for (let x = 0; x < 22; x++) row.push(`${x},3`);
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain: 'water', keys: row });
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain: 'mountain', keys: ['4,2', '6,2'] });
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'object', object: 'bridge', keys: ['5,3'] });
  } });
  await page.waitForTimeout(400);
  const res = await page.evaluate((id) => {
    const u = window.__landDebug.units().find((x) => x.id === id); const r = window.__landDebug.range(u);
    const all = r.end.concat(r.bonusEnd || []);
    return { home: u.home, south: all.filter((k) => Number(k.split(',')[1]) >= 4).length, water: all.filter((k) => Number(k.split(',')[1]) === 3), mountain: all.filter((k) => k === '4,2' || k === '6,2') };
  }, U.E);
  console.log(JSON.stringify(res));
  console.log(res.south > 0 ? 'OK   au-delà de la rivière : atteignable (obstacles du trajet ignorés au placement)' : 'FAIL au-delà de la rivière non atteignable');
  console.log(res.water.every((k) => k === '5,3') ? 'OK   arrivée sur l’eau refusée, sauf sur le pont' : 'FAIL arrivée sur l’eau');
  console.log(!res.mountain.length ? 'OK   arrivée sur la montagne refusée' : 'FAIL montagne');
});
