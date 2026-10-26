// Pose des ordres : ligne de vue (flèche vers la cible) et cheminement prévu, vus par le MJ.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, shot, S } = ctx;
  const { b, U } = await setup(ctx, [['b', 'E', 'Z']]);
  // obstacle sur le chemin pour voir le contournement + un déplacement
  const ps = ctx.ps; ps.listeners('edit-tiles')[0]({ testForce: true, action: 'terrain', terrain: 'mountain', keys: ['5,7', '5,8'] });
  await b.call('battle-ready', { on: false });
  const r = await b.call('battle-order', { unit: U.EA, order: { type: 'depl', tile: '9,9' } }); console.log('depl', r.success, r.message || '');
  S.emitLanding();
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(300); await dismiss();
  console.log('routes', JSON.stringify(await page.evaluate(() => window.__landDebug.view().b.routes)));
  const p1 = await page.evaluate(() => window.__landDebug.tileScreen('5,8')), p2 = await page.evaluate(() => window.__landDebug.tileScreen('10,8')); console.log('écran', JSON.stringify(p1), JSON.stringify(p2));
  await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; });
  await page.waitForTimeout(300); await shot('ordres');
});
