// Tir d'artillerie : viser un point puis déclencher le tir (bouton « Tirer ici »), fenêtre de résolution, « Jeter les dés ».
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, shot, S } = ctx;
  const { b, c, L } = await setup(ctx, [], ['elfes_sylvains', 'nains']);
  const lc = L(c).lines.filter((l) => l.owner === 'cat'), bal = lc.find((l) => /canon/.test(l.name));
  const BAL = `cat|${bal.uid}#1`;
  await c.call('battle-ready', { on: false });
  let r = await c.call('battle-order', { unit: BAL, order: { type: 'tir', range: 'art' } }); console.log('ordre baliste', r.success, r.message || '');
  S.state.landing.b.pos[BAL] = '8,12';
  await c.call('battle-ready', { on: true });
  r = await ps.call('landing-move', {}); r = await ps.call('move-end', {}); r = await ps.call('landing-fire', { force: true }); console.log('tirs', r.success, r.message || '', S.state.landing.f?.step);
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  r = await ps.call('mj-test', { on: true }); await ps.call('mj-test-as', { name: 'cat' }); await page.waitForTimeout(400); await dismiss();
  await page.evaluate(() => window.__landDebug.openPanel()); await page.waitForTimeout(300);
  console.log('bouton viser', await page.evaluate(() => { const x = document.querySelector('[data-land="faim"]'); if (!x) return 'absent'; x.click(); return 'ok'; }));
  await page.waitForTimeout(300);
  const p = await page.evaluate(() => window.__landDebug.tileScreen('8,6'));
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);
  await shot('art-vise');
  console.log('confirmation', await page.evaluate(() => { const m = document.getElementById('mapConfirm'); if (!m || m.hidden) return 'absente'; const r2 = m.getBoundingClientRect(); return `${[...m.querySelectorAll('button')].map((x) => x.textContent).join(' | ')} @ ${Math.round(r2.left)},${Math.round(r2.top)} ${Math.round(r2.width)}x${Math.round(r2.height)}`; }));
  const alts = S.artAlts('8,12', '8,6'); const alt = alts[1] && alts[1].find((k) => k !== '7,7');
  if (alt) { const q2 = await page.evaluate((k) => window.__landDebug.tileScreen(k), alt); await page.mouse.click(q2.x, q2.y); await page.waitForTimeout(300); console.log('tuile du dé 2 choisie :', alt); }
  console.log('confirmation toujours là', await page.evaluate(() => { const m = document.getElementById('mapConfirm'); return Boolean(m && !m.hidden); }));
  console.log('tirer', await page.evaluate(() => { const x = [...document.querySelectorAll('#mapConfirm button')].find((y) => /Tirer ici/.test(y.textContent)); if (!x) return 'absent'; x.click(); return 'ok'; }));
  await page.waitForTimeout(600);
  console.log('en attente', JSON.stringify(S.state.landing.f.pending && { tile: S.state.landing.f.pending.tile, three: S.state.landing.f.pending.three }));
  console.log('jeter les dés', await page.evaluate(() => [...document.querySelectorAll('[data-land="froll"]')].map((x) => (x.closest('#fireWin') ? 'fenêtre' : 'panneau') + (x.offsetParent ? ' visible' : ' cachée')).join(', ') || 'absent'));
  await shot('art-pret');
});
