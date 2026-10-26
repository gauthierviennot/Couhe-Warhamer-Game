// Étiquettes uniques par joueur dès le dépôt (ex. Elfes noirs : mage sur dragon et mage sur pégase, tous deux « tmv »).
const run = require('./run.js'), setup = require('./setup.js');
run(async (ctx) => {
  await setup(ctx, [], [process.argv[2] || 'elfes_noirs', process.argv[3] || 'empire']);
  const res = await ctx.page.evaluate(() => {
    const us = window.__landDebug.units(), seen = new Map(), dup = [];
    for (const u of us) { const k = `${u.owner}|${u.type || u.name} ${u.num}`; if (seen.has(k)) dup.push(`${k} : ${seen.get(k)} / ${u.name} ${u.idx}`); else seen.set(k, `${u.name} ${u.idx}`); }
    const tmv = us.filter((u) => /^tmv/i.test(u.type || '')).map((u) => `${u.name} → ${u.type} ${u.num}`);
    return { n: us.length, dup, tmv };
  });
  console.log('unités', res.n, '· doublons :', res.dup.length ? res.dup.join(' | ') : 'aucun');
  console.log('tmv :', res.tmv.join(' | '));
});
