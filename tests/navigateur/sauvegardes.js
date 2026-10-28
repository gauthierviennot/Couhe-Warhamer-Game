// Fenêtre des fiches : bouton « 📖 Règles » à côté des onglets, onglet Sauvegardes (fiches, cartes, jeux en cours).
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  const { page, ps, shot } = ctx;
  await setup(ctx, []);
  await ps.call('save-map', { name: 'Carte test', kind: 'carte' }); await ps.call('save-map', { name: 'Jeu test', kind: 'jeu' });
  await page.evaluate(() => document.getElementById('btnGo')?.click()); await page.waitForTimeout(500);
  const dismiss = () => page.evaluate(() => { for (const x of document.querySelectorAll('button')) if (/^Compris$/.test(x.textContent.trim()) && x.offsetParent) x.click(); });
  await dismiss(); await page.waitForTimeout(200); await dismiss();
  await page.evaluate(() => document.querySelector('[data-fiche="open"]')?.click()); await page.waitForTimeout(1500);
  const fr = page.frame({ url: /fiches\.html/ });
  console.log('fiches chargées', Boolean(fr));
  if (!fr) return;
  console.log('onglets', await fr.evaluate(() => [...document.querySelectorAll('.tabs .tab')].filter((b) => b.style.display !== 'none').map((b) => b.textContent.trim()).join(' | ')));
  await fr.evaluate(() => document.getElementById('tabS').click()); await page.waitForTimeout(1200);
  console.log('titres', await fr.evaluate(() => [...document.querySelectorAll('h1')].map((h) => h.textContent).join(' | ')));
  console.log('cartes / jeux', await fr.evaluate(() => [...document.querySelectorAll('.card b')].map((b) => b.textContent).join(', ')));
  await shot('saves');
  await fr.evaluate(() => document.getElementById('tabR').click()); await page.waitForTimeout(800);
  console.log('règles visibles', await page.evaluate(() => !document.getElementById('reglesFrame').hidden && document.getElementById('fichesFrame').hidden), '· bouton retour', await page.evaluate(() => !document.getElementById('btnRules').hidden && document.getElementById('btnRules').textContent));
  await page.evaluate(() => document.getElementById('btnRules').click()); await page.waitForTimeout(300);
  console.log('retour aux fiches', await page.evaluate(() => document.getElementById('reglesFrame').hidden && !document.getElementById('fichesFrame').hidden));
});
