// Film des charges et des déplacements : chaque image = une tuile ; les déplacements suivent les charges.
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, shot, S } = ctx;
  const { b, c, L, U } = await setup(ctx, [['b', 'E', 'Z'], ['c', 'Z', 'E']]);
  await b.call('battle-ready', { on: false });
  let r = await b.call('battle-order', { unit: U.EA, order: { type: 'depl', tile: '9,9' } }); console.log('ordre EA', r.success, r.message || '');
  await b.call('battle-ready', { on: true });
  r = await ps.call('landing-move', {}); console.log('révélation', r.success, r.message || '');
  // jouer les déplacements : EA vers 9,9, les autres restent
  for (let k = 0; k < 80 && S.state.landing.m.step === 'move'; k++) {
    const m = S.state.landing.m; const act = m.active;
    const So = act === 't1' ? b : c; const v = L(So); const id = (v.m.actors || [])[0]; if (!id) break;
    if (id === U.EA) r = await So.call('move-do', { unit: id, tile: '9,9', orient: 3 }); else r = await So.call('move-skip', { unit: id });
    if (!r.success) { console.log('échec', id, r.message); break; }
  }
  console.log('déplacements', JSON.stringify(S.state.landing.m.moves));
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(400);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  await page.evaluate(() => window.__landDebug.openPanel()); await page.waitForTimeout(300);
  const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'absent'; if (e.disabled) return 'désactivé'; e.click(); return 'ok'; }, sel);
  const pos = () => page.evaluate((ids) => Object.entries(ids).map(([k, id]) => { const u = window.__landDebug.units().find((x) => x.id === id) || {}; return `${k}:${u.tile}/${u.orient}`; }).join(' '), U);
  const info = () => page.evaluate(() => { const w = document.querySelector('#chargeWin .lp-hint b'); return (w ? w.parentElement.textContent : '?').slice(0, 120); });
  console.log('ouvrir', await click('[data-land="cwopen"]')); await page.waitForTimeout(300);
  const n = (await page.evaluate(() => window.__landDebug.film())).n;
  for (let i = 0; i < n; i++) { console.log(i, await info(), '|', await pos()); await click('#chargeWin [title^="Image suivante"]'); await page.waitForTimeout(150); }
  console.log('⏪', await click('#chargeWin [title^="Début de la charge"]')); await page.waitForTimeout(150); console.log(await info(), '|', await pos());
  await page.evaluate(() => { const p = document.getElementById('landingPanel'); if (p) p.hidden = true; }); await shot('film2');
  console.log('fermer', await click('#chargeWin .fw-x')); await page.waitForTimeout(200); console.log('réel', await pos());
});
