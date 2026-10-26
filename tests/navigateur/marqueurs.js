// Marqueurs de frontière (disques, triangles hors zone) et + : visibles au placement, cachés ensuite, conservés sur la carte.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, S, shot } = ctx;
  const { L } = await setup(ctx, [], null, { stopBeforeOrders: true, beforeBattle: async ({ ps }) => {
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'mark', mark: 'disc', keys: ['3,9', '5,9', '7,9'] });
    ps.listeners('edit-tiles')[0]({ testForce: true, action: 'mark', mark: 'cross', keys: ['10,9', '12,9'] });
  } });
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; });
  ps.listeners('edit-tiles')[0]({ testForce: true, action: 'mark', mark: 'triangle', keys: ['14,9'] });
  await page.waitForTimeout(300);
  console.log('placement terminé :', await page.evaluate(() => window.__landDebug.view().b.allPlaced));
  console.log('phase', await page.evaluate(() => window.__landDebug.view().phase), '· marqueurs toujours enregistrés :', ['3,9', '10,9'].map((k) => S.state.gridData[k]?.mark).join(','));
  console.log('écran', JSON.stringify(await page.evaluate(() => ['3,9', '10,9', '14,9'].map((k) => window.__landDebug.tileScreen(k)))));
  await shot('m-ordres');
});
