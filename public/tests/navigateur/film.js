const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, shot } = ctx;
  const { L, U } = await setup(ctx, [['b', 'E', 'Z'], ['c', 'Z', 'E']]);
  const r = await ps.call('landing-move', {}); console.log('révélation', r.success, r.message || '');
  await page.waitForTimeout(800);
  const pos = () => page.evaluate((ids) => Object.entries(ids).map(([k, id]) => { const u = window.__landDebug.units().find((x) => x.id === id) || {}; return `${k}:${u.tile}/${u.orient}`; }).join(' '), U);
  const info = () => page.evaluate(() => { const w = document.querySelector('#chargeWin .lp-hint b'); return (w ? w.parentElement.textContent : '?').slice(0, 110); });
  console.log('positions réelles', await pos());
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/^Compris$/.test(b.textContent.trim()) && b.offsetParent) b.click(); });
  await dismiss(); await page.waitForTimeout(300); await dismiss();
  await page.evaluate(() => window.__landDebug.openPanel()); await page.waitForTimeout(300);
  const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'absent ' + s; if (e.disabled) return 'désactivé'; e.click(); return 'ok'; }, sel);
  console.log('ouvrir', await click('[data-land="cwopen"]')); await page.waitForTimeout(400);
  console.log('F', JSON.stringify(await page.evaluate(() => window.__landDebug.film())));
  console.log('0 :', await info(), '|', await pos()); await shot('g0');
  for (let i = 1; i <= 6; i++) { const c = await click('#chargeWin [title^="Image suivante"]'); await page.waitForTimeout(300); console.log(i, c, ':', await info(), '|', await pos()); if (i === 3) { await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; }); await dismiss(); await page.waitForTimeout(2800); await shot('g3'); } }
  await page.waitForTimeout(3000); await shot('g-fin');
  console.log('◀ 1', await click('#chargeWin [title^="Image précédente"]')); await page.waitForTimeout(200); console.log(await info(), '|', await pos());
  console.log('⏪', await click('#chargeWin [title^="Début de la charge"]')); await page.waitForTimeout(200); console.log(await info(), '|', await pos());
  console.log('⏮', await click('#chargeWin [title^="Positions d’origine"]')); await page.waitForTimeout(200); console.log(await info(), '|', await pos());
  console.log('▶', await click('#chargeWin [data-land="filmplay"]')); await page.waitForTimeout(9000); console.log(await info(), '|', await pos());
  console.log('fermer', await click('#chargeWin .fw-x')); await page.waitForTimeout(300); console.log('après fermeture', await pos());
});
