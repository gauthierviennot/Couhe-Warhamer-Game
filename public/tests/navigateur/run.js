// Banc d'essai navigateur (nécessite playwright + chromium) : node tests/navigateur/film.js ; captures dans tests/navigateur/shots/.
// Banc d'essai navigateur : server.js (faux socket.io) + index.html dans Chromium, relié par une passerelle.
process.env.DATA_DIR = require('os').tmpdir() + '/banc_' + Date.now(); process.env.PORT = '8899'; process.env.GAME_TEST = '1';
const P2 = require('path').resolve(__dirname, '../..');
const EE = require('events'); const fs = require('fs'); const path = require('path');
require(P2 + '/tests/harness.js'); require(P2 + '/server.js');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
module.exports = async function run(scenario, opts = {}) {
  await new Promise((r) => setTimeout(r, 300));
  const io = global.__io, S = global.__srv;
  let page;
  const mk = (id, toPage) => { const s = new EE(); s.id = id; s.data = {}; s.handshake = { address: '1.1.1.1', headers: {} }; s.join = () => {}; s.leave = () => {}; s.broadcast = { emit() {} }; s.log = [];
    s.call = (ev, p) => new Promise((r) => { const hs = s.listeners(ev); if (!hs.length) return r({ error: 'no handler ' + ev }); Promise.resolve(hs[0](p, (res) => r(res))); setTimeout(() => r({ timeout: true }), 3000); });
    s.emit = (ev, ...a) => { s.log.push([ev, a[0]]); if (toPage && page) page.evaluate(([e, d]) => window.__fromServer && window.__fromServer(e, d), [ev, a[0] === undefined ? null : a[0]]).catch(() => {}); return true; };
    io.sockets.sockets.set(id, s); io.h(s); return s; };
  const browser = await chromium.launch();
  page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 860 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const ps = mk('page', true);
  await page.exposeFunction('__toServer', (ev, p) => ps.call(ev, p));
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/socket.io/')) return route.fulfill({ contentType: 'application/javascript', body: `window.io=function(){const h={};const sock={connected:true,id:'pg',on(ev,f){(h[ev]=h[ev]||[]).push(f);if(ev==='connect')setTimeout(()=>f(),0);return sock;},off(){return sock},emit(ev,p,ack){if(typeof p==='function'){ack=p;p=null;}window.__toServer(ev,p===undefined?null:p).then(r=>ack&&ack(r));return sock;},timeout(){return{emit:(ev,p,cb)=>{if(typeof p==='function'){cb=p;p=null;}window.__toServer(ev,p===undefined?null:p).then(r=>cb&&cb(null,r));}}},disconnect(){},connect(){},io:{on(){}}};window.__fromServer=(ev,p)=>(h[ev]||[]).forEach(f=>f(p));return sock;};` });
    const f = path.join(P2, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://jeu.test/');
  await page.waitForTimeout(500);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  try { await scenario({ page, S, mk, ps, shot, errs }); } catch (e) { console.log('ERREUR scénario', e); }
  console.log('Erreurs page :', errs.length ? errs.join('\n') : 'aucune');
  await browser.close();
  process.exit(0);
};
