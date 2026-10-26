"""Exporte les règles complètes (même contenu que REGLES-COMPLETES.pdf) en page d'aide HTML :
plan déroulant (annexes > sections > sous-sections) et recherche dans tout le texte."""
import re, html
from reportlab.platypus import Paragraph, Table, KeepTogether, Spacer, PageBreak
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderSVG


def md(t):
    t = re.sub(r'<font[^>]*backColor="([^"]+)"[^>]*>', r'<span style="background:\1">', t)
    t = re.sub(r'<font[^>]*>', '<span>', t).replace('</font>', '</span>')
    t = t.replace('<br/>', '<br>')
    return t


def level(p):
    names = [p.style.name, getattr(p.style.parent, 'name', '')]
    if 'annex' in names: return 1
    if 'h2' in names: return 2
    if 'h3' in names: return 3
    return 0


def fixcol(n):
    from reportlab.lib import colors
    for a in ('fillColor', 'strokeColor'):
        v = getattr(n, a, None)
        if isinstance(v, str): setattr(n, a, colors.toColor(v))
    for x in getattr(n, 'contents', []) or []: fixcol(x)


def svg(d):
    fixcol(d)
    s = renderSVG.drawToString(d)
    s = s[s.index('<svg'):]
    return s


def cell(c):
    if isinstance(c, Paragraph): return md(c.text)
    if isinstance(c, Drawing): return '<div class="fig">' + svg(c) + '</div>'
    if isinstance(c, list): return ''.join(block(x) for x in c)
    if c is None: return ''
    return html.escape(str(c))


def block(el):
    if isinstance(el, Paragraph):
        n = el.style.name
        if n == 'cap': return f'<p class="cap">{md(el.text)}</p>'
        if getattr(el, 'bulletText', None): return f'<p class="li">{md(el.text)}</p>'
        cls = ' class="small"' if n in ('s',) else ''
        return f'<p{cls}>{md(el.text)}</p>'
    if isinstance(el, KeepTogether):
        return ''.join(block(x) for x in el._content)
    if isinstance(el, Table):
        rows = el._cellvalues
        if any(isinstance(c, Drawing) for r in rows for c in r):
            return '<div class="figs">' + ''.join(cell(c) for r in rows for c in r) + '</div>'
        if any(isinstance(c, Table) for r in rows for c in r):
            return ''.join(block(c) for r in rows for c in r if isinstance(c, Table))
        out = '<div class="tw"><table>'
        for i, r in enumerate(rows):
            tag = 'th' if i == 0 else 'td'
            out += '<tr>' + ''.join(f'<{tag}>{cell(c)}</{tag}>' for c in r) + '</tr>'
        return out + '</table></div>'
    return ''


def export(S, changes, version, path):
    # Contenu à partir du premier titre d'annexe ; les modifications récentes en tête.
    start = next(i for i, el in enumerate(S) if isinstance(el, Paragraph) and level(el) == 1)
    parts, stack = [], []

    def open_sec(lv, title):
        while stack and stack[-1] >= lv:
            parts.append('</div></details>'); stack.pop()
        parts.append(f'<details class="l{lv}"><summary><span class="t">{md(title)}</span><span class="n"></span></summary><div class="c">')
        stack.append(lv)

    open_sec(1, 'Modifications récentes')
    parts.append(f'<p class="small">{html.escape(version)}</p>')
    parts += [f'<p class="li">{md(t)}</p>' for t in changes]
    for el in S[start:]:
        if isinstance(el, Paragraph) and level(el):
            open_sec(level(el), el.text)
        else:
            parts.append(block(el))
    while stack:
        parts.append('</div></details>'); stack.pop()
    open(path, 'w').write(PAGE.replace('%%BODY%%', '\n'.join(parts)))


PAGE = r'''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Règles du jeu</title>
<style>
:root{--bg:#f7f2e8;--ink:#1f2a37;--acc:#7a4b12;--line:#d6c7aa;--soft:#efe5d2;--mark:#ffe36e;--cur:#ff9f1c}
@media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--ink:#ece6da;--acc:#e3a857;--line:#4a4235;--soft:#2a2620;--mark:#7a6512;--cur:#c2610c}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
#bar{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#q{flex:1 1 160px;min-width:0;font-size:16px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--ink)}
#bar button{font-size:15px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--ink);cursor:pointer}
#bar button:disabled{opacity:.4}
#cnt{min-width:58px;text-align:center;font-variant-numeric:tabular-nums;font-size:13px}
main{padding:6px 10px 60px;max-width:900px;margin:0 auto}
details{border-left:3px solid transparent}
details.l1{border:1px solid var(--line);border-radius:10px;margin:8px 0;background:var(--bg)}
details.l1>summary{font-size:17px;font-weight:700;color:var(--acc);padding:10px 12px}
details.l2{margin:2px 0 2px 4px;border-left-color:var(--line)}
details.l2>summary{font-weight:700;color:var(--acc);padding:6px 8px}
details.l3>summary{font-weight:600;padding:4px 8px}
details.l3{margin-left:8px}
summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:baseline}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸";flex:none;transition:transform .15s}
details[open]>summary::before{transform:rotate(90deg)}
summary .t{flex:1}
summary .n{font-size:12px;font-weight:600;background:var(--mark);color:var(--ink);border-radius:10px;padding:0 7px}
summary .n:empty{display:none}
.c{padding:0 12px 8px 14px}
p{margin:5px 0}p.li{padding-left:14px;position:relative}p.li::before{content:"•";position:absolute;left:2px}
p.small{font-size:13px;opacity:.85}p.cap{font-size:13px;font-style:italic;opacity:.85;text-align:center}
.tw{overflow-x:auto;margin:6px 0}table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{border:1px solid var(--line);padding:4px 6px;vertical-align:top;text-align:left}th{background:var(--soft)}
.figs{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:8px 0 0}
.fig{background:#fff;border-radius:6px;padding:4px;max-width:100%;overflow-x:auto}.fig svg{max-width:100%;height:auto}
.fig text{font-family:"DejaVu Sans",Verdana,sans-serif}
mark{background:var(--mark);color:inherit;border-radius:2px}mark.cur{background:var(--cur);outline:2px solid var(--cur)}
</style></head><body>
<div id="bar">
 <input id="q" type="search" placeholder="Rechercher un mot ou une expression…" autocomplete="off" aria-label="Rechercher">
 <span id="cnt"></span>
 <button id="prev" title="Occurrence précédente" aria-label="Occurrence précédente" disabled>▲</button>
 <button id="next" title="Occurrence suivante" aria-label="Occurrence suivante" disabled>▼</button>
 <button id="all" title="Tout ouvrir ou tout fermer">Tout ouvrir</button>
</div>
<main id="doc">
%%BODY%%
</main>
<script>
(() => {
  const doc = document.getElementById('doc'), q = document.getElementById('q'), cnt = document.getElementById('cnt');
  const prev = document.getElementById('prev'), next = document.getElementById('next'), all = document.getElementById('all');
  const norm = (c) => { const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return n.length === 1 ? n : c.toLowerCase().slice(0, 1) || c; };
  const normStr = (s) => [...s].map(norm).join('').replace(/[’']/g, "'");
  let marks = [], cur = -1;

  function clear() {
    doc.querySelectorAll('mark').forEach((m) => { const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); });
    doc.querySelectorAll('summary .n').forEach((n) => (n.textContent = ''));
    marks = []; cur = -1;
  }
  function blocks() { return doc.querySelectorAll('p, td, th, summary .t'); }
  function search(term) {
    clear();
    const t = normStr(term.trim());
    if (t.length < 2) { cnt.textContent = ''; prev.disabled = next.disabled = true; return; }
    let k = 0; const segs = [];
    for (const b of blocks()) {
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const map = []; let s = '';
      for (let n; (n = w.nextNode());) { const tx = n.nodeValue; for (let i = 0; i < tx.length; i++) { s += norm(tx[i]).replace(/[’']/g, "'"); map.push([n, i]); } }
      let from = 0, at;
      while ((at = s.indexOf(t, from)) >= 0) {
        // découpe la correspondance par nœud de texte (une expression peut passer d'un mot en gras à un mot normal)
        let i = at;
        while (i < at + t.length) { const [n, o] = map[i]; let j = i; while (j + 1 < at + t.length && map[j + 1][0] === n) j++; segs.push({ n, s: o, e: map[j][1] + 1, k }); i = j + 1; }
        k++; from = at + t.length;
      }
    }
    const byNode = new Map(); for (const g of segs) { if (!byNode.has(g.n)) byNode.set(g.n, []); byNode.get(g.n).push(g); }
    for (const [n, list] of byNode) {
      list.sort((a, b) => b.s - a.s);
      for (const g of list) { const r = document.createRange(); r.setStart(n, g.s); r.setEnd(n, g.e); const m = document.createElement('mark'); m.dataset.k = g.k; r.surroundContents(m); }
    }
    marks = []; doc.querySelectorAll('mark').forEach((m) => { (marks[m.dataset.k] = marks[m.dataset.k] || []).push(m); });
    // nombre d'occurrences par section, affiché dans le plan
    doc.querySelectorAll('details').forEach((d) => { const set = new Set([...d.querySelectorAll('mark')].map((m) => m.dataset.k)); d.querySelector(':scope>summary .n').textContent = set.size ? set.size : ''; });
    prev.disabled = next.disabled = !marks.length;
    if (marks.length) go(0); else cnt.textContent = 'aucun';
  }
  function go(i) {
    if (!marks.length) return;
    if (cur >= 0) marks[cur].forEach((m) => m.classList.remove('cur'));
    cur = (i + marks.length) % marks.length;
    const ms = marks[cur]; ms.forEach((m) => m.classList.add('cur'));
    for (let d = ms[0].closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
    ms[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    cnt.textContent = `${cur + 1} / ${marks.length}`;
  }
  let timer, last = '';
  const run = () => { clearTimeout(timer); if (q.value !== last) { last = q.value; search(q.value); return true; } return false; };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!run()) go(cur + (e.shiftKey ? -1 : 1)); } });
  prev.onclick = () => go(cur - 1); next.onclick = () => go(cur + 1);
  all.onclick = () => { const open = all.textContent === 'Tout ouvrir'; doc.querySelectorAll('details').forEach((d) => (d.open = open)); all.textContent = open ? 'Tout fermer' : 'Tout ouvrir'; };
})();
</script>
</body></html>
'''
