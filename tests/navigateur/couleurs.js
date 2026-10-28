// Couleur de fond des étiquettes pendant les ordres (ordre reçu / pas encore) et unité active qui clignote.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, shot } = ctx;
  const { b, U } = await setup(ctx, [['b', 'E', 'Z']]);
  await b.call('battle-ready', { on: false }); await b.call('battle-order', { unit: U.EA, order: null });
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; });
  await shot('col-ordres');
  console.log('écran', JSON.stringify(await page.evaluate((ids) => [ids.E, ids.EA, ids.Z].map((id) => window.__landDebug.tileScreen(window.__landDebug.units().find((u) => u.id === id).tile)), U)));
});
