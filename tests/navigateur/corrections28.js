// Corrections du 28/10 : + et tuiles de débarquement dans la section centrale ; tuiles interdites en pointillés ; couleurs des étiquettes ; unité active.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, shot, S } = ctx;
  const { b, U, L } = await setup(ctx, [], null, { stopAtBplace: true, beforeBattle: async ({ ps }) => {
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'mark', mark: 'cross', keys: ['6,2', '6,3', '6,4'] });
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'object', object: 'village', keys: ['6,3'] });
  } });
  await page.waitForTimeout(400);
  const zones = await page.evaluate(() => window.__landDebug.view().zones.map((z) => ({ id: z.id, n: z.tiles.length, first: z.tiles[0] })));
  const zid = zones.find((z) => z.first.endsWith(',1')).id;
  const area = await page.evaluate((z) => window.__landDebug.area(z, 'mid'), zid);
  console.log(area.includes('6,2') && area.includes('6,4') ? 'OK   les + appartiennent à la section centrale' : 'FAIL + hors section centrale');
  console.log(area.includes('5,1') && area.includes('10,1') ? 'OK   tuiles de débarquement de la section dans l’aire de bonus' : 'FAIL tuiles de débarquement');
  const r = await page.evaluate((id) => { const u = window.__landDebug.units().find((x) => x.id === id); return window.__landDebug.range(u); }, U.E);
  console.log(r.pass.includes('6,3') ? 'OK   village simple à portée en pointillés orange (interdit)' : 'FAIL village pas signalé ' + JSON.stringify(r.pass));
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; });
  await shot('c28-placement');
  console.log('écran 6,3', JSON.stringify(await page.evaluate(() => window.__landDebug.tileScreen('6,3'))));
});
